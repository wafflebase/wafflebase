import type { Block } from '@wafflebase/docs';
import type { AnimDirection, Crop, Element, ElementInit, ObjectAnimation, PlaceholderType } from './element';
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
  /**
   * Background fill. Optional: an absent fill means "inherit" — the
   * renderer resolves it through {@link resolveBackgroundFill}
   * (slide → layout → master → `background` role). A present fill is an
   * explicit override at that level. Slides authored before background
   * inheritance landed carry an explicit fill and keep their look.
   */
  fill?: ThemeColor;
  image?: BackgroundImage;
};

export type SlideTransition = {
  type: 'none' | 'fade' | 'dissolve' | 'slide' | 'flip' | 'cube' | 'wipe' | 'push';
  direction?: AnimDirection;
  durationMs: number;
};

export type SlideAnimation = ObjectAnimation & { elementId: string };

export type Slide = {
  id: string;
  layoutId: string;
  background: Background;
  elements: Element[];
  notes: Block[];
  /** Absent ⇒ hard cut (current behavior). */
  transition?: SlideTransition;
  /** Playback order = array order. Absent ⇒ no object animations. */
  animations?: SlideAnimation[];
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
  /**
   * Canvas pixels per typographic point for this deck. Slides text
   * painters multiply font sizes (and vertical margins) by
   * `pxPerPt / DOCS_PX_PER_PT` before handing them to the shared docs
   * renderer so 52 pt visually occupies the proportion PowerPoint
   * / Google Slides expect for the deck's physical size.
   *
   * Set by the PPTX importer from `<p:sldSz>`: a 10-inch-wide deck
   * mapped to our 1920-px canvas runs at `1920 / (10 × 72) = 2.667`
   * px/pt; a 13.333-inch widescreen runs at `2`. Absent ⇒ falls back
   * to `DOCS_PX_PER_PT` (the docs canvas's implicit 96 DPI). Absent
   * is what every in-app authored deck records today; keeping the
   * fallback means none of them visually shift after this lands.
   */
  pxPerPt?: number;
  /**
   * Recently used custom/standard colors as srgb hex strings, most
   * recent first, capped at {@link MAX_RECENT_COLORS}. Persisted per
   * document so collaborators share the same recents. Role colors are
   * intentionally excluded — they are theme-relative, so pinning one as
   * a "recent color" would lose its meaning when the theme changes.
   */
  recentColors?: string[];
};

/** Maximum number of {@link Meta.recentColors} entries kept. */
export const MAX_RECENT_COLORS = 8;

/**
 * Return `list` with `hex` moved to the front as the most-recently-used
 * color: case-insensitive de-dupe, then cap at {@link MAX_RECENT_COLORS}.
 * Pure — callers assign the result onto `meta.recentColors`.
 */
export function pushRecent(list: readonly string[], hex: string): string[] {
  const norm = hex.toLowerCase();
  return [norm, ...list.filter((c) => c.toLowerCase() !== norm)].slice(
    0,
    MAX_RECENT_COLORS,
  );
}

/**
 * docs `paintLayout` uses `pt × 96/72` to convert points to px. Slides
 * pre-scales blocks against this baseline so the docs API stays put
 * while the deck rendering picks up the right physical-pt feel.
 */
export const DOCS_PX_PER_PT = 96 / 72;

/**
 * Multiplier slides text painters apply to font sizes / margins before
 * calling into docs. Equals `1` when `pxPerPt` is absent so existing
 * decks render exactly as they used to.
 */
export function deckFontScale(meta: Pick<Meta, 'pxPerPt'>): number {
  if (meta.pxPerPt == null || !Number.isFinite(meta.pxPerPt) || meta.pxPerPt <= 0) {
    return 1;
  }
  return meta.pxPerPt / DOCS_PX_PER_PT;
}

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

/**
 * A bare `background` role fill (no lum/tint/shade/alpha modifiers) is the
 * system default every slide used to be seeded with before background
 * inheritance landed. It is indistinguishable from "no background chosen",
 * so it is treated as inherit — this lets a master/layout background edit
 * reach slides authored before inheritance (which all carry this exact
 * fill), not just freshly-created ones. A genuine custom override (an
 * srgb color, or the background role with a tint/shade) still wins.
 */
function isInheritableFill(fill: ThemeColor): boolean {
  return (
    fill.kind === 'role' &&
    fill.role === 'background' &&
    fill.lumMod === undefined &&
    fill.lumOff === undefined &&
    fill.tint === undefined &&
    fill.shade === undefined &&
    fill.alpha === undefined
  );
}

/**
 * Resolve the effective background fill for a slide, walking the
 * inheritance chain slide → layout → master → `background` role. The
 * first level with an explicit (non-inheritable) `fill` wins; an absent
 * or bare-default fill means "inherit from the next". Used by every
 * renderer (canvas, PDF) so master/layout background edits cascade to
 * inheriting slides at paint time without per-slide writes.
 */
export function resolveBackgroundFill(
  slide: Slide,
  doc: SlidesDocument,
): ThemeColor {
  if (slide.background.fill && !isInheritableFill(slide.background.fill)) {
    return slide.background.fill;
  }
  const layout = doc.layouts.find((l) => l.id === slide.layoutId);
  if (layout?.background?.fill) return layout.background.fill;
  const master = doc.masters.find((m) => m.id === doc.meta.masterId);
  if (master?.background.fill) return master.background.fill;
  return { kind: 'role', role: 'background' };
}

/**
 * Resolve the effective background image for a slide: slide → layout →
 * master. Returns `undefined` when no level sets one.
 */
export function resolveBackgroundImage(
  slide: Slide,
  doc: SlidesDocument,
): BackgroundImage | undefined {
  if (slide.background.image) return slide.background.image;
  const layout = doc.layouts.find((l) => l.id === slide.layoutId);
  if (layout?.background?.image) return layout.background.image;
  const master = doc.masters.find((m) => m.id === doc.meta.masterId);
  return master?.background.image;
}

export const SLIDE_WIDTH = 1920;
export const SLIDE_HEIGHT = 1080;
