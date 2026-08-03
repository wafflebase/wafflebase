import type {
  NoteStore,
  NotePeerSelection,
  NoteRemoteChange,
  NoteSelection,
} from './store.js';
import type { Unsubscribe } from '../types.js';

/** A full editor state: the text and the selection active in it. */
interface MemState {
  text: string;
  selection: NoteSelection | null;
}

/**
 * One undo unit as the transition it reverts: `before` is restored on undo,
 * `after` on redo. Both are pinned at commit time so a later caret move can't
 * corrupt the redo restore point (matching the Yorkie store, which pins the
 * post-edit selection into the change via `{ addToHistory: true }`).
 */
interface MemUndoEntry {
  before: MemState;
  after: MemState;
}

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
  private undoStack: MemUndoEntry[] = [];
  private redoStack: MemUndoEntry[] = [];
  private batchDepth = 0;
  /** Editor state as of the outermost `batch()` entry (the pre-edit state). */
  private batchBefore: MemState | null = null;
  /**
   * The post-edit selection pinned by `recordSelectionForHistory` for the open
   * batch; null until recorded. Falls back to `currentSelection` at commit.
   */
  private batchAfterSelection: NoteSelection | null = null;
  /** Latest known live caret, tracked by `setLocalSelection`. */
  private currentSelection: NoteSelection | null = null;
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
    if (this.batchDepth === 0) {
      const before = this.currentState();
      this.text = this.text.slice(0, from) + insert + this.text.slice(to);
      this.pushUndo({ before, after: this.currentState() });
      return;
    }
    this.text = this.text.slice(0, from) + insert + this.text.slice(to);
  }

  batch(fn: () => void): void {
    if (this.batchDepth++ === 0) {
      this.batchBefore = this.currentState();
      this.batchAfterSelection = null;
    }
    try {
      fn();
    } finally {
      if (--this.batchDepth === 0) {
        // A batch that changed nothing records no undo unit (matches Yorkie,
        // where an empty `doc.update` pushes nothing).
        if (this.batchBefore !== null && this.batchBefore.text !== this.text) {
          this.pushUndo({
            before: this.batchBefore,
            after: {
              text: this.text,
              // The pinned post-edit selection, not the live caret, which a
              // later move would have drifted before redo.
              selection: this.batchAfterSelection ?? this.currentSelection,
            },
          });
        }
        this.batchBefore = null;
        this.batchAfterSelection = null;
      }
    }
  }

  recordSelectionForHistory(selection: NoteSelection): void {
    // Pin it for the batch's redo restore point, and track it live.
    if (this.batchDepth > 0) this.batchAfterSelection = selection;
    this.currentSelection = selection;
  }

  undo(): NoteSelection | null {
    const unit = this.undoStack.pop();
    if (unit === undefined) return null;
    this.redoStack.push(unit);
    this.restore(unit.before);
    return unit.before.selection;
  }

  redo(): NoteSelection | null {
    const unit = this.redoStack.pop();
    if (unit === undefined) return null;
    this.undoStack.push(unit);
    this.restore(unit.after);
    return unit.after.selection;
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

  setLocalSelection(anchor: number, head: number | null): void {
    // No peers to publish to, but tracking the live caret here keeps
    // `currentSelection` in step with the view so a batch captures the true
    // pre-edit selection as its undo unit's restore point — the role Yorkie
    // presence's live publisher plays for the collaborative store.
    this.currentSelection = head === null ? null : { anchor, head };
  }

  getPeerSelections(): NotePeerSelection[] {
    return [];
  }

  subscribePresence(_listener: () => void): Unsubscribe {
    return () => {};
  }

  /** The current editor state (text + live caret). */
  private currentState(): MemState {
    return { text: this.text, selection: this.currentSelection };
  }

  /** Apply a stored state and echo the text to remote subscribers. */
  private restore(state: MemState): void {
    this.text = state.text;
    this.currentSelection = state.selection;
    this.emit({ type: 'replace', content: this.text });
  }

  private pushUndo(unit: MemUndoEntry): void {
    this.undoStack.push(unit);
    // A fresh edit invalidates the redo branch, as in every linear history.
    this.redoStack.length = 0;
  }

  private emit(change: NoteRemoteChange): void {
    for (const listener of this.listeners) listener(change);
  }
}
