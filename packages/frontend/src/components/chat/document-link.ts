import type {
  ChatDocumentAnchor,
  DocAnchor,
  SheetAnchor,
  SlidesAnchor,
} from "@/api/chat";
import { getDocumentPath } from "@/app/documents/document-list-utils";
import type { DocumentType } from "@/types/documents";

export type { ChatDocumentAnchor, DocAnchor, SheetAnchor, SlidesAnchor };

/*
 * Document links as chat carries them (`docs/design/chat.md` § Document
 * Cards and Anchors): today's editor routes (`/s/:id`, `/d/:id`, `/p/:id`,
 * `/n/:id`, `/b/:id`, `/f/:id`) plus two optional query parameters —
 * `?chat=<channelId>` opens the editor's chat panel on that channel, and
 * `?at=<anchor>` is base64url (no padding) of the anchor's compact JSON.
 * The backend's `chat-document-refs.ts` parses the same shape; keep the two
 * in step.
 */

/** The editor route letters, in `App.tsx`. */
const ROUTE_PREFIXES = "sdpnbf";
const UUID =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const DOCUMENT_PATH = new RegExp(
  `^/([${ROUTE_PREFIXES}])/(${UUID})/?$`,
);

const MAX_ANCHOR_PARAM = 2048;
const MAX_ID = 128;
const MAX_EXCERPT = 200;
const MAX_LABEL = 80;
const MAX_SPAN = 100_000;

export interface DocumentLink {
  /** Lowercase, as the server stores ids. */
  documentId: string;
  /** The route letter the link used (`s`, `d`, …). */
  route: string;
  /** `?chat=`, or null. */
  chat: string | null;
  /** The raw, undecoded `?at=`, or null. */
  at: string | null;
}

/** The router basename, without a trailing slash. */
function basename(): string {
  return (import.meta.env.VITE_FRONTEND_BASENAME ?? "").replace(/\/+$/, "");
}

/**
 * A document link, or null. Takes an absolute URL on this app's own origin
 * (below the router basename) or a root-relative path; any other origin's
 * `/s/<id>` names nothing here, exactly as the server reads it.
 */
export function parseDocumentLink(
  raw: string,
  origin: string = window.location.origin,
  base: string = basename(),
): DocumentLink | null {
  let url: URL;
  try {
    url = raw.startsWith("/") && !raw.startsWith("//")
      ? new URL(raw, origin)
      : new URL(raw);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  let path = url.pathname;
  // A root-relative path in a message is written without the basename.
  if (base && path.startsWith(`${base}/`)) path = path.slice(base.length);
  const match = DOCUMENT_PATH.exec(path);
  if (!match) return null;
  return {
    documentId: match[2].toLowerCase(),
    route: match[1],
    chat: url.searchParams.get("chat"),
    at: url.searchParams.get("at"),
  };
}

/**
 * The in-app path (no basename: for the router) that opens `doc`, with
 * `?chat=` and `?at=` when given. `at` is an anchor to encode, or an
 * already-encoded value to carry through unchanged.
 */
export function buildDocumentPath(
  doc: { id: string; type: string },
  opts: { chat?: string | null; at?: ChatDocumentAnchor | string | null } = {},
): string {
  const path = getDocumentPath({ id: doc.id, type: doc.type as DocumentType });
  const params = new URLSearchParams();
  if (opts.chat) params.set("chat", opts.chat);
  if (opts.at) {
    params.set("at", typeof opts.at === "string" ? opts.at : encodeAnchor(opts.at));
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/** The absolute URL of `buildDocumentPath`, for pasting into a message. */
export function buildDocumentUrl(
  doc: { id: string; type: string },
  opts: { chat?: string | null; at?: ChatDocumentAnchor | string | null } = {},
  origin: string = window.location.origin,
): string {
  return `${origin}${basename()}${buildDocumentPath(doc, opts)}`;
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(raw: string): Uint8Array | null {
  if (raw.length > MAX_ANCHOR_PARAM || !/^[A-Za-z0-9_-]+$/.test(raw)) {
    return null;
  }
  try {
    const bin = atob(raw.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** `?at=` for an anchor: base64url of its UTF-8 JSON, unpadded. */
export function encodeAnchor(anchor: ChatDocumentAnchor): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(anchor)));
}

function isId(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= MAX_ID;
}

function isSpan(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= MAX_SPAN;
}

/** undefined when absent, null when present but invalid. */
function optionalText(v: unknown, max: number): string | undefined | null {
  if (v === undefined) return undefined;
  return typeof v === "string" && v.length <= max ? v : null;
}

/**
 * The anchor `raw` encodes for a document of `type`, or null when it is
 * absent, malformed, or not this type's shape. Only the type's own fields
 * are kept. Mirrors the server's `parseAnchor`, so an `?at=` typed into an
 * address bar is held to the same rules as a stored one.
 */
export function decodeAnchor(
  raw: string | null | undefined,
  type: string,
): ChatDocumentAnchor | null {
  if (!raw) return null;
  const bytes = fromBase64Url(raw);
  if (!bytes) return null;
  let v: unknown;
  try {
    v = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const a = v as Record<string, unknown>;
  const label = optionalText(a.label, MAX_LABEL);
  if (label === null) return null;
  const withLabel = <T extends object>(o: T): T & { label?: string } =>
    label === undefined ? o : { ...o, label };
  switch (type) {
    case "sheet":
      if (
        !isId(a.tabId) ||
        !isId(a.rowId) ||
        !isId(a.colId) ||
        !isSpan(a.rowSpan) ||
        !isSpan(a.colSpan)
      ) {
        return null;
      }
      return withLabel({
        tabId: a.tabId,
        rowId: a.rowId,
        colId: a.colId,
        rowSpan: a.rowSpan,
        colSpan: a.colSpan,
      });
    case "doc": {
      if (!isId(a.blockId)) return null;
      const excerpt = optionalText(a.excerpt, MAX_EXCERPT);
      if (excerpt === null) return null;
      return withLabel(
        excerpt === undefined
          ? { blockId: a.blockId }
          : { blockId: a.blockId, excerpt },
      );
    }
    case "slides":
      if (!isId(a.slideId)) return null;
      return withLabel({ slideId: a.slideId });
    default:
      return null;
  }
}

/**
 * What a card shows after its title: the sender's label, else a doc
 * anchor's excerpt, else nothing — a bare id means nothing to a reader.
 */
export function anchorLabel(anchor: ChatDocumentAnchor | null): string | null {
  if (!anchor) return null;
  if (anchor.label) return anchor.label;
  if ("excerpt" in anchor && anchor.excerpt) return anchor.excerpt;
  return null;
}
