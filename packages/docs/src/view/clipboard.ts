import type { Block, BlockType, Inline, InlineStyle, HeadingLevel, TableCell } from '../model/types.js';
import { generateBlockId, DEFAULT_BLOCK_STYLE, inlineStylesEqual } from '../model/types.js';

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
