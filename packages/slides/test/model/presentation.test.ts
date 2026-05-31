import { describe, it, expect } from 'vitest';
import {
  DOCS_PX_PER_PT,
  deckFontScale,
} from '../../src/model/presentation';

describe('deckFontScale', () => {
  it('returns 1 when pxPerPt is absent (pre-pxPerPt decks render as before)', () => {
    expect(deckFontScale({})).toBe(1);
    expect(deckFontScale({ pxPerPt: undefined })).toBe(1);
  });

  it('returns 1 for the docs baseline (96 DPI)', () => {
    expect(deckFontScale({ pxPerPt: DOCS_PX_PER_PT })).toBeCloseTo(1, 12);
  });

  it('returns the px-per-pt ratio relative to the docs baseline', () => {
    // 13.333-inch widescreen at 1920 px ⇒ 1920 / (13.333 × 72) ≈ 2 px/pt
    // ratio ≈ 2 / (96/72) = 1.5
    expect(deckFontScale({ pxPerPt: 2 })).toBeCloseTo(1.5, 12);
    // 10-inch deck (Google Slides default) at 1920 px ⇒ 2.667 px/pt
    // ratio ≈ 2.667 / (96/72) = 2.0
    expect(deckFontScale({ pxPerPt: 2.6667 })).toBeCloseTo(2.0, 4);
  });

  it('falls back to 1 when pxPerPt is non-positive or non-finite', () => {
    expect(deckFontScale({ pxPerPt: 0 })).toBe(1);
    expect(deckFontScale({ pxPerPt: -1 })).toBe(1);
    expect(deckFontScale({ pxPerPt: NaN })).toBe(1);
    expect(deckFontScale({ pxPerPt: Infinity })).toBe(1);
  });
});
