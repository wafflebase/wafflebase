/**
 * Critically damped spring for peer cursors (peer cursors v2,
 * docs/design/board/board-figjam-parity.md § Second pass B).
 *
 * A peer's position arrives at network rate (≤ 25 Hz). Jumping to each
 * sample teleports; a CSS transition restarts a straight line on every
 * update. A spring keeps its velocity across updates, so a curve the peer
 * drew stays a curve, and it settles without overshoot because it is
 * critically damped (damping = 2√k).
 *
 * Integrated in world coordinates: the local viewport can pan under a
 * moving cursor without disturbing it.
 */

export const SPRING_STIFFNESS = 480;
export const SPRING_DAMPING = 2 * Math.sqrt(SPRING_STIFFNESS);
/** dt is capped so a backgrounded tab does not fling the cursor. */
export const MAX_DT = 1 / 30;
/** Sub-step for stable semi-implicit Euler at ω≈22 rad/s. */
const SUB_DT = 1 / 240;

export interface SpringState {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface Point2 {
  x: number;
  y: number;
}

/** A spring at rest on `p`. */
export function springAt(p: Point2): SpringState {
  return { x: p.x, y: p.y, vx: 0, vy: 0 };
}

/** Advance `s` toward `target` by `dt` seconds (capped at {@link MAX_DT}). */
export function stepSpring(
  s: SpringState,
  target: Point2,
  dt: number,
): SpringState {
  let remaining = Math.min(Math.max(dt, 0), MAX_DT);
  let { x, y, vx, vy } = s;
  while (remaining > 0) {
    const h = Math.min(SUB_DT, remaining);
    remaining -= h;
    const ax = SPRING_STIFFNESS * (target.x - x) - SPRING_DAMPING * vx;
    const ay = SPRING_STIFFNESS * (target.y - y) - SPRING_DAMPING * vy;
    vx += ax * h;
    vy += ay * h;
    x += vx * h;
    y += vy * h;
  }
  return { x, y, vx, vy };
}

/**
 * Whether `s` has come to rest on `target`, within `tolerance` world
 * units of distance and `tolerance * 10` units/s of speed. The host
 * passes a tolerance scaled by 1 / zoom so "settled" means "less than a
 * fraction of a screen pixel".
 */
export function isSettled(
  s: SpringState,
  target: Point2,
  tolerance: number,
): boolean {
  return (
    Math.abs(target.x - s.x) < tolerance &&
    Math.abs(target.y - s.y) < tolerance &&
    Math.abs(s.vx) < tolerance * 10 &&
    Math.abs(s.vy) < tolerance * 10
  );
}
