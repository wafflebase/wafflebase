/**
 * Document data model types.
 *
 * Hierarchy: Document → Block[] → Inline[]
 * Inspired by Google Docs structure, simplified for Canvas rendering.
 */

import type { StoredColor } from './color.js';
import { storedColorsEqual } from './color.js';
import type { DocStyles } from './named-styles.js';

/**
 * Top-level document container.
 */
export interface Document {
  blocks: Block[];
  pageSetup?: PageSetup;
  header?: HeaderFooter;
  footer?: HeaderFooter;
  /**
   * Per-document named-style overrides (Google Docs "Paragraph styles").
   * Absent → all styles resolve to their built-in definitions. See
   * `model/named-styles.ts`.
   */
  styles?: DocStyles;
}

/**
 * Header or footer region containing editable blocks.
 */
export interface HeaderFooter {
  blocks: Block[];
  marginFromEdge: number;
}

/**
 * Block type discriminator.
 */
export type BlockType = 'paragraph' | 'title' | 'subtitle' | 'heading' | 'list-item' | 'horizontal-rule' | 'table' | 'page-break';

/**
 * Heading levels (1–6), matching HTML h1–h6.
 */
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * A block-level element: paragraph, heading, list item, or horizontal rule.
 */
export interface Block {
  id: string;
  type: BlockType;
  inlines: Inline[];
  style: BlockStyle;
  /**
   * Heading level of a `heading` block. A `list-item` also keeps the level of
   * the heading it was made from — bulleting a heading applies the bullet *to*
   * the heading (Google Docs / Word parity), so removing the list restores it
   * (see `unlistedBlockType`). The level is inert while the block is a list
   * item: every reader (export, `blockStyleId`, toolbar labels) gates on
   * `type === 'heading'`.
   */
  headingLevel?: HeadingLevel;
  listKind?: 'ordered' | 'unordered';
  listLevel?: number;
  tableData?: TableData;
  /**
   * Optional marker style overrides for list-item blocks. Set by callers
   * that carry an authored marker font/size/color independent of the
   * paragraph's first inline — e.g. the PPTX importer reading the
   * paragraph-level `<a:buFont>`, `<a:buSzPts>`, `<a:buClr>` properties
   * which PowerPoint applies to the bullet glyph regardless of run font.
   * When omitted, `renderListMarker` falls back to `inlines[0].style`.
   *
   * Persistence: today only the slides path (which stores text-element
   * blocks as plain JSON via `YorkieSlidesStore`) round-trips this
   * field. `YorkieDocStore` (docs collaborative editor) does **not**
   * serialize `marker` through its Yorkie Tree node attributes — there
   * is no docs UX yet that authors marker style, so the gap is latent.
   * Wire it up alongside the first docs feature that needs authored
   * markers (or alongside a DOCX-import round-trip into the docs
   * editor).
   */
  marker?: BlockMarker;
}

/**
 * Optional bullet/number marker style for `list-item` blocks. Each field
 * is independent: a partially-populated marker (e.g. color only) still
 * inherits the other axes from the first inline at render time.
 */
export interface BlockMarker {
  fontFamily?: string;
  /** Marker glyph size in points (not pixels). */
  fontSize?: number;
  color?: StoredColor;
}

/**
 * An inline text run with uniform formatting.
 * When formatting changes mid-text, the inline is split.
 */
export interface Inline {
  text: string;
  style: InlineStyle;
}

/**
 * Block-level (paragraph) formatting.
 */
export interface BlockStyle {
  alignment: 'left' | 'center' | 'right' | 'justify';
  lineHeight: number;
  marginTop: number;
  marginBottom: number;
  textIndent: number;
  marginLeft: number;
}

/**
 * Image metadata for an inline image element.
 * Used when an Inline has text '\uFFFC' (Object Replacement Character).
 *
 * All fields beyond `src/width/height/alt` are optional — older persisted
 * documents that lack them keep working, and absence is treated as
 * "no rotation / no crop / reset-to-displayed-size".
 */
