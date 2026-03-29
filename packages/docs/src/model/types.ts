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
}

/**
 * Block type discriminator.
 */
export type BlockType = 'paragraph' | 'title' | 'subtitle' | 'heading' | 'list-item' | 'horizontal-rule' | 'table';

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
}

/**
 * A position within the document: block ID + character offset
 * within the block's concatenated inline text.
 */
export interface DocPosition {
  blockId: string;
  offset: number;
  cellAddress?: CellAddress;
}

/**
 * A range of text spanning from anchor to focus.
 * Can span multiple blocks.
 */
export interface DocRange {
  anchor: DocPosition;
  focus: DocPosition;
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
    inlines: type === 'horizontal-rule' ? [] : [{ text: '', style: {} }],
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
    a.href === b.href
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
  inlines: Inline[];
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
}

export interface CellAddress {
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
    inlines: [{ text: '', style: {} }],
    style: { ...DEFAULT_CELL_STYLE },
  };
}

/**
 * Create a table block with the given dimensions.
 */
export function createTableBlock(rows: number, cols: number): Block {
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
