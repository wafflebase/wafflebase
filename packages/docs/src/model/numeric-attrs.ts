/**
 * Bands for the numeric Tree attributes that feed a line's height.
 *
 * `listLevel` and a table's `rowHeights` have their own modules
 * (`list-level.ts`, `row-height.ts`) because a gesture plans with them. These
 * are only ever read, and read at the same two boundaries — `crdt-tree.ts`
 * (the shared reader: revision preview, backend ingest) and the editor's live
 * `YorkieDocStore` — so they live together.
 *
 * They matter for the same reason `rowHeights` does, one step removed. A
 * table row's height is not only the minimum its user dragged to: steps 3–4
 * of `computeTableLayout` derive it from the cell's *content*
 * (`cellHeight = lines.reduce((s, l) => s + l.height, 0) + padding * 2`), and
 * every line height in that sum comes from a font size, an inline image, or a
 * paragraph's line spacing. So a `fontSize="Infinity"` on a run inside a cell
 * reaches `paginateLayout`'s `while (consumed < rowHeight)` loop exactly as a
 * poisoned `rowHeights` entry would — a hang for every reader of the
 * document, from one hostile collaborator's attribute — and a finite `1e9`
 * produces the million-page allocation instead.
 *
 * `paginateLayout` now bounds that loop on its own, so this module is not the
 * only thing standing between a peer's attribute and a hung tab. It is still
 * needed: a bound in the paginator leaves the `NaN` geometry itself intact,
 * which blanks the table (and, through `totalHeight`, the scroll extent) for
 * every reader. Band the value where it enters the model *and* bound the loop
 * that consumes it.
 *
 * Every band is the range the editor's own controls can reach, so nothing a
 * gesture can produce is altered:
 *
 * - `MAX_FONT_SIZE` is the font-size picker's own ceiling
 *   (`FONT_SIZE_MAX`, `components/text-formatting/font-catalog.ts`).
 * - `MAX_LINE_HEIGHT` is far above the line-spacing menu's largest entry (2).
 * - `MAX_CELL_PADDING` is far above the 4 px default; no control sets it.
 * - `MAX_IMAGE_SIZE` is ~25× the widest page an insert clamps an image to.
 *
 * Every band has *two* branches, and which one an input takes is the whole
 * contract — a band summarized as a single verb is wrong for half its inputs:
 *
 * - **Non-finite or non-positive** (`NaN`, `Infinity`, `0`, a negative) is
 *   **dropped** — returned as `undefined`, so the resolved default applies.
 *   There is no edge to clamp such a value towards, and an absent font size
 *   or line height already means "take the block's resolved default", the
 *   neutral reading of a value that cannot be trusted.
 * - **Finite but above the ceiling** (`1e9`) is **clamped to the ceiling and
 *   returned present**, so a merely-large value renders large rather than
 *   vanishing.
 *
 * `normalizeRowHeight` splits on the same line, and `normalizeListLevel`
 * clamps at both ends (0 is its floor, not a rejection). The one exception is
 * `isPaintableImageSize`, which drops rather than clamps even above the
 * ceiling — see its own note for why a *pair* cannot be clamped.
 */

/** Largest inline font size (pt) any reader will honour. */
export const MAX_FONT_SIZE = 400;

/** Largest paragraph line-height multiple any reader will honour. */
export const MAX_LINE_HEIGHT = 20;

/** Largest table-cell padding (px) any reader will honour. */
export const MAX_CELL_PADDING = 500;

/** Largest inline-image edge (px) any reader will honour. */
export const MAX_IMAGE_SIZE = 20000;

/**
 * One `fontSize` attribute as a number every reader can trust: a finite size
 * inside `(0, MAX_FONT_SIZE]`, or `undefined` for "inherit".
 *
 * A finite size *above* the ceiling is clamped to it and returned present —
 * only a non-finite or non-positive one becomes `undefined`.
 */
export function normalizeFontSize(raw: number | undefined): number | undefined {
  if (raw === undefined) return undefined;
  if (!Number.isFinite(raw) || raw <= 0) return undefined;
  return Math.min(MAX_FONT_SIZE, raw);
}

/**
 * One `lineHeight` block attribute as a multiple every reader can trust: a
 * finite multiple inside `(0, MAX_LINE_HEIGHT]`, or `undefined` so the
 * block's resolved default spacing supplies it.
 *
 * A finite multiple *above* the ceiling is clamped to it and returned present
 * — only a non-finite or non-positive one becomes `undefined`.
 *
 * "Resolved default" is not always the *named style's*: `effectiveBlockSpacing`
 * consults the style only while the spacing reads as inherited, and a block
 * carrying `authoredLineHeight: true` reads as authored either way — so a
 * dropped multiple there resolves `DEFAULT_BLOCK_STYLE.lineHeight` (1.5)
 * instead. Both are a legible paragraph, which is all this band promises.
 */
export function normalizeLineHeight(
  raw: number | undefined,
): number | undefined {
  if (raw === undefined) return undefined;
  if (!Number.isFinite(raw) || raw <= 0) return undefined;
  return Math.min(MAX_LINE_HEIGHT, raw);
}

/**
 * One cell `padding` attribute as a number every reader can trust: a finite
 * padding inside `[0, MAX_CELL_PADDING]`, or `undefined` for the default.
 *
 * Zero is in band — a table with no cell padding is a real style — so the
 * floor is inclusive here where the others exclude it. A finite padding
 * *above* the ceiling is clamped to it and returned present; only a
 * non-finite or negative one becomes `undefined`.
 */
export function normalizeCellPadding(
  raw: number | undefined,
): number | undefined {
  if (raw === undefined) return undefined;
  if (!Number.isFinite(raw) || raw < 0) return undefined;
  return Math.min(MAX_CELL_PADDING, raw);
}

/**
 * Whether an `image.width` / `image.height` pair is a size a reader may
 * materialize: both finite and inside `(0, MAX_IMAGE_SIZE]`.
 *
 * Dropping rather than clamping, because both readers already drop an image
 * whose size does not parse — clamping one edge of a pair would silently
 * restretch the picture, and the size is written back to the CRDT.
 */
export function isPaintableImageSize(width: number, height: number): boolean {
  return (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0 &&
    width <= MAX_IMAGE_SIZE &&
    height <= MAX_IMAGE_SIZE
  );
}
