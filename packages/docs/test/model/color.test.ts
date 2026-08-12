import { describe, it, expect } from 'vitest';
import {
  defaultColorResolver,
  resolveColorAtPosition,
  resolveStoredColor,
  storedColorsEqual,
  toRgbHexColor,
  wrapLegacyColor,
} from '../../src/model/color.js';

describe('defaultColorResolver', () => {
  it('returns string colors verbatim', () => {
    expect(defaultColorResolver('#abc')).toBe('#abc');
  });
  it('returns srgb values verbatim', () => {
    expect(defaultColorResolver({ kind: 'srgb', value: '#abc' })).toBe('#abc');
  });
  it('returns undefined for role colors (no theme registered)', () => {
    expect(defaultColorResolver({ kind: 'role', role: 'accent1' })).toBeUndefined();
  });
});

describe('wrapLegacyColor', () => {
  it('passes through a string', () => {
    expect(wrapLegacyColor('#abc')).toBe('#abc');
  });
  it('passes through an already-wrapped srgb value (idempotent)', () => {
    const wrapped = { kind: 'srgb' as const, value: '#abc' };
    expect(wrapLegacyColor(wrapped)).toEqual(wrapped);
  });
  it('passes through a role-bound color unchanged', () => {
    const role = { kind: 'role' as const, role: 'accent1' };
    expect(wrapLegacyColor(role)).toEqual(role);
  });
});

describe('storedColorsEqual', () => {
  it('treats identical references as equal', () => {
    const c = { kind: 'srgb' as const, value: '#abc' };
    expect(storedColorsEqual(c, c)).toBe(true);
  });
  it('treats both undefined as equal', () => {
    expect(storedColorsEqual(undefined, undefined)).toBe(true);
  });
  it('treats undefined vs defined as not equal', () => {
    expect(storedColorsEqual(undefined, '#abc')).toBe(false);
    expect(storedColorsEqual('#abc', undefined)).toBe(false);
  });
  it('compares strings by value', () => {
    expect(storedColorsEqual('#abc', '#abc')).toBe(true);
    expect(storedColorsEqual('#abc', '#def')).toBe(false);
  });
  it('treats string vs object with same kind as not equal', () => {
    expect(storedColorsEqual('#abc', { kind: 'srgb', value: '#abc' })).toBe(false);
  });
  it('compares srgb objects by value (catches reference-equality false negatives)', () => {
    expect(
      storedColorsEqual(
        { kind: 'srgb', value: '#abc' },
        { kind: 'srgb', value: '#abc' },
      ),
    ).toBe(true);
    expect(
      storedColorsEqual(
        { kind: 'srgb', value: '#abc' },
        { kind: 'srgb', value: '#def' },
      ),
    ).toBe(false);
  });
  it('compares role objects including tint and shade', () => {
    expect(
      storedColorsEqual(
        { kind: 'role', role: 'accent1' },
        { kind: 'role', role: 'accent1' },
      ),
    ).toBe(true);
    expect(
      storedColorsEqual(
        { kind: 'role', role: 'accent1' },
        { kind: 'role', role: 'accent2' },
      ),
    ).toBe(false);
    expect(
      storedColorsEqual(
        { kind: 'role', role: 'accent1', tint: 0.5 },
        { kind: 'role', role: 'accent1', tint: 0.5 },
      ),
    ).toBe(true);
    expect(
      storedColorsEqual(
        { kind: 'role', role: 'accent1', tint: 0.5 },
        { kind: 'role', role: 'accent1' },
      ),
    ).toBe(false);
  });
  it('treats role vs srgb with same nominal color as not equal', () => {
    expect(
      storedColorsEqual(
        { kind: 'role', role: 'accent1' },
        { kind: 'srgb', value: '#abc' },
      ),
    ).toBe(false);
  });
});

