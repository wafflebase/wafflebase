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
 */
export interface NoteStore {
  /** Current full markdown text. */
  getText(): string;
  /** Apply a local edit (originating in the editor) to the model. */
  editText(from: number, to: number, insert: string): void;
  /**
   * Subscribe to remote changes. The listener receives changes already
   * translated to CodeMirror coordinates. MemNoteStore never emits.
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
