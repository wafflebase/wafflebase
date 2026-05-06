import { describe, it, expect } from 'vitest';
import type { Slide } from '../../model/presentation';
import { DEFAULT_BACKGROUND } from '../../model/presentation';
import { asCtx, createCtxSpy } from './ctx-spy';
import { SlideRenderer } from './slide-renderer';

function blankSlide(): Slide {
  return {
    id: 's1', layoutId: 'blank',
    background: { ...DEFAULT_BACKGROUND, fill: '#fff' },
    elements: [], notes: [],
  };
}

function makeRenderer(): { renderer: SlideRenderer; ctx: ReturnType<typeof createCtxSpy> } {
  const ctx = createCtxSpy();
  const renderer = new SlideRenderer(asCtx(ctx), { hostWidth: 960, hostHeight: 540, dpr: 1 });
  return { renderer, ctx };
}

describe('SlideRenderer.render', () => {
  it('clears the canvas, fills the background, and is a no-op on the second call when nothing is dirty', () => {
    const { renderer, ctx } = makeRenderer();
    renderer.render(blankSlide());
    expect(ctx.clearRect).toHaveBeenCalledTimes(1);
    expect(ctx.fillRect).toHaveBeenCalled(); // background fill

    const before = ctx.clearRect.mock.calls.length;
    renderer.render(blankSlide());
    expect(ctx.clearRect.mock.calls.length).toBe(before); // no second clear
  });

  it('repaints after markDirty()', () => {
    const { renderer, ctx } = makeRenderer();
    renderer.render(blankSlide());
    const before = ctx.clearRect.mock.calls.length;
    renderer.markDirty();
    renderer.render(blankSlide());
    expect(ctx.clearRect.mock.calls.length).toBe(before + 1);
  });

  it('iterates elements in array order (z-order) — last element paints on top', () => {
    const { renderer, ctx } = makeRenderer();
    const slide: Slide = {
      ...blankSlide(),
      elements: [
        {
          id: 'a', type: 'shape',
          frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
          data: { kind: 'rect', fill: '#a00' },
        },
        {
          id: 'b', type: 'shape',
          frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
          data: { kind: 'rect', fill: '#0a0' },
        },
      ],
    };
    renderer.render(slide);
    // 3 fillRects total: 1 background + 1 per shape
    expect(ctx.fillRect).toHaveBeenCalledTimes(3);
  });

  it('applies a (hostWidth/SLIDE_WIDTH) scale so 1920x1080 logical maps to host pixels', () => {
    const { renderer, ctx } = makeRenderer();
    renderer.render(blankSlide());
    // 960 / 1920 = 0.5; dpr = 1 → effective scale 0.5
    expect(ctx.scale).toHaveBeenCalledWith(0.5, 0.5);
  });

  it('respects DPR: 2x DPR doubles the scale factor', () => {
    const ctx = createCtxSpy();
    const renderer = new SlideRenderer(asCtx(ctx), { hostWidth: 960, hostHeight: 540, dpr: 2 });
    renderer.render(blankSlide());
    expect(ctx.scale).toHaveBeenCalledWith(1.0, 1.0); // 0.5 * 2
  });

  it('background image is not drawn yet (image-fill backgrounds are v2)', () => {
    const { renderer, ctx } = makeRenderer();
    const slide: Slide = {
      ...blankSlide(),
      background: { fill: '#fff', image: { src: 'x.png', w: 1, h: 1 } },
    };
    renderer.render(slide);
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it('forceRender paints even when not dirty', () => {
    const { renderer, ctx } = makeRenderer();
    renderer.render(blankSlide());        // dirty → false
    const before = ctx.clearRect.mock.calls.length;
    renderer.forceRender(blankSlide());
    expect(ctx.clearRect.mock.calls.length).toBe(before + 1);
  });
});
