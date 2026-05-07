import { describe, it, expect } from 'vitest';
import {
  resolveColor,
  resolveFont,
  type ColorScheme,
  type FontScheme,
  type Theme,
} from './theme';

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
