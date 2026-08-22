// The board seed's GEOMETRY, in its own module with no heavy imports.
//
// Separate from `page.tsx` for the reason `slides-seed.ts` is: the rules below are load-
// bearing and would otherwise be checkable only by booting Vite and Chromium — a lane that
// is not run in CI. They are pure arithmetic, so a unit test should reach them in
// milliseconds.

/** One seeded element's world rect. A board has no page, so these are plain world pixels. */
export type BoardSeedFrame = { id: string; x: number; y: number; w: number; h: number };

/**
 * TWO RULES, both measured rather than assumed.
 *
 * NO CENTRE UNDER ANOTHER ELEMENT. `board.elementCenter` aims at an element's middle and the
 * canvas selects whatever is topmost there, so a covered centre makes the reader name one
 * element and select a different one. The slides seed shipped with exactly that and an
 * explorer would have proposed "clicking an element selects a different one".
 *
 * EVERYTHING INSIDE THE STARTING VIEW. The view is pinned at pan 0,0 zoom 1 over a
 * 960x540 window, and a board is unbounded — an element outside that is unclickable until
 * something scrolls, so a seed half off-screen makes the first action a refusal.
 */
export const BOARD_VIEW = { w: 960, h: 540 } as const;

export const BOARD_SEED_FRAMES: readonly BoardSeedFrame[] = [
  { id: "note", x: 60, y: 60, w: 200, h: 140 },
  { id: "card", x: 220, y: 150, w: 240, h: 160 },
  { id: "label", x: 560, y: 80, w: 320, h: 90 },
  { id: "idea", x: 560, y: 300, w: 300, h: 120 },
];

export function centreOf(frame: BoardSeedFrame): { x: number; y: number } {
  return { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 };
}

export function covers(frame: BoardSeedFrame, point: { x: number; y: number }): boolean {
  return point.x >= frame.x && point.x <= frame.x + frame.w && point.y >= frame.y && point.y <= frame.y + frame.h;
}

/** Every (centre, coverer) pair that breaks the first rule. Empty means the seed is aimable. */
export function coveredCentres(
  frames: readonly BoardSeedFrame[] = BOARD_SEED_FRAMES,
): Array<{ id: string; coveredBy: string }> {
  const out: Array<{ id: string; coveredBy: string }> = [];
  for (const target of frames) {
    for (const other of frames) {
      if (other.id === target.id) continue;
      if (covers(other, centreOf(target))) out.push({ id: target.id, coveredBy: other.id });
    }
  }
  return out;
}

/** Every element not wholly inside the starting view. Empty means nothing starts unreachable. */
export function outsideStartingView(
  frames: readonly BoardSeedFrame[] = BOARD_SEED_FRAMES,
): string[] {
  return frames
    .filter((f) => f.x < 0 || f.y < 0 || f.x + f.w > BOARD_VIEW.w || f.y + f.h > BOARD_VIEW.h)
    .map((f) => f.id);
}
