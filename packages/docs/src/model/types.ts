/**
 * Document data model types.
 *
 * Hierarchy: Document → Block[] → Inline[]
 * Inspired by Google Docs structure, simplified for Canvas rendering.
 */

/**
 * Top-level document container.
 */
export interface Document {
  blocks: Block[];
  pageSetup?: PageSetup;
  header?: HeaderFooter;
  footer?: HeaderFooter;
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
  headingLevel?: HeadingLevel;
  listKind?: 'ordered' | 'unordered';
  listLevel?: number;
  tableData?: TableData;
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
  strikethrough?: boolean;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  backgroundColor?: string;
  superscript?: boolean;
  subscript?: boolean;
  href?: string;
  pageNumber?: boolean;
  image?: ImageData;
}

/**
 * A position within the document: block ID + character offset
 * within the block's concatenated inline text.
 */
export interface DocPosition {
  blockId: string;
  offset: number;
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

// --- Heading defaults ---

const HEADING_DEFAULTS: Record<HeadingLevel, Partial<InlineStyle>> = {
  1: { fontSize: 24, bold: true },
  2: { fontSize: 20, bold: true },
  3: { fontSize: 16, bold: true },
  4: { fontSize: 14, bold: true },
  5: { fontSize: 12 },
  6: { fontSize: 11 },
};

export function getHeadingDefaults(level: HeadingLevel): Partial<InlineStyle> {
  return { ...HEADING_DEFAULTS[level] };
}

// --- Title / Subtitle defaults ---

export const TITLE_DEFAULTS: Partial<InlineStyle> = { fontSize: 26 };
export const SUBTITLE_DEFAULTS: Partial<InlineStyle> = { fontSize: 15, color: '#666666' };

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
  if (width <= maxWidth || width <= 0) {
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
    a.strikethrough === b.strikethrough &&
    a.fontSize === b.fontSize &&
    a.fontFamily === b.fontFamily &&
    a.color === b.color &&
    a.backgroundColor === b.backgroundColor &&
    a.superscript === b.superscript &&
    a.subscript === b.subscript &&
    a.href === b.href &&
    a.pageNumber === b.pageNumber &&
    imageDataEqual(a.image, b.image)
  );
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

export function resolvePageSetup(setup: PageSetup | undefined): PageSetup {
  const resolved = setup ?? DEFAULT_PAGE_SETUP;
  return {
    paperSize: { ...resolved.paperSize },
    orientation: resolved.orientation,
    margins: { ...resolved.margins },
  };
}

export function getEffectiveDimensions(setup: PageSetup): { width: number; height: number } {
  const { width, height } = setup.paperSize;
  return setup.orientation === 'landscape'
    ? { width: height, height: width }
    : { width, height };
}
