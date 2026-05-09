import { describe, it, expect } from 'vitest';
import type { Slide, SlidesDocument } from '../../model/presentation';
import { DEFAULT_BACKGROUND } from '../../model/presentation';
import type { Theme } from '../../model/theme';
import { DEFAULT_MASTER } from '../../model/master';
import { BUILT_IN_LAYOUTS } from '../../model/layout';
import { asCtx, createCtxSpy } from './ctx-spy';
// Install Path2D global before the slide renderer pulls in shape builders.
import './test-canvas-env';
import { SlideRenderer } from './slide-renderer';

const THEME: Theme = {
  id: 't', name: 't',
  colors: {
    text: '#000', background: '#fff', textSecondary: '#444', backgroundAlt: '#f3f3f3',
    accent1: '#abc', accent2: '#bcd', accent3: '#cde', accent4: '#def',
    accent5: '#e0e1e2', accent6: '#f0f1f2',
    hyperlink: '#11c', visitedHyperlink: '#71a',
  },
  fonts: { heading: 'Inter', body: 'Inter' },
};

const DOC: SlidesDocument = {
  meta: { title: 't', themeId: 't', masterId: 'default' },
  themes: [THEME],
  masters: [DEFAULT_MASTER],
  layouts: BUILT_IN_LAYOUTS,
  slides: [],
};

function blankSlide(): Slide {
  return {
    id: 's1', layoutId: 'blank',
    background: { ...DEFAULT_BACKGROUND, fill: { kind: 'srgb', value: '#fff' } },
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
    renderer.render(blankSlide(), DOC);
    expect(ctx.clearRect).toHaveBeenCalledTimes(1);
    expect(ctx.fillRect).toHaveBeenCalled(); // background fill

    const before = ctx.clearRect.mock.calls.length;
    renderer.render(blankSlide(), DOC);
    expect(ctx.clearRect.mock.calls.length).toBe(before); // no second clear
  });

  it('repaints after markDirty()', () => {
    const { renderer, ctx } = makeRenderer();
    renderer.render(blankSlide(), DOC);
    const before = ctx.clearRect.mock.calls.length;
    renderer.markDirty();
    renderer.render(blankSlide(), DOC);
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
          data: { kind: 'rect', fill: { kind: 'srgb', value: '#a00' } },
        },
        {
          id: 'b', type: 'shape',
          frame: { x: 0, y: 0, w: 50, h: 50, rotation: 0 },
          data: { kind: 'rect', fill: { kind: 'srgb', value: '#0a0' } },
        },
      ],
    };
    renderer.render(slide, DOC);
    // 1 fillRect for the background; rect shapes now route through the
    // path-builder dispatcher, which calls `ctx.fill(path)` per shape.
    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    expect(ctx.fill).toHaveBeenCalledTimes(2);
  });

  it('applies a (hostWidth/SLIDE_WIDTH) scale so 1920x1080 logical maps to host pixels', () => {
    const { renderer, ctx } = makeRenderer();
    renderer.render(blankSlide(), DOC);
    // 960 / 1920 = 0.5; dpr = 1 → effective scale 0.5
    expect(ctx.scale).toHaveBeenCalledWith(0.5, 0.5);
  });

  it('respects DPR: 2x DPR doubles the scale factor', () => {
    const ctx = createCtxSpy();
    const renderer = new SlideRenderer(asCtx(ctx), { hostWidth: 960, hostHeight: 540, dpr: 2 });
    renderer.render(blankSlide(), DOC);
    expect(ctx.scale).toHaveBeenCalledWith(1.0, 1.0); // 0.5 * 2
  });

  it('background image is not drawn yet (image-fill backgrounds are v2)', () => {
    const { renderer, ctx } = makeRenderer();
    const slide: Slide = {
      ...blankSlide(),
      background: {
        fill: { kind: 'srgb', value: '#fff' },
        image: { src: 'x.png', w: 1, h: 1 },
      },
    };
    renderer.render(slide, DOC);
    expect(ctx.drawImage).not.toHaveBeenCalled();
  });

  it('forceRender paints even when not dirty', () => {
    const { renderer, ctx } = makeRenderer();
    renderer.render(blankSlide(), DOC);        // dirty → false
    const before = ctx.clearRect.mock.calls.length;
    renderer.forceRender(blankSlide(), DOC);
    expect(ctx.clearRect.mock.calls.length).toBe(before + 1);
  });

  it('resolves a role-bound background through the theme', () => {
    const { renderer, ctx } = makeRenderer();
    const slide: Slide = {
      ...blankSlide(),
      background: { fill: { kind: 'role', role: 'background' } },
    };
    renderer.render(slide, DOC);
    // The theme's `background` role is '#fff' — the canvas-level
    // fillStyle assignment should land that hex even though the
    // model-level color was a role binding.
    expect(ctx.fillStyle).toBe('#fff');
  });
});
