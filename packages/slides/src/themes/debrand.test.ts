import { describe, it, expect } from 'vitest';
import { palette } from '@wafflebase/tokens';
import { defaultLight, defaultDark, wafflebase } from './index';

describe('de-branded defaults', () => {
  it('default-light uses a neutral blue accent, not the brand syrup', () => {
    expect(defaultLight.colors.accent1).toBe('#1A73E8');
    expect(defaultLight.colors.accent1).not.toBe(palette.syrup);
  });

  it('default-dark uses a neutral accent, not the brand syrup', () => {
    expect(defaultDark.colors.accent1).toBe('#8AB4F8');
  });

  it('wafflebase carries the brand palette', () => {
    expect(wafflebase.id).toBe('wafflebase');
    expect(wafflebase.colors.accent1).toBe(palette.syrup);
    expect(wafflebase.colors.accent2).toBe(palette.butter);
  });
});
