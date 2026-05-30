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
import { defaultColorResolver, resolveColorAtPosition } from '../model/color.js';
import { createEmptyBlock, CLEAR_INLINE_STYLE } from '../model/types.js';
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
   * Optional transform applied to the document blocks immediately before
   * each layout (NOT to the committed document). Slides autofit "shrink"
   * uses this to scale font sizes down so the editor renders at the same
   * scale as the committed slide canvas. MUST preserve block/inline
   * identity (ids, text, counts) so cursor/selection offsets stay valid.
   * Absent ⇒ identity (docs/sheets callers unaffected).
   */
  transformLayoutBlocks?: (blocks: Block[]) => Block[];

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

  /**
   * Translate the paint origin (and click hit-test) by this anchor so
   * laid-out content sits at the top / middle / bottom of the editing
   * surface. Mirrors the slides canvas-renderer offset so the in-place
   * editor stays pixel-aligned with the committed slide canvas.
   * Recomputed each frame against `layout.totalHeight` since content
   * height changes as the user types.
   *
   * Defaults to `'top'` — docs/sheets full-document callers unaffected.
   */
  verticalAnchor?: 'top' | 'middle' | 'bottom';
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

  /**
   * Summary of inline styles across the current selection. For each key,
   * returns the resolved value when uniform, the literal 'mixed' when at
   * least two distinct values exist within the range, or undefined when
   * the property is unset throughout. With no selection, returns the
   * style at the cursor (same shape as `getSelectionStyle`). Matches the
   * `EditorAPI.getRangeStyleSummary` shape so shared toolbar pickers can
   * drive either editor through `TextFormattingEditor`.
   */
  getRangeStyleSummary(): {
    bold?: boolean | 'mixed';
    italic?: boolean | 'mixed';
    underline?: boolean | 'mixed';
    strikethrough?: boolean | 'mixed';
    fontFamily?: string | 'mixed';
    fontSize?: number | 'mixed';
    color?: InlineStyle['color'] | 'mixed';
    backgroundColor?: InlineStyle['backgroundColor'] | 'mixed';
    superscript?: boolean | 'mixed';
    subscript?: boolean | 'mixed';
  };

  /** Apply inline style to the current selection. No-op when nothing is selected. */
  applyStyle(style: Partial<InlineStyle>): void;

  /**
   * Strip all character-level inline styles (bold, italic, underline,
   * strikethrough, super/subscript, font size, font family, color,
   * background color, href) from the current selection. Block-level
   * formatting and structural inlines are preserved — matches the docs
   * `EditorAPI.clearInlineFormatting` contract.
   */
  clearInlineFormatting(): void;

  /**
   * Apply block style to blocks covered by the current selection (or the
   * block at cursor when there is no selection).
   */
  applyBlockStyle(style: Partial<BlockStyle>): void;

  /** Get the block type at the cursor position. */
  getBlockType(): { type: BlockType; headingLevel?: HeadingLevel; listKind?: 'ordered' | 'unordered'; listLevel?: number };

  /**
   * Read the block style at the cursor position. Used by shared toolbar
   * pickers (e.g. LineSpacingPicker) to reflect the current block's
   * `lineHeight` etc. Matches `EditorAPI.getBlockStyle`.
   */
  getBlockStyle(): Partial<BlockStyle>;

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
 * Compute the y offset that aligns laid-out content to the requested
 * vertical anchor inside a frame of height `frameH`.
 *
 * - `'top'` (and absent) ⇒ 0 (preserves pre-feature behavior).
 * - `'middle'` ⇒ `(frameH − contentH) / 2`.
 * - `'bottom'` ⇒ `frameH − contentH`.
 *
 * Clamped to ≥ 0 — when content overflows the frame (autofit='none' or
 * a sufficiently small frame in 'shrink' mode), painting starts at the
 * top so visible text isn't clipped above the frame entirely.
 *
 * Mirrors `computeVerticalOriginY` in slides' `text-renderer.ts` so
 * both the committed canvas and the in-place editor apply an identical
 * offset. Intentionally duplicated (slides depends on docs, not the
 * other way around) — if the algorithm changes, update both.
 */
