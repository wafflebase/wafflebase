// @vitest-environment jsdom
import { beforeAll, describe, it, expect } from 'vitest';
import type { Block } from '@wafflebase/docs';
import type { TextElement } from '../../model/element';
import { asCtx, createCtxSpy } from './ctx-spy';

/**
 * jsdom does not implement Canvas 2D, so the docs `CanvasTextMeasurer`
 * (which `text-renderer` instantiates at module scope) cannot acquire a
 * ctx via `OffscreenCanvas` *or* `<canvas>.getContext('2d')`. Install a
 * minimal `OffscreenCanvas` shim before importing the renderer so the
 * measurer's lazy `getCtx()` path resolves successfully. Width returns
 * a deterministic char-count to keep layout assertions stable.
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

// Import the renderer *after* the shim is installed so the module-scope
// measurer can lazily acquire the fake ctx on first use.
const { drawText } = await import('./text-renderer');

const size = { w: 400, h: 200 };

function paragraph(text: string): Block {
  return {
    id: `b${Math.random().toString(36).slice(2, 8)}`,
    type: 'paragraph',
    inlines: [{ text, style: {} }],
    style: {},
  } as Block;
}

const data = (blocks: Block[]): TextElement['data'] => ({ blocks });

describe('drawText', () => {
  beforeAll(() => {
    // Sanity: confirm the OffscreenCanvas shim is in place. If a future
    // change drops the shim we want a clear failure here, not a confusing
    // 'no Canvas 2D context available' deep in the layout engine.
    expect(typeof (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas).toBe(
      'function',
    );
  });

  it('emits one fillText per run for a single paragraph', () => {
    const ctx = createCtxSpy();
    // docs `computeLayout` segments at the word level, so "Hello world"
    // becomes two runs: "Hello " and "world". Concatenating the
    // recorded run texts must round-trip to the original paragraph.
    drawText(asCtx(ctx), size, data([paragraph('Hello world')]));
    expect(ctx.fillText).toHaveBeenCalledTimes(2);
    const joined = ctx.fillText.mock.calls.map((c) => c[0]).join('');
    expect(joined).toBe('Hello world');
    // x at the run's x position; y at the layout-derived line baseline.
    for (const call of ctx.fillText.mock.calls) {
      expect(typeof call[1]).toBe('number');
      expect(typeof call[2]).toBe('number');
    }
  });

  it('emits one fillText per inline run when the paragraph has multiple inlines', () => {
    const ctx = createCtxSpy();
    const block: Block = {
      id: 'b1',
      type: 'paragraph',
      inlines: [
        { text: 'Hello ', style: {} },
        { text: 'bold', style: { bold: true } },
      ],
      style: {},
    } as Block;
    drawText(asCtx(ctx), size, data([block]));
    expect(ctx.fillText).toHaveBeenCalledTimes(2);
    expect(ctx.fillText.mock.calls[0][0]).toBe('Hello ');
    expect(ctx.fillText.mock.calls[1][0]).toBe('bold');
  });

  it('does not paint anything for an empty blocks array', () => {
    const ctx = createCtxSpy();
    drawText(asCtx(ctx), size, data([]));
    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  it('emits one fillText per block for two paragraphs', () => {
    const ctx = createCtxSpy();
    drawText(asCtx(ctx), size, data([paragraph('one'), paragraph('two')]));
    expect(ctx.fillText).toHaveBeenCalledTimes(2);
  });
});
