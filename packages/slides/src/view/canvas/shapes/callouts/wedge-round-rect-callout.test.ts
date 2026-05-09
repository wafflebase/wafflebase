import { describe, it, expect } from 'vitest';
import '../../test-canvas-env';
import { createTestCanvas } from '../../test-canvas-env';
import { buildWedgeRoundRectCallout } from './wedge-round-rect-callout';

describe('buildWedgeRoundRectCallout', () => {
  it('produces a rounded bubble plus a tail when ty falls below h', () => {
    const path = buildWedgeRoundRectCallout({ w: 100, h: 60 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // Default tail [-20833, 62500, 16667] places (tx, ty) ≈ (29.17, 67.5)
    // — below the frame bottom — so the bottom edge sprouts a tail.
    expect(ctx.isPointInPath(path, 50, 30)).toBe(true); // bubble centre
    expect(ctx.isPointInPath(path, 29, 65)).toBe(true); // inside tail
    expect(ctx.isPointInPath(path, 200, 30)).toBe(false); // outside right
    expect(ctx.isPointInPath(path, 50, 100)).toBe(false); // far below tail
  });
});
