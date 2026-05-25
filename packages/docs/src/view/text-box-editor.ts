/**
 * Slides-friendly sibling of `initialize` (the full-document factory in
 * `editor.ts`). Builds a single-page `PaginatedLayout` shim so the
 * existing `TextEditor` / `Cursor` / `Selection` classes — which all
 * speak "paginated layout" internally — can power an in-place text-box
 * on a slide without any changes to their hit-test paths.
 *
 * The shim is intentionally tiny:
 *   - One `LayoutPage` covers `(0, 0, contentWidth, contentHeight)`.
 *   - `PageSetup` carries `margins = { 0, 0, 0, 0 }` and a paper size
 *     equal to the content rect, so `paginatedPixelToPosition`'s
 *     `pageX` / `margins.left` translation collapses to `(localX, localY)
 *     = (px, py - Theme.pageGap)`.
 *   - `getCanvasOffsetTop` returns `-Theme.pageGap` so pointer math
 *     compensates for the `Theme.pageGap` offset that `getPageYOffset`
 *     adds to every page (including page 0).
 *
 * Painting goes through the `paintLayout` helper extracted in T1, with
 * the cursor / selection rectangles translated from page-space (which
 * is what `Cursor.getPixelPosition` and `Selection.getRects` return)
 * back to layout-local coords (subtract `Theme.pageGap`).
 *
 * No CRDT, no scroll, no header/footer, no tables — slides text-boxes
 * in v1 are paragraph-only inline content. Tables / horizontal rules /
 * page breaks would also be skipped by `paintLayout` itself, matching
 * the spec.
 */
import type { Block, PageSetup, InlineStyle, BlockStyle, BlockType, HeadingLevel } from '../model/types.js';
import type { ColorResolver } from '../model/color.js';
import { createEmptyBlock } from '../model/types.js';
import { Doc } from '../model/document.js';
import { MemDocStore } from '../store/memory.js';
import { CanvasTextMeasurer } from './canvas-measurer.js';
import { computeLayout, type DocumentLayout, type LayoutCache } from './layout.js';
import type { LayoutPage, PaginatedLayout, PageLine } from './pagination.js';
import { Cursor } from './cursor.js';
import { Selection, computeSelectionRects } from './selection.js';
import { TextEditor } from './text-editor.js';
import { paintLayout } from './paint-layout.js';
import { Theme } from './theme.js';

export interface TextBoxEditorOptions {
  /**
   * The DOM element that hosts the per-textbox canvas + the hidden
   * textarea TextEditor mounts. Slides supplies an overlay div sized
   * to the text frame (after scale).
   */
  container: HTMLElement;

  /**
   * Per-textbox canvas. Must be a direct child of `container` and
   * sized to `(contentWidth, contentHeight)` in logical pixels — the
   * caller is responsible for setting `width` / `height` (and any HiDPI
   * scaling) before mounting.
   */
  canvas: HTMLCanvasElement;

  /**
   * Initial content. Slides hands the live `Block[]` from
   * `withTextElement(...)` here; the editor seeds an in-memory store
   * with these blocks but does NOT mutate the supplied array — caller
   * receives the new blocks via `onCommit`.
   */
  blocks: Block[];

  /** Logical pixels — `frame.width - padding`. */
  contentWidth: number;

  /** Logical pixels — `frame.height - padding`. */
  contentHeight: number;

  /**
   * Called on blur / Escape with the final `Block[]` snapshot. Slides
   * applies the snapshot through `store.withTextElement` to commit it
   * into the Yorkie root.
   */
  onCommit?: (blocks: Block[]) => void;

  /**
   * Called when the user presses Escape (BEFORE `onCommit`, so the
   * caller can decide whether to discard or commit). The editor still
   * blurs and emits `onCommit` after `onCancel` returns; if you want
   * "Escape discards", roll back the source-of-truth in `onCancel`.
   */
  onCancel?: () => void;

