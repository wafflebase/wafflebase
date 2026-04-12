import { Doc } from '../model/document.js';
import type { Block, InlineStyle, BlockStyle, BlockType, HeadingLevel, SearchMatch, CellAddress, CellRange, CellStyle, ImageData } from '../model/types.js';
import { resolvePageSetup, getEffectiveDimensions, getBlockTextLength, findImageAtOffset, clampImageToWidth } from '../model/types.js';
import { MemDocStore } from '../store/memory.js';
import type { DocStore } from '../store/store.js';
import { DocCanvas } from './doc-canvas.js';
import { Cursor } from './cursor.js';
import { Selection, computeSelectionRects } from './selection.js';
import { TextEditor } from './text-editor.js';
import { computeLayout, type DocumentLayout, type LayoutCache, type LayoutRun } from './layout.js';
import { paginateLayout, getTotalHeight, findPageForPosition, getPageXOffset, getPageYOffset, getHeaderYStart, getFooterYStart, paginatedPixelToPosition, type PaginatedLayout } from './pagination.js';
import type { DocPosition, HeaderFooter } from '../model/types.js';
import { Ruler, RULER_SIZE } from './ruler.js';
import { computeScaleFactor } from './scale.js';
import { buildFont, setThemeMode, type ThemeMode } from './theme.js';
import { type PeerCursor, resolvePositionPixel } from './peer-cursor.js';
import { computeTableMergeContext, type TableMergeContext } from './table-merge-context.js';
import {
  collectImageRects,
  findImageAtPoint,
  hitTestImageHandle,
  cursorForHandle,
  computeResizeDelta,
  computePreviewRect,
  formatResizeHud,
  type ImageHandle,
  type ImageRect,
} from './image-selection-overlay.js';

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
  onCursorMove(cb: (pos: { blockId: string; offset: number }, selection?: { anchor: { blockId: string; offset: number }; focus: { blockId: string; offset: number }; tableCellRange?: { blockId: string; start: { rowIndex: number; colIndex: number }; end: { rowIndex: number; colIndex: number } } } | null) => void): void;
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
  /** Compute the merge/unmerge state for the menu (current cursor + selection) */
  getTableMergeContext(): TableMergeContext;
  /** Apply style to current cell */
  applyTableCellStyle(style: Partial<CellStyle>): void;
  /** Delete the table the cursor is currently in */
  deleteTable(): void;
  /** Check if cursor is inside a table */
  isInTable(): boolean;
  /** Get the current cell address (if in table) */
  getCellAddress(): CellAddress | undefined;
  /**
   * Insert an inline image at the current cursor position. The caller is
   * responsible for producing a URL the browser can load (upload, data URL,
   * or absolute http[s]). The dimensions passed here become the image's
   * initial displayed size — callers that need to clamp to page width
   * should do so before calling.
   */
  insertImage(src: string, width: number, height: number, opts?: {
    alt?: string;
    originalWidth?: number;
    originalHeight?: number;
    position?: { blockId: string; offset: number };
  }): void;
  /**
   * Programmatically mark the image at `(blockId, offset)` as the selected
   * image. This hides the text caret (once the overlay renderer lands) and
   * is the entry point for resize/rotate/crop interactions. No-op if the
   * offset does not point at an image inline.
   */
  selectImageAt(blockId: string, offset: number): void;
  /** Clear the image selection, returning to text mode. */
  clearImageSelection(): void;
  /** Return the currently selected image's data and position, or null. */
  getSelectedImage(): { data: ImageData; blockId: string; offset: number } | null;
  /**
   * Replace the selected image's `ImageData` with a merged patch. The patch
   * is a shallow field-level merge onto the current data — pass `undefined`
   * for any field to explicitly clear it. No-op if no image is selected or
   * the stored position no longer references an image inline.
   */
  updateSelectedImage(patch: Partial<ImageData>): void;
  /**
   * Register a handler for image files the user drops into the editor
   * or pastes from the clipboard. The editor intercepts `drop` and
   * `paste` events that carry an image MIME file and invokes this
   * callback with the underlying `File`. The caller is responsible
   * for uploading the bytes somewhere and calling `insertImage` with
   * the resulting URL — the docs package stays agnostic about auth,
   * CORS, and upload endpoints. Only the most recent callback is
   * active; calling this again replaces it.
   */
  onImageFileDrop(cb: ((file: File, position: { blockId: string; offset: number }) => void) | null): void;
  /** Insert a page number token at cursor in header/footer */
  insertPageNumber(): void;
  /** Get the current edit context */
  getEditContext(): 'body' | 'header' | 'footer';
  /** Register a callback for edit context changes (body/header/footer) */
  onEditContextChange(cb: (context: 'body' | 'header' | 'footer') => void): void;
  /** Focus the editor */
  focus(): void;
  /**
   * Ensure the cursor points to a block that still exists after a remote
   * change may have deleted the block it was on.
   */
  validateCursorPosition(): void;
  /**
   * Reset editor state after the underlying document was replaced externally
   * (e.g. via `store.setDocument()`). Refreshes the cached document, resets
   * the cursor to the first block, invalidates layout caches, and repaints.
   */
  resetAfterDocumentReplace(): void;
  /** Clean up */
  dispose(): void;
}

/**
 * Compute cursor pixel position within a header/footer layout for a visible page.
 */
function computeHFCursorPixel(
  position: DocPosition,
  hfLayout: DocumentLayout,
  hf: HeaderFooter,
  region: 'header' | 'footer',
  paginatedLayout: PaginatedLayout,
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  activePageIndex: number,
  cursorVisible: boolean,
): { x: number; y: number; height: number; visible: boolean } | undefined {
  const lb = hfLayout.blocks.find((b) => b.block.id === position.blockId);
  if (!lb) return undefined;

  const pageX = getPageXOffset(paginatedLayout, canvasWidth);
  const { margins } = paginatedLayout.pageSetup;

  // Find cursor x and line y within header/footer layout
  let cursorX = 0;
  let cursorLineY = 0;
  let lineHeight = lb.lines[0]?.height ?? 14;
  let offsetRemaining = position.offset;

  for (const line of lb.lines) {
    let lineChars = 0;
    for (const run of line.runs) lineChars += run.text.length;
    if (offsetRemaining <= lineChars) {
      lineHeight = line.height;
      cursorLineY = line.y;
      let chars = 0;
      for (const run of line.runs) {
        if (offsetRemaining <= chars + run.text.length) {
          const localOff = offsetRemaining - chars;
          if (run.imageHeight !== undefined) {
            cursorX = run.x + (localOff > 0 ? run.width : 0);
          } else {
            const textBefore = run.text.slice(0, localOff);
            ctx.font = buildFont(
              run.inline.style.fontSize, run.inline.style.fontFamily,
              run.inline.style.bold, run.inline.style.italic,
            );
            cursorX = run.x + ctx.measureText(textBefore).width;
          }
          break;
        }
        chars += run.text.length;
      }
      break;
    }
    offsetRemaining -= lineChars;
  }

  // Render cursor on the active page
  const targetPage = paginatedLayout.pages[activePageIndex];
  if (targetPage) {
    let baseY: number;
    if (region === 'header') {
      baseY = getHeaderYStart(paginatedLayout, activePageIndex, hf.marginFromEdge);
    } else {
      baseY = getFooterYStart(paginatedLayout, activePageIndex, hfLayout.totalHeight, hf.marginFromEdge);
    }

    return {
      x: pageX + margins.left + cursorX,
      y: baseY + lb.y + cursorLineY,
      height: lineHeight,
      visible: cursorVisible,
    };
  }
  return undefined;
}

