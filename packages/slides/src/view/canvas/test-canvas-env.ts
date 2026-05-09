/**
 * Test-only shim that installs a minimal `OffscreenCanvas` on the
 * global object and patches `HTMLCanvasElement.prototype.getContext`
 * (when jsdom is active) so editor/renderer code that requests a real
 * canvas 2D context in tests gets a no-op stub instead of `null`.
 *
 * The docs `CanvasTextMeasurer` (which `text-renderer` instantiates at
 * module scope) calls `new OffscreenCanvas()` to acquire a 2D ctx for
 * measurement. jsdom does not implement `OffscreenCanvas`, so any test
 * that imports `text-renderer` (directly or transitively via
 * `element-renderer`) must install this shim BEFORE the renderer
 * module is loaded.
 *
 * Usage:
 *   // @vitest-environment jsdom
 *   import './test-canvas-env';
 *   const { drawText } = await import('./text-renderer');
 *
 * The dynamic-import dance ensures the shim is registered on `globalThis`
 * before the measurer's lazy `getCtx()` runs.
 *
 * `measureText` returns a deterministic `text.length * 8` width so
 * layout assertions stay stable across environments.
 */
class FakeOffscreenCanvas {
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext(type: string): unknown {
    if (type !== '2d') return null;
    return {
      font: '10px sans-serif',
      measureText(text: string): { width: number } {
        return { width: text.length * 8 };
      },
    };
  }
}

(globalThis as unknown as { OffscreenCanvas: typeof FakeOffscreenCanvas }).OffscreenCanvas =
  FakeOffscreenCanvas;

/**
 * Stub `HTMLCanvasElement.prototype.getContext('2d')` so jsdom-backed
 * tests can construct editors/renderers that need a real-ish 2D context.
 * The returned object is intentionally narrow — only the methods our
 * renderers actually call are present. Adding new renderer calls here
 * is fine; the goal is to keep test failures explicit (missing method
 * = test fails loudly) rather than silently no-op everything.
 */
function makeFakeCanvasCtx(): unknown {
  const noop = (): void => {};
  return {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    font: '10px sans-serif',
    textAlign: 'start' as CanvasTextAlign,
    textBaseline: 'alphabetic' as CanvasTextBaseline,
    globalAlpha: 1,

    save: noop,
    restore: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    setTransform: noop,

    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    ellipse: noop,
    rect: noop,

    fillRect: noop,
    strokeRect: noop,
    clearRect: noop,
    fill: noop,
    stroke: noop,

    fillText: noop,
    measureText: (text: string): { width: number } => ({ width: text.length * 8 }),

    drawImage: noop,
  };
}

if (typeof HTMLCanvasElement !== 'undefined') {
  // jsdom returns null from `getContext('2d')` because it has no canvas
  // backing. Patch the prototype so editor + renderer construction in
  // jsdom-backed tests succeeds. Only intercept the '2d' contextId; let
  // any other call fall through to jsdom's default behaviour.
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function patchedGetContext(
    this: HTMLCanvasElement,
    contextId: string,
    ...rest: unknown[]
  ): unknown {
    if (contextId === '2d') return makeFakeCanvasCtx();
    return (original as (this: HTMLCanvasElement, ...a: unknown[]) => unknown).call(
      this,
      contextId,
      ...rest,
    );
  } as HTMLCanvasElement['getContext'];
}

/**
 * Lightweight `Path2D` + `isPointInPath` stand-in for the slides shape
 * builder tests. Node and jsdom do not ship a real Path2D, so without
 * this we cannot hit-test builder output.
 *
 * The shim records the subset of Path2D operations our path builders
 * use (`rect`, `ellipse`, `moveTo`, `lineTo`, `closePath`,
 * `quadraticCurveTo`, `bezierCurveTo`, `arc`) and answers
 * `isPointInPath(path, x, y, fillRule)` by walking those ops. Curves
 * and arcs are approximated as polyline segments appended to the
 * current subpath — accurate enough for the inside/outside reference
 * points in the per-shape tests, which are chosen well clear of the
 * boundary.
 *
 * Edges are inclusive — matching browser `isPointInPath` behaviour for
 * straight rectangle borders, and tolerable for ellipses since tests
 * pick interior/exterior points well clear of the boundary.
 *
 * For `evenodd` fill rule (used by `donut`), each op's hit test is
 * counted independently, and the point is "inside" iff the total hit
 * count is odd. A counter-clockwise inner ellipse therefore "punches"
 * a hole in an outer ellipse.
 */
