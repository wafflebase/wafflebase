import {
  decodeAnchor,
  encodeAnchor,
  parseDocumentPath,
  type ChatDocumentAnchor,
  type DocAnchor,
  type DocumentRouteLetter,
  type SheetAnchor,
  type SlidesAnchor,
} from "@wafflebase/core/document-link";
import { getDocumentPath } from "@/app/documents/document-list-utils";
import type { DocumentType } from "@/types/documents";

export type { ChatDocumentAnchor, DocAnchor, SheetAnchor, SlidesAnchor };
export { decodeAnchor, encodeAnchor };

/*
 * Document links as chat carries them (`docs/design/chat.md` § Document
 * Cards and Anchors): today's editor routes (`/s/:id`, `/d/:id`, `/p/:id`,
 * `/n/:id`, `/b/:id`, `/f/:id`) plus two optional query parameters —
 * `?chat=<channelId>` opens the editor's chat panel on that channel, and
 * `?at=<anchor>` is base64url (no padding) of the anchor's compact JSON.
 * The route grammar and the anchor codec are `@wafflebase/core/document-link`,
 * the same module the backend's `chat-document-refs.ts` reads them with.
 */

export interface DocumentLink {
  /** Lowercase, as the server stores ids. */
  documentId: string;
  /** The route letter the link used (`s`, `d`, …). */
  route: DocumentRouteLetter;
  /** `?chat=`, or null. */
  chat: string | null;
  /** The raw, undecoded `?at=`, or null. */
  at: string | null;
}

/**
 * The router basename, without a trailing slash: what `App.tsx` mounts the
 * router under. Every chat link reads it from here, so the URL a message
 * carries and the path the router is handed are cut at the same place.
 */
export function routerBasename(): string {
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
  base: string = routerBasename(),
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
  const match = parseDocumentPath(path);
  if (!match) return null;
  return {
    documentId: match.documentId,
    route: match.route,
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
  return `${origin}${routerBasename()}${buildDocumentPath(doc, opts)}`;
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