describe('resolveColorAtPosition', () => {
  const fallback = '#000000';
  it('returns the fallback when the block is missing or empty', () => {
    expect(resolveColorAtPosition(undefined, 0, defaultColorResolver, fallback)).toBe(fallback);
    expect(
      resolveColorAtPosition({ inlines: [] }, 0, defaultColorResolver, fallback),
    ).toBe(fallback);
  });

  it('returns the color of the inline whose span covers offset', () => {
    const block = {
      inlines: [
        { text: 'red', style: { color: '#ff0000' } },
        { text: 'blue', style: { color: '#0000ff' } },
      ],
    };
    // offset 0..3 → inside "red"
    expect(resolveColorAtPosition(block, 0, defaultColorResolver, fallback)).toBe('#ff0000');
    expect(resolveColorAtPosition(block, 2, defaultColorResolver, fallback)).toBe('#ff0000');
    // offset 3 sits at the seam — the cursor belongs to the first inline
    // (matches getStyleAtCursor / getSelectionStyle behaviour).
    expect(resolveColorAtPosition(block, 3, defaultColorResolver, fallback)).toBe('#ff0000');
    // offset 4 lands inside "blue"
    expect(resolveColorAtPosition(block, 4, defaultColorResolver, fallback)).toBe('#0000ff');
  });

  it('falls back when the resolved color is undefined (e.g. role with no resolver)', () => {
    const block = {
      inlines: [{ text: 'hi', style: { color: { kind: 'role' as const, role: 'accent1' } } }],
    };
    // defaultColorResolver returns undefined for role colors → fallback.
    expect(resolveColorAtPosition(block, 0, defaultColorResolver, fallback)).toBe(fallback);
  });

  it('honours a theme-aware resolver for role colors', () => {
    const block = {
      inlines: [{ text: 'hi', style: { color: { kind: 'role' as const, role: 'accent1' } } }],
    };
    expect(
      resolveColorAtPosition(
        block,
        0,
        (c) => (c && typeof c === 'object' && c.kind === 'role' ? '#abcdef' : undefined),
        fallback,
      ),
    ).toBe('#abcdef');
  });

  it('returns the fallback when the inline has no color set', () => {
    const block = { inlines: [{ text: 'hi', style: {} }] };
    expect(resolveColorAtPosition(block, 0, defaultColorResolver, fallback)).toBe(fallback);
  });

  // Issue #728: a "reset color" used to be persisted as the empty string,
  // which is not a paintable value — the caret painter must treat it as
  // unset and use the fallback rather than handing '' to `ctx.fillStyle`.
  it('falls back when the covering inline stores the legacy empty-string color', () => {
    const block = { inlines: [{ text: 'hi', style: { color: '' } }] };
    expect(resolveColorAtPosition(block, 0, defaultColorResolver, fallback)).toBe(fallback);
    expect(resolveColorAtPosition(block, 2, defaultColorResolver, fallback)).toBe(fallback);
  });

  it('falls back on the trailing branch when the last inline stores ""', () => {
    // offset past every inline → the `last` branch after the loop.
    const block = {
      inlines: [
        { text: 'ab', style: { color: '#ff0000' } },
        { text: 'cd', style: { color: '' } },
      ],
    };
    expect(resolveColorAtPosition(block, 99, defaultColorResolver, fallback)).toBe(fallback);
  });

  it('shows the empty string to the resolver as "unset" so themes still apply', () => {
    // A theme-aware resolver (slides' `makeColorResolver`) maps a *missing*
    // color to the deck theme's text color. A cleared run must reach that
    // same branch, otherwise a dark deck paints a near-black caret.
    const seen: Array<unknown> = [];
    const themeAware = (c: unknown) => {
      seen.push(c);
      return c == null ? '#ffffff' : '#123456';
    };
    const block = { inlines: [{ text: 'hi', style: { color: '' } }] };
    expect(resolveColorAtPosition(block, 0, themeAware as never, fallback)).toBe('#ffffff');
    expect(seen).toEqual([undefined]);
  });
});

describe('resolveStoredColor', () => {
  it('normalizes the legacy empty-string color to undefined before resolving', () => {
    const seen: Array<unknown> = [];
    const resolver = (c: unknown) => {
      seen.push(c);
      return c == null ? undefined : 'x';
    };
    expect(resolveStoredColor(resolver as never, '')).toBeUndefined();
    expect(seen).toEqual([undefined]);
  });

  it('drops an empty string the resolver itself returns', () => {
    expect(resolveStoredColor(() => '', '#ff0000')).toBeUndefined();
  });

  it('passes real colors through untouched', () => {
    expect(resolveStoredColor(defaultColorResolver, '#ff0000')).toBe('#ff0000');
    expect(resolveStoredColor(defaultColorResolver, { kind: 'srgb', value: '#00ff00' }))
      .toBe('#00ff00');
  });

  it('returns undefined for an unset color so the caller picks the fallback', () => {
    expect(resolveStoredColor(defaultColorResolver, undefined)).toBeUndefined();
  });
});

describe('toRgbHexColor', () => {
  it('normalizes the hex forms to six upper-case digits', () => {
    expect(toRgbHexColor('#ff0000')).toBe('FF0000');
    expect(toRgbHexColor('ff0000')).toBe('FF0000');
    expect(toRgbHexColor('#abc')).toBe('AABBCC');
    // Partial alpha keeps the triplet — rendering it opaque is closer to
    // what the user sees than dropping the color.
    expect(toRgbHexColor('#11223380')).toBe('112233');
    expect(toRgbHexColor('rgba(0, 128, 255, 0.5)')).toBe('0080FF');
  });

  it('converts the CSS rgb() forms browsers hand back on paste', () => {
    expect(toRgbHexColor('rgb(255, 0, 0)')).toBe('FF0000');
    // Out-of-range channels clamp rather than producing >2 hex digits.
    expect(toRgbHexColor('rgb(300, -5, 0)')).toBe('FF0000');
  });

  it('drops a fully transparent color instead of returning an opaque triplet', () => {
    // No OOXML color attribute carries alpha, so keeping the triplet would
    // paint a solid block where the screen shows nothing.
    expect(toRgbHexColor('rgba(0, 0, 0, 0)')).toBeUndefined();
    expect(toRgbHexColor('rgba(255, 255, 255, 0%)')).toBeUndefined();
    expect(toRgbHexColor('#11223300')).toBeUndefined();
  });

  it('returns undefined for anything not expressible as a hex triplet', () => {
    expect(toRgbHexColor('')).toBeUndefined();
    expect(toRgbHexColor(undefined)).toBeUndefined();
    expect(toRgbHexColor('red')).toBeUndefined();
    expect(toRgbHexColor('var(--fg)')).toBeUndefined();
    expect(toRgbHexColor('a" w:themeColor="dark1')).toBeUndefined();
  });
});
