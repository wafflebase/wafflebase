import { indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import {
  Compartment,
  EditorSelection,
  EditorState,
  Prec,
  type Extension,
} from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { CodeMirror, vim } from '@replit/codemirror-vim';
import { basicSetup } from '@uiw/codemirror-extensions-basic-setup';
import { xcodeDark, xcodeLight } from '@uiw/codemirror-theme-xcode';
import type { NoteStore, NoteSelection } from '../store/store.js';
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
  toggleQuote,
  insertCodeBlock,
  insertFoldout,
  insertTable,
  type NoteInlineFormats,
} from './commands.js';
import {
  imageFilesOf,
  noteImageUpload,
  startImageUploads,
  type UploadImage,
} from './image-upload.js';
import { noteBlameGutter, noteBlameTracker } from './blame-gutter.js';
import {
  indentList,
  outdentList,
  setTaskChecked,
  toggleBulletList,
  toggleOrderedList,
  toggleTaskList,
} from './list-commands.js';
import { noteCheckboxInput } from './checkbox-input.js';

export type ThemeMode = 'light' | 'dark';

/**
 * Restore the caret/selection returned by `store.undo()/redo()`. The reverted
 * text has already been applied by the remote subscription without a selection
 * (a peer edit carries none), so this puts the caret back where it belonged.
 * Endpoints are clamped to the current document — a peer may have shortened it
 * since the selection was recorded. A `null` selection leaves the caret as-is.
 */
function applyRestoredSelection(
  view: EditorView,
  sel: NoteSelection | null,
): void {
  if (!sel) return;
  const len = view.state.doc.length;
  const anchor = Math.min(Math.max(0, sel.anchor), len);
  const head = Math.min(Math.max(0, sel.head), len);
  view.dispatch({
    selection: EditorSelection.range(anchor, head),
    scrollIntoView: true,
  });
}

/**
 * Route vim's `u` / `<C-r>` to the note store's Yorkie-native history.
 *
 * CodeMirror's own history extension is disabled (see `buildExtensions`), and
 * `@replit/codemirror-vim` implements those keys by calling
 * `CodeMirror.commands.undo/redo`, which delegate to `@codemirror/commands`'
 * `undo(view)` — a no-op without the history extension. The vim action reads
 * `CodeMirror.commands` at call time, so replacing the entry here is enough.
 * The store is resolved from the view's own facet, so editors that are not
 * notes (none today) fall through to the original command.
 */
const defaultVimHistory = {
  undo: CodeMirror.commands.undo,
  redo: CodeMirror.commands.redo,
};
let vimHistoryRouted = false;
function routeVimHistoryToStore(): void {
  if (vimHistoryRouted) return;
  vimHistoryRouted = true;
  const route =
    (kind: 'undo' | 'redo') =>
    (cm: CodeMirror): void => {
      const store: NoteStore | undefined = cm.cm6.state.facet(noteStoreFacet);
      // A read-only mount has nothing local to revert (and no write
      // permission), so it falls through with the rest.
      if (store && cm.cm6.state.facet(EditorView.editable)) {
        applyRestoredSelection(cm.cm6, store[kind]());
        return;
      }
      defaultVimHistory[kind](cm);
    };
  CodeMirror.commands.undo = route('undo');
  CodeMirror.commands.redo = route('redo');
}

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
  /**
   * Show or hide the blame gutter (who last edited each line), to the left of
   * the line numbers. Off unless switched on: while off the editor carries no
   * extra gutter at all, so the layout is byte-for-byte what it was before the
   * feature existed.
   */
  setShowAuthors(show: boolean): void;
  /** Whether the blame gutter is currently shown. */
  getShowAuthors(): boolean;
  /** Toggle `**bold**` around the selection. */
  toggleBold(): void;
  /** Toggle `*italic*` around the selection. */
  toggleItalic(): void;
  /** Toggle `~~strikethrough~~` around the selection. */
  toggleStrikethrough(): void;
  /** Wrap the selection as a `[text](url)` link, or unwrap the link at cursor. */
  toggleLink(): void;
  /** Prefix the selected lines with `> `, or strip it when all are quoted. */
  toggleQuote(): void;
  /** Fence the selection as a ``` code block, or open an empty fence. */
  insertCodeBlock(): void;
  /**
   * Insert a `<details>`/`<summary>` foldout skeleton at the cursor, caret
   * inside the summary. Not a toggle — foldouts nest.
   */
  insertFoldout(): void;
  /** Insert a `rows`×`cols` markdown table skeleton at the cursor. */
  insertTable(rows: number, cols: number): void;
  /**
   * Toggle `- ` bullets over every line the selection covers. All four list
   * commands below apply to the whole selected block, and toggling a kind that
   * is already on every line turns those lines back into plain paragraphs.
   */
  toggleBulletList(): void;
  /** Toggle `1. ` numbering over every line the selection covers. */
  toggleOrderedList(): void;
  /** Toggle `- [ ] ` checkboxes over every line the selection covers. */
  toggleTaskList(): void;
  /** Nest the selected list lines one level deeper. */
  indentList(): void;
  /** Move the selected list lines one level out. */
  outdentList(): void;
  /**
   * Upload the image files and insert each as `![alt](url)` at the cursor.
   * Non-image files are ignored. A no-op unless the editor was mounted with an
   * `uploadImage` option (read-only mounts never have one).
   */
  insertImageFiles(files: ArrayLike<File>): void;
  /** Whether image upload is available on this editor. */
  canInsertImage(): boolean;
  /**
   * Undo this client's last edit through the store's history. In a
   * collaborative session a peer's concurrent edit is preserved.
   */
  undo(): void;
  /** Redo the last undone local edit. */
  redo(): void;
  /** Whether there is a local edit to undo. */
  canUndo(): boolean;
  /** Whether there is an undone local edit to redo. */
  canRedo(): boolean;
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
export interface NoteEditorOptions {
  /**
   * Upload an image file and resolve with the URL to reference it by, or
   * `null` if the host handled the failure itself. Omit to disable image
   * insertion entirely (paste, drop, and `insertImageFiles` all become no-ops).
   */
  uploadImage?: UploadImage;
  /**
   * Mount with the blame gutter shown. Defaults to `false` — the feature is
   * opt-in, and while off nothing about the editor differs from before it
   * existed.
   */
  showAuthors?: boolean;
}

