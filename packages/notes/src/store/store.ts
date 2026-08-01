import type { Unsubscribe } from '../types.js';

/** A single incremental text change, in CodeMirror index coordinates. */
export interface NoteTextChange {
  from: number;
  to: number;
  insert: string;
}

/**
 * A remote change delivered to the editor view: either incremental edits
 * (from a peer's `Text.edit`) or a full replacement (Yorkie snapshot, or the
 * `content` object itself being replaced).
 */
export type NoteRemoteChange =
  | { type: 'edits'; changes: NoteTextChange[] }
  | { type: 'replace'; content: string };

/** A peer's selection, in CodeMirror index coordinates. */
export interface NotePeerSelection {
  clientID: string;
  from: number;
  to: number;
  color: string;
  name: string;
}

/**
 * NoteStore — persistence abstraction for a markdown note.
 *
 * Mirrors the docs package's DocStore / sheets' Store pattern: the engine's
 * CodeMirror view talks only to this interface. MemNoteStore backs it with a
 * plain string (tests); the frontend's YorkieNoteStore backs it with a Yorkie
 * Text CRDT + presence (collaboration). All coordinates are CodeMirror
 * character indices; CRDT position translation lives inside YorkieNoteStore.
 *
 * Undo/redo is store-owned (as in DocStore / SlidesStore) rather than
 * view-owned: on the Yorkie store it reverts the local client's ops through
 * `doc.history`, which preserves a peer's concurrent edits. A view-local
 * CodeMirror history could only restore an absolute snapshot and would
 * clobber them.
 */
export interface NoteStore {
  /** Current full markdown text. */
  getText(): string;
  /** Apply a local edit (originating in the editor) to the model. */
  editText(from: number, to: number, insert: string): void;
  /**
   * Run `fn`, grouping every edit it makes into a single undo unit. Reentrant:
   * a nested `batch` folds into the outermost one. A batch that edits nothing
   * records no undo unit.
   */
  batch(fn: () => void): void;
  /**
   * Revert the last local undo unit. The resulting text change is delivered
   * back through `subscribeRemote` (so the view applies it like any other
   * out-of-band change) — not returned here. No-op when `canUndo()` is false.
   */
  undo(): void;
  /** Re-apply the last undone unit. No-op when `canRedo()` is false. */
  redo(): void;
  /** Whether there is a local unit to undo (above the seeded baseline). */
  canUndo(): boolean;
  /** Whether there is an undone local unit to redo. */
  canRedo(): boolean;
  /**
   * Subscribe to out-of-band changes: a peer's edit, a CRDT snapshot, or the
   * result of a local `undo()`/`redo()`. The listener receives changes already
   * translated to CodeMirror coordinates. MemNoteStore emits only for
   * undo/redo (it has no peers).
   */
  subscribeRemote(listener: (change: NoteRemoteChange) => void): Unsubscribe;
  /**
   * Publish the local selection so peers can render a remote caret.
   * `head === null` clears the local selection.
   */
  setLocalSelection(anchor: number, head: number | null): void;
  /** Peer selections (excludes self), in CodeMirror coordinates. */
  getPeerSelections(): NotePeerSelection[];
  /** Subscribe to peer presence changes. MemNoteStore never emits. */
  subscribePresence(listener: () => void): Unsubscribe;
}
