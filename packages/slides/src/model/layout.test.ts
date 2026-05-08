import { describe, it, expect } from 'vitest';
import { BUILT_IN_LAYOUTS, getLayout } from './layout';

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
});

describe('getLayout', () => {
  it('returns the requested layout', () => {
    expect(getLayout('main-point').id).toBe('main-point');
  });

  it('falls back to blank for unknown ids', () => {
    expect(getLayout('not-a-layout').id).toBe('blank');
  });
});
