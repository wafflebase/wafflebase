import type { Block } from '@wafflebase/docs';
import type { ThemeColor } from './theme';

export type Frame = {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Rotation around the element center, in radians. */
  rotation: number;
};

export type ImageRef = {
  src: string;
  /** Natural pixel dimensions, used to constrain crop and aspect. */
  w: number;
  h: number;
};

/** Crop rectangle in image-relative coordinates (0..1 on each axis). */
export type Crop = { x: number; y: number; w: number; h: number };

export type ShapeKind = 'rect' | 'ellipse' | 'line' | 'arrow';

export type ShapeStroke = {
  color: ThemeColor;
  width: number;
};

export type PlaceholderType =
  | 'title'
  | 'subtitle'
  | 'body'
  | 'caption'
  | 'big-number';

export type PlaceholderRef = {
  type: PlaceholderType;
  /** 0-based among same-type slots in the source layout. */
  index: number;
};

export type ElementBase = {
  id: string;
  frame: Frame;
  placeholderRef?: PlaceholderRef;
};

export type TextElement = ElementBase & {
  type: 'text';
  data: {
    /** Domain-level read view; the Yorkie store backs this with a Tree. */
    blocks: Block[];
  };
};

export type ImageElement = ElementBase & {
  type: 'image';
  data: {
    src: string;
    crop?: Crop;
    alt?: string;
  };
};

export type ShapeElement = ElementBase & {
  type: 'shape';
  data: {
    kind: ShapeKind;
    fill?: ThemeColor;
    stroke?: ShapeStroke;
  };
};

export type Element = TextElement | ImageElement | ShapeElement;

export type ElementType = Element['type'];

/** Used by Layout placeholders and store.addElement. */
export type ElementInit =
  | Omit<TextElement, 'id'>
  | Omit<ImageElement, 'id'>
  | Omit<ShapeElement, 'id'>;

/** Generate a short, URL-safe element/slide ID. */
export function generateId(): string {
  return crypto.randomUUID().slice(0, 8);
}

export function isElementEmpty(el: Element): boolean {
  if (el.type !== 'text') return false;
  return el.data.blocks.every((b) =>
    b.inlines.every((inline) => inline.text === ''),
  );
}
