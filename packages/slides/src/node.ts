// DOM-free public surface for `@wafflebase/slides`.
//
// Exports only the data-model layer — types + pure math + the
// built-in layout templates. Node consumers (NestJS backend, CLI,
// future SSR) reach all of this without pulling in Canvas,
// `OffscreenCanvas`, or any DOM dependency. Modules that *do* touch
// the DOM (canvas renderers, the editor controller, the thumbnail
// scheduler, the React-adjacent panels) stay behind the browser entry
// at `src/index.ts`.
//
// Wired in two places:
//   - `packages/backend/tsconfig.json` paths map `@wafflebase/slides`
//     directly to this file. Backend tsc therefore type-checks the
//     transitive imports of every symbol re-exported below — but
//     still does NOT see the DOM-only modules in `src/index.ts`.
//   - `packages/slides/package.json` exposes this file as a `./node`
//     subpath (`@wafflebase/slides/node`) for downstream consumers
//     that prefer Node module resolution over a tsconfig paths entry.
//
// **If a backend caller needs a new symbol, add it here ONLY AFTER
// confirming the symbol's source module — and its transitive
// imports — have no DOM/Canvas dependency.** A regression here will
// only surface when a backend test imports something DOM-shaped at
// runtime, not at build time.

export type {
  Background,
  BackgroundImage,
  Layout,
  Meta,
  PlaceholderSpec,
  Slide,
  SlidesDocument,
} from './model/presentation';
export { DEFAULT_BACKGROUND, SLIDE_HEIGHT, SLIDE_WIDTH } from './model/presentation';

export type { ColorScheme, FontScheme, Theme, ThemeColor, ThemeFont } from './model/theme';
export type { Master, MasterBackground, MasterBackgroundImage } from './model/master';

export type {
  Crop,
  Element,
  ElementBase,
  ElementInit,
  ElementType,
  Frame,
  ImageElement,
  ShapeElement,
  ShapeKind,
  ShapeStroke,
  Stroke,
  TextElement,
} from './model/element';
export { generateId } from './model/element';

export type { Point } from './model/frame';
export { boundingBox, combinedBoundingBox, containsPoint, toLocal } from './model/frame';

export { BUILT_IN_LAYOUTS, getLayout } from './model/layout';

// Store interface (the data contract — implementations may pull in
// DOM, but the interface itself does not). The reference impl
// `MemSlidesStore` is also DOM-free and re-exported here.
export type { SlidesStore } from './store/store';
export { MemSlidesStore } from './store/memory';

// Shape registry + icon helper. The `PATH_BUILDERS` map and
// `renderShapeIcon` *signatures* type-reference `Path2D` /
// `CanvasRenderingContext2D` (DOM ambients), but neither calls those
// constructors at module-load time — Path2D is only instantiated when
// a builder is invoked, and the icon helper only runs when given a
// real ctx. Backend code that does not invoke them stays runtime-clean.
export { renderShapeIcon } from './view/canvas/shape-icon';
export {
  PATH_BUILDERS,
  ADJUSTMENT_SPECS,
  ADJUSTMENT_HANDLES,
} from './view/canvas/shapes';
export type { PathBuilder, AdjustmentSpec, FrameSize, AdjustmentHandle } from './view/canvas/shapes/builder';

// PPTX import — best-effort. Reaches for `DOMParser` at runtime, so
// Node consumers (the CLI) must install a polyfill before calling. The
// CLI's `dom-polyfill.ts` already does this as a side-effect import for
// the docs DOCX importer; the same polyfill covers slides.
export { importPptx } from './import/pptx';
export type {
  ImportPptxOptions,
  ImportPptxResult,
  UploadImage,
} from './import/pptx';
export { ImportReport } from './import/pptx/report';
