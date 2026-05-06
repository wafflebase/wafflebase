// Model
export type {
  Background,
  Layout,
  Meta,
  PlaceholderSpec,
  Slide,
  SlidesDocument,
} from './model/presentation';
export { DEFAULT_BACKGROUND, SLIDE_HEIGHT, SLIDE_WIDTH } from './model/presentation';

export type {
  Crop,
  Element,
  ElementBase,
  ElementInit,
  ElementType,
  Frame,
  ImageElement,
  ImageRef,
  ShapeElement,
  ShapeKind,
  ShapeStroke,
  TextElement,
} from './model/element';
export { generateId } from './model/element';

export type { Point } from './model/frame';
export { boundingBox, combinedBoundingBox, containsPoint, toLocal } from './model/frame';

export { BUILT_IN_LAYOUTS, getLayout } from './model/layout';

// Store
export type { SlidesStore } from './store/store';
export { MemSlidesStore } from './store/memory';

// View — Canvas renderers (Phase 2)
export { SlideRenderer, type SlideRendererOptions } from './view/canvas/slide-renderer';
export { drawElement } from './view/canvas/element-renderer';
export { drawShape, type FrameSize } from './view/canvas/shape-renderer';
export { drawText } from './view/canvas/text-renderer';
export { drawImage } from './view/canvas/image-renderer';
export { renderThumbnail, ThumbnailScheduler } from './view/canvas/thumbnail';
export { getOrLoadImage } from './view/canvas/image-cache';

// View — Editor (Phase 3a)
export { initialize as initializeEditor, type SlidesEditor, type SlidesEditorOptions, type InsertKind } from './view/editor/editor';
