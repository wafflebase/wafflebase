import type { Block, Document, HeaderFooter, InlineStyle, PageSetup, TableRow, TableCell, BlockType } from '../model/types.js';
import { resolvePageSetup, normalizeBlockStyle } from '../model/types.js';
import type { DocStore } from './store.js';
import { applyInsertText, applyDeleteText, applyInlineStyle as applyInlineStyleHelper, applySplitBlock, applyMergeBlocks } from './block-helpers.js';

/**
 * Deep clone a document for snapshot-based undo/redo.
 */
function cloneDocument(doc: Document): Document {
  const cloned: Document = JSON.parse(JSON.stringify(doc));
  for (const block of cloned.blocks) {
    block.style = normalizeBlockStyle(block.style);
  }
  if (cloned.header) {
    for (const block of cloned.header.blocks) {
      block.style = normalizeBlockStyle(block.style);
    }
  }
  if (cloned.footer) {
    for (const block of cloned.footer.blocks) {
      block.style = normalizeBlockStyle(block.style);
    }
  }
  return cloned;
}

/**
 * In-memory DocStore implementation with snapshot-based undo/redo.
 */
export class MemDocStore implements DocStore {
  private doc: Document;
  private undoStack: Document[] = [];
  private redoStack: Document[] = [];

  constructor(doc?: Document) {
    this.doc = doc ? cloneDocument(doc) : { blocks: [] };
  }

  getDocument(): Document {
    return cloneDocument(this.doc);
  }

  setDocument(doc: Document): void {
    this.doc = cloneDocument(doc);
  }

  replaceDocument(doc: Document): void {
    this.doc = cloneDocument(doc);
  }

  getBlock(id: string): Block | undefined {
    try {
      const { blocks, index } = this.findBlockInAnyArray(id);
      return JSON.parse(JSON.stringify(blocks[index]));
    } catch {
      return undefined;
    }
  }

  updateBlock(id: string, block: Block): void {
    const { blocks, index } = this.findBlockInAnyArray(id);
    blocks[index] = JSON.parse(JSON.stringify(block));
  }

  insertBlock(index: number, block: Block): void {
    this.doc.blocks.splice(index, 0, JSON.parse(JSON.stringify(block)));
  }

  deleteBlock(id: string): void {
    const { blocks, index } = this.findBlockInAnyArray(id);
    blocks.splice(index, 1);
  }

  deleteBlockByIndex(index: number): void {
    if (index < 0 || index >= this.doc.blocks.length) {
      throw new Error(`Block index out of bounds: ${index}`);
    }
    this.doc.blocks.splice(index, 1);
  }

  getPageSetup(): PageSetup {
    return resolvePageSetup(this.doc.pageSetup);
  }

  setPageSetup(setup: PageSetup): void {
    this.doc.pageSetup = JSON.parse(JSON.stringify(setup));
  }

  getHeader(): HeaderFooter | undefined {
    return this.doc.header ? JSON.parse(JSON.stringify(this.doc.header)) : undefined;
  }

  getFooter(): HeaderFooter | undefined {
    return this.doc.footer ? JSON.parse(JSON.stringify(this.doc.footer)) : undefined;
  }

  setHeader(header: HeaderFooter | undefined): void {
    this.doc.header = header ? JSON.parse(JSON.stringify(header)) : undefined;
  }

  setFooter(footer: HeaderFooter | undefined): void {
    this.doc.footer = footer ? JSON.parse(JSON.stringify(footer)) : undefined;
  }

  undo(): void {
    if (!this.canUndo()) return;
    this.redoStack.push(cloneDocument(this.doc));
    this.doc = this.undoStack.pop()!;
  }

