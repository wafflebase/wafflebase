import { describe, it, expect } from 'vitest';
import { defaultColorResolver, wrapLegacyColor } from '../../src/model/color.js';

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
});
