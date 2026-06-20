import { describe, it, expect } from 'vitest';
import { BUILT_IN_THEMES, defaultLight, getBuiltInTheme } from '../../src/themes/index';

describe('BUILT_IN_THEMES', () => {
  it('contains six themes with stable ids', () => {
    expect(BUILT_IN_THEMES.map((t) => t.id)).toEqual([
      'default-light',
      'default-dark',
      'streamline',
      'focus',
      'material',
      'wafflebase',
    ]);
  });

  it('every theme has all 12 color slots and 2 font slots filled with valid values', () => {
    for (const t of BUILT_IN_THEMES) {
      const c = t.colors;
      const slots = [
        c.text,
        c.background,
        c.textSecondary,
        c.backgroundAlt,
        c.accent1,
        c.accent2,
        c.accent3,
        c.accent4,
        c.accent5,
        c.accent6,
        c.hyperlink,
        c.visitedHyperlink,
      ];
      for (const v of slots) {
        expect(v).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
      expect(t.fonts.heading.length).toBeGreaterThan(0);
      expect(t.fonts.body.length).toBeGreaterThan(0);
    }
  });
});

describe('getBuiltInTheme', () => {
  it('returns the requested theme', () => {
    expect(getBuiltInTheme('material').id).toBe('material');
  });

  it('falls back to default-light for unknown ids', () => {
    expect(getBuiltInTheme('not-a-theme')).toBe(defaultLight);
  });
});
