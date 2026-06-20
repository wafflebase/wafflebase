import { describe, it, expect } from 'vitest';
import { BUILT_IN_THEMES, getBuiltInTheme } from './index';
import type { ColorScheme } from '../model/theme';

const HEX = /^#[0-9A-F]{6}$/;
const SLOTS: (keyof ColorScheme)[] = [
  'text', 'background', 'textSecondary', 'backgroundAlt',
  'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6',
  'hyperlink', 'visitedHyperlink',
];

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe('theme catalog validity', () => {
  it('has unique ids; defaults first; wafflebase last', () => {
    const ids = BUILT_IN_THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe('default-light');
    expect(ids[1]).toBe('default-dark');
    expect(ids[ids.length - 1]).toBe('wafflebase');
  });

  it('every theme has 12 valid uppercase hex slots and two non-empty fonts', () => {
    for (const t of BUILT_IN_THEMES) {
      for (const slot of SLOTS) {
        expect(t.colors[slot], `${t.id}.${slot}`).toMatch(HEX);
      }
      expect(t.fonts.heading, `${t.id} heading`).toBeTruthy();
      expect(t.fonts.body, `${t.id} body`).toBeTruthy();
    }
  });

  it('text passes WCAG-AA (>=4.5) over background and backgroundAlt', () => {
    for (const t of BUILT_IN_THEMES) {
      expect(contrast(t.colors.text, t.colors.background), `${t.id} text/bg`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.colors.text, t.colors.backgroundAlt), `${t.id} text/bgAlt`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('falls back to default-light for unknown ids', () => {
    expect(getBuiltInTheme('does-not-exist').id).toBe('default-light');
  });
});
