// DOM-free public surface for `@wafflebase/docs`.
//
// Exports the data-model layer (types + normalize helpers + defaults)
// AND the DOM-free slices of `view/`, `serialize/`, `export/`, and
// `import/` — pagination, layout, JSON/Markdown/text serialization,
// PDF/DOCX export, and DOCX import. Node consumers (NestJS backend,
// CLI, future SSR) reach all of this without pulling in Canvas,
// `OffscreenCanvas`, or any other DOM dependency. Modules that *do*
// touch the DOM (canvas-measurer, doc-canvas, peer-cursor, etc.)
// stay behind the browser entry at `src/index.ts`.
//
// Wired in two places:
//   - `packages/backend/tsconfig.json` paths map `@wafflebase/docs`
//     directly to this file. Backend tsc therefore type-checks the
//     transitive imports of every symbol re-exported below
//     (currently spans `view/{measurer,layout,pagination}`,
//     `serialize/{json,markdown,text}`,
//     `export/{pdf-exporter,pdf-fonts,docx-exporter,pdf-image-painter}`,
//     `import/docx-importer`, and their model dependencies) — but it
//     still does NOT see the DOM-only modules in `src/index.ts`.
//   - `packages/docs/package.json` exposes this file as a `./node`
//     subpath (`@wafflebase/docs/node`) for downstream consumers that
//     want the same DOM-free surface via Node module resolution
//     (requires `moduleResolution: node16/nodenext/bundler`).
//
// **If a backend caller needs a new symbol, add it here ONLY AFTER
// confirming the symbol's source module — and its transitive
// imports — have no DOM/Canvas dependency.** A regression here will
// only surface when a backend test imports something DOM-shaped at
// runtime, not at build time.

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

// Block-level edit helpers. These are pure data-model transforms — the
// source module only imports from `model/types.js`, so it carries no
// DOM/Canvas dependency and is safe under the Node entry. `YorkieDocStore`
// (frontend) imports these from `@wafflebase/docs`; the docs comments
// `.integration.ts` suite runs that store under Node, which resolves to
// this entry, so the helpers must be re-exported here as well. Kept in
// sync with the browser entry (`src/index.ts`).
export {
  resolveOffset,
  resolveDeleteRange,
  resolveStyleRange,
  normalizeInlines,
  applyInsertText,
  applyDeleteText,
  applyInlineStyle as applyInlineStyleHelper,
  applyInsertInline,
  applySplitBlock,
  applyMergeBlocks,
  resolveOffsetForSplit,
} from './store/block-helpers.js';
export type { InlinePosition, InlineSegment } from './store/block-helpers.js';

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
