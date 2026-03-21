import type { Block, Document } from '../model/types.js';

/**
 * DocStore interface — persistence abstraction for documents.
 *
 * Follows the same pattern as the sheet package's Store interface.
 * Currently only MemDocStore exists; future YorkieDocStore will
 * implement this for real-time collaboration.
 */
export interface DocStore {
  getDocument(): Document;
  setDocument(doc: Document): void;
  getBlock(id: string): Block | undefined;
  updateBlock(id: string, block: Block): void;
  insertBlock(index: number, block: Block): void;
  deleteBlock(id: string): void;
  /** Save current state to the undo stack before a group of mutations. */
  snapshot(): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
}
