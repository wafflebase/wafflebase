// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  STAMP_ART,
  STAMP_POP_WINDOW_MS,
  createStampIconSvg,
  shouldPopStamp,
  stamperColor,
  stamperInitial,
} from "./stamp-art";
import { STAMP_KINDS } from "./stamps";
import { createRitualLayerDom } from "./ritual-layer-dom";
import type { BoardStamp } from "./types";

describe("stamp art", () => {
  it("has art for every stamp kind", () => {
    for (const { kind } of STAMP_KINDS) {
      expect(STAMP_ART[kind].paths.length).toBeGreaterThan(0);
      const svg = createStampIconSvg(kind);
      expect(svg.querySelectorAll("path")).toHaveLength(STAMP_ART[kind].paths.length);
    }
  });

  it("gives one person the same colour on every stamp", () => {
    expect(stamperColor("u42")).toBe(stamperColor("u42"));
  });

  it("takes the first character of the name as the initial", () => {
    expect(stamperInitial("  alice ")).toBe("A");
    expect(stamperInitial("홍길동")).toBe("홍");
    expect(stamperInitial("😀 smile")).toBe("😀");
    expect(stamperInitial("   ")).toBe("?");
    expect(stamperInitial(null)).toBe("?");
  });

  it("pops only a stamp placed just now", () => {
    const now = 1_000_000;
    expect(shouldPopStamp(now - 100, now)).toBe(true);
    expect(shouldPopStamp(now - STAMP_POP_WINDOW_MS - 1, now)).toBe(false);
    // A peer's clock a little ahead of ours still counts as "just now".
    expect(shouldPopStamp(now + 500, now)).toBe(true);
  });
});

describe("stamp node", () => {
  const stamp: BoardStamp = {
    el: "e1",
    by: "u1",
    name: "alice",
    kind: "heart",
    u: 0.5,
    v: 0.5,
    at: 0,
  };
  const layout = (size: number) => ({
    stamps: [{ key: "k1", stamp, x: 100, y: 100, size, mine: true }],
    voteDots: [],
    results: [],
    pins: [],
  });

  it("draws a sticker with the stamper badge instead of an emoji", () => {
    const root = document.createElement("div");
    const dom = createRitualLayerDom(root, { onPinClick: () => {} });
    dom.render(layout(32));
    const el = root.querySelector<HTMLElement>("[data-board-stamp]")!;
    expect(el.dataset.kind).toBe("heart");
    expect(el.querySelector("svg")).not.toBeNull();
    const badge = el.querySelector<HTMLElement>("[data-board-stamp-badge]")!;
    expect(badge.textContent).toBe("A");
    expect(badge.hidden).toBe(false);
    dom.dispose();
  });

  it("hides the badge when the stamp is too small to read it", () => {
    const root = document.createElement("div");
    const dom = createRitualLayerDom(root, { onPinClick: () => {} });
    dom.render(layout(16));
    const badge = root.querySelector<HTMLElement>("[data-board-stamp-badge]")!;
    expect(badge.hidden).toBe(true);
    dom.dispose();
  });
});
