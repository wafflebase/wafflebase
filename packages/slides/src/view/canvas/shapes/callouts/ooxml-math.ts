// packages/slides/src/view/canvas/shapes/callouts/ooxml-math.ts
//
// Tiny transcriptions of the ECMA-376 DrawingML "guide formula"
// operators used by the preset `gdLst` definitions. Having these as
// named helpers lets each callout builder port its OOXML guides almost
// line-for-line, which keeps the geometry faithful and the diffs against
// `presetShapeDefinitions.xml` auditable.
//
// The trivial arithmetic operators map directly to JS and are inlined in
// the builders rather than wrapped here:
//   `*/ a b c`  → a * b / c
//   `+- a b c`  → a + b - c
//   `+/ a b c`  → (a + b) / c
//   `abs x`     → Math.abs(x)
//   `min/max`   → Math.min / Math.max

/**
 * OOXML `pin lo x hi` — clamp `x` into `[lo, hi]`. Assumes `lo <= hi`
 * (every preset that uses `pin` derives `hi` so this holds).
 */
export function pin(lo: number, x: number, hi: number): number {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

/**
 * OOXML `?: x a b` — the ternary guide operator: `x > 0 ? a : b`.
 * (DrawingML tests strictly greater than zero.)
 */
export function ifPos(x: number, a: number, b: number): number {
  return x > 0 ? a : b;
}

/** OOXML `cat2 c x y` — cosine-arctangent: `c * cos(atan2(y, x))`. */
export function cat2(c: number, x: number, y: number): number {
  return c * Math.cos(Math.atan2(y, x));
}

/** OOXML `sat2 c x y` — sine-arctangent: `c * sin(atan2(y, x))`. */
export function sat2(c: number, x: number, y: number): number {
  return c * Math.sin(Math.atan2(y, x));
}

/** OOXML `mod x y z` — 3-D vector magnitude `sqrt(x²+y²+z²)`. */
export function mod3(x: number, y: number, z: number): number {
  return Math.sqrt(x * x + y * y + z * z);
}

/** DrawingML angle unit: 60000ths of a degree. */
export const CD4 = 5400000; // 90°
export const CD2 = 10800000; // 180°
export const CD3_4 = 16200000; // 270°
export const FULL_ANGLE = 21600000; // 360°

/** 60000ths-of-a-degree → radians. */
export function deg60kToRad(a: number): number {
  return (a / 60000) * (Math.PI / 180);
}

/** Radians → 60000ths-of-a-degree (DrawingML angle unit). */
export function radToDeg60k(r: number): number {
  return r * (180 / Math.PI) * 60000;
}

/**
 * Append one OOXML `<arcTo>` to `path`, mirroring the preset semantics:
 * the current point lies on the ellipse `(wR, hR)` at `stAng`, the arc
 * sweeps `swAng` (both in 60000ths of a degree, OOXML's clockwise / y-down
 * convention). Returns the new current point so callers can chain.
 *
 * Centre is derived from the current point so successive arcs/lines join
 * exactly, the same construction `basic/cloud.ts` uses.
 */
export function arcTo(
  path: Path2D,
  cur: { x: number; y: number },
  wR: number,
  hR: number,
  stAng: number,
  swAng: number,
): { x: number; y: number } {
  const st = deg60kToRad(stAng);
  const en = deg60kToRad(stAng + swAng);
  const cx = cur.x - wR * Math.cos(st);
  const cy = cur.y - hR * Math.sin(st);
  path.ellipse(cx, cy, wR, hR, 0, st, en, swAng < 0);
  return { x: cx + wR * Math.cos(en), y: cy + hR * Math.sin(en) };
}
