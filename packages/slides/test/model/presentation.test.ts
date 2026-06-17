import { describe, it, expect } from 'vitest';
import {
  DOCS_PX_PER_PT,
  MAX_RECENT_COLORS,
  deckFontScale,
  pushRecent,
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

describe('pushRecent', () => {
  it('prepends a new color as most-recent', () => {
    expect(pushRecent(['#ff0000'], '#00ff00')).toEqual(['#00ff00', '#ff0000']);
  });

  it('starts from an empty list', () => {
    expect(pushRecent([], '#123456')).toEqual(['#123456']);
  });

  it('moves an existing color to the front instead of duplicating', () => {
    expect(pushRecent(['#aaa', '#bbb', '#ccc'], '#ccc')).toEqual([
      '#ccc',
      '#aaa',
      '#bbb',
    ]);
  });

  it('de-dupes case-insensitively and normalizes to lower case', () => {
    expect(pushRecent(['#abcdef'], '#ABCDEF')).toEqual(['#abcdef']);
    expect(pushRecent([], '#ABCDEF')).toEqual(['#abcdef']);
  });

  it(`caps the list at MAX_RECENT_COLORS (${MAX_RECENT_COLORS})`, () => {
    let list: string[] = [];
    // Push 12 distinct colors; only the latest 8 survive, newest first.
    for (let i = 0; i < 12; i++) {
      list = pushRecent(list, `#0000${i.toString(16).padStart(2, '0')}`);
    }
    expect(list).toHaveLength(MAX_RECENT_COLORS);
    expect(list[0]).toBe('#00000b'); // 11 = 0x0b, most recent
    expect(list[MAX_RECENT_COLORS - 1]).toBe('#000004'); // oldest kept
  });

  it('does not mutate the input list', () => {
    const input = ['#ff0000'];
    pushRecent(input, '#00ff00');
    expect(input).toEqual(['#ff0000']);
  });
});
