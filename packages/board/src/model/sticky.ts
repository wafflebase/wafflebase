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
 * Whether a shape's data is the sticky-note preset: a `roundRect` with a
 * solid fill, shrink-to-fit text, a drop shadow and no border. Stickies
 * imported before the Miro importer gave them a shadow read as plain
 * shapes, which is how they behaved before this existed.
 */
export function isStickyData(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const d = data as {
    kind?: string;
    fill?: { kind?: string };
    stroke?: unknown;
    effects?: { shadow?: unknown };
    text?: { autofit?: string };
  };
  return (
    d.kind === 'roundRect' &&
    d.fill?.kind === 'srgb' &&
    d.text?.autofit === 'shrink' &&
    d.effects?.shadow !== undefined &&
    d.stroke === undefined
  );
}
