import { Doc } from '../model/document.js';
import type { InlineStyle, BlockStyle } from '../model/types.js';
import { resolvePageSetup, getEffectiveDimensions } from '../model/types.js';
import { MemDocStore } from '../store/memory.js';
import type { DocStore } from '../store/store.js';
import { DocCanvas } from './doc-canvas.js';
import { Cursor } from './cursor.js';
import { Selection, computeSelectionRects } from './selection.js';
import { TextEditor } from './text-editor.js';
import { computeLayout, type DocumentLayout, type LayoutCache } from './layout.js';
import { paginateLayout, getTotalHeight, findPageForPosition, type PaginatedLayout } from './pagination.js';
import { Ruler, RULER_SIZE } from './ruler.js';
import { setThemeMode, type ThemeMode } from './theme.js';
import { type PeerCursor, resolvePositionPixel } from './peer-cursor.js';

/**
 * Public API returned by initialize().
 */
export interface EditorAPI {
  /** Force a re-render */
  render(): void;
  /** Get the underlying Doc model */
  getDoc(): Doc;
  /** Get the store */
  getStore(): DocStore;
  /** Get the inline style at the current cursor/selection anchor */
  getSelectionStyle(): Partial<InlineStyle>;
  /** Apply inline style to current selection */
  applyStyle(style: Partial<InlineStyle>): void;
  /** Apply block style to the block containing the cursor */
  applyBlockStyle(style: Partial<BlockStyle>): void;
  /** Undo */
  undo(): void;
  /** Redo */
  redo(): void;
  /** Switch the editor theme and re-render */
  setTheme(mode: ThemeMode): void;
  /** Update peer cursor data and re-render */
  setPeerCursors(cursors: PeerCursor[]): void;
  /** Register a callback for cursor position changes */
  onCursorMove(cb: (pos: { blockId: string; offset: number }, selection?: { anchor: { blockId: string; offset: number }; focus: { blockId: string; offset: number } } | null) => void): void;
  /** Get last-computed peer cursor pixel positions (for hover hit-testing) */
  getPeerCursorPixels(): Array<{ clientID: string; x: number; y: number; height: number }>;
  /** Focus the editor */
  focus(): void;
  /** Clean up */
  dispose(): void;
}

/**
 * Initialize the document editor.
 *
 * @param container - The DOM element to mount the editor in
 * @param store - Optional DocStore (defaults to MemDocStore)
 */
