import { describe, it, expect } from 'vitest';
import { PARALLELOGRAM_HANDLES } from './parallelogram';

describe('PARALLELOGRAM_HANDLES', () => {
  it('registers a single linear-x handle on the top edge', () => {
    expect(PARALLELOGRAM_HANDLES).toHaveLength(1);
    const p = PARALLELOGRAM_HANDLES[0].position({ w: 200, h: 100 }, [25000]);
    expect(p).toEqual({ x: 50, y: 0 }); // 25% slant at default
  });
});
