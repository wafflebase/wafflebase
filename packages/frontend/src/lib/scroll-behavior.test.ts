import { afterEach, describe, expect, it, vi } from "vitest";
import { scrollBehavior } from "./scroll-behavior";

function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: reduce && query === "(prefers-reduced-motion: reduce)",
    })),
  );
}

describe("scrollBehavior", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("scrolls smoothly by default", () => {
    mockReducedMotion(false);
    expect(scrollBehavior()).toBe("smooth");
  });

  it("jumps when the visitor prefers reduced motion", () => {
    mockReducedMotion(true);
    expect(scrollBehavior()).toBe("auto");
  });
});
