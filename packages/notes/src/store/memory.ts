import type { NoteStore, NotePeerSelection, NoteRemoteChange } from './store.js';
import type { Unsubscribe } from '../types.js';

/**
 * In-memory NoteStore for tests and non-collaborative use. Holds the markdown
 * as a plain string and keeps a snapshot-based undo history — there is no CRDT
 * here, so reverse ops aren't available and a whole-text snapshot per undo unit
 * is both correct (single writer) and cheap enough for a note.
 *
 * Never emits peer presence; emits a `replace` remote change on undo/redo so
 * the view picks the reverted text up the same way it picks up the Yorkie
 * store's `undoredo` events.
 */
export class MemNoteStore implements NoteStore {
  private text: string;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private batchDepth = 0;
  /** Text as of the outermost `batch()` entry; null outside a batch. */
  private batchBefore: string | null = null;
  private listeners = new Set<(change: NoteRemoteChange) => void>();

  constructor(text = '') {
    this.text = text;
  }

  getText(): string {
    return this.text;
  }

  editText(from: number, to: number, insert: string): void {
    // Outside a batch each edit is its own undo unit; inside one, `batch()`
    // has already captured the pre-state and records a single unit on exit.
    if (this.batchDepth === 0) this.pushUndo(this.text);
    this.text = this.text.slice(0, from) + insert + this.text.slice(to);
  }

  batch(fn: () => void): void {
    if (this.batchDepth++ === 0) this.batchBefore = this.text;
    try {
      fn();
    } finally {
      if (--this.batchDepth === 0) {
        // A batch that changed nothing records no undo unit (matches Yorkie,
        // where an empty `doc.update` pushes nothing).
        if (this.batchBefore !== null && this.batchBefore !== this.text) {
          this.pushUndo(this.batchBefore);
        }
        this.batchBefore = null;
      }
    }
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (prev === undefined) return;
    this.redoStack.push(this.text);
    this.text = prev;
    this.emit({ type: 'replace', content: this.text });
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (next === undefined) return;
    this.undoStack.push(this.text);
    this.text = next;
    this.emit({ type: 'replace', content: this.text });
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  subscribeRemote(listener: (change: NoteRemoteChange) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setLocalSelection(_anchor: number, _head: number | null): void {
    // no-op: no peers to publish to
  }

  getPeerSelections(): NotePeerSelection[] {
    return [];
  }

  subscribePresence(_listener: () => void): Unsubscribe {
    return () => {};
  }

  private pushUndo(before: string): void {
    this.undoStack.push(before);
    // A fresh edit invalidates the redo branch, as in every linear history.
    this.redoStack.length = 0;
  }

  private emit(change: NoteRemoteChange): void {
    for (const listener of this.listeners) listener(change);
  }
}