export interface ImageData {
  /** Displayed width in px (post-scale, pre-crop viewport). */
  src: string;
  width: number;
  /** Displayed height in px. */
  height: number;
  alt?: string;

  /** Clockwise rotation in degrees, normalized to [0, 360). Default 0. */
  rotation?: number;
  /** Fraction of natural width hidden on the left edge. 0..1. Default 0. */
  cropLeft?: number;
  /** Fraction of natural width hidden on the right edge. 0..1. Default 0. */
  cropRight?: number;
  /** Fraction of natural height hidden on the top edge. 0..1. Default 0. */
  cropTop?: number;
  /** Fraction of natural height hidden on the bottom edge. 0..1. Default 0. */
  cropBottom?: number;
  /** Intrinsic pixel size of the source image, captured at insert time. */
  originalWidth?: number;
  originalHeight?: number;
}

/**
 * Character-level formatting applied to an Inline.
 * All properties are optional; undefined means "inherit default".
 */
export interface InlineStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /**
   * Underline line variant, meaningful only when `underline` is set.
   * `undefined` renders as a single line (the default). Maps to OOXML
   * `@u` (17 values collapsed to this representative set).
   */
  underlineStyle?: 'single' | 'double' | 'heavy' | 'dotted' | 'dashed' | 'wavy';
  /** Underline color, meaningful only when `underline` is set. OOXML `<a:uFill>`. */
  underlineColor?: StoredColor;
  strikethrough?: boolean;
  /**
   * Strikethrough line variant, meaningful only when `strikethrough` is
   * set. `undefined` renders as a single line (the default). Maps to OOXML
   * `@strike` (`sngStrike` / `dblStrike`).
   */
  strikeStyle?: 'single' | 'double';
  /**
   * Extra spacing between characters, in points (negative = condensed).
   * Maps to OOXML `@spc` (hundredths of a point). Applied additively at
   * measure and paint time; `undefined` = normal spacing.
   */
  letterSpacing?: number;
  fontSize?: number;
  fontFamily?: string;
  /**
   * Either a concrete hex string (legacy / sheets / docs-only callers) or
   * a `StoredColor` object whose role is resolved at paint time by the
   * caller's `ColorResolver`. See `model/color.ts`.
   */
  color?: StoredColor;
  /** See `color` above for the StoredColor rationale. */
  backgroundColor?: StoredColor;
  superscript?: boolean;
  subscript?: boolean;
  href?: string;
  pageNumber?: boolean;
  image?: ImageData;
}

/**
 * A position within the document: block ID + character offset
 * within the block's concatenated inline text.
 *
 * `lineAffinity` disambiguates an offset that sits exactly on a visual
 * wrap boundary, where the same offset is both the end of one line and
 * the start of the next: `'forward'` means the next line, `'backward'`
 * the previous one. It is view-level metadata — model operations use only
 * `blockId` and `offset` — and is optional. An endpoint that carries none is
 * read from the side its range extends towards: a range's start defaults to
 * `'forward'` and its end to `'backward'`, so a highlight covers the wrapped
 * line the two endpoints bracket instead of opening on a zero-width sliver of
 * the line above. A standalone caret still reads `'backward'`.
 */
export interface DocPosition {
  blockId: string;
  offset: number;
  lineAffinity?: 'forward' | 'backward';
}

/**
 * A range of text spanning from anchor to focus.
 * Can span multiple blocks.
 */
export interface TableCellRange {
  blockId: string;
  start: CellAddress;
  end: CellAddress;
}

export interface DocRange {
  anchor: DocPosition;
  focus: DocPosition;
  tableCellRange?: TableCellRange;
}

/**
 * Default block style for new paragraphs.
 */
export const DEFAULT_BLOCK_STYLE: BlockStyle = {
  alignment: 'left',
  lineHeight: 1.5,
  marginTop: 0,
  marginBottom: 8,
  textIndent: 0,
  marginLeft: 0,
};

