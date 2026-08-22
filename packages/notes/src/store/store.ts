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

/**
 * A CodeMirror selection, in character-index coordinates. `anchor` is the fixed
 * end, `head` the moving end; `anchor === head` is a collapsed caret.
 */
export interface NoteSelection {
  anchor: number;
  head: number;
}

/**
 * One contiguous run of characters written by a single author, in CodeMirror
 * index coordinates. Feeds the blame gutter (issue #814).
 */
export interface NoteAuthorSpan {
  /** Start index, inclusive. */
  from: number;
  /** End index, exclusive. */
  to: number;
  /**
   * Display name of whoever wrote the run, or `null` when the run carries no
   * recorded authorship — text written before per-line attribution shipped.
   * An empty string means the writer had no name (anonymous editing).
   */
  author: string | null;
  /** Epoch ms the run was written; `0` when unknown (unattributed text). */
  at: number;
}

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
   * Record `selection` as the current batch's post-edit selection, folding it
   * into the batch's undo unit so undo restores the pre-edit selection and redo
   * restores this one. Called by the view from inside `batch()` once the edits
   * are applied; a no-op when no undo unit is being recorded (e.g. an
   * empty/remote-only batch).
   */
  recordSelectionForHistory(selection: NoteSelection): void;
  /**
   * Revert the last local undo unit. The resulting text change is delivered
   * back through `subscribeRemote` (so the view applies it like any other
   * out-of-band change). Returns the selection to restore in the view (in
   * CodeMirror index coordinates), or `null` when none was recorded. No-op
   * (returns `null`) when `canUndo()` is false.
   */
  undo(): NoteSelection | null;
  /**
   * Re-apply the last undone unit. Returns the selection to restore, or `null`.
   * No-op (returns `null`) when `canRedo()` is false.
   */
  redo(): NoteSelection | null;
  /** Whether there is a local unit to undo (above the seeded baseline). */
  canUndo(): boolean;
  /** Whether there is an undone local unit to redo. */
  canRedo(): boolean;
  /**
   * Authorship of the current text, as contiguous runs covering the document
   * in order. Runs written before per-line attribution shipped report
   * `author: null` — the blame gutter leaves those lines blank rather than
   * guessing a name. Called only while the blame gutter is enabled.
   */
  getAuthorSpans(): NoteAuthorSpan[];
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
