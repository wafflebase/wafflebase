import type { NoteStore, NotePeerSelection, NoteRemoteChange } from './store.js';
import type { Unsubscribe } from '../types.js';

/**
 * In-memory NoteStore for tests and non-collaborative use. Holds the markdown
 * as a plain string; never emits remote changes or peer presence.
 */
export class MemNoteStore implements NoteStore {
  private text: string;

  constructor(text = '') {
    this.text = text;
  }

  getText(): string {
    return this.text;
  }

  editText(from: number, to: number, insert: string): void {
    this.text = this.text.slice(0, from) + insert + this.text.slice(to);
  }

  subscribeRemote(_listener: (change: NoteRemoteChange) => void): Unsubscribe {
    return () => {};
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
}
