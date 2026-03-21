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
}

/**
 * A block-level element (currently only paragraphs).
 * The discriminated union allows future extension to tables, lists, etc.
 */
export interface Block {
  id: string;
  type: 'paragraph';
  inlines: Inline[];
  style: BlockStyle;
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
  alignment: 'left' | 'center' | 'right';
  lineHeight: number;
  marginTop: number;
  marginBottom: number;
}

/**
 * Character-level formatting applied to an Inline.
 * All properties are optional; undefined means "inherit default".
 */
export interface InlineStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
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
};

/**
 * Default inline style.
 */
export const DEFAULT_INLINE_STYLE: InlineStyle = {
  fontSize: 16,
  fontFamily: 'sans-serif',
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
    a.fontSize === b.fontSize &&
    a.fontFamily === b.fontFamily &&
    a.color === b.color
  );
}
