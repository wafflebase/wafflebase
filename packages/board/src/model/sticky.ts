import { makeDefaultSlidesTextBlock, type ElementInit, type Point } from '@wafflebase/slides';

/**
 * The sticky-note preset, shared by every path that creates one — the
 * board toolbar (`frontend/src/app/board/sticky.ts`) and the Miro importer.
 *
 * A sticky is not its own element type: it is a `roundRect` shape with a
 * solid fill, a soft drop shadow and a middle-anchored, shrink-to-fit text
 * body. The shadow is part of the identity, not just the look: a Miro
 * round-rectangle *shape* also imports as a solid `roundRect` with shrink
 * text, and it is the shadow (and the absence of a border) that tells the
 * two apart in {@link isStickyData}.
 */
export const STICKY_SHADOW = {
  color: '#000000',
  opacity: 0.18,
  angle: Math.PI / 2, // straight down
  distance: 3,
  blur: 8,
} as const;

/**
 * Corner radius of a sticky, as the `roundRect` adjustment (OOXML
 * thousandths of the short side): ~4px on the default 180px note. The
 * shape's own default (16667, a 30px radius there) reads as a rounded
 * button, not a sheet of paper.
 */
export const STICKY_CORNER_ADJ = 2222;

/**
 * Text padding of a sticky, on top of the `roundRect` preset's own text
 * rectangle (~4.9% per side, ~8.8px at 180px) — together ~12px on every
 * side. Without it the shape default padding (14.4 / 7.2px) applies, so
 * the side margins reached ~23px and shrink-to-fit text got small fast.
 */
export const STICKY_TEXT_INSET = { left: 4, top: 4, right: 4, bottom: 4 } as const;

/**
 * The explicit sticky marker, written into a sticky's shape `data` as
 * `role: 'sticky'` by every path that creates one (the board toolbar, the
 * `S` key, adjacent / pasted stickies, the Miro importer).
 *
 * Before it existed, identity was only the preset's look (see
 * {@link isStickyData}'s legacy branch), so a sticky someone gave a
 * gradient or a border silently became a plain rounded rectangle. The
 * marker makes identity survive restyling; the heuristic stays for
 * boards written before the marker.
 */
export const STICKY_ROLE = 'sticky';

/**
 * Additive fields a sticky's shape `data` may carry beyond the slides
 * `ShapeElement` data. All optional: a board without them loads and
 * renders unchanged.
 */
export interface StickyDataExtras {
  /** {@link STICKY_ROLE}. */
  role?: typeof STICKY_ROLE;
  /** Display name of the creator, written once at creation. */
  author?: string;
  /** Whether the author tag is painted. Absent ⇒ shown (when an author exists). */
  showAuthor?: boolean;
}

/**
 * Whether a shape's data is a sticky note: it carries the explicit
 * {@link STICKY_ROLE} marker, or (legacy, pre-marker boards) it matches
 * the preset — a `roundRect` with a solid fill, shrink-to-fit text, a
 * drop shadow and no border. Stickies imported before the Miro importer
 * gave them a shadow read as plain shapes, which is how they behaved
 * before this existed.
 */
export function isStickyData(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const d = data as {
    role?: unknown;
    kind?: string;
    fill?: { kind?: string };
    stroke?: unknown;
    effects?: { shadow?: unknown };
    text?: { autofit?: string };
  };
  if (d.role === STICKY_ROLE) return true;
  return (
    d.kind === 'roundRect' &&
    d.fill?.kind === 'srgb' &&
    d.text?.autofit === 'shrink' &&
    d.effects?.shadow !== undefined &&
    d.stroke === undefined
  );
}

/**
 * `data` with the sticky's corner radius and text padding filled in where
 * a sticky lacks them — what a board reads, so stickies written before
 * those values were part of the preset look like new ones. Values the
 * sticky carries (a radius someone dragged, an imported inset) win; the
 * input is never mutated, and anything that is not a sticky is returned
 * as is.
 */
