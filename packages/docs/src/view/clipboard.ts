import type { Block, BlockType, Inline, InlineStyle, HeadingLevel, TableCell, CellStyle } from '../model/types.js';
import { generateBlockId, DEFAULT_BLOCK_STYLE, inlineStylesEqual, createTableBlock } from '../model/types.js';

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
    const payload = JSON.parse(json) as Partial<ClipboardPayload>;
    if (payload.version !== 1 || !Array.isArray(payload.blocks)) return [];
    return payload.blocks as Block[];
  } catch {
    return [];
  }
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
    const payload = JSON.parse(json) as Partial<ClipboardPayload>;
    if (payload.version !== 1) return { blocks: [] };
    return {
      blocks: Array.isArray(payload.blocks) ? payload.blocks : [],
      tableCells: Array.isArray(payload.tableCells) ? payload.tableCells : undefined,
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
  const trs = table.querySelectorAll('tr');

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
