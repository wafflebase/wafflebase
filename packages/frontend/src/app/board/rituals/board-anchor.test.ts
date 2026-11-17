import { describe, expect, it } from "vitest";
import type { Frame } from "@wafflebase/slides";
import {
  boardAnchorLabel,
  elementAnchor,
  frozenAnchorPoint,
  pointAnchor,
  resolveBoardAnchor,
} from "./board-anchor";
import { frameFractionToWorld, worldToFrameFraction } from "./frame-fraction";

const frame = (over: Partial<Frame> = {}): Frame => ({
  x: 100,
  y: 200,
  w: 200,
  h: 100,
  rotation: 0,
  ...over,
});

function close(a: { x: number; y: number }, b: { x: number; y: number }) {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
}

describe("frame fractions", () => {
  it("round-trips through a rotated frame", () => {
    const f = frame({ rotation: Math.PI / 3 });
    const p = { x: 180, y: 260 };
    const { u, v } = worldToFrameFraction(f, p);
    close(frameFractionToWorld(f, u, v), p);
  });
});

describe("resolveBoardAnchor", () => {
  it("an element anchor follows its element when it moves", () => {
    const anchor = elementAnchor("e1", frame(), { x: 150, y: 225 });
    expect(anchor).toMatchObject({ elementId: "e1", u: 0.25, v: 0.25, x: 150, y: 225 });
    const moved = new Map([["e1", frame({ x: 1100, y: 1200 })]]);
    expect(resolveBoardAnchor(anchor, moved)).toEqual({ x: 1150, y: 1225, orphan: false });
  });

  it("follows a resize as a fraction, not an offset", () => {
    const anchor = elementAnchor("e1", frame(), { x: 300, y: 300 }); // bottom-right
    const resized = new Map([["e1", frame({ w: 400, h: 50 })]]);
    expect(resolveBoardAnchor(anchor, resized)).toEqual({ x: 500, y: 250, orphan: false });
  });

  it("clamps a point outside the element onto its edge", () => {
    const anchor = elementAnchor("e1", frame(), { x: 0, y: 0 });
    expect(anchor).toMatchObject({ u: 0, v: 0, x: 100, y: 200 });
  });

  it("an orphan keeps its stored last-known point", () => {
    const anchor = { ...elementAnchor("e1", frame(), { x: 150, y: 225 }), x: 7, y: 9 };
    expect(resolveBoardAnchor(anchor, new Map())).toEqual({ x: 7, y: 9, orphan: true });
  });

  it("a point anchor never orphans", () => {
    expect(resolveBoardAnchor(pointAnchor({ x: 3, y: 4 }), new Map())).toEqual({
      x: 3,
      y: 4,
      orphan: false,
    });
  });
});

describe("frozenAnchorPoint", () => {
  it("is where the anchor sits on the element being deleted", () => {
    const anchor = elementAnchor("e1", frame(), { x: 150, y: 225 });
    expect(frozenAnchorPoint(anchor, new Map([["e1", frame({ x: 0, y: 0 })]]))).toEqual({
      x: 50,
      y: 25,
    });
    expect(frozenAnchorPoint(anchor, new Map([["e2", frame()]]))).toBeNull();
    expect(frozenAnchorPoint(pointAnchor({ x: 1, y: 1 }), new Map([["e1", frame()]]))).toBeNull();
  });
});

describe("boardAnchorLabel", () => {
  it("names where a thread lives", () => {
    const live = new Set(["e1"]);
    expect(boardAnchorLabel(pointAnchor({ x: 0, y: 0 }), live)).toBe("On the board");
    expect(boardAnchorLabel(elementAnchor("e1", frame(), { x: 0, y: 0 }), live)).toBe(
      "On an object",
    );
    expect(boardAnchorLabel(elementAnchor("e2", frame(), { x: 0, y: 0 }), live)).toBe(
      "Object deleted",
    );
  });
});
