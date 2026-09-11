import type { Block } from './types.js';
import { normalizeListLevel } from './list-level.js';
import { normalizeRowHeight } from './row-height.js';

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
 * Every band covers the range of every *producer* whose output we accept, not
 * just the range this editor's own controls can reach. That distinction is
 * load-bearing: a band narrower than a producer turns a legitimate import into
 * content that renders at one size for the importer and a smaller one for
 * every later reader of the same document — the silent divergence these bands
 * exist to prevent, arriving from the other direction. So the two fields DOCX
 * can express take Word's ceilings rather than the editor's:
 *
 * - `MAX_FONT_SIZE` is the largest size any producer here can author — above
 *   Word's 1638 pt (`w:sz`, half points, which `import/docx-style-map.ts`
 *   imports) and at DrawingML's, which a slide text body carries. The
 *   *picker's* ceiling is a separate, smaller UI choice (`FONT_SIZE_MAX`,
 *   `components/text-formatting/font-catalog.ts`).
 * - `MAX_LINE_HEIGHT` is Word's largest "Multiple" line spacing — `w:line`'s
 *   22-inch ceiling read as 240ths, which is also DrawingML's `lnSpc`
 *   percentage ceiling — and far above the line-spacing menu's largest entry
 *   (2).
 * - `MAX_CELL_PADDING` is far above the 4 px default; no control sets it.
 * - `MAX_IMAGE_SIZE` is ~25× the widest page an insert clamps an image to.
 * - `MAX_TABLE_SPAN` and `MAX_TABLE_COLUMNS` are far above the grid any
 *   producer here builds (Word itself stops at 63 columns).
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

/**
 * Largest inline font size (pt) any reader will honour — the largest any
 * producer here can author: DrawingML's `ST_TextFontSize` ceiling (400000
 * hundredths), which is above Word's 1638 pt.
 */
export const MAX_FONT_SIZE = 4000;

/**
 * Largest paragraph line-height multiple any reader will honour — Word's
 * `w:line` ceiling (31680 twips) read as 240ths, i.e. its largest "Multiple".
 */
export const MAX_LINE_HEIGHT = 132;

/** Largest table-cell padding (px) any reader will honour. */
export const MAX_CELL_PADDING = 500;

/** Largest inline-image edge (px) any reader will honour. */
export const MAX_IMAGE_SIZE = 20000;

/** Largest `rowSpan` / `colSpan` any reader will honour. */
export const MAX_TABLE_SPAN = 1000;

/** Most columns any reader will materialize for one table. */
export const MAX_TABLE_COLUMNS = 256;

/**
 * Nesting cap for {@link bandBlockNumerics}' own walk.
 *
 * A table cell's `blocks` can hold another table, whose cells hold another —
 * a chain a peer can write to any depth — so an uncapped walk blows the stack,
 * and a `RangeError` raised *inside the band* fails the whole `read()` rather
 * than mis-rendering one table: a guard that turns a render bug into a total
 * read failure is worse than the thing it guards. At the cap the walk stops
 * descending and leaves what is below as stored, which is what
 * `bandElementNumerics` (`@wafflebase/slides`, `model/band-numerics.ts`) does
 * with a group chain at its own `MAX_GROUP_DEPTH`. The value is that constant:
 * the two walks interleave (a slide's table cell holds a docs body), and the
 * dependency runs slides → docs, so the copy lives here.
 */
export const MAX_BLOCK_DEPTH = 32;

/**
 * Largest column width ratio any reader will honour.
 *
 * Deliberately far above the `1 / cols` every writer here produces (a ratio is
 * a fraction of the content width) rather than at `1`: the band's job is to
 * keep the geometry finite, and a document stored by some earlier writer with
 * absolute widths in it should keep rendering exactly as it does today rather
 * than collapse to a single content width.
 */
export const MAX_COLUMN_RATIO = 1000;

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

/**
 * One `colSpan` / `rowSpan` attribute as a number every reader can trust: an
 * integer inside `[0, MAX_TABLE_SPAN]`, or `undefined` for "no span declared".
 *
 * `0` is in band and is *not* a rejection: it is the covered-cell marker
 * `computeTableLayout` and `normalizeTableMerges` key on, so dropping it would
 * take the merge apart. A non-finite or negative span is dropped (a cell with
 * no span reads as `1`, the neutral value); a finite one above the ceiling is
 * clamped and kept, like every other band here.
 *
 * The sink is worse than geometry. `expandCellRangeForMerges`
 * (`view/selection.ts`) runs a fixed-point `while (changed)` loop that widens
 * the selected rectangle to `r + rowSpan - 1`; with `rowSpan = Infinity` the
 * rectangle's end becomes `Infinity` and the `for (r = rowStart; r <= rowEnd;
 * r++)` inside it never terminates — a permanently hung tab for anyone who
 * selects cells in that table, from one peer's attribute. A finite `1e9` is
 * the same loop running a billion times.
 */
