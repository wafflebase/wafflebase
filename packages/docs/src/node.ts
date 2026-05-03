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

// Pagination + serialization surface used by `@wafflebase/cli` to render
// fetched documents into JSON / Markdown / plaintext and to slice them
// by page range. None of these modules touch the DOM — they take a
// `TextMeasurer` instead of reaching for Canvas — so they're safe under
// the Node entry. Adding a new symbol here requires the same DOM-free
// audit as anything else in this file.
export type { TextMeasurer, ResolvedFont } from './view/measurer.js';
export { computeLayout } from './view/layout.js';
export type {
  DocumentLayout,
  LayoutBlock,
  LayoutLine,
  LayoutRun,
} from './view/layout.js';
export { paginateLayout } from './view/pagination.js';
export type {
  PageLine,
  LayoutPage,
  PaginatedLayout,
} from './view/pagination.js';
export { serializeJson } from './serialize/json.js';
export type { BlockPageMeta, SerializedJson } from './serialize/json.js';
export { serializeMarkdown } from './serialize/markdown.js';
export type { MarkdownOptions } from './serialize/markdown.js';
export { serializeText } from './serialize/text.js';
export type { TextOptions } from './serialize/text.js';

// PDF/DOCX export — used by the Docs CLI for `wafflebase docs export`.
// PdfExporter and DocxExporter take a TextMeasurer / ImageFetcher rather
// than reaching for Canvas/`Image` directly, so they're DOM-free for
// PNG/JPEG content. Image formats requiring Canvas re-encode (BMP, TIFF
// in DOCX exports) still throw at paint time — the CLI does not yet
// support those.
export { PdfExporter } from './export/pdf-exporter.js';
export type { PdfExportOptions } from './export/pdf-exporter.js';
export { PdfFonts, scanFontsUsed } from './export/pdf-fonts.js';
export type { PdfFontKey, FontUsage, PdfFontsOptions } from './export/pdf-fonts.js';
export { DocxExporter } from './export/docx-exporter.js';
export type { ImageFetcher as DocxImageFetcher } from './export/docx-exporter.js';
export type { ImageFetcher as PdfImageFetcher } from './export/pdf-image-painter.js';

// DOCX import — used by `wafflebase docs import`. The importer reaches
// for `DOMParser` at runtime, so Node consumers (the CLI) must install
// a polyfill (e.g., `@xmldom/xmldom`) before calling
// `DocxImporter.import`. The CLI's `dom-polyfill.ts` does this as a
// side-effect import.
export { DocxImporter } from './import/docx-importer.js';
export type { ImageUploader } from './import/docx-importer.js';
