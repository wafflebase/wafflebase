// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import type { Slide, SlidesDocument } from '../../model/presentation';
import { DEFAULT_BACKGROUND } from '../../model/presentation';
import type { Theme } from '../../model/theme';
import { DEFAULT_MASTER } from '../../model/master';
import { BUILT_IN_LAYOUTS } from '../../model/layout';
import { asCtx, createCtxSpy } from './ctx-spy';
// Install Path2D global before the slide renderer pulls in shape builders.
import './test-canvas-env';
import { drawSlide } from './slide-renderer';
import type { Element } from '../../model/element';

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
  guides: [],
};

function makeShape(frame: { x: number; y: number; w: number; h: number }): Element {
  return {
    id: 'a', type: 'shape',
    frame: { ...frame, rotation: 0 },
    data: { kind: 'rect', fill: { kind: 'srgb', value: '#a00' } },
  } as unknown as Element;
}

function makeSlide(elements: Element[]): Slide {
  return {
    id: 's1', layoutId: 'blank',
    background: { ...DEFAULT_BACKGROUND, fill: { kind: 'srgb', value: '#fff' } },
    elements, notes: [],
  };
}

describe('drawSlide with viewport', () => {
  it('uses zoom*dpr transform and paints no slide background', () => {
    const ctx = createCtxSpy();
    const slide = makeSlide([makeShape({ x: 0, y: 0, w: 100, h: 100 })]);
    drawSlide(asCtx(ctx), slide, DOC, {
      hostWidth: 800, hostHeight: 600, dpr: 2,
      viewport: { panX: 50, panY: 20, zoom: 1.5 },
    });
    // zoom*dpr = 1.5*2 = 3; pan*dpr = 50*2=100, 20*2=40
    expect(ctx.setTransform).toHaveBeenLastCalledWith(3, 0, 0, 3, 100, 40);
    // Board mode paints no slide-rect background fill; only clearRect.
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it('culls an element fully outside the screen world-rect', () => {
    const ctx = createCtxSpy();
    const offscreen = makeShape({ x: 100000, y: 100000, w: 10, h: 10 });
    const slide = makeSlide([offscreen]);
    drawSlide(asCtx(ctx), slide, DOC, {
      hostWidth: 800, hostHeight: 600, dpr: 1, cull: true,
      viewport: { panX: 0, panY: 0, zoom: 1 },
    });
    // A culled element's rect path is never painted.
    expect(ctx.fill).not.toHaveBeenCalled();
  });

  it('does not cull an on-screen element', () => {
    const ctx = createCtxSpy();
    const onscreen = makeShape({ x: 10, y: 10, w: 50, h: 50 });
    const slide = makeSlide([onscreen]);
    drawSlide(asCtx(ctx), slide, DOC, {
      hostWidth: 800, hostHeight: 600, dpr: 1, cull: true,
      viewport: { panX: 0, panY: 0, zoom: 1 },
    });
    expect(ctx.fill).toHaveBeenCalled();
  });
});
