import { Doc } from '../model/document.js';
import type { InlineStyle, BlockStyle } from '../model/types.js';
import { resolvePageSetup, getEffectiveDimensions } from '../model/types.js';
import { MemDocStore } from '../store/memory.js';
import type { DocStore } from '../store/store.js';
import { DocCanvas } from './doc-canvas.js';
import { Cursor } from './cursor.js';
import { Selection } from './selection.js';
import { TextEditor } from './text-editor.js';
import { computeLayout, type DocumentLayout, type LayoutCache } from './layout.js';
import { paginateLayout, getTotalHeight, findPageForPosition, type PaginatedLayout } from './pagination.js';
import { Ruler, RULER_SIZE } from './ruler.js';

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
  /** Apply inline style to current selection */
  applyStyle(style: Partial<InlineStyle>): void;
  /** Apply block style to the block containing the cursor */
  applyBlockStyle(style: Partial<BlockStyle>): void;
  /** Undo */
  undo(): void;
  /** Redo */
  redo(): void;
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
): EditorAPI {
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
    const { width: viewportWidth, height } = container.getBoundingClientRect();
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

    docCanvas.render(paginatedLayout, scrollY, canvasWidth, height, cursorPixel ?? undefined, selectionRects, focused);

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

  // Initial render
  render();

  // Scroll and resize listeners
  container.style.overflow = 'auto';
  const handleScroll = () => renderPaintOnly();
  container.addEventListener('scroll', handleScroll);

  const resizeObserver = new ResizeObserver(() => render());
  resizeObserver.observe(container);

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
      doc.applyBlockStyle(cursor.position.blockId, style);
      markDirty(cursor.position.blockId);
      render();
    },
    undo: undoFn,
    redo: redoFn,
    focus: () => textEditor.focus(),
    dispose: () => {
      ruler.dispose();
      cursor.dispose();
      textEditor.dispose();
      container.removeEventListener('scroll', handleScroll);
      resizeObserver.disconnect();
      canvas.remove();
    },
  };
}
