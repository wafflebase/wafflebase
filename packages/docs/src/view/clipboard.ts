import type {
  Block, BlockMarker, BlockStyle, BlockType, BorderStyle, ImageData, Inline, InlineStyle,
  HeadingLevel, TableCell, TableData, CellStyle,
} from '../model/types.js';
import type { StoredColor } from '../model/color.js';
import {
  generateBlockId, DEFAULT_BLOCK_STYLE, DEFAULT_BORDER_STYLE, DEFAULT_CELL_STYLE,
  inlineStylesEqual, createTableBlock, normalizeTableMerges,
} from '../model/types.js';

interface ClipboardPayload {
  version: 1;
  blocks: Block[];
  tableCells?: TableCell[][];
}

export function serializeBlocks(blocks: Block[]): string {
  const payload: ClipboardPayload = { version: 1, blocks };
  return JSON.stringify(payload);
}

export function deserializeBlocks(json: string): Block[] {
  try {
    const payload: unknown = JSON.parse(json);
    if (!isRecord(payload) || payload.version !== 1) return [];
    return sanitizeBlocks(payload.blocks);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Internal-clipboard payload validation
// ---------------------------------------------------------------------------
//
// The `WAFFLEDOCS_MIME` flavour is JSON that *any* page can put on the system
// clipboard from its own `copy` handler, and `handlePaste` prefers it over
// text/html and text/plain. So the parsed payload is untrusted input, not our
// own model: casting it to `Block[]` would let a hostile page write arbitrary
// values (a non-numeric `headingLevel`, an unknown block `type`, junk keys)
// straight into the shared Yorkie tree, the renderer, and the DOCX/PDF
// exporters. Everything below rebuilds the model from scratch instead —
// known keys only, each value shape-checked, anything else dropped.

const BLOCK_TYPES = [
  'paragraph', 'title', 'subtitle', 'heading', 'list-item',
  'horizontal-rule', 'table', 'page-break',
] as const;
const ALIGNMENTS = ['left', 'center', 'right', 'justify'] as const;
const LIST_KINDS = ['ordered', 'unordered'] as const;
const UNDERLINE_STYLES = ['single', 'double', 'heavy', 'dotted', 'dashed', 'wavy'] as const;
const STRIKE_STYLES = ['single', 'double'] as const;
const VERTICAL_ALIGNS = ['top', 'middle', 'bottom'] as const;
const BORDER_KINDS = ['solid', 'none'] as const;

/** Matches the editors' indent ceiling; keeps a payload from inventing a level. */
const MAX_LIST_LEVEL = 8;
/** Nested tables are legal but a payload could nest them without bound. */
const MAX_TABLE_DEPTH = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asOneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/** Only the six levels `HeadingLevel` declares — everything else is dropped. */
function asHeadingLevel(value: unknown): HeadingLevel | undefined {
  const n = asNumber(value);
  if (n === undefined || !Number.isInteger(n) || n < 1 || n > 6) return undefined;
  return n as HeadingLevel;
}

function asStoredColor(value: unknown): StoredColor | undefined {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return undefined;
  if (value.kind === 'srgb') {
    const hex = asString(value.value);
    return hex === undefined ? undefined : { kind: 'srgb', value: hex };
  }
  if (value.kind === 'role') {
    const role = asString(value.role);
    if (role === undefined) return undefined;
    const color: StoredColor = { kind: 'role', role };
    const tint = asNumber(value.tint);
    if (tint !== undefined) color.tint = tint;
    const shade = asNumber(value.shade);
    if (shade !== undefined) color.shade = shade;
    return color;
  }
  return undefined;
}

function sanitizeImageData(value: unknown): ImageData | undefined {
  if (!isRecord(value)) return undefined;
  const src = asString(value.src);
  const width = asNumber(value.width);
  const height = asNumber(value.height);
  if (src === undefined || width === undefined || height === undefined) return undefined;
  const image: ImageData = { src, width, height };
  const alt = asString(value.alt);
  if (alt !== undefined) image.alt = alt;
  const numericKeys = [
    'rotation', 'cropLeft', 'cropRight', 'cropTop', 'cropBottom',
    'originalWidth', 'originalHeight',
  ] as const;
  for (const key of numericKeys) {
    const n = asNumber(value[key]);
    if (n !== undefined) image[key] = n;
  }
  return image;
}

function sanitizeInlineStyle(value: unknown): InlineStyle {
  const style: InlineStyle = {};
  if (!isRecord(value)) return style;

  const booleanKeys = [
    'bold', 'italic', 'underline', 'strikethrough', 'superscript', 'subscript', 'pageNumber',
  ] as const;
  for (const key of booleanKeys) {
    const flag = asBoolean(value[key]);
    if (flag !== undefined) style[key] = flag;
  }
  const numericKeys = ['letterSpacing', 'fontSize'] as const;
  for (const key of numericKeys) {
    const n = asNumber(value[key]);
    if (n !== undefined) style[key] = n;
  }
  const fontFamily = asString(value.fontFamily);
  if (fontFamily !== undefined) style.fontFamily = fontFamily;
  const href = asString(value.href);
  if (href !== undefined) style.href = href;
  const underlineStyle = asOneOf(value.underlineStyle, UNDERLINE_STYLES);
  if (underlineStyle !== undefined) style.underlineStyle = underlineStyle;
  const strikeStyle = asOneOf(value.strikeStyle, STRIKE_STYLES);
  if (strikeStyle !== undefined) style.strikeStyle = strikeStyle;
  const color = asStoredColor(value.color);
  if (color !== undefined) style.color = color;
  const backgroundColor = asStoredColor(value.backgroundColor);
  if (backgroundColor !== undefined) style.backgroundColor = backgroundColor;
  const underlineColor = asStoredColor(value.underlineColor);
  if (underlineColor !== undefined) style.underlineColor = underlineColor;
  const image = sanitizeImageData(value.image);
  if (image !== undefined) style.image = image;

  return style;
}

function sanitizeInlines(value: unknown): Inline[] {
  if (!Array.isArray(value)) return [{ text: '', style: {} }];
  const inlines: Inline[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const text = asString(raw.text);
    if (text === undefined) continue;
    inlines.push({ text, style: sanitizeInlineStyle(raw.style) });
  }
  return inlines.length > 0 ? inlines : [{ text: '', style: {} }];
}

function sanitizeBlockStyle(value: unknown): BlockStyle {
  const style: BlockStyle = { ...DEFAULT_BLOCK_STYLE };
  if (!isRecord(value)) return style;
  const alignment = asOneOf(value.alignment, ALIGNMENTS);
  if (alignment !== undefined) style.alignment = alignment;
  const numericKeys = [
    'lineHeight', 'marginTop', 'marginBottom', 'textIndent', 'marginLeft',
  ] as const;
  for (const key of numericKeys) {
    const n = asNumber(value[key]);
    if (n !== undefined) style[key] = n;
  }
  return style;
}

function sanitizeMarker(value: unknown): BlockMarker | undefined {
  if (!isRecord(value)) return undefined;
  const marker: BlockMarker = {};
  const fontFamily = asString(value.fontFamily);
  if (fontFamily !== undefined) marker.fontFamily = fontFamily;
  const fontSize = asNumber(value.fontSize);
  if (fontSize !== undefined) marker.fontSize = fontSize;
  const color = asStoredColor(value.color);
  if (color !== undefined) marker.color = color;
  return Object.keys(marker).length > 0 ? marker : undefined;
}

function sanitizeBorder(value: unknown): BorderStyle | undefined {
  if (!isRecord(value)) return undefined;
  return {
    width: asNumber(value.width) ?? DEFAULT_BORDER_STYLE.width,
    color: asString(value.color) ?? DEFAULT_BORDER_STYLE.color,
    style: asOneOf(value.style, BORDER_KINDS) ?? DEFAULT_BORDER_STYLE.style,
  };
}

function sanitizeCellStyle(value: unknown): CellStyle {
  const style: CellStyle = { ...DEFAULT_CELL_STYLE };
  if (!isRecord(value)) return style;
  const backgroundColor = asString(value.backgroundColor);
  if (backgroundColor !== undefined) style.backgroundColor = backgroundColor;
  const verticalAlign = asOneOf(value.verticalAlign, VERTICAL_ALIGNS);
  if (verticalAlign !== undefined) style.verticalAlign = verticalAlign;
  const padding = asNumber(value.padding);
  if (padding !== undefined) style.padding = padding;
  const borderKeys = ['borderTop', 'borderBottom', 'borderLeft', 'borderRight'] as const;
  for (const key of borderKeys) {
    const border = sanitizeBorder(value[key]);
    if (border !== undefined) style[key] = border;
  }
  return style;
}

function sanitizeCell(value: unknown, depth: number): TableCell {
  const record = isRecord(value) ? value : {};
  const cell: TableCell = {
    blocks: sanitizeBlocks(record.blocks, depth),
    style: sanitizeCellStyle(record.style),
  };
  if (cell.blocks.length === 0) cell.blocks = [sanitizeBlock({}, depth)!];
  const colSpan = asNumber(record.colSpan);
  if (colSpan !== undefined && colSpan > 1) cell.colSpan = Math.trunc(colSpan);
  const rowSpan = asNumber(record.rowSpan);
  if (rowSpan !== undefined && rowSpan > 1) cell.rowSpan = Math.trunc(rowSpan);
  return cell;
}

function sanitizeCellRows(value: unknown, depth: number): TableCell[][] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows: TableCell[][] = [];
  for (const rawRow of value) {
    if (!Array.isArray(rawRow)) continue;
    rows.push(rawRow.map((cell) => sanitizeCell(cell, depth)));
  }
  return rows.length > 0 ? rows : undefined;
}

function sanitizeTableData(value: unknown, depth: number): TableData | undefined {
  if (!isRecord(value) || depth >= MAX_TABLE_DEPTH) return undefined;
  const rawRows = Array.isArray(value.rows) ? value.rows : undefined;
  if (!rawRows) return undefined;
  const rows = [];
  // Track which entry of `rawRows` each kept row came from, so a dropped row
  // does not shift every later `rowHeights` entry onto the wrong row.
  const sourceIndices: number[] = [];
  for (let i = 0; i < rawRows.length; i++) {
    const rawRow: unknown = rawRows[i];
    if (!isRecord(rawRow) || !Array.isArray(rawRow.cells)) continue;
    rows.push({ cells: rawRow.cells.map((cell) => sanitizeCell(cell, depth + 1)) });
    sourceIndices.push(i);
  }
  if (rows.length === 0) return undefined;
  const cols = Math.max(...rows.map((r) => r.cells.length));
  // The layout and `normalizeTableMerges` both index the grid as a rectangle;
  // a short row from a truncated payload would otherwise leave holes.
  for (const row of rows) {
    while (row.cells.length < cols) row.cells.push(sanitizeCell({}, depth + 1));
  }
  const rawWidths = Array.isArray(value.columnWidths) ? value.columnWidths : [];
  const columnWidths: number[] = [];
  // `columnWidths` are fractions of the table width, not pixels — `createTableBlock`
  // fills `1 / cols` and the layout multiplies by the content width. A missing
  // entry defaults to an even share, not to 100 content-widths.
  for (let c = 0; c < cols; c++) columnWidths.push(asNumber(rawWidths[c]) ?? 1 / cols);
  const table: TableData = { rows, columnWidths };
  if (Array.isArray(value.rowHeights)) {
    const rawHeights = value.rowHeights as unknown[];
    table.rowHeights = sourceIndices.map((i) => asNumber(rawHeights[i]));
  }
  // Restore the `colSpan: 0` covered-cell markers from the surviving anchors.
  // `sanitizeCell` keeps only spans `> 1`, and the whole-table paste path
  // (`insertBlocks`) never normalizes, so without this a copied merged table
  // comes apart on paste — `computeTableLayout` skips a cell only on
  // `colSpan === 0`. Regenerating beats trusting the payload's own markers:
  // this also clamps out-of-grid spans and resolves overlapping anchors.
  normalizeTableMerges(table);
  return table;
}

/**
 * Rebuild one block from untrusted JSON. Returns null only for a `table`
 * block whose `tableData` cannot be recovered — the renderer requires it.
 */
function sanitizeBlock(value: unknown, depth: number): Block | null {
  const record = isRecord(value) ? value : {};
  const type = asOneOf(record.type, BLOCK_TYPES) ?? 'paragraph';
  // Ids are regenerated rather than trusted: a payload could otherwise collide
  // with a live block id, and every paste path already reassigns them.
  const block: Block = {
    id: generateBlockId(),
    type,
    inlines: sanitizeInlines(record.inlines),
    style: sanitizeBlockStyle(record.style),
  };

  if (type === 'table') {
    const tableData = sanitizeTableData(record.tableData, depth);
    if (!tableData) return null;
    block.tableData = tableData;
    block.inlines = [];
    return block;
  }
  if (type === 'horizontal-rule' || type === 'page-break') {
    block.inlines = [];
    return block;
  }

  // `headingLevel` is a real heading's level or the level a bulleted heading
  // remembers (see `Block.headingLevel`); on any other type it is meaningless.
  if (type === 'heading') {
    block.headingLevel = asHeadingLevel(record.headingLevel) ?? 1;
  } else if (type === 'list-item') {
    const remembered = asHeadingLevel(record.headingLevel);
    if (remembered !== undefined) block.headingLevel = remembered;
  }
  if (type === 'list-item') {
    block.listKind = asOneOf(record.listKind, LIST_KINDS) ?? 'unordered';
    const level = asNumber(record.listLevel);
    block.listLevel = level === undefined
      ? 0
      : Math.min(MAX_LIST_LEVEL, Math.max(0, Math.trunc(level)));
    const marker = sanitizeMarker(record.marker);
    if (marker !== undefined) block.marker = marker;
  }
  return block;
}

function sanitizeBlocks(value: unknown, depth = 0): Block[] {
  if (!Array.isArray(value)) return [];
  const blocks: Block[] = [];
  for (const raw of value) {
    const block = sanitizeBlock(raw, depth);
    if (block) blocks.push(block);
  }
  return blocks;
}

export interface ClipboardData {
  blocks: Block[];
  tableCells?: TableCell[][];
}

export function serializeClipboard(data: ClipboardData): string {
  const payload: ClipboardPayload = { version: 1, blocks: data.blocks };
  if (data.tableCells) {
    payload.tableCells = data.tableCells;
  }
  return JSON.stringify(payload);
}

export function deserializeClipboard(json: string): ClipboardData {
  try {
    const payload: unknown = JSON.parse(json);
    if (!isRecord(payload) || payload.version !== 1) return { blocks: [] };
    // Both halves go through the same validation as `deserializeBlocks` —
    // this payload is attacker-reachable (see the section below).
    return {
      blocks: sanitizeBlocks(payload.blocks),
      tableCells: sanitizeCellRows(payload.tableCells, 0),
    };
  } catch {
    return { blocks: [] };
  }
}

export function cloneTableCells(cells: TableCell[][]): TableCell[][] {
  return cells.map(row =>
    row.map(cell => ({
      style: { ...cell.style },
      ...(cell.colSpan != null ? { colSpan: cell.colSpan } : {}),
      ...(cell.rowSpan != null ? { rowSpan: cell.rowSpan } : {}),
      blocks: cell.blocks.map(b => ({
        ...b,
        id: generateBlockId(),
        inlines: b.inlines.map(il => ({ text: il.text, style: { ...il.style } })),
        style: { ...b.style },
      })),
    }))
  );
}

export const WAFFLEDOCS_MIME = 'application/x-waffledocs';

/**
 * Style-related HTML tag names (lowercased) and their InlineStyle mappings.
 */
const TAG_STYLE_MAP: Record<string, Partial<InlineStyle>> = {
  b: { bold: true },
  strong: { bold: true },
  i: { italic: true },
  em: { italic: true },
  u: { underline: true },
  s: { strikethrough: true },
  del: { strikethrough: true },
  strike: { strikethrough: true },
};

/** Heading tag → HeadingLevel mapping. */
const HEADING_MAP: Record<string, HeadingLevel> = {
  h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6,
};

/** Block-level HTML tags that introduce paragraph breaks. */
const BLOCK_TAGS = new Set([
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'li', 'blockquote', 'pre', 'section', 'article',
  'header', 'footer', 'tr',
]);

interface BlockMeta {
  type: BlockType;
  headingLevel?: HeadingLevel;
  listKind?: 'ordered' | 'unordered';
}

function makeBlock(inlines: Inline[], meta?: BlockMeta): Block {
  const merged = mergeInlines(inlines);
  return {
    id: generateBlockId(),
    type: meta?.type ?? 'paragraph',
    inlines: merged.length > 0 ? merged : [{ text: '', style: {} }],
    style: { ...DEFAULT_BLOCK_STYLE },
    ...(meta?.headingLevel != null ? { headingLevel: meta.headingLevel } : {}),
    ...(meta?.listKind != null ? { listKind: meta.listKind } : {}),
  };
}

function mergeInlines(inlines: Inline[]): Inline[] {
  const merged: Inline[] = [];
  for (const inline of inlines) {
    if (merged.length > 0 && inlineStylesEqual(merged[merged.length - 1].style, inline.style)) {
      merged[merged.length - 1].text += inline.text;
    } else {
      merged.push(inline);
    }
  }
  return merged;
}

/**
 * Resolve block metadata from an HTML tag name.
 */
function resolveBlockMeta(el: Element): BlockMeta | undefined {
  const tag = el.tagName.toLowerCase();
  if (tag in HEADING_MAP) {
    return { type: 'heading', headingLevel: HEADING_MAP[tag] };
  }
  if (tag === 'li') {
    const parent = el.parentElement;
    const parentTag = parent?.tagName.toLowerCase();
    return {
      type: 'list-item',
      listKind: parentTag === 'ol' ? 'ordered' : 'unordered',
    };
  }
  return undefined;
}

/**
 * Resolve inline style overrides from an HTML element's CSS.
 */
function resolveInlineCSS(el: Element, style: InlineStyle): void {
  if (!(el instanceof HTMLElement) || !el.style) return;

  if (el.style.color) {
    style.color = el.style.color;
  }
  if (el.style.backgroundColor) {
    style.backgroundColor = el.style.backgroundColor;
  }
  if (el.style.fontSize) {
    const match = el.style.fontSize.match(/^(\d+(?:\.\d+)?)(px|pt)$/);
    if (match) {
      const value = parseFloat(match[1]);
      style.fontSize = match[2] === 'px' ? (value * 72) / 96 : value;
    }
  }
  if (el.style.fontWeight === 'bold' || parseInt(el.style.fontWeight) >= 700) {
    style.bold = true;
  }
  if (el.style.fontStyle === 'italic') {
    style.italic = true;
  }
  if (el.style.textDecoration?.includes('underline')) {
    style.underline = true;
  }
  if (el.style.textDecoration?.includes('line-through')) {
    style.strikethrough = true;
  }
}

/**
 * Check whether an element has any child element that is a block-level tag.
 * Used to distinguish insignificant whitespace (between block siblings)
 * from meaningful whitespace (between inline siblings like `<b>` and `<i>`).
 */
function parentHasBlockChild(parent: Element | null): boolean {
  if (!parent) return false;
  for (const child of Array.from(parent.children)) {
    if (BLOCK_TAGS.has(child.tagName.toLowerCase())) return true;
  }
  return false;
}

/**
 * Parse an HTML string into an array of Block objects, preserving both
 * inline formatting and block-level semantics (headings, list items, etc.).
 */
export function parseHtmlToBlocks(html: string): Block[] {
  if (!html) return [];

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const blocks: Block[] = [];
  let currentInlines: Inline[] = [];
  let currentMeta: BlockMeta | undefined;

  function flushBlock(): void {
    if (currentInlines.length > 0) {
      blocks.push(makeBlock(currentInlines, currentMeta));
      currentInlines = [];
      currentMeta = undefined;
    }
  }

  function walk(node: Node, inherited: InlineStyle): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      if (text.length > 0) {
        // Skip whitespace-only text nodes between block-level elements
        // (e.g. "\n" between <li> tags inside <ul>). These are insignificant
        // in HTML but would otherwise produce empty paragraph blocks.
        if (/^\s+$/.test(text) && parentHasBlockChild(node.parentElement)) {
          return;
        }
        currentInlines.push({ text, style: { ...inherited } });
      }
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as Element;
    const tag = el.tagName.toLowerCase();

    // <br> → emit a newline within the current block
    if (tag === 'br') {
      flushBlock();
      return;
    }

    // Skip list containers (ul/ol) — only process their <li> children
    if (tag === 'ul' || tag === 'ol') {
      for (const child of Array.from(node.childNodes)) {
        walk(child, inherited);
      }
      return;
    }

    // <table> → flush current content, then emit a table block
    if (tag === 'table') {
      flushBlock();
      const tableBlock = parseHtmlTableElement(el);
      if (tableBlock) {
        blocks.push(tableBlock);
      }
      return;
    }

    const style: InlineStyle = { ...inherited };

    // Apply tag-based styles
    const tagStyle = TAG_STYLE_MAP[tag];
    if (tagStyle) {
      Object.assign(style, tagStyle);
    }

    // Handle <a> href
    if (tag === 'a') {
      const href = el.getAttribute('href');
      if (href) {
        style.href = href;
      }
    }

    // Parse inline CSS styles
    resolveInlineCSS(el, style);

    const isBlock = BLOCK_TAGS.has(tag);

    if (isBlock) {
      // Flush any accumulated inline content as a paragraph
      flushBlock();

      // Set block metadata for this block-level element
      currentMeta = resolveBlockMeta(el);

      for (const child of Array.from(node.childNodes)) {
        walk(child, style);
      }

      // Flush the block element's content
      flushBlock();
    } else {
      for (const child of Array.from(node.childNodes)) {
        walk(child, style);
      }
    }
  }

  walk(doc.body, {});

  // Flush any remaining inline content
  if (currentInlines.length > 0) {
    blocks.push(makeBlock(currentInlines, currentMeta));
  }

  // insertBlocks merges the first and last blocks with surrounding text.
  // Table blocks cannot be merged, so pad with empty paragraphs if needed.
  if (blocks.length > 0 && blocks[0].type === 'table') {
    blocks.unshift(makeBlock([]));
  }
  if (blocks.length > 0 && blocks[blocks.length - 1].type === 'table') {
    blocks.push(makeBlock([]));
  }

  return blocks;
}

