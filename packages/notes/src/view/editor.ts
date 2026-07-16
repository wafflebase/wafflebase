import { markdown } from '@codemirror/lang-markdown';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { vim } from '@replit/codemirror-vim';
import { basicSetup } from '@uiw/codemirror-extensions-basic-setup';
import { xcodeDark, xcodeLight } from '@uiw/codemirror-theme-xcode';
import type { NoteStore } from '../store/store.js';
import { noteStoreFacet, noteSync } from './note-sync.js';
import {
  noteRemoteSelections,
  noteRemoteSelectionsTheme,
} from './remote-selection.js';
import { NotePreview } from './preview.js';
import {
  computeActiveFormats,
  toggleBold,
  toggleItalic,
  toggleStrikethrough,
  toggleLink,
  insertTable,
  type NoteInlineFormats,
} from './commands.js';

export type ThemeMode = 'light' | 'dark';

/**
 * Pane layout mode (mirrors CodePair's editor modes):
 * - `edit` — editor only
 * - `both` — editor + preview split
 * - `view` — preview only (reading mode)
 */
export type NoteViewMode = 'edit' | 'both' | 'view';

/** Editor keybinding mode (mirrors CodePair's CodeKeyType). */
export type NoteKeymap = 'default' | 'vim';

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
  /** Switch the editor keybinding mode (default / vim). */
  setKeymap(mode: NoteKeymap): void;
  /** Current editor keybinding mode. */
  getKeymap(): NoteKeymap;
  /** Toggle `**bold**` around the selection. */
  toggleBold(): void;
  /** Toggle `*italic*` around the selection. */
  toggleItalic(): void;
  /** Toggle `~~strikethrough~~` around the selection. */
  toggleStrikethrough(): void;
  /** Wrap the selection as a `[text](url)` link, or unwrap the link at cursor. */
  toggleLink(): void;
  /** Insert a `rows`×`cols` markdown table skeleton at the cursor. */
  insertTable(rows: number, cols: number): void;
  /** Inline markdown formats active at the current selection. */
  getActiveFormats(): NoteInlineFormats;
  /**
   * Register a callback fired whenever the selection or document changes, with
   * the inline formats now active (drives toolbar toggle highlighting). Only
   * one callback is kept; call with `null` to clear.
   */
  onSelectionChange(cb: ((formats: NoteInlineFormats) => void) | null): void;
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

  // Draggable divider between the editor and preview (split mode only), so the
  // user can adjust the two panes' widths — the native equivalent of CodePair's
  // react-resizable-layout splitter.
  const divider = document.createElement('div');
  divider.dataset.role = 'note-divider';
  divider.style.flex = '0 0 auto';
  divider.style.width = '7px';
  divider.style.cursor = 'col-resize';
  divider.style.alignSelf = 'stretch';
  divider.style.background = 'var(--border, rgba(0,0,0,0.08))';
  divider.style.backgroundClip = 'content-box';
  divider.style.padding = '0 3px';
  divider.style.userSelect = 'none';
  divider.setAttribute('role', 'separator');
  divider.setAttribute('aria-orientation', 'vertical');

  container.appendChild(editorEl);
  container.appendChild(divider);
  container.appendChild(preview.el);

  const themeExt = (mode: ThemeMode) =>
    mode === 'light' ? xcodeLight : xcodeDark;

  const currentDoc = () => view.state.doc.toString();
  const renderPreview = () => preview.render(currentDoc());

  // Notifies the host (toolbar) of the active inline formats as the selection
  // or document changes, so it can highlight the format toggles.
  let selectionCb: ((formats: NoteInlineFormats) => void) | null = null;

  // Editor keybinding mode; `vim()` must sit at the front of the extension
  // list (before the default keymaps) to take precedence.
  let currentKeymap: NoteKeymap = 'default';

  const buildExtensions = (mode: ThemeMode): Extension[] => [
    currentKeymap === 'vim' ? vim() : [],
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
      if (u.docChanged || u.selectionSet) {
        selectionCb?.(computeActiveFormats(u.state));
      }
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
  let splitRatio = 0.5; // editor's share of the width in split mode
  const applyViewMode = (mode: NoteViewMode) => {
    currentViewMode = mode;
    const showEditor = mode !== 'view';
    const showPreview = mode !== 'edit';
    const split = showEditor && showPreview;
    editorEl.style.display = showEditor ? '' : 'none';
    preview.el.style.display = showPreview ? '' : 'none';
    divider.style.display = split ? '' : 'none';
    if (split) {
      editorEl.style.flex = `1 1 ${(splitRatio * 100).toFixed(3)}%`;
      preview.el.style.flex = `1 1 ${((1 - splitRatio) * 100).toFixed(3)}%`;
    } else {
      editorEl.style.flex = showEditor ? '1 1 100%' : '0 0 0';
      preview.el.style.flex = showPreview ? '1 1 100%' : '0 0 0';
    }
    if (showPreview) renderPreview();
    if (showEditor) view.requestMeasure();
  };
  applyViewMode(viewMode);

  // Divider drag: adjust splitRatio from the pointer x within the container.
  const onDividerPointerDown = (e: PointerEvent) => {
    if (currentViewMode !== 'both') return;
    e.preventDefault();
    const rect = container.getBoundingClientRect();
    const onMove = (ev: PointerEvent) => {
      const ratio = (ev.clientX - rect.left) / rect.width;
      splitRatio = Math.max(0.15, Math.min(0.85, ratio));
      editorEl.style.flex = `1 1 ${(splitRatio * 100).toFixed(3)}%`;
      preview.el.style.flex = `1 1 ${((1 - splitRatio) * 100).toFixed(3)}%`;
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
      view.requestMeasure();
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  divider.addEventListener('pointerdown', onDividerPointerDown);

  // Proportional scroll sync between the editor scroller and the preview,
  // active only in split ('both') mode. Mirrors CodePair's react-scroll-sync,
  // which syncs by scroll percentage (not source-line mapping) and is on by
  // default. A lock flag suppresses the echo scroll event on the destination.
  const editorScroller = view.scrollDOM;
  let scrollLock = false;
  const scrollRatioOf = (el: HTMLElement) => {
    const range = el.scrollHeight - el.clientHeight;
    return range > 0 ? el.scrollTop / range : 0;
  };
  const applyScrollRatio = (el: HTMLElement, ratio: number) => {
    const range = el.scrollHeight - el.clientHeight;
    el.scrollTop = ratio * range;
  };
  const linkScroll = (src: HTMLElement, dst: HTMLElement) => () => {
    if (scrollLock || currentViewMode !== 'both') return;
    scrollLock = true;
    applyScrollRatio(dst, scrollRatioOf(src));
    requestAnimationFrame(() => {
      scrollLock = false;
    });
  };
  const onEditorScroll = linkScroll(editorScroller, preview.el);
  const onPreviewScroll = linkScroll(preview.el, editorScroller);
  editorScroller.addEventListener('scroll', onEditorScroll, { passive: true });
  preview.el.addEventListener('scroll', onPreviewScroll, { passive: true });

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
    setKeymap: (mode: NoteKeymap) => {
      if (mode === currentKeymap) return;
      currentKeymap = mode;
      const doc = view.state.doc.toString();
      const sel = view.state.selection;
      view.setState(
        EditorState.create({
          doc,
          selection: sel,
          extensions: buildExtensions(currentTheme),
        }),
      );
      view.focus();
    },
    getKeymap: () => currentKeymap,
    toggleBold: () => toggleBold(view),
    toggleItalic: () => toggleItalic(view),
    toggleStrikethrough: () => toggleStrikethrough(view),
    toggleLink: () => toggleLink(view),
    insertTable: (rows, cols) => insertTable(view, rows, cols),
    getActiveFormats: () => computeActiveFormats(view.state),
    onSelectionChange: (cb) => {
      selectionCb = cb;
    },
    focus: () => view.focus(),
    dispose: () => {
      editorScroller.removeEventListener('scroll', onEditorScroll);
      preview.el.removeEventListener('scroll', onPreviewScroll);
      divider.removeEventListener('pointerdown', onDividerPointerDown);
      view.destroy();
    },
  };
}
