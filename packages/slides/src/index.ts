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
