import { describe, it, expect } from 'vitest';
import {
  DEFAULT_BLOCK_STYLE,
  DEFAULT_PAGE_SETUP,
  PAPER_SIZES,
  resolvePageSetup,
  getEffectiveDimensions,
} from '../../src/model/types.js';

describe('BlockStyle', () => {
  it('DEFAULT_BLOCK_STYLE includes textIndent and marginLeft at 0', () => {
    expect(DEFAULT_BLOCK_STYLE.textIndent).toBe(0);
    expect(DEFAULT_BLOCK_STYLE.marginLeft).toBe(0);
  });
});

describe('PageSetup', () => {
  it('DEFAULT_PAGE_SETUP uses Letter, portrait, 1-inch margins', () => {
    expect(DEFAULT_PAGE_SETUP.paperSize).toBe(PAPER_SIZES.LETTER);
    expect(DEFAULT_PAGE_SETUP.orientation).toBe('portrait');
    expect(DEFAULT_PAGE_SETUP.margins).toEqual({
      top: 96, bottom: 96, left: 96, right: 96,
    });
  });

  it('resolvePageSetup returns default when undefined', () => {
    expect(resolvePageSetup(undefined)).toEqual(DEFAULT_PAGE_SETUP);
  });

  it('resolvePageSetup returns provided setup', () => {
    const custom = { ...DEFAULT_PAGE_SETUP, paperSize: PAPER_SIZES.A4 };
    expect(resolvePageSetup(custom)).toEqual(custom);
  });

  it('resolvePageSetup returns a defensive copy', () => {
    const resolved = resolvePageSetup(undefined);
    expect(resolved).not.toBe(DEFAULT_PAGE_SETUP);
    expect(resolved.margins).not.toBe(DEFAULT_PAGE_SETUP.margins);
    expect(resolved.paperSize).not.toBe(DEFAULT_PAGE_SETUP.paperSize);
  });

  it('getEffectiveDimensions returns paper size for portrait', () => {
    const dims = getEffectiveDimensions(DEFAULT_PAGE_SETUP);
    expect(dims.width).toBe(816);
    expect(dims.height).toBe(1056);
  });

  it('getEffectiveDimensions swaps width/height for landscape', () => {
    const landscape = { ...DEFAULT_PAGE_SETUP, orientation: 'landscape' as const };
    const dims = getEffectiveDimensions(landscape);
    expect(dims.width).toBe(1056);
    expect(dims.height).toBe(816);
  });
});
