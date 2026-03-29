import type { Block, Document, PageSetup, TableRow, TableCell } from '../model/types.js';
import { resolvePageSetup, normalizeBlockStyle } from '../model/types.js';
import type { DocStore } from './store.js';

/**
 * Deep clone a document for snapshot-based undo/redo.
 */
function cloneDocument(doc: Document): Document {
  const cloned: Document = JSON.parse(JSON.stringify(doc));
  for (const block of cloned.blocks) {
    block.style = normalizeBlockStyle(block.style);
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
    const block = this.doc.blocks.find((b) => b.id === id);
    return block ? JSON.parse(JSON.stringify(block)) : undefined;
  }

  updateBlock(id: string, block: Block): void {
    const index = this.doc.blocks.findIndex((b) => b.id === id);
    if (index === -1) throw new Error(`Block not found: ${id}`);
    this.doc.blocks[index] = JSON.parse(JSON.stringify(block));
  }

  insertBlock(index: number, block: Block): void {
    this.doc.blocks.splice(index, 0, JSON.parse(JSON.stringify(block)));
  }

  deleteBlock(id: string): void {
    const index = this.doc.blocks.findIndex((b) => b.id === id);
    if (index === -1) throw new Error(`Block not found: ${id}`);
    this.doc.blocks.splice(index, 1);
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

  updateTableAttrs(tableBlockId: string, attrs: { cols: number[] }): void {
    const block = this.findBlock(tableBlockId);
    block.tableData!.columnWidths = [...attrs.cols];
  }

  private findBlock(id: string): Block {
    const block = this.doc.blocks.find((b) => b.id === id);
    if (!block) throw new Error(`Block not found: ${id}`);
    return block;
  }

  private pushUndo(): void {
    this.undoStack.push(cloneDocument(this.doc));
  }
}
