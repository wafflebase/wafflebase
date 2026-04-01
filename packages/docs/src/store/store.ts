import type { Block, Document, PageSetup, TableRow, TableCell } from '../model/types.js';

/**
 * DocStore interface — persistence abstraction for documents.
 *
 * Follows the same pattern as the sheet package's Store interface.
 * Currently only MemDocStore exists; future YorkieDocStore will
 * implement this for real-time collaboration.
 */
export interface DocStore {
  /** Return a deep clone of the current document. */
  getDocument(): Document;
  /** Replace the document, pushing the previous state onto the undo stack. */
  setDocument(doc: Document): void;
  /**
   * Replace the internal document WITHOUT pushing to the undo stack.
   * Used by the editor to sync back after direct Doc mutations that
   * were already preceded by a snapshot() call.
   */
  replaceDocument(doc: Document): void;
  getBlock(id: string): Block | undefined;
  updateBlock(id: string, block: Block): void;
  insertBlock(index: number, block: Block): void;
  deleteBlock(id: string): void;
  deleteBlockByIndex(index: number): void;
  getPageSetup(): PageSetup;
  setPageSetup(setup: PageSetup): void;
  /** Save current state to the undo stack before a group of mutations. */
  snapshot(): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;

  // --- Table granular updates (Phase C) ---
  /** Insert a row into a table at the given index. */
  insertTableRow(tableBlockId: string, atIndex: number, row: TableRow): void;
  /** Delete a row from a table. */
  deleteTableRow(tableBlockId: string, rowIndex: number): void;
  /** Insert a column (one cell per row) at the given index. */
  insertTableColumn(tableBlockId: string, atIndex: number, cells: TableCell[]): void;
  /** Delete a column from a table. */
  deleteTableColumn(tableBlockId: string, colIndex: number): void;
  /** Update a single cell (content + style). */
  updateTableCell(
    tableBlockId: string, rowIndex: number, colIndex: number, cell: TableCell,
  ): void;
  /** Update table-level attributes (column widths, row heights). */
  updateTableAttrs(tableBlockId: string, attrs: { cols: number[]; rowHeights?: (number | undefined)[] }): void;

  /** Insert text at the given block-level character offset. */
  insertText(blockId: string, offset: number, text: string): void;
  /** Delete `length` characters starting at the given block-level offset. */
  deleteText(blockId: string, offset: number, length: number): void;
}
