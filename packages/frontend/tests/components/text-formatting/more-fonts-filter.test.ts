/**
 * Tests for the pure "More fonts…" filter.
 */
import { describe, test, expect } from 'vitest';
import { filterFonts } from '../../../src/components/text-formatting/more-fonts-filter.ts';
import type { FontEntry } from '../../../src/components/text-formatting/font-catalog.ts';

const CATALOG: FontEntry[] = [
  { label: '나눔고딕', family: 'Nanum Gothic', group: 'Korean', webFont: true, scripts: ['korean', 'latin'] },
  { label: '맑은 고딕', family: '맑은 고딕', group: 'Korean', webFont: false },
  { label: 'Roboto', family: 'Roboto', group: 'Sans-serif', webFont: true, scripts: ['latin', 'cyrillic'] },
  { label: 'Lobster', family: 'Lobster', group: 'Display', webFont: true, scripts: ['latin'] },
  { label: 'Arial', family: 'Arial', group: 'Sans-serif', webFont: false },
];

const ALL = { query: '', category: 'All', script: 'All' } as const;

describe('filterFonts', () => {
  test('no filters returns the whole catalog in order', () => {
    expect(filterFonts(CATALOG, ALL).map((e) => e.family)).toEqual([
      'Nanum Gothic', '맑은 고딕', 'Roboto', 'Lobster', 'Arial',
    ]);
  });

  test('query matches family OR label, case-insensitively', () => {
    expect(filterFonts(CATALOG, { ...ALL, query: 'rob' }).map((e) => e.family)).toEqual(['Roboto']);
    // Korean label matches even though the family is romanized.
    expect(filterFonts(CATALOG, { ...ALL, query: '나눔' }).map((e) => e.family)).toEqual(['Nanum Gothic']);
  });

  test('category narrows to one group', () => {
    expect(filterFonts(CATALOG, { ...ALL, category: 'Display' }).map((e) => e.family)).toEqual(['Lobster']);
  });

  test('Korean script filter includes web Korean and system Korean (no subsets)', () => {
    expect(filterFonts(CATALOG, { ...ALL, script: 'Korean' }).map((e) => e.family)).toEqual([
      'Nanum Gothic', '맑은 고딕',
    ]);
  });

  test('Latin script filter treats subset-less system fonts as Latin', () => {
    // 맑은 고딕 has no subset list, so it is assumed Latin-capable (Malgun
    // Gothic does carry Latin glyphs) and is included.
    expect(filterFonts(CATALOG, { ...ALL, script: 'Latin' }).map((e) => e.family)).toEqual([
      'Nanum Gothic', '맑은 고딕', 'Roboto', 'Lobster', 'Arial',
    ]);
  });

  test('filters compose (category + script + query)', () => {
    expect(
      filterFonts(CATALOG, { query: 'o', category: 'Sans-serif', script: 'Latin' }).map((e) => e.family),
    ).toEqual(['Roboto']);
  });
});
