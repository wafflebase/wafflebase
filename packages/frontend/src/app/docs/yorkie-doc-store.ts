import type { Document as YorkieDocument } from '@yorkie-js/react';
import yorkie, { type ElementNode, type TreeNode } from '@yorkie-js/sdk';

const { Tree } = yorkie;
import type {
  DocStore,
  Document,
  Block,
  BlockType,
  HeadingLevel,
  Inline,
  BlockStyle,
  InlineStyle,
  ImageData,
  PageSetup,
  HeaderFooter,
  TableRow,
  TableCell,
  CellStyle,
  BorderStyle,
} from '@wafflebase/docs';
import {
  resolvePageSetup,
  normalizeBlockStyle,
  DEFAULT_BLOCK_STYLE,
  resolveOffset,
  applyInsertText,
  applyDeleteText,
  applyInlineStyleHelper,
  applyInsertInline,
  applySplitBlock,
  applyMergeBlocks,
} from '@wafflebase/docs';
import type { YorkieDocsRoot } from '@/types/docs-document';
import type { DocsPresence } from '@/types/users';

// Enable with: localStorage.setItem('DOCS_DEBUG', '1')
const isDebug = () =>
  typeof localStorage !== 'undefined' && localStorage.getItem('DOCS_DEBUG') === '1';

/** Summarize a block's inline text for debug logging. */
function describeBlock(block: Block): string {
  const text = block.inlines.map((i) => i.text).join('');
  return `[${block.id.slice(0, 6)}:${block.type}] "${text.length > 40 ? text.slice(0, 40) + '…' : text}"`;
}

/** Summarize the Yorkie Tree node for a block path. */
function describeTreeBlock(node: TreeNode): string {
  const el = node as ElementNode;
  const id = (el.attributes as Record<string, string>)?.id ?? '?';
  const inlines = (el.children ?? []).filter((c) => c.type === 'inline') as ElementNode[];
  const text = inlines.flatMap((i) =>
    (i.children ?? [])
      .filter((c): c is { type: 'text'; value: string } => c.type === 'text')
      .map((t) => t.value),
  ).join('');
  return `[${id.slice(0, 6)}:${(el.attributes as Record<string, string>)?.type ?? '?'}] "${text.length > 40 ? text.slice(0, 40) + '…' : text}"`;
}

// ---------------------------------------------------------------------------
// Helpers: attribute serialization
//
// Yorkie Tree attributes are always strings. We convert numbers with String()
// and parse them back with Number(). Booleans use "true"/"false".
// ---------------------------------------------------------------------------

function setIfDefined(attrs: Record<string, string>, key: string, value: unknown): void {
  if (value !== undefined) {
    attrs[key] = String(value);
  }
}

function serializeInlineStyle(style: InlineStyle): Record<string, string> {
  const attrs: Record<string, string> = {};
  setIfDefined(attrs, 'bold', style.bold);
  setIfDefined(attrs, 'italic', style.italic);
  setIfDefined(attrs, 'underline', style.underline);
  setIfDefined(attrs, 'strikethrough', style.strikethrough);
  setIfDefined(attrs, 'superscript', style.superscript);
  setIfDefined(attrs, 'subscript', style.subscript);
  setIfDefined(attrs, 'fontSize', style.fontSize);
  if (style.fontFamily !== undefined) attrs.fontFamily = style.fontFamily;
  if (style.color !== undefined) attrs.color = style.color;
  if (style.backgroundColor !== undefined) attrs.backgroundColor = style.backgroundColor;
  if (style.href !== undefined) attrs.href = style.href;
  setIfDefined(attrs, 'pageNumber', style.pageNumber);
  if (style.image !== undefined) {
    attrs['image.src'] = style.image.src;
    attrs['image.width'] = String(style.image.width);
    attrs['image.height'] = String(style.image.height);
    if (style.image.alt !== undefined) {
      attrs['image.alt'] = style.image.alt;
    }
  }
  return attrs;
}

function parseInlineStyle(attrs: Record<string, string> | undefined): InlineStyle {
  if (!attrs) return {};
  const style: InlineStyle = {};
  if ('bold' in attrs) style.bold = attrs.bold === 'true';
  if ('italic' in attrs) style.italic = attrs.italic === 'true';
  if ('underline' in attrs) style.underline = attrs.underline === 'true';
  if ('strikethrough' in attrs) style.strikethrough = attrs.strikethrough === 'true';
  if (attrs.superscript !== undefined) style.superscript = attrs.superscript === 'true';
  if (attrs.subscript !== undefined) style.subscript = attrs.subscript === 'true';
  if ('fontSize' in attrs) style.fontSize = Number(attrs.fontSize);
  if ('fontFamily' in attrs) style.fontFamily = attrs.fontFamily;
  if ('color' in attrs) style.color = attrs.color;
  if ('backgroundColor' in attrs) style.backgroundColor = attrs.backgroundColor;
  if (attrs.href !== undefined) style.href = attrs.href;
  if (attrs.pageNumber !== undefined) style.pageNumber = attrs.pageNumber === 'true';
  if ('image.src' in attrs) {
    // Guard against NaN / non-positive sizes from missing or malformed
    // attributes so that invalid image data is dropped instead of being
    // materialised into the in-memory document (and persisted back).
    const width = Number(attrs['image.width']);
    const height = Number(attrs['image.height']);
    if (
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0
    ) {
      const image: ImageData = {
        src: attrs['image.src'],
        width,
        height,
      };
      if ('image.alt' in attrs) {
        image.alt = attrs['image.alt'];
      }
      style.image = image;
    }
  }
  return style;
}

function serializeBlockStyle(style: BlockStyle): Record<string, string> {
  return {
    alignment: style.alignment,
    lineHeight: String(style.lineHeight),
    marginTop: String(style.marginTop),
    marginBottom: String(style.marginBottom),
    textIndent: String(style.textIndent),
    marginLeft: String(style.marginLeft),
  };
}

function parseBlockStyle(attrs: Record<string, string> | undefined): BlockStyle {
  if (!attrs) return { ...DEFAULT_BLOCK_STYLE };
  const partial: Partial<BlockStyle> = {};
  if ('alignment' in attrs) partial.alignment = attrs.alignment as BlockStyle['alignment'];
  if ('lineHeight' in attrs) partial.lineHeight = Number(attrs.lineHeight);
  if ('marginTop' in attrs) partial.marginTop = Number(attrs.marginTop);
  if ('marginBottom' in attrs) partial.marginBottom = Number(attrs.marginBottom);
  if ('textIndent' in attrs) partial.textIndent = Number(attrs.textIndent);
  if ('marginLeft' in attrs) partial.marginLeft = Number(attrs.marginLeft);
  return normalizeBlockStyle(partial);
}

// ---------------------------------------------------------------------------
// Cell style serialization
// ---------------------------------------------------------------------------

function serializeCellStyle(cell: TableCell): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (cell.colSpan !== undefined && cell.colSpan !== 1) attrs.colSpan = String(cell.colSpan);
  if (cell.rowSpan !== undefined && cell.rowSpan !== 1) attrs.rowSpan = String(cell.rowSpan);
  const s = cell.style;
  if (s.backgroundColor) attrs.backgroundColor = s.backgroundColor;
  if (s.verticalAlign) attrs.verticalAlign = s.verticalAlign;
  if (s.padding !== undefined) attrs.padding = String(s.padding);
  if (s.borderTop) attrs.borderTop = `${s.borderTop.width},${s.borderTop.style},${s.borderTop.color}`;
  if (s.borderBottom) attrs.borderBottom = `${s.borderBottom.width},${s.borderBottom.style},${s.borderBottom.color}`;
  if (s.borderLeft) attrs.borderLeft = `${s.borderLeft.width},${s.borderLeft.style},${s.borderLeft.color}`;
  if (s.borderRight) attrs.borderRight = `${s.borderRight.width},${s.borderRight.style},${s.borderRight.color}`;
  return attrs;
}

function parseBorderStyle(value: string): BorderStyle | undefined {
  const parts = value.split(',');
  if (parts.length !== 3) return undefined;
  return { width: Number(parts[0]), style: parts[1] as 'solid' | 'none', color: parts[2] };
}

function parseCellStyle(attrs: Record<string, string>): CellStyle {
  const style: CellStyle = {};
  if (attrs.backgroundColor) style.backgroundColor = attrs.backgroundColor;
  if (attrs.verticalAlign) style.verticalAlign = attrs.verticalAlign as 'top' | 'middle' | 'bottom';
  if (attrs.padding) style.padding = Number(attrs.padding);
  if (attrs.borderTop) style.borderTop = parseBorderStyle(attrs.borderTop);
  if (attrs.borderBottom) style.borderBottom = parseBorderStyle(attrs.borderBottom);
  if (attrs.borderLeft) style.borderLeft = parseBorderStyle(attrs.borderLeft);
  if (attrs.borderRight) style.borderRight = parseBorderStyle(attrs.borderRight);
  return style;
}

