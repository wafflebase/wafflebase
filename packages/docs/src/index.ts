// Model
export type {
  Document,
  Block,
  BlockType,
  HeadingLevel,
  Inline,
  BlockStyle,
  InlineStyle,
  DocPosition,
  DocRange,
  PageSetup,
  PageMargins,
  PaperSize,
  TableData,
  TableRow,
  TableCell,
  CellStyle,
  BorderStyle,
  CellAddress,
  CellRange,
} from './model/types.js';
export {
  DEFAULT_BLOCK_STYLE,
  DEFAULT_INLINE_STYLE,
  DEFAULT_PAGE_SETUP,
  PAPER_SIZES,
  LIST_INDENT_PX,
  UNORDERED_MARKERS,
  ORDERED_FORMATS,
  createBlock,
  createEmptyBlock,
  generateBlockId,
  getBlockText,
  getBlockTextLength,
  getHeadingDefaults,
  TITLE_DEFAULTS,
  SUBTITLE_DEFAULTS,
  inlineStylesEqual,
  resolvePageSetup,
  getEffectiveDimensions,
  normalizeBlockStyle,
  DEFAULT_CELL_STYLE,
  DEFAULT_BORDER_STYLE,
  createTableBlock,
  createTableCell,
} from './model/types.js';
export { Doc } from './model/document.js';

// Store
export type { DocStore } from './store/store.js';
export { MemDocStore } from './store/memory.js';

// View
export { initialize, type EditorAPI } from './view/editor.js';
export { computeLayout, computeListCounters } from './view/layout.js';
export type {
  DocumentLayout,
  LayoutBlock,
  LayoutLine,
  LayoutRun,
} from './view/layout.js';
export {
  paginateLayout,
  getPageYOffset,
  getTotalHeight,
  getPageXOffset,
  findPageForPosition,
  paginatedPixelToPosition,
} from './view/pagination.js';
export type {
  PageLine,
  LayoutPage,
  PaginatedLayout,
} from './view/pagination.js';
export { Theme, buildFont, ptToPx, setThemeMode, getTheme } from './view/theme.js';
export type { ThemeMode, DocTheme } from './view/theme.js';
export { DocCanvas } from './view/doc-canvas.js';
export { Cursor } from './view/cursor.js';
export {
  type PeerCursor,
  type PositionPixel,
  resolvePositionPixel,
  drawPeerCaret,
  drawPeerLabel,
} from './view/peer-cursor.js';
export { Selection } from './view/selection.js';
export { Ruler, RULER_SIZE } from './view/ruler.js';
export { FindReplaceState } from './view/find-replace.js';
export type { SearchMatch, SearchOptions } from './model/types.js';
export { isSafeUrl, normalizeLinkUrl } from './view/url-detect.js';
export { computeScaleFactor, MOBILE_PADDING } from './view/scale.js';
