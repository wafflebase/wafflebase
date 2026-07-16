// Store
export type {
  NoteStore,
  NoteTextChange,
  NoteRemoteChange,
  NotePeerSelection,
} from './store/store.js';
export { MemNoteStore } from './store/memory.js';
export type { Unsubscribe } from './types.js';

// View
export {
  initialize,
  type NoteEditorAPI,
  type ThemeMode,
  type NoteViewMode,
} from './view/editor.js';
export type { NoteInlineFormats } from './view/commands.js';
export { noteStoreFacet, noteSync } from './view/note-sync.js';
export {
  noteRemoteSelections,
  noteRemoteSelectionsTheme,
} from './view/remote-selection.js';
