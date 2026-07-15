import { formatDistanceToNow } from "date-fns";

import type { Document, DocumentType } from "@/types/documents";

/**
 * Pure search/sort helpers for the documents list. Extracted from the table
 * component so the filtering and ordering rules can be unit-tested without a
 * DOM.
 */

/**
 * Whether a document matches the free-text search box, by title
 * (NFC-normalized, case-insensitive). Empty query matches everything.
 * Filtering by document type is handled separately by the type chips, so a
 * title search stays precise instead of flooding on type-name collisions.
 */
export function matchesSearch(
  doc: Pick<Document, "title">,
  query: string,
): boolean {
  const search = query.normalize("NFC").toLowerCase().trim();
  if (!search) return true;
  const title = String(doc.title ?? "")
    .normalize("NFC")
    .toLowerCase();
  return title.includes(search);
}

/**
 * Whether a document passes the active type-chip filter. An empty selection
 * means "all types".
 */
export function matchesTypes(
  doc: Pick<Document, "type">,
  types: ReadonlySet<DocumentType>,
): boolean {
  return types.size === 0 || types.has(doc.type);
}

/**
 * The value used for the "Last modified" column: Yorkie's `updatedAt`,
 * falling back to `createdAt` when the server had no Yorkie record.
 */
export function lastModified(
  doc: Pick<Document, "updatedAt" | "createdAt">,
): string {
  return doc.updatedAt ?? doc.createdAt;
}

/**
 * Compare two ISO date strings chronologically. Undefined/empty/unparseable
 * values sort oldest, and the comparator always returns a real number so the
 * sort stays stable even on malformed input.
 */
export function compareDates(
  a: string | undefined,
  b: string | undefined,
): number {
  return toEpoch(a) - toEpoch(b);
}

function toEpoch(value: string | undefined): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * Render a relative timestamp (e.g. "3 days ago"). Guards against invalid or
 * missing dates — `formatDistanceToNow` throws a RangeError on an invalid
 * Date, which would blank the whole list — returning an em dash instead.
 */
export function formatRelativeTime(value: string | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return formatDistanceToNow(date, { includeSeconds: true, addSuffix: true });
}

/** Maps a document to its editor/viewer route by type. */
export function getDocumentPath(doc: {
  id: number | string;
  type?: DocumentType;
}): string {
  switch (doc.type) {
    case "doc":
      return `/d/${doc.id}`;
    case "slides":
      return `/p/${doc.id}`;
    case "pdf":
      return `/f/${doc.id}`;
    case "note":
      return `/n/${doc.id}`;
    case "sheet":
    default:
      return `/s/${doc.id}`;
  }
}
