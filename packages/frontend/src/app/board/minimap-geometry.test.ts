import { describe, it, expect } from 'vitest';
import {
  sceneBounds, fitScene, worldToMini, miniToWorld,
  viewportRectInMini, centerViewportOnWorld,
} from './minimap-geometry';

const frame = (x: number, y: number, w: number, h: number) => ({ x, y, w, h, rotation: 0 });

describe('sceneBounds', () => {
  it('is undefined for an empty scene', () => {
    expect(sceneBounds([])).toBeUndefined();
  });
  it('unions all frames and pads', () => {
    const b = sceneBounds([frame(0, 0, 100, 100), frame(200, 50, 100, 100)], 10)!;
    expect(b).toMatchObject({ x: -10, y: -10, w: 320, h: 170 });
  });
});

describe('fitScene', () => {
  it('letterboxes a wide scene (width-bound) and centers it', () => {
    const fit = fitScene({ x: 0, y: 0, w: 400, h: 100 }, { w: 200, h: 150 });
    expect(fit.scale).toBeCloseTo(0.5); // 200/400 < 150/100
    expect(fit.offsetX).toBeCloseTo(0);
    expect(fit.offsetY).toBeCloseTo((150 - 100 * 0.5) / 2); // vertically centered
  });
});

describe('worldToMini / miniToWorld round-trip', () => {
  it('is an inverse pair', () => {
    const fit = fitScene({ x: 0, y: 0, w: 400, h: 300 }, { w: 200, h: 150 });
    const p = { x: 123, y: 77 };
    const back = miniToWorld(fit, worldToMini(fit, p));
    expect(back.x).toBeCloseTo(p.x);
    expect(back.y).toBeCloseTo(p.y);
  });
});

describe('viewportRectInMini', () => {
  it('maps the on-screen world rect into minimap px', () => {
    // identity viewport: screen (0,0)-(host) == world (0,0)-(host)
    const fit = fitScene({ x: 0, y: 0, w: 800, h: 600 }, { w: 200, h: 150 });
    const r = viewportRectInMini({ panX: 0, panY: 0, zoom: 1 }, { w: 800, h: 600 }, fit);
    expect(r).toMatchObject({ x: 0, y: 0, w: 200, h: 150 });
  });
});

describe('centerViewportOnWorld', () => {
  it('sets pan so the world point lands at host center, keeping zoom', () => {
    const vp = centerViewportOnWorld({ panX: 0, panY: 0, zoom: 2 }, { x: 100, y: 50 }, { w: 800, h: 600 });
    expect(vp.zoom).toBe(2);
    // host center 400,300 == world*zoom + pan → pan = 400 - 100*2 = 200 ; 300 - 50*2 = 200
    expect(vp.panX).toBe(200);
    expect(vp.panY).toBe(200);
  });
});
