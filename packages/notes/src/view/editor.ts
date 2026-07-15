import { markdown } from '@codemirror/lang-markdown';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { basicSetup } from '@uiw/codemirror-extensions-basic-setup';
import { xcodeDark, xcodeLight } from '@uiw/codemirror-theme-xcode';
import type { NoteStore } from '../store/store.js';
import { noteStoreFacet, noteSync } from './note-sync.js';
import {
  noteRemoteSelections,
  noteRemoteSelectionsTheme,
} from './remote-selection.js';
import { NotePreview } from './preview.js';

export type ThemeMode = 'light' | 'dark';

/** Public API returned by initialize(). */
export interface NoteEditorAPI {
  /** Current markdown text. */
  getText(): string;
  /** Switch the editor color theme. */
  setTheme(mode: ThemeMode): void;
  /** Focus the editor. */
  focus(): void;
  /** Tear down the editor and its listeners. */
  dispose(): void;
}

/**
 * Mount a collaborative markdown editor into `container`.
 *
 * Left pane: CodeMirror markdown source, synced to `store` (local edits →
 * store.editText; remote changes → CM transactions). Right pane: live
 * markdown preview re-rendered from the editor content on every change
 * (so both local and remote edits reflect).
 */
export function initialize(
  container: HTMLElement,
  store: NoteStore,
  theme: ThemeMode = 'light',
  readOnly = false,
): NoteEditorAPI {
  container.style.display = 'flex';
  container.style.alignItems = 'stretch';
  container.style.height = '100%';

  const editorEl = document.createElement('div');
  editorEl.dataset.role = 'note-editor';
  editorEl.style.flex = '1 1 50%';
  editorEl.style.overflow = 'auto';
  editorEl.style.minWidth = '0';

  const preview = new NotePreview();
  preview.el.style.flex = '1 1 50%';
  preview.el.style.overflow = 'auto';
  preview.el.style.padding = '0 16px';
  preview.el.style.minWidth = '0';

  container.appendChild(editorEl);
  container.appendChild(preview.el);

  const themeExt = (mode: ThemeMode) =>
    mode === 'light' ? xcodeLight : xcodeDark;

  const currentDoc = () => view.state.doc.toString();
  const renderPreview = () => preview.render(currentDoc());

  const buildExtensions = (mode: ThemeMode): Extension[] => [
    basicSetup({ highlightSelectionMatches: false }),
    markdown(),
    themeExt(mode),
    EditorView.lineWrapping,
    EditorView.editable.of(!readOnly),
    EditorView.theme({ '&': { width: '100%' } }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) renderPreview();
    }),
    noteStoreFacet.of(store),
    noteSync,
    noteRemoteSelectionsTheme,
    noteRemoteSelections,
  ];

  const state = EditorState.create({
    doc: store.getText(),
    extensions: buildExtensions(theme),
  });

  const view = new EditorView({ state, parent: editorEl });
  renderPreview();

  let currentTheme = theme;

  return {
    getText: () => view.state.doc.toString(),
    setTheme: (mode: ThemeMode) => {
      if (mode === currentTheme) return;
      currentTheme = mode;
      // Rebuild state to swap the (non-compartmentalized) theme extension.
      // Simplicity over a Compartment: notes have a single theme extension.
      const doc = view.state.doc.toString();
      const sel = view.state.selection;
      view.setState(
        EditorState.create({
          doc,
          selection: sel,
          extensions: buildExtensions(mode),
        }),
      );
      renderPreview();
    },
    focus: () => view.focus(),
    dispose: () => view.destroy(),
  };
}
