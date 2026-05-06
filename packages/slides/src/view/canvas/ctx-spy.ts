import { vi } from 'vitest';

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

  // transforms
  save: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  translate: ReturnType<typeof vi.fn>;
  rotate: ReturnType<typeof vi.fn>;
  scale: ReturnType<typeof vi.fn>;
  setTransform: ReturnType<typeof vi.fn>;

  // paths
  beginPath: ReturnType<typeof vi.fn>;
  closePath: ReturnType<typeof vi.fn>;
  moveTo: ReturnType<typeof vi.fn>;
  lineTo: ReturnType<typeof vi.fn>;
  arc: ReturnType<typeof vi.fn>;
  ellipse: ReturnType<typeof vi.fn>;
  rect: ReturnType<typeof vi.fn>;

  // fill / stroke / clear
  fillRect: ReturnType<typeof vi.fn>;
  strokeRect: ReturnType<typeof vi.fn>;
  clearRect: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  stroke: ReturnType<typeof vi.fn>;

  // text
  fillText: ReturnType<typeof vi.fn>;
  measureText: ReturnType<typeof vi.fn>;

  // images
  drawImage: ReturnType<typeof vi.fn>;
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

    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    setTransform: vi.fn(),

    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    ellipse: vi.fn(),
    rect: vi.fn(),

    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    clearRect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),

    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 0 })) as ReturnType<typeof vi.fn>,

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
