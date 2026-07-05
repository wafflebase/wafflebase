import { describe, it, expect } from 'vitest';
import { BUILT_IN_LAYOUTS, getLayout, scaleLayoutsToHeight } from '../../src/model/layout';
import { SLIDE_HEIGHT } from '../../src/model/presentation';

describe('BUILT_IN_LAYOUTS', () => {
  it('has eleven entries with the expected ids', () => {
    expect(BUILT_IN_LAYOUTS.map((l) => l.id)).toEqual([
      'blank',
      'title-slide',
      'section-header',
      'title-body',
      'title-two-columns',
      'title-only',
      'one-column-text',
      'main-point',
      'section-title-description',
      'caption',
      'big-number',
    ]);
  });

  it('every layout has masterId set to "default" in v1', () => {
    for (const l of BUILT_IN_LAYOUTS) {
      expect(l.masterId).toBe('default');
    }
  });

  describe('scaleLayoutsToHeight', () => {
    it('returns the input unchanged for a 16:9 (1080) deck', () => {
      expect(scaleLayoutsToHeight(BUILT_IN_LAYOUTS, SLIDE_HEIGHT)).toBe(
        BUILT_IN_LAYOUTS,
      );
    });

    it('scales placeholder y/h by the height ratio, leaving x/w intact', () => {
      const scaled = scaleLayoutsToHeight(BUILT_IN_LAYOUTS, 1440); // 4:3
      const factor = 1440 / SLIDE_HEIGHT; // 1.333…
      const src = BUILT_IN_LAYOUTS.find((l) => l.id === 'title-slide')!;
      const out = scaled.find((l) => l.id === 'title-slide')!;
      const sp = src.placeholders[0].frame;
      const origY = sp.y; // snapshot before asserting to catch mutation
      const op = out.placeholders[0].frame;
      expect(op.y).toBeCloseTo(origY * factor, 6);
      expect(op.h).toBeCloseTo(sp.h * factor, 6);
      expect(op.x).toBe(sp.x);
      expect(op.w).toBe(sp.w);
      // Scaling is pure — the shared BUILT_IN_LAYOUTS source is untouched.
      expect(src.placeholders[0].frame.y).toBe(origY);
      expect(op).not.toBe(sp);
    });
  });

  it('placeholder frames are inside the 1920×1080 canvas with positive dims', () => {
    for (const l of BUILT_IN_LAYOUTS) {
      for (const p of l.placeholders) {
        expect(p.frame.w).toBeGreaterThan(0);
        expect(p.frame.h).toBeGreaterThan(0);
        expect(p.frame.x).toBeGreaterThanOrEqual(0);
        expect(p.frame.y).toBeGreaterThanOrEqual(0);
        expect(p.frame.x + p.frame.w).toBeLessThanOrEqual(1920);
        expect(p.frame.y + p.frame.h).toBeLessThanOrEqual(1080);
      }
    }
  });

  it('every layout has an empty staticElements array (v1)', () => {
    for (const l of BUILT_IN_LAYOUTS) {
      expect(l.staticElements).toEqual([]);
    }
  });

  it('every placeholder has a slot type matching the design spec', () => {
    const types = Object.fromEntries(
      BUILT_IN_LAYOUTS.map((l) => [
        l.id,
        l.placeholders.map((p) => p.placeholder.type),
      ]),
    );
    expect(types).toEqual({
      'blank': [],
      'title-slide': ['title', 'subtitle'],
      'section-header': ['title'],
      'title-body': ['title', 'body'],
      'title-two-columns': ['title', 'body', 'body'],
      'title-only': ['title'],
      'one-column-text': ['body'],
      'main-point': ['title'],
      'section-title-description': ['title', 'body'],
      'caption': ['body', 'caption'],
      'big-number': ['big-number', 'body'],
    });
  });

  it('seeds text placeholders with shrink autofit', () => {
    const textPlaceholders = BUILT_IN_LAYOUTS
      .flatMap((l) => l.placeholders)
      .filter((p) => p.type === 'text');
    expect(textPlaceholders.length).toBeGreaterThan(0);
    for (const p of textPlaceholders) {
      expect(p.data.autofit).toBe('shrink');
    }
  });
});

describe('getLayout', () => {
  it('returns the requested layout', () => {
    expect(getLayout('main-point').id).toBe('main-point');
  });

  it('falls back to blank for unknown ids', () => {
    expect(getLayout('not-a-layout').id).toBe('blank');
  });
});
