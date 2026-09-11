import { indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import {
  Compartment,
  EditorSelection,
  EditorState,
  Prec,
  Transaction,
  type Extension,
} from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { CodeMirror, vim } from '@replit/codemirror-vim';
import { basicSetup } from '@uiw/codemirror-extensions-basic-setup';
import { xcodeDark, xcodeLight } from '@uiw/codemirror-theme-xcode';
import type { NoteStore, NoteSelection } from '../store/store.js';
import { readOnlyNoteStore } from '../store/read-only.js';
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
   * opt-in, and while off neither of its extensions is installed, so nothing
   * about the *editor* differs from before it existed. It does not gate the
   * attribution: whether an edit records who made it is the store's business
   * (`YorkieNoteStore.editText` records it either way), so this decides what a
   * reader sees and nothing about what a writer leaves behind.
   */
  showAuthors?: boolean;
}

export function initialize(
  container: HTMLElement,
  noteStore: NoteStore,
  theme: ThemeMode = 'light',
  readOnly = false,
  viewMode: NoteViewMode = 'both',
  options: NoteEditorOptions = {},
): NoteEditorAPI {
  routeVimHistoryToStore();
  // A read-only mount is guarded at the STORE first, not only at the view. The
  // view-level gates below (`EditorState.readOnly`, the `changeFilter`) only
  // see CodeMirror transactions, and the store's own mutators are reachable
  // without one — `runHistory()` is the proof, it needed a hand-written
  // `readOnly` check of its own. Everything past this line talks to the
  // guarded handle, so a write path added later is inert on a viewer mount by
  // construction. Mirrors `readOnlyDocStore` in the docs package.
  const store = readOnly ? readOnlyNoteStore(noteStore) : noteStore;
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
  // The painted band is the *content* box (`background-clip: content-box`), so
  // the padding is pure hit area: 25px total around a 1px hairline. It used to
  // be 7px, which is a fingernail on a phone — and combined with the missing
  // `touch-action` below made the split read as fixed there. `box-sizing` is
  // stated rather than inherited because the host app's CSS reset decides it
  // otherwise (Tailwind's preflight sets `border-box` on everything), and that
  // is what turns these numbers into a hairline instead of a 7px band.
  divider.style.boxSizing = 'border-box';
  divider.style.width = '25px';
  divider.style.cursor = 'col-resize';
  divider.style.alignSelf = 'stretch';
  divider.style.background = 'var(--border, rgba(0,0,0,0.08))';
  divider.style.backgroundClip = 'content-box';
  divider.style.padding = '0 12px';
  divider.style.userSelect = 'none';
  // Without this the browser claims a horizontal drag on the divider as a pan
  // /scroll gesture, so `pointermove` never reaches the resize handler on
  // touch — the pane widths could not be adjusted with a finger at all.
  divider.style.touchAction = 'none';
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
    // Undo/redo write to the store *directly*, not through a CodeMirror
    // transaction, so the read-only change filter below never sees them. A
    // read-only mount has no write permission and nothing local to revert, so
    // refuse here — this is the one API method whose write bypasses the view.
    // `store` is `readOnlyNoteStore`-guarded on such a mount anyway (its
    // `undo`/`redo` return null); this keeps the refusal local and explicit.
    if (readOnly) return;
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
    // `EditorView.editable` only drops `contenteditable`, so it stops typing
    // and nothing else: a command, a toolbar call, or any other programmatic
    // `view.dispatch` still produces a document change, and `noteSync` forwards
    // any non-remote change straight to `store.editText()` — a CRDT write. On a
    // viewer-role share link the webhook does refuse that write (enforcing is
    // the default — `isYorkieAuthEnforced`), but a refused `PushPull` wedges
    // the viewer's own sync, so the write must not be attempted in the first
    // place; and a deployment in shadow mode for a rollout would let it
    // through outright.
    //
    // So a read-only mount is enforced twice more, at the state:
    // `EditorState.readOnly` is the facet every CodeMirror command consults
    // (`@codemirror/commands`, autocomplete, the vim keymap) and is what makes
    // them decline rather than mutate...
    EditorState.readOnly.of(readOnly),
    // ...and the change filter is the chokepoint the store hangs off, the
    // engine's equivalent of the docs package's read-only store wrapper. A
    // change that never becomes a transaction never reaches `noteSync`, so
    // every local write path — the exported `NoteEditorAPI` formatting
    // commands, paste, drop, an image upload, a preview checkbox — is inert on
    // a viewer mount by construction rather than by each caller remembering to
    // check. Remote changes carry `Transaction.remote` and must still apply:
    // they are peers' edits arriving from the CRDT, which is exactly what a
    // viewer is here to read.
    readOnly
      ? EditorState.changeFilter.of((tr) =>
          Boolean(tr.annotation(Transaction.remote)),
        )
      : [],
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
    // The divider sits *in* the flow, so the two panes share the container
    // minus its width — and since flex-shrink takes that width from each pane
    // in proportion to its basis, a pane's final width is `ratio * track`
    // exactly. Measuring the ratio against `rect.width` instead would leave
    // the divider trailing the pointer by up to its own width, which mattered
    // little at 7px and is visible at 25px.
    const track = rect.width - divider.offsetWidth;
    // Where inside the divider the pointer landed. Without it the ratio is
    // measured from the pointer rather than from the divider's leading edge,
    // so the very first `pointermove` re-centres the divider on the pointer —
    // a jump of up to the divider's whole width, which the widened 25px hit
    // area made plainly visible. Derived from `splitRatio` rather than read
    // back off `divider.getBoundingClientRect()` so it uses exactly the math
    // that positions the divider below, which makes a grab with no movement a
    // true no-op instead of one sub-pixel flex rounding away from it.
    const grabOffset = e.clientX - (rect.left + splitRatio * track);
    const onMove = (ev: PointerEvent) => {
      const ratio = (ev.clientX - grabOffset - rect.left) / track;
      splitRatio = Math.max(0.15, Math.min(0.85, ratio));
      editorEl.style.flex = `1 1 ${(splitRatio * 100).toFixed(3)}%`;
      preview.el.style.flex = `1 1 ${((1 - splitRatio) * 100).toFixed(3)}%`;
    };
    // `pointercancel` alongside `pointerup`: a touch drag — which the
    // divider's `touch-action: none` enables — is *cancelled* rather than
    // ended when the browser takes the pointer over (a system gesture, the
    // finger leaving the digitizer), and then no `pointerup` ever arrives. The
    // page would keep the `col-resize` cursor and the `user-select` lock, with
    // the move listener still tracking.
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
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
    window.addEventListener('pointercancel', onUp);
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
    // A read-only mount refuses `undo`/`redo`, so report nothing to revert
    // rather than offering a host a control that would do nothing.
    canUndo: () => !readOnly && store.canUndo(),
    canRedo: () => !readOnly && store.canRedo(),
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