// ---------------------------------------------------------------------------
// Tree node builders (plain objects consumed by Yorkie Tree API)
// ---------------------------------------------------------------------------

function buildInlineNode(inline: Inline): ElementNode {
  const children: TreeNode[] =
    inline.text.length > 0
      ? [{ type: 'text' as const, value: inline.text }]
      : [];
  return {
    type: 'inline',
    attributes: serializeInlineStyle(inline.style),
    children,
  };
}

function serializeTableAttrs(
  cols: number[],
  rowHeights?: (number | undefined)[],
): Record<string, string> {
  const attrs: Record<string, string> = { cols: cols.join(',') };
  if (rowHeights && rowHeights.length > 0) {
    attrs.rowHeights = rowHeights.map(h => h ?? '').join(',');
  }
  return attrs;
}

function buildBlockNode(block: Block): ElementNode {
  // Table block: children are row → cell → block nodes
  if (block.type === 'table' && block.tableData) {
    return {
      type: 'block',
      attributes: {
        id: block.id,
        type: 'table',
        ...serializeTableAttrs(block.tableData.columnWidths, block.tableData.rowHeights),
        ...serializeBlockStyle(block.style),
      },
      children: block.tableData.rows.map(buildRowNode),
    };
  }

  const attrs: Record<string, string> = {
    id: block.id,
    type: block.type,
    ...serializeBlockStyle(block.style),
  };
  if (block.headingLevel !== undefined) {
    attrs.headingLevel = String(block.headingLevel);
  }
  if (block.listKind !== undefined) {
    attrs.listKind = block.listKind;
  }
  if (block.listLevel !== undefined) {
    attrs.listLevel = String(block.listLevel);
  }
  return {
    type: 'block',
    attributes: attrs,
    children: block.inlines.map(buildInlineNode),
  };
}

function buildCellNode(cell: TableCell): ElementNode {
  return {
    type: 'cell' as const,
    attributes: serializeCellStyle(cell),
    children: cell.blocks.map(buildBlockNode),
  };
}

function buildRowNode(row: TableRow): ElementNode {
  return {
    type: 'row' as const,
    attributes: {},
    children: row.cells.map(buildCellNode),
  };
}

// ---------------------------------------------------------------------------
// Tree traversal: read tree nodes back into Document model
// ---------------------------------------------------------------------------

function treeNodeToInline(node: TreeNode): Inline {
  if (node.type === 'text') {
    // Bare text node — shouldn't happen under normal structure
    return { text: (node as { value: string }).value, style: {} };
  }
  const el = node as ElementNode;
  const text = (el.children ?? [])
    .filter((c): c is { type: 'text'; value: string } => c.type === 'text')
    .map((c) => c.value)
    .join('');
  return {
    text,
    style: parseInlineStyle(el.attributes as Record<string, string> | undefined),
  };
}

function treeNodeToRow(node: TreeNode): TableRow {
  const el = node as ElementNode;
  return {
    cells: (el.children ?? [])
      .filter((c) => c.type === 'cell')
      .map(treeNodeToCell),
  };
}

function treeNodeToCell(node: TreeNode): TableCell {
  const el = node as ElementNode;
  const attrs = (el.attributes ?? {}) as Record<string, string>;
  const blocks = (el.children ?? [])
    .filter((c) => c.type === 'block')
    .map(treeNodeToBlock);
  return {
    blocks: blocks.length > 0
      ? blocks
      : [{ id: '', type: 'paragraph', inlines: [{ text: '', style: {} }], style: { ...DEFAULT_BLOCK_STYLE } }],
    style: parseCellStyle(attrs),
    colSpan: attrs.colSpan ? Number(attrs.colSpan) : undefined,
    rowSpan: attrs.rowSpan ? Number(attrs.rowSpan) : undefined,
  };
}

function treeNodeToBlock(node: TreeNode): Block {
  const el = node as ElementNode;
  const attrs = (el.attributes ?? {}) as Record<string, string>;
  const blockType = (attrs.type as Block['type']) ?? 'paragraph';

  // Table block: parse row → cell → block children
  if (blockType === 'table') {
    const rows = (el.children ?? [])
      .filter((c) => c.type === 'row')
      .map(treeNodeToRow);
    const cols = (attrs.cols ?? '').split(',').map(Number).filter(n => !isNaN(n));
    const rowHeightsAttr = attrs.rowHeights;
    const rowHeights = rowHeightsAttr
      ? rowHeightsAttr.split(',').map(v => v === '' ? undefined : Number(v))
      : undefined;
    return {
      id: attrs.id ?? '',
      type: 'table',
      inlines: [],
      style: parseBlockStyle(attrs),
      tableData: {
        rows,
        columnWidths: cols,
        ...(rowHeights ? { rowHeights } : {}),
      },
    };
  }

  const inlines = (el.children ?? [])
    .filter((c) => c.type === 'inline')
    .map(treeNodeToInline);
  const block: Block = {
    id: attrs.id ?? '',
    type: blockType,
    inlines: inlines.length > 0
      ? inlines
      : blockType === 'horizontal-rule' || blockType === 'page-break'
        ? []
        : [{ text: '', style: {} }],
    style: parseBlockStyle(attrs),
  };
  if ('headingLevel' in attrs) {
    block.headingLevel = Number(attrs.headingLevel) as Block['headingLevel'];
  }
  if ('listKind' in attrs) {
    block.listKind = attrs.listKind as Block['listKind'];
  }
  if ('listLevel' in attrs) {
    block.listLevel = Number(attrs.listLevel);
  }
  return block;
}

function treeToDocument(root: TreeNode): Document {
  const el = root as ElementNode;
  const doc: Document = { blocks: [] };
  for (const child of el.children ?? []) {
    if (child.type === 'header') {
      const attrs = (child as ElementNode).attributes ?? {};
      doc.header = {
        blocks: ((child as ElementNode).children ?? []).map(treeNodeToBlock),
        marginFromEdge: Number(attrs.marginFromEdge ?? '48'),
      };
    } else if (child.type === 'footer') {
      const attrs = (child as ElementNode).attributes ?? {};
      doc.footer = {
        blocks: ((child as ElementNode).children ?? []).map(treeNodeToBlock),
        marginFromEdge: Number(attrs.marginFromEdge ?? '48'),
      };
    } else if (child.type === 'block') {
      doc.blocks.push(treeNodeToBlock(child));
    }
  }
  return doc;
}

// ---------------------------------------------------------------------------
// Deep-clone helper for undo/redo snapshots
// ---------------------------------------------------------------------------

function cloneDocument(doc: Document): Document {
  return JSON.parse(JSON.stringify(doc));
}

