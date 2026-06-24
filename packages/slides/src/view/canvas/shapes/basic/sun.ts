import type {
  AdjustmentHandle,
  AdjustmentSpec,
  PathBuilder,
} from '../builder';
import { adj } from '../builder';
import { insetAlongAxis } from '../handles';

/**
 * `sun` — a central disc with 8 discrete triangular rays at
 * 0/45/90/.../315 degrees, matching the ECMA-376 OOXML `sun` preset.
 * Each ray is its own sub-path and the disc is a separate sub-path; the
 * whole shape is one Path2D filled with the nonzero rule.
 *
 * `adj` (OOXML "adj") controls the disc radius — `g0 = 50000 - adj` is
 * the radius as thousandths of half-width, so larger `adj` → smaller
 * disc and longer rays. The default 25000 yields a disc of radius w/4.
 * The geometry below is a direct decode of the preset's `gdLst`
 * (evaluated for w = h, since the frame ellipse is assumed circular for
 * the radial ray layout).
 */
export const SUN_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  {
    name: 'Ray length',
    defaultValue: 25000,
    min: 12500,
    max: 46875,
  },
];

function pin(lo: number, v: number, hi: number): number {
  return Math.max(lo, Math.min(v, hi));
}

export const buildSun: PathBuilder = ({ w, h }, adjustments) => {
  const a = pin(12500, adj(adjustments, 0, 25000), 46875);

  // OOXML gdLst decode (thousandths of w/h).
  const g0 = 50000 - a;
  const g1 = (g0 * 30274) / 32768;
  const g2 = (g0 * 12540) / 32768;
  const g5 = 50000 - g1;
  const g6 = 50000 - g2;
  const g10 = (g5 * 3) / 4;
  const g11 = (g6 * 3) / 4;
  const g12 = g10 + 3662;
  const g13 = g11 + 3662;
  const g14 = g11 + 12500;
  const g15 = 100000 - g10;
  const g16 = 100000 - g12;
  const g17 = 100000 - g13;
  const g18 = 100000 - g14;

  const X = (g: number) => (w * g) / 100000;
  const Y = (g: number) => (h * g) / 100000;

  // Diagonal-ray apex anchors (OOXML ox1/oy1/ox2/oy2).
  const ox1 = (w * 18436) / 21600;
  const oy1 = (h * 3163) / 21600;
  const ox2 = (w * 3163) / 21600;
  const oy2 = (h * 18436) / 21600;

  const x10 = X(g10);
  const x12 = X(g12);
  const x13 = X(g13);
  const x14 = X(g14);
  const x15 = X(g15);
  const x16 = X(g16);
  const x17 = X(g17);
  const x18 = X(g18);
  const x19 = X(a);

  const y10 = Y(g10);
  const y12 = Y(g12);
  const y13 = Y(g13);
  const y14 = Y(g14);
  const y15 = Y(g15);
  const y16 = Y(g16);
  const y17 = Y(g17);
  const y18 = Y(g18);

  const wR = (w * g0) / 100000;
  const hR = (h * g0) / 100000;

  const hc = w / 2;
  const vc = h / 2;
  const l = 0;
  const t = 0;
  const r = w;
  const b = h;

  // Each ray is a discrete triangle sub-path (apex first), matching the
  // OOXML pathLst (E, NE, N, NW, W, SW, S, SE).
  const rays: ReadonlyArray<readonly [number, number][]> = [
    [
      [r, vc],
      [x15, y18],
      [x15, y14],
    ],
    [
      [ox1, oy1],
      [x16, y13],
      [x17, y12],
    ],
    [
      [hc, t],
      [x18, y10],
      [x14, y10],
    ],
    [
      [ox2, oy1],
      [x13, y12],
      [x12, y13],
    ],
    [
      [l, vc],
      [x10, y14],
      [x10, y18],
    ],
    [
      [ox2, oy2],
      [x12, y17],
      [x13, y16],
    ],
    [
      [hc, b],
      [x14, y15],
      [x18, y15],
    ],
    [
      [ox1, oy2],
      [x17, y16],
      [x16, y17],
    ],
  ];

  const path = new Path2D();
  for (const tri of rays) {
    path.moveTo(tri[0][0], tri[0][1]);
    path.lineTo(tri[1][0], tri[1][1]);
    path.lineTo(tri[2][0], tri[2][1]);
    path.closePath();
  }

  // Central disc — separate sub-path. The OOXML path starts at
  // (x19, vc) — the leftmost point of the disc — and sweeps a full
  // circle. `ellipse` centred at (hc, vc) with radii (wR, hR) is the
  // direct equivalent.
  path.moveTo(x19, vc);
  path.ellipse(hc, vc, wR, hR, 0, Math.PI, 3 * Math.PI);
  path.closePath();

  return path;
};

export const SUN_HANDLES: readonly AdjustmentHandle[] = [
  {
    position: ({ w, h }, adjustments) => {
      // Clamp to the spec's [min..max] so the handle uses the same
      // disc radius the builder pins via `pin(12500, a, 46875)`; an
      // out-of-range stored adj would otherwise paint the handle off
      // the actual disc edge.
      const spec = SUN_ADJUSTMENTS[0];
      const a = pin(spec.min, adjustments[0] ?? spec.defaultValue, spec.max);
      // Disc radius along +x: wR = (50000 - a) / 100000 * w.
      const wR = ((50000 - a) / 100000) * w;
      return {
        x: insetAlongAxis(w / 2 + wR, w),
        y: insetAlongAxis(h / 2, h),
      };
    },
    apply: ({ w }, start, pointer) => {
      // pointer at distance r from centre on +x axis → disc radius = r;
      // wR = (50000 - a)/100000 * w  ⇒  a = 50000 - 100000 * r / w.
      if (w <= 0) return [...start];
      const r = Math.max(0, pointer.x - w / 2);
      const raw = Math.round(50000 - (100000 * r) / w);
      const spec = SUN_ADJUSTMENTS[0];
      const clamped = Math.max(spec.min, Math.min(spec.max, raw));
      const result = [...start];
      result[0] = clamped;
      return result;
    },
  },
];