export function normalizeTableSpan(
  raw: number | undefined,
): number | undefined {
  if (raw === undefined) return undefined;
  if (!Number.isFinite(raw) || raw < 0) return undefined;
  return Math.min(MAX_TABLE_SPAN, Math.trunc(raw));
}

/**
 * The `cols` attribute — a comma-joined list of column width *ratios* — as the
 * `tableData.columnWidths` array every reader can trust.
 *
 * Shared by both CRDT read boundaries, which is the point: each used to parse
 * it with its own `split(',').map(Number).filter((n) => !isNaN(n))`, and
 * `Number('1e400')` is `Infinity`, which `!isNaN` happily passes. Two things
 * are bounded here that the open-coded version was not:
 *
 * - **The count.** `columnWidths.length` is `computeTableLayout`'s `numCols`,
 *   and its `for (r) for (c)` loop allocates a `LayoutTableCell` per pair — so
 *   a `cols` string of a million entries is a million allocations *per row*,
 *   from an attribute a peer can write. Entries past `MAX_TABLE_COLUMNS` are
 *   dropped.
 * - **The magnitude.** A ratio is a fraction of the content width (the writer
 *   fills `1 / cols`), and it is multiplied by it: `Infinity * width` is
 *   `Infinity`, and a mixed-sign pair reaches `NaN` cumulative offsets, which
 *   blanks the table — and, through `totalHeight`, the scroll extent — for
 *   every reader. Non-finite entries are dropped, the behaviour the old
 *   `isNaN` filter already had for `NaN`, and a finite one is clamped into
 *   `[0, MAX_COLUMN_RATIO]`.
 *
 * What is *not* bounded here is the count downwards. A missing or empty
 * attribute answers `[0]` — one zero-width column — because that is what the
 * replaced parsers answered: both read it as `(attrs.cols ?? '').split(',')`,
 * and `Number('')` is `0`, which their `!isNaN` filter kept. The answer
 * matters because `columnWidths.length` *is* `computeTableLayout`'s `numCols`:
 * an empty array lays out no cells at all, so the row's content never reaches
 * the layout or `blockParentMap` and becomes unreachable rather than merely
 * narrow. A band may repair a number; it may not delete a column.
 */
export function parseColumnWidthsAttr(attr: string | undefined): number[] {
  if (!attr) return [0];
  const widths: number[] = [];
  for (const part of attr.split(',')) {
    if (widths.length >= MAX_TABLE_COLUMNS) break;
    const ratio = normalizeColumnRatio(Number(part));
    if (ratio === undefined) continue;
    widths.push(ratio);
  }
  return widths;
}

/**
 * One column width ratio as a number every reader can trust: a finite ratio
 * inside `[0, MAX_COLUMN_RATIO]`, or `undefined` for one that cannot be used
 * as geometry at all. See {@link parseColumnWidthsAttr}, which is this applied
 * to the `cols` attribute; the slides content validator applies it to a stored
 * `columnWidths` array, where a dropped entry keeps its index as `0` so the
 * later columns do not shift.
 */
export function normalizeColumnRatio(
  raw: number | undefined,
): number | undefined {
  if (raw === undefined) return undefined;
  if (!Number.isFinite(raw)) return undefined;
  return Math.min(MAX_COLUMN_RATIO, Math.max(0, raw));
}

/** A stored value this model can do arithmetic with, or nothing. */
function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** A stored value that can hold banded fields, or nothing. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Band, in place, every numeric a stored `Block[]` carries into the docs
 * layout engine — the bands above plus `listLevel` and `rowHeights`, applied
 * to a *plain* block list rather than to Tree attributes.
 *
 * This exists because a docs body and a slide text body reach the identical
 * `computeLayout` / `paginateLayout` through opposite doors. A docs body is
 * written and read back through the Tree attribute codec (`crdt-tree.ts` and
 * the frontend `YorkieDocStore`), which bands every one of these on each
 * read. A slide text body — a text box's `data.blocks`, a shape's
 * `data.text.blocks`, a table cell's `body.blocks`, a slide's `notes` — is
 * persisted *verbatim* as JSON and read back verbatim: there is no codec, so
 * a peer who calls `doc.update` with `fontSize: 1e9` or `rowSpan: Infinity`
 * stores it as written, and it is then a hung or blank deck for every other
 * viewer. Handing those lists through this on read is what gives them the
 * band the docs codec gives a docs body.
 *
 * In place and returning the same array, because both callers pass a list
 * `yorkieToPlain` just materialized — a private JSON copy, never a live CRDT
 * proxy — so there is nothing to preserve and nothing else observing it.
 *
 * Repairs rather than rejects, like every band here: the values are read out
 * of documents that already exist, and a reader with no value at all still
 * has to render something. The rule per field is its own normalizer's — see
 * the module header for which inputs are dropped and which are clamped.
 *
 * Bounded on nesting depth as well as on every value — see
 * {@link MAX_BLOCK_DEPTH}.
 */
