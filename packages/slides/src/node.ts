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
  Guide,
  GuideAxis,
  Layout,
  Meta,
  PlaceholderSpec,
  Slide,
  SlidesDocument,
} from './model/presentation';
export { scaleElementHeight, scaleEndpointY } from './model/slide-size';
export {
  deckSlideHeight,
  DEFAULT_BACKGROUND,
  MAX_RECENT_COLORS,
  pushRecent,
  resolveBackgroundFill,
  resolveBackgroundImage,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
} from './model/presentation';

export type { ColorScheme, FontScheme, Theme, ThemeColor, ThemeFont } from './model/theme';
export type { Master, MasterBackground, MasterBackgroundImage } from './model/master';
// Default master + placeholder-block seeding — pure data-model helpers
// (sources import only model types). `YorkieSlidesStore` imports these from
// `@wafflebase/slides`; the slides `.integration.ts` suite runs that store
// under Node, which resolves to this entry, so they must be re-exported here.
// Kept in sync with the browser entry (`src/index.ts`).
export { DEFAULT_MASTER } from './model/master';
export { seedPlaceholderBlocks } from './model/placeholder-blocks';

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
  TextBody,
  TextElement,
} from './model/element';
export { generateId, isBlocksEmpty, isElementEmpty } from './model/element';

export type { Point } from './model/frame';
export { boundingBox, combinedBoundingBox, containsPoint, framesApproxEqual, toLocal } from './model/frame';

// Group geometry / transform math — pure functions over the data model
// (no DOM). Re-exported for `YorkieSlidesStore` running under Node.
export type { GroupTransform } from './model/group';
export {
  IDENTITY_GROUP_TRANSFORM,
  applyGroupTransform,
  applyInverseMatrix,
  applyInversePoint,
  bakeGroupScale,
  buildElementWorldLookup,
  composeAncestorTransform,
  composeGroupMatrix,
  findElementPath,
  flattenElements,
  groupToTransform,
  isGroupDescendantOf,
  normalizeToGroupLocal,
  worldChildrenAABB,
  worldTightFrame,
} from './model/group';
export {
  applyGroupTransformToPoint,
  applyGroupTransform as applyGroupTransformMatrix,
} from './import/pptx/group';

// Connector geometry — `computeConnectorFrame` / `resolveEndpoint` live
// under `view/canvas/` but are pure geometry (their transitive deps
// `connection-sites` and `routing` touch no DOM), so they are node-safe.
export {
  computeConnectorFrame,
  resolveEndpoint,
} from './view/canvas/connector-frame';

// Curve-bend clamp constants — `YorkieSlidesStore.updateConnectorCurveBend`
// clamps incoming bend through these, so the integration suite (which
// resolves `@wafflebase/slides` to this node entry under `tsx --test`)
// must see them re-exported. Kept in sync with `src/index.ts`.
export {
  CURVE_BEND_DEFAULT,
  CURVE_BEND_MAX,
  CURVE_BEND_MIN,
} from './view/canvas/routing';

export { migrateDocument, migrateMeta } from './model/migrate';
export { defaultLight } from './themes/default-light';
export { defaultDark } from './themes/default-dark';

export {
  BUILT_IN_LAYOUTS,
  applyLayoutToSlide,
  getLayout,
  slotRefsForLayout,
} from './model/layout';

// Store interface (the data contract — implementations may pull in
// DOM, but the interface itself does not). The reference impl
// `MemSlidesStore` is also DOM-free and re-exported here.
export type {
  SlidesStore,
  ThemePatch,
  MasterPatch,
  LayoutPatch,
} from './store/store';
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

// PPTX export — DOM-free; safe for Node consumers without a polyfill.
export { exportPptx } from './export/pptx/index.js';
export type { ExportPptxOptions } from './export/pptx/index.js';
