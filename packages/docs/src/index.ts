// Model
export type {
  Document,
  Block,
  Inline,
  BlockStyle,
  InlineStyle,
  DocPosition,
  DocRange,
  PageSetup,
  PageMargins,
  PaperSize,
} from './model/types.js';
export {
  DEFAULT_BLOCK_STYLE,
  DEFAULT_INLINE_STYLE,
  DEFAULT_PAGE_SETUP,
  PAPER_SIZES,
  createEmptyBlock,
  generateBlockId,
  getBlockText,
  getBlockTextLength,
  inlineStylesEqual,
  resolvePageSetup,
  getEffectiveDimensions,
} from './model/types.js';
export { Doc } from './model/document.js';

// Store
export type { DocStore } from './store/store.js';
export { MemDocStore } from './store/memory.js';

// View
export { initialize, type EditorAPI } from './view/editor.js';
export { computeLayout } from './view/layout.js';
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
export { Theme, buildFont } from './view/theme.js';
export { DocCanvas } from './view/doc-canvas.js';
export { Cursor } from './view/cursor.js';
export { Selection } from './view/selection.js';