  /**
   * Device pixel ratio for the canvas bitmap. The caller is expected to
   * size `canvas.width` / `canvas.height` to `(contentWidth * dpr,
   * contentHeight * dpr)` and the CSS size to `(contentWidth,
   * contentHeight)`; the editor calls `ctx.scale(dpr, dpr)` inside its
   * paint loop so layout coordinates stay in CSS pixels.
   *
   * Defaults to 1 (no HiDPI scaling) if omitted.
   */
  dpr?: number;

  /**
   * Host-pixels-per-logical-pixel for the surrounding viewport. Slides
   * sizes the text-box container in host pixels (`frame * scale`) but
   * the layout is computed in logical pixels (`contentWidth`); the
   * editor's pointer math divides `(clientX - rect.left)` by this value
   * so click coords land in the same coordinate space as `run.x` (which
   * includes alignment offsets). When the container's CSS size already
   * matches `contentWidth` / `contentHeight`, omit this (defaults to 1).
   */
  scale?: number;

  /**
   * Called when the user presses Cmd/Ctrl+K inside the text-box. The
   * host typically opens a link popover anchored near the caret. The
   * shim wires this through to the underlying `TextEditor`'s
   * `onLinkRequest` field — same shape as the docs editor's public
   * `onLinkRequest(cb)` API.
   */
  onLinkRequest?: () => void;

  /**
   * Fired after layout when the laid-out content height changes (logical
   * px). The host uses this to grow/shrink the editing surface and to
   * persist the fitted height. De-duped: only fires when the height
   * actually changes. Never fires while there is no canvas 2D context
   * (renderNow early-returns).
   */
  onContentHeightChange?: (contentHeight: number) => void;

  /**
   * Resolves a stored `Inline.style.color` / `backgroundColor` to a hex
   * string at paint time. Slides supplies a theme-aware resolver so the
   * in-place editor paints text in the deck's theme color — matching the
   * committed slide canvas (which builds the same resolver in
   * `drawText`). Without this, stored `'#000000'` / `undefined` colors
   * render as literal black, so dark themes show black text in edit mode.
   *
   * Defaults to the docs `defaultColorResolver` (string passthrough) when
   * omitted — docs/sheets callers are unaffected.
   */
  colorResolver?: ColorResolver;
}

export interface TextBoxEditorAPI {
  /** Focus the hidden textarea so keyboard input flows into the text-box. */
  focus(): void;

  /** Blur the hidden textarea. Triggers `onCommit` via the focusout path. */
  blur(): void;

  /**
   * Tear down: remove the hidden textarea, drop event listeners, stop
   * cursor blink, and flush a final `onCommit`. Idempotent.
   */
  detach(): void;

  /**
   * Resize the editing surface's logical content height and repaint.
   * Layout is width-driven, so this does not re-wrap text — it only
   * changes the shim page height + canvas the editor paints into.
   */
  setContentHeight(contentHeight: number): void;

  // ─── Text-formatting surface (mirrors EditorAPI) ───────────────────────────
  // These are needed so shared text-formatting toolbar components can drive
  // both the docs full editor and the slides text-box editor through a single
  // `TextFormattingEditor` interface (structural typing).

  /** Get the inline style at the current cursor/selection anchor. */
  getSelectionStyle(): Partial<InlineStyle>;

  /** Apply inline style to the current selection. No-op when nothing is selected. */
  applyStyle(style: Partial<InlineStyle>): void;

  /**
   * Apply block style to blocks covered by the current selection (or the
   * block at cursor when there is no selection).
   */
  applyBlockStyle(style: Partial<BlockStyle>): void;

  /** Get the block type at the cursor position. */
  getBlockType(): { type: BlockType; headingLevel?: HeadingLevel; listKind?: 'ordered' | 'unordered'; listLevel?: number };

