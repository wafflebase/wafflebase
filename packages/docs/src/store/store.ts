import type { Block, Document, PageSetup } from '../model/types.js';

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
  getPageSetup(): PageSetup;
  setPageSetup(setup: PageSetup): void;
  /** Save current state to the undo stack before a group of mutations. */
  snapshot(): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
}
