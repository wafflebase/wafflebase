// DOM-free public surface for @wafflebase/notes.
// A note's content IS its markdown string, so the Node surface is just the
// store contract + the in-memory store. No view/ (DOM) modules here.
export type {
  NoteStore,
  NoteTextChange,
  NoteRemoteChange,
  NotePeerSelection,
} from './store/store.js';
export { MemNoteStore } from './store/memory.js';
export type { Unsubscribe } from './types.js';
