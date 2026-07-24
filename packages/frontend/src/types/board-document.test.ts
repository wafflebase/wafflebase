import { describe, it, expect } from 'vitest';
import { initialBoardRoot, boardUserColor } from './board-document';

describe('board-document', () => {
  it('initialBoardRoot seeds an empty elements array + title', () => {
    const r = initialBoardRoot();
    expect(r.elements).toEqual([]);
    expect(typeof r.meta?.title).toBe('string');
  });
  it('boardUserColor is deterministic per username', () => {
    expect(boardUserColor('kim')).toBe(boardUserColor('kim'));
  });
});
