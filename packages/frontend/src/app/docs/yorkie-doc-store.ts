import type { Document as YorkieDocument } from '@yorkie-js/react';
import yorkie, { type ElementNode, type TreeNode } from '@yorkie-js/sdk';

const { Tree } = yorkie;
import type {
  DocStore,
  Document,
  Block,
  BlockType,
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
  resolveDeleteRange,
  applyInsertText,
  applyDeleteText,
  applyInlineStyleHelper,
  applySplitBlock,
  applyMergeBlocks,
} from '@wafflebase/docs';
import type { YorkieDocsRoot } from '@/types/docs-document';
import type { DocsPresence } from '@/types/users';

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

function buildBlockNode(block: Block): ElementNode {
  // Table block: children are row → cell → block nodes
  if (block.type === 'table' && block.tableData) {
    return {
      type: 'block',
      attributes: {
        id: block.id,
        type: 'table',
        cols: block.tableData.columnWidths.join(','),
        ...(block.tableData.rowHeights && block.tableData.rowHeights.length > 0
          ? { rowHeights: block.tableData.rowHeights.map(h => h ?? '').join(',') }
          : {}),
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

  getBlock(id: string): Block | undefined {
    const document = this.getDocument();
    const block = document.blocks.find((b) => b.id === id);
    if (block) return block;
    const hBlock = document.header?.blocks.find((b) => b.id === id);
    if (hBlock) return hBlock;
    return document.footer?.blocks.find((b) => b.id === id);
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
    // Rewrite the full document to include/remove header
    const doc = this.getDocument();
    doc.header = header;
    this.writeFullDocument(doc);
    this.cachedDoc = cloneDocument(doc);
    this.dirty = false;
  }

  setFooter(footer: HeaderFooter | undefined): void {
    const doc = this.getDocument();
    doc.footer = footer;
    this.writeFullDocument(doc);
    this.cachedDoc = cloneDocument(doc);
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
   * Resolve a block ID to its Yorkie tree path prefix.
   * - Header block: [0, blockIdx]
   * - Body block:   [blockIdx + bodyOffset]
   * - Footer block: [footerTreeIdx, blockIdx]
   */
  private resolveBlockTreePath(
    blockId: string,
    doc: Document,
  ): { path: number[]; region: 'header' | 'body' | 'footer' } {
    if (doc.header) {
      const idx = doc.header.blocks.findIndex((b) => b.id === blockId);
      if (idx !== -1) return { path: [0, idx], region: 'header' };
    }
    const bodyIdx = doc.blocks.findIndex((b) => b.id === blockId);
    if (bodyIdx !== -1) {
      return { path: [bodyIdx + this.bodyTreeOffset(doc)], region: 'body' };
    }
    if (doc.footer) {
      const idx = doc.footer.blocks.findIndex((b) => b.id === blockId);
      if (idx !== -1) {
        const footerTreeIdx = this.bodyTreeOffset(doc) + doc.blocks.length;
        return { path: [footerTreeIdx, idx], region: 'footer' };
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
   * Resolve a block-level character offset into the Yorkie tree's actual
   * inline structure. The cached document may have merged adjacent same-style
   * inlines (normalizeInlines) that remain separate nodes in the Yorkie tree,
   * so paths computed from the cache can be invalid.
   */
  private resolveTreeOffset(
    treeRoot: TreeNode,
    treeBlockIdx: number,
    offset: number,
  ): { inlineIndex: number; charOffset: number } {
    const blockNode = (treeRoot as ElementNode).children![treeBlockIdx] as ElementNode;
    const inlineChildren = (blockNode.children ?? []).filter(
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

  /**
   * Check if a block lives in header or footer.
   */
  private findHeaderFooterBlock(blockId: string, doc: Document): { region: 'header' | 'footer'; blocks: Block[]; index: number } | null {
    if (doc.header) {
      const idx = doc.header.blocks.findIndex((b) => b.id === blockId);
      if (idx !== -1) return { region: 'header', blocks: doc.header.blocks, index: idx };
    }
    if (doc.footer) {
      const idx = doc.footer.blocks.findIndex((b) => b.id === blockId);
      if (idx !== -1) return { region: 'footer', blocks: doc.footer.blocks, index: idx };
    }
    return null;
  }

  /**
   * For header/footer mutations, apply the change and rewrite the full tree.
   */
  private commitHeaderFooterChange(doc: Document): void {
    this.writeFullDocument(doc);
    this.cachedDoc = doc;
    this.dirty = false;
  }

  updateBlock(id: string, block: Block): void {
    const currentDoc = this.getDocument();
    const hf = this.findHeaderFooterBlock(id, currentDoc);
    if (hf) {
      hf.blocks[hf.index] = block;
      this.commitHeaderFooterChange(currentDoc);
      return;
    }

    const index = currentDoc.blocks.findIndex((b) => b.id === id);
    if (index === -1) {
      throw new Error(`Block not found: ${id}`);
    }

    const off = this.bodyTreeOffset(currentDoc);
    this.doc.update((root) => {
      const tree = root.content;
      if (!tree || typeof tree.getRootTreeNode !== 'function') return;
      tree.editByPath([index + off], [index + off + 1], buildBlockNode(block));
    });
    // Update cache in-place instead of clearing
    currentDoc.blocks[index] = block;
    this.cachedDoc = currentDoc;
    this.dirty = false;
  }

  insertText(blockId: string, offset: number, text: string): void {
    const currentDoc = this.getDocument();
    const hf = this.findHeaderFooterBlock(blockId, currentDoc);
    if (hf) {
      hf.blocks[hf.index] = applyInsertText(hf.blocks[hf.index], offset, text);
      this.commitHeaderFooterChange(currentDoc);
      return;
    }

    const blockIdx = currentDoc.blocks.findIndex((b) => b.id === blockId);
    if (blockIdx === -1) throw new Error(`Block not found: ${blockId}`);
    const block = currentDoc.blocks[blockIdx];

    const off = this.bodyTreeOffset(currentDoc);
    // Use cache-based resolveOffset for image detection only
    const cacheResolved = resolveOffset(block, offset);
    const targetInline = block.inlines[cacheResolved.inlineIndex];

    this.doc.update((root) => {
      const tree = root.content;
      if (!tree || typeof tree.getRootTreeNode !== 'function') return;

      // Resolve offset from the actual Yorkie tree structure
      const treeRoot = tree.getRootTreeNode();
      const { inlineIndex, charOffset } = this.resolveTreeOffset(treeRoot, blockIdx + off, offset);

      if (targetInline.style.image) {
        const { image: _, ...plainStyle } = targetInline.style;
        void _;
        const newNode = buildInlineNode({ text, style: plainStyle });
        if (charOffset === 0) {
          tree.editByPath(
            [blockIdx + off, inlineIndex],
            [blockIdx + off, inlineIndex],
            newNode,
          );
        } else {
          tree.editByPath(
            [blockIdx + off, inlineIndex + 1],
            [blockIdx + off, inlineIndex + 1],
            newNode,
          );
        }
      } else {
        tree.editByPath(
          [blockIdx + off, inlineIndex, charOffset],
          [blockIdx + off, inlineIndex, charOffset],
          { type: 'text', value: text },
        );
      }
    });

    // Update cache in-place (same pattern as updateBlock)
    currentDoc.blocks[blockIdx] = applyInsertText(block, offset, text);
    this.cachedDoc = currentDoc;
    this.dirty = false;
  }

  deleteText(blockId: string, offset: number, length: number): void {
    const currentDoc = this.getDocument();
    const hf = this.findHeaderFooterBlock(blockId, currentDoc);
    if (hf) {
      hf.blocks[hf.index] = applyDeleteText(hf.blocks[hf.index], offset, length);
      this.commitHeaderFooterChange(currentDoc);
      return;
    }

    const blockIdx = currentDoc.blocks.findIndex((b) => b.id === blockId);
    if (blockIdx === -1) throw new Error(`Block not found: ${blockId}`);
    const block = currentDoc.blocks[blockIdx];

    const segments = resolveDeleteRange(block, offset, length);

    // Identify inlines that will become completely empty after deletion
    const emptyInlineIndices: number[] = [];
    for (const seg of segments) {
      const inline = block.inlines[seg.inlineIndex];
      if (seg.charFrom === 0 && seg.charTo === inline.text.length) {
        emptyInlineIndices.push(seg.inlineIndex);
      }
    }
    // Keep at least one inline in the block
    if (emptyInlineIndices.length >= block.inlines.length) {
      emptyInlineIndices.pop();
    }

    const off = this.bodyTreeOffset(currentDoc);
    this.doc.update((root) => {
      const tree = root.content;
      if (!tree || typeof tree.getRootTreeNode !== 'function') return;

      // Resolve delete segments from the actual Yorkie tree structure
      const treeRoot = tree.getRootTreeNode();
      const treeStart = this.resolveTreeOffset(treeRoot, blockIdx + off, offset);
      const treeEnd = this.resolveTreeOffset(treeRoot, blockIdx + off, offset + length);

      // Single-range delete on the Yorkie tree
      tree.editByPath(
        [blockIdx + off, treeStart.inlineIndex, treeStart.charOffset],
        [blockIdx + off, treeEnd.inlineIndex, treeEnd.charOffset],
      );

      // Remove any inlines that became empty after deletion
      const blockNode = ((tree.getRootTreeNode() as ElementNode).children![blockIdx + off]) as ElementNode;
      const inlines = (blockNode.children ?? []).filter((c) => c.type === 'inline') as ElementNode[];
      for (let i = inlines.length - 1; i >= 0; i--) {
        if (inlines.length <= 1) break; // keep at least one
        const textLen = (inlines[i].children ?? [])
          .filter((c): c is { type: 'text'; value: string } => c.type === 'text')
          .reduce((sum, t) => sum + t.value.length, 0);
        if (textLen === 0) {
          tree.editByPath([blockIdx + off, i], [blockIdx + off, i + 1]);
        }
      }
    });

    // Update cache in-place
    currentDoc.blocks[blockIdx] = applyDeleteText(block, offset, length);
    this.cachedDoc = currentDoc;
    this.dirty = false;
  }

  applyStyle(
    blockId: string,
    fromOffset: number,
    toOffset: number,
    style: Partial<InlineStyle>,
  ): void {
    const currentDoc = this.getDocument();
    const hf = this.findHeaderFooterBlock(blockId, currentDoc);
    if (hf) {
      hf.blocks[hf.index] = applyInlineStyleHelper(hf.blocks[hf.index], fromOffset, toOffset, style);
      this.commitHeaderFooterChange(currentDoc);
      return;
    }

    const blockIdx = currentDoc.blocks.findIndex((b) => b.id === blockId);
    if (blockIdx === -1) throw new Error(`Block not found: ${blockId}`);
    const block = currentDoc.blocks[blockIdx];

    const updated = applyInlineStyleHelper(block, fromOffset, toOffset, style);

    // styleByPath targets element attributes, not text ranges.
    // Use block replacement via editByPath until Yorkie supports
    // text-range style operations.
    const off = this.bodyTreeOffset(currentDoc);
    this.doc.update((root) => {
      const tree = root.content;
      if (!tree || typeof tree.getRootTreeNode !== 'function') return;
      tree.editByPath([blockIdx + off], [blockIdx + off + 1], buildBlockNode(updated));
    });

    // Update cache in-place
    currentDoc.blocks[blockIdx] = updated;
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

  deleteBlock(id: string): void {
    const currentDoc = this.getDocument();
    const hf = this.findHeaderFooterBlock(id, currentDoc);
    if (hf) {
      hf.blocks.splice(hf.index, 1);
      this.commitHeaderFooterChange(currentDoc);
      return;
    }

    const index = currentDoc.blocks.findIndex((b) => b.id === id);
    if (index === -1) {
      throw new Error(`Block not found: ${id}`);
    }
    this.deleteBlockByIndex(index);
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
    const hf = this.findHeaderFooterBlock(blockId, currentDoc);
    if (hf) {
      const [before, after] = applySplitBlock(hf.blocks[hf.index], offset, newBlockId, newBlockType);
      hf.blocks[hf.index] = before;
      hf.blocks.splice(hf.index + 1, 0, after);
      this.commitHeaderFooterChange(currentDoc);
      return;
    }

    const blockIdx = currentDoc.blocks.findIndex((b) => b.id === blockId);
    if (blockIdx === -1) throw new Error(`Block not found: ${blockId}`);
    const block = currentDoc.blocks[blockIdx];
    if (block.type === 'table' || block.type === 'horizontal-rule' || block.type === 'page-break') {
      throw new Error(`splitBlock does not support ${block.type} blocks`);
    }

    const off = this.bodyTreeOffset(currentDoc);

    this.doc.update((root) => {
      const tree = root.content;
      if (!tree || typeof tree.getRootTreeNode !== 'function') return;

      // Resolve offset from the actual Yorkie tree, not the cache.
      const treeRoot = tree.getRootTreeNode();
      const { inlineIndex, charOffset } = this.resolveTreeOffset(treeRoot, blockIdx + off, offset);

      // Native CRDT split: single atomic operation at splitLevel=2.
      // splitLevel=2 because the text position is 2 levels below block:
      //   doc → block → inline → text(charOffset)
      // Two splits are needed: text→inline split + inline→block split.
      tree.editByPath(
        [blockIdx + off, inlineIndex, charOffset],
        [blockIdx + off, inlineIndex, charOffset],
        undefined,
        2,
      );

      // The split duplicated all attributes. Update the "after" block.
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
      tree.styleByPath([blockIdx + off + 1], afterAttrs);
    });

    // Update cache in-place using the pure-function result
    const [before, after] = applySplitBlock(block, offset, newBlockId, newBlockType);
    currentDoc.blocks[blockIdx] = before;
    currentDoc.blocks.splice(blockIdx + 1, 0, after);
    this.cachedDoc = currentDoc;
    this.dirty = false;
  }

  mergeBlock(blockId: string, nextBlockId: string): void {
    if (blockId === nextBlockId) throw new Error('Cannot merge a block with itself');
    const currentDoc = this.getDocument();
    const hf1 = this.findHeaderFooterBlock(blockId, currentDoc);
    const hf2 = this.findHeaderFooterBlock(nextBlockId, currentDoc);
    if (hf1 && hf2 && hf1.region === hf2.region) {
      const merged = applyMergeBlocks(hf1.blocks[hf1.index], hf2.blocks[hf2.index]);
      hf1.blocks[hf1.index] = merged;
      hf1.blocks.splice(hf2.index, 1);
      this.commitHeaderFooterChange(currentDoc);
      return;
    }

    const blockIdx = currentDoc.blocks.findIndex((b) => b.id === blockId);
    const nextIdx = currentDoc.blocks.findIndex((b) => b.id === nextBlockId);
    if (blockIdx === -1 || nextIdx === -1) throw new Error('Block not found');
    if (nextIdx !== blockIdx + 1) throw new Error('Blocks to merge must be adjacent and in order');

    const off = this.bodyTreeOffset(currentDoc);
    const firstBlock = currentDoc.blocks[blockIdx];
    const firstBlockInlineCount = firstBlock.inlines.length;
    this.doc.update((root) => {
      const tree = root.content;
      if (!tree || typeof tree.getRootTreeNode !== 'function') return;
      // Delete the boundary between the two blocks. This range starts just
      // past the last inline of the first block and ends just before the
      // first inline of the next block, causing Yorkie Tree to merge them.
      tree.editByPath([blockIdx + off, firstBlockInlineCount], [nextIdx + off, 0]);
    });

    const merged = applyMergeBlocks(
      currentDoc.blocks[blockIdx],
      currentDoc.blocks[nextIdx],
    );

    // Update cache in-place
    currentDoc.blocks[blockIdx] = merged;
    currentDoc.blocks.splice(nextIdx, 1);
    this.cachedDoc = currentDoc;
    this.dirty = false;
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

  updateTableAttrs(tableBlockId: string, attrs: { cols: number[]; rowHeights?: (number | undefined)[] }): void {
    const tablePath = this.resolveTableTreePath(tableBlockId);
    const currentDoc = this.getDocument();
    const block = this.resolveTableBlock(tablePath, currentDoc);
    block.tableData!.columnWidths = attrs.cols;
    if (attrs.rowHeights !== undefined) {
      block.tableData!.rowHeights = attrs.rowHeights;
    }
    this.doc.update((root) => {
      const tree = root.content;
      if (!tree || typeof tree.getRootTreeNode !== 'function') return;
      // For the replace range, increment the last path segment by 1
      const endPath = [...tablePath];
      endPath[endPath.length - 1] += 1;
      tree.editByPath(tablePath, endPath, buildBlockNode(block));
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