/**
 * Default inline style.
 */
export const DEFAULT_INLINE_STYLE: InlineStyle = {
  fontSize: 11,
  fontFamily: 'Arial',
  color: '#000000',
};

/**
 * Inline-style override used by Clear formatting actions: every
 * surface-level key set to `undefined` so the inline-style merge in
 * `applyInlineStyle` strips them all in one call. `pageNumber` and
 * `image` are intentionally omitted — they are structural inline kinds,
 * not character formatting.
 */
export const CLEAR_INLINE_STYLE: Partial<InlineStyle> = {
  bold: undefined,
  italic: undefined,
  underline: undefined,
  underlineStyle: undefined,
  underlineColor: undefined,
  strikethrough: undefined,
  strikeStyle: undefined,
  letterSpacing: undefined,
  fontSize: undefined,
  fontFamily: undefined,
  color: undefined,
  backgroundColor: undefined,
  superscript: undefined,
  subscript: undefined,
  href: undefined,
};

/**
 * Inline-style color keys whose "None" / "Reset" picker entry passes an empty
 * string. See `normalizeStyleClears`.
 */
const CLEARABLE_COLOR_KEYS = ['color', 'backgroundColor'] as const;

/**
 * Cell-style color keys with the same "None" / "Reset" convention. See
 * `normalizeCellStyleClears`.
 */
const CLEARABLE_CELL_COLOR_KEYS = ['backgroundColor'] as const;

function clearEmptyStringKeys<T extends object>(
  style: T,
  keys: readonly (keyof T)[],
): T {
  let normalized: T | null = null;
  for (const key of keys) {
    if ((style[key] as unknown) === '') {
      normalized ??= { ...style };
      normalized[key] = undefined as T[keyof T];
    }
  }
  return normalized ?? style;
}

/**
 * Normalize an inline-style patch so an empty-string color means "clear this
 * key", the same way `CLEAR_INLINE_STYLE` and `removeLink` express it: the key
 * present with the value `undefined` (absent would mean "leave it alone").
 *
 * The color pickers' "None" / "Reset" entries pass `''` rather than dropping
 * the key. Merged verbatim, that stores a dead `backgroundColor: ''` on the run:
 * it stops painting (`''` is falsy) but never compares equal to an unset color,
 * so `normalizeInlines` can never merge the run back into its neighbours, and
 * anything treating a present `backgroundColor` as "there is a highlight" —
 * export paths included — still sees one (issue #793).
 */
export function normalizeStyleClears(style: Partial<InlineStyle>): Partial<InlineStyle> {
  return clearEmptyStringKeys(style, CLEARABLE_COLOR_KEYS);
}

/**
 * The table-cell counterpart of `normalizeStyleClears`: the cell-background
 * "Reset" entry passes `backgroundColor: ''`, which the stores must read as
 * "clear this key" so the old color is actually removed from the CRDT node
 * rather than merged over with a dead empty value (issue #793).
 */
export function normalizeCellStyleClears(style: Partial<CellStyle>): Partial<CellStyle> {
  return clearEmptyStringKeys(style, CLEARABLE_CELL_COLOR_KEYS);
}

let counter = 0;

/**
 * Generate a unique block ID.
 */
export function generateBlockId(): string {
  return `block-${Date.now()}-${counter++}`;
}

/**
 * Normalize a block style by filling missing fields with defaults.
 * Guards against older persisted documents that lack newly added fields.
 */
export function normalizeBlockStyle(style: Partial<BlockStyle>): BlockStyle {
  return { ...DEFAULT_BLOCK_STYLE, ...style };
}

/**
 * Create an empty paragraph block.
 */
export function createEmptyBlock(): Block {
  return {
    id: generateBlockId(),
    type: 'paragraph',
    inlines: [{ text: '', style: {} }],
    style: { ...DEFAULT_BLOCK_STYLE },
  };
}

