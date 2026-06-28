import { Doc } from '../model/document.js';
import type { Block, InlineStyle, BlockStyle, BlockType, HeadingLevel, SearchMatch, CellAddress, CellRange, CellStyle, ImageData } from '../model/types.js';
import { resolvePageSetup, getEffectiveDimensions, getBlockTextLength, getBlockText, findImageAtOffset, clampImageToWidth, CLEAR_INLINE_STYLE } from '../model/types.js';
import { MemDocStore } from '../store/memory.js';
import type { DocStore } from '../store/store.js';
import { DocCanvas } from './doc-canvas.js';
import { Cursor } from './cursor.js';
import { Selection, computeSelectionRects } from './selection.js';
import { TextEditor } from './text-editor.js';
import { computeLayout, resolveInlineFont, type ComposingContext, type DocumentLayout, type LayoutCache, type LayoutRun } from './layout.js';
import { paginateLayout, getTotalHeight, findPageForPosition, getPageXOffset, getPageYOffset, getHeaderYStart, getFooterYStart, paginatedPixelToPosition, type PaginatedLayout } from './pagination.js';
import { CanvasTextMeasurer } from './canvas-measurer.js';
import type { TextMeasurer } from './measurer.js';
import type { DocPosition, DocRange, HeaderFooter } from '../model/types.js';
import { findMarkerAt, type CommentMarker, type HighlightRect } from './comment-markers.js';
import { Ruler, RULER_SIZE } from './ruler/index.js';
import { computeScaleFactor } from './scale.js';
import { Theme, setThemeMode, type ThemeMode } from './theme.js';
import { defaultColorResolver, resolveColorAtPosition } from '../model/color.js';
import { type PeerCursor, resolvePositionPixel } from './peer-cursor.js';
import { computeTableMergeContext, type TableMergeContext } from './table-merge-context.js';
import { createPendingStyle } from './pending-style.js';
import { SpellSession, type SpellError } from '../spell/session.js';
import { SpellRouter } from '../spell/router.js';
import { LocalSpellProvider } from '../spell/local-provider.js';
import { resolveNestedTableLayout } from './table-layout.js';
import { computeMergedCellLineLayouts, cellOriginPx } from './table-geometry.js';
import type { BlockCellInfo } from '../model/types.js';
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
  /**
   * Summary of inline styles across the current selection. For each
   * key, returns the resolved value when uniform, the literal 'mixed'
   * when at least two distinct values exist within the range, or
   * undefined when the property is unset throughout. When there is no
   * selection, returns the style of the inline at the cursor (same
   * shape as getSelectionStyle).
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
  /** Apply inline style to current selection */
  applyStyle(style: Partial<InlineStyle>): void;
  /**
   * Strip all character-level inline styles (bold, italic, underline,
   * strikethrough, super/subscript, font size, font family, color,
   * background color, href) from the current selection. Block-level
   * formatting and structural inlines (page-number, image) are
   * preserved. No-op when nothing is selected.
   */
  clearInlineFormatting(): void;
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
  /**
   * Smooth-scroll the viewport so the given document position sits
   * roughly one-third from the top of the visible area. Silent no-op
   * when the position cannot be resolved (e.g. stale blockId) or
   * before the first paint() has run.
   */
  scrollToPosition(pos: DocPosition): void;
  /**
   * Register a callback for cursor position changes. Multiple callbacks
   * may be registered; they fire in registration order. The returned
   * function unsubscribes the callback. Old call sites that ignore the
   * return value remain valid — the callback simply stays registered
   * until `dispose()` is called.
   *
   * Callbacks ALSO fire after an inline / block style mutation
   * (`applyStyle`, `clearInlineFormatting`, `applyBlockStyle`) so toolbar
   * pickers can refresh their selection-derived summaries even though
   * the cursor itself has not moved.
   */
  onCursorMove(cb: (pos: { blockId: string; offset: number }, selection?: { anchor: { blockId: string; offset: number }; focus: { blockId: string; offset: number }; tableCellRange?: { blockId: string; start: { rowIndex: number; colIndex: number }; end: { rowIndex: number; colIndex: number } } } | null) => void): () => void;
  /** Restore local cursor and selection after collaborative anchor resolution. */
  restoreLocalCursor(cursorPos: DocPosition | null, range?: DocRange | null): void;
  /** Register a callback fired when an IME composition session starts. */
  onCompositionStart(cb: (startPos: DocPosition) => void): void;
  /** Register a callback fired when an IME composition session ends. */
  onCompositionEnd(cb: () => void): void;
  /**
   * Update the cached IME composition start position. Called by the
   * collaboration layer after a remote change has been resolved against
   * the composition anchor so the next composing-text replacement targets
   * the correct offset instead of a stale absolute one.
   */
  updateCompositionStartPosition(pos: DocPosition): void;
  /** Whether an IME composition session is currently active. */
  isComposing(): boolean;
  /** Get last-computed peer cursor pixel positions (for hover hit-testing) */
  getPeerCursorPixels(): Array<{ clientID: string; x: number; y: number; height: number }>;
  /** Get the block type at the cursor position */
  getBlockType(): { type: BlockType; headingLevel?: HeadingLevel; listKind?: 'ordered' | 'unordered'; listLevel?: number };
  /**
   * Read the block style at the cursor position. Used by the shared
   * toolbar pickers (e.g. LineSpacingPicker) so they can reflect the
   * current block's `lineHeight`, `textAlign`, etc.
   */
  getBlockStyle(): Partial<BlockStyle>;
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
  /**
   * Read the active selection range. Returns null when the user has only
   * a caret (no actual range). Used by callers that need a `DocRange` —
   * e.g. opening a composer over the current selection.
   */
  getActiveSelection(): { anchor: DocPosition; focus: DocPosition } | null;
  /** Register a callback for Cmd/Ctrl+F find requests */
  onFindRequest(cb: () => void): void;
  /** Register a callback for Cmd/Ctrl+H find & replace requests */
  onFindReplaceRequest(cb: () => void): void;
  /** Set search match highlights and active match index */
  setSearchMatches(matches: SearchMatch[], activeIndex: number): void;
  /** Clear all search match highlights and optionally move cursor to active match */
  clearSearchMatches(moveCursorToActive?: boolean): void;
  /**
   * Set the comment markers. The editor turns each marker's range into
   * highlight rects via the same selection layout used by search match
   * and peer cursors, so markers track resize / zoom / line wrap
   * automatically. Comment-naive: the editor does not interpret ids.
   * Pass an empty array to clear. Replaces any previous set.
   */
  setCommentMarkers(markers: CommentMarker[]): void;
  /**
   * Return the marker id under a viewport-relative (clientX, clientY)
   * point, or null when no marker is hit. The editor converts to
   * canvas-internal document coordinates (accounting for ruler offset,
   * scroll, and zoom) before hit-testing. When rects overlap, the
   * marker drawn last wins.
   */
  getCommentMarkerAt(clientX: number, clientY: number): string | null;
  /**
   * Attach a live SpellSession whose errors are drawn as red wavy
   * underlines on the next render. Pass `null` to detach.
   */
  setSpellSession(session: SpellSession | null): void;
  /**
   * Return the cached spell-error rects from the last render pass.
   * Used for hit-testing the spell-suggestions context menu.
   */
  getSpellErrorRects(): ReadonlyArray<{ x: number; y: number; width: number; height: number }>;
  /**
   * Enable or disable the built-in spell checker. On by default. When
   * disabled, existing squiggles are cleared and no rechecks run until
   * re-enabled.
   */
  setSpellCheckEnabled(enabled: boolean): void;
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
  /**
   * Test-only: set the selection range directly. Production code drives
   * selection through pointer / keyboard events on the TextEditor; tests
   * use this to skip the input layer and exercise selection-derived APIs
   * (e.g. getRangeStyleSummary) without simulating drag.
   */
  _setSelectionForTest(range: { anchor: DocPosition; focus: DocPosition } | null): void;
  /** Test-only: force the edit context (body/header/footer). */
  _setEditContextForTest(ctx: 'body' | 'header' | 'footer'): void;
  /** Test-only: read the current caret position. */
  _getCursorForTest(): DocPosition;
}

/**
 * Compute cursor pixel position within a header/footer layout for a visible page.
 */
/**
 * Caret pixel for a cursor inside a header/footer table cell. The cursor's
 * blockId is a cell inner block (not a top-level hfLayout block), so it is
 * located via `hfLayout.blockParentMap`. Header/footer tables are a single
 * non-paginated band; the line Y is the table-logical `runLineY` plus the
 * table's own `lb.y` and the region base Y.
 */
