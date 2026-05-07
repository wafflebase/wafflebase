export type {
  ChartType,
  SheetChart,
  WorksheetFilterState,
  Worksheet,
  TabType,
  SheetKind,
  TabMeta,
  SpreadsheetDocument,
} from '@wafflebase/sheets';

// Re-export Document types used by the docs content endpoints. The CLI
// layer consumes `Document` as the canonical request/response shape for
// `GET`/`PUT /api/v1/.../documents/:id/content`.
export type {
  Document as DocsDocument,
  Block as DocsBlock,
  Inline as DocsInline,
  BlockStyle as DocsBlockStyle,
  InlineStyle as DocsInlineStyle,
  HeaderFooter as DocsHeaderFooter,
  PageSetup as DocsPageSetup,
  TableRow as DocsTableRow,
  TableCell as DocsTableCell,
} from '@wafflebase/docs';

// Slides Yorkie document — frontend stores YorkieSlidesRoot under
// this key, but the canonical type the backend reasons about is the
// snapshot shape from @wafflebase/slides.
export type {
  SlidesDocument,
  Slide as SlidesSlide,
  Element as SlidesElement,
  TextElement as SlidesTextElement,
  ImageElement as SlidesImageElement,
  ShapeElement as SlidesShapeElement,
  Layout as SlidesLayout,
} from '@wafflebase/slides';
