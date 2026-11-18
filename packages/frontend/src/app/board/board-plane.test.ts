import { describe, expect, it } from "vitest";
import { contrastRatio } from "@wafflebase/core/tokens";
import {
  BOARD_PLANE_BACKGROUND,
  BOARD_PLANE_DIMMED_BACKGROUND,
  boardPlaneBackground,
} from "./board-plane";

describe("board plane", () => {
  it("is the light deck background in light mode and dimmed in dark mode", () => {
    expect(boardPlaneBackground("light")).toBe(BOARD_PLANE_BACKGROUND);
    expect(boardPlaneBackground("dark")).toBe(BOARD_PLANE_DIMMED_BACKGROUND);
    expect(BOARD_PLANE_DIMMED_BACKGROUND).not.toBe(BOARD_PLANE_BACKGROUND);
  });

  it("keeps default board text readable on the dimmed plane", () => {
    // Content resolves against the light deck theme on both planes, so its
    // default text colour has to stay legible on the dimmed one too.
    expect(contrastRatio("#1A1A1A", BOARD_PLANE_DIMMED_BACKGROUND)).toBeGreaterThanOrEqual(7);
  });
});
