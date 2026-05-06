/**
 * Test-only shim that installs a minimal `OffscreenCanvas` on the
 * global object. The docs `CanvasTextMeasurer` (which `text-renderer`
 * instantiates at module scope) calls `new OffscreenCanvas()` to acquire
 * a 2D ctx for measurement. jsdom does not implement `OffscreenCanvas`,
 * so any test that imports `text-renderer` (directly or transitively
 * via `element-renderer`) must install this shim BEFORE the renderer
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
