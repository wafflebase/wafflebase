// packages/slides/src/view/canvas/shapes/arrows/curved.ts
//
// The four directional curved arrows (curvedRightArrow, curvedLeftArrow,
// curvedUpArrow, curvedDownArrow), faithful to the ECMA-376 presets.
// Each preset is a curved shaft swept along a stretched ellipse ending
// in a flared triangular arrowhead, and is drawn as TWO fill subpaths
// (the second is PowerPoint's `darkenLess` 3D shade, but it carries real
// silhouette geometry). Rather than hand-port each shape's ~30 guide
// formulas, we transcribe the OOXML guide list + path verbatim as data
// and evaluate it with a tiny DrawingML interpreter — the same geometry
// PowerPoint/Google Slides render.

import type {
  AdjustmentHandle,
  AdjustmentSpec,
  FrameSize,
  PathBuilder,
  Point,
} from '../builder';
import { adj } from '../builder';

export type CurvedDirection = 'right' | 'left' | 'up' | 'down';

// OOXML adjustments: adj1 = shaft thickness, adj2 = arrow (head) width,
// adj3 = arrowhead length. All in thousandths of `ss = min(w, h)`.
export const CURVED_ARROW_ADJUSTMENTS: readonly AdjustmentSpec[] = [
  { name: 'Shaft thickness', defaultValue: 25000, min: 0, max: 50000 },
  { name: 'Arrow width', defaultValue: 50000, min: 0, max: 50000 },
  { name: 'Head length', defaultValue: 25000, min: 0, max: 50000 },
];

const DEG = Math.PI / 180;

// --- tiny DrawingML guide evaluator -----------------------------------

type Env = Record<string, number>;

function evalFmla(fmla: string, env: Env): number {
  const parts = fmla.split(/\s+/);
  const op = parts[0];
  const a = parts.slice(1).map((t) => {
    if (t in env) return env[t];
    const n = Number(t);
    return Number.isNaN(n) ? 0 : n;
  });
  switch (op) {
    case 'val':
      return a[0];
    case '*/':
      return a[2] ? (a[0] * a[1]) / a[2] : 0;
    case '+-':
      return a[0] + a[1] - a[2];
    case '+/':
      return a[2] ? (a[0] + a[1]) / a[2] : 0;
    case 'pin':
      return Math.max(a[0], Math.min(a[1], a[2]));
    case 'sqrt':
      return a[0] > 0 ? Math.sqrt(a[0]) : 0;
    case 'at2':
      // OOXML `at2 x y` = atan2(y, x) in 60000ths of a degree.
      return (Math.atan2(a[1], a[0]) / DEG) * 60000;
    case 'min':
      return Math.min(a[0], a[1]);
    case 'max':
      return Math.max(a[0], a[1]);
    default:
      return 0;
  }
}

function buildEnv(
  w: number,
  h: number,
  adjustments: number[] | undefined,
  guides: ReadonlyArray<readonly [string, string]>,
): Env {
  const env: Env = {
    w,
    h,
    ss: Math.min(w, h),
    wd2: w / 2,
    hd2: h / 2,
    l: 0,
    t: 0,
    r: w,
    b: h,
    cd2: 10800000,
    cd4: 5400000,
    '3cd4': 16200000,
    adj1: adj(adjustments, 0, 25000),
    adj2: adj(adjustments, 1, 50000),
    adj3: adj(adjustments, 2, 25000),
  };
  for (const [name, fmla] of guides) env[name] = evalFmla(fmla, env);
  return env;
}

type Cmd =
  | readonly ['M', string, string]
  | readonly ['L', string, string]
  | readonly ['A', string, string, string, string]; // wR, hR, stAng, swAng

function appendArc(
  pts: Point[],
  cur: Point,
  wR: number,
  hR: number,
  stDeg: number,
  swDeg: number,
  segments = 24,
): Point {
  const st = stDeg * DEG;
  const sw = swDeg * DEG;
  const cx = cur.x - wR * Math.cos(st);
  const cy = cur.y - hR * Math.sin(st);
  let end = cur;
  for (let i = 1; i <= segments; i++) {
    const ang = st + sw * (i / segments);
    end = { x: cx + wR * Math.cos(ang), y: cy + hR * Math.sin(ang) };
    pts.push(end);
  }
  return end;
}

