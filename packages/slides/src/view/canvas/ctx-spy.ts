import { vi, type Mock } from 'vitest';

// In vitest 4 the default `vi.fn()` return type widened to
// `Mock<Procedure | Constructable>`, which TypeScript can no longer
// invoke without an explicit signature (the constructor overload
// makes the call form ambiguous). Pin every spy slot to a callable
// signature so tests can do `ctx.fillRect(...)` directly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpyFn = Mock<(...args: any[]) => any>;

/**
 * Test-only spy that mimics the slice of `CanvasRenderingContext2D`
 * the slides renderers touch. Property fields are plain mutable
 * values; methods are `vi.fn()` so tests can assert call shape.
 *
 * If a renderer reaches for a property/method that is not listed here,
 * add it — the spy is intentionally narrow so missing pieces surface
 * as test failures rather than silent no-ops.
 */
export interface CtxSpy {
  // state
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  globalAlpha: number;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  filter: string;

  // transforms
  save: SpyFn;
  restore: SpyFn;
  translate: SpyFn;
  rotate: SpyFn;
  scale: SpyFn;
  setTransform: SpyFn;
  transform: SpyFn;

  // paths
  beginPath: SpyFn;
  closePath: SpyFn;
  moveTo: SpyFn;
  lineTo: SpyFn;
  bezierCurveTo: SpyFn;
  arc: SpyFn;
  ellipse: SpyFn;
  rect: SpyFn;

  // fill / stroke / clear
  fillRect: SpyFn;
  strokeRect: SpyFn;
  clearRect: SpyFn;
  fill: SpyFn;
  stroke: SpyFn;
  setLineDash: SpyFn;

  // text
  fillText: SpyFn;
  measureText: SpyFn;

  // images
  drawImage: SpyFn;
}

/**
 * Build a fresh spy ctx with sensible defaults. Each call returns an
 * isolated object; do NOT share between tests.
 */
export function createCtxSpy(): CtxSpy {
  return {
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    shadowColor: 'transparent',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    filter: 'none',

    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    setTransform: vi.fn(),
    transform: vi.fn(),

    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    arc: vi.fn(),
    ellipse: vi.fn(),
    rect: vi.fn(),

    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    clearRect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    setLineDash: vi.fn(),

    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 0 })) as unknown as SpyFn,

    drawImage: vi.fn(),
  };
}

/**
 * Cast a `CtxSpy` to the real type so it can be passed into renderer
 * functions whose signatures take `CanvasRenderingContext2D`. Centralises
 * the unsafe-but-necessary cast so individual tests stay readable.
 */
export function asCtx(spy: CtxSpy): CanvasRenderingContext2D {
  return spy as unknown as CanvasRenderingContext2D;
}
