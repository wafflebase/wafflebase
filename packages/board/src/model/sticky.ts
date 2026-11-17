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
