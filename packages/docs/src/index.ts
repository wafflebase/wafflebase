// Model
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
export { Doc } from './model/document.js';
export type { EditContext } from './model/document.js';
export type { StoredColor, ColorResolver } from './model/color.js';
export {
  defaultColorResolver,
  storedColorsEqual,
  wrapLegacyColor,
} from './model/color.js';

// Store
export type { DocStore } from './store/store.js';
export { MemDocStore } from './store/memory.js';
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

// View
export { initialize, type EditorAPI } from './view/editor.js';
export { TextEditor } from './view/text-editor.js';
export {
  initializeTextBox,
  type TextBoxEditorAPI,
  type TextBoxEditorOptions,
} from './view/text-box-editor.js';
export { paintLayout, type PaintLayoutOpts } from './view/paint-layout.js';
export { findPositionAtPixel, type PixelPosition } from './view/find-position-at-pixel.js';
export type { TableMergeContext } from './view/table-merge-context.js';
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
export type { TextMeasurer, ResolvedFont } from './view/measurer.js';
export { CanvasTextMeasurer } from './view/canvas-measurer.js';
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
export type { HighlightRect } from './view/comment-markers.js';
export { findMarkerAt } from './view/comment-markers.js';
export { isSafeUrl, normalizeLinkUrl } from './view/url-detect.js';
export { computeScaleFactor, MOBILE_PADDING } from './view/scale.js';
export type { LayoutTable, LayoutTableCell } from './view/table-layout.js';
export { resolveFontFamily, FontRegistry } from './view/fonts.js';

// Serialize (Markdown / text / JSON)
export { serializeMarkdown } from './serialize/markdown.js';
export type { MarkdownOptions } from './serialize/markdown.js';
export { serializeText } from './serialize/text.js';
export type { TextOptions } from './serialize/text.js';
export { serializeJson } from './serialize/json.js';
export type { BlockPageMeta, SerializedJson } from './serialize/json.js';

// Import / Export (DOCX)
export { DocxImporter } from './import/docx-importer.js';
export type { ImageUploader } from './import/docx-importer.js';
export { DocxExporter } from './export/docx-exporter.js';
// `ImageFetcher` is the historical name; `DocxImageFetcher` is the
// disambiguated alias that survives both the browser entry and the
// `node` exports condition. CLI / backend code should prefer the latter
// to avoid colliding with `pdf-image-painter`'s `ImageFetcher`.
export type {
  ImageFetcher,
  ImageFetcher as DocxImageFetcher,
} from './export/docx-exporter.js';

// Export (PDF)
export { PdfExporter } from './export/pdf-exporter.js';
export type { PdfExportOptions } from './export/pdf-exporter.js';
export { PdfFonts, scanFontsUsed } from './export/pdf-fonts.js';
export type { PdfFontKey, PdfFontsOptions, FontUsage } from './export/pdf-fonts.js';
