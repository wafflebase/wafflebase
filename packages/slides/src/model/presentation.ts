import type { Block } from '@wafflebase/docs';
import type { Element, ElementInit } from './element';

export type Background = {
  fill: string;
  image?: { src: string };
};

export type Slide = {
  id: string;
  layoutId: string;
  background: Background;
  elements: Element[]; // array order = z-order; last = front
  notes: Block[]; // speaker notes (rich text via @wafflebase/docs)
};

export type PlaceholderSpec = ElementInit;

export type Layout = {
  id: string;
  name: string;
  placeholders: PlaceholderSpec[];
};

export type Meta = {
  title: string;
};

export type SlidesDocument = {
  meta: Meta;
  slides: Slide[];
  layouts: Layout[];
};

/** Default background for a new slide. */
export const DEFAULT_BACKGROUND: Background = { fill: '#ffffff' };

/** Logical canvas size (16:9 widescreen, matches Google Slides default). */
export const SLIDE_WIDTH = 1920;
export const SLIDE_HEIGHT = 1080;
