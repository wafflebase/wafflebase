import { describe, it, expect } from 'vitest';
import {
  defaultColorResolver,
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
