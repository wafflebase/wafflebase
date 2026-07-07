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
 * Compare two ISO date strings chronologically. Undefined/empty sorts oldest.
 */
export function compareDates(
  a: string | undefined,
  b: string | undefined,
): number {
  return (a ? Date.parse(a) : 0) - (b ? Date.parse(b) : 0);
}