  /**
   * Set the block type for the block at cursor.
   * `Title` and `Subtitle` are valid `BlockType` values but are silently
   * ignored inside text-boxes — they are document-level concepts.
   */
  setBlockType(type: BlockType, opts?: { headingLevel?: HeadingLevel; listKind?: 'ordered' | 'unordered'; listLevel?: number }): void;

  /** Toggle list type on the block at cursor. */
  toggleList(kind: 'ordered' | 'unordered'): void;

  /** Increase indent of blocks in the current selection. */
  indent(): void;

  /** Decrease indent of blocks in the current selection. */
  outdent(): void;

  /** Insert a hyperlink on the current selection (or insert URL text if no selection). */
  insertLink(url: string): void;

  /** Remove the hyperlink at the current cursor position. */
  removeLink(): void;

  /** Get the href of the link at the current cursor position, if any. */
  getLinkAtCursor(): string | undefined;

  /**
   * Programmatically trigger the link request (same as Ctrl+K). Fires the
   * `onLinkRequest` callback supplied in the options, if any.
   */
  requestLink(): void;

  /** Undo. */
  undo(): void;

  /** Redo. */
  redo(): void;

  /**
   * Register a callback for cursor position changes. The callback receives
   * the cursor position and, when a selection exists, its anchor/focus.
   */
  onCursorMove(cb: (pos: { blockId: string; offset: number }, selection?: { anchor: { blockId: string; offset: number }; focus: { blockId: string; offset: number } } | null) => void): void;
}

/**
 * Build a single-page `PaginatedLayout` whose page covers the entire
 * supplied layout. The page contains one `PageLine` per layout line
 * (skipping table / horizontal-rule / page-break blocks — slides
 * text-boxes don't host those today).
 *
 * `margins = { 0, 0, 0, 0 }` and `paperSize = (contentWidth,
 * contentHeight)` so `paginatedPixelToPosition` translates page-local
 * pixels to layout-local without any margin offset.
 */
function buildShimPaginatedLayout(
  layout: DocumentLayout,
  contentWidth: number,
  contentHeight: number,
): PaginatedLayout {
  const lines: PageLine[] = [];
  for (let bi = 0; bi < layout.blocks.length; bi++) {
    const lb = layout.blocks[bi];
    const block = lb.block;
    if (block.type === 'table' || block.type === 'horizontal-rule' || block.type === 'page-break') {
      continue;
    }
    for (let li = 0; li < lb.lines.length; li++) {
      lines.push({
        blockIndex: bi,
        lineIndex: li,
        line: lb.lines[li],
        x: 0,
        y: lb.y + lb.lines[li].y,
        pageIndex: 1,
      });
    }
  }

  const page: LayoutPage = {
    pageIndex: 0,
    lines,
    width: contentWidth,
    height: contentHeight,
  };

  const pageSetup: PageSetup = {
    paperSize: { name: 'TextBox', width: contentWidth, height: contentHeight },
    orientation: 'portrait',
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
  };

  return { pages: [page], pageSetup };
}

/**
 * Mount an in-place rich-text editor inside the supplied `container` /
 * `canvas`. Returns an `TextBoxEditorAPI` for the host to drive focus
 * / blur / teardown. The factory does NOT auto-focus — the caller
 * decides when to call `api.focus()` (typically immediately after
 * mounting on a `dblclick`).
 */
