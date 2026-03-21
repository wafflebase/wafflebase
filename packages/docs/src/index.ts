// Model
export type {
  Document,
  Block,
  Inline,
  BlockStyle,
  InlineStyle,
  DocPosition,
  DocRange,
} from './model/types.js';
export {
  DEFAULT_BLOCK_STYLE,
  DEFAULT_INLINE_STYLE,
  createEmptyBlock,
  generateBlockId,
  getBlockText,
  getBlockTextLength,
  inlineStylesEqual,
} from './model/types.js';
export { Doc } from './model/document.js';

// Store
export type { DocStore } from './store/store.js';
export { MemDocStore } from './store/memory.js';

// View
export { initialize, type EditorAPI } from './view/editor.js';
export { computeLayout, positionToPixel, pixelToPosition } from './view/layout.js';
export type {
  DocumentLayout,
  LayoutBlock,
  LayoutLine,
  LayoutRun,
} from './view/layout.js';
export { Theme, buildFont } from './view/theme.js';
export { DocCanvas } from './view/doc-canvas.js';
export { Cursor } from './view/cursor.js';
export { Selection } from './view/selection.js';
