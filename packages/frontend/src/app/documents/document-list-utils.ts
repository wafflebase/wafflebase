import { formatDistanceToNow } from "date-fns";

import type { DateDisplayFormat } from "@/lib/date-format-preference";
import type { Document, DocumentType } from "@/types/documents";

/**
 * Pure search/sort helpers for the documents list. Extracted from the table
 * component so the filtering and ordering rules can be unit-tested without a
 * DOM.
 */

/**
 * Whether a document matches the free-text search box, by title
 * (NFC-normalized, case-insensitive). Empty query matches everything.
 * Filtering by document type is handled separately by the type menu, so a
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
 * Whether a document passes the active type filter. An empty selection
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
  const date = parseDate(value);
  if (!date) return NO_DATE;
  return formatDistanceToNow(date, { includeSeconds: true, addSuffix: true });
}

/** The placeholder shown for a missing or unparseable date. */
export const NO_DATE = "—";

/**
 * Parse an ISO date string, returning null for missing or unparseable input.
 * Both `formatDistanceToNow` and `Intl.DateTimeFormat` throw a RangeError on
 * an invalid Date, and one malformed row must not blank the whole list.
 */
function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Render an absolute calendar date in the user's locale, e.g. "Jul 25, 2026"
 * — or "Jul 25" when the date falls in the current calendar year, since the
 * year is then just noise in a list of mostly-recent documents.
 *
 * The locale is left to the runtime (`undefined`), which resolves to the
 * browser's locale. The app has no language setting of its own, so that *is*
 * the user's locale; if one is ever added, this is the single place to thread
 * it through.
 *
 * `now` is injectable so the year-omission rule is testable without
 * depending on the wall clock.
 */
export function formatExactDate(
  value: string | undefined,
  now: Date = new Date(),
): string {
  const date = parseDate(value);
  if (!date) return NO_DATE;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  }).format(date);
}

/**
 * Render the full localized date *and* time, e.g. "Jul 25, 2026, 3:30 PM".
 * Used as the tooltip on every date cell so the exact timestamp is reachable
 * whichever display format is active.
 */
export function formatFullDateTime(value: string | undefined): string {
  const date = parseDate(value);
  if (!date) return NO_DATE;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

/**
 * Render a date cell's visible text for the user's chosen display format.
 * Purely presentational — sorting always compares the raw values through
 * `compareDates`, so the order never depends on the format.
 */
export function formatListDate(
  value: string | undefined,
  format: DateDisplayFormat,
  now?: Date,
): string {
  return format === "exact"
    ? formatExactDate(value, now)
    : formatRelativeTime(value);
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
    case "image":
    case "file":
      return `/f/${doc.id}`;
    case "note":
      return `/n/${doc.id}`;
    case "board":
      return `/b/${doc.id}`;
    case "sheet":
    default:
      return `/s/${doc.id}`;
  }
}

/**
 * Whether this document's content is a stored blob rather than a CRDT — the
 * types that have a `fileId`, can be downloaded, and open at `/f/:id`.
 * Mirrors `isBlobBacked` in the backend's document-file-id.util.ts.
 */
export function isBlobBacked(type: DocumentType | undefined): boolean {
  return type === "pdf" || type === "image" || type === "file";
}