/**
 * Compute selection rects within a header/footer layout for all visible pages.
 */
function computeHFSelectionRects(
  selectionRange: { anchor: DocPosition; focus: DocPosition },
  hfLayout: DocumentLayout,
  hf: HeaderFooter,
  region: 'header' | 'footer',
  paginatedLayout: PaginatedLayout,
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  activePageIndex: number,
): Array<{ x: number; y: number; width: number; height: number }> {
  const rects: Array<{ x: number; y: number; width: number; height: number }> = [];
  const pageX = getPageXOffset(paginatedLayout, canvasWidth);
  const { margins } = paginatedLayout.pageSetup;

  // Find start/end offsets across header/footer blocks
  let startBlockIdx = -1, endBlockIdx = -1;
  let startOffset = 0, endOffset = 0;
  for (let i = 0; i < hfLayout.blocks.length; i++) {
    if (hfLayout.blocks[i].block.id === selectionRange.anchor.blockId) {
      startBlockIdx = i;
      startOffset = selectionRange.anchor.offset;
    }
    if (hfLayout.blocks[i].block.id === selectionRange.focus.blockId) {
      endBlockIdx = i;
      endOffset = selectionRange.focus.offset;
    }
  }
  if (startBlockIdx === -1 || endBlockIdx === -1) return rects;

  // Normalize direction
  if (startBlockIdx > endBlockIdx || (startBlockIdx === endBlockIdx && startOffset > endOffset)) {
    [startBlockIdx, endBlockIdx] = [endBlockIdx, startBlockIdx];
    [startOffset, endOffset] = [endOffset, startOffset];
  }

  // Build rects for each line in the selection range (layout-relative)
  const layoutRects: Array<{ x: number; y: number; width: number; height: number }> = [];
  for (let bi = startBlockIdx; bi <= endBlockIdx; bi++) {
    const lb = hfLayout.blocks[bi];
    let blockCharsSoFar = 0;
    for (const line of lb.lines) {
      let lineChars = 0;
      for (const run of line.runs) lineChars += run.text.length;
      const lineStart = blockCharsSoFar;
      const lineEnd = blockCharsSoFar + lineChars;

      const selStart = bi === startBlockIdx ? startOffset : 0;
      const selEnd = bi === endBlockIdx ? endOffset : getBlockTextLength(lb.block);

      if (selEnd > lineStart && selStart < lineEnd) {
        // This line is in the selection
        let x0 = 0, x1 = line.width;
        // Compute x0 from selStart within this line
        const lineSelStart = Math.max(0, selStart - lineStart);
        const lineSelEnd = Math.min(lineChars, selEnd - lineStart);
        let chars = 0;
        for (const run of line.runs) {
          const runLen = run.text.length;
          if (chars + runLen > lineSelStart && x0 === 0 && lineSelStart > 0) {
            const localOff = lineSelStart - chars;
            if (run.imageHeight !== undefined) {
              x0 = run.x + (localOff > 0 ? run.width : 0);
            } else {
              ctx.font = buildFont(run.inline.style.fontSize, run.inline.style.fontFamily, run.inline.style.bold, run.inline.style.italic);
              x0 = run.x + ctx.measureText(run.text.slice(0, localOff)).width;
            }
          }
          if (chars + runLen >= lineSelEnd) {
            const localOff = lineSelEnd - chars;
            if (run.imageHeight !== undefined) {
              x1 = run.x + (localOff > 0 ? run.width : 0);
            } else {
              ctx.font = buildFont(run.inline.style.fontSize, run.inline.style.fontFamily, run.inline.style.bold, run.inline.style.italic);
              x1 = run.x + ctx.measureText(run.text.slice(0, localOff)).width;
            }
            break;
          }
          chars += runLen;
        }
        layoutRects.push({ x: x0, y: lb.y + line.y, width: x1 - x0, height: line.height });
      }
      blockCharsSoFar += lineChars;
    }
  }

  // Map layout rects to the active page only
  {
    let baseY: number;
    if (region === 'header') {
      baseY = getHeaderYStart(paginatedLayout, activePageIndex, hf.marginFromEdge);
    } else {
      baseY = getFooterYStart(paginatedLayout, activePageIndex, hfLayout.totalHeight, hf.marginFromEdge);
    }
    for (const r of layoutRects) {
      rects.push({
        x: pageX + margins.left + r.x,
        y: baseY + r.y,
        width: r.width,
        height: r.height,
      });
    }
  }

  return rects;
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
  canvas.dataset.role = 'doc-canvas';
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
  let layout: DocumentLayout = { blocks: [], totalHeight: 0, blockParentMap: new Map() };
  let paginatedLayout: PaginatedLayout = { pages: [], pageSetup: resolvePageSetup(undefined) };
  let headerLayout: DocumentLayout | null = null;
  let footerLayout: DocumentLayout | null = null;
  let layoutCache: LayoutCache | undefined;
  let dirtyBlockIds: Set<string> | undefined;
  let needsScrollIntoView = false;
  let focused = !readOnly;

  /**
   * Ensure the cursor points to a block that still exists in the document.
   * After a remote change deletes the block the cursor is on, relocate it
   * to the first block so subsequent reads don't throw.
   */
  const validateCursorPosition = (): void => {
    if (doc.findBlock(cursor.position.blockId)) return;
    const firstBlock = doc.getContextBlocks()[0] ?? doc.document.blocks[0];
    if (firstBlock) {
      cursor.moveTo({ blockId: firstBlock.id, offset: 0 });
      selection.setRange(null);
    }
  };

  /** Apply inline style to all blocks in all cells within a cell range. */
  function applyStyleToCellRange(
    cellRange: { blockId: string; start: CellAddress; end: CellAddress },
    style: Partial<InlineStyle>,
  ): void {
    const block = doc.getBlock(cellRange.blockId);
    if (!block.tableData) return;
    const minRow = Math.min(cellRange.start.rowIndex, cellRange.end.rowIndex);
    const maxRow = Math.max(cellRange.start.rowIndex, cellRange.end.rowIndex);
    const minCol = Math.min(cellRange.start.colIndex, cellRange.end.colIndex);
    const maxCol = Math.max(cellRange.start.colIndex, cellRange.end.colIndex);
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        const cell = block.tableData.rows[r]?.cells[c];
        if (!cell || cell.colSpan === 0) continue;
        for (const cellBlock of cell.blocks) {
          const len = getBlockTextLength(cellBlock);
          if (len > 0) {
            doc.applyInlineStyle(
              { anchor: { blockId: cellBlock.id, offset: 0 }, focus: { blockId: cellBlock.id, offset: len } },
              style,
            );
          }
        }
      }
    }
  }

  let dragGuideline: { x?: number; y?: number } | null = null;
  let peerCursors: PeerCursor[] = [];
  let cursorMoveCallback: ((pos: { blockId: string; offset: number }, selection?: { anchor: { blockId: string; offset: number }; focus: { blockId: string; offset: number }; tableCellRange?: { blockId: string; start: { rowIndex: number; colIndex: number }; end: { rowIndex: number; colIndex: number } } } | null) => void) | null = null;
  let lastPeerPixels: Array<{ clientID: string; x: number; y: number; height: number }> = [];
  let searchMatches: SearchMatch[] = [];
  let activeMatchIndex = -1;
  let scaleFactor = 1;

  // Position of the currently selected image. When set, the text caret
  // is suppressed and the image selection overlay (Milestone 2) renders
  // handles here. Kept as `null` when the user is in text editing mode.
  let selectedImage: { blockId: string; offset: number } | null = null;

  /**
   * In-progress resize drag, driven by a handle-drag on the selected
   * image's overlay. While this is non-null, `render()` draws the
   * overlay at the preview rect rather than the committed image rect,
   * and the actual `ImageData.width/height` stay unchanged until
   * `mouseup` commits a single `updateSelectedImage` call (so the
   * drag produces exactly one undo step).
   */
  let imageResizeDrag:
    | {
        handle: ImageHandle;
        startRect: ImageRect;
        startClientX: number;
        startClientY: number;
        previewRect: ImageRect;
        blockId: string;
        offset: number;
        /**
         * Whether the aspect ratio is currently being held. Corner
         * drags default to `true`; Shift releases the lock. Side
         * handles ignore this field (they only change one axis).
         * Tracked here so the HUD pill can reflect the state during
         * the drag even when the user hasn't yet moved the mouse.
         */
        aspectLocked: boolean;
      }
    | null = null;

  /**
   * Callback the host (frontend) installs via `onImageFileDrop` to
   * receive image files from drag-and-drop + clipboard paste. The
   * editor owns the event wiring; the host owns upload + insert.
   */
  let imageFileDropCallback: ((file: File, position: { blockId: string; offset: number }) => void) | null = null;

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
    doc.setBlockParentMap(layout.blockParentMap);
    paginatedLayout = paginateLayout(layout, pageSetup);

    // Header/footer layouts
    if (doc.document.header) {
      headerLayout = computeLayout(
        doc.document.header.blocks,
        docCanvas.getContext(),
        contentWidth,
      ).layout;
    } else {
      headerLayout = null;
    }
    if (doc.document.footer) {
      footerLayout = computeLayout(
        doc.document.footer.blocks,
        docCanvas.getContext(),
        contentWidth,
      ).layout;
    } else {
      footerLayout = null;
    }
  };

  const markDirty = (blockId: string) => {
    if (dirtyBlockIds === undefined) {
      dirtyBlockIds = new Set();
    }
    dirtyBlockIds.add(blockId);
  };

  /**
   * Invoke `fn` for every leaf block in the current selection.
   * Handles cell-range selection, same-cell cross-block, top-level
   * multi-block (including table-internal cells), and cursor-only.
   * Calls markDirty for each affected top-level block.
   */
  const forEachBlockInSelection = (fn: (block: Block) => void): void => {
    if (selection.hasSelection() && selection.range) {
      const range = selection.range;
      // Cell-range selection
      if (range.tableCellRange) {
        const cr = range.tableCellRange;
        const tableBlock = doc.getBlock(cr.blockId);
        if (tableBlock.tableData) {
          const minR = Math.min(cr.start.rowIndex, cr.end.rowIndex);
          const maxR = Math.max(cr.start.rowIndex, cr.end.rowIndex);
          const minC = Math.min(cr.start.colIndex, cr.end.colIndex);
          const maxC = Math.max(cr.start.colIndex, cr.end.colIndex);
          for (let r = minR; r <= maxR; r++) {
            for (let c = minC; c <= maxC; c++) {
              const cell = tableBlock.tableData.rows[r]?.cells[c];
              if (!cell || cell.colSpan === 0) continue;
              for (const cellBlock of cell.blocks) {
                fn(cellBlock);
              }
            }
          }
          markDirty(cr.blockId);
          return;
        }
      }
      // Same-cell cross-block selection
      const anchorCI = layout.blockParentMap.get(range.anchor.blockId);
      const focusCI = layout.blockParentMap.get(range.focus.blockId);
      if (anchorCI && focusCI &&
          anchorCI.tableBlockId === focusCI.tableBlockId &&
          anchorCI.rowIndex === focusCI.rowIndex &&
          anchorCI.colIndex === focusCI.colIndex) {
        const tableBlock = doc.getBlock(anchorCI.tableBlockId);
        const cell = tableBlock.tableData!.rows[anchorCI.rowIndex].cells[anchorCI.colIndex];
        const aIdx = cell.blocks.findIndex(b => b.id === range.anchor.blockId);
        const fIdx = cell.blocks.findIndex(b => b.id === range.focus.blockId);
        const lo = Math.min(aIdx, fIdx);
        const hi = Math.max(aIdx, fIdx);
        for (let i = lo; i <= hi; i++) {
          fn(cell.blocks[i]);
        }
        markDirty(anchorCI.tableBlockId);
        return;
      }
      // Top-level multi-block (with table traversal)
      const startIdx = doc.getBlockIndex(range.anchor.blockId);
      const endIdx = doc.getBlockIndex(range.focus.blockId);
      if (startIdx >= 0 && endIdx >= 0) {
        const lo = Math.min(startIdx, endIdx);
        const hi = Math.max(startIdx, endIdx);
        const contextBlocks = doc.getContextBlocks();
        for (let i = lo; i <= hi; i++) {
          const b = contextBlocks[i];
          if (b.type === 'table' && b.tableData) {
            for (const row of b.tableData.rows) {
              for (const cell of row.cells) {
                if (cell.colSpan === 0) continue;
                for (const cellBlock of cell.blocks) {
                  fn(cellBlock);
                }
              }
            }
          } else {
            fn(b);
          }
          markDirty(b.id);
        }
        return;
      }
    }
    // No selection or fallback: cursor block only
    const block = doc.getBlock(cursor.position.blockId);
    fn(block);
    const cellInfo = layout.blockParentMap.get(block.id);
    markDirty(cellInfo?.tableBlockId ?? block.id);
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

    // Hide cursor when in cell-range selection mode
    const cursorPixel = selection.range?.tableCellRange
      ? undefined
      : cursor.getPixelPosition(paginatedLayout, layout, docCanvas.getContext(), logicalCanvasWidth);

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
            anchor: { blockId: match.blockId, offset: match.startOffset },
            focus: { blockId: match.blockId, offset: match.endOffset },
          },
          paginatedLayout,
          layout,
          docCanvas.getContext(),
          logicalCanvasWidth,
        ),
      );
    }

    const editCtx = textEditor?.getEditContext() ?? 'body';

    // Compute header/footer cursor and selection
    let hfCursorHeader: { x: number; y: number; height: number; visible: boolean } | undefined;
    let hfCursorFooter: { x: number; y: number; height: number; visible: boolean } | undefined;
    let hfSelectionRects: Array<{ x: number; y: number; width: number; height: number }> | undefined;

    if (editCtx === 'header' && headerLayout && doc.document.header) {
      const hfPage = textEditor?.getHFActivePageIndex() ?? 0;
      hfCursorHeader = computeHFCursorPixel(
        cursor.position, headerLayout, doc.document.header, 'header',
        paginatedLayout, docCanvas.getContext(), logicalCanvasWidth,
        hfPage, cursor.isVisible(),
      );
      if (selection.hasSelection() && selection.range) {
        hfSelectionRects = computeHFSelectionRects(
          selection.range, headerLayout, doc.document.header, 'header',
          paginatedLayout, docCanvas.getContext(), logicalCanvasWidth, hfPage,
        );
      }
    }
    if (editCtx === 'footer' && footerLayout && doc.document.footer) {
      const hfPageF = textEditor?.getHFActivePageIndex() ?? 0;
      hfCursorFooter = computeHFCursorPixel(
        cursor.position, footerLayout, doc.document.footer, 'footer',
        paginatedLayout, docCanvas.getContext(), logicalCanvasWidth,
        hfPageF, cursor.isVisible(),
      );
      if (selection.hasSelection() && selection.range) {
        hfSelectionRects = computeHFSelectionRects(
          selection.range, footerLayout, doc.document.footer, 'footer',
          paginatedLayout, docCanvas.getContext(), logicalCanvasWidth, hfPageF,
        );
      }
    }

    // If an image is currently selected, walk the layout once and
    // resolve its screen-space rect so the overlay draws in the right
    // place. While a resize drag is active, the overlay tracks the
    // preview rect instead so the user sees the handles following
    // their cursor in real time — the committed `ImageData` stays
    // unchanged until mouseup so the drag produces exactly one undo
    // step.
    let selectedImageRect: ImageRect | undefined;
    let imageResizeHudText: string | undefined;
    let dragImageRun: LayoutRun | undefined;
    if (imageResizeDrag) {
      selectedImageRect = imageResizeDrag.previewRect;
      imageResizeHudText = formatResizeHud(
        imageResizeDrag.handle,
        imageResizeDrag.previewRect,
        imageResizeDrag.aspectLocked,
      );
      // Locate the specific LayoutRun that corresponds to the image
      // being dragged so DocCanvas can (a) skip drawing it at its
      // committed size during the normal content pass and (b) draw
      // it with a drop shadow at the preview rect instead. Handles
      // both body blocks and cell blocks — the cell path goes via
      // `blockParentMap` so the table's `LayoutTableCell.lines` can
      // be walked directly.
      const dragBlockId = imageResizeDrag.blockId;
      const dragOffset = imageResizeDrag.offset;
      const cellInfo = layout.blockParentMap.get(dragBlockId);
      if (cellInfo) {
        const tableBlock = layout.blocks.find(
          (b) => b.block.id === cellInfo.tableBlockId,
        );
        const layoutCell =
          tableBlock?.layoutTable?.cells[cellInfo.rowIndex]?.[cellInfo.colIndex];
        const cellData = tableBlock?.block.tableData?.rows[cellInfo.rowIndex]
          ?.cells[cellInfo.colIndex];
        if (layoutCell && cellData) {
          const boundaries = layoutCell.blockBoundaries;
          // Find the block index of `dragBlockId` within this cell.
          const innerIdx = cellData.blocks.findIndex(
            (bl) => bl.id === dragBlockId,
          );
          if (innerIdx >= 0) {
            const firstLine = boundaries[innerIdx] ?? 0;
            const lastLine = boundaries[innerIdx + 1] ?? layoutCell.lines.length;
            let offsetCursor = 0;
            outer: for (let li = firstLine; li < lastLine; li++) {
              for (const run of layoutCell.lines[li].runs) {
                if (offsetCursor === dragOffset && run.inline.style.image) {
                  dragImageRun = run;
                  break outer;
                }
                offsetCursor += run.charEnd - run.charStart;
              }
            }
          }
        }
      } else {
        const lb = layout.blocks.find((b) => b.block.id === dragBlockId);
        if (lb) {
          let offsetCursor = 0;
          outer: for (const line of lb.lines) {
            for (const run of line.runs) {
              if (offsetCursor === dragOffset && run.inline.style.image) {
                dragImageRun = run;
                break outer;
              }
              offsetCursor += run.charEnd - run.charStart;
            }
          }
        }
      }
    } else if (selectedImage) {
      selectedImageRect = collectImageRects(layout, paginatedLayout, logicalCanvasWidth)
        .get(`${selectedImage.blockId}:${selectedImage.offset}`);
    }

    docCanvas.render(
      paginatedLayout, scrollY, logicalCanvasWidth, canvasHeight,
      editCtx === 'body' ? (cursorPixel ?? undefined) : undefined,
      editCtx === 'body' ? selectionRects : undefined,
      focused, resolvedPeers, peerSelections, layout,
      searchHighlightRects, activeMatchIndex, scaleFactor,
      headerLayout, footerLayout,
      {
        header: doc.document.header ? { marginFromEdge: doc.document.header.marginFromEdge } : undefined,
        footer: doc.document.footer ? { marginFromEdge: doc.document.footer.marginFromEdge } : undefined,
      },
      editCtx,
      hfCursorHeader,
      hfCursorFooter,
      hfSelectionRects,
      selectedImageRect,
      imageResizeHudText,
      dragImageRun,
    );

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

    // Render rulers — target the page where the cursor is. For cells
    // inside a table, the cursor's blockId is not a top-level block so
    // findPageForPosition can't resolve it; fall back to the pixel
    // position (which already knows which row and page the cursor lives
    // on via resolvePositionPixel's per-row lookup).
    const cursorCellInfo = layout.blockParentMap.get(cursor.position.blockId);
    const cursorBlockId = cursorCellInfo
      ? cursorCellInfo.tableBlockId
      : cursor.position.blockId;
    const cursorBlock = doc.document.blocks.find((b) => b.id === cursorBlockId);

    let cursorPageIndex = 0;
    if (cursorPixel) {
      for (const page of paginatedLayout.pages) {
        const pageY = getPageYOffset(paginatedLayout, page.pageIndex);
        if (cursorPixel.y >= pageY && cursorPixel.y < pageY + page.height) {
          cursorPageIndex = page.pageIndex;
          break;
        }
      }
    } else {
      const pageInfo = findPageForPosition(
        paginatedLayout, cursor.position.blockId, cursor.position.offset, layout,
      );
      if (pageInfo) cursorPageIndex = pageInfo.pageIndex;
    }

    if (scaleFactor >= 1) {
      ruler.render(
        paginatedLayout,
        scrollY,
        logicalCanvasWidth,
        canvasHeight,
        cursorBlock?.style ?? null,
        cursorPageIndex,
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

  // Allow the canvas to request a paint-only re-render once async resources
  // (inline images) finish loading. Layout already reserved space using the
  // known image dimensions, so no relayout is needed.
  docCanvas.setRequestRender(() => renderPaintOnly());

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
      textEditor?.setEditContext('body');
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
      textEditor?.setEditContext('body');
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
      ? {
          anchor: selection.range.anchor,
          focus: selection.range.focus,
          tableCellRange: selection.range.tableCellRange,
        }
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
    () => headerLayout,
    () => footerLayout,
  );
  textEditorRef = textEditor;

  if (textEditor) {
    textEditor.onDragGuideline = (pos) => {
      dragGuideline = pos;
      renderPaintOnly();
    };

    // Image selection key routing. Delete/Backspace delete the selected
    // image inline and return to text mode; Escape clears the image
    // selection without mutating the doc; anything else (arrows, typing,
    // modifier combos) returns false so TextEditor handles the key
    // normally — we just clear the image selection first so typing
    // while an image is selected naturally replaces the image's slot
    // with a plain caret, matching Google Docs.
    // `textEditor.imageHoverHandler` is assigned below, after
    // `handleImageHover` is declared — it can't be wired here because
    // `const` declarations in the TDZ would throw on reference.
    textEditor.imageKeyHandler = (e: KeyboardEvent): boolean => {
      if (!selectedImage) return false;
      const key = e.key;
      if (key === 'Escape') {
        e.preventDefault();
        const restore = selectedImage;
        selectedImage = null;
        cursor.moveTo({ blockId: restore.blockId, offset: restore.offset });
        render();
        return true;
      }
      if (key === 'Delete' || key === 'Backspace') {
        e.preventDefault();
        const { blockId, offset } = selectedImage;
        docStore.snapshot();
        doc.deleteText({ blockId, offset }, 1);
        selectedImage = null;
        cursor.moveTo({ blockId, offset });
        markDirty(blockId);
        invalidateLayout();
        render();
        return true;
      }
      // Arrow keys deselect the image and move the cursor, matching
      // Google Docs behavior. Left places the caret before the image,
      // Right places it after. Shift+Arrow clears the image selection
      // and falls through to TextEditor so it can extend the text
      // selection normally.
      if (
        key === 'ArrowLeft' || key === 'ArrowRight' ||
        key === 'ArrowUp'   || key === 'ArrowDown'
      ) {
        const { blockId, offset } = selectedImage;
        selectedImage = null;
        if (e.shiftKey || key === 'ArrowUp' || key === 'ArrowDown') {
          // Fall through to TextEditor for Shift+Arrow selection
          // and Up/Down vertical navigation
          render();
          return false;
        }
        e.preventDefault();
        if (key === 'ArrowRight') {
          cursor.moveTo({ blockId, offset: offset + 1 });
        } else if (key === 'ArrowLeft') {
          cursor.moveTo({ blockId, offset });
        }
        render();
        return true;
      }
      // Other keys clear image selection and fall through so the text
      // path sees them on the now-active caret.
      selectedImage = null;
      return false;
    };
  }

  // Convert a MouseEvent clientXY into document-layout coordinates
  // (the same space `collectImageRects` returns). Used by every image
  // pointer handler below, so keep the math in one place.
  const clientToDocCoords = (clientX: number, clientY: number) => {
    const containerRect = container.getBoundingClientRect();
    const canvasOffsetTop = canvas.getBoundingClientRect().top - containerRect.top;
    const s = scaleFactor;
    return {
      x: (clientX - containerRect.left + container.scrollLeft) / s,
      y: (clientY - containerRect.top - canvasOffsetTop) / s + container.scrollTop / s,
    };
  };

  // Return the committed rect of the currently selected image, or
  // undefined if no image is selected / its position is stale.
  const getSelectedImageRectCommitted = (): ImageRect | undefined => {
    if (!selectedImage || !layout) return undefined;
    const s = scaleFactor;
    const canvasWidth = canvas.getBoundingClientRect().width / s;
    const rects = collectImageRects(layout, paginatedLayout, canvasWidth);
    return rects.get(`${selectedImage.blockId}:${selectedImage.offset}`);
  };

  // Maximum width/height an image may be resized to. Width is capped
  // at the current page's content width so the user can't drag the
  // image past the right margin. Height uses the same value doubled —
  // images taller than ~2x content width are extremely rare and this
  // keeps the max free of page-layout assumptions.
  const getResizeMax = () => {
    const pageSetup = resolvePageSetup(doc.document.pageSetup);
    const dims = getEffectiveDimensions(pageSetup);
    const contentWidth = dims.width - pageSetup.margins.left - pageSetup.margins.right;
    return {
      maxWidth: contentWidth,
      maxHeight: contentWidth * 2,
    };
  };

  const handleImageResizeMouseMove = (e: MouseEvent) => {
    if (!imageResizeDrag) return;
    const s = scaleFactor;
    const dx = (e.clientX - imageResizeDrag.startClientX) / s;
    const dy = (e.clientY - imageResizeDrag.startClientY) / s;
    const aspectLocked = !e.shiftKey;
    const { maxWidth, maxHeight } = getResizeMax();
    const { width, height } = computeResizeDelta(
      imageResizeDrag.handle,
      imageResizeDrag.startRect.width,
      imageResizeDrag.startRect.height,
      dx,
      dy,
      { aspectLock: aspectLocked, maxWidth, maxHeight },
    );
    imageResizeDrag.previewRect = computePreviewRect(
      imageResizeDrag.startRect,
      imageResizeDrag.handle,
      width,
      height,
    );
    imageResizeDrag.aspectLocked = aspectLocked;
    renderPaintOnly();
  };

  const handleImageResizeMouseUp = () => {
    if (!imageResizeDrag) return;
    const commit = imageResizeDrag.previewRect;
    const { blockId, offset } = imageResizeDrag;
    // Tear down drag state before mutating so any synchronous render
    // during the mutation sees the committed selection rather than
    // the preview rect.
    document.removeEventListener('mousemove', handleImageResizeMouseMove);
    document.removeEventListener('mouseup', handleImageResizeMouseUp);
    imageResizeDrag = null;
    canvas.style.cursor = '';

    // Only commit if the drag actually changed the size. Avoids a
    // no-op undo step for a mousedown-up on a handle without movement.
    const block = doc.getBlock(blockId);
    const current = block ? findImageAtOffset(block, offset) : null;
    if (!current) {
      render();
      return;
    }
    if (current.width === commit.width && current.height === commit.height) {
      render();
      return;
    }
    docStore.snapshot();
    const merged = { ...current, width: commit.width, height: commit.height };
    doc.applyInlineStyle(
      {
        anchor: { blockId, offset },
        focus: { blockId, offset: offset + 1 },
      },
      { image: merged },
    );
    markDirty(blockId);
    invalidateLayout();
    render();
  };

  // Image hit test, installed in the capture phase so it runs before
  // TextEditor's bubble-phase container listener. A click on a handle
  // starts a resize drag; a click on an image's body selects it; a
  // click elsewhere clears the image selection and lets TextEditor
  // handle the click normally.
  const handleImageMouseDown = (e: MouseEvent) => {
    if (readOnly) return;
    if (!layout) return;
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (
      target.tagName === 'BUTTON' ||
      target.tagName === 'INPUT' ||
      target.closest('button, [role="menu"], [role="menuitem"]')
    ) {
      return;
    }

    const { x: docX, y: docY } = clientToDocCoords(e.clientX, e.clientY);
    const s = scaleFactor;
    const canvasWidth = canvas.getBoundingClientRect().width / s;
    const rects = collectImageRects(layout, paginatedLayout, canvasWidth);

    // 1) If an image is already selected, check for a handle hit first
    //    so the user can start a resize drag without having to click
    //    the image body twice.
    if (selectedImage) {
      const selRect = rects.get(`${selectedImage.blockId}:${selectedImage.offset}`);
      if (selRect) {
        const handle = hitTestImageHandle(selRect, docX, docY);
        if (handle) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          imageResizeDrag = {
            handle,
            startRect: selRect,
            startClientX: e.clientX,
            startClientY: e.clientY,
            previewRect: selRect,
            blockId: selectedImage.blockId,
            offset: selectedImage.offset,
            aspectLocked: !e.shiftKey,
          };
          canvas.style.cursor = cursorForHandle(handle);
          document.addEventListener('mousemove', handleImageResizeMouseMove);
          document.addEventListener('mouseup', handleImageResizeMouseUp);
          return;
        }
      }
    }

    // 2) Image body hit — select it.
    const hit = findImageAtPoint(rects, docX, docY);
    if (hit) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      selection.setRange(null);
      selectedImage = { blockId: hit.blockId, offset: hit.offset };
      cursor.moveTo({ blockId: hit.blockId, offset: hit.offset });
      render();
      return;
    }

    // 3) Click elsewhere — clear any prior image selection and let
    //    TextEditor handle the click normally. No stopPropagation so
    //    the subsequent bubble listener still places the caret.
    if (selectedImage) {
      selectedImage = null;
      render();
    }
  };
  container.addEventListener('mousedown', handleImageMouseDown, { capture: true });

  /**
   * Drag-and-drop of image files into the editor. `dragover` must
   * `preventDefault` for the drop to fire; `drop` then inspects the
   * files on the transfer and routes the first image file to the
   * registered callback. Non-image drops fall through to the
   * browser's default (no-op on a canvas).
   */
  /**
   * Check `dataTransfer.items` for an image file entry. Usable in
   * both `dragover` and `drop` — unlike `dt.files`, which the browser
   * leaves **empty during `dragover`** for security, `dt.items`
   * exposes each entry's MIME type at drag time so we can accept or
   * reject the drop before the user releases the mouse. Without this
   * the `dragover` handler never calls `preventDefault()` and the
   * browser navigates to the dropped image URL (its default behavior).
   */
  const hasImageItem = (dt: DataTransfer | null): boolean => {
    if (!dt?.items) return false;
    for (const item of dt.items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) return true;
    }
    return false;
  };

  /** Extract the first image `File` from the drop. Only works on `drop`. */
  const getImageFile = (dt: DataTransfer | null): File | null => {
    if (!dt?.files) return null;
    for (const file of dt.files) {
      if (file.type.startsWith('image/')) return file;
    }
    return null;
  };

  const handleImageDragOver = (e: DragEvent) => {
    if (readOnly) return;
    if (!imageFileDropCallback) return;
    if (!hasImageItem(e.dataTransfer)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };

  const handleImageDrop = (e: DragEvent) => {
    if (readOnly) return;
    if (!imageFileDropCallback) return;
    const file = getImageFile(e.dataTransfer);
    if (!file) return;
    e.preventDefault();
    e.stopPropagation();
    // Move the caret to the drop location first so the subsequent
    // `insertImage` call lands where the user dropped the file.
    // Reuse the existing `paginatedPixelToPosition` via a synthetic
    // pointer position. If the drop happens outside any block the
    // caret stays where it was.
    const { x: docX, y: docY } = clientToDocCoords(e.clientX, e.clientY);
    let dropPosition: { blockId: string; offset: number } = { blockId: cursor.position.blockId, offset: cursor.position.offset };
    if (layout) {
      const s = scaleFactor;
      const canvasWidth = canvas.getBoundingClientRect().width / s;
      const hit = paginatedPixelToPosition(paginatedLayout, layout, docX, docY, canvasWidth);
      if (hit) {
        cursor.moveTo({ blockId: hit.blockId, offset: hit.offset });
        dropPosition = { blockId: hit.blockId, offset: hit.offset };
      }
    }
    imageFileDropCallback(file, dropPosition);
  };
  container.addEventListener('dragover', handleImageDragOver);
  container.addEventListener('drop', handleImageDrop);

  // Resize cursor hint for image handles. Installed as a pre-handler
  // on TextEditor.handleMouseMove rather than as a separate listener
  // so that TextEditor's own `setCanvasCursor('text')` reset doesn't
  // immediately overwrite ours. Returning `true` tells TextEditor to
  // skip its default cursor reset for this pointer position.
  const handleImageHover = (e: MouseEvent): boolean => {
    // While dragging, the drag state owns the cursor — skip the
    // hover override so the corner cursor doesn't flip to ns/ew
    // mid-drag.
    if (imageResizeDrag) return true;
    if (!selectedImage || !layout) return false;
    const selRect = getSelectedImageRectCommitted();
    if (!selRect) return false;
    const { x, y } = clientToDocCoords(e.clientX, e.clientY);
    const handle = hitTestImageHandle(selRect, x, y);
    if (!handle) return false;
    canvas.style.cursor = cursorForHandle(handle);
    return true;
  };
  if (textEditor) {
    textEditor.imageHoverHandler = handleImageHover;
  }

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
      // Resolve the block — either a cell block (via blockParentMap) or a top-level block
      const block = layout.blockParentMap.has(cursor.position.blockId)
        ? doc.getBlock(cursor.position.blockId)
        : doc.document.blocks.find((b) => b.id === cursor.position.blockId);
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

        // Cell-range mode: apply to all cells in range
        if (range.tableCellRange) {
          applyStyleToCellRange(range.tableCellRange, style);
          markDirty(range.tableCellRange.blockId);
          render();
          return;
        }

        doc.applyInlineStyle(range, style);
        // Mark affected blocks as dirty
        const anchorCI = layout.blockParentMap.get(range.anchor.blockId);
        const focusCI = layout.blockParentMap.get(range.focus.blockId);
        if (anchorCI) {
          // Cell block: mark the parent table block dirty
          markDirty(anchorCI.tableBlockId);
        } else if (focusCI) {
          markDirty(focusCI.tableBlockId);
        } else {
          const startIdx = doc.getBlockIndex(range.anchor.blockId);
          const endIdx = doc.getBlockIndex(range.focus.blockId);
          if (startIdx >= 0 && endIdx >= 0) {
            const lo = Math.min(startIdx, endIdx);
            const hi = Math.max(startIdx, endIdx);
            for (let i = lo; i <= hi; i++) {
              markDirty(doc.document.blocks[i].id);
            }
          }
        }
        render();
      }
    },
    applyBlockStyle: (style: Partial<BlockStyle>) => {
      docStore.snapshot();
      forEachBlockInSelection((block) => {
        doc.applyBlockStyle(block.id, style);
      });
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
      doc.setBlockType(cursor.position.blockId, type, opts);
      invalidateLayout();
      render();
    },
    toggleList(kind: 'ordered' | 'unordered') {
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
      invalidateLayout();
      render();
    },
    indent() {
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
      render();
    },
    outdent() {
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
      render();
    },
    insertLink: (url: string) => {
      if (selection.hasSelection() && selection.range) {
        docStore.snapshot();
        const range = selection.range;

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

        doc.insertText(pos, url);
        const range = {
          anchor: { blockId: pos.blockId, offset: pos.offset },
          focus: { blockId: pos.blockId, offset: pos.offset + url.length },
        };
        doc.applyInlineStyle(range, { href: url });
        cursor.moveTo({ blockId: pos.blockId, offset: pos.offset + url.length });
        markDirty(pos.blockId);
        needsScrollIntoView = true;
        render();
      }
    },
    removeLink: () => {
      // Resolve the block — either a cell block (via blockParentMap) or a top-level block
      const block = doc.getBlock(cursor.position.blockId);
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
      // Mark the containing block (or table block for cell blocks) as dirty
      const cellInfo = layout.blockParentMap.get(block.id);
      markDirty(cellInfo ? cellInfo.tableBlockId : block.id);
      render();
    },
    getLinkAtCursor: (): string | undefined => {
      const block = doc.getBlock(cursor.position.blockId);
      if (!block) return undefined;

      const inlines = block.inlines;

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
        cursor.moveTo({ blockId: match.blockId, offset: match.startOffset });
        selection.setRange({
          anchor: { blockId: match.blockId, offset: match.startOffset },
          focus: { blockId: match.blockId, offset: match.endOffset },
        });
      }
      searchMatches = [];
      activeMatchIndex = -1;
      render();
    },
    insertTable: (rows: number, cols: number) => {
      docStore.snapshot();
      const pos = cursor.position;
      const block = doc.getBlock(pos.blockId);
      const blockLen = getBlockTextLength(block);

      // Split the current block at the cursor so text after the cursor
      // becomes a separate paragraph below the table.
      if (pos.offset > 0 && pos.offset < blockLen) {
        doc.splitBlock(pos.blockId, pos.offset);
      }

      const blockIndex = doc.getBlockIndex(pos.blockId);
      const tableId = doc.insertTable(blockIndex + 1, rows, cols);

      // Ensure a paragraph exists after the table so the cursor can escape.
      const tableIndex = doc.getBlockIndex(tableId);
      doc.ensureBlockAfter(tableIndex);

      const tableBlock = doc.getBlock(tableId);
      const firstCellBlock = tableBlock.tableData!.rows[0].cells[0].blocks[0];
      cursor.moveTo({ blockId: firstCellBlock.id, offset: 0 });
      invalidateLayout();
      render();
    },
    deleteTable: () => {
      const cellInfo = layout.blockParentMap.get(cursor.position.blockId);
      if (!cellInfo) return;
      const blockId = cellInfo.tableBlockId;
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
    isInTable: () => layout.blockParentMap.has(cursor.position.blockId),
    getCellAddress: (): CellAddress | undefined => {
      const cellInfo = layout.blockParentMap.get(cursor.position.blockId);
      if (!cellInfo) return undefined;
      return { rowIndex: cellInfo.rowIndex, colIndex: cellInfo.colIndex };
    },
    insertTableRow: (above: boolean) => {
      const cellInfo = layout.blockParentMap.get(cursor.position.blockId);
      if (!cellInfo) return;
      docStore.snapshot();
      const idx = above ? cellInfo.rowIndex : cellInfo.rowIndex + 1;
      doc.insertRow(cellInfo.tableBlockId, idx);
      invalidateLayout();
      render();
    },
    deleteTableRow: () => {
      const cellInfo = layout.blockParentMap.get(cursor.position.blockId);
      if (!cellInfo) return;
      docStore.snapshot();
      const tableBlockId = cellInfo.tableBlockId;
      doc.deleteRow(tableBlockId, cellInfo.rowIndex);
      // Re-home cursor if the deleted row was the last one
      const td = doc.getBlock(tableBlockId).tableData;
      if (td) {
        const newRow = Math.min(cellInfo.rowIndex, td.rows.length - 1);
        const newCellBlock = td.rows[newRow].cells[cellInfo.colIndex].blocks[0];
        cursor.moveTo({ blockId: newCellBlock.id, offset: 0 });
      }
      invalidateLayout();
      render();
    },
    insertTableColumn: (left: boolean) => {
      const cellInfo = layout.blockParentMap.get(cursor.position.blockId);
      if (!cellInfo) return;
      docStore.snapshot();
      const idx = left ? cellInfo.colIndex : cellInfo.colIndex + 1;
      doc.insertColumn(cellInfo.tableBlockId, idx);
      invalidateLayout();
      render();
    },
    deleteTableColumn: () => {
      const cellInfo = layout.blockParentMap.get(cursor.position.blockId);
      if (!cellInfo) return;
      docStore.snapshot();
      const tableBlockId = cellInfo.tableBlockId;
      doc.deleteColumn(tableBlockId, cellInfo.colIndex);
      // Re-home cursor if the deleted column was the last one
      const td = doc.getBlock(tableBlockId).tableData;
      if (td) {
        const newCol = Math.min(cellInfo.colIndex, td.columnWidths.length - 1);
        const newCellBlock = td.rows[cellInfo.rowIndex].cells[newCol].blocks[0];
        cursor.moveTo({ blockId: newCellBlock.id, offset: 0 });
      }
      invalidateLayout();
      render();
    },
    mergeTableCells: (range: CellRange) => {
      const cellInfo = layout.blockParentMap.get(cursor.position.blockId);
      if (!cellInfo) return;
      docStore.snapshot();
      const tableBlockId = cellInfo.tableBlockId;
      doc.mergeCells(tableBlockId, range);
      // Move cursor to top-left cell of merged range
      const td = doc.getBlock(tableBlockId).tableData!;
      const topLeftBlock = td.rows[range.start.rowIndex].cells[range.start.colIndex].blocks[0];
      cursor.moveTo({ blockId: topLeftBlock.id, offset: 0 });
      invalidateLayout();
      render();
    },
    splitTableCell: () => {
      const cellInfo = layout.blockParentMap.get(cursor.position.blockId);
      if (!cellInfo) return;
      docStore.snapshot();
      doc.splitCell(cellInfo.tableBlockId, { rowIndex: cellInfo.rowIndex, colIndex: cellInfo.colIndex });
      invalidateLayout();
      render();
    },
    getTableMergeContext: () =>
      computeTableMergeContext(doc, layout.blockParentMap, cursor.position, selection.range),
    applyTableCellStyle: (style: Partial<CellStyle>) => {
      docStore.snapshot();
      // Cell-range selection: apply to all cells in range
      if (selection.range?.tableCellRange) {
        const cr = selection.range.tableCellRange;
        const minR = Math.min(cr.start.rowIndex, cr.end.rowIndex);
        const maxR = Math.max(cr.start.rowIndex, cr.end.rowIndex);
        const minC = Math.min(cr.start.colIndex, cr.end.colIndex);
        const maxC = Math.max(cr.start.colIndex, cr.end.colIndex);
        for (let r = minR; r <= maxR; r++) {
          for (let c = minC; c <= maxC; c++) {
            doc.applyCellStyle(cr.blockId, { rowIndex: r, colIndex: c }, style);
          }
        }
        markDirty(cr.blockId);
        render();
        return;
      }
      // Single cell
      const cellInfo = layout.blockParentMap.get(cursor.position.blockId);
      if (!cellInfo) return;
      doc.applyCellStyle(cellInfo.tableBlockId, { rowIndex: cellInfo.rowIndex, colIndex: cellInfo.colIndex }, style);
      markDirty(cellInfo.tableBlockId);
      render();
    },
    insertImage: (
      src: string,
      width: number,
      height: number,
      opts?: { alt?: string; originalWidth?: number; originalHeight?: number; position?: { blockId: string; offset: number } },
    ) => {
      if (readOnly) return;
      // If an explicit position was captured at drop/paste time, move
      // the cursor there before inserting so an async upload that
      // finishes after the user moved the caret still lands at the
      // original location.
      if (opts?.position) {
        cursor.moveTo(opts.position);
      }
      // Clamp the displayed width to the page's content width so a
      // 4000px screenshot pasted into an 8.5" page doesn't punch past
      // the right margin. Aspect ratio is preserved by
      // `clampImageToWidth`. Most insert paths (toolbar / DnD / paste
      // / URL insert) want this clamp by default; callers with a
      // pre-sized image can pass width <= maxWidth and it's a no-op.
      const pageSetup = resolvePageSetup(doc.document.pageSetup);
      const dims = getEffectiveDimensions(pageSetup);
      const maxWidth = dims.width - pageSetup.margins.left - pageSetup.margins.right;
      const clamped = clampImageToWidth(width, height, maxWidth);
      const displayWidth = clamped.width;
      const displayHeight = clamped.height;

      const pos = cursor.position;
      const imageData: ImageData = {
        src,
        width: displayWidth,
        height: displayHeight,
        ...(opts?.alt !== undefined ? { alt: opts.alt } : {}),
        ...(opts?.originalWidth !== undefined ? { originalWidth: opts.originalWidth } : {}),
        ...(opts?.originalHeight !== undefined ? { originalHeight: opts.originalHeight } : {}),
      };
      docStore.snapshot();
      // `insertImageInline` routes through the block-helpers path for both
      // top-level blocks and cells, so it works inside tables without
      // special-casing. Non-collapsed selection replacement is deferred
      // until the drag/paste wiring lands in Milestone 4.
      doc.insertImageInline(pos.blockId, pos.offset, {
        text: '\uFFFC',
        style: { image: imageData },
      });
      // Advance the caret past the image so the user can keep typing
      // after the insert, mirroring `insertPageNumber`'s cursor handling.
      cursor.moveTo({ blockId: pos.blockId, offset: pos.offset + 1 });
      markDirty(pos.blockId);
      invalidateLayout();
      needsScrollIntoView = true;
      render();
    },
    selectImageAt: (blockId: string, offset: number) => {
      const block = doc.getBlock(blockId);
      if (!block) return;
      if (!findImageAtOffset(block, offset)) return;
      selection.setRange(null);
      selectedImage = { blockId, offset };
      render();
    },
    clearImageSelection: () => {
      if (!selectedImage) return;
      selectedImage = null;
      render();
    },
    getSelectedImage: () => {
      if (!selectedImage) return null;
      const block = doc.getBlock(selectedImage.blockId);
      if (!block) return null;
      const data = findImageAtOffset(block, selectedImage.offset);
      if (!data) return null;
      return {
        data,
        blockId: selectedImage.blockId,
        offset: selectedImage.offset,
      };
    },
    updateSelectedImage: (patch: Partial<ImageData>) => {
      if (readOnly) return;
      if (!selectedImage) return;
      const block = doc.getBlock(selectedImage.blockId);
      if (!block) return;
      const current = findImageAtOffset(block, selectedImage.offset);
      if (!current) return;
      // Field-level merge: preserve any ImageData fields the caller did
      // not touch. Shallow merge is correct because ImageData is flat.
      const merged: ImageData = { ...current, ...patch };
      docStore.snapshot();
      doc.applyInlineStyle(
        {
          anchor: { blockId: selectedImage.blockId, offset: selectedImage.offset },
          focus: { blockId: selectedImage.blockId, offset: selectedImage.offset + 1 },
        },
        { image: merged },
      );
      markDirty(selectedImage.blockId);
      invalidateLayout();
      render();
    },
    onImageFileDrop: (cb: ((file: File, position: { blockId: string; offset: number }) => void) | null) => {
      imageFileDropCallback = cb;
      if (textEditor) {
        // Wire the clipboard path through TextEditor's paste handler.
        // `setImageFilePasteHandler` is installed below alongside
        // `imageKeyHandler`; it checks for image files on the clipboard
        // first and only falls through to the existing text-paste flow
        // when none are present.
        textEditor.imageFilePasteHandler = cb;
      }
    },
    insertPageNumber: () => {
      if (!textEditor) return;
      const ctx = textEditor.getEditContext();
      if (ctx !== 'header' && ctx !== 'footer') return;
      docStore.snapshot();
      doc.insertText(cursor.position, '#');
      doc.applyInlineStyle(
        {
          anchor: { blockId: cursor.position.blockId, offset: cursor.position.offset },
          focus: { blockId: cursor.position.blockId, offset: cursor.position.offset + 1 },
        },
        { pageNumber: true },
      );
      cursor.moveTo({ blockId: cursor.position.blockId, offset: cursor.position.offset + 1 });
      needsScrollIntoView = true;
      render();
    },
    getEditContext: () => textEditor?.getEditContext() ?? 'body',
    onEditContextChange: (cb: (context: 'body' | 'header' | 'footer') => void) => {
      textEditor?.onEditContextChange(cb);
    },
    focus: () => textEditor?.focus(),
    validateCursorPosition,
    resetAfterDocumentReplace: () => {
      doc.refresh();
      textEditor?.setEditContext('body');
      layoutCache = undefined;
      const firstBlock = doc.document.blocks[0];
      if (firstBlock) {
        cursor.moveTo({ blockId: firstBlock.id, offset: 0 });
      }
      selection.setRange(null);
      needsScrollIntoView = true;
      render();
    },
    dispose: () => {
      peerCursors = [];
      cursorMoveCallback = null;
      lastPeerPixels = [];
      selectedImage = null;
      imageResizeDrag = null;
      imageFileDropCallback = null;
      ruler.dispose();
      cursor.dispose();
      textEditor?.dispose();
      container.removeEventListener('mousedown', handleImageMouseDown, { capture: true });
      container.removeEventListener('dragover', handleImageDragOver);
      container.removeEventListener('drop', handleImageDrop);
      document.removeEventListener('mousemove', handleImageResizeMouseMove);
      document.removeEventListener('mouseup', handleImageResizeMouseUp);
      container.removeEventListener('scroll', handleScroll);
      document.removeEventListener('transitionend', handleTransitionEnd);
      resizeObserver.disconnect();
      canvas.remove();
    },
  };
}
