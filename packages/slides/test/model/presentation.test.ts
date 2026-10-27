import { describe, it, expect } from 'vitest';
import {
  DOCS_PX_PER_PT,
  MAX_DECK_FONT_SCALE,
  MAX_DECK_SLIDE_HEIGHT,
  MAX_RECENT_COLORS,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  deckFontScale,
  deckSlideHeight,
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

  it(`clamps a finite pxPerPt at MAX_DECK_FONT_SCALE (${MAX_DECK_FONT_SCALE})`, () => {
    // `meta` is peer-writable on the Yorkie root and survives `migrateMeta`
    // as long as it is finite and positive, and this scale multiplies every
    // font size the renderer hands docs. Without a ceiling a `pxPerPt: 1e9`
    // turns an already-banded MAX_FONT_SIZE run into a ~3e12 px line — the
    // same blank / huge-allocation render the block bands exist to prevent,
    // reached through the multiplier instead of the value.
    expect(deckFontScale({ pxPerPt: 1e9 })).toBe(MAX_DECK_FONT_SCALE);
  });

  it('leaves the narrowest deck OOXML can express unclamped', () => {
    // `ST_SlideSizeCoordinate` bottoms out at 914400 EMU (1 inch), so the
    // largest scale the PPTX importer — the only producer of `pxPerPt` — can
    // compute is for a 1-inch-wide deck. The ceiling sits exactly there, so
    // no importable deck is scaled down by it.
    const narrowest = SLIDE_WIDTH / (1 * 72);
    expect(deckFontScale({ pxPerPt: narrowest })).toBeCloseTo(
      MAX_DECK_FONT_SCALE,
      9,
    );
  });
});

describe('deckSlideHeight', () => {
  it('falls back to SLIDE_HEIGHT when absent or invalid', () => {
    expect(deckSlideHeight({})).toBe(SLIDE_HEIGHT);
    expect(deckSlideHeight({ slideHeight: 0 })).toBe(SLIDE_HEIGHT);
    expect(deckSlideHeight({ slideHeight: -1 })).toBe(SLIDE_HEIGHT);
    expect(deckSlideHeight({ slideHeight: NaN })).toBe(SLIDE_HEIGHT);
    expect(deckSlideHeight({ slideHeight: Infinity })).toBe(SLIDE_HEIGHT);
  });

  it('returns a 4:3 deck height unchanged', () => {
    expect(deckSlideHeight({ slideHeight: 1440 })).toBe(1440);
  });

  it(`clamps a finite slideHeight at MAX_DECK_SLIDE_HEIGHT (${MAX_DECK_SLIDE_HEIGHT})`, () => {
    // Every renderer sizes a canvas or DOM box from this height, and
    // `meta` is writable by a peer and by `PUT .../content` with only a
    // finite-positive check, so `1e12` must not reach a canvas.
    expect(deckSlideHeight({ slideHeight: 1e12 })).toBe(MAX_DECK_SLIDE_HEIGHT);
  });

  it('leaves the tallest deck OOXML can express unclamped', () => {
    // `ST_SlideSizeCoordinate` spans 1″‥56″, so the tallest aspect the
    // PPTX importer can compute is 56:1.
    const tallest = Math.round((SLIDE_WIDTH * 51_206_400) / 914_400);
    expect(deckSlideHeight({ slideHeight: tallest })).toBe(tallest);
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