/**
 * Parse an HTML string into a flat array of Inline objects.
 * @deprecated Use parseHtmlToBlocks for block-aware parsing.
 */
export function parseHtmlToInlines(html: string): Inline[] {
  const blocks = parseHtmlToBlocks(html);
  return blocks.flatMap((b) => b.inlines);
}

// ---------------------------------------------------------------------------
// Inline extraction helper (reused by table parsers)
// ---------------------------------------------------------------------------

/**
 * Walk an HTML element's children and collect formatted Inline runs.
 * Reuses the same tag/CSS resolution logic as parseHtmlToBlocks.
 */
function collectInlines(root: Node, inherited: InlineStyle): Inline[] {
  const inlines: Inline[] = [];

  function walk(node: Node, style: InlineStyle): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      if (text.length > 0) {
        inlines.push({ text, style: { ...style } });
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as Element;
    const tag = el.tagName.toLowerCase();

    // Skip table structural tags — we only want inline content
    if (tag === 'table' || tag === 'thead' || tag === 'tbody' || tag === 'tfoot' || tag === 'tr' || tag === 'td' || tag === 'th') {
      for (const child of Array.from(node.childNodes)) {
        walk(child, style);
      }
      return;
    }

    if (tag === 'br') {
      inlines.push({ text: '\n', style: { ...style } });
      return;
    }

    const childStyle: InlineStyle = { ...style };
    const tagStyle = TAG_STYLE_MAP[tag];
    if (tagStyle) {
      Object.assign(childStyle, tagStyle);
    }
    if (tag === 'a') {
      const href = el.getAttribute('href');
      if (href) {
        childStyle.href = href;
      }
    }
    resolveInlineCSS(el, childStyle);

    for (const child of Array.from(node.childNodes)) {
      walk(child, childStyle);
    }
  }

  walk(root, inherited);
  return mergeInlines(inlines);
}