  redo(): void {
    if (!this.canRedo()) return;
    this.undoStack.push(cloneDocument(this.doc));
    this.doc = this.redoStack.pop()!;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  snapshot(): void {
    this.pushUndo();
    this.redoStack = [];
  }

  insertTableRow(tableBlockId: string, atIndex: number, row: TableRow): void {
    const block = this.findBlock(tableBlockId);
    block.tableData!.rows.splice(atIndex, 0, JSON.parse(JSON.stringify(row)));
  }

  deleteTableRow(tableBlockId: string, rowIndex: number): void {
    const block = this.findBlock(tableBlockId);
    block.tableData!.rows.splice(rowIndex, 1);
  }

  insertTableColumn(tableBlockId: string, atIndex: number, cells: TableCell[]): void {
    const block = this.findBlock(tableBlockId);
    block.tableData!.rows.forEach((row, i) => {
      row.cells.splice(atIndex, 0, JSON.parse(JSON.stringify(cells[i])));
    });
  }

  deleteTableColumn(tableBlockId: string, colIndex: number): void {
    const block = this.findBlock(tableBlockId);
    block.tableData!.rows.forEach((row) => {
      row.cells.splice(colIndex, 1);
    });
  }

  updateTableCell(
    tableBlockId: string, rowIndex: number, colIndex: number, cell: TableCell,
  ): void {
    const block = this.findBlock(tableBlockId);
    block.tableData!.rows[rowIndex].cells[colIndex] = JSON.parse(JSON.stringify(cell));
  }

  updateTableAttrs(tableBlockId: string, attrs: { cols: number[]; rowHeights?: (number | undefined)[] }): void {
    const block = this.findBlock(tableBlockId);
    block.tableData!.columnWidths = [...attrs.cols];
    if (attrs.rowHeights !== undefined) {
      block.tableData!.rowHeights = [...attrs.rowHeights];
    }
  }

  insertText(blockId: string, offset: number, text: string): void {
    const { blocks, index } = this.findBlockInAnyArray(blockId);
    blocks[index] = applyInsertText(blocks[index], offset, text);
  }

  deleteText(blockId: string, offset: number, length: number): void {
    const { blocks, index } = this.findBlockInAnyArray(blockId);
    blocks[index] = applyDeleteText(blocks[index], offset, length);
  }

  applyStyle(blockId: string, fromOffset: number, toOffset: number, style: Partial<InlineStyle>): void {
    const { blocks, index } = this.findBlockInAnyArray(blockId);
    blocks[index] = applyInlineStyleHelper(blocks[index], fromOffset, toOffset, style);
  }

  splitBlock(blockId: string, offset: number, newBlockId: string, newBlockType: BlockType): void {
    const { blocks, index } = this.findBlockInAnyArray(blockId);
    const [before, after] = applySplitBlock(blocks[index], offset, newBlockId, newBlockType);
    blocks[index] = before;
    blocks.splice(index + 1, 0, after);
  }

  mergeBlock(blockId: string, nextBlockId: string): void {
    if (blockId === nextBlockId) throw new Error('Cannot merge a block with itself');
    const { blocks: arr1, index: idx1 } = this.findBlockInAnyArray(blockId);
    const { blocks: arr2, index: idx2 } = this.findBlockInAnyArray(nextBlockId);
    if (arr1 !== arr2) throw new Error('Cannot merge blocks from different regions');
    arr1[idx1] = applyMergeBlocks(arr1[idx1], arr2[idx2]);
    arr2.splice(idx2, 1);
  }

  private findBlock(id: string): Block {
    const block = this.doc.blocks.find((b) => b.id === id);
    if (!block) throw new Error(`Block not found: ${id}`);
    return block;
  }

  private findBlockInAnyArray(id: string): { blocks: Block[]; index: number } {
    const bodyIdx = this.doc.blocks.findIndex((b) => b.id === id);
    if (bodyIdx !== -1) return { blocks: this.doc.blocks, index: bodyIdx };
    if (this.doc.header) {
      const hIdx = this.doc.header.blocks.findIndex((b) => b.id === id);
      if (hIdx !== -1) return { blocks: this.doc.header.blocks, index: hIdx };
    }
    if (this.doc.footer) {
      const fIdx = this.doc.footer.blocks.findIndex((b) => b.id === id);
      if (fIdx !== -1) return { blocks: this.doc.footer.blocks, index: fIdx };
    }
    throw new Error(`Block not found: ${id}`);
  }

  private pushUndo(): void {
    this.undoStack.push(cloneDocument(this.doc));
  }
}