export function initializeTextBox(opts: TextBoxEditorOptions): TextBoxEditorAPI {
  const { container, canvas, contentWidth } = opts;
  let contentHeight = opts.contentHeight;
  const dpr = opts.dpr ?? 1;
  const scale = opts.scale ?? 1;
  const colorResolver = opts.colorResolver;

  // Seed an in-memory store with the supplied blocks. Empty input gets
  // a single empty paragraph so cursor placement and the very first
  // keystroke have a target block.
  const docStore = new MemDocStore();
  const seedBlocks: Block[] = opts.blocks.length > 0
    ? JSON.parse(JSON.stringify(opts.blocks))
    : [createEmptyBlock()];
  docStore.setDocument({ blocks: seedBlocks });

  const doc = new Doc(docStore);
  const measurer = new CanvasTextMeasurer();
  let layoutCache: LayoutCache | undefined;
  let layout: DocumentLayout = { blocks: [], totalHeight: 0, blockParentMap: new Map() };
  let paginatedLayout: PaginatedLayout = buildShimPaginatedLayout(layout, contentWidth, contentHeight);

  const recomputeLayout = (): void => {
    const result = computeLayout(
      doc.document.blocks,
      measurer,
      contentWidth,
      undefined,
      layoutCache,
    );
    layout = result.layout;
    layoutCache = result.cache;
    doc.setBlockParentMap(layout.blockParentMap);
    paginatedLayout = buildShimPaginatedLayout(layout, contentWidth, contentHeight);
  };

  recomputeLayout();

  const cursor = new Cursor(doc.document.blocks[0].id);
  const selection = new Selection();

  // Callback registered via onCursorMove(). Declared here so renderNow
  // can reference it in the closure before api is constructed.
  let cursorMoveCallback: ((pos: { blockId: string; offset: number }, selection?: { anchor: { blockId: string; offset: number }; focus: { blockId: string; offset: number } } | null) => void) | null = null;
  // Last-fired position so renderNow only invokes the callback when the
  // cursor or selection actually moved — without this, cursor-blink
  // re-renders thrash subscribers (e.g. format toolbars) every ~500 ms.
  let lastCursorMoveKey: string | null = null;

  // Painting. `paintLayout` handles the run / line / list-marker walk;
  // we only need to translate the cursor / selection rectangles from
  // page-space (what Cursor.getPixelPosition + Selection.getRects
  // return) back into layout-local coords (subtract `Theme.pageGap`,
  // since the shim's only page is at pageIndex 0 → pageY = pageGap).
  const ctx = canvas.getContext('2d') ?? null;
  let renderRAF: number | null = null;
  // Last content height reported via onContentHeightChange. Starts at -1
  // so the first real layout always fires once.
  let lastReportedHeight = -1;

  const renderNow = (): void => {
    renderRAF = null;
    if (!ctx) return;
    // Recompute layout from the current document. TextEditor mutates
    // docStore on every keystroke and triggers requestRender via
    // markDirty / requestRender callbacks, but it does NOT itself
    // walk computeLayout — that's the host's job. The LayoutCache
    // makes this cheap: only blocks whose content / width changed
    // re-measure; the rest reuse the previous frame's lines.
    recomputeLayout();
    // Report height changes so the host can grow/shrink the box. Fires
    // only when the laid-out height actually changed. Lives here (post
    // recompute) so `layout.totalHeight` is fresh; renderNow already
    // early-returned above when there is no ctx, so this never fires in
    // a context-less env.
    if (layout.totalHeight !== lastReportedHeight) {
      lastReportedHeight = layout.totalHeight;
      opts.onContentHeightChange?.(layout.totalHeight);
    }
    ctx.save();
    // Reset any previous transform, clear in DEVICE-pixel space, then
    // scale to CSS pixels for the rest of the paint. Caller-supplied
    // canvas bitmap is `(contentWidth * dpr, contentHeight * dpr)` so
    // post-scale we paint into a `(contentWidth, contentHeight)` CSS-
    // pixel surface — sharp on HiDPI displays.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (dpr !== 1) ctx.scale(dpr, dpr);

    // Selection rectangles. computeSelectionRects returns coordinates
    // in the same page-space as Cursor.getPixelPosition — translate
    // back into layout-local before handing to paintLayout.
    let selectionRects: Array<{ x: number; y: number; width: number; height: number }> | undefined;
    if (selection.range) {
      const pageGap = Theme.pageGap;
      const rects = computeSelectionRects(
        selection.range,
        paginatedLayout,
        layout,
        measurer,
        contentWidth,
      );
      selectionRects = rects.map((r) => ({ x: r.x, y: r.y - pageGap, width: r.width, height: r.height }));
    }

    // Cursor caret. Same page-space → layout-local translation.
    let cursorOpt: { x: number; y: number; height: number; visible: boolean } | undefined;
    const cursorPixel = cursor.getPixelPosition(paginatedLayout, layout, measurer, contentWidth);
    if (cursorPixel) {
      cursorOpt = {
        x: cursorPixel.x,
        y: cursorPixel.y - Theme.pageGap,
        height: cursorPixel.height,
        visible: cursorPixel.visible && focused,
      };
    }

    paintLayout(ctx, layout, 0, 0, {
      cursor: cursorOpt,
      selectionRects,
      requestRender,
      colorResolver,
    });
    ctx.restore();

    // Notify cursor-move subscribers (e.g. toolbar controls that read
    // getSelectionStyle() to update bold/italic toggles). Skip when
    // neither cursor nor selection has shifted since the last fire.
    if (cursorMoveCallback) {
      const selRange = selection.hasSelection() && selection.range
        ? { anchor: selection.range.anchor, focus: selection.range.focus }
        : null;
      const key = JSON.stringify({ cur: cursor.position, sel: selRange });
      if (key !== lastCursorMoveKey) {
        lastCursorMoveKey = key;
        cursorMoveCallback(cursor.position, selRange);
      }
    }
  };

  const requestRender = (): void => {
    if (renderRAF != null) return;
    if (typeof requestAnimationFrame === 'function') {
      renderRAF = requestAnimationFrame(renderNow);
    } else {
      // jsdom / SSR fallback: paint synchronously on the next microtask.
      renderRAF = -1;
      queueMicrotask(renderNow);
    }
  };

  // TextEditor wiring. The editor is positionally identical to the one
  // `initialize` constructs, except every page-aware getter is replaced
  // with a shim:
  //   - getCanvasWidth: contentWidth (so pageX = 0 in pagination math)
  //   - getScaleFactor: opts.scale (host pixels per logical pixel) so
  //     `(clientX - rect.left) / s` converts clicks back into the same
  //     logical-pixel space as `run.x`. Slides passes the live zoom
  //     here; full-document docs callers pass 1 (their container's CSS
  //     size already matches contentWidth).
  //   - getCanvasOffsetTop: -Theme.pageGap * scale. TextEditor computes
  //     `(clientY - rect.top - canvasOffsetTop) / scale`, so the offset
  //     lives in HOST pixels — using a raw logical pageGap inflates the
  //     y by an extra `(1 - scale) * pageGap / scale` per click. With
  //     the scale factor, clicking the canvas top resolves to logical
  //     `pageGap` (= page-0 top in paginatedPixelToPosition's coord
  //     space) at any zoom.
  const textEditor = new TextEditor(
    container,
    doc,
    cursor,
    selection,
    () => layout,
    () => paginatedLayout,
    () => measurer,
    () => contentWidth,
    () => scale,
    () => -Theme.pageGap * scale,
    requestRender,
    () => docStore.snapshot(),
    () => {
      docStore.undo();
      doc.refresh();
      layoutCache = undefined;
      recomputeLayout();
      requestRender();
    },
    () => {
      docStore.redo();
      doc.refresh();
      layoutCache = undefined;
      recomputeLayout();
      requestRender();
    },
    () => {
      // markDirty: drop the layout cache for that block. Slides
      // text-boxes are small, so the cheap path is to invalidate the
      // whole cache and re-measure.
      layoutCache = undefined;
    },
    () => {
      layoutCache = undefined;
      recomputeLayout();
    },
  );
  textEditor.setCursorTarget(canvas);
  if (opts.onLinkRequest) {
    textEditor.onLinkRequest = opts.onLinkRequest;
  }

  // Track focus so the cursor only paints + blinks while the textarea
  // owns focus (the standard caret behaviour).
  let focused = false;
  let detached = false;
  let committedOnce = false;

  const handleFocus = (): void => {
    focused = true;
    cursor.startBlink(() => requestRender());
    requestRender();
  };

  const handleBlur = (e?: FocusEvent): void => {
    focused = false;
    cursor.stopBlink();
    // Focus moving to a text-formatting control (a toolbar button, or an
    // open dropdown whose Radix menu items grab focus on hover) must NOT
    // end the editing session. Such controls are tagged with
    // `data-text-edit-keepalive`; skip the commit so the text-box stays
    // mounted, and the control's own handler re-focuses via `api.focus()`.
    // Plain buttons additionally `preventDefault` their mousedown so they
    // never blur in the first place; this guard covers the dropdown case
    // where hover-focus is unavoidable.
    const next = e?.relatedTarget;
    if (next instanceof HTMLElement && next.closest('[data-text-edit-keepalive]')) {
      requestRender();
      return;
    }
    if (!detached && !committedOnce) {
      committedOnce = true;
      try {
        opts.onCommit?.(docStore.getDocument().blocks);
      } finally {
        // Reset so a re-focus cycle (without detach) re-arms commit.
        committedOnce = false;
      }
    }
    requestRender();
  };

  textEditor.onFocusChange(handleFocus, handleBlur);

  // Escape: notify cancel handler then blur (which routes through the
  // commit path). `setEditContext` already swallows Escape when
  // editing header/footer — slides text-boxes only have a body
  // context, so we install our own keydown listener on the textarea
  // and blur on Escape.
  const handleEscape = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    opts.onCancel?.();
    api.blur();
  };
  // The hidden textarea isn't exposed publicly; reach it via the
  // container query (TextEditor appends it as a child of `container`).
  const textarea = container.querySelector('textarea') as HTMLTextAreaElement | null;
  if (textarea) {
    textarea.addEventListener('keydown', handleEscape, true);
  }

  // ── Helper: iterate every block covered by the current selection. ──────────
  // Text-boxes don't have tables, so the implementation is simpler than the
  // full-document equivalent in editor.ts.
  const forEachBlockInSelection = (fn: (block: Block) => void): void => {
    if (selection.hasSelection() && selection.range) {
      const range = selection.range;
      const startIdx = doc.getBlockIndex(range.anchor.blockId);
      const endIdx = doc.getBlockIndex(range.focus.blockId);
      if (startIdx >= 0 && endIdx >= 0) {
        const lo = Math.min(startIdx, endIdx);
        const hi = Math.max(startIdx, endIdx);
        for (let i = lo; i <= hi; i++) {
          fn(doc.document.blocks[i]);
        }
        return;
      }
    }
    // Cursor-only: operate on the block at cursor.
    const block = doc.findBlock(cursor.position.blockId);
    if (block) fn(block);
  };

  const api: TextBoxEditorAPI = {
    focus(): void {
      textEditor.focus();
    },
    blur(): void {
      if (textarea) textarea.blur();
    },
    detach(): void {
      if (detached) return;
      // Flush a final onCommit if the user was actively typing when
      // detach hit. Without this, removing the textarea while focused
      // synchronously triggers blur → handleBlur, which the `detached`
      // guard below then short-circuits → in-flight text is silently
      // dropped. Matches the JSDoc contract ("flush a final onCommit").
      // If the user had already blurred (focused === false), the blur
      // path already fired onCommit and there's nothing to flush.
      if (focused && !committedOnce) {
        committedOnce = true;
        try {
          opts.onCommit?.(docStore.getDocument().blocks);
        } catch (err) {
          console.error('[textBoxEditor] detach onCommit threw', err);
        }
      }
      detached = true;
      cursor.stopBlink();
      cursor.dispose();
      if (renderRAF != null && renderRAF >= 0 && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(renderRAF);
      }
      renderRAF = null;
      if (textarea) {
        textarea.removeEventListener('keydown', handleEscape, true);
        textarea.remove();
      }
    },

    setContentHeight(next: number): void {
      contentHeight = next;
      paginatedLayout = buildShimPaginatedLayout(layout, contentWidth, contentHeight);
      requestRender();
    },

    // ── Formatting surface ────────────────────────────────────────────────────

    getSelectionStyle(): Partial<InlineStyle> {
      const block = doc.findBlock(cursor.position.blockId);
      if (!block) return {};
      let pos = 0;
      for (const inline of block.inlines) {
        const inlineEnd = pos + inline.text.length;
        if (cursor.position.offset <= inlineEnd) {
          return { ...inline.style };
        }
        pos = inlineEnd;
      }
      const last = block.inlines[block.inlines.length - 1];
      return last ? { ...last.style } : {};
    },

    applyStyle(style: Partial<InlineStyle>): void {
      if (!selection.hasSelection() || !selection.range) return;
      docStore.snapshot();
      const range = selection.range;
      doc.applyInlineStyle(range, style);
      const startIdx = doc.getBlockIndex(range.anchor.blockId);
      const endIdx = doc.getBlockIndex(range.focus.blockId);
      if (startIdx >= 0 && endIdx >= 0) {
        layoutCache = undefined;
      }
      requestRender();
    },

    applyBlockStyle(style: Partial<BlockStyle>): void {
      docStore.snapshot();
      forEachBlockInSelection((block) => {
        doc.applyBlockStyle(block.id, style);
      });
      layoutCache = undefined;
      requestRender();
    },

    getBlockType(): { type: BlockType; headingLevel?: HeadingLevel; listKind?: 'ordered' | 'unordered'; listLevel?: number } {
      const block = doc.findBlock(cursor.position.blockId);
      if (!block) return { type: 'paragraph' as BlockType };
      return {
        type: block.type,
        headingLevel: block.headingLevel,
        listKind: block.listKind,
        listLevel: block.listLevel,
      };
    },

    setBlockType(type: BlockType, opts?: { headingLevel?: HeadingLevel; listKind?: 'ordered' | 'unordered'; listLevel?: number }): void {
      // Title/Subtitle/PageBreak/HorizontalRule/Table are not meaningful
      // inside text-boxes; silently ignore them so structural typing works
      // without breaking callers that pass those values through a shared API.
      if (type === 'title' || type === 'subtitle' || type === 'horizontal-rule' || type === 'table' || type === 'page-break') return;
      docStore.snapshot();
      doc.setBlockType(cursor.position.blockId, type, opts);
      layoutCache = undefined;
      requestRender();
    },

    toggleList(kind: 'ordered' | 'unordered'): void {
      docStore.snapshot();
      forEachBlockInSelection((block) => {
        if (block.type === 'list-item' && block.listKind === kind) {
          doc.setBlockType(block.id, 'paragraph');
        } else {
          doc.setBlockType(block.id, 'list-item', {
            listKind: kind,
            listLevel: block.listLevel ?? 0,
          });
        }
      });
      layoutCache = undefined;
      requestRender();
    },

    indent(): void {
      const MAX_LIST_LEVEL = 8;
      const INDENT_STEP = 36;
      docStore.snapshot();
      forEachBlockInSelection((block) => {
        if (block.type === 'list-item') {
          const currentLevel = block.listLevel ?? 0;
          if (currentLevel >= MAX_LIST_LEVEL) return;
          doc.setBlockType(block.id, 'list-item', {
            listKind: block.listKind,
            listLevel: currentLevel + 1,
          });
        } else {
          doc.applyBlockStyle(block.id, {
            marginLeft: (block.style.marginLeft ?? 0) + INDENT_STEP,
          });
        }
      });
      layoutCache = undefined;
      requestRender();
    },

    outdent(): void {
      const INDENT_STEP = 36;
      docStore.snapshot();
      forEachBlockInSelection((block) => {
        if (block.type === 'list-item') {
          const currentLevel = block.listLevel ?? 0;
          if (currentLevel <= 0) return;
          doc.setBlockType(block.id, 'list-item', {
            listKind: block.listKind,
            listLevel: currentLevel - 1,
          });
        } else {
          const current = block.style.marginLeft ?? 0;
          if (current <= 0) return;
          doc.applyBlockStyle(block.id, {
            marginLeft: Math.max(0, current - INDENT_STEP),
          });
        }
      });
      layoutCache = undefined;
      requestRender();
    },

    insertLink(url: string): void {
      if (selection.hasSelection() && selection.range) {
        docStore.snapshot();
        const range = selection.range;
        doc.applyInlineStyle(range, { href: url });
        layoutCache = undefined;
        requestRender();
      } else {
        docStore.snapshot();
        const pos = cursor.position;
        doc.insertText(pos, url);
        const range = {
          anchor: { blockId: pos.blockId, offset: pos.offset },
          focus: { blockId: pos.blockId, offset: pos.offset + url.length },
        };
        doc.applyInlineStyle(range, { href: url });
        cursor.moveTo({ blockId: pos.blockId, offset: pos.offset + url.length });
        layoutCache = undefined;
        requestRender();
      }
    },

    removeLink(): void {
      const block = doc.findBlock(cursor.position.blockId);
      if (!block) return;
      const inlines = block.inlines;
      let cursorInlineIdx = -1;
      const offsets: number[] = [0];
      for (let i = 0; i < inlines.length; i++) {
        const inlineEnd = offsets[i] + inlines[i].text.length;
        offsets.push(inlineEnd);
        if (cursor.position.offset >= offsets[i] && cursor.position.offset <= inlineEnd && inlines[i].style.href) {
          cursorInlineIdx = i;
        }
      }
      if (cursorInlineIdx < 0) return;
      const href = inlines[cursorInlineIdx].style.href;
      let lo = cursorInlineIdx;
      while (lo > 0 && inlines[lo - 1].style.href === href) lo--;
      let hi = cursorInlineIdx;
      while (hi < inlines.length - 1 && inlines[hi + 1].style.href === href) hi++;
      docStore.snapshot();
      const range = {
        anchor: { blockId: block.id, offset: offsets[lo] },
        focus: { blockId: block.id, offset: offsets[hi + 1] },
      };
      doc.applyInlineStyle(range, { href: undefined });
      layoutCache = undefined;
      requestRender();
    },

    getLinkAtCursor(): string | undefined {
      const block = doc.findBlock(cursor.position.blockId);
      if (!block) return undefined;
      let pos = 0;
      for (const inline of block.inlines) {
        const inlineEnd = pos + inline.text.length;
        if (cursor.position.offset >= pos && cursor.position.offset < inlineEnd) {
          return inline.style.href;
        }
        if (cursor.position.offset === inlineEnd && inline.style.href) {
          return inline.style.href;
        }
        pos = inlineEnd;
      }
      return undefined;
    },

    requestLink(): void {
      textEditor.onLinkRequest?.();
    },

    undo(): void {
      docStore.undo();
      doc.refresh();
      layoutCache = undefined;
      recomputeLayout();
      requestRender();
    },

    redo(): void {
      docStore.redo();
      doc.refresh();
      layoutCache = undefined;
      recomputeLayout();
      requestRender();
    },

    onCursorMove(cb: (pos: { blockId: string; offset: number }, selection?: { anchor: { blockId: string; offset: number }; focus: { blockId: string; offset: number } } | null) => void): void {
      cursorMoveCallback = cb;
    },
  };

  // Initial paint so the canvas reflects the seeded content right after
  // the factory returns.
  requestRender();

  return api;
}