/**
 * Build a TableCell from an array of Inlines.
 */
function makeCellFromInlines(inlines: Inline[], cellStyle?: Partial<CellStyle>): TableCell {
  const merged = mergeInlines(inlines);
  return {
    blocks: [{
      id: generateBlockId(),
      type: 'paragraph',
      inlines: merged.length > 0 ? merged : [{ text: '', style: {} }],
      style: { ...DEFAULT_BLOCK_STYLE },
    }],
    style: { padding: 4, ...cellStyle },
  };
}

/**
 * Convert a `<table>` DOM element into a table Block.
 * Returns null if the table has no rows.
 */
function parseHtmlTableElement(tableEl: Element): Block | null {
  const rows: TableCell[][] = [];
  const trs = tableEl.querySelectorAll(
    ':scope > tr, :scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr',
  );

  for (const tr of Array.from(trs)) {
    const cells: TableCell[] = [];
    const tds = tr.querySelectorAll(':scope > td, :scope > th');

    for (const td of Array.from(tds)) {
      const inlines = collectInlines(td, {});
      const cellStyle: Partial<CellStyle> = {};
      if (td instanceof HTMLElement && td.style.backgroundColor) {
        cellStyle.backgroundColor = td.style.backgroundColor;
      }
      cells.push(makeCellFromInlines(inlines, cellStyle));
    }

    if (cells.length > 0) {
      rows.push(cells);
    }
  }

  if (rows.length === 0) return null;

  // Pad short rows
  const maxCols = Math.max(...rows.map(r => r.length));
  for (const row of rows) {
    while (row.length < maxCols) {
      row.push(makeCellFromInlines([], {}));
    }
  }

  const block = createTableBlock(rows.length, maxCols);
  const td = block.tableData!;
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      td.rows[r].cells[c] = rows[r][c];
    }
  }
  return block;
}

