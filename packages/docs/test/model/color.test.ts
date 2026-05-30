import { describe, it, expect } from 'vitest';
import {
  defaultColorResolver,
  resolveColorAtPosition,
  storedColorsEqual,
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
});
