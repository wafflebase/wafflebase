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
 *
 * Refs `packages/slides/spike/docs-richtext-audit.md` "Required exports"
 * and `docs/tasks/active/20260507-slides-phase5a-plan.md` Task 3.
 */
import type { Block, PageSetup } from '../model/types.js';
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
  const { container, canvas, contentWidth, contentHeight } = opts;

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

  // Painting. `paintLayout` handles the run / line / list-marker walk;
  // we only need to translate the cursor / selection rectangles from
  // page-space (what Cursor.getPixelPosition + Selection.getRects
  // return) back into layout-local coords (subtract `Theme.pageGap`,
  // since the shim's only page is at pageIndex 0 → pageY = pageGap).
  const ctx = canvas.getContext('2d') ?? null;
  let renderRAF: number | null = null;

  const renderNow = (): void => {
    renderRAF = null;
    if (!ctx) return;
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

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
    });
    ctx.restore();
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
  //   - getScaleFactor: 1 (slides handles scale via CSS transform)
  //   - getCanvasOffsetTop: -Theme.pageGap so pointer math compensates
  //     for getPageYOffset(0) === Theme.pageGap, landing localY = 0 at
  //     the canvas top edge.
  const textEditor = new TextEditor(
    container,
    doc,
    cursor,
    selection,
    () => layout,
    () => paginatedLayout,
    () => measurer,
    () => contentWidth,
    () => 1,
    () => -Theme.pageGap,
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

  const handleBlur = (): void => {
    focused = false;
    cursor.stopBlink();
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

  const api: TextBoxEditorAPI = {
    focus(): void {
      textEditor.focus();
    },
    blur(): void {
      if (textarea) textarea.blur();
    },
    detach(): void {
      if (detached) return;
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
  };

  // Initial paint so the canvas reflects the seeded content right after
  // the factory returns.
  requestRender();

  return api;
}
