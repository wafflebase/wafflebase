// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import type { Slide, SlidesDocument } from '../../../src/model/presentation';
import { DEFAULT_BACKGROUND, SLIDE_HEIGHT, SLIDE_WIDTH } from '../../../src/model/presentation';
import type { Theme } from '../../../src/model/theme';
import { DEFAULT_MASTER } from '../../../src/model/master';
import { BUILT_IN_LAYOUTS } from '../../../src/model/layout';
import { asCtx, createCtxSpy } from '../../../src/view/canvas/ctx-spy';
// Install Path2D global before the slide renderer pulls in shape builders.
import '../../../src/view/canvas/test-canvas-env';
import { drawSlide } from '../../../src/view/canvas/slide-renderer';
import type { AnimState } from '../../../src/anim/state';
import { IDENTITY } from '../../../src/anim/state';

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

const OPTS = { hostWidth: SLIDE_WIDTH, hostHeight: SLIDE_HEIGHT, dpr: 1 };

function makeSlideWithElements(): { slide: Slide; idA: string; idB: string } {
  const idA = 'elem-a';
  const idB = 'elem-b';
  const slide: Slide = {
    id: 's1', layoutId: 'blank',
    background: { ...DEFAULT_BACKGROUND, fill: { kind: 'srgb', value: '#fff' } },
    elements: [
      {
        id: idA, type: 'shape',
        frame: { x: 100, y: 100, w: 200, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb', value: '#a00' } },
      },
      {
        id: idB, type: 'shape',
        frame: { x: 400, y: 200, w: 200, h: 100, rotation: 0 },
        data: { kind: 'rect', fill: { kind: 'srgb', value: '#0a0' } },
      },
    ],
    notes: [],
  };
  return { slide, idA, idB };
}

describe('drawSlide animStates passthrough', () => {
  it('no-animStates path is byte-identical to omitting the arg (fill count, fill2x for 2 shapes)', () => {
    const { slide } = makeSlideWithElements();

    // Without animStates argument
    const spyBaseline = createCtxSpy();
    drawSlide(asCtx(spyBaseline), slide, DOC, OPTS);

    // With animStates = undefined explicitly
    const spyUndefined = createCtxSpy();
    drawSlide(asCtx(spyUndefined), slide, DOC, OPTS, () => undefined, undefined, undefined);

    // Both paths must produce the same shape fill counts:
    // 1 fillRect for background + 2 ctx.fill calls for the two rect shapes.
    expect(spyBaseline.fillRect.mock.calls.length).toBe(1);
    expect(spyUndefined.fillRect.mock.calls.length).toBe(1);
    expect(spyBaseline.fill.mock.calls.length).toBe(2);
    expect(spyUndefined.fill.mock.calls.length).toBe(2);
  });

  it('hidden element is NOT painted when animStates marks it hidden, while other elements still paint', () => {
    const { slide, idA } = makeSlideWithElements();

    const hiddenState: AnimState = { ...IDENTITY, hidden: true };
    const animStates = new Map<string, AnimState>([[idA, hiddenState]]);

    const spy = createCtxSpy();
    drawSlide(asCtx(spy), slide, DOC, OPTS, () => undefined, undefined, animStates);

    // Background fillRect still fires once.
    expect(spy.fillRect.mock.calls.length).toBe(1);
    // Only 1 ctx.fill for the non-hidden element (idB); idA is skipped.
    expect(spy.fill.mock.calls.length).toBe(1);
  });

  it('an element with opacity/scale/dx animState gets ctx.translate and ctx.scale calls', () => {
    const { slide, idA } = makeSlideWithElements();

    const animState: AnimState = {
      opacity: 0.5,
      scale: 2,
      dx: 50,
      dy: 30,
      rotation: 0,
      hidden: false,
    };
    const animStates = new Map<string, AnimState>([[idA, animState]]);

    const spy = createCtxSpy();
    drawSlide(asCtx(spy), slide, DOC, OPTS, () => undefined, undefined, animStates);

    // The animated element must trigger translate and scale calls from the
    // anim transform block inside drawElement. Both elements paint (neither hidden).
    expect(spy.fill.mock.calls.length).toBe(2);
    // translate is called at least once (for the animated element's centre pivot)
    expect(spy.translate).toHaveBeenCalled();
    // scale is called at least once for the animated element's scale factor
    // (drawSlide itself also calls ctx.scale for the slide-level scale, so
    // we expect at least 2 total — slide scale + at least one per-element scale)
    expect(spy.scale.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('ghost loop is not animated — ghosts always paint regardless of animStates', () => {
    const { slide, idA } = makeSlideWithElements();

    // Mark idA hidden in animStates.
    const hiddenState: AnimState = { ...IDENTITY, hidden: true };
    const animStates = new Map<string, AnimState>([[idA, hiddenState]]);

    // Add a ghost with idA — ghosts bypass animStates, so it still renders.
    const ghost = {
      id: idA, type: 'shape' as const,
      frame: { x: 600, y: 100, w: 100, h: 100, rotation: 0 },
      data: { kind: 'rect' as const, fill: { kind: 'srgb' as const, value: '#00a' } },
    };

    const spy = createCtxSpy();
    drawSlide(asCtx(spy), slide, DOC, OPTS, () => undefined, [ghost], animStates);

    // 1 slide element (idB) + 1 ghost (idA, not filtered) = 2 fills
    expect(spy.fill.mock.calls.length).toBe(2);
    // Ghost path uses save/restore
    expect(spy.save).toHaveBeenCalled();
    expect(spy.restore).toHaveBeenCalled();
  });
});
