import type { Block } from '@wafflebase/docs';
import type { Element, ElementInit, ImageRef, PlaceholderType } from './element';
import type { Theme, ThemeColor } from './theme';
import type { Master } from './master';

export type Background = {
  fill: ThemeColor;
  image?: ImageRef;
};

export type Slide = {
  id: string;
  layoutId: string;
  background: Background;
  elements: Element[];
  notes: Block[];
};

export type PlaceholderSpec = ElementInit & {
  placeholder: { type: PlaceholderType };
};

export type Layout = {
  id: string;
  masterId: string;
  name: string;
  background?: Background;
  placeholders: PlaceholderSpec[];
  staticElements: Element[]; // v1.0: always empty; v1.5 populates
};

export type Meta = {
  title: string;
  themeId: string;
  masterId: string;
};

export type SlidesDocument = {
  meta: Meta;
  themes: Theme[];
  masters: Master[];
  layouts: Layout[];
  slides: Slide[];
};

export const DEFAULT_BACKGROUND: Background = {
  fill: { kind: 'role', role: 'background' },
};

export const SLIDE_WIDTH = 1920;
export const SLIDE_HEIGHT = 1080;