function runPath(cmds: ReadonlyArray<Cmd>, env: Env): Point[] {
  const pts: Point[] = [];
  let cur: Point = { x: 0, y: 0 };
  const v = (n: string): number => (n in env ? env[n] : Number(n) || 0);
  for (const cmd of cmds) {
    if (cmd[0] === 'M') {
      cur = { x: v(cmd[1]), y: v(cmd[2]) };
      pts.push(cur);
    } else if (cmd[0] === 'L') {
      cur = { x: v(cmd[1]), y: v(cmd[2]) };
      pts.push(cur);
    } else {
      cur = appendArc(
        pts,
        cur,
        v(cmd[1]),
        v(cmd[2]),
        v(cmd[3]) / 60000, // OOXML angle (60000ths) → degrees
        v(cmd[4]) / 60000,
      );
    }
  }
  return pts;
}

interface ShapeDef {
  guides: ReadonlyArray<readonly [string, string]>;
  paths: ReadonlyArray<ReadonlyArray<Cmd>>;
}

// --- per-direction OOXML definitions (transcribed verbatim) -----------

const RIGHT: ShapeDef = {
  guides: [
    ['maxAdj2', '*/ 50000 h ss'], ['a2', 'pin 0 adj2 maxAdj2'],
    ['a1', 'pin 0 adj1 a2'], ['th', '*/ ss a1 100000'], ['aw', '*/ ss a2 100000'],
    ['q1', '+/ th aw 4'], ['hR', '+- hd2 0 q1'], ['q7', '*/ hR 2 1'],
    ['q8', '*/ q7 q7 1'], ['q9', '*/ th th 1'], ['q10', '+- q8 0 q9'],
    ['q11', 'sqrt q10'], ['idx', '*/ q11 w q7'], ['maxAdj3', '*/ 100000 idx ss'],
    ['a3', 'pin 0 adj3 maxAdj3'], ['ah', '*/ ss a3 100000'], ['y3', '+- hR th 0'],
    ['q2', '*/ w w 1'], ['q3', '*/ ah ah 1'], ['q4', '+- q2 0 q3'], ['q5', 'sqrt q4'],
    ['dy', '*/ q5 hR w'], ['y5', '+- hR dy 0'], ['y7', '+- y3 dy 0'],
    ['q6', '+- aw 0 th'], ['dh', '*/ q6 1 2'], ['y4', '+- y5 0 dh'],
    ['y8', '+- y7 dh 0'], ['aw2', '*/ aw 1 2'], ['y6', '+- b 0 aw2'],
    ['x1', '+- r 0 ah'], ['swAng', 'at2 ah dy'], ['stAng', '+- cd2 0 swAng'],
    ['mswAng', '+- 0 0 swAng'], ['q12', '*/ th 1 2'], ['dang2', 'at2 idx q12'],
    ['swAng2', '+- dang2 0 cd4'], ['swAng3', '+- cd4 dang2 0'], ['stAng3', '+- cd2 0 dang2'],
  ],
  paths: [
    [['M', 'l', 'hR'], ['A', 'w', 'hR', 'cd2', 'mswAng'], ['L', 'x1', 'y4'],
      ['L', 'r', 'y6'], ['L', 'x1', 'y8'], ['L', 'x1', 'y7'], ['A', 'w', 'hR', 'stAng', 'swAng']],
    [['M', 'r', 'th'], ['A', 'w', 'hR', '3cd4', 'swAng2'], ['A', 'w', 'hR', 'stAng3', 'swAng3']],
  ],
};

