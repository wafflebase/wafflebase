import { Doc } from '../model/document.js';
import type { DocPosition, InlineStyle, BlockStyle, BlockType, HeadingLevel, SearchMatch, CellAddress, CellRange, CellStyle } from '../model/types.js';
import { resolvePageSetup, getEffectiveDimensions, getBlockTextLength } from '../model/types.js';
import { MemDocStore } from '../store/memory.js';
import type { DocStore } from '../store/store.js';
import { DocCanvas } from './doc-canvas.js';
import { Cursor } from './cursor.js';
import { Selection, computeSelectionRects } from './selection.js';
import { TextEditor } from './text-editor.js';
import { computeLayout, type DocumentLayout, type LayoutCache } from './layout.js';
import { paginateLayout, getTotalHeight, findPageForPosition, type PaginatedLayout } from './pagination.js';
import { Ruler, RULER_SIZE } from './ruler.js';
import { computeScaleFactor } from './scale.js';
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
  /** Get the block type at the cursor position */
  getBlockType(): { type: BlockType; headingLevel?: HeadingLevel; listKind?: 'ordered' | 'unordered'; listLevel?: number };
  /** Set the block type for the block at cursor */
  setBlockType(type: BlockType, opts?: { headingLevel?: HeadingLevel; listKind?: 'ordered' | 'unordered'; listLevel?: number }): void;
  /** Toggle list type on the block at cursor */
  toggleList(kind: 'ordered' | 'unordered'): void;
  /** Increase indent of the block at cursor */
  indent(): void;
  /** Decrease indent of the block at cursor */
  outdent(): void;
  /** Insert a hyperlink on the current selection (or insert URL text if no selection) */
  insertLink(url: string): void;
  /** Remove the hyperlink at the current cursor position */
  removeLink(): void;
  /** Get the href of the link at the current cursor position, if any */
  getLinkAtCursor(): string | undefined;
  /** Programmatically trigger the link request (same as Ctrl+K) */
  requestLink(): void;
  /** Register a callback for Cmd/Ctrl+K link requests */
  onLinkRequest(cb: () => void): void;
  /** Register a callback for cursor-position-based link detection (fires when cursor enters/leaves a link) */
  onCursorLinkChange(cb: (info: { href: string; rect: { x: number; y: number; width: number; height: number } } | undefined) => void): void;
  /** Get the cursor's screen (viewport) coordinates for popover positioning */
  getCursorScreenRect(): { x: number; y: number; height: number } | undefined;
  /** Register a callback for Cmd/Ctrl+F find requests */
  onFindRequest(cb: () => void): void;
  /** Register a callback for Cmd/Ctrl+H find & replace requests */
  onFindReplaceRequest(cb: () => void): void;
  /** Set search match highlights and active match index */
  setSearchMatches(matches: SearchMatch[], activeIndex: number): void;
  /** Clear all search match highlights and optionally move cursor to active match */
  clearSearchMatches(moveCursorToActive?: boolean): void;
  /** Insert a table at the current cursor position */
  insertTable(rows: number, cols: number): void;
  /** Insert a row above or below current cell */
  insertTableRow(above: boolean): void;
  /** Delete the current row */
  deleteTableRow(): void;
  /** Insert a column left or right of current cell */
  insertTableColumn(left: boolean): void;
  /** Delete the current column */
  deleteTableColumn(): void;
  /** Merge selected cells */
  mergeTableCells(range: CellRange): void;
  /** Split the current cell */
  splitTableCell(): void;
  /** Apply style to current cell */
  applyTableCellStyle(style: Partial<CellStyle>): void;
  /** Delete the table the cursor is currently in */
  deleteTable(): void;
  /** Check if cursor is inside a table */
  isInTable(): boolean;
  /** Get the current cell address (if in table) */
  getCellAddress(): CellAddress | undefined;
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
  readOnly?: boolean,
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
  canvas.style.cursor = readOnly ? 'default' : 'text';
  container.style.position = 'relative';
  container.appendChild(canvas);

  const spacer = document.createElement('div');
  spacer.style.width = '1px';
  spacer.style.pointerEvents = 'none';
  container.appendChild(spacer);

  const docCanvas = new DocCanvas(canvas);
  const ruler = new Ruler(container, canvas, readOnly);
  const cursor = new Cursor(doc.document.blocks[0].id);
  const selection = new Selection();
  let layout: DocumentLayout = { blocks: [], totalHeight: 0 };
  let paginatedLayout: PaginatedLayout = { pages: [], pageSetup: resolvePageSetup(undefined) };
  let layoutCache: LayoutCache | undefined;
  let dirtyBlockIds: Set<string> | undefined;
  let needsScrollIntoView = false;
  let focused = !readOnly;

  /** Apply inline style to a cell selection that may span multiple cell blocks. */
  function applyCellStyleToRange(start: DocPosition, end: DocPosition, style: Partial<InlineStyle>): void {
    if (!start.cellAddress) return;
    const startCbi = start.cellBlockIndex ?? 0;
    const endCbi = end.cellBlockIndex ?? 0;
    if (startCbi === endCbi) {
      doc.applyCellInlineStyle(start.blockId, start.cellAddress, start.offset, end.offset, style, startCbi);
      return;
    }
    const block = doc.getBlock(start.blockId);
    const cell = block.tableData!.rows[start.cellAddress.rowIndex].cells[start.cellAddress.colIndex];
    for (let bi = startCbi; bi <= endCbi; bi++) {
      const cellBlock = cell.blocks[bi];
      if (!cellBlock) continue;
      const s = bi === startCbi ? start.offset : 0;
      const e = bi === endCbi ? end.offset : getBlockTextLength(cellBlock);
      if (s < e) {
        doc.applyCellInlineStyle(start.blockId, start.cellAddress, s, e, style, bi);
      }
    }
  }
  let dragGuideline: { x?: number; y?: number } | null = null;
  let peerCursors: PeerCursor[] = [];
  let cursorMoveCallback: ((pos: { blockId: string; offset: number }, selection?: { anchor: { blockId: string; offset: number }; focus: { blockId: string; offset: number } } | null) => void) | null = null;
  let lastPeerPixels: Array<{ clientID: string; x: number; y: number; height: number }> = [];
  let searchMatches: SearchMatch[] = [];
  let activeMatchIndex = -1;
  let scaleFactor = 1;

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
    const totalHeight = getTotalHeight(paginatedLayout);

    // Compute scale factor for mobile zoom-to-fit
    scaleFactor = computeScaleFactor(viewportWidth, pageWidth);

    // When scaled, canvas width = viewport width (page fits inside via ctx.scale).
    // When not scaled, canvas width >= page width (for centering with scroll).
    const canvasWidth = scaleFactor < 1 ? viewportWidth : Math.max(viewportWidth, pageWidth);

    // When scaled, hide rulers and use full container height for canvas
    const rulerSize = scaleFactor < 1 ? 0 : RULER_SIZE;
    if (scaleFactor < 1) {
      ruler.hide();
      canvas.style.top = '0';
    } else {
      ruler.show();
      canvas.style.top = `${RULER_SIZE}px`;
    }

    const canvasHeight = height - rulerSize;
    docCanvas.resize(canvasWidth, canvasHeight);
    spacer.style.height = `${totalHeight * scaleFactor}px`;
    spacer.style.marginTop = `${-height - rulerSize}px`;

    // Logical canvas width in unscaled document coordinates
    const logicalCanvasWidth = scaleFactor < 1 ? canvasWidth / scaleFactor : canvasWidth;

    const cursorPixel = cursor.getPixelPosition(paginatedLayout, layout, docCanvas.getContext(), logicalCanvasWidth);

    // Auto-scroll to keep cursor visible (only on keyboard/input-driven renders)
    if (needsScrollIntoView && cursorPixel) {
      needsScrollIntoView = false;
      const viewportTop = container.scrollTop;
      const viewportHeight = canvasHeight;
      const cursorTop = cursorPixel.y * scaleFactor;
      const cursorBottom = (cursorPixel.y + cursorPixel.height) * scaleFactor;
      const scrollMargin = 20;

      if (cursorBottom > viewportTop + viewportHeight - scrollMargin) {
        container.scrollTop = cursorBottom - viewportHeight + scrollMargin;
      } else if (cursorTop < viewportTop + scrollMargin) {
        container.scrollTop = Math.max(0, cursorTop - scrollMargin);
      }
    }

    const scrollY = container.scrollTop / scaleFactor;

    // Keep the hidden textarea at the cursor's screen position so the
    // browser doesn't scroll the container to bring it into view.
    if (cursorPixel) {
      const containerRect = container.getBoundingClientRect();
      const screenX = containerRect.left + cursorPixel.x * scaleFactor;
      const screenY = containerRect.top + (cursorPixel.y - scrollY) * scaleFactor;
      textEditor?.updateTextareaPosition(screenX, screenY);
    }

    const selectionRects = selection.getSelectionRects(
      paginatedLayout,
      layout,
      docCanvas.getContext(),
      logicalCanvasWidth,
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
        logicalCanvasWidth,
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
          logicalCanvasWidth,
        );
        if (rects.length > 0) {
          peerSelections.push({ color: peer.color, rects });
        }
      }
    }

    // Compute search highlight rectangles
    let searchHighlightRects: Array<{ x: number; y: number; width: number; height: number }>[] | undefined;
    if (searchMatches.length > 0) {
      searchHighlightRects = searchMatches.map((match) =>
        computeSelectionRects(
          {
            anchor: { blockId: match.blockId, offset: match.startOffset, cellAddress: match.cellAddress, cellBlockIndex: match.cellBlockIndex },
            focus: { blockId: match.blockId, offset: match.endOffset, cellAddress: match.cellAddress, cellBlockIndex: match.cellBlockIndex },
          },
          paginatedLayout,
          layout,
          docCanvas.getContext(),
          logicalCanvasWidth,
        ),
      );
    }

    docCanvas.render(paginatedLayout, scrollY, logicalCanvasWidth, canvasHeight, cursorPixel ?? undefined, selectionRects, focused, resolvedPeers, peerSelections, layout, searchHighlightRects, activeMatchIndex, scaleFactor);

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
        ctx.lineTo(dragGuideline.x, canvasHeight);
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
    if (scaleFactor >= 1) {
      ruler.render(
        paginatedLayout,
        scrollY,
        logicalCanvasWidth,
        canvasHeight,
        cursorBlock?.style ?? null,
        cursorPageInfo?.pageIndex ?? 0,
      );
    }
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

  let cursorLinkChangeCallback: ((info: { href: string; rect: { x: number; y: number; width: number; height: number } } | undefined) => void) | null = null;
  let textEditorRef: TextEditor | null = null;

  const renderWithScroll = () => {
    needsScrollIntoView = true;
    render();
    const selRange = selection.hasSelection() && selection.range
      ? { anchor: selection.range.anchor, focus: selection.range.focus }
      : null;
    cursorMoveCallback?.(cursor.position, selRange);
    // Notify cursor-based link detection.
    // Convert document-space coordinates to screen (viewport) coordinates
    // so the popover can use position:fixed reliably regardless of scroll.
    if (cursorLinkChangeCallback && textEditorRef) {
      const linkInfo = textEditorRef.getLinkAtCursorPosition();
      if (linkInfo) {
        const canvasRect = canvas.getBoundingClientRect();
        const scrollY = container.scrollTop;
        cursorLinkChangeCallback({
          href: linkInfo.href,
          rect: {
            x: canvasRect.left + linkInfo.rect.x,
            y: canvasRect.top + (linkInfo.rect.y - scrollY),
            width: linkInfo.rect.width,
            height: linkInfo.rect.height,
          },
        });
      } else {
        cursorLinkChangeCallback(undefined);
      }
    }
  };

  const textEditor = readOnly ? null : new TextEditor(
    container,
    doc,
    cursor,
    selection,
    () => layout,
    () => paginatedLayout,
    () => docCanvas.getContext(),
    () => {
      const vw = (container.parentElement ?? container).getBoundingClientRect().width;
      const pw = paginatedLayout.pages[0]?.width ?? 0;
      // When scaled, canvas width = viewport width (not max with page width),
      // matching the canvasWidth used in paint() for consistent page centering.
      const physical = scaleFactor < 1 ? vw : Math.max(vw, pw);
      return scaleFactor < 1 ? physical / scaleFactor : physical;
    },
    () => scaleFactor,
    () => canvas.getBoundingClientRect().top - container.getBoundingClientRect().top,
    renderWithScroll,
    () => docStore.snapshot(),
    undoFn,
    redoFn,
    markDirty,
    invalidateLayout,
  );
  textEditorRef = textEditor;

  // Start cursor blink (skip in read-only — no cursor visible)
  if (!readOnly) {
    cursor.startBlink(renderPaintOnly);
  }

  // Enable scroll BEFORE the initial render so the container stays
  // flex-constrained instead of growing to match content height.
  container.style.overflow = 'auto';

  // Initial render
  render();

  // Scroll and resize listeners
  const handleScroll = () => {
    // Dismiss link popover on scroll (Google Docs behavior)
    cursorLinkChangeCallback?.(undefined);
    renderPaintOnly();
  };
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
  if (textEditor) {
    textEditor.onFocusChange(handleFocus, handleBlur);
    textEditor.focus();
  }

  return {
    render,
    getDoc: () => doc,
    getStore: () => docStore,
    getSelectionStyle: (): Partial<InlineStyle> => {
      const block = doc.document.blocks.find(
        (b) => b.id === cursor.position.blockId,
      );
      if (!block) return {};

      // Read from cell-internal block if cursor is in a table cell
      const ca = cursor.position.cellAddress;
      if (ca && block.tableData) {
        const cell = block.tableData.rows[ca.rowIndex]?.cells[ca.colIndex];
        if (!cell) return {};
        const cbi = cursor.position.cellBlockIndex ?? 0;
        const cellBlock = cell.blocks[cbi];
        if (!cellBlock) return {};
        let cPos = 0;
        for (const inline of cellBlock.inlines) {
          const inlineEnd = cPos + inline.text.length;
          if (cursor.position.offset <= inlineEnd) {
            return { ...inline.style };
          }
          cPos = inlineEnd;
        }
        const cLast = cellBlock.inlines[cellBlock.inlines.length - 1];
        return cLast ? { ...cLast.style } : {};
      }

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
        const anchor = range.anchor;

        // Route to cell-aware method if selection is within a table cell
        if (anchor.cellAddress) {
          const normalized = selection.getNormalizedRange(layout);
          if (normalized) {
            applyCellStyleToRange(normalized.start, normalized.end, style);
            markDirty(anchor.blockId);
            render();
            return;
          }
        }

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
    getBlockType() {
      const ca = cursor.position.cellAddress;
      if (ca) {
        const block = doc.getBlock(cursor.position.blockId);
        if (block.tableData) {
          const cell = block.tableData.rows[ca.rowIndex]?.cells[ca.colIndex];
          const cbi = cursor.position.cellBlockIndex ?? 0;
          const cellBlock = cell?.blocks[cbi];
          if (cellBlock) {
            return {
              type: cellBlock.type,
              headingLevel: cellBlock.headingLevel,
              listKind: cellBlock.listKind,
              listLevel: cellBlock.listLevel,
            };
          }
        }
      }
      const block = doc.getBlock(cursor.position.blockId);
      return {
        type: block.type,
        headingLevel: block.headingLevel,
        listKind: block.listKind,
        listLevel: block.listLevel,
      };
    },
    setBlockType(type: BlockType, opts?: { headingLevel?: HeadingLevel; listKind?: 'ordered' | 'unordered'; listLevel?: number }) {
      docStore.snapshot();
      const ca = cursor.position.cellAddress;
      if (ca) {
        doc.setBlockTypeInCell(cursor.position.blockId, ca, cursor.position.cellBlockIndex ?? 0, type, opts);
      } else {
        doc.setBlockType(cursor.position.blockId, type, opts);
      }
      invalidateLayout();
      render();
    },
    toggleList(kind: 'ordered' | 'unordered') {
      const ca = cursor.position.cellAddress;
      docStore.snapshot();
      if (ca) {
        const block = doc.getBlock(cursor.position.blockId);
        const cell = block.tableData?.rows[ca.rowIndex]?.cells[ca.colIndex];
        const cbi = cursor.position.cellBlockIndex ?? 0;
        const cellBlock = cell?.blocks[cbi];
        if (cellBlock) {
          if (cellBlock.type === 'list-item' && cellBlock.listKind === kind) {
            doc.setBlockTypeInCell(block.id, ca, cbi, 'paragraph');
          } else {
            doc.setBlockTypeInCell(block.id, ca, cbi, 'list-item', {
              listKind: kind,
              listLevel: cellBlock.listLevel ?? 0,
            });
          }
        }
      } else {
        const block = doc.getBlock(cursor.position.blockId);
        if (block.type === 'list-item' && block.listKind === kind) {
          doc.setBlockType(block.id, 'paragraph');
        } else {
          doc.setBlockType(block.id, 'list-item', {
            listKind: kind,
            listLevel: block.listLevel ?? 0,
          });
        }
      }
      invalidateLayout();
      render();
    },
    indent() {
      const MAX_LIST_LEVEL = 8;
      const ca = cursor.position.cellAddress;
      docStore.snapshot();

      if (ca) {
        const block = doc.getBlock(cursor.position.blockId);
        const cell = block.tableData?.rows[ca.rowIndex]?.cells[ca.colIndex];
        const cbi = cursor.position.cellBlockIndex ?? 0;
        const cellBlock = cell?.blocks[cbi];
        if (cellBlock?.type === 'list-item') {
          const currentLevel = cellBlock.listLevel ?? 0;
          if (currentLevel >= MAX_LIST_LEVEL) return;
          doc.setBlockTypeInCell(block.id, ca, cbi, 'list-item', {
            listKind: cellBlock.listKind,
            listLevel: currentLevel + 1,
          });
        }
        markDirty(block.id);
        render();
        return;
      }

      const block = doc.getBlock(cursor.position.blockId);
      if (block.type === 'list-item') {
        const currentLevel = block.listLevel ?? 0;
        if (currentLevel >= MAX_LIST_LEVEL) return;
        doc.setBlockType(block.id, 'list-item', {
          listKind: block.listKind,
          listLevel: currentLevel + 1,
        });
      } else {
        const INDENT_STEP = 36;
        doc.applyBlockStyle(block.id, {
          marginLeft: (block.style.marginLeft ?? 0) + INDENT_STEP,
        });
      }
      markDirty(block.id);
      render();
    },
    outdent() {
      const ca = cursor.position.cellAddress;

      if (ca) {
        const block = doc.getBlock(cursor.position.blockId);
        const cell = block.tableData?.rows[ca.rowIndex]?.cells[ca.colIndex];
        const cbi = cursor.position.cellBlockIndex ?? 0;
        const cellBlock = cell?.blocks[cbi];
        if (cellBlock?.type === 'list-item') {
          const currentLevel = cellBlock.listLevel ?? 0;
          if (currentLevel <= 0) return;
          docStore.snapshot();
          doc.setBlockTypeInCell(block.id, ca, cbi, 'list-item', {
            listKind: cellBlock.listKind,
            listLevel: currentLevel - 1,
          });
          markDirty(block.id);
          render();
        }
        return;
      }

      const block = doc.getBlock(cursor.position.blockId);
      if (block.type === 'list-item') {
        const currentLevel = block.listLevel ?? 0;
        if (currentLevel <= 0) return;
        docStore.snapshot();
        doc.setBlockType(block.id, 'list-item', {
          listKind: block.listKind,
          listLevel: currentLevel - 1,
        });
      } else {
        const INDENT_STEP = 36;
        const current = block.style.marginLeft ?? 0;
        if (current <= 0) return;
        docStore.snapshot();
        doc.applyBlockStyle(block.id, {
          marginLeft: Math.max(0, current - INDENT_STEP),
        });
      }
      markDirty(block.id);
      render();
    },
    insertLink: (url: string) => {
      if (selection.hasSelection() && selection.range) {
        docStore.snapshot();
        const range = selection.range;
        const anchor = range.anchor;

        if (anchor.cellAddress) {
          const normalized = selection.getNormalizedRange(layout);
          if (normalized) {
            doc.applyCellInlineStyle(
              anchor.blockId, anchor.cellAddress,
              normalized.start.offset, normalized.end.offset,
              { href: url }, anchor.cellBlockIndex ?? 0,
            );
            markDirty(anchor.blockId);
            render();
            return;
          }
        }

        doc.applyInlineStyle(range, { href: url });
        const startIdx = doc.getBlockIndex(range.anchor.blockId);
        const endIdx = doc.getBlockIndex(range.focus.blockId);
        if (startIdx >= 0 && endIdx >= 0) {
          const lo = Math.min(startIdx, endIdx);
          const hi = Math.max(startIdx, endIdx);
          for (let i = lo; i <= hi; i++) {
            markDirty(doc.document.blocks[i].id);
          }
        }
        render();
      } else {
        docStore.snapshot();
        const pos = cursor.position;
        const ca = pos.cellAddress;
        const cbi = pos.cellBlockIndex ?? 0;

        if (ca) {
          doc.insertTextInCell(pos.blockId, ca, pos.offset, url, cbi);
          doc.applyCellInlineStyle(pos.blockId, ca, pos.offset, pos.offset + url.length, { href: url }, cbi);
          cursor.moveTo({ blockId: pos.blockId, offset: pos.offset + url.length, cellAddress: ca, cellBlockIndex: cbi });
        } else {
          doc.insertText(pos, url);
          const range = {
            anchor: { blockId: pos.blockId, offset: pos.offset },
            focus: { blockId: pos.blockId, offset: pos.offset + url.length },
          };
          doc.applyInlineStyle(range, { href: url });
          cursor.moveTo({ blockId: pos.blockId, offset: pos.offset + url.length });
        }
        markDirty(pos.blockId);
        needsScrollIntoView = true;
        render();
      }
    },
    removeLink: () => {
      const block = doc.document.blocks.find(
        (b) => b.id === cursor.position.blockId,
      );
      if (!block) return;

      // Resolve the inlines to search — cell block or top-level block
      const ca = cursor.position.cellAddress;
      let inlines = block.inlines;
      if (ca && block.tableData) {
        const cell = block.tableData.rows[ca.rowIndex]?.cells[ca.colIndex];
        const cbi = cursor.position.cellBlockIndex ?? 0;
        const cellBlock = cell?.blocks[cbi];
        if (cellBlock) inlines = cellBlock.inlines;
      }

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
      if (ca) {
        doc.applyCellInlineStyle(
          block.id, ca, offsets[lo], offsets[hi + 1],
          { href: undefined }, cursor.position.cellBlockIndex ?? 0,
        );
      } else {
        const range = {
          anchor: { blockId: block.id, offset: offsets[lo] },
          focus: { blockId: block.id, offset: offsets[hi + 1] },
        };
        doc.applyInlineStyle(range, { href: undefined });
      }
      markDirty(block.id);
      render();
    },
    getLinkAtCursor: (): string | undefined => {
      const block = doc.document.blocks.find(
        (b) => b.id === cursor.position.blockId,
      );
      if (!block) return undefined;

      // Read from cell block if cursor is in a table cell
      const ca = cursor.position.cellAddress;
      let inlines = block.inlines;
      if (ca && block.tableData) {
        const cell = block.tableData.rows[ca.rowIndex]?.cells[ca.colIndex];
        const cbi = cursor.position.cellBlockIndex ?? 0;
        const cellBlock = cell?.blocks[cbi];
        if (cellBlock) inlines = cellBlock.inlines;
      }

      let pos = 0;
      for (const inline of inlines) {
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
    getCursorScreenRect: () => {
      const vw = (container.parentElement ?? container).getBoundingClientRect().width;
      const pw = paginatedLayout.pages[0]?.width ?? 0;
      const physicalWidth = scaleFactor < 1 ? vw : Math.max(vw, pw);
      const logicalWidth = scaleFactor < 1 ? physicalWidth / scaleFactor : physicalWidth;
      const cursorPixel = cursor.getPixelPosition(paginatedLayout, layout, docCanvas.getContext(), logicalWidth);
      if (!cursorPixel) return undefined;
      const canvasRect = canvas.getBoundingClientRect();
      const sy = container.scrollTop / scaleFactor;
      return {
        x: canvasRect.left + cursorPixel.x * scaleFactor,
        y: canvasRect.top + (cursorPixel.y - sy) * scaleFactor,
        height: cursorPixel.height * scaleFactor,
      };
    },
    requestLink: () => {
      textEditor?.onLinkRequest?.();
    },
    onLinkRequest: (cb: () => void) => {
      if (textEditor) textEditor.onLinkRequest = cb;
    },
    onCursorLinkChange: (cb: (info: { href: string; rect: { x: number; y: number; width: number; height: number } } | undefined) => void) => {
      cursorLinkChangeCallback = cb;
    },
    onFindRequest: (cb: () => void) => {
      if (textEditor) textEditor.onFindRequest = cb;
    },
    onFindReplaceRequest: (cb: () => void) => {
      if (textEditor) textEditor.onFindReplaceRequest = cb;
    },
    setSearchMatches: (matches: SearchMatch[], activeIndex: number) => {
      searchMatches = matches;
      activeMatchIndex = activeIndex;
      render();

      // Scroll active match into view
      if (activeIndex >= 0 && activeIndex < matches.length) {
        const match = matches[activeIndex];
        const measureEl = container.parentElement ?? container;
        const viewportWidth = measureEl.getBoundingClientRect().width;
        const pageWidth = paginatedLayout.pages[0]?.width ?? 0;
        const cw = Math.max(viewportWidth, pageWidth);
        const logicalCw = scaleFactor < 1 ? cw / scaleFactor : cw;
        const rects = computeSelectionRects(
          { anchor: { blockId: match.blockId, offset: match.startOffset }, focus: { blockId: match.blockId, offset: match.endOffset } },
          paginatedLayout,
          layout,
          docCanvas.getContext(),
          logicalCw,
        );
        if (rects.length > 0) {
          const matchTop = rects[0].y * scaleFactor;
          const matchBottom = (rects[rects.length - 1].y + rects[rects.length - 1].height) * scaleFactor;
          const viewportTop = container.scrollTop;
          const rulerSize = scaleFactor < 1 ? 0 : RULER_SIZE;
          const viewportHeight = container.getBoundingClientRect().height - rulerSize;
          const scrollMargin = 60;

          if (matchBottom > viewportTop + viewportHeight - scrollMargin) {
            container.scrollTop = matchTop - viewportHeight / 3;
          } else if (matchTop < viewportTop + scrollMargin) {
            container.scrollTop = Math.max(0, matchTop - viewportHeight / 3);
          }
        }
      }
    },
    clearSearchMatches: (moveCursorToActive?: boolean) => {
      // Move cursor to the active match position before clearing (Google Docs behavior)
      if (moveCursorToActive && activeMatchIndex >= 0 && activeMatchIndex < searchMatches.length) {
        const match = searchMatches[activeMatchIndex];
        cursor.moveTo({ blockId: match.blockId, offset: match.startOffset, cellAddress: match.cellAddress, cellBlockIndex: match.cellBlockIndex });
        selection.setRange({
          anchor: { blockId: match.blockId, offset: match.startOffset, cellAddress: match.cellAddress, cellBlockIndex: match.cellBlockIndex },
          focus: { blockId: match.blockId, offset: match.endOffset, cellAddress: match.cellAddress, cellBlockIndex: match.cellBlockIndex },
        });
      }
      searchMatches = [];
      activeMatchIndex = -1;
      render();
    },
    insertTable: (rows: number, cols: number) => {
      docStore.snapshot();
      const blockIndex = doc.getBlockIndex(cursor.position.blockId);
      const tableId = doc.insertTable(blockIndex + 1, rows, cols);
      cursor.moveTo({ blockId: tableId, offset: 0, cellAddress: { rowIndex: 0, colIndex: 0 } });
      invalidateLayout();
      render();
    },
    deleteTable: () => {
      if (!cursor.position.cellAddress) return;
      const blockId = cursor.position.blockId;
      const blockIndex = doc.getBlockIndex(blockId);
      docStore.snapshot();
      doc.deleteBlock(blockId);
      // Move cursor to nearest block
      const blocks = doc.document.blocks;
      if (blocks.length > 0) {
        const newIndex = Math.min(blockIndex, blocks.length - 1);
        cursor.moveTo({ blockId: blocks[newIndex].id, offset: 0 });
      }
      invalidateLayout();
      render();
    },
    isInTable: () => cursor.position.cellAddress != null,
    getCellAddress: () => cursor.position.cellAddress,
    insertTableRow: (above: boolean) => {
      const ca = cursor.position.cellAddress;
      if (!ca) return;
      docStore.snapshot();
      const idx = above ? ca.rowIndex : ca.rowIndex + 1;
      doc.insertRow(cursor.position.blockId, idx);
      invalidateLayout();
      render();
    },
    deleteTableRow: () => {
      const ca = cursor.position.cellAddress;
      if (!ca) return;
      docStore.snapshot();
      const blockId = cursor.position.blockId;
      doc.deleteRow(blockId, ca.rowIndex);
      // Re-home cursor if the deleted row was the last one
      const td = doc.getBlock(blockId).tableData;
      if (td) {
        const newRow = Math.min(ca.rowIndex, td.rows.length - 1);
        cursor.moveTo({ blockId, offset: 0, cellAddress: { rowIndex: newRow, colIndex: ca.colIndex } });
      }
      invalidateLayout();
      render();
    },
    insertTableColumn: (left: boolean) => {
      const ca = cursor.position.cellAddress;
      if (!ca) return;
      docStore.snapshot();
      const idx = left ? ca.colIndex : ca.colIndex + 1;
      doc.insertColumn(cursor.position.blockId, idx);
      invalidateLayout();
      render();
    },
    deleteTableColumn: () => {
      const ca = cursor.position.cellAddress;
      if (!ca) return;
      docStore.snapshot();
      const blockId = cursor.position.blockId;
      doc.deleteColumn(blockId, ca.colIndex);
      // Re-home cursor if the deleted column was the last one
      const td = doc.getBlock(blockId).tableData;
      if (td) {
        const newCol = Math.min(ca.colIndex, td.columnWidths.length - 1);
        cursor.moveTo({ blockId, offset: 0, cellAddress: { rowIndex: ca.rowIndex, colIndex: newCol } });
      }
      invalidateLayout();
      render();
    },
    mergeTableCells: (range: CellRange) => {
      docStore.snapshot();
      const blockId = cursor.position.blockId;
      doc.mergeCells(blockId, range);
      // Move cursor to top-left cell of merged range
      cursor.moveTo({ blockId, offset: 0, cellAddress: range.start });
      invalidateLayout();
      render();
    },
    splitTableCell: () => {
      const ca = cursor.position.cellAddress;
      if (!ca) return;
      docStore.snapshot();
      doc.splitCell(cursor.position.blockId, ca);
      invalidateLayout();
      render();
    },
    applyTableCellStyle: (style: Partial<CellStyle>) => {
      const ca = cursor.position.cellAddress;
      if (!ca) return;
      docStore.snapshot();
      doc.applyCellStyle(cursor.position.blockId, ca, style);
      markDirty(cursor.position.blockId);
      render();
    },
    focus: () => textEditor?.focus(),
    dispose: () => {
      peerCursors = [];
      cursorMoveCallback = null;
      lastPeerPixels = [];
      ruler.dispose();
      cursor.dispose();
      textEditor?.dispose();
      container.removeEventListener('scroll', handleScroll);
      document.removeEventListener('transitionend', handleTransitionEnd);
      resizeObserver.disconnect();
      canvas.remove();
    },
  };
}
