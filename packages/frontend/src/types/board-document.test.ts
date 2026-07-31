import { describe, it, expect } from 'vitest';
import { initialBoardRoot } from './board-document';

describe('board-document', () => {
  it('initialBoardRoot seeds an empty elements array + title', () => {
    const r = initialBoardRoot();
    expect(r.elements).toEqual([]);
    expect(typeof r.meta?.title).toBe('string');
  });
});