function computeHFTableCellCaretPixel(
  position: DocPosition,
  lineAffinity: 'forward' | 'backward',
  hfLayout: DocumentLayout,
  hf: HeaderFooter,
  region: 'header' | 'footer',
  paginatedLayout: PaginatedLayout,
  measurer: TextMeasurer,
  canvasWidth: number,
  activePageIndex: number,
  cursorVisible: boolean,
): { x: number; y: number; height: number; visible: boolean } | undefined {
  const cellInfo = hfLayout.blockParentMap.get(position.blockId);
  if (!cellInfo) return undefined;
  const tableLb = hfLayout.blocks.find((b) => b.block.id === cellInfo.tableBlockId);
  const tl = tableLb?.layoutTable;
  const tableData = tableLb?.block.tableData;
  if (!tableLb || !tl || !tableData) return undefined;
  const { rowIndex: row, colIndex: col } = cellInfo;
  const cell = tl.cells[row]?.[col];
  const dataCell = tableData.rows[row]?.cells[col];
  if (!cell || !dataCell) return undefined;
  const blockIdx = dataCell.blocks.findIndex((b) => b.id === position.blockId);
  if (blockIdx === -1) return undefined;

  const padding = dataCell.style.padding ?? 4;
  const rowSpan = dataCell.rowSpan ?? 1;
  const blockStartLine = cell.blockBoundaries[blockIdx] ?? 0;
  const blockEndLine = cell.blockBoundaries[blockIdx + 1] ?? cell.lines.length;

  // Find the line within this block that holds `offset`, and the x within it.
  let lineIdx = blockStartLine;
  let cursorXInCell = 0;
  let lineHeight = cell.lines[blockStartLine]?.height ?? 14;
  let remaining = position.offset;
  for (let li = blockStartLine; li < blockEndLine; li++) {
    const line = cell.lines[li];
    let lineChars = 0;
    for (const run of line.runs) lineChars += run.text.length;
    // At a wrap boundary, forward affinity belongs to the start of the
    // next visual line rather than the end of this one. Mirrors the body
    // caret resolver (`resolvePositionPixel`).
    if (
      lineAffinity === 'forward' &&
      remaining === lineChars &&
      li < blockEndLine - 1
    ) {
      remaining = 0;
      continue;
    }
    if (remaining <= lineChars || li === blockEndLine - 1) {
      lineIdx = li;
      lineHeight = line.height;
      let chars = 0;
      cursorXInCell = 0;
      for (const run of line.runs) {
        if (remaining <= chars + run.text.length) {
          const localOff = remaining - chars;
          cursorXInCell = run.x + (run.imageHeight !== undefined
            ? (localOff > 0 ? run.width : 0)
            : measurer.measureWidth(
                run.text.slice(0, localOff),
                resolveInlineFont(run.inline.style),
              ));
          break;
        }
        chars += run.text.length;
        cursorXInCell = run.x + run.width;
      }
      break;
    }
    remaining -= lineChars;
  }

  const lineLayouts = computeMergedCellLineLayouts(
    cell.lines, row, rowSpan, padding, tl.rowYOffsets, tl.rowHeights,
  );
  const runLineY = lineLayouts[lineIdx]?.runLineY ?? (tl.rowYOffsets[row] + padding);

  const targetPage = paginatedLayout.pages[activePageIndex];
  if (!targetPage) return undefined;
  const pageX = getPageXOffset(paginatedLayout, canvasWidth);
  const { margins } = paginatedLayout.pageSetup;
  const baseY = region === 'header'
    ? getHeaderYStart(paginatedLayout, activePageIndex, hf.marginFromEdge)
    : getFooterYStart(paginatedLayout, activePageIndex, hfLayout.totalHeight, hf.marginFromEdge);

  return {
    x: pageX + margins.left + tl.columnXOffsets[col] + padding + cursorXInCell,
    y: baseY + tableLb.y + runLineY,
    height: lineHeight,
    visible: cursorVisible,
  };
}

// Exported for unit tests only — not re-exported from the package index, so
// this does not widen the published API surface.
export function computeHFCursorPixel(
  position: DocPosition,
  lineAffinity: 'forward' | 'backward',
  hfLayout: DocumentLayout,
  hf: HeaderFooter,
  region: 'header' | 'footer',
  paginatedLayout: PaginatedLayout,
  measurer: TextMeasurer,
  canvasWidth: number,
  activePageIndex: number,
  cursorVisible: boolean,
): { x: number; y: number; height: number; visible: boolean } | undefined {
  const lb = hfLayout.blocks.find((b) => b.block.id === position.blockId);
  if (!lb) {
    // The caret may be inside a header/footer table cell, whose inner block
    // is not a top-level hfLayout block. Resolve it via the cell map.
    return computeHFTableCellCaretPixel(
      position, lineAffinity, hfLayout, hf, region, paginatedLayout, measurer,
      canvasWidth, activePageIndex, cursorVisible,
    );
  }

  const pageX = getPageXOffset(paginatedLayout, canvasWidth);
  const { margins } = paginatedLayout.pageSetup;

  // Find cursor x and line y within header/footer layout
  let cursorX = 0;
  let cursorLineY = 0;
  let lineHeight = lb.lines[0]?.height ?? 14;
  let offsetRemaining = position.offset;

  for (let li = 0; li < lb.lines.length; li++) {
    const line = lb.lines[li];
    let lineChars = 0;
    for (const run of line.runs) lineChars += run.text.length;
    // At a wrap boundary, forward affinity belongs to the start of the
    // next visual line. Mirrors the body caret resolver.
    if (
      lineAffinity === 'forward' &&
      offsetRemaining === lineChars &&
      li < lb.lines.length - 1
    ) {
      offsetRemaining = 0;
      continue;
    }
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
            cursorX = run.x + measurer.measureWidth(
              textBefore,
              resolveInlineFont(run.inline.style),
            );
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
 * Selection rects when a header/footer selection touches a table cell.
 * Two cases are drawn precisely; the rest degrade to whole-cell highlights:
 *  - same inner block (drag within one cell): per-line text rects.
 *  - both endpoints in the same table (drag across cells) or any other
 *    in-table combination: whole-cell rects over the bounding row/col box.
 * Header/footer tables are a single non-paginated band, so each cell maps
 * to exactly one rect (no page/split fragments).
 */
function computeHFTableCellSelectionRects(
  selectionRange: { anchor: DocPosition; focus: DocPosition },
  anchorCell: BlockCellInfo | undefined,
  focusCell: BlockCellInfo | undefined,
  hfLayout: DocumentLayout,
  hf: HeaderFooter,
  region: 'header' | 'footer',
  paginatedLayout: PaginatedLayout,
  measurer: TextMeasurer,
  canvasWidth: number,
  activePageIndex: number,
): Array<{ x: number; y: number; width: number; height: number }> {
  const rects: Array<{ x: number; y: number; width: number; height: number }> = [];
  const targetPage = paginatedLayout.pages[activePageIndex];
  if (!targetPage) return rects;
  const pageX = getPageXOffset(paginatedLayout, canvasWidth);
  const { margins } = paginatedLayout.pageSetup;
  const baseY = region === 'header'
    ? getHeaderYStart(paginatedLayout, activePageIndex, hf.marginFromEdge)
    : getFooterYStart(paginatedLayout, activePageIndex, hfLayout.totalHeight, hf.marginFromEdge);

  const cellInfo = anchorCell ?? focusCell;
  if (!cellInfo) return rects;
  const tableLb = hfLayout.blocks.find((b) => b.block.id === cellInfo.tableBlockId);
  const tl = tableLb?.layoutTable;
  const tableData = tableLb?.block.tableData;
  if (!tableLb || !tl || !tableData) return rects;
  const contentLeft = pageX + margins.left;
  const tableTop = baseY + tableLb.y;

  // Precise within-cell text selection: same inner block on both ends.
  if (
    anchorCell && focusCell &&
    selectionRange.anchor.blockId === selectionRange.focus.blockId
  ) {
    const { rowIndex: row, colIndex: col } = anchorCell;
    const cell = tl.cells[row]?.[col];
    const dataCell = tableData.rows[row]?.cells[col];
    if (!cell || !dataCell) return rects;
    const blockIdx = dataCell.blocks.findIndex((b) => b.id === selectionRange.anchor.blockId);
    if (blockIdx === -1) return rects;
    const padding = dataCell.style.padding ?? 4;
    const rowSpan = dataCell.rowSpan ?? 1;
    const selStart = Math.min(selectionRange.anchor.offset, selectionRange.focus.offset);
    const selEnd = Math.max(selectionRange.anchor.offset, selectionRange.focus.offset);
    const lineLayouts = computeMergedCellLineLayouts(
      cell.lines, row, rowSpan, padding, tl.rowYOffsets, tl.rowHeights,
    );
    const blockStartLine = cell.blockBoundaries[blockIdx] ?? 0;
    const blockEndLine = cell.blockBoundaries[blockIdx + 1] ?? cell.lines.length;
    const cellLeft = contentLeft + tl.columnXOffsets[col] + padding;

    let charsSoFar = 0;
    for (let li = blockStartLine; li < blockEndLine; li++) {
      const line = cell.lines[li];
      let lineChars = 0;
      for (const run of line.runs) lineChars += run.text.length;
      const lineStart = charsSoFar;
      const lineEnd = charsSoFar + lineChars;
      if (selEnd > lineStart && selStart < lineEnd) {
        const lineSelStart = Math.max(0, selStart - lineStart);
        const lineSelEnd = Math.min(lineChars, selEnd - lineStart);
        let x0 = 0, x1 = 0, chars = 0;
        for (const run of line.runs) {
          const font = resolveInlineFont(run.inline.style);
          const runOffsetX = (n: number): number =>
            run.x + (run.imageHeight !== undefined
              ? (n > 0 ? run.width : 0)
              : measurer.measureWidth(run.text.slice(0, n), font));
          if (chars <= lineSelStart && lineSelStart <= chars + run.text.length) {
            x0 = runOffsetX(lineSelStart - chars);
          }
          if (chars <= lineSelEnd && lineSelEnd <= chars + run.text.length) {
            x1 = runOffsetX(lineSelEnd - chars);
          }
          chars += run.text.length;
        }
        rects.push({
          x: cellLeft + x0,
          y: tableTop + lineLayouts[li].runLineY,
          width: Math.max(0, x1 - x0),
          height: line.height,
        });
      }
      charsSoFar += lineChars;
    }
    return rects;
  }

  // Otherwise: whole-cell highlight over the bounding row/col box.
  let r0: number, r1: number, c0: number, c1: number;
  if (anchorCell && focusCell) {
    r0 = Math.min(anchorCell.rowIndex, focusCell.rowIndex);
    r1 = Math.max(anchorCell.rowIndex, focusCell.rowIndex);
    c0 = Math.min(anchorCell.colIndex, focusCell.colIndex);
    c1 = Math.max(anchorCell.colIndex, focusCell.colIndex);
  } else {
    // Mixed selection: one endpoint is an outside header/footer paragraph.
    // Clamp the table coverage to the edge nearest that endpoint by document
    // order so the whole run of cells between the edge and the in-table cell
    // highlights. The outside paragraph portion itself is rendered separately
    // by computeHFSelectionRects. (The bounding-box approximation matches the
    // both-endpoints case above.)
    const inCell = (anchorCell ?? focusCell)!;
    const outsideBlockId = anchorCell
      ? selectionRange.focus.blockId
      : selectionRange.anchor.blockId;
    const tableIdx = hfLayout.blocks.findIndex(
      (bl) => bl.block.id === cellInfo.tableBlockId,
    );
    const outsideIdx = hfLayout.blocks.findIndex(
      (bl) => bl.block.id === outsideBlockId,
    );
    const lastRow = tl.cells.length - 1;
    const lastCol = tl.columnPixelWidths.length - 1;
    if (outsideIdx !== -1 && outsideIdx < tableIdx) {
      // Outside endpoint precedes the table: cover from the first cell.
      r0 = 0; c0 = 0; r1 = inCell.rowIndex; c1 = inCell.colIndex;
    } else {
      // Outside endpoint follows the table (or unknown): cover to the last cell.
      r0 = inCell.rowIndex; c0 = inCell.colIndex; r1 = lastRow; c1 = lastCol;
    }
  }
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (tl.cells[r]?.[c]?.merged) continue;
      const rect = cellOriginPx(tl, tableData, r, c);
      rects.push({
        x: contentLeft + rect.x,
        y: tableTop + rect.y,
        width: rect.w,
        height: rect.h,
      });
    }
  }
  return rects;
}

