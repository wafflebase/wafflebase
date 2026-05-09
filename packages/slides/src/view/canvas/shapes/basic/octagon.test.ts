import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import { createTestCanvas } from '../../test-canvas-env';
import { buildOctagon } from './octagon';

describe('buildOctagon', () => {
  it('produces an octagon with default ~29% corner cut', () => {
    const path = buildOctagon({ w: 100, h: 60 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 30)).toBe(true);
    // (1, 1) is well inside the corner cut, so outside the octagon.
    expect(ctx.isPointInPath(path, 1, 1)).toBe(false);
    // (99, 59) sits exactly on the corner cut line — nudge inward
    // to (98, 58) which is unambiguously past the cut.
    expect(ctx.isPointInPath(path, 98, 58)).toBe(false);
  });
});
