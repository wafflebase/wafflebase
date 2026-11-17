// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import type { Slide, SlidesDocument } from '../../model/presentation';
import { DEFAULT_BACKGROUND } from '../../model/presentation';
import { DEFAULT_MASTER } from '../../model/master';
import { BUILT_IN_LAYOUTS } from '../../model/layout';
import { defaultLight } from '../../themes';
import { asCtx, createCtxSpy } from './ctx-spy';
// Install Path2D global before the slide renderer pulls in shape builders.
import './test-canvas-env';
import { drawSlide } from './slide-renderer';
import type { Element } from '../../model/element';

const DOC: SlidesDocument = {
  meta: { title: 't', themeId: defaultLight.id, masterId: 'default' },
  themes: [defaultLight],
  masters: [DEFAULT_MASTER],
  layouts: BUILT_IN_LAYOUTS,
  slides: [],
  guides: [],
};

function shape(id: string, x: number, y: number): Element {
  return {
    id,
    type: 'shape',
    frame: { x, y, w: 50, h: 50, rotation: 0 },
    data: { kind: 'rect', fill: { kind: 'srgb', value: '#a00' } },
  } as unknown as Element;
}

function slide(elements: Element[]): Slide {
  return {
    id: 's1',
    layoutId: 'blank',
    background: DEFAULT_BACKGROUND,
    elements,
    notes: [],
  };
}

describe('drawSlide decorateElement hook', () => {
  it('runs after each painted top-level element and skips culled ones', () => {
    const ctx = createCtxSpy();
    const seen: string[] = [];
    drawSlide(asCtx(ctx), slide([shape('on', 10, 10), shape('off', 100000, 100000)]), DOC, {
      hostWidth: 800,
      hostHeight: 600,
      dpr: 1,
      cull: true,
      viewport: { panX: 0, panY: 0, zoom: 1 },
      decorateElement: (c, el) => {
        // The element's own fill was painted before the hook ran.
        expect(ctx.fill).toHaveBeenCalled();
        expect(c).toBe(asCtx(ctx));
        seen.push(el.id);
      },
    });
    expect(seen).toEqual(['on']);
  });

  it('is optional: a slides mount paints exactly as before', () => {
    const ctx = createCtxSpy();
    expect(() =>
      drawSlide(asCtx(ctx), slide([shape('a', 0, 0)]), DOC, {
        hostWidth: 800,
        hostHeight: 600,
        dpr: 1,
      }),
    ).not.toThrow();
  });
});
