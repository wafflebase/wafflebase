/**
 * Integration test for the lazy full-catalog loader. Resolves the real
 * generated `font-catalog.full.ts` (the dynamic-import target) and checks
 * shape + memoization.
 */
import { describe, test, expect } from 'vitest';
import { loadFullFontCatalog } from '../../../src/components/text-formatting/font-catalog-full-loader.ts';

describe('loadFullFontCatalog', () => {
  test('resolves the full library (>1000 web-font families)', async () => {
    const catalog = await loadFullFontCatalog();
    expect(catalog.length).toBeGreaterThan(1000);
    // Every entry is a Google web font with a valid weight spec.
    for (const e of catalog) {
      expect(e.webFont).toBe(true);
      expect(e.family.length).toBeGreaterThan(0);
      expect(e.weights).toMatch(/^\d+(;\d+)*$/);
    }
  });

  test('contains a well-known family and is memoized across calls', async () => {
    const a = await loadFullFontCatalog();
    const b = await loadFullFontCatalog();
    // Same resolved array instance — the promise is cached, not re-imported.
    expect(a).toBe(b);
    expect(a.some((e) => e.family === 'Roboto')).toBe(true);
  });
});
