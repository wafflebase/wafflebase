import { describe, it, expect } from 'vitest';
import {
  findMarkerAt,
  type HighlightRect,
} from '../../src/view/comment-markers';

function rect(id: string, x: number, y: number, w = 10, h = 10): HighlightRect {
  return { id, x, y, width: w, height: h };
}

describe('findMarkerAt', () => {
  it('returns null for an empty list', () => {
    expect(findMarkerAt([], 5, 5)).toBeNull();
  });

  it('returns the id of the rect under the point', () => {
    const rects = [rect('a', 0, 0), rect('b', 100, 100)];
    expect(findMarkerAt(rects, 5, 5)).toBe('a');
    expect(findMarkerAt(rects, 105, 105)).toBe('b');
  });

  it('returns null when no rect contains the point', () => {
    const rects = [rect('a', 0, 0), rect('b', 100, 100)];
    expect(findMarkerAt(rects, 50, 50)).toBeNull();
  });

  it('treats left/top edges as inclusive and right/bottom as exclusive', () => {
    const rects = [rect('a', 0, 0, 10, 10)];
    expect(findMarkerAt(rects, 0, 0)).toBe('a');
    expect(findMarkerAt(rects, 9, 9)).toBe('a');
    expect(findMarkerAt(rects, 10, 5)).toBeNull();
    expect(findMarkerAt(rects, 5, 10)).toBeNull();
  });

  it('returns the LAST rect (newest) when rects overlap', () => {
    // Newer threads added later should win at the same hit point.
    const rects = [rect('older', 0, 0, 20, 20), rect('newer', 5, 5, 20, 20)];
    expect(findMarkerAt(rects, 10, 10)).toBe('newer');
  });
});
