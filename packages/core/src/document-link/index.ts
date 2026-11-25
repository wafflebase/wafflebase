/**
 * Document links: the URL grammar that names a Wafflebase document and the
 * `?at=` anchor that points inside one (`docs/design/chat.md` § Document
 * Cards and Anchors).
 *
 * The backend reads these links out of chat messages and stores the anchor it
 * accepts; the frontend writes them ("Send to chat"), renders them as cards,
 * and applies `?at=` on arrival. Each side used to carry its own copy of the
 * route letters, the id rule, the anchor validator and its limits, kept in
 * step by a comment. A link one side accepts and the other refuses fails
 * silently either way — a stored anchor ignored on open, or one refused on
 * write while the client keeps offering it — so the rule lives here, once.
 *
 * Dependency-free and runtime-neutral: it relies only on `atob`/`btoa` and
 * `TextEncoder`/`TextDecoder`, which browsers and Node both provide.
 */

/** Where a sheet card points: its top-left cell by axis id, plus its spans. */
export type SheetAnchor = {
  tabId: string;
  rowId: string;
  colId: string;
  rowSpan: number;
  colSpan: number;
  label?: string;
};

/** Where a doc card points: a block, and a snapshot of what was selected. */
export type DocAnchor = { blockId: string; excerpt?: string; label?: string };

/** Where a slides card points: a slide. */
export type SlidesAnchor = { slideId: string; label?: string };

/**
 * Where a card points inside its document. `label` is the sender's display
 * snapshot (`Sheet1!C3:E7`, `Slide 3`): axis and slide ids cannot be named
 * without loading the document.
 */
export type ChatDocumentAnchor = SheetAnchor | DocAnchor | SlidesAnchor;

/** An encoded `?at=` longer than this is not decoded. */
export const MAX_ANCHOR_PARAM = 2_048;
/** The longest id (tab, axis, block, slide) an anchor may carry. */
export const MAX_ANCHOR_ID = 128;
/** The longest doc excerpt. */
export const MAX_ANCHOR_EXCERPT = 200;
/** The longest sender label. */
export const MAX_ANCHOR_LABEL = 80;
/** The largest sheet row or column span. */
export const MAX_ANCHOR_SPAN = 100_000;

/**
 * Each document type's editor route letter, as `App.tsx` mounts them. The
 * blob types share the file viewer.
 */
export const DOCUMENT_ROUTES = {
  sheet: 's',
  doc: 'd',
  slides: 'p',
  note: 'n',
  board: 'b',
  pdf: 'f',
  image: 'f',
  file: 'f',
} as const;

export type DocumentRouteType = keyof typeof DOCUMENT_ROUTES;
export type DocumentRouteLetter = (typeof DOCUMENT_ROUTES)[DocumentRouteType];

/** The distinct route letters, for building patterns. */
export const DOCUMENT_ROUTE_LETTERS: readonly DocumentRouteLetter[] = [
  ...new Set(Object.values(DOCUMENT_ROUTES)),
];

/**
 * A document id: a uuid, any case (stored lowercase). Regex source, no
 * anchors, no groups, for embedding in a larger pattern.
 */
export const DOCUMENT_ID_SOURCE =
  '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

/**
 * A document path, `/<letter>/<id>`, as regex source with no anchors:
 * group 1 is the route letter, group 2 the id. The caller decides what may
 * stand around it.
 */
export const DOCUMENT_PATH_SOURCE = `/(${DOCUMENT_ROUTE_LETTERS.join('|')})/(${DOCUMENT_ID_SOURCE})`;

const DOCUMENT_PATH = new RegExp(`^${DOCUMENT_PATH_SOURCE}/?$`);

/** The route letter for a document `type`, or null for an unknown type. */
export function documentRoute(type: string): DocumentRouteLetter | null {
  return Object.prototype.hasOwnProperty.call(DOCUMENT_ROUTES, type)
    ? DOCUMENT_ROUTES[type as DocumentRouteType]
    : null;
}

/**
 * The route letter and lowercase id of a bare document path (`/s/<id>`,
 * optionally with one trailing slash, no basename, no query), or null.
 */
export function parseDocumentPath(
  path: string,
): { route: DocumentRouteLetter; documentId: string } | null {
  const match = DOCUMENT_PATH.exec(path);
  if (!match) return null;
  return {
    route: match[1] as DocumentRouteLetter,
    documentId: match[2].toLowerCase(),
  };
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(raw: string): Uint8Array | null {
  if (raw.length > MAX_ANCHOR_PARAM || !/^[A-Za-z0-9_-]+$/.test(raw)) {
    return null;
  }
  try {
    const bin = atob(raw.replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** `?at=` for an anchor: base64url (no padding) of its UTF-8 JSON. */
export function encodeAnchor(anchor: ChatDocumentAnchor): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(anchor)));
}

function isId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_ANCHOR_ID;
}

function isSpan(v: unknown): v is number {
  return (
    typeof v === 'number' &&
    Number.isInteger(v) &&
    v >= 1 &&
    v <= MAX_ANCHOR_SPAN
  );
}

/** undefined when absent, null when present but invalid. */
function optionalText(v: unknown, max: number): string | undefined | null {
  if (v === undefined) return undefined;
  return typeof v === 'string' && v.length <= max ? v : null;
}

/**
 * `value` as an anchor for a document of `type`, or null when it is not
 * that type's shape. Only the type's own fields are kept, each checked, so
 * the result is always one the editor can apply.
 */
export function validateAnchor(
  value: unknown,
  type: string,
): ChatDocumentAnchor | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const a = value as Record<string, unknown>;
  const label = optionalText(a.label, MAX_ANCHOR_LABEL);
  if (label === null) return null;
  const withLabel = <T extends object>(o: T): T & { label?: string } =>
    label === undefined ? o : { ...o, label };
  switch (type) {
    case 'sheet':
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
    case 'doc': {
      if (!isId(a.blockId)) return null;
      const excerpt = optionalText(a.excerpt, MAX_ANCHOR_EXCERPT);
      if (excerpt === null) return null;
      return withLabel(
        excerpt === undefined
          ? { blockId: a.blockId }
          : { blockId: a.blockId, excerpt },
      );
    }
    case 'slides':
      if (!isId(a.slideId)) return null;
      return withLabel({ slideId: a.slideId });
    default:
      return null;
  }
}

/**
 * The anchor a raw `?at=` encodes for a document of `type`, or null when it
 * is absent, malformed, or not this type's shape. The server stores what
 * this accepts; the editor applies what this accepts — an `?at=` typed into
 * an address bar is held to the same rule as a stored one.
 */
export function decodeAnchor(
  raw: string | null | undefined,
  type: string,
): ChatDocumentAnchor | null {
  if (!raw) return null;
  const bytes = fromBase64Url(raw);
  if (!bytes) return null;
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  return validateAnchor(value, type);
}
