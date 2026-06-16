// @vitest-environment jsdom
/**
 * Tests for the recent-fonts store (localStorage-backed).
 *
 * Asserts: round-trip, most-recent-first ordering, de-dup on re-add,
 * a hard cap, and graceful handling of empty / corrupt storage.
 */
import { describe, test, expect, beforeEach } from 'vitest';
import {
  getRecentFonts,
  addRecentFont,
  RECENT_FONTS_MAX,
} from '../../../src/components/text-formatting/font-recents.ts';

const KEY = 'wafflebase:recent-fonts';

beforeEach(() => {
  localStorage.clear();
});

describe('font-recents', () => {
  test('round-trips an added family', () => {
    addRecentFont('Lobster');
    expect(getRecentFonts()).toEqual(['Lobster']);
  });

  test('orders most-recent first', () => {
    addRecentFont('Lobster');
    addRecentFont('Pacifico');
    expect(getRecentFonts()).toEqual(['Pacifico', 'Lobster']);
  });

  test('re-adding an existing family moves it to front without duplicating', () => {
    addRecentFont('Lobster');
    addRecentFont('Pacifico');
    addRecentFont('Lobster');
    expect(getRecentFonts()).toEqual(['Lobster', 'Pacifico']);
  });

  test('caps the list at RECENT_FONTS_MAX, dropping the oldest', () => {
    for (let i = 0; i < RECENT_FONTS_MAX + 3; i++) addRecentFont(`Font ${i}`);
    const recents = getRecentFonts();
    expect(recents).toHaveLength(RECENT_FONTS_MAX);
    // The three oldest were evicted; the newest is first.
    expect(recents[0]).toBe(`Font ${RECENT_FONTS_MAX + 2}`);
    expect(recents).not.toContain('Font 0');
  });

  test('returns [] when storage is empty', () => {
    expect(getRecentFonts()).toEqual([]);
  });

  test('caps on read when storage holds an over-long array', () => {
    const tooMany = Array.from({ length: RECENT_FONTS_MAX + 5 }, (_, i) => `F${i}`);
    localStorage.setItem(KEY, JSON.stringify(tooMany));
    expect(getRecentFonts()).toHaveLength(RECENT_FONTS_MAX);
  });

  test('returns [] (no throw) when storage holds non-JSON garbage', () => {
    localStorage.setItem(KEY, '{not valid json');
    expect(getRecentFonts()).toEqual([]);
  });

  test('ignores a stored value that is not an array of strings', () => {
    localStorage.setItem(KEY, JSON.stringify({ foo: 'bar' }));
    expect(getRecentFonts()).toEqual([]);
  });
});
