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
