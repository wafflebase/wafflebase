import { describe, expect, it } from "vitest";
import {
  MAX_DT,
  isSettled,
  springAt,
  stepSpring,
  type SpringState,
} from "./board-cursor-spring";

function run(s: SpringState, target: { x: number; y: number }, seconds: number) {
  let state = s;
  const frames = Math.round(seconds * 60);
  let maxX = state.x;
  for (let i = 0; i < frames; i++) {
    state = stepSpring(state, target, 1 / 60);
    maxX = Math.max(maxX, state.x);
  }
  return { state, maxX };
}

describe("stepSpring", () => {
  it("settles on the target within half a second", () => {
    const { state } = run(springAt({ x: 0, y: 0 }), { x: 100, y: 50 }, 0.5);
    expect(isSettled(state, { x: 100, y: 50 }, 0.5)).toBe(true);
  });

  it("does not overshoot (critically damped)", () => {
    const { maxX } = run(springAt({ x: 0, y: 0 }), { x: 100, y: 0 }, 1);
    expect(maxX).toBeLessThanOrEqual(100.0001);
  });

  it("keeps velocity across a target change, so a curve stays a curve", () => {
    let s = springAt({ x: 0, y: 0 });
    for (let i = 0; i < 6; i++) s = stepSpring(s, { x: 100, y: 0 }, 1 / 60);
    expect(s.vx).toBeGreaterThan(0);
    const next = stepSpring(s, { x: 100, y: 100 }, 1 / 60);
    // Still moving right on the frame the target turned the corner.
    expect(next.x).toBeGreaterThan(s.x);
  });

  it("caps dt, so a long frame cannot fling the cursor past the target", () => {
    const s = stepSpring(springAt({ x: 0, y: 0 }), { x: 100, y: 0 }, 5);
    const capped = stepSpring(springAt({ x: 0, y: 0 }), { x: 100, y: 0 }, MAX_DT);
    expect(s).toEqual(capped);
  });

  it("is settled at rest on the target and not while moving", () => {
    expect(isSettled(springAt({ x: 5, y: 5 }), { x: 5, y: 5 }, 0.1)).toBe(true);
    expect(isSettled({ x: 5, y: 5, vx: 50, vy: 0 }, { x: 5, y: 5 }, 0.1)).toBe(false);
  });
});
