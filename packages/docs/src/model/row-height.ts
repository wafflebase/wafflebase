/**
 * Tallest user-specified table row height (px) any reader will honour.
 *
 * A row is a *minimum* height the user dragged to, so the band only has to
 * cover a plausible drag: ~10 letter pages of content. Everything above it
 * is a value no gesture in this editor can produce.
 */
export const MAX_ROW_HEIGHT = 10000;

/**
 * One `tableData.rowHeights` entry as a number every reader can trust: a
 * finite height inside `(0, MAX_ROW_HEIGHT]`, or `undefined` for "auto".
 *
 * The field arrives unvalidated on the collaborative path — the `rowHeights`
 * Tree attribute is a comma-joined string read straight through `Number(...)`
 * on both read boundaries, and the backend's content ingest serializes
 * whatever it is handed — so `NaN`, `Infinity`, a negative, or a height far
 * past anything a drag could produce can all reach a reader.
 *
 * The paginator is the reader that makes this more than a rendering glitch.
 * `paginateLayout` splits an oversized row across pages with
 * `while (consumed < rowHeight)`, one page per iteration; the row height it
 * consumes is `LayoutTable.rowHeights[r]`, which takes the user value as a
 * minimum. `Infinity` never terminates, and `1e9` px against a ~900 px
 * content height is ~1.1 million pages, each with its own `LayoutLine` — a
 * hang or an OOM for every reader of the document, from one hostile
 * collaborator's attribute. A non-finite height would also make
 * `Number.isFinite` checks downstream (row hit-testing, the split-height
 * search) meaningless.
 *
 * Two branches, and the difference matters to every caller that reads this as
 * the model's rule: a **non-finite or non-positive** height is **dropped**,
 * because an absent entry already means "size this row from its content",
 * which is the neutral reading of a height that cannot be trusted — a
 * clamp-to-floor would invent a minimum the user never dragged to. A
 * **finite** height *above* `MAX_ROW_HEIGHT` is **clamped to it and returned
 * present**, so a merely-tall row stays tall instead of collapsing to its
 * content. It is not the case that out-of-band reads as absent.
 */
export function normalizeRowHeight(raw: number | undefined): number | undefined {
  if (raw === undefined) return undefined;
  if (!Number.isFinite(raw) || raw <= 0) return undefined;
  return Math.min(MAX_ROW_HEIGHT, raw);
}
