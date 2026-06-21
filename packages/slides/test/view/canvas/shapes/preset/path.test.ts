import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildPresetPath } from '../../../../../src/view/canvas/shapes/preset/path';
import type { PresetShapeDef } from '../../../../../src/view/canvas/shapes/preset/types';

describe('buildPresetPath', () => {
  it('renders a move/line/close polygon (triangle)', () => {
    const tri: PresetShapeDef = {
      adj: {},
      guides: [],
      paths: [
        {
          cmds: [
            { t: 'move', pt: { x: 'hc', y: 't' } },
            { t: 'line', pt: { x: 'r', y: 'b' } },
            { t: 'line', pt: { x: 'l', y: 'b' } },
            { t: 'close' },
          ],
        },
      ],
    };
    const path = buildPresetPath(tri, { w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 70)).toBe(true); // inside lower middle
    expect(ctx.isPointInPath(path, 5, 5)).toBe(false); // top-left corner outside
  });

  it('arcTo traces an ellipse around the frame centre', () => {
    // Two 180° arcs form a full ellipse inscribed in the frame.
    const circle: PresetShapeDef = {
      adj: {},
      guides: [],
      paths: [
        {
          cmds: [
            { t: 'move', pt: { x: 'r', y: 'vc' } },
            { t: 'arc', wR: 'wd2', hR: 'hd2', stAng: '0', swAng: 'cd2' },
            { t: 'arc', wR: 'wd2', hR: 'hd2', stAng: 'cd2', swAng: 'cd2' },
            { t: 'close' },
          ],
        },
      ],
    };
    const path = buildPresetPath(circle, { w: 200, h: 100 });
    const ctx = createTestCanvas(300, 300).getContext('2d');
    expect(ctx.isPointInPath(path, 100, 50)).toBe(true); // centre
    expect(ctx.isPointInPath(path, 195, 50)).toBe(true); // near right edge
    expect(ctx.isPointInPath(path, 5, 5)).toBe(false); // corner outside ellipse
  });

  it('arcTo uses geometric (ray) angles, not the ellipse parameter', () => {
    // Quarter elliptical arc wR=200,hR=100, start at geometric 0°,
    // sweep +45°. The geometric-45° endpoint is the ray–ellipse
    // intersection ≈ (+89.44, +89.44) from the centre; the (wrong)
    // parametric reading would land at (200cos45, 100sin45) ≈
    // (141.4, 70.7). Start point is (cx+200, cy) so cx=cy=0 here.
    const def: PresetShapeDef = {
      adj: {},
      guides: [],
      paths: [
        {
          cmds: [
            { t: 'move', pt: { x: 'r', y: 'vc' } }, // (400,100) ⇒ centre (200,100)
            { t: 'arc', wR: '200', hR: '100', stAng: '0', swAng: 'cd8' },
            { t: 'close' },
          ],
        },
      ],
    };
    const path = buildPresetPath(def, { w: 400, h: 200 });
    const ops = (path as unknown as {
      ops: Array<{ kind: string; points?: Array<{ x: number; y: number }> }>;
    }).ops;
    const pts = ops.flatMap((o) => o.points ?? []);
    const end = pts[pts.length - 1];
    // centre is (200,100); geometric-45° endpoint ≈ (289.44, 189.44).
    expect(end.x).toBeCloseTo(289.44, 0);
    expect(end.y).toBeCloseTo(189.44, 0);
  });

  it('skips fill="none" outline sub-paths', () => {
    // Body square + a fill="none" outline that would, if included,
    // add a second winding. The square alone must contain its centre.
    const def: PresetShapeDef = {
      adj: {},
      guides: [],
      paths: [
        {
          cmds: [
            { t: 'move', pt: { x: 'l', y: 't' } },
            { t: 'line', pt: { x: 'r', y: 't' } },
            { t: 'line', pt: { x: 'r', y: 'b' } },
            { t: 'line', pt: { x: 'l', y: 'b' } },
            { t: 'close' },
          ],
        },
        {
          fill: 'none',
          cmds: [
            { t: 'move', pt: { x: 'l', y: 't' } },
            { t: 'line', pt: { x: 'hc', y: 'vc' } },
          ],
        },
      ],
    };
    const path = buildPresetPath(def, { w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
  });

  it('flattens a quadratic Bézier between its endpoints', () => {
    const def: PresetShapeDef = {
      adj: {},
      guides: [],
      paths: [
        {
          cmds: [
            { t: 'move', pt: { x: 'l', y: 'b' } },
            { t: 'quad', c: { x: 'hc', y: 't' }, pt: { x: 'r', y: 'b' } },
            { t: 'close' },
          ],
        },
      ],
    };
    const path = buildPresetPath(def, { w: 100, h: 100 });
    const ctx = createTestCanvas(200, 200).getContext('2d');
    // The arch peaks ~mid-height at x=50; a point just under it is inside.
    expect(ctx.isPointInPath(path, 50, 80)).toBe(true);
  });
});
