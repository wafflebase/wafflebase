import type { Block } from '@wafflebase/docs';
import type { Crop, Element, ElementInit, PlaceholderType } from './element';
import type { Theme, ThemeColor } from './theme';
import type { Master } from './master';

/**
 * Image fill behind a slide. Painted inside the logical 1920×1080
 * region after `fill`; transparent regions of the image reveal the
 * solid color underneath. Stretch mode only — there is no tile/repeat
 * variant yet.
 */
export type BackgroundImage = {
  src: string;
  /** `[0, 1]`. Imported from OOXML `<a:blip><a:alphaModFix>`. */
  opacity?: number;
  /** `<a:srcRect>` sub-rectangle of the source image, in 0..1 coords. */
  crop?: Crop;
};

export type Background = {
  fill: ThemeColor;
  image?: BackgroundImage;
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
  /**
   * Display unit for the Format options panel (and, when adopted,
   * the ruler). Renderer never reads this field; it only switches
   * what the panel's numeric inputs show. Absent ⇒ 'in'.
   */
  unit?: 'in' | 'cm';
};

export type GuideAxis = 'x' | 'y';

/**
 * Presentation-wide alignment guide. A guide is an infinite line at a
 * fixed slide-x (axis: 'x' → vertical guide) or slide-y (axis: 'y' →
 * horizontal guide) value, shared across every slide in the deck.
 * Phase 3 adds the data model + passive render; user-driven create /
 * move / delete arrives in Phase 4.
 *
 * See docs/design/slides/slides-ruler.md.
 */
export type Guide = {
  id: string;
  axis: GuideAxis;
  /** Slide logical px, clamped by callers into the slide's extent. */
  position: number;
};

export type SlidesDocument = {
  meta: Meta;
  themes: Theme[];
  masters: Master[];
  layouts: Layout[];
  slides: Slide[];
  /** Presentation-wide alignment guides. See {@link Guide}. */
  guides: Guide[];
};

export const DEFAULT_BACKGROUND: Background = {
  fill: { kind: 'role', role: 'background' },
};

export const SLIDE_WIDTH = 1920;
export const SLIDE_HEIGHT = 1080;
