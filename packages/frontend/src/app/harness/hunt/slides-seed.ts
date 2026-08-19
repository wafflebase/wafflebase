// The slides seed's GEOMETRY, in its own module with no imports.
//
// WHY SEPARATE FROM `page.tsx`. The rule below is load-bearing and was, until this file
// existed, checkable only by booting Vite and Chromium — a lane that is not run in CI and
// that a loaded machine cannot finish inside its timeouts. The rule is pure arithmetic, so
// it belongs somewhere a unit test can reach in milliseconds. Importing `page.tsx` would
// drag React and two engines into that test; importing this drags nothing.

/** One seeded element's slide-logical rect, in the 1920x1080 space the model stores. */
export type SeedFrame = { id: string; x: number; y: number; w: number; h: number };

/**
 * THE RULE: no element's CENTRE may lie inside another element's rect.
 *
 * `slides.elementCenter` aims at an element's middle and the canvas selects whatever is
 * TOPMOST at that point. So an element whose centre is covered can be named by the reader
 * and yet never be the thing that gets selected — the reader says `card`, the click
 * selects `badge`, and an explorer meeting that predicts `["card"]`, reads `["badge"]`,
 * and proposes "clicking an element selects a different one" as a major defect with a
 * repro that reproduces perfectly. Measured on the first live probe of this surface, with
 * `badge` at (1300,500): exactly that happened.
 *
 * Overlap ITSELF is wanted — z-order changes have to be visible, and two shapes that never
 * touch make `Bring to front` an invisible no-op. Only the centres must stay clear.
 */
export const SEED_FRAMES: readonly SeedFrame[] = [
  { id: "card", x: 1150, y: 400, w: 560, h: 320 },
  { id: "badge", x: 1560, y: 300, w: 200, h: 120 },
  { id: "title", x: 160, y: 120, w: 1600, h: 200 },
  { id: "body", x: 160, y: 400, w: 900, h: 300 },
];

/** The point `slides.elementCenter` aims at. Rotation is around the centre, so it cannot move it. */
export function centreOf(frame: SeedFrame): { x: number; y: number } {
  return { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 };
}

/** Is `point` inside `frame`? Edge-inclusive, because a click on the edge still hits. */
export function covers(frame: SeedFrame, point: { x: number; y: number }): boolean {
  return point.x >= frame.x && point.x <= frame.x + frame.w && point.y >= frame.y && point.y <= frame.y + frame.h;
}

/** Every (centre, coverer) pair that breaks the rule. Empty means the seed is aimable. */
export function coveredCentres(frames: readonly SeedFrame[] = SEED_FRAMES): Array<{ id: string; coveredBy: string }> {
  const out: Array<{ id: string; coveredBy: string }> = [];
  for (const target of frames) {
    for (const other of frames) {
      if (other.id === target.id) continue;
      if (covers(other, centreOf(target))) out.push({ id: target.id, coveredBy: other.id });
    }
  }
  return out;
}
