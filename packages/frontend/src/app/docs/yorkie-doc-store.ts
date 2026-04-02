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
  PageSetup,
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
      : blockType === 'horizontal-rule'
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
  const blocks = (el.children ?? [])
    .filter((c) => c.type === 'block')
    .map(treeNodeToBlock);
  return { blocks };
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
    return block;
  }

  getPageSetup(): PageSetup {
    const root = this.doc.getRoot();
    return resolvePageSetup(
      root.pageSetup ? readPageSetup(root.pageSetup) : undefined,
    );
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

  updateBlock(id: string, block: Block): void {
    const currentDoc = this.getDocument();
    const index = currentDoc.blocks.findIndex((b) => b.id === id);
    if (index === -1) {
      throw new Error(`Block not found: ${id}`);
    }

    this.doc.update((root) => {
      const tree = root.content;
      if (!tree || typeof tree.getRootTreeNode !== 'function') return;
      tree.editByPath([index], [index + 1], buildBlockNode(block));
    });
    // Update cache in-place instead of clearing
    currentDoc.blocks[index] = block;
    this.cachedDoc = currentDoc;
    this.dirty = false;
  }

  insertText(blockId: string, offset: number, text: string): void {
    const currentDoc = this.getDocument();
    const blockIdx = currentDoc.blocks.findIndex((b) => b.id === blockId);
    if (blockIdx === -1) throw new Error(`Block not found: ${blockId}`);
    const block = currentDoc.blocks[blockIdx];

    const { inlineIndex, charOffset } = resolveOffset(block, offset);

    this.doc.update((root) => {
      const tree = root.content;
      if (!tree || typeof tree.getRootTreeNode !== 'function') return;
      tree.editByPath(
        [blockIdx, inlineIndex, charOffset],
        [blockIdx, inlineIndex, charOffset],
        { type: 'text', value: text },
      );
    });

    // Update cache in-place (same pattern as updateBlock)
    currentDoc.blocks[blockIdx] = applyInsertText(block, offset, text);
    this.cachedDoc = currentDoc;
    this.dirty = false;
  }

  deleteText(blockId: string, offset: number, length: number): void {
    const currentDoc = this.getDocument();
    const blockIdx = currentDoc.blocks.findIndex((b) => b.id === blockId);
    if (blockIdx === -1) throw new Error(`Block not found: ${blockId}`);
    const block = currentDoc.blocks[blockIdx];

    const segments = resolveDeleteRange(block, offset, length);

    this.doc.update((root) => {
      const tree = root.content;
      if (!tree || typeof tree.getRootTreeNode !== 'function') return;
      // Reverse order: later segments first to preserve earlier indices
      for (let i = segments.length - 1; i >= 0; i--) {
        const seg = segments[i];
        tree.editByPath(
          [blockIdx, seg.inlineIndex, seg.charFrom],
          [blockIdx, seg.inlineIndex, seg.charTo],
        );
      }
    });

    // Update cache in-place (same pattern as updateBlock)
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
    const blockIdx = currentDoc.blocks.findIndex((b) => b.id === blockId);
    if (blockIdx === -1) throw new Error(`Block not found: ${blockId}`);
    const block = currentDoc.blocks[blockIdx];

    const updated = applyInlineStyleHelper(block, fromOffset, toOffset, style);

    // styleByPath targets element attributes, not text ranges.
    // Use block replacement via editByPath until Yorkie supports
    // text-range style operations.
    this.doc.update((root) => {
      const tree = root.content;
      if (!tree || typeof tree.getRootTreeNode !== 'function') return;
      tree.editByPath([blockIdx], [blockIdx + 1], buildBlockNode(updated));
    });

    // Update cache in-place
    currentDoc.blocks[blockIdx] = updated;
    this.cachedDoc = currentDoc;
    this.dirty = false;
  }

  insertBlock(index: number, block: Block): void {
    this.doc.update((root) => {
      const tree = root.content;
      if (!tree || typeof tree.getRootTreeNode !== 'function') return;
      tree.editByPath([index], [index], buildBlockNode(block));
    });
    // Update cache in-place
    const currentDoc = this.getDocument();
    currentDoc.blocks.splice(index, 0, block);
    this.cachedDoc = currentDoc;
    this.dirty = false;
  }

  deleteBlock(id: string): void {
    const currentDoc = this.getDocument();
    const index = currentDoc.blocks.findIndex((b) => b.id === id);
    if (index === -1) {
      throw new Error(`Block not found: ${id}`);
    }
    this.deleteBlockByIndex(index);
  }

  deleteBlockByIndex(index: number): void {
    this.doc.update((root) => {
      const tree = root.content;
      if (!tree || typeof tree.getRootTreeNode !== 'function') return;
      const treeRoot = tree.getRootTreeNode();
      const childCount = treeRoot.children?.length ?? 0;
      if (index < 0 || index >= childCount) {
        throw new Error(`Block index out of bounds: ${index}`);
      }
      tree.editByPath([index], [index + 1]);
    });
    // Update cache in-place
    const currentDoc = this.getDocument();
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
    const blockIdx = currentDoc.blocks.findIndex((b) => b.id === blockId);
    if (blockIdx === -1) throw new Error(`Block not found: ${blockId}`);
    const block = currentDoc.blocks[blockIdx];

    const [before, after] = applySplitBlock(block, offset, newBlockId, newBlockType);

    this.doc.update((root) => {
      const tree = root.content;
      if (!tree || typeof tree.getRootTreeNode !== 'function') return;
      // Replace original block with the "before" part
      tree.editByPath([blockIdx], [blockIdx + 1], buildBlockNode(before));
      // Insert the "after" part as a new block
      tree.editByPath([blockIdx + 1], [blockIdx + 1], buildBlockNode(after));
    });

    // Update cache in-place
    currentDoc.blocks[blockIdx] = before;
    currentDoc.blocks.splice(blockIdx + 1, 0, after);
    this.cachedDoc = currentDoc;
    this.dirty = false;
  }

  mergeBlock(blockId: string, nextBlockId: string): void {
    const currentDoc = this.getDocument();
    const blockIdx = currentDoc.blocks.findIndex((b) => b.id === blockId);
    const nextIdx = currentDoc.blocks.findIndex((b) => b.id === nextBlockId);
    if (blockIdx === -1 || nextIdx === -1) throw new Error('Block not found');

    const merged = applyMergeBlocks(
      currentDoc.blocks[blockIdx],
      currentDoc.blocks[nextIdx],
    );

    this.doc.update((root) => {
      const tree = root.content;
      if (!tree || typeof tree.getRootTreeNode !== 'function') return;
      // Replace first block with merged content
      tree.editByPath([blockIdx], [blockIdx + 1], buildBlockNode(merged));
      // Delete second block
      const deleteIdx = nextIdx > blockIdx ? nextIdx : nextIdx;
      tree.editByPath([deleteIdx], [deleteIdx + 1]);
    });

    // Update cache in-place
    currentDoc.blocks[blockIdx] = merged;
    currentDoc.blocks.splice(nextIdx, 1);
    this.cachedDoc = currentDoc;
    this.dirty = false;
  }

  // -----------------------------------------------------------------------
  // Table granular updates
  // -----------------------------------------------------------------------

  private findTableIndex(tableBlockId: string): number {
    const currentDoc = this.getDocument();
    const index = currentDoc.blocks.findIndex((b) => b.id === tableBlockId);
    if (index === -1) throw new Error(`Table block not found: ${tableBlockId}`);
    return index;
  }

  insertTableRow(tableBlockId: string, atIndex: number, row: TableRow): void {
    const tIdx = this.findTableIndex(tableBlockId);
    const rowNode = buildRowNode(row);
    this.doc.update((root) => {
      root.content.editByPath([tIdx, atIndex], [tIdx, atIndex], rowNode);
    });
    const currentDoc = this.getDocument();
    currentDoc.blocks[tIdx].tableData!.rows.splice(atIndex, 0, row);
    this.cachedDoc = currentDoc;
    this.dirty = false;
  }

  deleteTableRow(tableBlockId: string, rowIndex: number): void {
    const tIdx = this.findTableIndex(tableBlockId);
    this.doc.update((root) => {
      root.content.editByPath([tIdx, rowIndex], [tIdx, rowIndex + 1]);
    });
    const currentDoc = this.getDocument();
    currentDoc.blocks[tIdx].tableData!.rows.splice(rowIndex, 1);
    this.cachedDoc = currentDoc;
    this.dirty = false;
  }

  insertTableColumn(tableBlockId: string, atIndex: number, cells: TableCell[]): void {
    const tIdx = this.findTableIndex(tableBlockId);
    this.doc.update((root) => {
      const tree = root.content;
      for (let r = 0; r < cells.length; r++) {
        tree.editByPath([tIdx, r, atIndex], [tIdx, r, atIndex], buildCellNode(cells[r]));
      }
    });
    const currentDoc = this.getDocument();
    const td = currentDoc.blocks[tIdx].tableData!;
    td.rows.forEach((row, i) => {
      row.cells.splice(atIndex, 0, cells[i]);
    });
    this.cachedDoc = currentDoc;
    this.dirty = false;
  }

  deleteTableColumn(tableBlockId: string, colIndex: number): void {
    const tIdx = this.findTableIndex(tableBlockId);
    const currentDoc = this.getDocument();
    const rowCount = currentDoc.blocks[tIdx].tableData!.rows.length;
    this.doc.update((root) => {
      const tree = root.content;
      for (let r = 0; r < rowCount; r++) {
        tree.editByPath([tIdx, r, colIndex], [tIdx, r, colIndex + 1]);
      }
    });
    currentDoc.blocks[tIdx].tableData!.rows.forEach((row) => {
      row.cells.splice(colIndex, 1);
    });
    this.cachedDoc = currentDoc;
    this.dirty = false;
  }

  updateTableCell(
    tableBlockId: string, rowIndex: number, colIndex: number, cell: TableCell,
  ): void {
    const tIdx = this.findTableIndex(tableBlockId);
    const cellNode = buildCellNode(cell);
    this.doc.update((root) => {
      root.content.editByPath(
        [tIdx, rowIndex, colIndex],
        [tIdx, rowIndex, colIndex + 1],
        cellNode,
      );
    });
    const currentDoc = this.getDocument();
    currentDoc.blocks[tIdx].tableData!.rows[rowIndex].cells[colIndex] = cell;
    this.cachedDoc = currentDoc;
    this.dirty = false;
  }

  updateTableAttrs(tableBlockId: string, attrs: { cols: number[]; rowHeights?: (number | undefined)[] }): void {
    const tIdx = this.findTableIndex(tableBlockId);
    const currentDoc = this.getDocument();
    const block = currentDoc.blocks[tIdx];
    block.tableData!.columnWidths = attrs.cols;
    if (attrs.rowHeights !== undefined) {
      block.tableData!.rowHeights = attrs.rowHeights;
    }
    this.doc.update((root) => {
      const tree = root.content;
      if (!tree || typeof tree.getRootTreeNode !== 'function') return;
      tree.editByPath([tIdx], [tIdx + 1], buildBlockNode(block));
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

      // If tree isn't a Tree CRDT yet, create one with the document content.
      if (!tree || typeof tree.getRootTreeNode !== 'function') {
        const blockNodes = document.blocks.map(buildBlockNode);
        root.content = new Tree({
          type: 'doc',
          children: blockNodes.length > 0 ? blockNodes : [],
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
      const blockCount = (treeRoot.children ?? []).filter(
        (c) => c.type === 'block',
      ).length;

      // Delete all existing blocks
      if (blockCount > 0) {
        tree.editByPath([0], [blockCount]);
      }

      // Insert all new blocks
      if (document.blocks.length > 0) {
        const blockNodes = document.blocks.map(buildBlockNode);
        tree.editBulkByPath([0], [0], blockNodes);
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