const LEFT: ShapeDef = {
  guides: [
    ['maxAdj2', '*/ 50000 h ss'], ['a2', 'pin 0 adj2 maxAdj2'], ['a1', 'pin 0 adj1 a2'],
    ['th', '*/ ss a1 100000'], ['aw', '*/ ss a2 100000'], ['q1', '+/ th aw 4'],
    ['hR', '+- hd2 0 q1'], ['q7', '*/ hR 2 1'], ['q8', '*/ q7 q7 1'], ['q9', '*/ th th 1'],
    ['q10', '+- q8 0 q9'], ['q11', 'sqrt q10'], ['idx', '*/ q11 w q7'],
    ['maxAdj3', '*/ 100000 idx ss'], ['a3', 'pin 0 adj3 maxAdj3'], ['ah', '*/ ss a3 100000'],
    ['y3', '+- hR th 0'], ['q2', '*/ w w 1'], ['q3', '*/ ah ah 1'], ['q4', '+- q2 0 q3'],
    ['q5', 'sqrt q4'], ['dy', '*/ q5 hR w'], ['y5', '+- hR dy 0'], ['y7', '+- y3 dy 0'],
    ['q6', '+- aw 0 th'], ['dh', '*/ q6 1 2'], ['y4', '+- y5 0 dh'], ['y8', '+- y7 dh 0'],
    ['aw2', '*/ aw 1 2'], ['y6', '+- b 0 aw2'], ['x1', '+- l ah 0'], ['swAng', 'at2 ah dy'],
    ['q12', '*/ th 1 2'], ['dang2', 'at2 idx q12'], ['swAng2', '+- dang2 0 swAng'],
    ['swAng3', '+- swAng dang2 0'], ['stAng3', '+- 0 0 dang2'],
  ],
  paths: [
    [['M', 'l', 'y6'], ['L', 'x1', 'y4'], ['L', 'x1', 'y5'], ['A', 'w', 'hR', 'swAng', 'swAng2'],
      ['A', 'w', 'hR', 'stAng3', 'swAng3'], ['L', 'x1', 'y8']],
    [['M', 'r', 'y3'], ['A', 'w', 'hR', '0', '-5400000'], ['L', 'l', 't'],
      ['A', 'w', 'hR', '3cd4', 'cd4']],
  ],
};

const UP: ShapeDef = {
  guides: [
    ['maxAdj2', '*/ 50000 w ss'], ['a2', 'pin 0 adj2 maxAdj2'], ['a1', 'pin 0 adj1 100000'],
    ['th', '*/ ss a1 100000'], ['aw', '*/ ss a2 100000'], ['q1', '+/ th aw 4'],
    ['wR', '+- wd2 0 q1'], ['q7', '*/ wR 2 1'], ['q8', '*/ q7 q7 1'], ['q9', '*/ th th 1'],
    ['q10', '+- q8 0 q9'], ['q11', 'sqrt q10'], ['idy', '*/ q11 h q7'],
    ['maxAdj3', '*/ 100000 idy ss'], ['a3', 'pin 0 adj3 maxAdj3'], ['ah', '*/ ss adj3 100000'],
    ['x3', '+- wR th 0'], ['q2', '*/ h h 1'], ['q3', '*/ ah ah 1'], ['q4', '+- q2 0 q3'],
    ['q5', 'sqrt q4'], ['dx', '*/ q5 wR h'], ['x5', '+- wR dx 0'], ['x7', '+- x3 dx 0'],
    ['q6', '+- aw 0 th'], ['dh', '*/ q6 1 2'], ['x4', '+- x5 0 dh'], ['x8', '+- x7 dh 0'],
    ['aw2', '*/ aw 1 2'], ['x6', '+- r 0 aw2'], ['y1', '+- t ah 0'], ['swAng', 'at2 ah dx'],
    ['q12', '*/ th 1 2'], ['dang2', 'at2 idy q12'], ['swAng2', '+- dang2 0 swAng'],
    ['stAng3', '+- cd4 0 swAng'], ['swAng3', '+- swAng dang2 0'], ['stAng2', '+- cd4 0 dang2'],
  ],
  paths: [
    [['M', 'x6', 't'], ['L', 'x8', 'y1'], ['L', 'x7', 'y1'], ['A', 'wR', 'h', 'stAng3', 'swAng3'],
      ['A', 'wR', 'h', 'stAng2', 'swAng2'], ['L', 'x4', 'y1']],
    [['M', 'wR', 'b'], ['A', 'wR', 'h', 'cd4', 'cd4'], ['L', 'th', 't'],
      ['A', 'wR', 'h', 'cd2', '-5400000']],
  ],
};

