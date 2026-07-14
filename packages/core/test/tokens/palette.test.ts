import { describe, expect, it } from 'vitest';
import { palette } from '../../src/tokens/palette';

describe('palette', () => {
  it('exposes Butter & Maple core colors', () => {
    expect(palette.syrup).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(palette.butter).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(palette.berry).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(palette.leaf).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('exposes neutral surfaces for both light and dark', () => {
    expect(palette.neutrals.light.bg).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(palette.neutrals.light.ink).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(palette.neutrals.dark.bg).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(palette.neutrals.dark.ink).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });

  it('exposes RGB tuples for alpha composition', () => {
    expect(palette.butterRgb).toMatch(/^\d+,\s*\d+,\s*\d+$/);
    expect(palette.syrupRgb).toMatch(/^\d+,\s*\d+,\s*\d+$/);
  });
});