function computeVerticalOriginY(
  anchor: 'top' | 'middle' | 'bottom' | undefined,
  frameH: number,
  contentH: number,
): number {
  if (anchor === 'middle') return Math.max(0, (frameH - contentH) / 2);
  if (anchor === 'bottom') return Math.max(0, frameH - contentH);
  return 0;
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
    const sourceBlocks = doc.document.blocks;
    const blocksForLayout = opts.transformLayoutBlocks
      ? opts.transformLayoutBlocks(sourceBlocks)
      : sourceBlocks;
    const result = computeLayout(
      blocksForLayout,
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
  // Vertical anchor offset in logical pixels. Recomputed at the start of
  // every renderNow pass and stashed here so the TextEditor click handler
  // (which reads it via getCanvasOffsetTop) always sees the most recent
  // value the moment a pointer event fires.
  //
  // Eagerly initialised here (not lazily inside renderNow) so clicks that
  // fire before the first rAF already see the correct non-zero offset for
  // middle/bottom anchors. The recomputeLayout() call above has already
  // populated layout.totalHeight, so computeVerticalOriginY is valid.
  let currentOriginY = computeVerticalOriginY(
    opts.verticalAnchor,
    contentHeight,
    layout.totalHeight,
  );

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
    // Vertical anchor: recompute the y offset for this frame. Written to
    // the closure-level `currentOriginY` so the TextEditor click handler
    // sees the freshest value at pointer-event time.
    currentOriginY = computeVerticalOriginY(
      opts.verticalAnchor,
      contentHeight,
      layout.totalHeight,
    );
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
    // back into layout-local (subtract Theme.pageGap) before handing
    // to paintLayout. paintLayout itself adds originY (currentOriginY)
    // to each rect.y internally, so we do NOT pre-add it here.
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

    // Cursor caret. Same page-space → layout-local translation (subtract
    // Theme.pageGap). paintLayout adds originY to cursor.y internally,
    // so we do NOT pre-add currentOriginY here either.
    // Caret color follows the resolved text color at the cursor position
    // so the caret stays readable on deck themes where `Theme.cursorColor`
    // (docs light/dark mode) does not match the slide background.
    let cursorOpt: { x: number; y: number; height: number; visible: boolean; color?: string } | undefined;
    const cursorPixel = cursor.getPixelPosition(paginatedLayout, layout, measurer, contentWidth);
    if (cursorPixel) {
      const cursorBlock = doc.findBlock(cursor.position.blockId);
      const cursorColor = resolveColorAtPosition(
        cursorBlock,
        cursor.position.offset,
        colorResolver ?? defaultColorResolver,
        Theme.cursorColor,
      );
      cursorOpt = {
        x: cursorPixel.x,
        y: cursorPixel.y - Theme.pageGap,
        height: cursorPixel.height,
        visible: cursorPixel.visible && focused,
        color: cursorColor,
      };
    }

    // Pass currentOriginY as originY so paintLayout shifts all content
    // (text, cursor, selection rects) by the vertical anchor offset. The
    // cursor and selectionRects coords above are already in layout-local
    // space; paintLayout adds originY to them internally.
    paintLayout(ctx, layout, 0, currentOriginY, {
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
  //   - getCanvasOffsetTop: (currentOriginY - Theme.pageGap) * scale.
  //     TextEditor computes `(clientY - rect.top - canvasOffsetTop) /
  //     scale = py`, then paginatedPixelToPosition derives
  //     `localY = py - pageGap`. A click at host-y = currentOriginY*scale
  //     (the visible top of anchor-shifted text) resolves to py = pageGap
  //     and localY = 0 — the very start of the layout. Reduces to
  //     `-pageGap * scale` when currentOriginY = 0, preserving the
  //     default-path behavior for docs/sheets callers.
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
    () => (currentOriginY - Theme.pageGap) * scale,
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

  /**
   * Apply inline style to the active selection. Extracted as a local so
   * both `applyStyle` and `clearInlineFormatting` route through the same
   * snapshot + dirty + render path.
   */
  const applyStyleImpl = (style: Partial<InlineStyle>): void => {
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
      currentOriginY = computeVerticalOriginY(
        opts.verticalAnchor,
        contentHeight,
        layout.totalHeight,
      );
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

    getRangeStyleSummary: () => {
      type Summary = ReturnType<TextBoxEditorAPI['getRangeStyleSummary']>;

      // No range — fall back to the cursor-position style (same shape as
      // getSelectionStyle). Text-boxes have no tables, so a flat block
      // lookup is enough.
      if (!selection.hasSelection() || !selection.range) {
        const block = doc.findBlock(cursor.position.blockId);
        if (!block) return {};
        let pos = 0;
        for (const inline of block.inlines) {
          const inlineEnd = pos + inline.text.length;
          if (cursor.position.offset <= inlineEnd) {
            return { ...inline.style } as Summary;
          }
          pos = inlineEnd;
        }
        const last = block.inlines[block.inlines.length - 1];
        return (last ? { ...last.style } : {}) as Summary;
      }

      const range = selection.range;

      const KEYS = [
        'bold', 'italic', 'underline', 'strikethrough',
        'fontFamily', 'fontSize', 'color', 'backgroundColor',
        'superscript', 'subscript',
      ] as const;
      // Token-based "seen" sets so structurally-equal StoredColor
      // objects (theme refs like { role: 'accent1' }) compare equal.
      // Without this, two inlines carrying the same theme color
      // compare by reference and the picker incorrectly shows 'mixed'.
      const seen: Record<string, Set<string>> = Object.fromEntries(
        KEYS.map((k) => [k, new Set<string>()]),
      );
      const rawByToken: Record<string, Map<string, unknown>> = Object.fromEntries(
        KEYS.map((k) => [k, new Map<string, unknown>()]),
      );
      const tokenize = (value: unknown): string => {
        if (value === undefined) return '__undefined__';
        if (value !== null && typeof value === 'object') {
          return `obj:${JSON.stringify(value)}`;
        }
        return `prim:${String(value)}`;
      };

      const visitInlinesInBlock = (
        blockId: string, from: number, to: number,
      ): void => {
        const block = doc.findBlock(blockId);
        if (!block) return;
        let pos = 0;
        for (const inline of block.inlines) {
          const inlineEnd = pos + inline.text.length;
          if (inlineEnd > from && pos < to && inline.text.length > 0) {
            for (const key of KEYS) {
              const raw = (inline.style as Record<string, unknown>)[key];
              const token = tokenize(raw);
              if (!seen[key].has(token)) {
                seen[key].add(token);
                rawByToken[key].set(token, raw);
              }
            }
          }
          pos = inlineEnd;
          if (pos >= to) break;
        }
      };

      const anchorIdx = doc.getBlockIndex(range.anchor.blockId);
      const focusIdx = doc.getBlockIndex(range.focus.blockId);
      if (anchorIdx >= 0 && focusIdx >= 0) {
        const [startIdx, startOff, endIdx, endOff] = anchorIdx < focusIdx ||
          (anchorIdx === focusIdx && range.anchor.offset <= range.focus.offset)
          ? [anchorIdx, range.anchor.offset, focusIdx, range.focus.offset]
          : [focusIdx, range.focus.offset, anchorIdx, range.anchor.offset];

        for (let i = startIdx; i <= endIdx; i++) {
          const block = doc.document.blocks[i];
          const blockLen = block.inlines.reduce((s, n) => s + n.text.length, 0);
          const from = i === startIdx ? startOff : 0;
          const to = i === endIdx ? endOff : blockLen;
          if (from < to) visitInlinesInBlock(block.id, from, to);
        }
      } else if (range.anchor.blockId === range.focus.blockId) {
        // Single-block fallback (defensive: getBlockIndex can fall
        // through if the text-box's document is mid-mutation).
        const a = range.anchor.offset;
        const b = range.focus.offset;
        visitInlinesInBlock(range.anchor.blockId, Math.min(a, b), Math.max(a, b));
      }

      const result: Record<string, unknown> = {};
      for (const key of KEYS) {
        const set = seen[key];
        if (set.size === 0) continue;
        if (set.size === 1) {
          const [onlyToken] = [...set];
          const only = rawByToken[key].get(onlyToken);
          if (only !== undefined) result[key] = only;
        } else {
          // Two or more distinct values — including "some inlines set,
          // others unset". Both count as 'mixed'.
          result[key] = 'mixed';
        }
      }

      return result as Summary;
    },

    applyStyle(style: Partial<InlineStyle>): void {
      applyStyleImpl(style);
    },

    clearInlineFormatting(): void {
      // Reuse the same path as applyStyle so snapshot + dirty + render
      // happen identically. CLEAR_INLINE_STYLE keeps the keyset in one
      // place (shared with the full docs `EditorAPI`).
      applyStyleImpl(CLEAR_INLINE_STYLE);
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

    getBlockStyle(): Partial<BlockStyle> {
      const block = doc.findBlock(cursor.position.blockId);
      return block ? { ...block.style } : {};
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
