import { describe, it, expect } from 'vitest';
import { worldToScreen, screenToWorld, type Viewport } from './viewport';

const v: Viewport = { panX: 100, panY: 40, zoom: 2 };

describe('viewport transforms', () => {
  it('worldToScreen applies zoom then pan', () => {
    expect(worldToScreen(v, { x: 10, y: 5 })).toEqual({ x: 120, y: 50 });
  });
  it('screenToWorld is the inverse of worldToScreen', () => {
    const world = { x: -37.5, y: 12.25 };
    const round = screenToWorld(v, worldToScreen(v, world));
    expect(round.x).toBeCloseTo(world.x, 10);
    expect(round.y).toBeCloseTo(world.y, 10);
  });
});