const DOWN: ShapeDef = {
  guides: [
    ['maxAdj2', '*/ 50000 w ss'], ['a2', 'pin 0 adj2 maxAdj2'], ['a1', 'pin 0 adj1 100000'],
    ['th', '*/ ss a1 100000'], ['aw', '*/ ss a2 100000'], ['q1', '+/ th aw 4'],
    ['wR', '+- wd2 0 q1'], ['q7', '*/ wR 2 1'], ['q8', '*/ q7 q7 1'], ['q9', '*/ th th 1'],
    ['q10', '+- q8 0 q9'], ['q11', 'sqrt q10'], ['idy', '*/ q11 h q7'],
    ['maxAdj3', '*/ 100000 idy ss'], ['a3', 'pin 0 adj3 maxAdj3'], ['ah', '*/ ss adj3 100000'],
    ['x3', '+- wR th 0'], ['q2', '*/ h h 1'], ['q3', '*/ ah ah 1'], ['q4', '+- q2 0 q3'],
    ['q5', 'sqrt q4'], ['dx', '*/ q5 wR h'], ['x5', '+- wR dx 0'], ['x7', '+- x3 dx 0'],
    ['q6', '+- aw 0 th'], ['dh', '*/ q6 1 2'], ['x4', '+- x5 0 dh'], ['x8', '+- x7 dh 0'],
    ['aw2', '*/ aw 1 2'], ['x6', '+- r 0 aw2'], ['y1', '+- b 0 ah'], ['swAng', 'at2 ah dx'],
    ['iy', '+- b 0 idy'], ['ix', '+/ wR x3 2'], ['q12', '*/ th 1 2'], ['dang2', 'at2 idy q12'],
    ['stAng', '+- 3cd4 swAng 0'], ['stAng2', '+- 3cd4 0 dang2'], ['swAng2', '+- dang2 0 cd4'],
    ['swAng3', '+- cd4 dang2 0'], ['mswAng', '+- 0 0 swAng'],
  ],
  paths: [
    [['M', 'x6', 'b'], ['L', 'x4', 'y1'], ['L', 'x5', 'y1'], ['A', 'wR', 'h', 'stAng', 'mswAng'],
      ['L', 'x3', 't'], ['A', 'wR', 'h', '3cd4', 'swAng'], ['L', 'x8', 'y1']],
    [['M', 'ix', 'iy'], ['A', 'wR', 'h', 'stAng2', 'swAng2'], ['L', 'l', 'b'],
      ['A', 'wR', 'h', 'cd2', 'swAng3']],
  ],
};

const DEFS: Record<CurvedDirection, ShapeDef> = {
  right: RIGHT,
  left: LEFT,
  up: UP,
  down: DOWN,
};

export function buildCurvedArrow(
  direction: CurvedDirection,
  size: FrameSize,
  adjustments?: number[],
): Path2D {
  const def = DEFS[direction];
  const env = buildEnv(size.w, size.h, adjustments, def.guides);
  const path = new Path2D();
  for (const cmds of def.paths) {
    const pts = runPath(cmds, env);
    if (pts.length === 0) continue;
    path.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) path.lineTo(pts[i].x, pts[i].y);
    path.closePath();
  }
  return path;
}

export function makeCurvedArrowBuilder(direction: CurvedDirection): PathBuilder {
  return (size, adjustments) => buildCurvedArrow(direction, size, adjustments);
}

// Adjustment handle: dragging the arrowhead tip in/out widens the head
// (adj2). One handle per shape satisfies the registry contract.
function tip(direction: CurvedDirection, { w, h }: FrameSize): Point {
  switch (direction) {
    case 'right':
      return { x: w, y: h / 2 };
    case 'left':
      return { x: 0, y: h / 2 };
    case 'down':
      return { x: w / 2, y: h };
    case 'up':
      return { x: w / 2, y: 0 };
  }
}

export function curvedArrowHandles(
  direction: CurvedDirection,
): readonly AdjustmentHandle[] {
  const horizontal = direction === 'right' || direction === 'left';
  return [
    {
      position: (size, adjustments) => {
        const ss = Math.min(size.w, size.h);
        const aw = ((adjustments[1] ?? 50000) / 100000) * ss;
        const t = tip(direction, size);
        if (direction === 'right') return { x: size.w - aw / 2, y: t.y };
        if (direction === 'left') return { x: aw / 2, y: t.y };
        if (direction === 'down') return { x: t.x, y: size.h - aw / 2 };
        return { x: t.x, y: aw / 2 };
      },
      apply: (size, start, pointer) => {
        const ss = Math.min(size.w, size.h);
        const t = tip(direction, size);
        const dist = horizontal
          ? Math.abs(t.x - pointer.x)
          : Math.abs(t.y - pointer.y);
        const raw = ss > 0 ? Math.round((dist / ss) * 200000) : 50000;
        const spec = CURVED_ARROW_ADJUSTMENTS[1];
        return [
          start[0] ?? 25000,
          Math.max(spec.min, Math.min(spec.max, raw)),
          start[2] ?? 25000,
        ];
      },
    },
  ];
}