/**
 * Read PageSetup from a Yorkie proxy object by accessing properties directly.
 * Yorkie proxies double-encode when passed through JSON.stringify, so we
 * manually copy each field.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Yorkie proxy type is untyped
function readPageSetup(proxy: any): PageSetup {
  const ps = proxy.paperSize;
  const m = proxy.margins;
  return {
    paperSize: { name: ps?.name, width: Number(ps?.width), height: Number(ps?.height) },
    orientation: proxy.orientation ?? 'portrait',
    margins: {
      top: Number(m?.top),
      bottom: Number(m?.bottom),
      left: Number(m?.left),
      right: Number(m?.right),
    },
  };
}

// ---------------------------------------------------------------------------
// YorkieDocStore
// ---------------------------------------------------------------------------

export class YorkieDocStore implements DocStore {
  private doc: YorkieDocument<YorkieDocsRoot>;
  private cachedDoc: Document | null = null;
  private dirty = true;

  // Local snapshot-based undo/redo (Phase 1)
  private undoStack: Document[] = [];
  private redoStack: Document[] = [];

  /**
   * Optional callback invoked when a remote change is detected.
   * The host component should set this to trigger a re-render.
   */
  onRemoteChange?: () => void;

  constructor(doc: YorkieDocument<YorkieDocsRoot>) {
    this.doc = doc;

    // Invalidate cache on remote changes
    doc.subscribe((event) => {
      if (event.type === 'remote-change') {
        this.dirty = true;
        this.onRemoteChange?.();
      }
    });
  }

  // -----------------------------------------------------------------------
  // Reads
  // -----------------------------------------------------------------------

  getDocument(): Document {
    if (!this.dirty && this.cachedDoc) {
      return cloneDocument(this.cachedDoc);
    }
    const root = this.doc.getRoot();
    const tree = root.content;
    if (!tree || typeof tree.getRootTreeNode !== 'function') {
      this.cachedDoc = { blocks: [] };
      this.dirty = false;
      return { blocks: [] };
    }
    const treeRoot = tree.getRootTreeNode();
    const parsed = treeToDocument(treeRoot);
    // Attach pageSetup from the root object (stored outside the tree).
    // Yorkie proxy objects double-encode with JSON.stringify, so read
    // properties directly.
    parsed.pageSetup = root.pageSetup
      ? readPageSetup(root.pageSetup)
      : undefined;
    this.cachedDoc = parsed;
    this.dirty = false;
    return cloneDocument(parsed);
  }

  private findBlockRecursive(blocks: Block[], id: string): Block | undefined {
    for (const block of blocks) {
      if (block.id === id) return block;
      if (block.tableData) {
        for (const row of block.tableData.rows) {
          for (const cell of row.cells) {
            const found = this.findBlockRecursive(cell.blocks, id);
            if (found) return found;
          }
        }
      }
    }
    return undefined;
  }

  getBlock(id: string): Block | undefined {
    const document = this.getDocument();
    const found = this.findBlockRecursive(document.blocks, id);
    if (found) return found;
    if (document.header) {
      const hFound = this.findBlockRecursive(document.header.blocks, id);
      if (hFound) return hFound;
    }
    if (document.footer) {
      return this.findBlockRecursive(document.footer.blocks, id);
    }
    return undefined;
  }

  getPageSetup(): PageSetup {
    const root = this.doc.getRoot();
    return resolvePageSetup(
      root.pageSetup ? readPageSetup(root.pageSetup) : undefined,
    );
  }

  getHeader(): HeaderFooter | undefined {
    const doc = this.getDocument();
    return doc.header;
  }

  getFooter(): HeaderFooter | undefined {
    const doc = this.getDocument();
    return doc.footer;
  }

  setHeader(header: HeaderFooter | undefined): void {
    const doc = this.getDocument();
    const hadHeader = !!doc.header;

    // If tree is not initialized yet, fall back to full document write.
    const root = this.doc.getRoot();
    const tree = root.content;
    if (!tree || typeof tree.getRootTreeNode !== 'function') {
      doc.header = header;
      this.writeFullDocument(doc);
      this.cachedDoc = cloneDocument(doc);
      this.dirty = false;
      return;
    }

    this.doc.update((root) => {
      const tree = root.content;

      if (header) {
        const node: ElementNode = {
          type: 'header',
          attributes: { marginFromEdge: String(header.marginFromEdge) },
          children: header.blocks.map(buildBlockNode),
        };
        if (hadHeader) {
          tree.editByPath([0], [1], node);
        } else {
          tree.editByPath([0], [0], node);
        }
      } else if (hadHeader) {
        tree.editByPath([0], [1]);
      }
    });

    doc.header = header;
    this.cachedDoc = doc;
    this.dirty = false;
  }

  setFooter(footer: HeaderFooter | undefined): void {
    const doc = this.getDocument();
    const hadFooter = !!doc.footer;

    // If tree is not initialized yet, fall back to full document write.
    const root = this.doc.getRoot();
    const tree = root.content;
    if (!tree || typeof tree.getRootTreeNode !== 'function') {
      doc.footer = footer;
      this.writeFullDocument(doc);
      this.cachedDoc = cloneDocument(doc);
      this.dirty = false;
      return;
    }

    this.doc.update((root) => {
      const tree = root.content;
      const treeRoot = tree.getRootTreeNode() as ElementNode;
      const childCount = (treeRoot.children ?? []).length;

      if (footer) {
        const node: ElementNode = {
          type: 'footer',
          attributes: { marginFromEdge: String(footer.marginFromEdge) },
          children: footer.blocks.map(buildBlockNode),
        };
        if (hadFooter) {
          tree.editByPath([childCount - 1], [childCount], node);
        } else {
          tree.editByPath([childCount], [childCount], node);
        }
      } else if (hadFooter) {
        tree.editByPath([childCount - 1], [childCount]);
      }
    });

    doc.footer = footer;
    this.cachedDoc = doc;
    this.dirty = false;
  }

  // -----------------------------------------------------------------------
  // Writes — all mutations go through doc.update()
  // -----------------------------------------------------------------------

  setDocument(doc: Document): void {
    this.writeFullDocument(doc);
    // Cache the document we just wrote so the next getDocument() returns it
    // even if the Yorkie Tree read doesn't reflect changes immediately
    // (e.g., stale documents whose content field was a plain object).
    this.cachedDoc = cloneDocument(doc);
    this.dirty = false;
  }

  replaceDocument(doc: Document): void {
    // The editor calls replaceDocument() after mutations with the updated
    // document state. Cache it so getDocument() returns consistent data
    // even if the Yorkie Tree read fails (e.g., stale documents).
    this.cachedDoc = cloneDocument(doc);
    this.dirty = false;
  }

  /**
   * Tree child offset for body blocks.
   * When a header container exists as tree child [0], body blocks start at [1].
   */
  private bodyTreeOffset(doc: Document): number {
    return doc.header ? 1 : 0;
  }

  /**
   * Search for a block inside a table block's cells (recursively for nested
   * tables). Returns the sub-path within the table if found:
   * `[rowIdx, cellIdx, blockIdx]` or deeper for nested tables.
   */
  private findBlockInTable(
    block: Block,
    blockId: string,
  ): number[] | undefined {
    if (!block.tableData) return undefined;
    for (let r = 0; r < block.tableData.rows.length; r++) {
      const row = block.tableData.rows[r];
      for (let c = 0; c < row.cells.length; c++) {
        const cell = row.cells[c];
        for (let b = 0; b < cell.blocks.length; b++) {
          if (cell.blocks[b].id === blockId) {
            return [r, c, b];
          }
          // Recurse into nested tables
          const nested = this.findBlockInTable(cell.blocks[b], blockId);
          if (nested) {
            return [r, c, b, ...nested];
          }
        }
      }
    }
    return undefined;
  }

  /**
   * Resolve a block ID to its Yorkie tree path prefix.
   * - Header block:      [0, blockIdx]
   * - Body block:        [blockIdx + bodyOffset]
   * - Footer block:      [footerTreeIdx, blockIdx]
   * - Table cell block:  [...tablePath, rowIdx, cellIdx, blockIdx]
   *   (recursively for nested tables)
   */
  private resolveBlockTreePath(
    blockId: string,
    doc: Document,
  ): { path: number[]; region: 'header' | 'body' | 'footer' } {
    if (doc.header) {
      const idx = doc.header.blocks.findIndex((b) => b.id === blockId);
      if (idx !== -1) return { path: [0, idx], region: 'header' };
      // Search inside table blocks in header
      for (let i = 0; i < doc.header.blocks.length; i++) {
        const sub = this.findBlockInTable(doc.header.blocks[i], blockId);
        if (sub) return { path: [0, i, ...sub], region: 'header' };
      }
    }
    const bodyOffset = this.bodyTreeOffset(doc);
    const bodyIdx = doc.blocks.findIndex((b) => b.id === blockId);
    if (bodyIdx !== -1) {
      return { path: [bodyIdx + bodyOffset], region: 'body' };
    }
    // Search inside table blocks in body
    for (let i = 0; i < doc.blocks.length; i++) {
      const sub = this.findBlockInTable(doc.blocks[i], blockId);
      if (sub) return { path: [i + bodyOffset, ...sub], region: 'body' };
    }
    if (doc.footer) {
      const footerTreeIdx = bodyOffset + doc.blocks.length;
      const idx = doc.footer.blocks.findIndex((b) => b.id === blockId);
      if (idx !== -1) {
        return { path: [footerTreeIdx, idx], region: 'footer' };
      }
      // Search inside table blocks in footer
      for (let i = 0; i < doc.footer.blocks.length; i++) {
        const sub = this.findBlockInTable(doc.footer.blocks[i], blockId);
        if (sub) return { path: [footerTreeIdx, i, ...sub], region: 'footer' };
      }
    }
    throw new Error(`Block not found: ${blockId}`);
  }

  /**
   * Navigate the tree to find the block node at the given path.
   */
  private getTreeBlockNode(treeRoot: TreeNode, blockPath: number[]): TreeNode {
    let node = treeRoot;
    for (const idx of blockPath) {
      node = ((node as ElementNode).children ?? [])[idx];
    }
    return node;
  }

  /**
   * Resolve a block-level character offset into (inlineIndex, charOffset)
   * by walking the inline children of a given block TreeNode.
   * This is a generalized version of resolveTreeOffset that works for any
   * region (header, body, footer).
   */
  private resolveBlockNodeOffset(
    blockNode: TreeNode,
    offset: number,
  ): { inlineIndex: number; charOffset: number } {
    const el = blockNode as ElementNode;
    const inlineChildren = (el.children ?? []).filter(
      (c): c is ElementNode => c.type === 'inline',
    );
    let remaining = offset;
    for (let i = 0; i < inlineChildren.length; i++) {
      const textLen = (inlineChildren[i].children ?? [])
        .filter((c): c is { type: 'text'; value: string } => c.type === 'text')
        .reduce((sum, t) => sum + t.value.length, 0);
      if (remaining <= textLen) {
        return { inlineIndex: i, charOffset: remaining };
      }
      remaining -= textLen;
    }
    const lastIdx = inlineChildren.length - 1;
    const lastLen = (inlineChildren[lastIdx]?.children ?? [])
      .filter((c): c is { type: 'text'; value: string } => c.type === 'text')
      .reduce((sum, t) => sum + t.value.length, 0);
    return { inlineIndex: Math.max(0, lastIdx), charOffset: lastLen };
  }

  /** Log the Yorkie Tree state at a given block path for debugging. */
  private logTreeState(op: string, blockPath: number[]): void {
    try {
      const root = this.doc.getRoot();
      const tree = root.content;
      if (!tree || typeof tree.getRootTreeNode !== 'function') return;
      const treeRoot = tree.getRootTreeNode();
      const blockNode = this.getTreeBlockNode(treeRoot, blockPath);
      console.log(`[DOC]   tree AFTER:  ${describeTreeBlock(blockNode)} (${op})`);
    } catch {
      console.log(`[DOC]   tree AFTER:  <error reading path [${blockPath}]> (${op})`);
    }
  }

  /**
   * Get the top-level blocks array and index for a region.
   */
  private getRegionBlocks(
    doc: Document,
    blockPath: number[],
    region: 'header' | 'body' | 'footer',
  ): { blocks: Block[]; topIndex: number } {
    if (region === 'header') {
      return { blocks: doc.header!.blocks, topIndex: blockPath[1] };
    } else if (region === 'footer') {
      return { blocks: doc.footer!.blocks, topIndex: blockPath[1] };
    }
    return { blocks: doc.blocks, topIndex: blockPath[0] - this.bodyTreeOffset(doc) };
  }

  /**
   * Navigate into a table block's cell hierarchy to find the target block.
   * `cellPath` is the sub-path within the table: [rowIdx, cellIdx, blockIdx, ...]
   * For nested tables, the pattern repeats: [r, c, b, r, c, b, ...]
   */
  private getCellBlock(tableBlock: Block, cellPath: number[]): Block {
    let block = tableBlock;
    for (let i = 0; i < cellPath.length; i += 3) {
      const r = cellPath[i];
      const c = cellPath[i + 1];
      const b = cellPath[i + 2];
      block = block.tableData!.rows[r].cells[c].blocks[b];
    }
    return block;
  }

  /**
   * Set a block inside a table block's cell hierarchy.
   */
  private setCellBlock(tableBlock: Block, cellPath: number[], value: Block): void {
    let block = tableBlock;
    for (let i = 0; i < cellPath.length - 3; i += 3) {
      const r = cellPath[i];
      const c = cellPath[i + 1];
      const b = cellPath[i + 2];
      block = block.tableData!.rows[r].cells[c].blocks[b];
    }
    const lastR = cellPath[cellPath.length - 3];
    const lastC = cellPath[cellPath.length - 2];
    const lastB = cellPath[cellPath.length - 1];
    block.tableData!.rows[lastR].cells[lastC].blocks[lastB] = value;
  }

  /**
   * Get the Block[] array that contains the target block.
   * For top-level blocks, returns doc.blocks (or header/footer blocks).
   * For cell-internal blocks, returns cell.blocks of the parent cell.
   */
  private getBlocksArrayForPath(
    doc: Document,
    blockPath: number[],
    region: 'header' | 'body' | 'footer',
  ): Block[] {
    const { blocks, topIndex } = this.getRegionBlocks(doc, blockPath, region);
    if (!this.isCellBlockPath(blockPath, region)) {
      return blocks;
    }
    // Navigate into the table cell and return cell.blocks
    const cellPath = this.getCellSubPath(blockPath, region);
    let block = blocks[topIndex];
    // Walk through nested tables, stopping before the last (r, c, b) triplet
    for (let i = 0; i < cellPath.length - 3; i += 3) {
      const r = cellPath[i];
      const c = cellPath[i + 1];
      const b = cellPath[i + 2];
      block = block.tableData!.rows[r].cells[c].blocks[b];
    }
    const lastR = cellPath[cellPath.length - 3];
    const lastC = cellPath[cellPath.length - 2];
    return block.tableData!.rows[lastR].cells[lastC].blocks;
  }

  /**
   * Check if a block path points to a cell-internal block.
   * Cell paths have more than 1 element (body) or 2 elements (header/footer).
   */
  private isCellBlockPath(
    blockPath: number[],
    region: 'header' | 'body' | 'footer',
  ): boolean {
    const topLevelLen = region === 'body' ? 1 : 2;
    return blockPath.length > topLevelLen;
  }

  /**
   * Extract the cell sub-path from a full block path.
   * For body: [tableTreeIdx, r, c, b, ...] → [r, c, b, ...]
   * For header/footer: [regionIdx, tableIdx, r, c, b, ...] → [r, c, b, ...]
   */
  private getCellSubPath(
    blockPath: number[],
    region: 'header' | 'body' | 'footer',
  ): number[] {
    const topLevelLen = region === 'body' ? 1 : 2;
    return blockPath.slice(topLevelLen);
  }

  /**
   * Get the block from the correct region of the cached document.
   * Handles top-level blocks and cell-internal blocks.
   */
  private getBlockByRegion(
    doc: Document,
    blockPath: number[],
    region: 'header' | 'body' | 'footer',
  ): Block {
    const { blocks, topIndex } = this.getRegionBlocks(doc, blockPath, region);
    if (this.isCellBlockPath(blockPath, region)) {
      const cellPath = this.getCellSubPath(blockPath, region);
      return this.getCellBlock(blocks[topIndex], cellPath);
    }
    return blocks[topIndex];
  }

  /**
   * Set a block in the correct region of the cached document.
   * Handles top-level blocks and cell-internal blocks.
   */
  private setBlockByRegion(
    doc: Document,
    blockPath: number[],
    region: 'header' | 'body' | 'footer',
    block: Block,
  ): void {
    const { blocks, topIndex } = this.getRegionBlocks(doc, blockPath, region);
    if (this.isCellBlockPath(blockPath, region)) {
      const cellPath = this.getCellSubPath(blockPath, region);
      this.setCellBlock(blocks[topIndex], cellPath, block);
    } else {
      blocks[topIndex] = block;
    }
  }

  updateBlock(id: string, block: Block): void {
    const currentDoc = this.getDocument();
    const { path: blockPath, region } = this.resolveBlockTreePath(id, currentDoc);

    const endPath = [...blockPath];
    endPath[endPath.length - 1] += 1;

    this.doc.update((root) => {
      const tree = root.content;
      if (!tree || typeof tree.getRootTreeNode !== 'function') return;
      tree.editByPath(blockPath, endPath, buildBlockNode(block));
    });
    // Update cache in-place
    this.setBlockByRegion(currentDoc, blockPath, region, block);
    this.cachedDoc = currentDoc;
    this.dirty = false;
  }

  setBlockType(
    blockId: string,
    type: BlockType,
    opts?: { headingLevel?: HeadingLevel; listKind?: 'ordered' | 'unordered'; listLevel?: number },
  ): void {
    const currentDoc = this.getDocument();
    const { path: blockPath, region } = this.resolveBlockTreePath(blockId, currentDoc);
    const block = this.getBlockByRegion(currentDoc, blockPath, region);

    // Build only type-specific attributes (not style — it's unchanged)
    const attrs: Record<string, string> = { type };
    if (type === 'heading') {
      attrs.headingLevel = String(opts?.headingLevel ?? 1);
    }
    if (type === 'list-item') {
      attrs.listKind = opts?.listKind ?? 'unordered';
      attrs.listLevel = String(opts?.listLevel ?? 0);
    }

    // Determine stale attributes to remove (styleByPath merges, not replaces)
    const toRemove: string[] = [];
    if (type !== 'heading') toRemove.push('headingLevel');
    if (type !== 'list-item') toRemove.push('listKind', 'listLevel');

    this.doc.update((root) => {
      const tree = root.content;
      if (!tree || typeof tree.getRootTreeNode !== 'function') return;
      tree.styleByPath(blockPath, attrs);

      // Remove stale type-specific attributes from previous block type
      if (toRemove.length > 0) {
        const endPath = [...blockPath];
        endPath[endPath.length - 1] += 1;
        tree.removeStyleByPath(blockPath, endPath, toRemove);
      }

      // For HR/page-break, clear all inlines
      if (type === 'horizontal-rule' || type === 'page-break') {
        const treeRoot = tree.getRootTreeNode();
        const blockNode = this.getTreeBlockNode(treeRoot, blockPath) as ElementNode;
        const childCount = (blockNode.children ?? []).length;
        if (childCount > 0) {
          tree.editByPath([...blockPath, 0], [...blockPath, childCount]);
        }
      } else if (block.inlines.length === 0) {
        // Ensure at least one empty inline
        tree.editByPath(
          [...blockPath, 0],
          [...blockPath, 0],
          buildInlineNode({ text: '', style: {} }),
        );
      }
    });

    // Update cache
    block.type = type;
    delete block.headingLevel;
    delete block.listKind;
    delete block.listLevel;
    if (type === 'heading') block.headingLevel = opts?.headingLevel ?? 1;
    if (type === 'list-item') {
      block.listKind = opts?.listKind ?? 'unordered';
      block.listLevel = opts?.listLevel ?? 0;
    }
    if (type === 'horizontal-rule' || type === 'page-break') {
      block.inlines = [];
    } else if (block.inlines.length === 0) {
      block.inlines = [{ text: '', style: {} }];
    }
    this.setBlockByRegion(currentDoc, blockPath, region, block);
    this.cachedDoc = currentDoc;
    this.dirty = false;
  }

  applyBlockStyle(blockId: string, style: Partial<BlockStyle>): void {
    const currentDoc = this.getDocument();
    const { path: blockPath, region } = this.resolveBlockTreePath(blockId, currentDoc);
    const block = this.getBlockByRegion(currentDoc, blockPath, region);

    const merged = normalizeBlockStyle({ ...block.style, ...style });
    const attrs = serializeBlockStyle(merged);

    this.doc.update((root) => {
      const tree = root.content;
      if (!tree || typeof tree.getRootTreeNode !== 'function') return;
      tree.styleByPath(blockPath, attrs);
    });

    // Update cache
    block.style = merged;
    this.setBlockByRegion(currentDoc, blockPath, region, block);
    this.cachedDoc = currentDoc;
    this.dirty = false;
  }

  insertImageInline(blockId: string, offset: number, inline: Inline): void {
    const currentDoc = this.getDocument();
    const { path: blockPath, region } = this.resolveBlockTreePath(blockId, currentDoc);
    const block = this.getBlockByRegion(currentDoc, blockPath, region);

    this.doc.update((root) => {
      const tree = root.content;
      if (!tree || typeof tree.getRootTreeNode !== 'function') return;

      const treeRoot = tree.getRootTreeNode();
      const blockNode = this.getTreeBlockNode(treeRoot, blockPath);
      const { inlineIndex, charOffset } = this.resolveBlockNodeOffset(blockNode, offset);

      const newNode = buildInlineNode(inline);

      // Determine inline text length to detect end boundary
      const inlineEl = ((blockNode as ElementNode).children ?? [])
        .filter((c): c is ElementNode => c.type === 'inline')[inlineIndex];
      const inlineTextLen = (inlineEl?.children ?? [])
        .filter((c): c is { type: 'text'; value: string } => c.type === 'text')
        .reduce((sum, t) => sum + t.value.length, 0);

      if (charOffset === 0) {
        // Insert before current inline
        tree.editByPath(
          [...blockPath, inlineIndex],
          [...blockPath, inlineIndex],
          newNode,
        );
      } else if (charOffset === inlineTextLen) {
        // At inline end boundary: insert after without splitting
        tree.editByPath(
          [...blockPath, inlineIndex + 1],
          [...blockPath, inlineIndex + 1],
          newNode,
        );
      } else {
        // Split at charOffset, then insert after the first half
        tree.editByPath(
          [...blockPath, inlineIndex, charOffset],
          [...blockPath, inlineIndex, charOffset],
          undefined,
          1,
        );
        tree.editByPath(
          [...blockPath, inlineIndex + 1],
          [...blockPath, inlineIndex + 1],
          newNode,
        );
      }
    });

    // Update cache
    const updated = applyInsertInline(block, offset, inline);
    this.setBlockByRegion(currentDoc, blockPath, region, updated);
    this.cachedDoc = currentDoc;
    this.dirty = false;
  }

  insertText(blockId: string, offset: number, text: string): void {
    const currentDoc = this.getDocument();
    const { path: blockPath, region } = this.resolveBlockTreePath(blockId, currentDoc);
    const block = this.getBlockByRegion(currentDoc, blockPath, region);
    if (isDebug()) {
      console.log(`[DOC] insertText blockId=${blockId.slice(0, 6)} offset=${offset} text="${text}" path=[${blockPath}] region=${region}`);
      console.log(`[DOC]   cache BEFORE: ${describeBlock(block)}`);
    }

    // Use cache-based resolveOffset for image detection only
    const cacheResolved = resolveOffset(block, offset);
    const targetInline = block.inlines[cacheResolved.inlineIndex];

    this.doc.update((root) => {
      const tree = root.content;
      if (!tree || typeof tree.getRootTreeNode !== 'function') return;

      // Resolve offset from the actual Yorkie tree structure
      const treeRoot = tree.getRootTreeNode();
      const blockNode = this.getTreeBlockNode(treeRoot, blockPath);
      const { inlineIndex, charOffset } = this.resolveBlockNodeOffset(blockNode, offset);

      if (targetInline.style.image) {
        const { image: _, ...plainStyle } = targetInline.style;
        void _;
        const newNode = buildInlineNode({ text, style: plainStyle });
        if (charOffset === 0) {
          tree.editByPath(
            [...blockPath, inlineIndex],
            [...blockPath, inlineIndex],
            newNode,
          );
        } else {
          tree.editByPath(
            [...blockPath, inlineIndex + 1],
            [...blockPath, inlineIndex + 1],
            newNode,
          );
        }
      } else {
        tree.editByPath(
          [...blockPath, inlineIndex, charOffset],
          [...blockPath, inlineIndex, charOffset],
          { type: 'text', value: text },
        );
      }
    });

    // Update cache in-place
    const updated = applyInsertText(block, offset, text);
    this.setBlockByRegion(currentDoc, blockPath, region, updated);
    this.cachedDoc = currentDoc;
    this.dirty = false;
    if (isDebug()) {
      console.log(`[DOC]   cache AFTER:  ${describeBlock(updated)}`);
      this.logTreeState('insertText', blockPath);
    }
  }

  deleteText(blockId: string, offset: number, length: number): void {
    const currentDoc = this.getDocument();
    const { path: blockPath, region } = this.resolveBlockTreePath(blockId, currentDoc);
    const block = this.getBlockByRegion(currentDoc, blockPath, region);
    if (isDebug()) {
      console.log(`[DOC] deleteText blockId=${blockId.slice(0, 6)} offset=${offset} length=${length} path=[${blockPath}] region=${region}`);
      console.log(`[DOC]   cache BEFORE: ${describeBlock(block)}`);
    }

    this.doc.update((root) => {
      const tree = root.content;
      if (!tree || typeof tree.getRootTreeNode !== 'function') return;

      // Resolve delete segments from the actual Yorkie tree structure
      const treeRoot = tree.getRootTreeNode();
      const blockNode = this.getTreeBlockNode(treeRoot, blockPath);
      const treeStart = this.resolveBlockNodeOffset(blockNode, offset);
      const treeEnd = this.resolveBlockNodeOffset(blockNode, offset + length);

      // Single-range delete on the Yorkie tree
      tree.editByPath(
        [...blockPath, treeStart.inlineIndex, treeStart.charOffset],
        [...blockPath, treeEnd.inlineIndex, treeEnd.charOffset],
      );

      // Remove any inlines that became empty after deletion
      const updatedBlockNode = this.getTreeBlockNode(tree.getRootTreeNode(), blockPath) as ElementNode;
      const inlines = (updatedBlockNode.children ?? []).filter((c) => c.type === 'inline') as ElementNode[];
      for (let i = inlines.length - 1; i >= 0; i--) {
        if (inlines.length <= 1) break; // keep at least one
        const textLen = (inlines[i].children ?? [])
          .filter((c): c is { type: 'text'; value: string } => c.type === 'text')
          .reduce((sum, t) => sum + t.value.length, 0);
        if (textLen === 0) {
          tree.editByPath([...blockPath, i], [...blockPath, i + 1]);
        }
      }
    });

    // Update cache in-place
    const updated = applyDeleteText(block, offset, length);
    this.setBlockByRegion(currentDoc, blockPath, region, updated);
    this.cachedDoc = currentDoc;
    this.dirty = false;
    if (isDebug()) {
      console.log(`[DOC]   cache AFTER:  ${describeBlock(updated)}`);
      this.logTreeState('deleteText', blockPath);
    }
  }

  applyStyle(
    blockId: string,
    fromOffset: number,
    toOffset: number,
    style: Partial<InlineStyle>,
  ): void {
    const currentDoc = this.getDocument();
    const { path: blockPath, region } = this.resolveBlockTreePath(blockId, currentDoc);
    const block = this.getBlockByRegion(currentDoc, blockPath, region);

    const updated = applyInlineStyleHelper(block, fromOffset, toOffset, style);

    this.doc.update((root) => {
      const tree = root.content;
      if (!tree || typeof tree.getRootTreeNode !== 'function') return;

      // Helper to get the text length of an inline node
      const inlineTextLen = (node: ElementNode): number =>
        (node.children ?? [])
          .filter((c): c is { type: 'text'; value: string } => c.type === 'text')
          .reduce((sum, t) => sum + t.value.length, 0);

      // Helper to read current block node from tree
      const readBlockNode = (): ElementNode =>
        this.getTreeBlockNode(tree.getRootTreeNode(), blockPath) as ElementNode;

      // Step 1: Resolve offsets to (inlineIndex, charOffset) positions
      let blockNode = readBlockNode();
      const toPos = this.resolveBlockNodeOffset(blockNode, toOffset);
      const fromPos = this.resolveBlockNodeOffset(blockNode, fromOffset);

      // Step 2: Split at toOffset first, then fromOffset.
      // Order matters: splitting at toOffset doesn't shift fromPos because
      // the split only affects inlines at or after toPos.inlineIndex.
      // When both offsets are in the same inline, the toOffset split shortens
      // it but fromPos.charOffset remains valid (it's before the split point).
      const toInline = ((blockNode as ElementNode).children ?? []).filter(
        (c): c is ElementNode => c.type === 'inline',
      )[toPos.inlineIndex];
      if (toInline && toPos.charOffset > 0 && toPos.charOffset < inlineTextLen(toInline)) {
        tree.editByPath(
          [...blockPath, toPos.inlineIndex, toPos.charOffset],
          [...blockPath, toPos.inlineIndex, toPos.charOffset],
          undefined,
          1,
        );
      }

      // Re-read block node after potential split
      blockNode = readBlockNode();

      // Split at fromOffset
      const fromInline = ((blockNode as ElementNode).children ?? []).filter(
        (c): c is ElementNode => c.type === 'inline',
      )[fromPos.inlineIndex];
      if (fromInline && fromPos.charOffset > 0 && fromPos.charOffset < inlineTextLen(fromInline)) {
        tree.editByPath(
          [...blockPath, fromPos.inlineIndex, fromPos.charOffset],
          [...blockPath, fromPos.inlineIndex, fromPos.charOffset],
          undefined,
          1,
        );
      }

      // Step 3: Re-read block after all splits
      blockNode = readBlockNode();
      const inlines = ((blockNode as ElementNode).children ?? []).filter(
        (c): c is ElementNode => c.type === 'inline',
      );

      // Step 4: Find the inline range that falls within [fromOffset, toOffset)
      let accum = 0;
      let startIdx = -1;
      let endIdx = -1; // exclusive
      for (let i = 0; i < inlines.length; i++) {
        const len = inlineTextLen(inlines[i]);
        if (startIdx === -1 && accum + len > fromOffset) {
          startIdx = i;
        }
        if (startIdx === -1 && accum + len === fromOffset && fromOffset === toOffset) {
          // zero-width range at boundary — no inlines to style
          break;
        }
        if (accum + len >= toOffset && startIdx !== -1) {
          // Check if this inline's start is already at or past toOffset
          if (accum >= toOffset) {
            endIdx = i;
          } else {
            endIdx = i + 1;
          }
          break;
        }
        accum += len;
      }

      if (startIdx === -1 || endIdx === -1) return;

      // Step 5: Apply style via styleByPath to each inline in the range
      const styleAttrs = serializeInlineStyle(style as InlineStyle);
      for (let i = startIdx; i < endIdx; i++) {
        const existingAttrs = inlines[i].attributes ?? {};
        tree.styleByPath([...blockPath, i], { ...existingAttrs, ...styleAttrs });
      }

      // Step 6: Clean up empty inlines produced by boundary splits
      // Re-read after styling
      const finalBlockNode = readBlockNode();
      const finalInlines = ((finalBlockNode as ElementNode).children ?? []).filter(
        (c): c is ElementNode => c.type === 'inline',
      );
      // Delete empty inlines from back to front, but keep at least 1
      for (let i = finalInlines.length - 1; i >= 0 && finalInlines.length > 1; i--) {
        if (inlineTextLen(finalInlines[i]) === 0) {
          tree.editByPath([...blockPath, i], [...blockPath, i + 1]);
          finalInlines.splice(i, 1);
        }
      }
    });

    // Update cache in-place
    this.setBlockByRegion(currentDoc, blockPath, region, updated);
    this.cachedDoc = currentDoc;
    this.dirty = false;
  }

  insertBlock(index: number, block: Block): void {
    const currentDoc = this.getDocument();
    const off = this.bodyTreeOffset(currentDoc);
    this.doc.update((root) => {
      const tree = root.content;
      if (!tree || typeof tree.getRootTreeNode !== 'function') return;
      tree.editByPath([index + off], [index + off], buildBlockNode(block));
    });
    // Update cache in-place
    currentDoc.blocks.splice(index, 0, block);
    this.cachedDoc = currentDoc;
    this.dirty = false;
  }

  insertBlockAfter(siblingBlockId: string, block: Block): void {
    const currentDoc = this.getDocument();
    const { path: siblingPath, region } = this.resolveBlockTreePath(siblingBlockId, currentDoc);

    // Insert position is immediately after the sibling
    const insertPath = [...siblingPath];
    insertPath[insertPath.length - 1] += 1;

    this.doc.update((root) => {
      const tree = root.content;
      if (!tree || typeof tree.getRootTreeNode !== 'function') return;
      tree.editByPath(insertPath, insertPath, buildBlockNode(block));
    });

    // Update cache in-place
    const blocksArray = this.getBlocksArrayForPath(currentDoc, siblingPath, region);
    const localIdx = this.isCellBlockPath(siblingPath, region)
      ? siblingPath[siblingPath.length - 1]
      : this.getRegionBlocks(currentDoc, siblingPath, region).topIndex;
    blocksArray.splice(localIdx + 1, 0, block);
    this.cachedDoc = currentDoc;
    this.dirty = false;
  }

  deleteBlock(id: string): void {
    const currentDoc = this.getDocument();
    const { path: blockPath, region } = this.resolveBlockTreePath(id, currentDoc);

    const endPath = [...blockPath];
    endPath[endPath.length - 1] += 1;

    this.doc.update((root) => {
      const tree = root.content;
      if (!tree || typeof tree.getRootTreeNode !== 'function') return;
      tree.editByPath(blockPath, endPath);
    });

    // Update cache in-place
    const blocksArray = this.getBlocksArrayForPath(currentDoc, blockPath, region);
    const localIdx = blockPath[blockPath.length - 1];
    blocksArray.splice(localIdx, 1);
    this.cachedDoc = currentDoc;
    this.dirty = false;
  }

  deleteBlockByIndex(index: number): void {
    const currentDoc = this.getDocument();
    const off = this.bodyTreeOffset(currentDoc);
    this.doc.update((root) => {
      const tree = root.content;
      if (!tree || typeof tree.getRootTreeNode !== 'function') return;
      tree.editByPath([index + off], [index + off + 1]);
    });
    // Update cache in-place
    currentDoc.blocks.splice(index, 1);
    this.cachedDoc = currentDoc;
    this.dirty = false;
  }

  splitBlock(
    blockId: string,
    offset: number,
    newBlockId: string,
    newBlockType: BlockType,
  ): void {
    const currentDoc = this.getDocument();
    const { path: blockPath, region } = this.resolveBlockTreePath(blockId, currentDoc);
    const block = this.getBlockByRegion(currentDoc, blockPath, region);
    if (isDebug()) {
      console.log(`[DOC] splitBlock blockId=${blockId.slice(0, 6)} offset=${offset} newId=${newBlockId.slice(0, 6)} newType=${newBlockType} path=[${blockPath}] region=${region}`);
      console.log(`[DOC]   cache BEFORE: ${describeBlock(block)}`);
    }

    if (block.type === 'table' || block.type === 'horizontal-rule' || block.type === 'page-break') {
      throw new Error(`splitBlock does not support ${block.type} blocks`);
    }

    this.doc.update((root) => {
      const tree = root.content;
      if (!tree || typeof tree.getRootTreeNode !== 'function') return;

      // Resolve offset from the actual Yorkie tree, not the cache.
      const treeRoot = tree.getRootTreeNode();
      const blockNode = this.getTreeBlockNode(treeRoot, blockPath);
      const { inlineIndex, charOffset } = this.resolveBlockNodeOffset(blockNode, offset);

      // Native CRDT split: single atomic operation at splitLevel=2.
      // splitLevel=2 because the text position is 2 levels below block:
      //   doc → block → inline → text(charOffset)
      // Two splits are needed: text→inline split + inline→block split.
      tree.editByPath(
        [...blockPath, inlineIndex, charOffset],
        [...blockPath, inlineIndex, charOffset],
        undefined,
        2,
      );

      // The split duplicated all attributes. Update the "after" block.
      const afterPath = [...blockPath];
      afterPath[afterPath.length - 1] += 1;
      const afterAttrs: Record<string, string> = {
        id: newBlockId,
        type: newBlockType,
        ...serializeBlockStyle(block.style),
      };
      if (newBlockType === 'list-item' && block.listKind !== undefined) {
        afterAttrs.listKind = block.listKind;
        if (block.listLevel !== undefined) {
          afterAttrs.listLevel = String(block.listLevel);
        }
      }
      if (newBlockType === 'heading' && block.headingLevel !== undefined) {
        afterAttrs.headingLevel = String(block.headingLevel);
      }
      tree.styleByPath(afterPath, afterAttrs);
    });

    // Update cache in-place using the pure-function result
    const [before, after] = applySplitBlock(block, offset, newBlockId, newBlockType);
    const blocksArray = this.getBlocksArrayForPath(currentDoc, blockPath, region);
    const localIdx = blockPath[blockPath.length - 1];
    blocksArray[localIdx] = before;
    blocksArray.splice(localIdx + 1, 0, after);
    this.cachedDoc = currentDoc;
    this.dirty = false;
    if (isDebug()) {
      console.log(`[DOC]   cache AFTER:  before=${describeBlock(before)} after=${describeBlock(after)}`);
      this.logTreeState('splitBlock', blockPath);
    }
  }

  mergeBlock(blockId: string, nextBlockId: string): void {
    if (blockId === nextBlockId) throw new Error('Cannot merge a block with itself');
    const currentDoc = this.getDocument();
    const { path: blockPath, region } = this.resolveBlockTreePath(blockId, currentDoc);
    const { path: nextPath, region: nextRegion } = this.resolveBlockTreePath(nextBlockId, currentDoc);

    if (region !== nextRegion) throw new Error('Cannot merge blocks across regions');

    const firstBlock = this.getBlockByRegion(currentDoc, blockPath, region);
    const nextBlock = this.getBlockByRegion(currentDoc, nextPath, nextRegion);
    if (isDebug()) {
      console.log(`[DOC] mergeBlock first=${blockId.slice(0, 6)} next=${nextBlockId.slice(0, 6)} path=[${blockPath}] nextPath=[${nextPath}] region=${region}`);
      console.log(`[DOC]   cache BEFORE first: ${describeBlock(firstBlock)}`);
      console.log(`[DOC]   cache BEFORE next:  ${describeBlock(nextBlock)}`);
    }

    // Verify blocks are adjacent (last path segment differs by 1)
    const blockLastIdx = blockPath[blockPath.length - 1];
    const nextLastIdx = nextPath[nextPath.length - 1];
    if (nextLastIdx !== blockLastIdx + 1) {
      throw new Error('Blocks to merge must be adjacent and in order');
    }

    this.doc.update((root) => {
      const tree = root.content;
      if (!tree || typeof tree.getRootTreeNode !== 'function') return;
      // Read inline count from the actual tree, not the cache, because
      // previous split/merge operations can leave the tree with a different
      // number of inline nodes than the cache (e.g. split fragments).
      const treeRoot = tree.getRootTreeNode();
      const blockNode = this.getTreeBlockNode(treeRoot, blockPath) as ElementNode;
      const treeInlineCount = (blockNode.children ?? []).filter(
        (c) => c.type === 'inline',
      ).length;
      // Delete the boundary between the two blocks. This range starts just
      // past the last inline of the first block and ends just before the
      // first inline of the next block, causing Yorkie Tree to merge them.
      tree.editByPath([...blockPath, treeInlineCount], [...nextPath, 0]);
    });

    const merged = applyMergeBlocks(firstBlock, nextBlock);

    // Update cache in-place
    const blocksArray = this.getBlocksArrayForPath(currentDoc, blockPath, region);
    const localIdx = blockPath[blockPath.length - 1];
    const nextLocalIdx = nextPath[nextPath.length - 1];
    blocksArray[localIdx] = merged;
    blocksArray.splice(nextLocalIdx, 1);
    this.cachedDoc = currentDoc;
    this.dirty = false;
    if (isDebug()) {
      console.log(`[DOC]   cache AFTER:  ${describeBlock(merged)}`);
      this.logTreeState('mergeBlock', blockPath);
    }
  }

  // -----------------------------------------------------------------------
  // Table granular updates
  // -----------------------------------------------------------------------

  /**
   * Resolve a table block's tree path. For top-level tables, returns a
   * single-element array with the tree-adjusted index. For nested tables
   * (inside a cell), returns the full path segments through the tree
   * hierarchy: [parentTableIdx, rowIdx, cellIdx, blockIdx, ...].
   */
  private resolveTableTreePath(tableBlockId: string): number[] {
    const currentDoc = this.getDocument();

    // Check if it's a top-level block
    const bodyIdx = currentDoc.blocks.findIndex((b) => b.id === tableBlockId);
    if (bodyIdx !== -1) {
      return [bodyIdx + this.bodyTreeOffset(currentDoc)];
    }

    // Nested table — recursively search through the document structure
    function findInBlocks(blocks: Block[], targetId: string, basePath: number[]): number[] | null {
      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        if (block.id === targetId) {
          return [...basePath, i];
        }
        if (block.type === 'table' && block.tableData) {
          for (let r = 0; r < block.tableData.rows.length; r++) {
            for (let c = 0; c < block.tableData.rows[r].cells.length; c++) {
              const cell = block.tableData.rows[r].cells[c];
              const result = findInBlocks(cell.blocks, targetId, [...basePath, i, r, c]);
              if (result) return result;
            }
          }
        }
      }
      return null;
    }

    const offset = this.bodyTreeOffset(currentDoc);
    const path = findInBlocks(currentDoc.blocks, tableBlockId, []);

    if (!path) {
      throw new Error(`Table block not found: ${tableBlockId}`);
    }

    // Add the body tree offset to the first segment
    path[0] += offset;
    return path;
  }

  /** Returns body array index and tree-adjusted index for a table block. */
  private findTableIndex(tableBlockId: string): { bodyIdx: number; treeIdx: number } {
    const path = this.resolveTableTreePath(tableBlockId);
    if (path.length === 1) {
      const currentDoc = this.getDocument();
      return { bodyIdx: path[0] - this.bodyTreeOffset(currentDoc), treeIdx: path[0] };
    }
    throw new Error(
      `Cannot use findTableIndex for nested table ${tableBlockId}; use resolveTableTreePath instead`,
    );
  }

  /**
   * Resolve the table Block from the cached document using the tree path
   * returned by resolveTableTreePath(). For top-level tables, this indexes
   * into `doc.blocks`. For nested tables, it walks through the table
   * hierarchy (row → cell → blocks).
   */
  private resolveTableBlock(treePath: number[], doc: Document): Block {
    const offset = this.bodyTreeOffset(doc);
    const bodyIdx = treePath[0] - offset;
    let block = doc.blocks[bodyIdx];
    // Walk deeper for nested tables: path segments after the first are
    // [rowIdx, colIdx, blockIdx] triplets leading to the target block.
    for (let i = 1; i < treePath.length; i += 3) {
      const r = treePath[i];
      const c = treePath[i + 1];
      const b = treePath[i + 2];
      block = block.tableData!.rows[r].cells[c].blocks[b];
    }
    return block;
  }

  insertTableRow(tableBlockId: string, atIndex: number, row: TableRow): void {
    const tablePath = this.resolveTableTreePath(tableBlockId);
    const rowNode = buildRowNode(row);
    this.doc.update((root) => {
      root.content.editByPath([...tablePath, atIndex], [...tablePath, atIndex], rowNode);
    });
    const currentDoc = this.getDocument();
    const block = this.resolveTableBlock(tablePath, currentDoc);
    block.tableData!.rows.splice(atIndex, 0, row);
    this.cachedDoc = currentDoc;
    this.dirty = false;
  }

  deleteTableRow(tableBlockId: string, rowIndex: number): void {
    const tablePath = this.resolveTableTreePath(tableBlockId);
    this.doc.update((root) => {
      root.content.editByPath([...tablePath, rowIndex], [...tablePath, rowIndex + 1]);
    });
    const currentDoc = this.getDocument();
    const block = this.resolveTableBlock(tablePath, currentDoc);
    block.tableData!.rows.splice(rowIndex, 1);
    this.cachedDoc = currentDoc;
    this.dirty = false;
  }

  insertTableColumn(tableBlockId: string, atIndex: number, cells: TableCell[]): void {
    const tablePath = this.resolveTableTreePath(tableBlockId);
    this.doc.update((root) => {
      const tree = root.content;
      for (let r = 0; r < cells.length; r++) {
        tree.editByPath(
          [...tablePath, r, atIndex],
          [...tablePath, r, atIndex],
          buildCellNode(cells[r]),
        );
      }
    });
    const currentDoc = this.getDocument();
    const block = this.resolveTableBlock(tablePath, currentDoc);
    const td = block.tableData!;
    td.rows.forEach((row, i) => {
      row.cells.splice(atIndex, 0, cells[i]);
    });
    this.cachedDoc = currentDoc;
    this.dirty = false;
  }

  deleteTableColumn(tableBlockId: string, colIndex: number): void {
    const tablePath = this.resolveTableTreePath(tableBlockId);
    const currentDoc = this.getDocument();
    const block = this.resolveTableBlock(tablePath, currentDoc);
    const rowCount = block.tableData!.rows.length;
    this.doc.update((root) => {
      const tree = root.content;
      for (let r = 0; r < rowCount; r++) {
        tree.editByPath([...tablePath, r, colIndex], [...tablePath, r, colIndex + 1]);
      }
    });
    block.tableData!.rows.forEach((row) => {
      row.cells.splice(colIndex, 1);
    });
    this.cachedDoc = currentDoc;
    this.dirty = false;
  }

  updateTableCell(
    tableBlockId: string, rowIndex: number, colIndex: number, cell: TableCell,
  ): void {
    const tablePath = this.resolveTableTreePath(tableBlockId);
    const cellNode = buildCellNode(cell);
    this.doc.update((root) => {
      root.content.editByPath(
        [...tablePath, rowIndex, colIndex],
        [...tablePath, rowIndex, colIndex + 1],
        cellNode,
      );
    });
    const currentDoc = this.getDocument();
    const block = this.resolveTableBlock(tablePath, currentDoc);
    block.tableData!.rows[rowIndex].cells[colIndex] = cell;
    this.cachedDoc = currentDoc;
    this.dirty = false;
  }

  applyCellStyle(
    tableBlockId: string, rowIndex: number, colIndex: number,
    style: Partial<CellStyle>,
  ): void {
    const tablePath = this.resolveTableTreePath(tableBlockId);
    const currentDoc = this.getDocument();
    const block = this.resolveTableBlock(tablePath, currentDoc);
    const cell = block.tableData!.rows[rowIndex].cells[colIndex];
    const merged = { ...cell.style, ...style };

    // Build serialized attributes for the cell node
    const attrs = serializeCellStyle({ ...cell, style: merged });

    this.doc.update((root) => {
      const tree = root.content;
      if (!tree || typeof tree.getRootTreeNode !== 'function') return;
      tree.styleByPath([...tablePath, rowIndex, colIndex], attrs);
    });

    // Update cache after Yorkie update succeeds
    cell.style = merged;

    this.cachedDoc = currentDoc;
    this.dirty = false;
  }

  applyCellSpan(
    tableBlockId: string, rowIndex: number, colIndex: number,
    span: { colSpan?: number; rowSpan?: number },
  ): void {
    const tablePath = this.resolveTableTreePath(tableBlockId);
    const currentDoc = this.getDocument();
    const block = this.resolveTableBlock(tablePath, currentDoc);
    const cell = block.tableData!.rows[rowIndex].cells[colIndex];

    const cellPath = [...tablePath, rowIndex, colIndex];
    const attrsToSet: Record<string, string> = {};
    const attrsToRemove: string[] = [];

    if (span.colSpan !== undefined) {
      if (span.colSpan !== 1) {
        attrsToSet.colSpan = String(span.colSpan);
      } else {
        attrsToRemove.push('colSpan');
      }
    }
    if (span.rowSpan !== undefined) {
      if (span.rowSpan !== 1) {
        attrsToSet.rowSpan = String(span.rowSpan);
      } else {
        attrsToRemove.push('rowSpan');
      }
    }

    this.doc.update((root) => {
      const tree = root.content;
      if (!tree || typeof tree.getRootTreeNode !== 'function') return;
      if (Object.keys(attrsToSet).length > 0) {
        tree.styleByPath(cellPath, attrsToSet);
      }
      if (attrsToRemove.length > 0) {
        const endPath = [...cellPath];
        endPath[endPath.length - 1] += 1;
        tree.removeStyleByPath(cellPath, endPath, attrsToRemove);
      }
    });

    // Update cache after Yorkie update succeeds
    if (span.colSpan !== undefined) {
      cell.colSpan = span.colSpan === 1 ? undefined : span.colSpan;
    }
    if (span.rowSpan !== undefined) {
      cell.rowSpan = span.rowSpan === 1 ? undefined : span.rowSpan;
    }

    this.cachedDoc = currentDoc;
    this.dirty = false;
  }

  updateTableAttrs(tableBlockId: string, attrs: { cols: number[]; rowHeights?: (number | undefined)[] }): void {
    const tablePath = this.resolveTableTreePath(tableBlockId);
    const currentDoc = this.getDocument();
    const block = this.resolveTableBlock(tablePath, currentDoc);
    block.tableData!.columnWidths = attrs.cols;
    if (attrs.rowHeights !== undefined) {
      block.tableData!.rowHeights = attrs.rowHeights;
    }

    // styleByPath merges attributes — it never removes existing keys.
    // No call site currently transitions rowHeights from set → unset,
    // so removeStyleByPath is not needed here. If that changes, add:
    //   tree.removeStyleByPath(tablePath, endPath, ['rowHeights']);
    const nodeAttrs = serializeTableAttrs(attrs.cols, attrs.rowHeights);

    this.doc.update((root) => {
      const tree = root.content;
      if (!tree || typeof tree.getRootTreeNode !== 'function') return;
      tree.styleByPath(tablePath, nodeAttrs);
    });

    this.cachedDoc = currentDoc;
    this.dirty = false;
  }

  setPageSetup(setup: PageSetup): void {
    this.doc.update((root) => {
      root.pageSetup = {
        paperSize: { ...setup.paperSize },
        orientation: setup.orientation,
        margins: { ...setup.margins },
      };
    });
    this.dirty = true;
    this.cachedDoc = null;
  }

  // -----------------------------------------------------------------------
  // Undo / Redo (local snapshot stack — Phase 1)
  // -----------------------------------------------------------------------

  snapshot(): void {
    const current = this.getDocument();
    this.undoStack.push(cloneDocument(current));
    this.redoStack = [];
  }

  undo(): void {
    if (!this.canUndo()) return;
    const current = this.getDocument();
    this.redoStack.push(cloneDocument(current));
    const previous = this.undoStack.pop()!;
    this.writeFullDocument(previous);
    this.dirty = true;
    this.cachedDoc = null;
  }

  redo(): void {
    if (!this.canRedo()) return;
    const current = this.getDocument();
    this.undoStack.push(cloneDocument(current));
    const next = this.redoStack.pop()!;
    this.writeFullDocument(next);
    this.dirty = true;
    this.cachedDoc = null;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  // -----------------------------------------------------------------------
  // Internal: write a full document to the Yorkie tree
  // -----------------------------------------------------------------------

  /**
   * Replace the entire tree content with the given document.
   * This deletes all existing blocks and inserts new ones.
   */
  private writeFullDocument(document: Document): void {
    this.doc.update((root) => {
      const tree = root.content;

      // Build the full list of children: header?, block*, footer?
      const buildTreeChildren = (): ElementNode[] => {
        const children: ElementNode[] = [];
        if (document.header) {
          children.push({
            type: 'header',
            attributes: { marginFromEdge: String(document.header.marginFromEdge) },
            children: document.header.blocks.map(buildBlockNode),
          });
        }
        children.push(...document.blocks.map(buildBlockNode));
        if (document.footer) {
          children.push({
            type: 'footer',
            attributes: { marginFromEdge: String(document.footer.marginFromEdge) },
            children: document.footer.blocks.map(buildBlockNode),
          });
        }
        return children;
      };

      // If tree isn't a Tree CRDT yet, create one with the document content.
      if (!tree || typeof tree.getRootTreeNode !== 'function') {
        const children = buildTreeChildren();
        root.content = new Tree({
          type: 'doc',
          children: children.length > 0 ? children : [],
        });

        if (document.pageSetup) {
          root.pageSetup = {
            paperSize: { ...document.pageSetup.paperSize },
            orientation: document.pageSetup.orientation,
            margins: { ...document.pageSetup.margins },
          };
        }
        return;
      }

      const treeRoot = tree.getRootTreeNode() as ElementNode;
      const childCount = (treeRoot.children ?? []).length;

      // Delete all existing children (header, blocks, footer)
      if (childCount > 0) {
        tree.editByPath([0], [childCount]);
      }

      // Insert all new children
      const children = buildTreeChildren();
      if (children.length > 0) {
        tree.editBulkByPath([0], [0], children);
      }

      // Update pageSetup outside the tree
      if (document.pageSetup) {
        root.pageSetup = {
          paperSize: { ...document.pageSetup.paperSize },
          orientation: document.pageSetup.orientation,
          margins: { ...document.pageSetup.margins },
        };
      }
    });
  }

  /**
   * Update this client's cursor position in Yorkie presence.
   * Called from DocsView when the local cursor moves.
   */
  updateCursorPos(
    pos: { blockId: string; offset: number } | null,
    selection?: {
      anchor: { blockId: string; offset: number };
      focus: { blockId: string; offset: number };
      tableCellRange?: {
        blockId: string;
        start: { rowIndex: number; colIndex: number };
        end: { rowIndex: number; colIndex: number };
      };
    } | null,
  ): void {
    this.doc.update((_, p) => {
      p.set({
        activeCursorPos: pos ?? undefined,
        activeSelection: selection ?? undefined,
      });
    });
  }

  /**
   * Get other peers' presences (cursor positions + user info).
   */
  getPresences(): Array<{
    clientID: string;
    presence: DocsPresence;
  }> {
    return this.doc.getOthersPresences();
  }
}
