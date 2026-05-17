// PPTX import — best-effort. Browser usage relies on the host's
// `DOMParser`; Node consumers should import from `@wafflebase/slides/node`
// instead so the dual-entry build can keep the polyfill story explicit.
export { importPptx } from './import/pptx';
export type {
  ImportPptxOptions,
  ImportPptxResult,
  UploadImage,
} from './import/pptx';
export { ImportReport } from './import/pptx/report';

// Model
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

export type {
  Theme,
  ColorScheme,
  FontScheme,
  ColorRole,
  FontRole,
  ThemeColor,
  ThemeFont,
} from './model/theme';
export { resolveColor, resolveFont } from './model/theme';
export type {
  Master,
  PlaceholderStyle,
  MasterBackground,
  MasterBackgroundImage,
} from './model/master';
export { DEFAULT_MASTER } from './model/master';
export { seedPlaceholderBlocks } from './model/placeholder-blocks';

export type {
  Crop,
  Element,
  ElementBase,
  ElementInit,
  ElementType,
  Frame,
  GroupElement,
  ImageElement,
  PlaceholderRef,
  PlaceholderType,
  ShapeElement,
  ShapeKind,
  ShapeStroke,
  Stroke,
  TextElement,
} from './model/element';
export { generateId } from './model/element';

export type { GroupTransform } from './model/group';
export {
  IDENTITY_GROUP_TRANSFORM,
  applyGroupTransform,
  composeAncestorTransform,
  composeGroupMatrix,
  findElementPath,
  groupToTransform,
  isGroupDescendantOf,
  normalizeToGroupLocal,
} from './model/group';

export type {
  ArrowheadKind,
  ArrowheadStyle,
  ConnectorElement,
  ConnectorRouting,
  Endpoint,
} from './model/connector';
export {
  computeConnectorFrame,
  resolveEndpoint,
} from './view/canvas/connector-frame';

export type { Point } from './model/frame';
export { boundingBox, combinedBoundingBox, containsPoint, toLocal } from './model/frame';

export { BUILT_IN_LAYOUTS, applyLayoutToSlide, getLayout, slotRefsForLayout } from './model/layout';

export { migrateDocument } from './model/migrate';

// Themes — built-in theme registry (Phase 5 / themed authoring)
export {
  defaultLight,
  defaultDark,
  streamline,
  focus,
  material,
  BUILT_IN_THEMES,
  getBuiltInTheme,
} from './themes';

// Store
export type { SlidesStore } from './store/store';
export { MemSlidesStore } from './store/memory';

// View — Canvas renderers (Phase 2)
export { SlideRenderer, type SlideRendererOptions } from './view/canvas/slide-renderer';
export { drawElement } from './view/canvas/element-renderer';
export { drawShape } from './view/canvas/shape-renderer';
export { drawText } from './view/canvas/text-renderer';
export { drawImage } from './view/canvas/image-renderer';
export { renderThumbnail, ThumbnailScheduler } from './view/canvas/thumbnail';
export { getOrLoadImage } from './view/canvas/image-cache';
export { renderShapeIcon } from './view/canvas/shape-icon';
export { PATH_BUILDERS, ADJUSTMENT_SPECS } from './view/canvas/shapes';
export type { PathBuilder, AdjustmentSpec, FrameSize } from './view/canvas/shapes/builder';

// View — Editor (Phase 3a)
export { initialize as initializeEditor, type SlidesEditor, type SlidesEditorOptions, type InsertKind, type ConnectorInsertKind } from './view/editor/editor';
export type { SlidesTextBoxEditor } from './view/editor/text-box-editor';
export type { AlignDirection, DistributeAxis, AlignReference } from './view/editor/align';

// View — Editor (Phase 3b additions)
export { mountThumbnailPanel, type ThumbnailPanelHandle } from './view/editor/thumbnail-panel';
export { mountNotesPanel } from './view/editor/notes-panel';
export { showLayoutPicker, type LayoutPickerOptions } from './view/editor/layout-picker';
export { showContextMenu, dismiss as dismissContextMenu, type ContextMenuItem } from './view/editor/context-menu';
export { MIME_TYPE as SLIDES_CLIPBOARD_MIME, serializeElements, deserializeElements } from './view/editor/interactions/clipboard';
export { SHORTCUTS, formatCombo, type ShortcutEntry, type ShortcutCategory } from './view/editor/shortcuts-catalog';

// View — Presenter (presentation mode)
export {
  startPresenter,
  type Presenter,
  type PresenterOptions,
} from './view/present';
