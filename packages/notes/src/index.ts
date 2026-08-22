// Store
export type {
  NoteStore,
  NoteAuthorSpan,
  NoteTextChange,
  NoteRemoteChange,
  NotePeerSelection,
  NoteSelection,
} from './store/store.js';
export { MemNoteStore } from './store/memory.js';
export type { Unsubscribe } from './types.js';
export {
  MAX_DISPLAY_NAME_LENGTH,
  sanitizeDisplayName,
} from './display-name.js';

// View
export {
  initialize,
  type NoteEditorAPI,
  type NoteEditorOptions,
  type ThemeMode,
  type NoteViewMode,
  type NoteKeymap,
} from './view/editor.js';
export type { NoteInlineFormats } from './view/commands.js';
export type { NoteListKind } from './view/list-commands.js';
export type { UploadImage } from './view/image-upload.js';
export { noteStoreFacet, noteSync } from './view/note-sync.js';
export {
  noteRemoteSelections,
  noteRemoteSelectionsTheme,
} from './view/remote-selection.js';
export {
  ANONYMOUS_AUTHOR,
  computeBlameLabels,
  noteBlameGutter,
  noteBlameTracker,
} from './view/blame-gutter.js';