export function bandBlockNumerics(blocks: Block[]): Block[] {
  return bandBlockList(blocks, 0);
}

/** {@link bandBlockNumerics} at a known nesting depth. */
function bandBlockList(blocks: Block[], depth: number): Block[] {
  if (!Array.isArray(blocks)) return blocks;
  for (const entry of blocks) {
    const block = asRecord(entry);
    if (block) bandOneBlock(block, depth);
  }
  return blocks;
}

/** One block of {@link bandBlockNumerics}, including any table it carries. */
function bandOneBlock(block: Record<string, unknown>, depth: number): void {
  const style = asRecord(block.style);
  if (style) {
    const lineHeight = normalizeLineHeight(asFiniteNumber(style.lineHeight));
    if (lineHeight === undefined) delete style.lineHeight;
    else style.lineHeight = lineHeight;
  }
  if (block.listLevel !== undefined && block.listLevel !== null) {
    block.listLevel = normalizeListLevel(asFiniteNumber(block.listLevel));
  }
  if (Array.isArray(block.inlines)) {
    for (const entry of block.inlines as unknown[]) {
      const inlineStyle = asRecord(asRecord(entry)?.style);
      if (!inlineStyle) continue;
      // A run's font size becomes its line's height; so does an inline
      // image's height (`measureSegments`), which is why the pair is
      // dropped whole rather than clamped — see `isPaintableImageSize`.
      const fontSize = normalizeFontSize(asFiniteNumber(inlineStyle.fontSize));
      if (fontSize === undefined) delete inlineStyle.fontSize;
      else inlineStyle.fontSize = fontSize;
      const image = asRecord(inlineStyle.image);
      if (
        image
        && !isPaintableImageSize(
          asFiniteNumber(image.width) ?? NaN,
          asFiniteNumber(image.height) ?? NaN,
        )
      ) {
        delete inlineStyle.image;
      }
    }
  }
  const table = asRecord(block.tableData);
  if (!table) return;
  if (Array.isArray(table.rowHeights)) {
    table.rowHeights = (table.rowHeights as unknown[]).map((height) =>
      normalizeRowHeight(asFiniteNumber(height)),
    );
  }
  if (Array.isArray(table.columnWidths)) {
    // Capped on count as well as magnitude, and an unusable ratio becomes 0
    // rather than being dropped, so every later column keeps its index —
    // the same rule the v1 slides `PUT` applies to a stored array.
    table.columnWidths = (table.columnWidths as unknown[])
      .slice(0, MAX_TABLE_COLUMNS)
      .map((ratio) => normalizeColumnRatio(asFiniteNumber(ratio)) ?? 0);
  }
  if (!Array.isArray(table.rows)) return;
  for (const rowEntry of table.rows as unknown[]) {
    const cells = asRecord(rowEntry)?.cells;
    if (!Array.isArray(cells)) continue;
    for (const cellEntry of cells as unknown[]) {
      const cell = asRecord(cellEntry);
      if (!cell) continue;
      const cellStyle = asRecord(cell.style);
      if (cellStyle) {
        const padding = normalizeCellPadding(asFiniteNumber(cellStyle.padding));
        if (padding === undefined) delete cellStyle.padding;
        else cellStyle.padding = padding;
      }
      for (const key of ['colSpan', 'rowSpan'] as const) {
        if (cell[key] === undefined || cell[key] === null) continue;
        // An `Infinity` span is the sharpest of these: it becomes the bound
        // of `expandCellRangeForMerges`' fixed-point loop, which then never
        // terminates for anyone who selects cells in the table.
        const span = normalizeTableSpan(asFiniteNumber(cell[key]));
        if (span === undefined) delete cell[key];
        else cell[key] = span;
      }
      // Capped rather than trusted: a nested-table chain a peer wrote is
      // unbounded, and the stack this walk would blow is the reader's whole
      // `read()`. See {@link MAX_BLOCK_DEPTH}.
      if (Array.isArray(cell.blocks) && depth < MAX_BLOCK_DEPTH) {
        bandBlockList(cell.blocks as Block[], depth + 1);
      }
    }
  }
}