// Named-style defaults live in `model/named-styles.ts` (the redefinable
// Google Docs paragraph-style registry). Use `resolveStyleInline` /
// `resolveStyleBlock` there instead of hardcoded per-type constants.

// --- List constants ---

export const LIST_INDENT_PX = 36;
export const UNORDERED_MARKERS = ['●', '○', '■'];
export const ORDERED_FORMATS = ['decimal', 'lower-alpha', 'lower-roman'] as const;

// --- Block factory ---

/**
 * Create a block of the given type with sensible defaults.
 */
export function createBlock(
  type: BlockType = 'paragraph',
  opts?: { headingLevel?: HeadingLevel; listKind?: 'ordered' | 'unordered'; listLevel?: number },
): Block {
  const block: Block = {
    id: generateBlockId(),
    type,
    inlines: type === 'horizontal-rule' || type === 'table' || type === 'page-break' ? [] : [{ text: '', style: {} }],
    style: { ...DEFAULT_BLOCK_STYLE },
  };
  if (type === 'heading') {
    block.headingLevel = opts?.headingLevel ?? 1;
  }
  if (type === 'list-item') {
    block.listKind = opts?.listKind ?? 'unordered';
    block.listLevel = opts?.listLevel ?? 0;
  }
  return block;
}

/**
 * The block type a list item returns to when its list is removed: the heading
 * it was bulleted from, if any, else a plain paragraph. Keeps the three
 * `toggleList` implementations (docs editor, text editor, text-box editor)
 * from drifting.
 */
export function unlistedBlockType(
  block: Block,
): { type: BlockType; opts?: { headingLevel: HeadingLevel } } {
  if (block.headingLevel !== undefined) {
    return { type: 'heading', opts: { headingLevel: block.headingLevel } };
  }
  return { type: 'paragraph' };
}

/**
 * Get the total text length of a block.
 */
export function getBlockTextLength(block: Block): number {
  return block.inlines.reduce((sum, inline) => sum + inline.text.length, 0);
}

/**
 * Get the concatenated text of a block.
 */
export function getBlockText(block: Block): string {
  return block.inlines.map((inline) => inline.text).join('');
}

/**
 * Scale an image's displayed dimensions down so its width does not
 * exceed `maxWidth`, preserving the original aspect ratio. Returns
 * the input unchanged when the image already fits or when the width
 * is zero/negative (defensive against bogus callers).
 *
 * Used on every `insertImage` call so a 4000px screenshot pasted into
 * an 8.5" page fits within the content area instead of overflowing the
 * right margin. Height gets rounded to the nearest integer pixel and
 * clamped to at least 1 to avoid invisible rows when a very wide +
 * very short source scales down hard.
 */
export function clampImageToWidth(
  width: number,
  height: number,
  maxWidth: number,
): { width: number; height: number } {
  if (width <= maxWidth || width <= 0 || maxWidth <= 0) {
    return { width, height };
  }
  const scale = maxWidth / width;
  return {
    width: maxWidth,
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Return the `ImageData` of the inline whose character offset span
 * contains `offset`, or `null` if that position is not inside an image
 * inline. Image inlines carry exactly one character (ORC = '\uFFFC'),
 * so the caller is expected to pass the image's start offset — this
 * helper tolerates any offset inside the image run for convenience.
 */
export function findImageAtOffset(block: Block, offset: number): ImageData | null {
  let pos = 0;
  for (const inline of block.inlines) {
    const inlineEnd = pos + inline.text.length;
    if (offset >= pos && offset < inlineEnd && inline.style.image) {
      return inline.style.image;
    }
    pos = inlineEnd;
  }
  return null;
}

function imageDataEqual(a: ImageData | undefined, b: ImageData | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.src === b.src &&
    a.width === b.width &&
    a.height === b.height &&
    a.alt === b.alt &&
    a.rotation === b.rotation &&
    a.cropLeft === b.cropLeft &&
    a.cropRight === b.cropRight &&
    a.cropTop === b.cropTop &&
    a.cropBottom === b.cropBottom &&
    a.originalWidth === b.originalWidth &&
    a.originalHeight === b.originalHeight
  );
}

/**
 * Check if two inline styles are equal.
 */
export function inlineStylesEqual(a: InlineStyle, b: InlineStyle): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.underlineStyle === b.underlineStyle &&
    storedColorsEqual(a.underlineColor, b.underlineColor) &&
    a.strikethrough === b.strikethrough &&
    a.strikeStyle === b.strikeStyle &&
    a.letterSpacing === b.letterSpacing &&
    a.fontSize === b.fontSize &&
    a.fontFamily === b.fontFamily &&
    storedColorsEqual(a.color, b.color) &&
    storedColorsEqual(a.backgroundColor, b.backgroundColor) &&
    a.superscript === b.superscript &&
    a.subscript === b.subscript &&
    a.href === b.href &&
    a.pageNumber === b.pageNumber &&
    imageDataEqual(a.image, b.image)
  );
}

