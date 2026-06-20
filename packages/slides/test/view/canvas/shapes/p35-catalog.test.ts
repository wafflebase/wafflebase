import { describe, it, expect } from 'vitest';
import '../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../src/view/canvas/test-canvas-env';
import { PATH_BUILDERS } from '../../../../src/view/canvas/shapes/index';
import type { ShapeKind } from '../../../../src/model/element';
import { buildStar12 } from '../../../../src/view/canvas/shapes/stars/star12';
import { buildIrregularSeal1 } from '../../../../src/view/canvas/shapes/stars/irregular-seal-1';
import { buildIrregularSeal2 } from '../../../../src/view/canvas/shapes/stars/irregular-seal-2';
import { buildWave } from '../../../../src/view/canvas/shapes/banners/wave';
import { buildDoubleWave } from '../../../../src/view/canvas/shapes/banners/double-wave';
import { buildBracePair } from '../../../../src/view/canvas/shapes/basic/brace-pair';
import { buildBracketPair } from '../../../../src/view/canvas/shapes/basic/bracket-pair';
import {
  buildEllipseRibbon,
  buildEllipseRibbon2,
} from '../../../../src/view/canvas/shapes/banners/ellipse-ribbon';

const ctx = createTestCanvas(200, 200).getContext('2d');

describe('P3.5 catalog — closed shapes', () => {
  it('high-point star contains the centre, excludes the corners', () => {
    const path = buildStar12({ w: 100, h: 100 });
    expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
    // Star inner ring well within the frame → corners are empty.
    expect(ctx.isPointInPath(path, 2, 2)).toBe(false);
  });

  it('explosions contain the centre and stay within the frame box', () => {
    for (const build of [buildIrregularSeal1, buildIrregularSeal2]) {
      const path = build({ w: 100, h: 100 });
      expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
      expect(ctx.isPointInPath(path, -1, -1)).toBe(false);
      expect(ctx.isPointInPath(path, 101, 101)).toBe(false);
    }
  });

  it('curved ribbons contain the band centre and build at varied frames', () => {
    for (const build of [buildEllipseRibbon, buildEllipseRibbon2]) {
      const path = build({ w: 400, h: 140 }, undefined);
      // The band passes through the vertical centre at mid-width.
      expect(ctx.isPointInPath(path, 200, 70)).toBe(true);
      for (const size of [
        { w: 100, h: 100 },
        { w: 480, h: 80 },
        { w: 1, h: 1 },
      ]) {
        expect(() => build(size, undefined)).not.toThrow();
      }
    }
  });

  it('wave band contains the vertical centre, excludes top/bottom edges', () => {
    for (const build of [buildWave, buildDoubleWave]) {
      const path = build({ w: 100, h: 100 }, undefined);
      expect(ctx.isPointInPath(path, 50, 50)).toBe(true);
      // The amplitude reserves space at the very top and bottom.
      expect(ctx.isPointInPath(path, 50, 0)).toBe(false);
      expect(ctx.isPointInPath(path, 50, 100)).toBe(false);
    }
  });
});

describe('P3.5 catalog — bracket/brace pairs', () => {
  // Open, stroke-only shapes: assert the geometry is non-degenerate
  // across sizes rather than fill containment.
  it('build without throwing at varied frames', () => {
    for (const build of [buildBracketPair, buildBracePair]) {
      for (const size of [
        { w: 100, h: 100 },
        { w: 20, h: 200 },
        { w: 200, h: 20 },
        { w: 1, h: 1 },
      ]) {
        expect(() => build(size, undefined)).not.toThrow();
        expect(build(size, undefined)).toBeInstanceOf(Path2D);
      }
    }
  });
});

describe('P3.5 catalog — registry coverage', () => {
  const kinds: ShapeKind[] = [
    'star12',
    'star16',
    'star24',
    'star32',
    'irregularSeal1',
    'irregularSeal2',
    'wave',
    'doubleWave',
    'ellipseRibbon',
    'ellipseRibbon2',
    'bracketPair',
    'bracePair',
    'flowChartPreparation',
    'flowChartConnector',
    'flowChartCollate',
    'flowChartSort',
    'flowChartExtract',
    'flowChartMerge',
    'flowChartOnlineStorage',
    'flowChartMagneticDisk',
    'flowChartMagneticDrum',
    'flowChartMagneticTape',
  ];

  it('registers a path builder for every new kind', () => {
    for (const kind of kinds) {
      expect(PATH_BUILDERS.has(kind)).toBe(true);
    }
  });
});
