import { describe, expect, it } from "vitest";
import {
  countCorners,
  recognizeStroke,
  resample,
  smartShapeInits,
  type Pt,
} from "./board-smart-shapes";

/** A deterministic wobble, so the tests are not flaky. */
function jitter(points: Pt[], amount: number): Pt[] {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647 - 0.5;
  };
  return points.map((p) => ({ x: p.x + rnd() * amount, y: p.y + rnd() * amount }));
}

function polyline(corners: Pt[], perSide = 20): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < corners.length - 1; i++) {
    const a = corners[i];
    const b = corners[i + 1];
    for (let k = 0; k < perSide; k++) {
      const t = k / perSide;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  out.push(corners[corners.length - 1]);
  return out;
}

function box(x: number, y: number, w: number, h: number): Pt[] {
  return polyline([
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
    { x: x + 2, y: y + 3 },
  ]);
}

function loop(cx: number, cy: number, rx: number, ry: number, n = 80, sweep = 1.0): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * 2 * Math.PI * sweep;
    out.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
  }
  return out;
}

describe("recognizeStroke", () => {
  it("a hand-drawn box is a rectangle", () => {
    const shape = recognizeStroke(jitter(box(100, 100, 200, 120), 3));
    expect(shape?.kind).toBe("rect");
    if (shape?.kind === "rect") {
      expect(shape.x).toBeCloseTo(100, -1);
      expect(shape.w).toBeCloseTo(200, -1);
    }
  });

  it("a box simplified down to its corners (as RDP leaves it) is still a rectangle", () => {
    const sparse = polyline(
      [{ x: 0, y: 0 }, { x: 160, y: 0 }, { x: 160, y: 90 }, { x: 0, y: 90 }, { x: 3, y: 4 }],
      1,
    );
    expect(recognizeStroke(sparse)?.kind).toBe("rect");
  });

  it("a hand-drawn loop is an ellipse", () => {
    expect(recognizeStroke(jitter(loop(200, 200, 100, 60), 3))?.kind).toBe("ellipse");
    expect(recognizeStroke(jitter(loop(200, 200, 80, 80), 2))?.kind).toBe("ellipse");
  });

  it("a near-straight stroke is a line", () => {
    const pts = jitter(polyline([{ x: 0, y: 0 }, { x: 300, y: 100 }], 40), 4);
    const shape = recognizeStroke(pts);
    expect(shape?.kind).toBe("line");
  });

  it("a line ending in a flick is an arrow pointing at the tip", () => {
    const shaft = polyline([{ x: 0, y: 0 }, { x: 300, y: 0 }], 40);
    const barb = polyline([{ x: 300, y: 0 }, { x: 270, y: -20 }], 6).slice(1);
    const shape = recognizeStroke([...shaft, ...barb]);
    expect(shape?.kind).toBe("arrow");
    if (shape?.kind === "arrow") expect(shape.end).toEqual({ x: 300, y: 0 });
  });

  it("a V arrowhead (both barbs) is an arrow too", () => {
    const shaft = polyline([{ x: 0, y: 0 }, { x: 300, y: 0 }], 40);
    const barbs = polyline(
      [{ x: 300, y: 0 }, { x: 275, y: -18 }, { x: 300, y: 0 }, { x: 275, y: 18 }],
      5,
    ).slice(1);
    expect(recognizeStroke([...shaft, ...barbs])?.kind).toBe("arrow");
  });

  it("leaves scribbles, open curves, ticks and tiny strokes alone", () => {
    // An S curve.
    const s: Pt[] = [];
    for (let i = 0; i <= 60; i++) s.push({ x: i * 5, y: Math.sin(i / 6) * 60 });
    expect(recognizeStroke(s)).toBeNull();
    // An open arc (half a circle).
    expect(recognizeStroke(loop(200, 200, 100, 100, 40, 0.5))).toBeNull();
    // A zig-zag.
    expect(
      recognizeStroke(polyline([{ x: 0, y: 0 }, { x: 50, y: 80 }, { x: 100, y: 0 }, { x: 150, y: 80 }])),
    ).toBeNull();
    // A tick mark is below the size floor.
    expect(recognizeStroke([{ x: 0, y: 0 }, { x: 5, y: 8 }, { x: 18, y: -6 }])).toBeNull();
    expect(recognizeStroke([{ x: 0, y: 0 }])).toBeNull();
    // A triangle: closed, but three corners and a poor fit to either shape.
    expect(
      recognizeStroke(polyline([{ x: 0, y: 100 }, { x: 60, y: 0 }, { x: 120, y: 100 }, { x: 2, y: 98 }])),
    ).toBeNull();
  });
});

describe("geometry helpers", () => {
  it("resample spaces points evenly", () => {
    const pts = resample([{ x: 0, y: 0 }, { x: 100, y: 0 }], 11);
    expect(pts).toHaveLength(11);
    expect(pts[5].x).toBeCloseTo(50);
  });

  it("countCorners counts a square's four and a circle's none", () => {
    const sq = resample(box(0, 0, 100, 100), 64);
    sq.pop();
    expect(countCorners(sq)).toBe(4);
    const circle = resample(loop(0, 0, 50, 50), 64);
    circle.pop();
    expect(countCorners(circle)).toBe(0);
  });
});

describe("smartShapeInits", () => {
  const stroke = { color: "#1E1E1E", width: 4, cap: "round" as const };

  it("a rectangle keeps the marker stroke and has no fill", () => {
    const [init] = smartShapeInits({ kind: "rect", x: 1, y: 2, w: 30, h: 40 }, stroke);
    expect(init).toMatchObject({
      type: "shape",
      frame: { x: 1, y: 2, w: 30, h: 40 },
      data: { kind: "rect", stroke: { color: "#1E1E1E", width: 4 } },
    });
    expect((init as { data: { fill?: unknown } }).data.fill).toBeUndefined();
  });

  it("an arrow is a straight connector with an end arrowhead", () => {
    const [init] = smartShapeInits(
      { kind: "arrow", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } },
      stroke,
    );
    expect(init).toMatchObject({
      type: "connector",
      routing: "straight",
      end: { kind: "free", x: 10, y: 0 },
      arrowheads: { end: { kind: "triangle" } },
    });
    const [line] = smartShapeInits({ kind: "line", start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }, stroke);
    expect((line as { arrowheads: object }).arrowheads).toEqual({});
  });
});
