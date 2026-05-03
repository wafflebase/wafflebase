// Backend-safe entry point for `@wafflebase/docs`.
//
// Re-exports ONLY the data-model layer (types + normalize helpers +
// defaults) so consumers running outside a browser (NestJS backend,
// CLI, future SSR) don't transitively type-check or bundle the
// DOM-dependent view/export/import code.
//
// Wired in two places:
//   - `packages/backend/tsconfig.json` paths map `@wafflebase/docs`
//     directly to this file, so backend tsc resolves the bare specifier
//     here and never sees `view/`, `export/`, `import/`, `serialize/`,
//     or `model/document.ts`. This collapses the backend type-check
//     graph from ~49 docs files down to just `node.ts` + `model/types.ts`.
//   - `packages/docs/package.json` exposes this file as a `./node`
//     subpath (`@wafflebase/docs/node`) for downstream consumers that
//     want the same DOM-free surface via Node module resolution
//     (requires `moduleResolution: node16/nodenext/bundler`).
//
// If a backend caller needs a new symbol, add it here AFTER confirming
// the symbol's source module has no DOM/Canvas dependency.

export type {
  Document,
  Block,
  BlockType,
  HeadingLevel,
  Inline,
  BlockStyle,
  InlineStyle,
  ImageData,
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
  BlockCellInfo,
  TableCellRange,
  HeaderFooter,
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
  getCellText,
  DEFAULT_HEADER_MARGIN_FROM_EDGE,
} from './model/types.js';