export function initialize(
  container: HTMLElement,
  store: NoteStore,
  theme: ThemeMode = 'light',
  readOnly = false,
  viewMode: NoteViewMode = 'both',
  options: NoteEditorOptions = {},
): NoteEditorAPI {
  routeVimHistoryToStore();
  const uploadImage = readOnly ? undefined : options.uploadImage;
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

  // Preview checkboxes write straight back into the source line, so ticking a
  // task in the preview is an ordinary document edit (synced, undoable). A
  // read-only mount passes no callback, leaving the checkboxes disabled.
  const preview = new NotePreview({
    theme,
    onToggleTask: readOnly
      ? undefined
      : (line, checked) => setTaskChecked(view, line + 1, checked),
  });
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

  // Compartments so theme / keymap switches reconfigure in place instead of
  // rebuilding the whole EditorState — a full rebuild would drop the editor's
  // view state (selection, scroll, plugin state) on every toggle.
  const themeCompartment = new Compartment();
  const keymapCompartment = new Compartment();
  // The blame gutter is two extensions with opposite ordering constraints (see
  // blame-gutter.ts), so each gets its own compartment and both are
  // reconfigured together.
  const blameGutterCompartment = new Compartment();
  const blameTrackerCompartment = new Compartment();
  let showAuthors = options.showAuthors ?? false;

  // Undo/redo live in the store (Yorkie `doc.history`), not in CodeMirror, so
  // that undo reverts only this client's ops and leaves a peer's concurrent
  // edit intact. The reverted text arrives back through the store's remote
  // subscription, which `noteSync` applies. Refresh the toolbar afterwards:
  // the store's depth changed, and the resulting transaction may land before
  // the pop is visible, so we don't rely on the docChanged listener alone.
  const runHistory = (kind: 'undo' | 'redo') => {
    // The store applies the reverted text synchronously through the remote
    // subscription (noteSync) before returning; the returned selection is the
    // caret to restore, which that text transaction did not carry.
    const restored = store[kind]();
    applyRestoredSelection(view, restored);
    selectionCb?.(computeActiveFormats(view.state));
  };
  // Mirrors @codemirror/commands' historyKeymap, minus the selection-undo
  // entries (Yorkie has no selection history). Read-only mounts get no
  // binding at all — the document is not writable, so there is nothing local
  // to revert.
  const historyKeymap: Extension = readOnly
    ? []
    : keymap.of([
        {
          key: 'Mod-z',
          run: () => {
            runHistory('undo');
            return true;
          },
        },
        {
          key: 'Mod-y',
          mac: 'Mod-Shift-z',
          run: () => {
            runHistory('redo');
            return true;
          },
        },
        {
          key: 'Mod-Shift-z',
          run: () => {
            runHistory('redo');
            return true;
          },
        },
      ]);

  const keymapExt = (): Extension => {
    // CodeMirror deliberately leaves Tab out of the default keymap (so keyboard
    // users can tab out of the editor). Bind it explicitly for indent/outdent.
    // @replit/codemirror-vim binds no Tab key and lets it fall through (it only
    // preventDefaults keys it actually handles), so indentWithTab drives Tab
    // indent in both modes; `vim()` sits ahead of it so vim still wins for every
    // key it does handle.
    if (currentKeymap === 'vim') {
      return [vim(), keymap.of([indentWithTab])];
    }
    return [
      keymap.of([indentWithTab]),
      // Escape releases the Tab-indent focus trap (WCAG 2.1.2): with Tab bound
      // to indent it no longer moves focus out, so give keyboard users an
      // explicit exit. Low precedence so autocomplete / tooltip Escape handlers
      // still win first; only blurs when nothing else consumes Escape. (Vim owns
      // Escape itself, so this is default-mode only.)
      Prec.low(
        keymap.of([
          {
            key: 'Escape',
            run: (v) => {
              v.contentDOM.blur();
              return true;
            },
          },
        ]),
      ),
    ];
  };

  const buildExtensions = (mode: ThemeMode): Extension[] => [
    keymapCompartment.of(keymapExt()),
    // After the keymap compartment so vim keeps its own history keys (`u`,
    // `<C-r>`), which route to the store via `routeVimHistoryToStore`.
    historyKeymap,
    // Before `basicSetup` (which brings the line numbers) so the blame gutter
    // renders to their left; empty while the feature is off.
    blameGutterCompartment.of(showAuthors ? noteBlameGutter : []),
    // CodeMirror's history is off: it can only restore a local snapshot, which
    // in a collaborative session overwrites whatever a peer typed in the
    // meantime. Yorkie's reverse-op undo is used instead.
    basicSetup({
      highlightSelectionMatches: false,
      history: false,
      historyKeymap: false,
    }),
    markdown(),
    // `[ ]` at the start of a line becomes a task item as the user types.
    noteCheckboxInput,
    themeCompartment.of(themeExt(mode)),
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
    // A read-only mount has no write permission, so there is nothing to upload
    // into — the extension is left off entirely rather than guarded per event.
    uploadImage ? noteImageUpload(uploadImage) : [],
    noteStoreFacet.of(store),
    noteSync,
    // After `noteSync` so it reads the store once the current local edit has
    // reached it (see blame-gutter.ts).
    blameTrackerCompartment.of(showAuthors ? noteBlameTracker : []),
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
  // `endDrag` is set while a drag is in flight so dispose() can tear down the
  // window listeners if the editor unmounts mid-drag.
  let endDrag: (() => void) | null = null;
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
      endDrag = null;
      view.requestMeasure();
    };
    endDrag = onUp;
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
      // Reconfigure the theme compartment in place; a full state rebuild would
      // reset the view state (see the compartment comment above).
      view.dispatch({
        effects: themeCompartment.reconfigure(themeExt(mode)),
      });
      // Mermaid bakes its palette into the SVG it produces, so the preview
      // needs a repaint to follow the new theme.
      preview.setTheme(mode);
      if (currentViewMode !== 'edit') renderPreview();
    },
    setViewMode: (mode: NoteViewMode) => {
      if (mode === currentViewMode) return;
      applyViewMode(mode);
    },
    getViewMode: () => currentViewMode,
    setKeymap: (mode: NoteKeymap) => {
      if (mode === currentKeymap) return;
      currentKeymap = mode;
      // Reconfigure the keymap compartment in place so the current selection
      // survives a Default <-> Vim switch.
      view.dispatch({
        effects: keymapCompartment.reconfigure(keymapExt()),
      });
      view.focus();
    },
    getKeymap: () => currentKeymap,
    setShowAuthors: (show: boolean) => {
      if (show === showAuthors) return;
      showAuthors = show;
      view.dispatch({
        effects: [
          blameGutterCompartment.reconfigure(show ? noteBlameGutter : []),
          blameTrackerCompartment.reconfigure(show ? noteBlameTracker : []),
        ],
      });
    },
    getShowAuthors: () => showAuthors,
    toggleBold: () => toggleBold(view),
    toggleItalic: () => toggleItalic(view),
    toggleStrikethrough: () => toggleStrikethrough(view),
    toggleLink: () => toggleLink(view),
    toggleQuote: () => toggleQuote(view),
    insertCodeBlock: () => insertCodeBlock(view),
    insertFoldout: () => insertFoldout(view),
    insertTable: (rows, cols) => insertTable(view, rows, cols),
    toggleBulletList: () => toggleBulletList(view),
    toggleOrderedList: () => toggleOrderedList(view),
    toggleTaskList: () => toggleTaskList(view),
    indentList: () => indentList(view),
    outdentList: () => outdentList(view),
    insertImageFiles: (files) => {
      if (!uploadImage) return;
      const images = imageFilesOf(files);
      if (images.length === 0) return;
      startImageUploads(
        view,
        images,
        view.state.selection.main.to,
        uploadImage,
      );
      // The file picker took focus; hand it back so the caret is where the
      // image will land and typing continues normally.
      view.focus();
    },
    canInsertImage: () => Boolean(uploadImage),
    undo: () => {
      runHistory('undo');
      view.focus();
    },
    redo: () => {
      runHistory('redo');
      view.focus();
    },
    canUndo: () => store.canUndo(),
    canRedo: () => store.canRedo(),
    getActiveFormats: () => computeActiveFormats(view.state),
    onSelectionChange: (cb) => {
      selectionCb = cb;
    },
    focus: () => view.focus(),
    dispose: () => {
      endDrag?.(); // tear down window listeners if a divider drag is in flight
      editorScroller.removeEventListener('scroll', onEditorScroll);
      preview.el.removeEventListener('scroll', onPreviewScroll);
      divider.removeEventListener('pointerdown', onDividerPointerDown);
      view.destroy();
    },
  };
}