/**
 * Whether an inline is a *structural* kind — an image or a page number —
 * rather than styled text.
 *
 * These carry their payload in the style (`style.image`) while their text
 * is a single placeholder character, so one inline describes exactly one
 * object. That makes them unmergeable: concatenating two image inlines
 * gives a two-character run under a single `style.image`, which cannot
 * describe two images — the second is lost while the offsets still count
 * both. Equality is not the test here; two *identical* images (copy an
 * image, then paste it beside itself) must still stay separate runs.
 */
export function isStructuralInline(inline: Inline): boolean {
  return inline.style.image !== undefined || inline.style.pageNumber === true;
}

// --- Table types ---

export interface BorderStyle {
  width: number;
  color: string;
  style: 'solid' | 'none';
}

export const DEFAULT_BORDER_STYLE: BorderStyle = {
  width: 1,
  color: '#000000',
  style: 'solid',
};

export interface CellStyle {
  backgroundColor?: string;
  borderTop?: BorderStyle;
  borderBottom?: BorderStyle;
  borderLeft?: BorderStyle;
  borderRight?: BorderStyle;
  verticalAlign?: 'top' | 'middle' | 'bottom';
  padding?: number;
}

export const DEFAULT_CELL_STYLE: CellStyle = {
  padding: 4,
};

export interface TableCell {
  blocks: Block[];
  style: CellStyle;
  colSpan?: number;
  rowSpan?: number;
}

export interface TableRow {
  cells: TableCell[];
}

export interface TableData {
  rows: TableRow[];
  columnWidths: number[];
  rowHeights?: (number | undefined)[];
}

export interface CellAddress {
  rowIndex: number;
  colIndex: number;
}

/**
 * Reverse lookup: maps a cell-internal block ID to its parent table/cell.
 */
export interface BlockCellInfo {
  tableBlockId: string;
  rowIndex: number;
  colIndex: number;
}

export interface CellRange {
  start: CellAddress;
  end: CellAddress;
}

/**
 * Create an empty table cell with default style.
 */
export function createTableCell(): TableCell {
  return {
    blocks: [{
      id: generateBlockId(),
      type: 'paragraph',
      inlines: [{ text: '', style: {} }],
      style: { ...DEFAULT_BLOCK_STYLE },
    }],
    style: { ...DEFAULT_CELL_STYLE },
  };
}

/**
 * Get the concatenated text content of a table cell.
 */
export function getCellText(cell: TableCell): string {
  return cell.blocks.flatMap(b => b.inlines).map(i => i.text).join('');
}

/**
 * Create a table block with the given dimensions.
 */