// ---------------------------------------------------------------------------
// HTML table paste
// ---------------------------------------------------------------------------

/**
 * Parse an HTML string and extract the first `<table>` as TableCell[][].
 * Returns null if the HTML does not contain a table or contains significant
 * non-table content (mixed content falls through to parseHtmlToBlocks).
 */
export function parseHtmlTableToTableCells(html: string): TableCell[][] | null {
  if (!html) return null;

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const table = doc.querySelector('table');
  if (!table) return null;

  // Check for significant non-table content — if there are block-level
  // elements outside the table, fall through to block parsing instead.
  for (const child of Array.from(doc.body.childNodes)) {
    if (child === table) continue;
    if (child.nodeType === Node.ELEMENT_NODE) {
      const tag = (child as Element).tagName.toLowerCase();
      // Allow wrapper elements that just contain the table (e.g. Google Sheets
      // wraps tables in <meta>/<style> tags)
      if (tag !== 'meta' && tag !== 'style' && tag !== 'br' && tag !== 'colgroup') {
        // There's meaningful non-table content — abort
        const text = (child as Element).textContent?.trim() ?? '';
        if (text.length > 0) return null;
      }
    } else if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent?.trim() ?? '';
      if (text.length > 0) return null;
    }
  }

  const rows: TableCell[][] = [];
  const trs = table.querySelectorAll(
    ':scope > tr, :scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr',
  );

  for (const tr of Array.from(trs)) {
    const cells: TableCell[] = [];
    const tds = tr.querySelectorAll(':scope > td, :scope > th');

    for (const td of Array.from(tds)) {
      const inlines = collectInlines(td, {});
      const cellStyle: Partial<CellStyle> = {};
      if (td instanceof HTMLElement && td.style.backgroundColor) {
        cellStyle.backgroundColor = td.style.backgroundColor;
      }
      cells.push(makeCellFromInlines(inlines, cellStyle));
    }

    if (cells.length > 0) {
      rows.push(cells);
    }
  }

  if (rows.length === 0) return null;

  // Pad short rows to the maximum column count
  const maxCols = Math.max(...rows.map(r => r.length));
  for (const row of rows) {
    while (row.length < maxCols) {
      row.push(makeCellFromInlines([], {}));
    }
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Markdown table paste
// ---------------------------------------------------------------------------

/** Match a markdown table separator line: `| --- | :---: | ---: |` etc. */
const MD_SEPARATOR_RE = /^\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

/**
 * Parse a single row of pipe-delimited cells into trimmed strings.
 */
function parseMdRow(line: string): string[] {
  let trimmed = line;
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
  return trimmed.split('|').map(cell => cell.trim());
}

/**
 * Convert parsed cell strings into a padded TableCell[][] and wrap in a
 * table Block.
 */
function buildTableBlockFromRows(rowTexts: string[][]): Block {
  const maxCols = Math.max(1, ...rowTexts.map(r => r.length));
  const cells: TableCell[][] = rowTexts.map(row => {
    const tableCells = row.map(t => makeCellFromInlines(
      t.length > 0 ? [{ text: t, style: {} }] : [],
      {},
    ));
    // Pad short rows
    while (tableCells.length < maxCols) {
      tableCells.push(makeCellFromInlines([], {}));
    }
    return tableCells;
  });

  const block = createTableBlock(cells.length, maxCols);
  const td = block.tableData!;
  for (let r = 0; r < cells.length; r++) {
    for (let c = 0; c < cells[r].length; c++) {
      td.rows[r].cells[c] = cells[r][c];
    }
  }
  return block;
}

/**
 * Parse a plain-text markdown table into TableCell[][].
 * Returns null if the text is not a valid markdown table.
 *
 * Only succeeds when the **entire** text is a single markdown table.
 * For mixed text+table content, use `parseMarkdownWithTables()`.
 */
export function parseMarkdownTableToTableCells(text: string): TableCell[][] | null {
  if (!text) return null;

  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length < 2) return null;

  if (!MD_SEPARATOR_RE.test(lines[1])) return null;
  if (!lines[0].includes('|')) return null;

  const rows: TableCell[][] = [];

  for (let i = 0; i < lines.length; i++) {
    if (i === 1) continue; // skip separator
    const cellTexts = parseMdRow(lines[i]);
    rows.push(cellTexts.map(t => makeCellFromInlines(
      t.length > 0 ? [{ text: t, style: {} }] : [],
      {},
    )));
  }

  if (rows.length === 0) return null;

  const maxCols = Math.max(...rows.map(r => r.length));
  for (const row of rows) {
    while (row.length < maxCols) {
      row.push(makeCellFromInlines([], {}));
    }
  }

  return rows;
}