/**
 * Build layout-relative selection rects across a contiguous run of flat
 * (non-table) header/footer blocks. `startBlockIdx`/`endBlockIdx` index into
 * `hfLayout.blocks` and must already be ordered (`start <= end`). Returns
 * rects in header/footer layout coordinates (caller maps them to the page).
 */
function hfFlatLayoutRects(
  hfLayout: DocumentLayout,
  startBlockIdx: number,
  startOffset: number,
  endBlockIdx: number,
  endOffset: number,
  measurer: TextMeasurer,
): Array<{ x: number; y: number; width: number; height: number }> {
  const layoutRects: Array<{ x: number; y: number; width: number; height: number }> = [];
  for (let bi = startBlockIdx; bi <= endBlockIdx; bi++) {
    const lb = hfLayout.blocks[bi];
    if (!lb) continue;
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
              x0 = run.x + measurer.measureWidth(
                run.text.slice(0, localOff),
                resolveInlineFont(run.inline.style),
              );
            }
          }
          if (chars + runLen >= lineSelEnd) {
            const localOff = lineSelEnd - chars;
            if (run.imageHeight !== undefined) {
              x1 = run.x + (localOff > 0 ? run.width : 0);
            } else {
              x1 = run.x + measurer.measureWidth(
                run.text.slice(0, localOff),
                resolveInlineFont(run.inline.style),
              );
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
  return layoutRects;
}

/**
 * Map header/footer layout-relative rects to absolute page coordinates on the
 * active page.
 */
function mapHFLayoutRects(
  layoutRects: Array<{ x: number; y: number; width: number; height: number }>,
  hfLayout: DocumentLayout,
  hf: HeaderFooter,
  region: 'header' | 'footer',
  paginatedLayout: PaginatedLayout,
  canvasWidth: number,
  activePageIndex: number,
): Array<{ x: number; y: number; width: number; height: number }> {
  const pageX = getPageXOffset(paginatedLayout, canvasWidth);
  const { margins } = paginatedLayout.pageSetup;
  const baseY = region === 'header'
    ? getHeaderYStart(paginatedLayout, activePageIndex, hf.marginFromEdge)
    : getFooterYStart(paginatedLayout, activePageIndex, hfLayout.totalHeight, hf.marginFromEdge);
  return layoutRects.map((r) => ({
    x: pageX + margins.left + r.x,
    y: baseY + r.y,
    width: r.width,
    height: r.height,
  }));
}

/**
 * Compute selection rects within a header/footer layout for all visible pages.
 *
 * Exported for unit tests only — not re-exported from the package index.
 */
export function computeHFSelectionRects(
  selectionRange: { anchor: DocPosition; focus: DocPosition },
  hfLayout: DocumentLayout,
  hf: HeaderFooter,
  region: 'header' | 'footer',
  paginatedLayout: PaginatedLayout,
  measurer: TextMeasurer,
  canvasWidth: number,
  activePageIndex: number,
): Array<{ x: number; y: number; width: number; height: number }> {
  const anchorCell = hfLayout.blockParentMap.get(selectionRange.anchor.blockId);
  const focusCell = hfLayout.blockParentMap.get(selectionRange.focus.blockId);

  // Both endpoints inside table cells: pure table-aware path.
  if (anchorCell && focusCell) {
    return computeHFTableCellSelectionRects(
      selectionRange, anchorCell, focusCell, hfLayout, hf, region,
      paginatedLayout, measurer, canvasWidth, activePageIndex,
    );
  }

  // Mixed selection: one endpoint is a table cell and the other is an outside
  // header/footer paragraph. Render both portions — the table cells clamped to
  // the edge nearest the outside endpoint, plus the flat paragraph run between
  // that endpoint and the table boundary.
  if (anchorCell || focusCell) {
    const tableRects = computeHFTableCellSelectionRects(
      selectionRange, anchorCell, focusCell, hfLayout, hf, region,
      paginatedLayout, measurer, canvasWidth, activePageIndex,
    );
    const cellInfo = (anchorCell ?? focusCell)!;
    const outside = anchorCell ? selectionRange.focus : selectionRange.anchor;
    const tableIdx = hfLayout.blocks.findIndex(
      (bl) => bl.block.id === cellInfo.tableBlockId,
    );
    const outsideIdx = hfLayout.blocks.findIndex(
      (bl) => bl.block.id === outside.blockId,
    );
    if (tableIdx === -1 || outsideIdx === -1) return tableRects;

    let flatLayoutRects: Array<{ x: number; y: number; width: number; height: number }>;
    if (outsideIdx < tableIdx) {
      // Outside endpoint precedes the table: from it through the block just
      // before the table.
      const prev = hfLayout.blocks[tableIdx - 1];
      flatLayoutRects = hfFlatLayoutRects(
        hfLayout, outsideIdx, outside.offset,
        tableIdx - 1, prev ? getBlockTextLength(prev.block) : 0, measurer,
      );
    } else {
      // Outside endpoint follows the table: from the block just after the
      // table through it.
      flatLayoutRects = hfFlatLayoutRects(
        hfLayout, tableIdx + 1, 0, outsideIdx, outside.offset, measurer,
      );
    }
    const flatRects = mapHFLayoutRects(
      flatLayoutRects, hfLayout, hf, region, paginatedLayout,
      canvasWidth, activePageIndex,
    );
    return [...tableRects, ...flatRects];
  }

  // Neither endpoint in a table: flat scan across non-table blocks.
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
  if (startBlockIdx === -1 || endBlockIdx === -1) return [];

  // Normalize direction
  if (startBlockIdx > endBlockIdx || (startBlockIdx === endBlockIdx && startOffset > endOffset)) {
    [startBlockIdx, endBlockIdx] = [endBlockIdx, startBlockIdx];
    [startOffset, endOffset] = [endOffset, startOffset];
  }

  const layoutRects = hfFlatLayoutRects(
    hfLayout, startBlockIdx, startOffset, endBlockIdx, endOffset, measurer,
  );
  return mapHFLayoutRects(
    layoutRects, hfLayout, hf, region, paginatedLayout, canvasWidth, activePageIndex,
  );
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
  const pending = createPendingStyle(doc);

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
  // The measurer is shared across recomputeLayout, header/footer layout, hit
  // testing, and cursor/selection rendering. It owns a private OffscreenCanvas
  // ctx so its `lastFont` cache stays valid across calls regardless of what
  // paint code does to the visible canvas's ctx.font in between.
  const measurer = new CanvasTextMeasurer();
  const ruler = new Ruler(container, canvas, readOnly);
  const cursor = new Cursor(doc.document.blocks[0].id);
  const selection = new Selection();
  let layout: DocumentLayout = { blocks: [], totalHeight: 0, blockParentMap: new Map() };
  let paginatedLayout: PaginatedLayout = { pages: [], pageSetup: resolvePageSetup(undefined) };
  let headerLayout: DocumentLayout | null = null;
  let footerLayout: DocumentLayout | null = null;
  let layoutCache: LayoutCache | undefined;
  let dirtyBlockIds: Set<string> | undefined;
  // View-local IME composing text injected into the layout of the caret's
  // block during composition (never written to the model). Pushed here by
  // the TextEditor; consumed by recomputeLayout. See
  // docs/design/docs/docs-ime-undo-history.md.
  let composingContext: ComposingContext | null = null;
  let needsScrollIntoView = false;
  let focused = !readOnly;

  /**
   * Ensure the cursor points to a block that still exists in the document.
   * After a remote change deletes the block the cursor is on, relocate it
   * to the first block so subsequent reads don't throw.
   */
  const validateCursorPosition = (): void => {
    if (doc.findBlock(cursor.position.blockId)) return;
    pending.clear();
    const firstBlock = doc.getContextBlocks()[0] ?? doc.document.blocks[0];
    if (firstBlock) {
      cursor.moveTo({ blockId: firstBlock.id, offset: 0 });
      selection.setRange(null);
    }
  };

  /**
   * Apply an inline-style patch to the current selection. Shared by
   * `applyStyle` (set keys) and `clearInlineFormatting` (which passes
   * `CLEAR_INLINE_STYLE` so the Yorkie store strips the attributes
   * from the Tree node). Handles cell-range mode, regular ranges, and
   * the dirty-block bookkeeping needed for incremental layout. Fires
   * `notifyStyleApplied()` at the end so toolbar pickers re-derive
   * their selection-derived state. No-op when there is no real
   * selection.
   */
  /**
   * Read the inline style at the current caret without pending merging.
   * Used by both the public getSelectionStyle (which layers pending on
   * top) and applyStyleImpl (which seeds the pending merge base).
   */
  function getSelectionStyleImpl(): Partial<InlineStyle> {
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
    const last = block.inlines[block.inlines.length - 1];
    return last ? { ...last.style } : {};
  }

  function applyStyleImpl(style: Partial<InlineStyle>): void {
    if (!(selection.hasSelection() && selection.range)) {
      // Collapsed caret — record the style for the next typed run.
      pending.set({ ...getSelectionStyleImpl(), ...style }, cursor.position);
      render();
      notifyStyleApplied();
      return;
    }
    docStore.snapshot();
    const range = selection.range;

    // Cell-range mode: apply to all cells in range
    if (range.tableCellRange) {
      applyStyleToCellRange(range.tableCellRange, style);
      markDirty(range.tableCellRange.blockId);
      render();
      notifyStyleApplied();
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
    notifyStyleApplied();
  }

  /**
   * Fire the cursor-move callbacks after an inline / block style
   * mutation. The cursor itself did not move, but the style data under
   * it changed — toolbar pickers driven by `getRangeStyleSummary` /
   * `getBlockStyle` need to refresh. We pass the current selection
   * range when one exists so callbacks see the same shape they would
   * after a real cursor move.
   */
  function notifyStyleApplied(): void {
    const selRange = selection.hasSelection() && selection.range
      ? {
          anchor: selection.range.anchor,
          focus: selection.range.focus,
          tableCellRange: selection.range.tableCellRange,
        }
      : undefined;
    fireCursorMoveCallbacks(cursor.position, selRange);
  }

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
  type CursorMoveCallback = (pos: { blockId: string; offset: number }, selection?: { anchor: { blockId: string; offset: number }; focus: { blockId: string; offset: number }; tableCellRange?: { blockId: string; start: { rowIndex: number; colIndex: number }; end: { rowIndex: number; colIndex: number } } } | null) => void;
  // Multi-listener fan-out. Previously a single slot, which silently
  // overwrote earlier subscribers (e.g. the toolbar refresh effect
  // stomping on the presence broadcaster from docs-view.tsx). The Set
  // preserves insertion order so callbacks fire in registration order.
  const cursorMoveCallbacks = new Set<CursorMoveCallback>();
  function fireCursorMoveCallbacks(
    pos: { blockId: string; offset: number },
    selection?: Parameters<CursorMoveCallback>[1],
  ): void {
    for (const cb of cursorMoveCallbacks) cb(pos, selection);
    // Edits and cursor moves both flow through here, so this is the
    // single place to debounce spell re-checks. `scheduleSpellRecheck`
    // is a hoisted declaration and no-ops while the session is unset.
    scheduleSpellRecheck();
  }
  let lastPeerPixels: Array<{ clientID: string; x: number; y: number; height: number }> = [];
  let searchMatches: SearchMatch[] = [];
  let activeMatchIndex = -1;
  let commentMarkers: CommentMarker[] = [];
  // Cache of rects from the last render(). Read by getCommentMarkerAt.
  let commentMarkerRects: HighlightRect[] = [];
  // View-local spell state. Never serialized to the CRDT.
  let spellSession: SpellSession | null = null;
  // Cache of spell-error rects from the last render(). Read by the
  // spell context-menu hit-test path.
  let lastSpellErrorRects: Array<{ x: number; y: number; width: number; height: number }> = [];
  // Whether the built-in spell checker is active. On by default.
  let spellEnabled = true;
  // Debounce handle for re-checking after edits / cursor moves.
  let spellTimer: ReturnType<typeof setTimeout> | null = null;
  // Currently open suggestions popover (DOM), if any.
  let spellPopover: HTMLDivElement | null = null;
  let closeSpellPopover: () => void = () => {};
  let scaleFactor = 1;
  let lastCanvasHeight = 0;
  let lastLogicalCanvasWidth = 0;

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
      measurer,
      contentWidth,
      dirtyBlockIds,
      layoutCache,
      composingContext ?? undefined,
    );
    layout = result.layout;
    layoutCache = result.cache;
    dirtyBlockIds = undefined;
    paginatedLayout = paginateLayout(layout, pageSetup);

    // Header/footer layouts
    if (doc.document.header) {
      headerLayout = computeLayout(
        doc.document.header.blocks,
        measurer,
        contentWidth,
        undefined,
        undefined,
        composingContext ?? undefined,
      ).layout;
    } else {
      headerLayout = null;
    }
    if (doc.document.footer) {
      footerLayout = computeLayout(
        doc.document.footer.blocks,
        measurer,
        contentWidth,
        undefined,
        undefined,
        composingContext ?? undefined,
      ).layout;
    } else {
      footerLayout = null;
    }

    // Register cell→table parentage for all regions, not just the body, so
    // `doc.findBlock` can resolve a caret that sits inside a header/footer
    // table cell. Without the header/footer entries the keydown guard treats
    // such a caret as a deleted block and resets it to the table (arrow keys
    // appeared to "jump" out of the cell).
    const mergedParentMap = new Map(layout.blockParentMap);
    if (headerLayout) {
      for (const [k, v] of headerLayout.blockParentMap) mergedParentMap.set(k, v);
    }
    if (footerLayout) {
      for (const [k, v] of footerLayout.blockParentMap) mergedParentMap.set(k, v);
    }
    doc.setBlockParentMap(mergedParentMap);
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
    lastCanvasHeight = canvasHeight;
    docCanvas.resize(canvasWidth, canvasHeight);
    spacer.style.height = `${totalHeight * scaleFactor}px`;
    spacer.style.marginTop = `${-height - rulerSize}px`;

    // Logical canvas width in unscaled document coordinates
    const logicalCanvasWidth = scaleFactor < 1 ? canvasWidth / scaleFactor : canvasWidth;
    lastLogicalCanvasWidth = logicalCanvasWidth;

    // Hide cursor when in cell-range selection mode. In header/footer edit
    // context the caret lives in the header/footer layout (including table
    // cells), so use that pixel — `cursor.getPixelPosition` resolves against
    // the body layout and returns undefined for header/footer blocks, which
    // would leave the hidden textarea stale and make the browser auto-scroll
    // (the caret appears to jump to the table's edge on arrow keys).
    const editCtx = textEditor?.getEditContext() ?? 'body';
    const hfActivePageIndex = textEditor?.getHFActivePageIndex() ?? 0;
    const cursorPixelRaw = selection.range?.tableCellRange
      ? undefined
      : editCtx === 'header' && headerLayout && doc.document.header
        ? computeHFCursorPixel(
            cursor.position, cursor.lineAffinity, headerLayout, doc.document.header, 'header',
            paginatedLayout, measurer, logicalCanvasWidth, hfActivePageIndex,
            cursor.isVisible(),
          )
        : editCtx === 'footer' && footerLayout && doc.document.footer
          ? computeHFCursorPixel(
              cursor.position, cursor.lineAffinity, footerLayout, doc.document.footer, 'footer',
              paginatedLayout, measurer, logicalCanvasWidth, hfActivePageIndex,
              cursor.isVisible(),
            )
          : cursor.getPixelPosition(paginatedLayout, layout, measurer, logicalCanvasWidth);
    // Caret color tracks the resolved text color at the cursor position
    // so it stays readable when the user picks a non-default color.
    // findBlock walks body / header / footer / cell blocks so this works
    // regardless of editCtx.
    const cursorPixel = cursorPixelRaw
      ? {
          ...cursorPixelRaw,
          color: resolveColorAtPosition(
            doc.findBlock(cursor.position.blockId),
            cursor.position.offset,
            defaultColorResolver,
            Theme.cursorColor,
          ),
        }
      : undefined;

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
      measurer,
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
        measurer,
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
          measurer,
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
          measurer,
          logicalCanvasWidth,
        ),
      );
    }

    // Compute comment marker rectangles. Cached on the closure so
    // getCommentMarkerAt can hit-test the rects the user actually sees.
    commentMarkerRects = [];
    for (const marker of commentMarkers) {
      const rects = computeSelectionRects(
        { anchor: marker.anchor, focus: marker.focus },
        paginatedLayout,
        layout,
        measurer,
        logicalCanvasWidth,
      );
      for (const r of rects) {
        commentMarkerRects.push({ id: marker.id, ...r });
      }
    }

    // Compute spell-error rectangles (view-local; never persisted).
    let spellErrorRects: Array<{ x: number; y: number; width: number; height: number }> = [];
    if (spellSession) {
      for (const err of spellSession.errors) {
        const rects = computeSelectionRects(
          {
            anchor: { blockId: err.blockId, offset: err.start },
            focus: { blockId: err.blockId, offset: err.end },
          },
          paginatedLayout,
          layout,
          measurer,
          logicalCanvasWidth,
        );
        spellErrorRects.push(...rects);
      }
    }
    lastSpellErrorRects = spellErrorRects; // cache for hit-testing (Task 8)

    // Compute header/footer cursor and selection (editCtx / hfActivePageIndex
    // are hoisted above for the textarea-tracking cursor pixel).
    let hfCursorHeader: { x: number; y: number; height: number; visible: boolean; color?: string } | undefined;
    let hfCursorFooter: { x: number; y: number; height: number; visible: boolean; color?: string } | undefined;
    let hfSelectionRects: Array<{ x: number; y: number; width: number; height: number }> | undefined;

    if (editCtx === 'header' && headerLayout && doc.document.header) {
      const hfPage = textEditor?.getHFActivePageIndex() ?? 0;
      const hfPixel = computeHFCursorPixel(
        cursor.position, cursor.lineAffinity, headerLayout, doc.document.header, 'header',
        paginatedLayout, measurer, logicalCanvasWidth,
        hfPage, cursor.isVisible(),
      );
      if (hfPixel) {
        hfCursorHeader = {
          ...hfPixel,
          color: resolveColorAtPosition(
            doc.findBlock(cursor.position.blockId),
            cursor.position.offset,
            defaultColorResolver,
            Theme.cursorColor,
          ),
        };
      }
      if (selection.hasSelection() && selection.range) {
        hfSelectionRects = computeHFSelectionRects(
          selection.range, headerLayout, doc.document.header, 'header',
          paginatedLayout, measurer, logicalCanvasWidth, hfPage,
        );
      }
    }
    if (editCtx === 'footer' && footerLayout && doc.document.footer) {
      const hfPageF = textEditor?.getHFActivePageIndex() ?? 0;
      const hfPixel = computeHFCursorPixel(
        cursor.position, cursor.lineAffinity, footerLayout, doc.document.footer, 'footer',
        paginatedLayout, measurer, logicalCanvasWidth,
        hfPageF, cursor.isVisible(),
      );
      if (hfPixel) {
        hfCursorFooter = {
          ...hfPixel,
          color: resolveColorAtPosition(
            doc.findBlock(cursor.position.blockId),
            cursor.position.offset,
            defaultColorResolver,
            Theme.cursorColor,
          ),
        };
      }
      if (selection.hasSelection() && selection.range) {
        hfSelectionRects = computeHFSelectionRects(
          selection.range, footerLayout, doc.document.footer, 'footer',
          paginatedLayout, measurer, logicalCanvasWidth, hfPageF,
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
        // Use resolveNestedTableLayout to find the correct LayoutTable
        // for both top-level and nested table cells.
        const resolved = resolveNestedTableLayout(cellInfo.tableBlockId, layout);
        const layoutCell =
          resolved?.layoutTable.cells[cellInfo.rowIndex]?.[cellInfo.colIndex];
        const cellData = resolved?.dataBlock.tableData?.rows[cellInfo.rowIndex]
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
      commentMarkerRects,
      spellErrorRects,
    );

    // Draw drag guideline if active. Guideline coords are in unscaled
    // document space, but this draws after `docCanvas.render()` has
    // already restored the canvas context to identity. Convert to canvas
    // pixels manually so the line stays under the cursor regardless of
    // scroll or zoom; otherwise vertical scroll on page 2+ pushes the
    // horizontal (row) guideline off-screen — only the column guideline
    // ever appeared because horizontal scroll happens to be zero.
    if (dragGuideline) {
      const ctx = docCanvas.getContext();
      const scrollX = container.scrollLeft / scaleFactor;
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = '#4285F4';
      ctx.lineWidth = 1;
      if (dragGuideline.x != null) {
        const x = (dragGuideline.x - scrollX) * scaleFactor;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvasHeight);
        ctx.stroke();
      }
      if (dragGuideline.y != null) {
        const y = (dragGuideline.y - scrollY) * scaleFactor;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvasWidth, y);
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
    if ('setCursorForHistory' in docStore) {
      (docStore as { setCursorForHistory(pos: { blockId: string; offset: number }): void })
        .setCursorForHistory(cursor.position);
    }
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
      pending.clear();
      docStore.undo();
      doc.refresh();
      textEditor?.setEditContext('body');
      layoutCache = undefined;

      // Restore cursor from Yorkie presence (automatically restored by undo)
      const restoredPos = 'getPresenceCursorPos' in docStore
        ? (docStore as { getPresenceCursorPos(): { blockId: string; offset: number } | undefined })
            .getPresenceCursorPos()
        : undefined;
      if (restoredPos && doc.findBlock(restoredPos.blockId)) {
        const block = doc.getBlock(restoredPos.blockId);
        const maxOffset = block.inlines.reduce((sum, i) => sum + i.text.length, 0);
        cursor.moveTo({ blockId: restoredPos.blockId, offset: Math.min(restoredPos.offset, maxOffset) });
      } else if (doc.document.blocks.length > 0) {
        cursor.moveTo({ blockId: doc.document.blocks[0].id, offset: 0 });
      }

      needsScrollIntoView = true;
      render();
    }
  };
  const redoFn = () => {
    if (docStore.canRedo()) {
      pending.clear();
      docStore.redo();
      doc.refresh();
      textEditor?.setEditContext('body');
      layoutCache = undefined;

      // Restore cursor from Yorkie presence (automatically restored by redo)
      const restoredPos = 'getPresenceCursorPos' in docStore
        ? (docStore as { getPresenceCursorPos(): { blockId: string; offset: number } | undefined })
            .getPresenceCursorPos()
        : undefined;
      if (restoredPos && doc.findBlock(restoredPos.blockId)) {
        const block = doc.getBlock(restoredPos.blockId);
        const maxOffset = block.inlines.reduce((sum, i) => sum + i.text.length, 0);
        cursor.moveTo({ blockId: restoredPos.blockId, offset: Math.min(restoredPos.offset, maxOffset) });
      } else if (doc.document.blocks.length > 0) {
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
    fireCursorMoveCallbacks(cursor.position, selRange);
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
    () => measurer,
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
    () => {
      docStore.snapshot();
      if ('setCursorForHistory' in docStore) {
        (docStore as { setCursorForHistory(pos: { blockId: string; offset: number }): void })
          .setCursorForHistory(cursor.position);
      }
    },
    undoFn,
    redoFn,
    markDirty,
    invalidateLayout,
    () => headerLayout,
    () => footerLayout,
  );
  textEditorRef = textEditor;

  if (textEditor) {
    // Direct the per-instance cursor-style writes at the canvas we
    // just created. Equivalent to the previous `[data-role="doc-canvas"]`
    // querySelector lookup, but explicit — multiple TextEditor instances
    // on the same page (e.g., slides text-boxes) no longer collide.
    textEditor.setCursorTarget(canvas);
    textEditor.setPendingStyle(pending);

    // Receive view-local IME composing text so recomputeLayout injects it
    // into the caret block's layout (never written to the model). The
    // TextEditor marks the block dirty and requests a render on each change.
    textEditor.onComposingContextChange = (ctx) => {
      composingContext = ctx;
    };

    textEditor.onDragGuideline = (pos) => {
      dragGuideline = pos;
      renderPaintOnly();
    };
    // Layout-only re-render that does NOT scroll the cursor into view.
    // Used by table border resize so resizing on page 2 with the caret
    // on page 1 doesn't snap the viewport back to page 1.
    textEditor.requestRenderNoCursorScroll = render;

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
      pending.clear();
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

  // ---- Spell check: debounced recheck + suggestions context menu -------
  //
  // View-local only: errors live on `spellSession`, rects are recomputed
  // per render (Task 7). Nothing here is ever written to the CRDT — the
  // replace path goes through plain `deleteText`/`insertText` so it is a
  // normal, undoable edit.

  // Debounce a recheck. Hoisted so `fireCursorMoveCallbacks` (declared
  // earlier) can call it. No-ops while the session is unset or disabled.
  function scheduleSpellRecheck(): void {
    if (!spellSession || !spellEnabled) return;
    if (spellTimer) clearTimeout(spellTimer);
    spellTimer = setTimeout(() => {
      spellTimer = null;
      void runSpellRecheck();
    }, 300);
  }

  async function runSpellRecheck(): Promise<void> {
    if (!spellSession || !spellEnabled) return;
    // Body blocks only — the spell-rect computation in render() resolves
    // each error through the body `layout`/`paginatedLayout`, so the ids
    // we feed must come from the same set. Tables expose empty
    // `getBlockText`, so they contribute no words.
    const blocks = doc.document.blocks.map((b) => ({
      id: b.id,
      text: getBlockText(b),
    }));
    const caret = { blockId: cursor.position.blockId, offset: cursor.position.offset };
    await spellSession.recheckBlocks(blocks, {
      caret,
      composing: textEditor?.isComposing() ?? false,
    });
    // Repaint-only: errors changed but layout did not.
    renderPaintOnly();
  }

  // Map a context-menu event to the spell error under the pointer, reusing
  // the exact click→position pipeline the editor uses elsewhere
  // (clientToDocCoords + paginatedPixelToPosition).
  const spellErrorAtEvent = (e: MouseEvent): SpellError | undefined => {
    if (!spellSession || !layout) return undefined;
    const { x: docX, y: docY } = clientToDocCoords(e.clientX, e.clientY);
    const canvasWidth = canvas.getBoundingClientRect().width / scaleFactor;
    const hit = paginatedPixelToPosition(paginatedLayout, layout, docX, docY, canvasWidth);
    if (!hit) return undefined;
    return spellSession.errorAt(hit.blockId, hit.offset);
  };

  const handleSpellContextMenu = (e: MouseEvent): void => {
    if (readOnly || !spellSession || !spellEnabled) return;
    const err = spellErrorAtEvent(e);
    if (!err) return; // no squiggle here → let the browser's menu through
    e.preventDefault();
    // Stop the app's own context menu (Radix) from also opening on top of
    // our suggestions popover when the click lands on a misspelling.
    e.stopPropagation();
    void openSpellPopover(e.clientX, e.clientY, err);
  };

  async function openSpellPopover(
    clientX: number,
    clientY: number,
    err: SpellError,
  ): Promise<void> {
    if (!spellSession) return;
    closeSpellPopover();
    const session = spellSession;

    const menu = document.createElement('div');
    menu.style.cssText = [
      'position:fixed',
      `left:${clientX}px`,
      `top:${clientY}px`,
      'z-index:2147483647',
      'min-width:160px',
      'max-height:280px',
      'overflow-y:auto',
      'padding:4px 0',
      'background:#fff',
      'border:1px solid rgba(0,0,0,0.15)',
      'border-radius:6px',
      'box-shadow:0 2px 10px rgba(0,0,0,0.2)',
      'font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'color:#202124',
      'user-select:none',
    ].join(';');

    const addItem = (label: string, onClick?: () => void): void => {
      const item = document.createElement('div');
      item.textContent = label;
      item.style.cssText = [
        'padding:6px 16px',
        'white-space:nowrap',
        onClick ? 'cursor:pointer' : 'cursor:default',
        onClick ? 'color:#202124' : 'color:#9aa0a6',
      ].join(';');
      if (onClick) {
        item.addEventListener('mouseenter', () => {
          item.style.background = '#f1f3f4';
        });
        item.addEventListener('mouseleave', () => {
          item.style.background = '';
        });
        // mousedown (not click) so the popover acts before the
        // outside-mousedown listener tears it down.
        item.addEventListener('mousedown', (ev) => {
          ev.preventDefault();
          onClick();
        });
      }
      menu.appendChild(item);
    };

    // Loading placeholder while suggestions resolve (dict load is async).
    addItem('Checking…');
    document.body.appendChild(menu);
    spellPopover = menu;

    // Outside-click / Escape / scroll dismiss. Registered now so the menu
    // closes even while suggestions are still loading.
    const onOutside = (ev: MouseEvent): void => {
      if (spellPopover && !spellPopover.contains(ev.target as Node)) {
        closeSpellPopover();
      }
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') closeSpellPopover();
    };
    closeSpellPopover = (): void => {
      document.removeEventListener('mousedown', onOutside, true);
      document.removeEventListener('keydown', onKey, true);
      container.removeEventListener('scroll', closeSpellPopover);
      menu.remove();
      if (spellPopover === menu) spellPopover = null;
      closeSpellPopover = () => {};
    };
    document.addEventListener('mousedown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    container.addEventListener('scroll', closeSpellPopover);

    let suggestions: string[];
    try {
      suggestions = await session.router.suggest(err.word);
    } catch {
      // Dictionary failure — treat as empty suggestions rather than leaving
      // the popover stuck on "Checking…" forever.
      if (spellPopover !== menu) return;
      menu.replaceChildren();
      addItem('No suggestions');
      return;
    }
    // The popover may have been dismissed while suggestions loaded.
    if (spellPopover !== menu) return;
    menu.replaceChildren();

    if (suggestions.length === 0) {
      addItem('No suggestions');
      return;
    }
    for (const suggestion of suggestions) {
      addItem(suggestion, () => {
        // `replace` snapshots (undo) then deletes+inserts. Mark the block
        // dirty and re-layout so the squiggle and text update, then
        // re-check immediately.
        session.replace(doc, err, suggestion);
        // Drop the replaced error synchronously before render() so that
        // computeSelectionRects is not called with its now-stale `end`
        // offset (which can be out-of-range when the correction is
        // shorter than the original word).
        session.errors = session.errors.filter((e) => e !== err);
        cursor.moveTo({ blockId: err.blockId, offset: err.start + suggestion.length });
        markDirty(err.blockId);
        invalidateLayout();
        render();
        closeSpellPopover();
        void runSpellRecheck();
      });
    }
  }

  container.addEventListener('contextmenu', handleSpellContextMenu);

  // Construct the view-local spell session (default ON). The session never
  // touches the CRDT; `snapshot` routes its replace through the doc store's
  // undo stack so corrections are normal undoable edits.
  spellSession = new SpellSession(
    new SpellRouter([new LocalSpellProvider()]),
    { snapshot: () => docStore.snapshot() },
  );
  scheduleSpellRecheck();

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
    // Finalize any in-progress IME composition so no view-local composing
    // text is left injected in the layout (ghost text) when focus leaves
    // mid-composition without a compositionend.
    textEditor?.cancelComposition();
    pending.clear();
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
      const base = getSelectionStyleImpl();
      if (pending.has() && !selection.hasSelection()) {
        return { ...base, ...pending.get()! };
      }
      return base;
    },
    getRangeStyleSummary: () => {
      type Summary = ReturnType<EditorAPI['getRangeStyleSummary']>;

      const KEYS = [
        'bold', 'italic', 'underline', 'strikethrough',
        'fontFamily', 'fontSize', 'color', 'backgroundColor',
        'superscript', 'subscript',
      ] as const;

      // doc.findBlock walks body + header + footer + table cells, so
      // the same caret/range traversal works in every editing context.
      // Without this, header/footer carets fell through to body-only
      // search and the picker showed empty.
      const styleAtCaret = (): Partial<InlineStyle> => {
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
      };

      // No range — return the caret style, layered with any pending
      // inline style. The font family / size pickers in the docs
      // toolbar read from here, so without the pending merge the
      // picker freezes after one click on a collapsed caret (the next
      // read returns the same pre-pending value and the +/- computes
      // the same `next`). Mirrors `getSelectionStyle` above.
      if (!selection.hasSelection() || !selection.range) {
        const base = styleAtCaret();
        if (pending.has()) {
          return { ...base, ...pending.get()! } as Summary;
        }
        return { ...base } as Summary;
      }

      const range = selection.range;

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
          // Overlap test [from, to) with [pos, inlineEnd). Treat
          // zero-width inlines (empty placeholder runs) as out of
          // range — they don't contribute style information.
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

      // Rectangle of selected table cells — walk every block inside.
      if (range.tableCellRange) {
        const cr = range.tableCellRange;
        const tableBlock = doc.findBlock(cr.blockId);
        if (tableBlock?.tableData) {
          const minRow = Math.min(cr.start.rowIndex, cr.end.rowIndex);
          const maxRow = Math.max(cr.start.rowIndex, cr.end.rowIndex);
          const minCol = Math.min(cr.start.colIndex, cr.end.colIndex);
          const maxCol = Math.max(cr.start.colIndex, cr.end.colIndex);
          for (let r = minRow; r <= maxRow; r++) {
            for (let c = minCol; c <= maxCol; c++) {
              const cell = tableBlock.tableData.rows[r]?.cells[c];
              if (!cell || cell.colSpan === 0) continue;
              for (const cb of cell.blocks) {
                const len = cb.inlines.reduce((s, n) => s + n.text.length, 0);
                if (len > 0) visitInlinesInBlock(cb.id, 0, len);
              }
            }
          }
        }
      } else {
        const anchorIdx = doc.getBlockIndex(range.anchor.blockId);
        const focusIdx = doc.getBlockIndex(range.focus.blockId);
        if (anchorIdx >= 0 && focusIdx >= 0) {
          // Linear selection across the current top-level context
          // (body or header/footer — whichever getContextBlocks
          // resolves to).
          const [startIdx, startOff, endIdx, endOff] = anchorIdx < focusIdx ||
            (anchorIdx === focusIdx && range.anchor.offset <= range.focus.offset)
            ? [anchorIdx, range.anchor.offset, focusIdx, range.focus.offset]
            : [focusIdx, range.focus.offset, anchorIdx, range.anchor.offset];

          for (let i = startIdx; i <= endIdx; i++) {
            const block = doc.getContextBlocks()[i];
            const blockLen = block.inlines.reduce((s, n) => s + n.text.length, 0);
            const from = i === startIdx ? startOff : 0;
            const to = i === endIdx ? endOff : blockLen;
            if (from < to) visitInlinesInBlock(block.id, from, to);
          }
        } else {
          // Selection lives inside a table cell but isn't a cell-range
          // (user selected text within one cell rather than a
          // rectangle of cells). Walk the cell's blocks between anchor
          // and focus, handling multi-block same-cell ranges.
          const anchorCI = layout.blockParentMap.get(range.anchor.blockId);
          const focusCI = layout.blockParentMap.get(range.focus.blockId);
          if (
            anchorCI && focusCI &&
            anchorCI.tableBlockId === focusCI.tableBlockId &&
            anchorCI.rowIndex === focusCI.rowIndex &&
            anchorCI.colIndex === focusCI.colIndex
          ) {
            const tableBlock = doc.getBlock(anchorCI.tableBlockId);
            const cell = tableBlock.tableData!.rows[anchorCI.rowIndex].cells[anchorCI.colIndex];
            const anchorBI = cell.blocks.findIndex((b) => b.id === range.anchor.blockId);
            const focusBI = cell.blocks.findIndex((b) => b.id === range.focus.blockId);
            if (anchorBI >= 0 && focusBI >= 0) {
              const [fromIdx, toIdx, fromOff, toOff] = anchorBI <= focusBI
                ? [anchorBI, focusBI, range.anchor.offset, range.focus.offset]
                : [focusBI, anchorBI, range.focus.offset, range.anchor.offset];
              for (let i = fromIdx; i <= toIdx; i++) {
                const cb = cell.blocks[i];
                const len = cb.inlines.reduce((s, n) => s + n.text.length, 0);
                const from = i === fromIdx ? fromOff : 0;
                const to = i === toIdx ? toOff : len;
                if (from < to) visitInlinesInBlock(cb.id, from, to);
              }
            }
          } else if (range.anchor.blockId === range.focus.blockId) {
            // Same block fallback (e.g. a header/footer block that
            // didn't resolve through getBlockIndex for some reason).
            const a = range.anchor.offset;
            const b = range.focus.offset;
            visitInlinesInBlock(range.anchor.blockId, Math.min(a, b), Math.max(a, b));
          }
        }
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
    applyStyle: applyStyleImpl,
    clearInlineFormatting: () => {
      // Reuse the applyStyle path so cell-range selections, snapshots,
      // and dirty-marking all flow through the same logic as ordinary
      // inline-style writes. CLEAR_INLINE_STYLE is the single source of
      // truth for which keys count as "character formatting".
      applyStyleImpl(CLEAR_INLINE_STYLE);
    },
    applyBlockStyle: (style: Partial<BlockStyle>) => {
      docStore.snapshot();
      forEachBlockInSelection((block) => {
        doc.applyBlockStyle(block.id, style);
      });
      render();
      notifyStyleApplied();
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
    scrollToPosition: (pos: DocPosition) => {
      if (lastLogicalCanvasWidth === 0 || lastCanvasHeight === 0) return;
      const pixel = resolvePositionPixel(
        pos,
        'backward',
        paginatedLayout,
        layout,
        measurer,
        lastLogicalCanvasWidth,
      );
      if (!pixel) return;

      const targetTop = pixel.y * scaleFactor - lastCanvasHeight / 3;
      container.scrollTo({
        top: Math.max(0, targetTop),
        behavior: 'smooth',
      });
    },
    onCursorMove: (cb) => {
      cursorMoveCallbacks.add(cb);
      return () => {
        cursorMoveCallbacks.delete(cb);
      };
    },
    getPeerCursorPixels: () => lastPeerPixels,
    getBlockType() {
      const block = doc.findBlock(cursor.position.blockId);
      if (!block) {
        return { type: 'paragraph' as BlockType };
      }
      return {
        type: block.type,
        headingLevel: block.headingLevel,
        listKind: block.listKind,
        listLevel: block.listLevel,
      };
    },
    getBlockStyle: () => {
      const block = doc.findBlock(cursor.position.blockId);
      return block ? { ...block.style } : {};
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
    getActiveSelection: () => {
      if (!selection.hasSelection() || !selection.range) return null;
      const r = selection.range;
      if (
        r.anchor.blockId === r.focus.blockId &&
        r.anchor.offset === r.focus.offset
      ) {
        return null;
      }
      // Return defensive copies — the editor mutates selection.range
      // in place as the user moves the caret, and callers (controllers
      // building a PendingDocsAnchor) need a stable snapshot.
      return {
        anchor: { blockId: r.anchor.blockId, offset: r.anchor.offset },
        focus: { blockId: r.focus.blockId, offset: r.focus.offset },
      };
    },
    getCursorScreenRect: () => {
      const vw = (container.parentElement ?? container).getBoundingClientRect().width;
      const pw = paginatedLayout.pages[0]?.width ?? 0;
      const physicalWidth = scaleFactor < 1 ? vw : Math.max(vw, pw);
      const logicalWidth = scaleFactor < 1 ? physicalWidth / scaleFactor : physicalWidth;
      const cursorPixel = cursor.getPixelPosition(paginatedLayout, layout, measurer, logicalWidth);
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
          measurer,
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
    setSpellSession: (session: SpellSession | null) => {
      spellSession = session;
      // Clear stale hit-test rects so callers that read
      // getSpellErrorRects() before the next render don't see rects
      // from the previous session.
      lastSpellErrorRects = [];
      render();
    },
    getSpellErrorRects: () => lastSpellErrorRects,
    setSpellCheckEnabled: (enabled: boolean) => {
      spellEnabled = enabled;
      if (enabled) {
        scheduleSpellRecheck();
      } else {
        if (spellTimer) {
          clearTimeout(spellTimer);
          spellTimer = null;
        }
        closeSpellPopover();
        if (spellSession) spellSession.errors = [];
        renderPaintOnly();
      }
    },
    setCommentMarkers: (markers: CommentMarker[]) => {
      // Clone so callers can keep their own list (e.g. memoize the
      // marker array between renders) without our cached rect pass
      // observing later mutations.
      commentMarkers = markers.map((m) => ({
        id: m.id,
        anchor: { blockId: m.anchor.blockId, offset: m.anchor.offset },
        focus: { blockId: m.focus.blockId, offset: m.focus.offset },
      }));
      render();
    },
    getCommentMarkerAt: (clientX: number, clientY: number) => {
      const { x, y } = clientToDocCoords(clientX, clientY);
      return findMarkerAt(commentMarkerRects, x, y);
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
      const cellInfo = layout.blockParentMap.get(pos.blockId);

      if (cellInfo) {
        // Split the current block at the cursor so trailing text moves
        // below the new table (matches the top-level insertion flow).
        const cellBlock = doc.getBlock(pos.blockId);
        const cellBlockLen = getBlockTextLength(cellBlock);
        if (pos.offset > 0 && pos.offset < cellBlockLen) {
          doc.splitBlock(pos.blockId, pos.offset);
        }

        // Cursor is inside a table cell — insert nested table
        const innerBlock = doc.insertTableInCell(pos.blockId, rows, cols);
        const firstCellBlock = innerBlock.tableData!.rows[0].cells[0].blocks[0];
        cursor.moveTo({ blockId: firstCellBlock.id, offset: 0 });
        invalidateLayout();
        render();
        return;
      }

      // Top-level table insertion (existing logic)
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
      const cellInfo = doc.blockParentMap.get(cursor.position.blockId);
      if (!cellInfo) return;
      const tableBlockId = cellInfo.tableBlockId;
      docStore.snapshot();

      // Check if this table is itself nested inside a cell
      const parentCellInfo = doc.blockParentMap.get(tableBlockId);
      if (parentCellInfo) {
        // Nested table — remove from parent cell's blocks
        const cursorBlockId = doc.deleteTableInCell(tableBlockId);
        cursor.moveTo({ blockId: cursorBlockId, offset: 0 });
      } else {
        // Top-level table (existing logic). Re-home within the active context
        // (body / header / footer) so deleting a header/footer table keeps the
        // caret in that region.
        const blockIndex = doc.getBlockIndex(tableBlockId);
        doc.deleteBlock(tableBlockId);
        // Move cursor to nearest block
        const blocks = doc.getContextBlocks();
        if (blocks.length > 0) {
          const newIndex = Math.min(blockIndex, blocks.length - 1);
          cursor.moveTo({ blockId: blocks[newIndex].id, offset: 0 });
        }
      }
      invalidateLayout();
      render();
    },
    isInTable: () => doc.blockParentMap.has(cursor.position.blockId),
    getCellAddress: (): CellAddress | undefined => {
      const cellInfo = doc.blockParentMap.get(cursor.position.blockId);
      if (!cellInfo) return undefined;
      return { rowIndex: cellInfo.rowIndex, colIndex: cellInfo.colIndex };
    },
    insertTableRow: (above: boolean) => {
      const cellInfo = doc.blockParentMap.get(cursor.position.blockId);
      if (!cellInfo) return;
      docStore.snapshot();
      const idx = above ? cellInfo.rowIndex : cellInfo.rowIndex + 1;
      doc.insertRow(cellInfo.tableBlockId, idx);
      invalidateLayout();
      render();
    },
    deleteTableRow: () => {
      const cellInfo = doc.blockParentMap.get(cursor.position.blockId);
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
      const cellInfo = doc.blockParentMap.get(cursor.position.blockId);
      if (!cellInfo) return;
      docStore.snapshot();
      const idx = left ? cellInfo.colIndex : cellInfo.colIndex + 1;
      doc.insertColumn(cellInfo.tableBlockId, idx);
      invalidateLayout();
      render();
    },
    deleteTableColumn: () => {
      const cellInfo = doc.blockParentMap.get(cursor.position.blockId);
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
      const cellInfo = doc.blockParentMap.get(cursor.position.blockId);
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
      const cellInfo = doc.blockParentMap.get(cursor.position.blockId);
      if (!cellInfo) return;
      docStore.snapshot();
      doc.splitCell(cellInfo.tableBlockId, { rowIndex: cellInfo.rowIndex, colIndex: cellInfo.colIndex });
      invalidateLayout();
      render();
    },
    getTableMergeContext: () =>
      computeTableMergeContext(doc, doc.blockParentMap, cursor.position, selection.range),
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
      const cellInfo = doc.blockParentMap.get(cursor.position.blockId);
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
      pending.clear();
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
    restoreLocalCursor: (cursorPos, range) => {
      if (cursorPos && doc.findBlock(cursorPos.blockId)) {
        const block = doc.getBlock(cursorPos.blockId);
        cursor.moveTo({
          blockId: cursorPos.blockId,
          offset: Math.min(cursorPos.offset, getBlockTextLength(block)),
        });
      }
      selection.setRange(range ?? null);
    },
    onCompositionStart: (cb) => textEditor?.onCompositionStart(cb),
    onCompositionEnd: (cb) => textEditor?.onCompositionEnd(cb),
    updateCompositionStartPosition: (pos) => {
      textEditor?.setCompositionStartPosition(pos);
    },
    isComposing: () => textEditor?.isComposing() ?? false,
    resetAfterDocumentReplace: () => {
      pending.clear();
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
      cursorMoveCallbacks.clear();
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
      container.removeEventListener('contextmenu', handleSpellContextMenu);
      document.removeEventListener('transitionend', handleTransitionEnd);
      if (spellTimer) {
        clearTimeout(spellTimer);
        spellTimer = null;
      }
      closeSpellPopover();
      spellSession = null;
      resizeObserver.disconnect();
      canvas.remove();
    },
    _setSelectionForTest: (range) => {
      selection.setRange(range);
      if (range) {
        cursor.moveTo({
          blockId: range.focus.blockId,
          offset: range.focus.offset,
        });
      }
    },
    _setEditContextForTest: (ctx) => {
      textEditor?.setEditContext(ctx);
    },
    _getCursorForTest: () => ({ ...cursor.position }),
  };
}
