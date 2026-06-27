// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import { BUILT_IN_LAYOUTS } from '../../../src/model/layout';
import { defaultLight } from '../../../src/themes/default-light';
import { DEFAULT_MASTER } from '../../../src/model/master';
import { renderLayoutPreview, _previewCacheForTest } from '../../../src/view/canvas/layout-preview';

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

  it('busts the cache when a layout placeholder frame changes (same layout id)', () => {
    _previewCacheForTest.clear();
    const base = BUILT_IN_LAYOUTS[3]; // title-body
    const size = { w: 160, h: 90 } as const;
    const a = renderLayoutPreview(base, defaultLight, DEFAULT_MASTER, size);
    // Theme-builder geometry edit: same layout id, moved placeholder.
    const edited = {
      ...base,
      placeholders: base.placeholders.map((p, i) =>
        i === 0 ? { ...p, frame: { ...p.frame, x: p.frame.x + 100 } } : p,
      ),
    };
    const b = renderLayoutPreview(edited, defaultLight, DEFAULT_MASTER, size);
    expect(b).not.toBe(a);
  });

  it('busts the cache when theme colors change (same theme id)', () => {
    _previewCacheForTest.clear();
    const layout = BUILT_IN_LAYOUTS[1];
    const size = { w: 160, h: 90 } as const;
    const a = renderLayoutPreview(layout, defaultLight, DEFAULT_MASTER, size);
    const editedTheme = {
      ...defaultLight,
      colors: { ...defaultLight.colors, accent1: '#FF0000' },
    };
    const b = renderLayoutPreview(layout, editedTheme, DEFAULT_MASTER, size);
    expect(b).not.toBe(a);
  });

  it('bounds the cache so live editing does not leak canvases', () => {
    _previewCacheForTest.clear();
    // Each distinct size is a distinct key; render well past the cap.
    for (let i = 0; i < 200; i++) {
      renderLayoutPreview(BUILT_IN_LAYOUTS[1], defaultLight, DEFAULT_MASTER, {
        w: 100 + i,
        h: 90,
      });
    }
    expect(_previewCacheForTest.size).toBeLessThanOrEqual(128);
  });

  it('renders all 11 layouts without throwing', () => {
    _previewCacheForTest.clear();
    for (const layout of BUILT_IN_LAYOUTS) {
      const c = renderLayoutPreview(layout, defaultLight, DEFAULT_MASTER, { w: 160, h: 90 });
      expect(c).toBeInstanceOf(HTMLCanvasElement);
    }
  });
});