export function withStickyDefaults<T>(data: T): T {
  if (!isStickyData(data)) return data;
  const d = data as {
    kind?: unknown;
    adjustments?: unknown;
    text?: { inset?: unknown };
  };
  // Only a `roundRect` reads adjustment 0 as a corner radius; a sticky
  // reshaped into another kind would read it as something else.
  const needsCorner = d.kind === 'roundRect' && d.adjustments === undefined;
  const needsInset = d.text !== undefined && d.text.inset === undefined;
  if (!needsCorner && !needsInset) return data;
  return {
    ...data,
    ...(needsCorner ? { adjustments: [STICKY_CORNER_ADJ] } : {}),
    ...(needsInset ? { text: { ...d.text, inset: { ...STICKY_TEXT_INSET } } } : {}),
  };
}

/**
 * Six pastel sticky fills. Kept light so the default dark slides text
 * color stays legible on top — a sticky is a preset `roundRect` shape,
 * not a distinct element type, so it inherits the shape text renderer.
 */
export const STICKY_COLORS: readonly { name: string; value: string }[] = [
  { name: 'Yellow', value: '#FFF8B8' },
  { name: 'Green', value: '#CDEFC4' },
  { name: 'Blue', value: '#C7E5FF' },
  { name: 'Pink', value: '#FFD6E7' },
  { name: 'Orange', value: '#FFE0B2' },
  { name: 'Purple', value: '#E5D4FF' },
];

/** Square sticky side length, in board world px. */
export const STICKY_SIZE = 180;

/** A sticky's width and height, in board world px. */
export interface StickySize {
  w: number;
  h: number;
}

/** The default sticky footprint. */
export const DEFAULT_STICKY_SIZE: StickySize = { w: STICKY_SIZE, h: STICKY_SIZE };

/** Extra fields a new sticky can be created with. */
export interface StickyOptions {
  size?: StickySize;
  /** Creator display name, recorded once (absent on an anonymous board). */
  author?: string;
  /** Initial text (a pasted line); absent leaves the body empty. */
  text?: string;
  /** Font size for the body; absent keeps the slides default. */
  fontSize?: number;
  /** Carried over from a source sticky; absent means the tag is shown. */
  showAuthor?: boolean;
}

/**
 * Build the `ElementInit` for a sticky note: a `roundRect` shape with a
 * solid srgb fill, a small corner radius, a soft drop shadow, and a
 * middle-anchored, shrink-autofit, center-aligned, evenly padded text body, centered on `center`. It
 * carries the explicit `role: 'sticky'` marker, so restyling it later
 * (a gradient, a border) never demotes it to a plain shape.
 *
 * The one factory every writer uses — the board toolbar, the `S` key,
 * pasted lines and the `/api/v1` board endpoints an agent drives — so a
 * sticky made through the CLI is the same element a person makes.
 *
 * The text body is seeded (rather than left absent for lazy creation)
 * so the sticky's middle/shrink/center layout applies to the first
 * keystroke — `withShapeText` preserves an existing `data.text` and only
 * synthesizes a bare one (top-anchored, grow) when none exists.
 */
export function buildStickyInit(
  colorValue: string,
  center: Point,
  options: StickyOptions = {},
): ElementInit {
  const { w, h } = options.size ?? DEFAULT_STICKY_SIZE;
  const block = makeDefaultSlidesTextBlock();
  block.style = { ...block.style, alignment: 'center' };
  if (options.text !== undefined || options.fontSize !== undefined) {
    block.inlines = block.inlines.map((inline, i) => ({
      ...inline,
      text: i === 0 && options.text !== undefined ? options.text : inline.text,
      style:
        options.fontSize !== undefined
          ? { ...inline.style, fontSize: options.fontSize }
          : inline.style,
    }));
  }
  const author = options.author?.trim();
  return {
    type: 'shape',
    frame: {
      x: center.x - w / 2,
      y: center.y - h / 2,
      w,
      h,
      rotation: 0,
    },
    data: {
      kind: 'roundRect',
      role: STICKY_ROLE,
      adjustments: [STICKY_CORNER_ADJ],
      fill: { kind: 'srgb', value: colorValue },
      effects: { shadow: { ...STICKY_SHADOW } },
      text: {
        blocks: [block],
        verticalAnchor: 'middle',
        autofit: 'shrink',
        inset: { ...STICKY_TEXT_INSET },
      },
      ...(author ? { author } : {}),
      ...(options.showAuthor === false ? { showAuthor: false } : {}),
    },
  } as ElementInit;
}
