import { describe, it, expect } from 'vitest';
import { ARC_HANDLES } from './arc';

describe('ARC_HANDLES', () => {
  it('exposes two angular handles', () => {
    expect(ARC_HANDLES.length).toBe(2);
  });

  it('apply at 90° pointer maps to 90° OOXML', () => {
    const next = ARC_HANDLES[0].apply(
      { w: 200, h: 200 },
      [16200000, 0],
      { x: 100, y: 200 },
    );
    expect(next[0]).toBe(90 * 60000);
  });
});
