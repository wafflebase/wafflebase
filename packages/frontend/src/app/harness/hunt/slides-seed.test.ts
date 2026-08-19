import { describe, expect, it } from "vitest";

import { centreOf, covers, coveredCentres, SEED_FRAMES } from "./slides-seed";

describe("the slides harness seed", () => {
  it("puts no element's centre under another element", () => {
    // THE ASSERTION THIS FILE EXISTS FOR. A covered centre makes
    // `slides.elementCenter` name one element and select another, which is correct
    // hit-testing and a manufactured defect: the explorer predicts the element it aimed
    // at, reads the one on top, and files "clicking an element selects a different one".
    expect(coveredCentres()).toEqual([]);
  });

  it("still overlaps, so a z-order change is visible", () => {
    // The other half of the rule. Shapes that never touch make `Bring to front` an
    // invisible no-op, and a control that correctly does nothing reads exactly like a
    // broken one — so "no covered centres" must not be achieved by pulling them apart.
    const overlapping = SEED_FRAMES.some((a) =>
      SEED_FRAMES.some(
        (b) =>
          a.id !== b.id &&
          a.x < b.x + b.w &&
          b.x < a.x + a.w &&
          a.y < b.y + b.h &&
          b.y < a.y + a.h,
      ),
    );
    expect(overlapping).toBe(true);
  });

  it("keeps every element inside the slide, so no centre is off-canvas", () => {
    // `slides.elementCenter` REFUSES a centre outside the visible canvas, so a seeded
    // element that starts off-slide would be unclickable from the first action.
    for (const f of SEED_FRAMES) {
      const c = centreOf(f);
      expect(c.x, `${f.id} centre x`).toBeGreaterThan(0);
      expect(c.x, `${f.id} centre x`).toBeLessThan(1920);
      expect(c.y, `${f.id} centre y`).toBeGreaterThan(0);
      expect(c.y, `${f.id} centre y`).toBeLessThan(1080);
    }
  });

  it("detects a covered centre when there is one", () => {
    // A NEGATIVE CONTROL for the check itself. `coveredCentres()` returning `[]` is only
    // meaningful if it can return something — and the first version of this seed is the
    // case it has to catch, so the regression is pinned by its own historical values.
    const broken = [
      { id: "card", x: 1150, y: 400, w: 560, h: 320 },
      { id: "badge", x: 1300, y: 500, w: 200, h: 120 },
    ];
    // MUTUAL, and worth pinning as such: card's centre (1430,560) sits inside badge, and
    // badge's centre (1400,560) sits inside card. The trap was symmetric, so aiming at
    // either one could select the other depending only on z-order.
    expect(coveredCentres(broken)).toEqual([
      { id: "card", coveredBy: "badge" },
      { id: "badge", coveredBy: "card" },
    ]);
    expect(covers(broken[1], centreOf(broken[0]))).toBe(true);
  });
});
