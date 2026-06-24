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
    transform: noop,

    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    ellipse: noop,
    rect: noop,

    // Table borders draw dashed segments; the renderer toggles the dash
    // pattern around each stroke. jsdom has neither method.
    setLineDash: noop,
    getLineDash: (): number[] => [],

    fillRect: noop,
    strokeRect: noop,
    clearRect: noop,
    fill: noop,
    stroke: noop,

    fillText: noop,
    measureText: (text: string): { width: number } => ({ width: text.length * 8 }),

    drawImage: noop,

    // The slides editor calls `isPointInPath` from its click hit-test
    // (`view/editor/element-hit.ts`). Real browser canvases provide it;
    // jsdom does not, so route through the same Path2D shim used by
    // `createTestCanvas` so editor.test.ts can dispatch pointerdown
    // events without crashing.
    isPointInPath(
      path: Path2D,
      x: number,
      y: number,
      fillRule: FillRule = 'nonzero',
    ): boolean {
      return isPointInPathImpl(path as unknown as TestPath2D, x, y, fillRule);
    },
    // The hit-test also falls back to `isPointInStroke` for clicks
    // near a stroked outline (heart, smileyFace, brackets, …). Reads
    // the proxy's own `lineWidth` so callers can set it before the
    // call as they would on a real ctx.
    isPointInStroke(
      this: { lineWidth: number },
      path: Path2D,
      x: number,
      y: number,
    ): boolean {
      return isPointInStrokeImpl(
        path as unknown as TestPath2D,
        x,
        y,
        this.lineWidth,
      );
    },
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

  /**
   * A FULL ellipse (`start`→`end` spans ≥ 2π) is recorded as an ellipse
   * op so its interior is hit-tested directly and counter-clockwise
   * sweeps still "punch a hole" under the even-odd rule (donut, can lid).
   * A PARTIAL elliptical arc is sampled into polyline segments appended to
   * the current subpath — the same treatment `arc()` gives partial circles
   * — so multi-arc silhouettes (e.g. the `cloud` preset) hit-test against
   * their true boundary instead of a full disc.
   */
  ellipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    rotation: number,
    start: number,
    end: number,
    ccw?: boolean,
  ): void {
    const fullEllipse =
      Math.abs(end - start) >= Math.PI * 2 - 1e-9 ||
      (start === 0 && end === Math.PI * 2);
    if (fullEllipse) {
      this.flushSubpath();
      this.ops.push({ kind: 'ellipse', cx, cy, rx, ry, rotation, ccw: !!ccw });
      return;
    }
    if (!this.current) this.current = [];
    let a0 = start;
    let a1 = end;
    if (ccw) {
      while (a1 > a0) a1 -= Math.PI * 2;
    } else {
      while (a1 < a0) a1 += Math.PI * 2;
    }
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    for (let i = 0; i <= ARC_STEPS; i++) {
      const t = i / ARC_STEPS;
      const a = a0 + (a1 - a0) * t;
      const ex = rx * Math.cos(a);
      const ey = ry * Math.sin(a);
      this.current.push({ x: cx + ex * cos - ey * sin, y: cy + ex * sin + ey * cos });
    }
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

  /**
   * Append the operations of another `Path2D` to this one. Mirrors the
   * browser `Path2D.addPath(other)` API. Composite shape builders
   * (e.g. `cloudCallout` reusing `buildCloud`) rely on this to compose
   * sub-paths without re-implementing geometry.
   *
   * The pending sub-path on `this` (if any) is flushed first so it
   * keeps a coherent ordering, then every op from `other` is copied
   * across. We deliberately copy points arrays (rather than aliasing)
   * so later mutations on `other` cannot leak in.
   */
  addPath(other: TestPath2D): void {
    this.flushSubpath();
    other.finalize();
    for (const op of other.ops) {
      if (op.kind === 'subpath') {
        this.ops.push({
          kind: 'subpath',
          points: op.points.map((p) => ({ x: p.x, y: p.y })),
          closed: op.closed,
        });
      } else {
        this.ops.push({ ...op });
      }
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

function distanceToSegment(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * Sub-pixel-accurate distance from a point to the outline of one path
 * op. Used by `isPointInStrokeImpl`. Ellipses are sampled with 32
 * polyline segments — same density the curved-shape builders already
 * use for visible rendering, so the test answer matches the browser's
 * to within a chord error.
 */
function opOutlineDistance(op: Op, x: number, y: number): number {
  if (op.kind === 'rect') {
    const segs: Array<[number, number, number, number]> = [
      [op.x, op.y, op.x + op.w, op.y],
      [op.x + op.w, op.y, op.x + op.w, op.y + op.h],
      [op.x + op.w, op.y + op.h, op.x, op.y + op.h],
      [op.x, op.y + op.h, op.x, op.y],
    ];
    let min = Infinity;
    for (const [ax, ay, bx, by] of segs) {
      const d = distanceToSegment(x, y, ax, ay, bx, by);
      if (d < min) min = d;
    }
    return min;
  }
  if (op.kind === 'ellipse') {
    const N = 32;
    let min = Infinity;
    let prev = { x: op.cx + op.rx, y: op.cy };
    for (let i = 1; i <= N; i++) {
      const t = (i / N) * Math.PI * 2;
      const next = {
        x: op.cx + op.rx * Math.cos(t),
        y: op.cy + op.ry * Math.sin(t),
      };
      const d = distanceToSegment(x, y, prev.x, prev.y, next.x, next.y);
      if (d < min) min = d;
      prev = next;
    }
    return min;
  }
  // subpath
  if (op.points.length === 0) return Infinity;
  let min = Infinity;
  for (let i = 1; i < op.points.length; i++) {
    const a = op.points[i - 1];
    const b = op.points[i];
    const d = distanceToSegment(x, y, a.x, a.y, b.x, b.y);
    if (d < min) min = d;
  }
  if (op.closed && op.points.length >= 2) {
    const a = op.points[op.points.length - 1];
    const b = op.points[0];
    const d = distanceToSegment(x, y, a.x, a.y, b.x, b.y);
    if (d < min) min = d;
  }
  return min;
}

/**
 * Point-in-stroke test approximating browser `isPointInStroke`. A
 * point hits the stroked outline iff its distance to ANY op's outline
 * is `≤ lineWidth / 2`. We ignore `lineJoin` / `lineCap` because the
 * extra coverage from rounded joins / caps is sub-pixel at typical
 * stroke widths — and our hit-test callers add a tolerance pad on top
 * of `lineWidth` anyway.
 */
function isPointInStrokeImpl(
  path: TestPath2D,
  x: number,
  y: number,
  lineWidth: number,
): boolean {
  path.finalize();
  const half = lineWidth / 2;
  for (const op of path.ops) {
    if (opOutlineDistance(op, x, y) <= half) return true;
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
 * Test-only canvas factory. Returns an object whose `getContext('2d')`
 * provides the narrow surface shape builder + icon tests need:
 *   - `isPointInPath(path, x, y, fillRule?)` for builder hit-tests
 *   - mutable `lineWidth` / `lineJoin` plus no-op `save`/`restore`/
 *     `translate`/`beginPath`/`moveTo`/`lineTo`/`stroke` for code paths
 *     that draw outlines (e.g. `renderShapeIcon`)
 *
 * Width/height are accepted for symmetry with the browser API but are
 * not used. New methods/state should be added here as renderers grow,
 * keeping the mock just rich enough for the call-sites under test.
 */
export interface TestCanvas2DContext {
  isPointInPath(path: Path2D, x: number, y: number, fillRule?: FillRule): boolean;
  /**
   * Distance-based stroke hit-test against the polyline-approximated
   * outline. Honours the current `lineWidth`, like a real ctx.
   */
  isPointInStroke(path: Path2D, x: number, y: number): boolean;
  // Mutable state — assignable so renderers that record line styles
  // can be inspected by tests after the call.
  lineWidth: number;
  lineJoin: CanvasLineJoin;
  strokeStyle: string;
  // No-op draw plumbing.
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(path?: Path2D): void;
}

export function createTestCanvas(
  width: number,
  height: number,
): {
  width: number;
  height: number;
  getContext(type: '2d'): TestCanvas2DContext;
} {
  return {
    width,
    height,
    getContext(type: '2d'): TestCanvas2DContext {
      if (type !== '2d') throw new Error(`unsupported context type: ${type}`);
      const ctx: TestCanvas2DContext = {
        lineWidth: 1,
        lineJoin: 'miter',
        strokeStyle: '#000000',
        isPointInPath(
          path: Path2D,
          x: number,
          y: number,
          fillRule: FillRule = 'nonzero',
        ): boolean {
          return isPointInPathImpl(path as unknown as TestPath2D, x, y, fillRule);
        },
        isPointInStroke(path: Path2D, x: number, y: number): boolean {
          return isPointInStrokeImpl(
            path as unknown as TestPath2D,
            x,
            y,
            ctx.lineWidth,
          );
        },
        save(): void {},
        restore(): void {},
        translate(_x: number, _y: number): void {},
        beginPath(): void {},
        moveTo(_x: number, _y: number): void {},
        lineTo(_x: number, _y: number): void {},
        stroke(_path?: Path2D): void {},
      };
      return ctx;
    },
  };
}