/**
 * Parse plain text that may contain markdown tables interspersed with
 * regular text.  Returns a Block[] where table regions become table blocks
 * and text regions become paragraph blocks.
 *
 * Returns null if no markdown table is found (caller should fall through
 * to plain-text paste).
 */
export function parseMarkdownWithTables(text: string): Block[] | null {
  if (!text) return null;

  const lines = text.split('\n');
  const blocks: Block[] = [];
  let i = 0;
  let foundTable = false;

  while (i < lines.length) {
    // Detect markdown table: current line has `|` and next line is separator
    if (
      i + 1 < lines.length &&
      lines[i].includes('|') &&
      MD_SEPARATOR_RE.test(lines[i + 1].trim())
    ) {
      foundTable = true;
      const rowTexts: string[][] = [parseMdRow(lines[i].trim())]; // header
      i += 2; // skip header + separator

      // Collect data rows — lines containing `|`
      while (i < lines.length && lines[i].trim().includes('|')) {
        rowTexts.push(parseMdRow(lines[i].trim()));
        i++;
      }

      blocks.push(buildTableBlockFromRows(rowTexts));
    } else {
      const line = lines[i];
      if (line.trim().length > 0) {
        blocks.push(makeBlock([{ text: line, style: {} }]));
      } else if (blocks.length > 0) {
        // Preserve blank lines between content as empty paragraphs
        blocks.push(makeBlock([]));
      }
      i++;
    }
  }

  if (!foundTable) return null;

  // insertBlocks merges the first and last blocks with surrounding text.
  // Table blocks cannot be merged, so pad with empty paragraphs if needed.
  if (blocks.length > 0 && blocks[0].type === 'table') {
    blocks.unshift(makeBlock([]));
  }
  if (blocks.length > 0 && blocks[blocks.length - 1].type === 'table') {
    blocks.push(makeBlock([]));
  }

  return blocks;
}
