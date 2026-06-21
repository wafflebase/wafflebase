// packages/slides/src/view/canvas/shapes/preset/formula.ts
//
// ECMA-376 DrawingML guide-formula evaluator. Each `<a:gd>` formula is
// reverse-Polish (`"op arg1 arg2 …"`); operands are guide names,
// built-in tokens, or numeric literals. Angles are in 60000ths of a
// degree (the DrawingML unit) throughout: a full circle is 21600000.
//
// References: ECMA-376 Part 1 §20.1.9.11 (guide formulas).

import type { FrameSize } from '../builder';
import type { PresetGuide, PresetShapeDef } from './types';

/** Full circle in DrawingML 60000ths of a degree. */
export const OOXML_CIRCLE = 21_600_000;

/** Convert a DrawingML angle (60000ths°) to radians. */
export function ooxmlAngleToRad(a: number): number {
  return (a / 60_000) * (Math.PI / 180);
}

/** Convert radians to a DrawingML angle (60000ths°). */
function radToOoxmlAngle(rad: number): number {
  return (rad * 180) / Math.PI * 60_000;
}

/**
 * A resolver maps a single guide token to its numeric value. Built
 * after a shape's guides are evaluated; used by the path interpreter
 * to read `pt`/`arcTo` attribute tokens.
 */
export type Resolver = (token: string) => number;

/**
 * Evaluate one RPN formula. Fixed-arity operators read only the
 * operands they need (a few spec formulas carry a redundant trailing
 * `0`, e.g. `"+- xH 0 dxB 0"`), so extra tokens are ignored.
 */
export function evalFormula(fmla: string, resolve: Resolver): number {
  const tok = fmla.trim().split(/\s+/);
  const op = tok[0];
  const a = (i: number) => resolve(tok[i + 1]);
  switch (op) {
    case 'val':
      return a(0);
    case '*/':
      return (a(0) * a(1)) / a(2);
    case '+-':
      return a(0) + a(1) - a(2);
    case '+/':
      return (a(0) + a(1)) / a(2);
    case '?:':
      return a(0) > 0 ? a(1) : a(2);
    case 'abs':
      return Math.abs(a(0));
    case 'sqrt':
      return Math.sqrt(a(0));
    case 'max':
      return Math.max(a(0), a(1));
    case 'min':
      return Math.min(a(0), a(1));
    case 'pin': {
      // pin lo val hi → clamp(val, lo, hi)
      const lo = a(0);
      const v = a(1);
      const hi = a(2);
      return v < lo ? lo : v > hi ? hi : v;
    }
    case 'mod':
      // 3-D vector magnitude: sqrt(x² + y² + z²).
      return Math.sqrt(a(0) * a(0) + a(1) * a(1) + a(2) * a(2));
    case 'sin':
      return a(0) * Math.sin(ooxmlAngleToRad(a(1)));
    case 'cos':
      return a(0) * Math.cos(ooxmlAngleToRad(a(1)));
    case 'tan':
      return a(0) * Math.tan(ooxmlAngleToRad(a(1)));
    case 'at2':
      // at2 x y → atan2(y, x), returned in 60000ths of a degree.
      return radToOoxmlAngle(Math.atan2(a(1), a(0)));
    case 'cat2':
      // cat2 x y z → x · cos(atan2(z, y))
      return a(0) * Math.cos(Math.atan2(a(2), a(1)));
    case 'sat2':
      // sat2 x y z → x · sin(atan2(z, y))
      return a(0) * Math.sin(Math.atan2(a(2), a(1)));
    default:
      throw new Error(`evalFormula: unknown operator "${op}" in "${fmla}"`);
  }
}

/**
 * Resolve a built-in token (frame dims, centres, fractional dims, and
 * angle constants) or numeric literal. Returns `undefined` if the
 * token is neither, so the caller can fall through to user guides.
 */
function resolveBuiltin(token: string, w: number, h: number): number | undefined {
  switch (token) {
    case 'w':
      return w;
    case 'h':
      return h;
    case 'ss':
      return Math.min(w, h);
    case 'ls':
      return Math.max(w, h);
    case 'l':
    case 't':
      return 0;
    case 'r':
      return w;
    case 'b':
      return h;
    case 'hc':
      return w / 2;
    case 'vc':
      return h / 2;
  }
  // Fractional dimensions: wd2, hd6, ssd8, … (base / N).
  const frac = /^(w|h|ss)d(\d+)$/.exec(token);
  if (frac) {
    const base = frac[1] === 'w' ? w : frac[1] === 'h' ? h : Math.min(w, h);
    const n = Number(frac[2]);
    return n === 0 ? 0 : base / n;
  }
  // Angle constants: cd2, cd4, cd8, 3cd4, 7cd8, … (m · circle / N).
  const ang = /^(\d*)cd(\d+)$/.exec(token);
  if (ang) {
    const m = ang[1] === '' ? 1 : Number(ang[1]);
    const n = Number(ang[2]);
    return n === 0 ? 0 : (m * OOXML_CIRCLE) / n;
  }
  // Numeric literal (incl. negatives like "-5400000").
  if (/^[+-]?\d+(\.\d+)?$/.test(token)) return Number(token);
  return undefined;
}

/**
 * Evaluate a preset shape's guide list against a frame size and the
 * element's adjustment array, returning a resolver over the full guide
 * namespace (built-ins + adjustments + computed guides).
 *
 * `adjustments[i]` overrides `adj{i+1}` (DrawingML names adjustments
 * `adj1`-based); a missing/short array falls back to `def.adj` defaults.
 */
export function evalGuides(
  { w, h }: FrameSize,
  def: PresetShapeDef,
  adjustments?: number[],
): Resolver {
  const env = new Map<string, number>();
  const resolve: Resolver = (token: string) => {
    if (token === undefined) {
      throw new Error('formula: missing operand');
    }
    const cached = env.get(token);
    if (cached !== undefined) return cached;
    const builtin = resolveBuiltin(token, w, h);
    if (builtin !== undefined) return builtin;
    throw new Error(`formula: unresolved token "${token}"`);
  };

  // Seed adjustments (defaults, then element overrides by index).
  const adjNames = Object.keys(def.adj);
  for (const name of adjNames) env.set(name, def.adj[name]);
  if (adjustments) {
    for (let i = 0; i < adjustments.length; i++) {
      const name = `adj${i + 1}`;
      if (name in def.adj && Number.isFinite(adjustments[i])) {
        env.set(name, adjustments[i]);
      }
    }
  }

  // Evaluate guides in order; later guides may shadow earlier ones
  // (a handful of circularArrow guide names are intentionally reused).
  for (const g of def.guides as PresetGuide[]) {
    env.set(g.name, evalFormula(g.fmla, resolve));
  }
  return resolve;
}
