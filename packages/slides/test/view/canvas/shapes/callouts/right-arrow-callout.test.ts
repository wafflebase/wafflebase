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

  // OOXML flare: at default adjustments the arrowhead is wider than the
  // shaft. head half-thickness = ss·a2/100000, shaft half = ss·a1/200000,
  // so at default a1=a2 the head is ~2× the shaft. Each assertion below
  // probes a point just outside the shaft half-thickness but inside the
  // head half-thickness, at the arrowhead base — it must be in the path.
  describe('arrowhead flares wider than the shaft (OOXML geometry)', () => {
    // OOXML head depth = ss·adj3/100000 (ss = min(w,h)), so on a 2:1 frame
    // (ss=100, adj3=25000) the head is 25 deep — the seam sits 25 from the
    // tip edge, NOT w·adj3 from it.
    it('rightArrowCallout: head base wider than shaft', () => {
      // w=200,h=100 → ss=100; shaft half=12.5, head half=25; cy=50.
      // Seam (shaft→head) at x = w - ss·adj3/100000 = 175.
      const path = buildRightArrowCallout({ w: 200, h: 100 });
      // Just past the seam (in the head), beyond the shaft edge (62.5)
      // but inside the head edge (~75): inside the path.
      expect(ctx.isPointInPath(path, 176, 68)).toBe(true);
      // Same vertical offset in the shaft body (x<175): outside.
      expect(ctx.isPointInPath(path, 174, 68)).toBe(false);
    });

    it('leftArrowCallout: head base wider than shaft', () => {
      // Seam at x = ss·adj3/100000 = 25.
      const path = buildLeftArrowCallout({ w: 200, h: 100 });
      expect(ctx.isPointInPath(path, 24, 68)).toBe(true);
      expect(ctx.isPointInPath(path, 26, 68)).toBe(false);
    });

    it('upArrowCallout: head base wider than shaft', () => {
      // w=100,h=200 → ss=100; shaft half=12.5, head half=25; cx=50.
      // Seam (shaft→head) at y = ss·adj3/100000 = 25.
      const path = buildUpArrowCallout({ w: 100, h: 200 });
      expect(ctx.isPointInPath(path, 68, 24)).toBe(true);
      expect(ctx.isPointInPath(path, 68, 26)).toBe(false);
    });

    it('downArrowCallout: head base wider than shaft', () => {
      // Seam at y = h - ss·adj3/100000 = 175.
      const path = buildDownArrowCallout({ w: 100, h: 200 });
      expect(ctx.isPointInPath(path, 68, 176)).toBe(true);
      expect(ctx.isPointInPath(path, 68, 174)).toBe(false);
    });

    it('leftRightArrowCallout: head base wider than shaft', () => {
      // w=300,h=100 → ss=100; shaft half=12.5, head half=25; cy=50.
      // Left seam at x = ss·adj3/100000 = 25.
      const path = buildLeftRightArrowCallout({ w: 300, h: 100 });
      expect(ctx.isPointInPath(path, 24, 68)).toBe(true);
      expect(ctx.isPointInPath(path, 26, 68)).toBe(false);
    });

    it('upDownArrowCallout: head base wider than shaft', () => {
      // w=100,h=300 → ss=100; shaft half=12.5, head half=25; cx=50.
      // Top seam at y = ss·adj3/100000 = 25.
      const path = buildUpDownArrowCallout({ w: 100, h: 300 });
      expect(ctx.isPointInPath(path, 68, 24)).toBe(true);
      expect(ctx.isPointInPath(path, 68, 26)).toBe(false);
    });

    it('quadArrowCallout: head base wider than shaft', () => {
      // w=200,h=200 → ss=200; a=18515; shaft half=18.515,
      // head half=37.03; cx=cy=100. Top head base at y=depth≈37.03,
      // where the head spans cx±37.03 but the shaft only cx±18.515.
      const path = buildQuadArrowCallout({ w: 200, h: 200 });
      // Just above the head base (in the flaring head): x=130 is offset
      // 30 from centre — beyond the shaft half (18.515) but inside the
      // head half (~37): inside the path.
      expect(ctx.isPointInPath(path, 130, 37)).toBe(true);
      // Same horizontal offset just below the base (in the shaft): outside.
      expect(ctx.isPointInPath(path, 130, 38)).toBe(false);
    });
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
