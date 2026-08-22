import { describe, expect, it } from "vitest";

import {
  BOARD_SEED_FRAMES,
  BOARD_VIEW,
  centreOf,
  covers,
  coveredCentres,
  outsideStartingView,
} from "./board-seed";

describe("the board harness seed", () => {
  it("puts no element's centre under another element", () => {
    // A covered centre makes `board.elementCenter` name one element and select another —
    // correct hit-testing, and a defect the harness would have manufactured.
    expect(coveredCentres()).toEqual([]);
  });

  it("starts every element inside the pinned view", () => {
    // The view is pinned at pan 0,0 zoom 1 over 960x540. On an unbounded plane an element
    // outside that is unclickable until something scrolls, so a seed that starts partly
    // off-screen makes the explorer's first action a refusal it did nothing to cause.
    expect(outsideStartingView()).toEqual([]);
  });

  it("still overlaps, so a z-order change is visible", () => {
    // The other half of the first rule: "no covered centres" must not be achieved by pulling
    // everything apart, or `Bring to front` becomes an invisible no-op that reads like a dead
    // control.
    const overlapping = BOARD_SEED_FRAMES.some((a) =>
      BOARD_SEED_FRAMES.some(
        (b) => a.id !== b.id && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h,
      ),
    );
    expect(overlapping).toBe(true);
  });

  it("detects both violations when they exist", () => {
    // NEGATIVE CONTROLS. `[]` twice above is only meaningful if these can return something.
    const stacked = [
      { id: "a", x: 0, y: 0, w: 200, h: 200 },
      { id: "b", x: 50, y: 50, w: 200, h: 200 },
    ];
    expect(coveredCentres(stacked)).toEqual([
      { id: "a", coveredBy: "b" },
      { id: "b", coveredBy: "a" },
    ]);
    expect(covers(stacked[1], centreOf(stacked[0]))).toBe(true);
    expect(outsideStartingView([{ id: "far", x: BOARD_VIEW.w + 10, y: 0, w: 50, h: 50 }])).toEqual(["far"]);
  });
});