type Op =
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | {
      kind: 'ellipse';
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      rotation: number;
      ccw: boolean;
    }
  | { kind: 'subpath'; points: Array<{ x: number; y: number }>; closed: boolean };

const QUAD_STEPS = 8;
const CUBIC_STEPS = 16;
const ARC_STEPS = 32;

class TestPath2D {
  readonly ops: Op[] = [];
  private current: { x: number; y: number }[] | null = null;

  rect(x: number, y: number, w: number, h: number): void {
    this.flushSubpath();
    this.ops.push({ kind: 'rect', x, y, w, h });
  }

  ellipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    rotation: number,
    _start: number,
    _end: number,
    ccw?: boolean,
  ): void {
    this.flushSubpath();
    this.ops.push({ kind: 'ellipse', cx, cy, rx, ry, rotation, ccw: !!ccw });
  }

  moveTo(x: number, y: number): void {
    this.flushSubpath();
    this.current = [{ x, y }];
  }

  lineTo(x: number, y: number): void {
    if (!this.current) this.current = [];
    this.current.push({ x, y });
  }

  /**
   * Approximate a quadratic Bezier as `QUAD_STEPS` line segments along
   * the De Casteljau curve. Appends to the current subpath; if there is
   * no current subpath, starts one at the control point's projected
   * origin (matching browser behaviour where the path begins implicitly
   * at the control's start).
   */
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
    if (!this.current || this.current.length === 0) this.current = [{ x: cpx, y: cpy }];
    const last = this.current[this.current.length - 1];
    const x0 = last.x;
    const y0 = last.y;
    for (let i = 1; i <= QUAD_STEPS; i++) {
      const t = i / QUAD_STEPS;
      const omt = 1 - t;
      const px = omt * omt * x0 + 2 * omt * t * cpx + t * t * x;
      const py = omt * omt * y0 + 2 * omt * t * cpy + t * t * y;
      this.current.push({ x: px, y: py });
    }
  }

  /**
   * Approximate a cubic Bezier as `CUBIC_STEPS` line segments.
   */
  bezierCurveTo(
    cp1x: number,
    cp1y: number,
    cp2x: number,
    cp2y: number,
    x: number,
    y: number,
  ): void {
    if (!this.current || this.current.length === 0) this.current = [{ x: cp1x, y: cp1y }];
    const last = this.current[this.current.length - 1];
    const x0 = last.x;
    const y0 = last.y;
    for (let i = 1; i <= CUBIC_STEPS; i++) {
      const t = i / CUBIC_STEPS;
      const omt = 1 - t;
      const b0 = omt * omt * omt;
      const b1 = 3 * omt * omt * t;
      const b2 = 3 * omt * t * t;
      const b3 = t * t * t;
      const px = b0 * x0 + b1 * cp1x + b2 * cp2x + b3 * x;
      const py = b0 * y0 + b1 * cp1y + b2 * cp2y + b3 * y;
      this.current.push({ x: px, y: py });
    }
  }

  /**
   * Approximate `arc()` by appending polyline segments along the arc
   * to the current subpath. A full circle (start=0, end=2π) is also
   * recorded as an ellipse op so single-circle paths (e.g. cloud
   * lobes) work even when the path otherwise contains only arc()
   * calls without a moveTo.
   */
  arc(
    cx: number,
    cy: number,
    r: number,
    startAngle: number,
    endAngle: number,
    counterclockwise?: boolean,
  ): void {
    const fullCircle =
      Math.abs(endAngle - startAngle) >= Math.PI * 2 - 1e-9 ||
      (startAngle === 0 && endAngle === Math.PI * 2);
    if (fullCircle) {
      // Record the circle as an ellipse op so its interior is hit-
      // tested even if no surrounding subpath exists.
      this.flushSubpath();
      this.ops.push({
        kind: 'ellipse',
        cx,
        cy,
        rx: r,
        ry: r,
        rotation: 0,
        ccw: !!counterclockwise,
      });
      return;
    }
    if (!this.current) this.current = [];
    let a0 = startAngle;
    let a1 = endAngle;
    if (counterclockwise) {
      while (a1 > a0) a1 -= Math.PI * 2;
    } else {
      while (a1 < a0) a1 += Math.PI * 2;
    }
    for (let i = 0; i <= ARC_STEPS; i++) {
      const t = i / ARC_STEPS;
      const a = a0 + (a1 - a0) * t;
      const px = cx + r * Math.cos(a);
      const py = cy + r * Math.sin(a);
      this.current.push({ x: px, y: py });
    }
  }

  closePath(): void {
    if (this.current) {
      this.ops.push({ kind: 'subpath', points: this.current, closed: true });
      this.current = null;
    }
  }

  private flushSubpath(): void {
    if (this.current && this.current.length > 0) {
      this.ops.push({ kind: 'subpath', points: this.current, closed: false });
    }
    this.current = null;
  }

  finalize(): void {
    this.flushSubpath();
  }
}

