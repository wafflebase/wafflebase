// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import '../../../../src/view/canvas/test-canvas-env';
import {
  SlidesRuler,
  RULER_SIZE,
  SLIDES_PX_PER_INCH,
} from '../../../../src/view/editor/ruler/ruler';

function mount(): {
  container: HTMLElement;
  hCanvas: HTMLCanvasElement;
  vCanvas: HTMLCanvasElement;
  corner: HTMLElement;
} {
  const container = document.createElement('div');
  const corner = document.createElement('div');
  const hCanvas = document.createElement('canvas');
  const vCanvas = document.createElement('canvas');
  container.append(corner, hCanvas, vCanvas);
  document.body.appendChild(container);
  return { container, hCanvas, vCanvas, corner };
}

describe('SlidesRuler', () => {
  let dom: ReturnType<typeof mount>;
  beforeEach(() => {
    document.body.innerHTML = '';
    dom = mount();
  });

  it('exposes RULER_SIZE = 20 and SLIDES_PX_PER_INCH = 144', () => {
    expect(RULER_SIZE).toBe(20);
    expect(SLIDES_PX_PER_INCH).toBe(144);
  });

  it('renders without throwing at zoom 1', () => {
    const ruler = new SlidesRuler({
      hCanvas: dom.hCanvas,
      vCanvas: dom.vCanvas,
      corner: dom.corner,
      dpr: 1,
      unit: 'inch',
    });
    expect(() =>
      ruler.render({ hostWidth: 1920, hostHeight: 1080 }),
    ).not.toThrow();
  });

  it('no-ops on zero-sized viewport', () => {
    const ruler = new SlidesRuler({
      hCanvas: dom.hCanvas,
      vCanvas: dom.vCanvas,
      corner: dom.corner,
      dpr: 1,
      unit: 'inch',
    });
    expect(() =>
      ruler.render({ hostWidth: 0, hostHeight: 0 }),
    ).not.toThrow();
  });

  it('paints the corner background on construction', () => {
    new SlidesRuler({
      hCanvas: dom.hCanvas,
      vCanvas: dom.vCanvas,
      corner: dom.corner,
      dpr: 1,
      unit: 'inch',
    });
    expect(dom.corner.style.background).not.toBe('');
  });

  describe('density transitions', () => {
    // Slides ship a 144 dpi physical scale. The density bands divide
    // on `majorStepOnScreen = 144 * zoom`:
    //   ≥ 60 → 'full'         (zoom ≥ 0.4167)
    //   ≥ 30 → 'half-only'    (zoom ≥ 0.2083)
    //   ≥ 15 → 'major'        (zoom ≥ 0.1042)
    //   else → 'major-thinned'
    //
    // The metric grid uses a different majorStepPx (~56.7 px = 1 cm),
    // so the same zoom yields different bands — pin transitions for
    // both unit choices.

    it('inch bands transition at zoom 0.4167 / 0.2083 / 0.1042', () => {
      const ruler = new SlidesRuler({
        hCanvas: dom.hCanvas,
        vCanvas: dom.vCanvas,
        corner: dom.corner,
        dpr: 1,
        unit: 'inch',
      });
      expect(ruler.densityFor(1)).toBe('full');
      expect(ruler.densityFor(0.5)).toBe('full');
      expect(ruler.densityFor(0.42)).toBe('full');
      expect(ruler.densityFor(0.41)).toBe('half-only');
      expect(ruler.densityFor(0.25)).toBe('half-only');
      expect(ruler.densityFor(0.2)).toBe('major');
      expect(ruler.densityFor(0.11)).toBe('major');
      expect(ruler.densityFor(0.1)).toBe('major-thinned');
      expect(ruler.densityFor(0.05)).toBe('major-thinned');
    });

    it('cm bands shift because the metric major step is smaller', () => {
      const ruler = new SlidesRuler({
        hCanvas: dom.hCanvas,
        vCanvas: dom.vCanvas,
        corner: dom.corner,
        dpr: 1,
        unit: 'cm',
      });
      // majorStepPx ≈ 56.7 px (1 cm at 144 dpi). At zoom 1 that
      // already lands below the 60-px 'full' threshold — the cm ruler
      // shows 'half-only' at its baseline, which matches Google Slides
      // (which also shows fewer minor ticks under metric).
      expect(ruler.densityFor(1.2)).toBe('full');     // 68 ≥ 60
      expect(ruler.densityFor(1)).toBe('half-only');  // 56.7
      expect(ruler.densityFor(0.6)).toBe('half-only');// 34
      expect(ruler.densityFor(0.3)).toBe('major');    // 17
      expect(ruler.densityFor(0.2)).toBe('major-thinned'); // 11.3
    });
  });

  it('setUnit recomputes the grid', () => {
    const ruler = new SlidesRuler({
      hCanvas: dom.hCanvas,
      vCanvas: dom.vCanvas,
      corner: dom.corner,
      dpr: 1,
      unit: 'inch',
    });
    expect(ruler.getUnit()).toBe('inch');
    // At zoom 1 with inch (144 dpi major), density is 'full'.
    expect(ruler.densityFor(1)).toBe('full');
    ruler.setUnit('cm');
    expect(ruler.getUnit()).toBe('cm');
    // cm major step (~56.7 px @ 144 dpi) sits between 30 and 60 at
    // zoom 1, so the band drops to 'half-only' after the switch.
    expect(ruler.densityFor(1)).toBe('half-only');
    // At zoom 0.2 the cm major step is ~11 px → 'major-thinned'.
    expect(ruler.densityFor(0.2)).toBe('major-thinned');
  });

  it('dispose blocks further rendering', () => {
    const ruler = new SlidesRuler({
      hCanvas: dom.hCanvas,
      vCanvas: dom.vCanvas,
      corner: dom.corner,
      dpr: 1,
      unit: 'inch',
    });
    ruler.dispose();
    // After dispose, render is a no-op; canvas dimensions stay at the
    // default 300×150 (no resize was triggered).
    ruler.render({ hostWidth: 1920, hostHeight: 1080 });
    expect(dom.hCanvas.width).toBe(300);
    expect(dom.vCanvas.width).toBe(300);
  });

  it('resizes backing canvases according to dpr', () => {
    const ruler = new SlidesRuler({
      hCanvas: dom.hCanvas,
      vCanvas: dom.vCanvas,
      corner: dom.corner,
      dpr: 2,
      unit: 'inch',
    });
    ruler.render({ hostWidth: 800, hostHeight: 450 });
    // h-ruler: 800 × 20 CSS, doubled by dpr
    expect(dom.hCanvas.width).toBe(1600);
    expect(dom.hCanvas.height).toBe(40);
    expect(dom.hCanvas.style.width).toBe('800px');
    expect(dom.hCanvas.style.height).toBe('20px');
    // v-ruler: 20 × 450 CSS, doubled by dpr
    expect(dom.vCanvas.width).toBe(40);
    expect(dom.vCanvas.height).toBe(900);
    expect(dom.vCanvas.style.width).toBe('20px');
    expect(dom.vCanvas.style.height).toBe('450px');
  });
});
