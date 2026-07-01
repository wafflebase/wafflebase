import { describe, it, expect } from "vitest";
import { needsForcedRepaintAfterRefit } from "../../../src/app/slides/refit-repaint";

describe("needsForcedRepaintAfterRefit", () => {
  it("forces a repaint when the bitmap was cleared but host+offset are unchanged", () => {
    // The black-canvas bug: pasteboard width changed (canvas cleared),
    // fitted slide stayed the same size, offset absorbed by Math.floor.
    // setHostSize + setSlideOffset both early-return → nobody repaints.
    expect(
      needsForcedRepaintAfterRefit({
        canvasChanged: true,
        hostChanged: false,
        offsetChanged: false,
      }),
    ).toBe(true);
  });

  it("does not double-paint when the host size changed (setHostSize repaints)", () => {
    expect(
      needsForcedRepaintAfterRefit({
        canvasChanged: true,
        hostChanged: true,
        offsetChanged: false,
      }),
    ).toBe(false);
  });

  it("does not double-paint when the offset changed (setSlideOffset repaints)", () => {
    expect(
      needsForcedRepaintAfterRefit({
        canvasChanged: true,
        hostChanged: false,
        offsetChanged: true,
      }),
    ).toBe(false);
  });

  it("does nothing when the canvas size did not change (no clear happened)", () => {
    // Host-only change with the same pasteboard: setHostSize repaints and
    // the bitmap was never wiped, so no forced repaint is warranted.
    expect(
      needsForcedRepaintAfterRefit({
        canvasChanged: false,
        hostChanged: true,
        offsetChanged: false,
      }),
    ).toBe(false);
  });
});