function pointInRect(op: Extract<Op, { kind: 'rect' }>, x: number, y: number): boolean {
  return x >= op.x && x <= op.x + op.w && y >= op.y && y <= op.y + op.h;
}

function pointInEllipse(
  op: Extract<Op, { kind: 'ellipse' }>,
  x: number,
  y: number,
): boolean {
  // Phase-1 builders use `rotation: 0`; the simple non-rotated form is
  // sufficient. Add rotated handling only when a builder needs it.
  const dx = (x - op.cx) / op.rx;
  const dy = (y - op.cy) / op.ry;
  return dx * dx + dy * dy <= 1;
}

function pointInPolygon(points: Array<{ x: number; y: number }>, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const pi = points[i];
    const pj = points[j];
    const intersect =
      pi.y > y !== pj.y > y &&
      x < ((pj.x - pi.x) * (y - pi.y)) / (pj.y - pi.y || Number.EPSILON) + pi.x;
    if (intersect) inside = !inside;
  }
  return inside;
}

function opHits(op: Op, x: number, y: number): boolean {
  if (op.kind === 'rect') return pointInRect(op, x, y);
  if (op.kind === 'ellipse') return pointInEllipse(op, x, y);
  if (op.kind === 'subpath' && op.points.length >= 3) return pointInPolygon(op.points, x, y);
  return false;
}

type FillRule = 'nonzero' | 'evenodd';

function isPointInPathImpl(
  path: TestPath2D,
  x: number,
  y: number,
  fillRule: FillRule = 'nonzero',
): boolean {
  path.finalize();
  if (fillRule === 'evenodd') {
    let count = 0;
    for (const op of path.ops) {
      if (opHits(op, x, y)) count++;
    }
    return count % 2 === 1;
  }
  for (const op of path.ops) {
    if (opHits(op, x, y)) return true;
  }
  return false;
}

// Install the global Path2D shim (idempotent). Builders call
// `new Path2D()` at module load time, so the global must be in place
// before any builder module is imported.
if (typeof (globalThis as { Path2D?: unknown }).Path2D === 'undefined') {
  (globalThis as unknown as { Path2D: typeof TestPath2D }).Path2D = TestPath2D;
}

/**
 * Test-only canvas factory. Returns an object whose
 * `getContext('2d')` provides the narrow surface shape builder tests
 * need: `isPointInPath(path, x, y)`. Width/height are accepted for
 * symmetry with the browser API but are not used.
 */
export function createTestCanvas(
  width: number,
  height: number,
): {
  width: number;
  height: number;
  getContext(type: '2d'): {
    isPointInPath(path: Path2D, x: number, y: number, fillRule?: FillRule): boolean;
  };
} {
  return {
    width,
    height,
    getContext(type: '2d') {
      if (type !== '2d') throw new Error(`unsupported context type: ${type}`);
      return {
        isPointInPath(
          path: Path2D,
          x: number,
          y: number,
          fillRule: FillRule = 'nonzero',
        ): boolean {
          return isPointInPathImpl(path as unknown as TestPath2D, x, y, fillRule);
        },
      };
    },
  };
}
