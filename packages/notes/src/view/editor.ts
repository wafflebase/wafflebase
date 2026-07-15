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

/**
 * Pane layout mode (mirrors CodePair's editor modes):
 * - `edit` — editor only
 * - `both` — editor + preview split
 * - `view` — preview only (reading mode)
 */
export type NoteViewMode = 'edit' | 'both' | 'view';

/** Public API returned by initialize(). */
export interface NoteEditorAPI {
  /** Current markdown text. */
  getText(): string;
  /** Switch the editor color theme. */
  setTheme(mode: ThemeMode): void;
  /** Switch the pane layout: editor only / split / preview only. */
  setViewMode(mode: NoteViewMode): void;
  /** Current pane layout mode. */
  getViewMode(): NoteViewMode;
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
  viewMode: NoteViewMode = 'both',
): NoteEditorAPI {
  container.style.display = 'flex';
  container.style.alignItems = 'stretch';
  container.style.height = '100%';

  const editorEl = document.createElement('div');
  editorEl.dataset.role = 'note-editor';
  editorEl.style.flex = '1 1 50%';
  // The CodeMirror `.cm-scroller` owns scrolling (see the theme below); keep
  // this wrapper clipped so there is no double scrollbar.
  editorEl.style.overflow = 'hidden';
  editorEl.style.minWidth = '0';

  const preview = new NotePreview();
  preview.el.style.flex = '1 1 50%';
  preview.el.style.overflow = 'auto';
  // Vertical padding matters: `prose` zeroes the first child's margin-top
  // (.note-preview > :first-child), so a first-line heading would otherwise
  // sit flush against the top edge.
  preview.el.style.padding = '16px 20px';
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
    // Fill the wrapper's full height (so an empty note starts full-height, not
    // collapsed to one line) and let the internal scroller handle overflow.
    EditorView.theme({
      '&': { width: '100%', height: '100%' },
      '.cm-scroller': { overflow: 'auto' },
    }),
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

  // Toggle which panes are visible for the current layout mode. The preview
  // still receives updates while hidden (the updateListener fires regardless
  // of display), so switching into it shows current content; we re-render and
  // re-measure the editor defensively on show.
  let currentViewMode: NoteViewMode = viewMode;
  const applyViewMode = (mode: NoteViewMode) => {
    currentViewMode = mode;
    const showEditor = mode !== 'view';
    const showPreview = mode !== 'edit';
    editorEl.style.display = showEditor ? '' : 'none';
    preview.el.style.display = showPreview ? '' : 'none';
    editorEl.style.flex = showEditor
      ? showPreview
        ? '1 1 50%'
        : '1 1 100%'
      : '0 0 0';
    preview.el.style.flex = showPreview
      ? showEditor
        ? '1 1 50%'
        : '1 1 100%'
      : '0 0 0';
    if (showPreview) renderPreview();
    if (showEditor) view.requestMeasure();
  };
  applyViewMode(viewMode);

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
    setViewMode: (mode: NoteViewMode) => {
      if (mode === currentViewMode) return;
      applyViewMode(mode);
    },
    getViewMode: () => currentViewMode,
    focus: () => view.focus(),
    dispose: () => view.destroy(),
  };
}
