import { describe, it, expect } from 'vitest';
import {
  applyShade,
  resolveColor,
  resolveFont,
  type ColorScheme,
  type FontScheme,
  type Theme,
} from '../../src/model/theme';

describe('applyShade', () => {
  it('returns the color unchanged at delta 0', () => {
    expect(applyShade('#808080', 0)).toBe('#808080');
  });

  it('lightens toward white for positive delta', () => {
    expect(applyShade('#808080', 0.5)).toBe('#C0C0C0');
  });

  it('darkens toward black for negative delta', () => {
    expect(applyShade('#808080', -0.5)).toBe('#404040');
  });

  it('shades rgba channels and preserves alpha', () => {
    expect(applyShade('rgba(128, 128, 128, 0.5)', -0.5)).toBe(
      'rgba(64, 64, 64, 0.5)',
    );
  });

  it('returns a malformed rgba() input unchanged (no NaN channels)', () => {
    // A non-numeric channel would otherwise recompose into rgba(NaN,...).
    expect(applyShade('rgba(foo, 128, 128, 0.5)', -0.5)).toBe(
      'rgba(foo, 128, 128, 0.5)',
    );
    expect(applyShade('rgba(128, 128, 128, bar)', 0.5)).toBe(
      'rgba(128, 128, 128, bar)',
    );
  });
});

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

  it('applies lumMod to a role color (HSL luminance scale)', () => {
    // bg1 = #FFFFFF (HSL L=1). lumMod 0.95 → L=0.95 → #F2F2F2.
    // This is the exact case from the slide-21 roadmap diagram where
    // a `<a:schemeClr val="bg1"><a:lumMod val="95000"/>` light-gray
    // ellipse was rendering as pure white (invisible on white slide).
    expect(
      resolveColor({ kind: 'role', role: 'background', lumMod: 0.95 }, THEME),
    ).toBe('#F2F2F2');
    // lumMod 0.75 → mid-gray border on the same diagram.
    expect(
      resolveColor({ kind: 'role', role: 'background', lumMod: 0.75 }, THEME),
    ).toBe('#BFBFBF');
  });

  it('applies lumOff to a role color (HSL luminance offset)', () => {
    // dk1 = #000000 (HSL L=0). lumOff 0.5 → L=0.5 → #808080.
    expect(
      resolveColor({ kind: 'role', role: 'text', lumOff: 0.5 }, THEME),
    ).toBe('#808080');
  });

  it('combines lumMod and lumOff (PowerPoint applies mod then off)', () => {
    // accent1 = #FF9900 → HSL ≈ (36°, 100%, 50%). lumMod 0.5 → L=0.25,
    // then lumOff 0.25 → L=0.5. Back to the same brightness, hue/sat
    // preserved → original color.
    expect(
      resolveColor(
        { kind: 'role', role: 'accent1', lumMod: 0.5, lumOff: 0.25 },
        THEME,
      ).toUpperCase(),
    ).toBe('#FF9900');
  });

  it('clamps luminance to [0, 1] when lumMod/lumOff drive it out of range', () => {
    // background L=1, lumOff 0.5 would push L=1.5; clamps to 1 → white.
    expect(
      resolveColor({ kind: 'role', role: 'background', lumOff: 0.5 }, THEME),
    ).toBe('#FFFFFF');
    // text L=0, lumOff -0.5 would push L=-0.5; clamps to 0 → black.
    expect(
      resolveColor({ kind: 'role', role: 'text', lumOff: -0.5 }, THEME),
    ).toBe('#000000');
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
