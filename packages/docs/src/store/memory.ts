import type { Block, Document } from '../model/types.js';
import type { DocStore } from './store.js';

/**
 * Deep clone a document for snapshot-based undo/redo.
 */
function cloneDocument(doc: Document): Document {
  return JSON.parse(JSON.stringify(doc));
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
    return this.doc;
  }

  setDocument(doc: Document): void {
    this.pushUndo();
    this.doc = cloneDocument(doc);
    this.redoStack = [];
  }

  getBlock(id: string): Block | undefined {
    return this.doc.blocks.find((b) => b.id === id);
  }

  updateBlock(id: string, block: Block): void {
    this.pushUndo();
    const index = this.doc.blocks.findIndex((b) => b.id === id);
    if (index === -1) throw new Error(`Block not found: ${id}`);
    this.doc.blocks[index] = JSON.parse(JSON.stringify(block));
    this.redoStack = [];
  }

  insertBlock(index: number, block: Block): void {
    this.pushUndo();
    this.doc.blocks.splice(index, 0, JSON.parse(JSON.stringify(block)));
    this.redoStack = [];
  }

  deleteBlock(id: string): void {
    this.pushUndo();
    const index = this.doc.blocks.findIndex((b) => b.id === id);
    if (index === -1) throw new Error(`Block not found: ${id}`);
    this.doc.blocks.splice(index, 1);
    this.redoStack = [];
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

  private pushUndo(): void {
    this.undoStack.push(cloneDocument(this.doc));
  }
}
