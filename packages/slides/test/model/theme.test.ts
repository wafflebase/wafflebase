import { describe, it, expect } from 'vitest';
import {
  resolveColor,
  resolveFont,
  type ColorScheme,
  type FontScheme,
  type Theme,
} from '../../src/model/theme';

const COLORS: ColorScheme = {
  text: '#000000',
  background: '#ffffff',
  textSecondary: '#444444',
  backgroundAlt: '#f3f3f3',
  accent1: '#FF9900',
  accent2: '#00AAEE',
  accent3: '#33CC33',
  accent4: '#CC3333',
  accent5: '#9966CC',
  accent6: '#666666',
  hyperlink: '#1155CC',
  visitedHyperlink: '#7733AA',
};

const FONTS: FontScheme = { heading: 'Inter', body: 'Inter' };

const THEME: Theme = {
  id: 'default-light',
  name: 'Simple Light',
  colors: COLORS,
  fonts: FONTS,
};

describe('resolveColor', () => {
  it('returns srgb value verbatim', () => {
    expect(resolveColor({ kind: 'srgb', value: '#abcdef' }, THEME)).toBe('#abcdef');
  });

  it('resolves a role to the theme color', () => {
    expect(resolveColor({ kind: 'role', role: 'accent1' }, THEME)).toBe('#FF9900');
  });

  it('applies tint (lighter)', () => {
    const out = resolveColor({ kind: 'role', role: 'accent1', tint: 0.5 }, THEME);
    expect(out.toUpperCase()).toBe('#FFCC80');
  });

  it('applies shade (darker)', () => {
    const out = resolveColor({ kind: 'role', role: 'accent1', shade: 0.5 }, THEME);
    expect(out.toUpperCase()).toBe('#804C00');
  });

  it('emits rgba() for alpha=0 (fully transparent)', () => {
    const out = resolveColor({ kind: 'srgb', value: '#9E9E9E', alpha: 0 }, THEME);
    expect(out).toBe('rgba(158, 158, 158, 0)');
  });

  it('emits rgba() for partial alpha on an sRGB color', () => {
    const out = resolveColor({ kind: 'srgb', value: '#FF0000', alpha: 0.5 }, THEME);
    expect(out).toBe('rgba(255, 0, 0, 0.5)');
  });

  it('emits rgba() for partial alpha on a role color', () => {
    const out = resolveColor({ kind: 'role', role: 'accent1', alpha: 0.25 }, THEME);
    // accent1 = #FF9900 → rgb(255, 153, 0)
    expect(out).toBe('rgba(255, 153, 0, 0.25)');
  });

  it('skips rgba() when alpha is undefined (regression guard)', () => {
    expect(resolveColor({ kind: 'srgb', value: '#abcdef' }, THEME)).toBe('#abcdef');
  });

  it('skips rgba() when alpha is >= 1 (fully opaque)', () => {
    expect(resolveColor({ kind: 'srgb', value: '#abcdef', alpha: 1 }, THEME)).toBe('#abcdef');
  });

  it('clamps out-of-range alpha to [0, 1]', () => {
    expect(
      resolveColor({ kind: 'srgb', value: '#000000', alpha: -0.5 }, THEME),
    ).toBe('rgba(0, 0, 0, 0)');
    // alpha > 1 takes the fully-opaque fast path (hex).
    expect(
      resolveColor({ kind: 'srgb', value: '#000000', alpha: 2 }, THEME),
    ).toBe('#000000');
  });
});

describe('resolveFont', () => {
  it('returns family verbatim', () => {
    expect(resolveFont({ kind: 'family', family: 'Roboto' }, THEME)).toBe('Roboto');
  });

  it('resolves a heading role', () => {
    expect(resolveFont({ kind: 'role', role: 'heading' }, THEME)).toBe('Inter');
  });

  it('resolves a body role', () => {
    expect(resolveFont({ kind: 'role', role: 'body' }, THEME)).toBe('Inter');
  });
});
