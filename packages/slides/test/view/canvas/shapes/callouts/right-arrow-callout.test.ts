import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildRightArrowCallout } from '../../../../../src/view/canvas/shapes/callouts/right-arrow-callout';
import { buildLeftArrowCallout } from '../../../../../src/view/canvas/shapes/callouts/left-arrow-callout';
import { buildUpArrowCallout } from '../../../../../src/view/canvas/shapes/callouts/up-arrow-callout';
import { buildDownArrowCallout } from '../../../../../src/view/canvas/shapes/callouts/down-arrow-callout';
import { buildLeftRightArrowCallout } from '../../../../../src/view/canvas/shapes/callouts/left-right-arrow-callout';
import { buildUpDownArrowCallout } from '../../../../../src/view/canvas/shapes/callouts/up-down-arrow-callout';
import { buildQuadArrowCallout } from '../../../../../src/view/canvas/shapes/callouts/quad-arrow-callout';

const ctx = createTestCanvas(400, 400).getContext('2d');

describe('arrow callouts', () => {
  it('rightArrowCallout: body on the left, arrow tip touches right edge', () => {
    const path = buildRightArrowCallout({ w: 200, h: 100 });
    expect(ctx.isPointInPath(path, 30, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 199, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 195, 2)).toBe(false);
  });

  it('leftArrowCallout: mirror of right (body on right)', () => {
    const path = buildLeftArrowCallout({ w: 200, h: 100 });
    expect(ctx.isPointInPath(path, 170, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 1, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 5, 2)).toBe(false);
  });

  it('upArrowCallout: body on bottom, tip at top', () => {
    const path = buildUpArrowCallout({ w: 100, h: 200 });
    expect(ctx.isPointInPath(path, 50, 170)).toBe(true);
    expect(ctx.isPointInPath(path, 50, 1)).toBe(true);
    expect(ctx.isPointInPath(path, 2, 5)).toBe(false);
  });

  it('downArrowCallout: body on top, tip at bottom', () => {
    const path = buildDownArrowCallout({ w: 100, h: 200 });
    expect(ctx.isPointInPath(path, 50, 30)).toBe(true);
    expect(ctx.isPointInPath(path, 50, 199)).toBe(true);
    expect(ctx.isPointInPath(path, 2, 195)).toBe(false);
  });

  it('leftRightArrowCallout: body in middle, tips at both horizontal ends', () => {
    const path = buildLeftRightArrowCallout({ w: 300, h: 100 });
    expect(ctx.isPointInPath(path, 150, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 1, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 299, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 5, 5)).toBe(false);
  });

  it('upDownArrowCallout: body in middle, tips at both vertical ends', () => {
    const path = buildUpDownArrowCallout({ w: 100, h: 300 });
    expect(ctx.isPointInPath(path, 50, 150)).toBe(true);
    expect(ctx.isPointInPath(path, 50, 1)).toBe(true);
    expect(ctx.isPointInPath(path, 50, 299)).toBe(true);
  });

  it('quadArrowCallout: square body in centre, four tips touching edges', () => {
    const path = buildQuadArrowCallout({ w: 200, h: 200 });
    expect(ctx.isPointInPath(path, 100, 100)).toBe(true);
    expect(ctx.isPointInPath(path, 100, 1)).toBe(true);
    expect(ctx.isPointInPath(path, 1, 100)).toBe(true);
    expect(ctx.isPointInPath(path, 199, 100)).toBe(true);
    expect(ctx.isPointInPath(path, 100, 199)).toBe(true);
    expect(ctx.isPointInPath(path, 10, 10)).toBe(false);
  });

  it('handles degenerate frames without throwing', () => {
    for (const build of [
      buildRightArrowCallout,
      buildLeftArrowCallout,
      buildUpArrowCallout,
      buildDownArrowCallout,
      buildLeftRightArrowCallout,
      buildUpDownArrowCallout,
      buildQuadArrowCallout,
    ]) {
      expect(() => build({ w: 0, h: 0 })).not.toThrow();
      expect(() => build({ w: 1, h: 1 })).not.toThrow();
    }
  });

  it('respects the slide 7 adj1..adj4 from the Yorkie 캐즘 deck', () => {
    // Slide 7's middle shape:
    //   adj1=9283 (very thin shaft), adj2=13570, adj3=16082, adj4=81236
    const path = buildRightArrowCallout({ w: 200, h: 100 }, [
      9283, 13570, 16082, 81236,
    ]);
    expect(ctx.isPointInPath(path, 100, 50)).toBe(true);
    expect(ctx.isPointInPath(path, 199, 50)).toBe(true);
  });
});