export function createTableBlock(rows: number, cols: number): Block {
  if (rows < 1 || cols < 1) {
    throw new Error('Table must have at least 1 row and 1 column');
  }
  const columnWidths = Array(cols).fill(1 / cols);
  const tableRows: TableRow[] = [];
  for (let r = 0; r < rows; r++) {
    const cells: TableCell[] = [];
    for (let c = 0; c < cols; c++) {
      cells.push(createTableCell());
    }
    tableRows.push({ cells });
  }
  return {
    id: generateBlockId(),
    type: 'table',
    inlines: [],
    style: { ...DEFAULT_BLOCK_STYLE },
    tableData: { rows: tableRows, columnWidths },
  };
}

/**
 * Repair a table's merge invariant in place. The layout
 * (`view/table-layout.ts`) trusts that:
 *  - an anchor (`colSpan`/`rowSpan` > 1) stays within the grid and has every
 *    cell it covers marked `colSpan: 0`;
 *  - a covered cell (`colSpan: 0`) is reachable from such an anchor.
 *
 * Table cell paste copies merge metadata verbatim, so a pasted block can
 * carry an anchor whose span overruns the grid, or a covered marker whose
 * anchor was left behind. This walks the grid in row-major order and repairs
 * both: anchors are clamped to the bounds and re-mark their covered cells;
 * orphaned covered markers are restored to normal cells; on overlap the first
 * anchor in row-major order wins.
 */
export function normalizeTableMerges(td: TableData): void {
  const numRows = td.rows.length;
  if (numRows === 0) return;
  const numCols = td.rows[0].cells.length;

  // coverage[r][c] — true once an accepted anchor claims this cell.
  const coverage: boolean[][] = Array.from({ length: numRows }, () =>
    new Array<boolean>(numCols).fill(false),
  );

  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      const cell = td.rows[r].cells[c];
      if (!cell) continue;

      if (coverage[r][c]) {
        // Claimed by an earlier anchor — force it covered and drop any span
        // it carried (this is how overlapping anchors are resolved).
        cell.colSpan = 0;
        cell.rowSpan = undefined;
        continue;
      }

      const cs = cell.colSpan ?? 1;
      const rs = cell.rowSpan ?? 1;
      if (cs <= 1 && rs <= 1) {
        // Normal cell, or an orphaned `colSpan: 0` marker with no anchor —
        // either way it owns its single cell, so clear any span markers.
        cell.colSpan = undefined;
        cell.rowSpan = undefined;
        continue;
      }

      // Anchor: clamp the span to the grid, then claim its covered cells.
      const clampedCols = Math.min(cs, numCols - c);
      const clampedRows = Math.min(rs, numRows - r);
      cell.colSpan = clampedCols > 1 ? clampedCols : undefined;
      cell.rowSpan = clampedRows > 1 ? clampedRows : undefined;
      for (let dr = 0; dr < clampedRows; dr++) {
        for (let dc = 0; dc < clampedCols; dc++) {
          if (dr === 0 && dc === 0) continue;
          coverage[r + dr][c + dc] = true;
        }
      }
    }
  }
}

// --- Search ---

export interface SearchOptions {
  caseSensitive?: boolean;
  useRegex?: boolean;
}

export interface SearchMatch {
  blockId: string;
  startOffset: number;
  endOffset: number;
  cellAddress?: CellAddress;
  cellBlockIndex?: number;
}

// --- Page Setup ---

