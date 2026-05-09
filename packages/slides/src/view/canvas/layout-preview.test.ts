// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import './test-canvas-env';
import { BUILT_IN_LAYOUTS } from '../../model/layout';
import { defaultLight } from '../../themes/default-light';
import { DEFAULT_MASTER } from '../../model/master';
import { renderLayoutPreview, _previewCacheForTest } from './layout-preview';

describe('renderLayoutPreview', () => {
  it('returns a canvas of the requested size', () => {
    _previewCacheForTest.clear();
    const c = renderLayoutPreview(
      BUILT_IN_LAYOUTS[3], // title-body
      defaultLight,
      DEFAULT_MASTER,
      { w: 160, h: 90 },
    );
    expect(c).toBeInstanceOf(HTMLCanvasElement);
    expect(c.width).toBe(160);
    expect(c.height).toBe(90);
  });

  it('caches by themeId/masterId/layoutId/size — same inputs return same canvas', () => {
    _previewCacheForTest.clear();
    const args = {
      layout: BUILT_IN_LAYOUTS[1], // title-slide
      theme: defaultLight,
      master: DEFAULT_MASTER,
      size: { w: 160, h: 90 } as const,
    };
    const a = renderLayoutPreview(args.layout, args.theme, args.master, args.size);
    const b = renderLayoutPreview(args.layout, args.theme, args.master, args.size);
    expect(a).toBe(b);
  });

  it('produces different canvases for different sizes', () => {
    _previewCacheForTest.clear();
    const a = renderLayoutPreview(BUILT_IN_LAYOUTS[1], defaultLight, DEFAULT_MASTER, { w: 160, h: 90 });
    const b = renderLayoutPreview(BUILT_IN_LAYOUTS[1], defaultLight, DEFAULT_MASTER, { w: 80,  h: 45 });
    expect(a).not.toBe(b);
    expect(b.width).toBe(80);
  });

  it('renders all 11 layouts without throwing', () => {
    _previewCacheForTest.clear();
    for (const layout of BUILT_IN_LAYOUTS) {
      const c = renderLayoutPreview(layout, defaultLight, DEFAULT_MASTER, { w: 160, h: 90 });
      expect(c).toBeInstanceOf(HTMLCanvasElement);
    }
  });
});
