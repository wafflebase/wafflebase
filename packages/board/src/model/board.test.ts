import { describe, it, expect } from 'vitest';
import { boardToSlidesDocument, SYNTHETIC_SLIDE_ID } from './board';

describe('boardToSlidesDocument', () => {
  it('produces a one-slide deck carrying the board elements', () => {
    const doc = boardToSlidesDocument({ meta: { title: 'B' }, elements: [] });
    expect(doc.slides).toHaveLength(1);
    expect(doc.slides[0].id).toBe(SYNTHETIC_SLIDE_ID);
    expect(doc.slides[0].elements).toEqual([]);
  });

  it('carries a valid theme/layout/master so getActiveTheme resolves', async () => {
    const { getActiveTheme, deckSlideHeight } = await import('@wafflebase/slides');
    const doc = boardToSlidesDocument({ meta: { title: 'B' }, elements: [] });
    expect(() => getActiveTheme(doc)).not.toThrow();
    expect(deckSlideHeight(doc.meta)).toBeGreaterThan(0);
  });
});