export function initialize(
  container: HTMLElement,
  store?: DocStore,
  theme?: ThemeMode,
): EditorAPI {
  if (theme) {
    setThemeMode(theme);
  }

  const docStore = store ?? new MemDocStore();

  // Ensure the store has at least one block
  if (docStore.getDocument().blocks.length === 0) {
    const tempDoc = Doc.create();
    docStore.setDocument(tempDoc.document);
  }

  const doc = new Doc(docStore);

  // Create canvas (viewport-sized) and a spacer div for scroll height
  const canvas = document.createElement('canvas');
  canvas.style.display = 'block';
  canvas.style.position = 'sticky';
  canvas.style.top = '0';
  canvas.style.cursor = 'text';
  // The canvas sits after the horizontal ruler (RULER_SIZE px) in the flow,
  // so its flow bottom extends RULER_SIZE px past the container.  A negative
  // bottom margin compensates, preventing a tiny spurious scrollbar when the
  // document fits on one page.
  canvas.style.marginBottom = `${-RULER_SIZE}px`;
  container.style.position = 'relative';
  container.appendChild(canvas);

  const spacer = document.createElement('div');
  spacer.style.width = '1px';
  spacer.style.pointerEvents = 'none';
  container.appendChild(spacer);

  const docCanvas = new DocCanvas(canvas);
  const ruler = new Ruler(container, canvas);
  const cursor = new Cursor(doc.document.blocks[0].id);
  const selection = new Selection();
  let layout: DocumentLayout = { blocks: [], totalHeight: 0 };
  let paginatedLayout: PaginatedLayout = { pages: [], pageSetup: resolvePageSetup(undefined) };
  let layoutCache: LayoutCache | undefined;
  let dirtyBlockIds: Set<string> | undefined;
  let needsScrollIntoView = false;
  let focused = true;
  let dragGuideline: { x?: number; y?: number } | null = null;
  let peerCursors: PeerCursor[] = [];
  let cursorMoveCallback: ((pos: { blockId: string; offset: number }, selection?: { anchor: { blockId: string; offset: number }; focus: { blockId: string; offset: number } } | null) => void) | null = null;
  let lastPeerPixels: Array<{ clientID: string; x: number; y: number; height: number }> = [];

  // Compute layout helper
  const recomputeLayout = () => {
    const pageSetup = resolvePageSetup(doc.document.pageSetup);
    const dims = getEffectiveDimensions(pageSetup);
    const contentWidth = dims.width - pageSetup.margins.left - pageSetup.margins.right;
    const result = computeLayout(
      doc.document.blocks,
      docCanvas.getContext(),
      contentWidth,
      dirtyBlockIds,
      layoutCache,
    );
    layout = result.layout;
    layoutCache = result.cache;
    dirtyBlockIds = undefined;
    paginatedLayout = paginateLayout(layout, pageSetup);
  };

  const markDirty = (blockId: string) => {
    if (dirtyBlockIds === undefined) {
      dirtyBlockIds = new Set();
    }
    dirtyBlockIds.add(blockId);
  };

  // Force full layout recompute on next render (for structural operations)
  const invalidateLayout = () => {
    layoutCache = undefined;
    dirtyBlockIds = undefined;
  };

  // Paint helper — repaints using cached layout (no recomputation)
  const paint = () => {
    // Read width from the parent element whose size is determined by CSS
    // flex layout, not by the editor's own content.  The container itself
    // has overflow:auto so its getBoundingClientRect().width can be stale
    // when the viewport shrinks (e.g. sidebar opening).
    // Height is read from the container directly since it is the scroll
    // viewport and its height accurately reflects the available space.
    const measureEl = container.parentElement ?? container;
    const viewportWidth = measureEl.getBoundingClientRect().width;
    const height = container.getBoundingClientRect().height;
    const pageWidth = paginatedLayout.pages[0]?.width ?? 0;
    const canvasWidth = Math.max(viewportWidth, pageWidth);
    const totalHeight = getTotalHeight(paginatedLayout);

    // Canvas stays viewport-sized; spacer provides scroll height
    docCanvas.resize(canvasWidth, height);
    spacer.style.height = `${totalHeight}px`;
    // Pull spacer up behind the sticky canvas so it only contributes scroll.
    // Account for the horizontal ruler height (RULER_SIZE) in the flow.
    spacer.style.marginTop = `${-height - RULER_SIZE}px`;

    const cursorPixel = cursor.getPixelPosition(paginatedLayout, layout, docCanvas.getContext(), canvasWidth);

    // Auto-scroll to keep cursor visible (only on keyboard/input-driven renders)
    if (needsScrollIntoView && cursorPixel) {
      needsScrollIntoView = false;
      const viewportTop = container.scrollTop;
      const viewportHeight = height;
      const cursorTop = cursorPixel.y;
      const cursorBottom = cursorPixel.y + cursorPixel.height;
      const scrollMargin = 20;

      if (cursorBottom > viewportTop + viewportHeight - scrollMargin) {
        container.scrollTop = cursorBottom - viewportHeight + scrollMargin;
      } else if (cursorTop < viewportTop + scrollMargin) {
        container.scrollTop = Math.max(0, cursorTop - scrollMargin);
      }
    }

    const scrollY = container.scrollTop;

    // Keep the hidden textarea at the cursor's screen position so the
    // browser doesn't scroll the container to bring it into view.
    if (cursorPixel) {
      const containerRect = container.getBoundingClientRect();
      const screenX = containerRect.left + cursorPixel.x;
      const screenY = containerRect.top + (cursorPixel.y - scrollY);
      textEditor.updateTextareaPosition(screenX, screenY);
    }

    const selectionRects = selection.getSelectionRects(
      paginatedLayout,
      layout,
      docCanvas.getContext(),
      canvasWidth,
    );

    // Compute peer cursor pixel positions with stacking
    const peerPixels: Array<{
      clientID: string;
      pixel: { x: number; y: number; height: number };
      color: string;
      username: string;
      labelVisible: boolean;
      clientKey: string;
    }> = [];
    for (const peer of peerCursors) {
      const pixel = resolvePositionPixel(
        peer.position,
        'backward',
        paginatedLayout,
        layout,
        docCanvas.getContext(),
        canvasWidth,
      );
      if (pixel) {
        peerPixels.push({
          clientID: peer.clientID,
          pixel,
          color: peer.color,
          username: peer.username,
          labelVisible: peer.labelVisible,
          clientKey: `${Math.round(pixel.x)},${Math.round(pixel.y)}`,
        });
      }
    }

    // Store resolved pixels for hover hit-testing
    lastPeerPixels = peerPixels.map((p) => ({
      clientID: p.clientID,
      x: p.pixel.x,
      y: p.pixel.y,
      height: p.pixel.height,
    }));

    // Compute stacking indices for peers at the same position.
    // Sort by clientKey + clientID for deterministic label ordering.
    const stackCounts = new Map<string, number>();
    const resolvedPeers = [...peerPixels]
      .sort(
        (a, b) =>
          a.clientKey.localeCompare(b.clientKey) ||
          a.clientID.localeCompare(b.clientID),
      )
      .map((p) => {
        const count = stackCounts.get(p.clientKey) ?? 0;
        stackCounts.set(p.clientKey, count + 1);
        return {
          pixel: p.pixel,
          color: p.color,
          username: p.username,
          labelVisible: p.labelVisible,
          stackIndex: count,
        };
      });

    // Compute peer selection highlight rectangles
    const peerSelections: Array<{
      color: string;
      rects: Array<{ x: number; y: number; width: number; height: number }>;
    }> = [];
    for (const peer of peerCursors) {
      if (peer.selection) {
        const rects = computeSelectionRects(
          peer.selection,
          paginatedLayout,
          layout,
          docCanvas.getContext(),
          canvasWidth,
        );
        if (rects.length > 0) {
          peerSelections.push({ color: peer.color, rects });
        }
      }
    }

    docCanvas.render(paginatedLayout, scrollY, canvasWidth, height, cursorPixel ?? undefined, selectionRects, focused, resolvedPeers, peerSelections);

    // Draw drag guideline if active
    if (dragGuideline) {
      const ctx = docCanvas.getContext();
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = '#4285F4';
      ctx.lineWidth = 1;
      if (dragGuideline.x != null) {
        ctx.beginPath();
        ctx.moveTo(dragGuideline.x, 0);
        ctx.lineTo(dragGuideline.x, height);
        ctx.stroke();
      }
      if (dragGuideline.y != null) {
        ctx.beginPath();
        ctx.moveTo(0, dragGuideline.y);
        ctx.lineTo(canvasWidth, dragGuideline.y);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Render rulers — target the page where the cursor is
    const cursorBlock = doc.document.blocks.find(
      (b) => b.id === cursor.position.blockId,
    );
    const cursorPageInfo = findPageForPosition(
      paginatedLayout, cursor.position.blockId, cursor.position.offset, layout,
    );
    ruler.render(
      paginatedLayout,
      scrollY,
      canvasWidth,
      height,
      cursorBlock?.style ?? null,
      cursorPageInfo?.pageIndex ?? 0,
    );
  };

  // Render helper — full layout recomputation + paint
  const render = () => {
    recomputeLayout();
    paint();
  };

  // Paint-only render — skips layout recomputation
  const renderPaintOnly = () => {
    paint();
  };

  // Wire ruler callbacks
  ruler.onMarginChange((margins) => {
    docStore.snapshot();
    const setup = resolvePageSetup(doc.document.pageSetup);
    setup.margins = { ...margins };
    docStore.setPageSetup(setup);
    doc.refresh();
    layoutCache = undefined;
    render();
  });

  ruler.onIndentChange((style) => {
    docStore.snapshot();
    doc.applyBlockStyle(cursor.position.blockId, style);
    markDirty(cursor.position.blockId);
    render();
  });

  ruler.onDragGuideline((pos) => {
    dragGuideline = pos;
    renderPaintOnly();
  });

  // Wire up text editor
  const undoFn = () => {
    if (docStore.canUndo()) {
      docStore.undo();
      doc.refresh();
      layoutCache = undefined;
      if (doc.document.blocks.length > 0) {
        cursor.moveTo({ blockId: doc.document.blocks[0].id, offset: 0 });
      }
      needsScrollIntoView = true;
      render();
    }
  };
  const redoFn = () => {
    if (docStore.canRedo()) {
      docStore.redo();
      doc.refresh();
      layoutCache = undefined;
      if (doc.document.blocks.length > 0) {
        cursor.moveTo({ blockId: doc.document.blocks[0].id, offset: 0 });
      }
      needsScrollIntoView = true;
      render();
    }
  };

  const renderWithScroll = () => {
    needsScrollIntoView = true;
    render();
    const selRange = selection.hasSelection() && selection.range
      ? { anchor: selection.range.anchor, focus: selection.range.focus }
      : null;
    cursorMoveCallback?.(cursor.position, selRange);
  };

  const textEditor = new TextEditor(
    container,
    doc,
    cursor,
    selection,
    () => layout,
    () => paginatedLayout,
    () => docCanvas.getContext(),
    () => {
      const vw = container.getBoundingClientRect().width;
      const pw = paginatedLayout.pages[0]?.width ?? 0;
      return Math.max(vw, pw);
    },
    () => canvas.getBoundingClientRect().top - container.getBoundingClientRect().top,
    renderWithScroll,
    () => docStore.snapshot(),
    undoFn,
    redoFn,
    markDirty,
    invalidateLayout,
  );

  // Start cursor blink
  cursor.startBlink(renderPaintOnly);

  // Enable scroll BEFORE the initial render so the container stays
  // flex-constrained instead of growing to match content height.
  container.style.overflow = 'auto';

  // Initial render
  render();

  // Scroll and resize listeners
  const handleScroll = () => renderPaintOnly();
  container.addEventListener('scroll', handleScroll);

  const resizeObserver = new ResizeObserver(() => render());
  resizeObserver.observe(container);

  // Re-render after any CSS transition completes on an ancestor (e.g.
  // sidebar open/close).  ResizeObserver may fire mid-transition but not
  // at the final size, leaving the canvas at a stale width.
  const handleTransitionEnd = (e: TransitionEvent) => {
    if (e.propertyName === 'width' || e.propertyName === 'transform') {
      render();
    }
  };
  // Attach to the document so we catch transitions anywhere in the tree.
  document.addEventListener('transitionend', handleTransitionEnd);

  // Focus/blur handling
  const handleFocus = () => {
    focused = true;
    cursor.startBlink(renderPaintOnly);
    render();
  };
  const handleBlur = () => {
    focused = false;
    cursor.stopBlink();
    render();
  };
  textEditor.onFocusChange(handleFocus, handleBlur);

  // Focus
  textEditor.focus();

  return {
    render,
    getDoc: () => doc,
    getStore: () => docStore,
    getSelectionStyle: (): Partial<InlineStyle> => {
      const block = doc.document.blocks.find(
        (b) => b.id === cursor.position.blockId,
      );
      if (!block) return {};
      let pos = 0;
      for (const inline of block.inlines) {
        const inlineEnd = pos + inline.text.length;
        if (cursor.position.offset <= inlineEnd) {
          return { ...inline.style };
        }
        pos = inlineEnd;
      }
      // Fallback: return style of last inline
      const last = block.inlines[block.inlines.length - 1];
      return last ? { ...last.style } : {};
    },
    applyStyle: (style: Partial<InlineStyle>) => {
      if (selection.hasSelection() && selection.range) {
        docStore.snapshot();
        const range = selection.range;
        doc.applyInlineStyle(range, style);
        // Mark all blocks in the selection range as dirty
        const startIdx = doc.getBlockIndex(range.anchor.blockId);
        const endIdx = doc.getBlockIndex(range.focus.blockId);
        if (startIdx < 0 || endIdx < 0) {
          render();
          return;
        }
        const lo = Math.min(startIdx, endIdx);
        const hi = Math.max(startIdx, endIdx);
        for (let i = lo; i <= hi; i++) {
          markDirty(doc.document.blocks[i].id);
        }
        render();
      }
    },
    applyBlockStyle: (style: Partial<BlockStyle>) => {
      docStore.snapshot();
      if (selection.hasSelection() && selection.range) {
        const range = selection.range;
        const startIdx = doc.getBlockIndex(range.anchor.blockId);
        const endIdx = doc.getBlockIndex(range.focus.blockId);
        if (startIdx >= 0 && endIdx >= 0) {
          const lo = Math.min(startIdx, endIdx);
          const hi = Math.max(startIdx, endIdx);
          for (let i = lo; i <= hi; i++) {
            const block = doc.document.blocks[i];
            doc.applyBlockStyle(block.id, style);
            markDirty(block.id);
          }
        }
      } else {
        doc.applyBlockStyle(cursor.position.blockId, style);
        markDirty(cursor.position.blockId);
      }
      render();
    },
    undo: undoFn,
    redo: redoFn,
    setTheme: (mode: ThemeMode) => {
      setThemeMode(mode);
      layoutCache = undefined;
      render();
    },
    setPeerCursors: (cursors: PeerCursor[]) => {
      peerCursors = cursors;
      renderPaintOnly();
    },
    onCursorMove: (cb) => {
      cursorMoveCallback = cb;
    },
    getPeerCursorPixels: () => lastPeerPixels,
    focus: () => textEditor.focus(),
    dispose: () => {
      peerCursors = [];
      cursorMoveCallback = null;
      lastPeerPixels = [];
      ruler.dispose();
      cursor.dispose();
      textEditor.dispose();
      container.removeEventListener('scroll', handleScroll);
      document.removeEventListener('transitionend', handleTransitionEnd);
      resizeObserver.disconnect();
      canvas.remove();
    },
  };
}