export interface PageMargins {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface PaperSize {
  name: string;
  width: number;
  height: number;
}

export interface PageSetup {
  paperSize: PaperSize;
  orientation: 'portrait' | 'landscape';
  margins: PageMargins;
}

export const PAPER_SIZES = {
  LETTER: { name: 'Letter', width: 816, height: 1056 } as PaperSize,
  A4: { name: 'A4', width: 794, height: 1123 } as PaperSize,
  LEGAL: { name: 'Legal', width: 816, height: 1344 } as PaperSize,
} as const;

export const DEFAULT_HEADER_MARGIN_FROM_EDGE = 48;

export const DEFAULT_PAGE_SETUP: PageSetup = {
  paperSize: PAPER_SIZES.LETTER,
  orientation: 'portrait',
  margins: { top: 96, bottom: 96, left: 96, right: 96 },
};

/**
 * Smallest content box `resolvePageSetup` will leave standing. One pixel is
 * enough for `paginateLayout` to make progress; the value only matters when
 * the stored margins were already unusable.
 */
const MIN_CONTENT_PX = 1;

/** A stored dimension we are willing to lay out with, or the default. */
function usableSize(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

/** A stored margin we are willing to lay out with, or the default. */
function usableMargin(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

/**
 * Shrink a margin pair proportionally until it leaves a usable content box.
 * Proportional rather than reset-to-default so a document whose margins are
 * merely too large for its page keeps the ratio its author chose.
 */
function fitMargins(
  near: number,
  far: number,
  extent: number,
): [number, number] {
  const total = near + far;
  if (total <= extent - MIN_CONTENT_PX) return [near, far];
  // A page narrower than `MIN_CONTENT_PX` cannot satisfy the floor at all, and
  // scaling a zero pair would divide by zero (`0 * -Infinity` is `NaN`, which
  // is exactly the value this function exists to keep out). Zero margins give
  // the whole page to content, which is the most room there is.
  if (total === 0) return [0, 0];
  const scale = Math.max(0, (extent - MIN_CONTENT_PX) / total);
  return [near * scale, far * scale];
}

/**
 * Resolve a stored page setup into one every layout pass can consume.
 *
 * This is the single read path — the editor, the ruler, `MemDocStore`,
 * `YorkieDocStore`, the CLI's pagination and PDF export all reach the page
 * setup through it — and it is the only place that sees geometry we did not
 * validate ourselves. `EditorAPI.setPageSetup` refuses unusable geometry at
 * the write it owns, but two paths never touch that write: a `.docx` import
 * stores its parsed geometry through `setDocument`, and a collaborator's
 * CRDT write lands in `document.pageSetup` with no local check at all.
 *
 * Clamping (rather than throwing) is the honest answer for data we do not
 * control: a remote peer must not be able to make this replica's document
 * un-openable, and there is no caller here to report an error to. The
 * deliberate write path still throws, so a caller that *can* be told it
 * passed nonsense still is.
 */
export function resolvePageSetup(setup: PageSetup | undefined): PageSetup {
  const resolved = setup ?? DEFAULT_PAGE_SETUP;
  const storedPaper = resolved.paperSize ?? DEFAULT_PAGE_SETUP.paperSize;
  const storedMargins = resolved.margins ?? DEFAULT_PAGE_SETUP.margins;

  const paperSize: PaperSize = {
    name: storedPaper.name ?? DEFAULT_PAGE_SETUP.paperSize.name,
    width: usableSize(storedPaper.width, DEFAULT_PAGE_SETUP.paperSize.width),
    height: usableSize(storedPaper.height, DEFAULT_PAGE_SETUP.paperSize.height),
  };
  const orientation =
    resolved.orientation === 'landscape' ? 'landscape' : 'portrait';

  // Measured against the *effective* box so the fit follows the orientation
  // rather than the stored paper dimensions.
  const width = orientation === 'landscape' ? paperSize.height : paperSize.width;
  const height =
    orientation === 'landscape' ? paperSize.width : paperSize.height;

  const [left, right] = fitMargins(
    usableMargin(storedMargins.left, DEFAULT_PAGE_SETUP.margins.left),
    usableMargin(storedMargins.right, DEFAULT_PAGE_SETUP.margins.right),
    width,
  );
  const [top, bottom] = fitMargins(
    usableMargin(storedMargins.top, DEFAULT_PAGE_SETUP.margins.top),
    usableMargin(storedMargins.bottom, DEFAULT_PAGE_SETUP.margins.bottom),
    height,
  );

  return { paperSize, orientation, margins: { top, bottom, left, right } };
}

export function getEffectiveDimensions(setup: PageSetup): { width: number; height: number } {
  const { width, height } = setup.paperSize;
  return setup.orientation === 'landscape'
    ? { width: height, height: width }
    : { width, height };
}
