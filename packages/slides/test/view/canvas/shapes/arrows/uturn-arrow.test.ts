import { describe, it, expect } from 'vitest';
import '../../../../../src/view/canvas/test-canvas-env';
import { createTestCanvas } from '../../../../../src/view/canvas/test-canvas-env';
import { buildUturnArrow, UTURN_ARROW_HANDLES } from '../../../../../src/view/canvas/shapes/arrows/uturn-arrow';

type Subpath = { kind: 'subpath'; points: Array<{ x: number; y: number }> };
type PathOp = Subpath | { kind: string };

function pathPoints(path: Path2D): Array<{ x: number; y: number }> {
  const ops = (path as unknown as { ops: PathOp[] }).ops;
  const out: Array<{ x: number; y: number }> = [];
  for (const op of ops) {
    if ((op as Subpath).kind === 'subpath') {
      out.push(...(op as Subpath).points);
    }
  }
  return out;
}

describe('buildUturnArrow', () => {
  it('produces a fillable U-shape', () => {
    const path = buildUturnArrow({ w: 200, h: 200 });
    const ctx = createTestCanvas(400, 400).getContext('2d');
    // Inside the left arm (lower portion).
    expect(ctx.isPointInPath(path, 15, 180)).toBe(true);
  });

  // Regression: slide 6 of "Yorkie, 캐즘 뛰어넘기.pptx" carries a
  // uturnArrow at w/h ≈ 13.7. Before the bbox clamp, `outerR` was
  // derived from width alone, so the path reached y ≈ 6.8 × h and the
  // 180° frame rotation painted the overhang above the slide.
  it('keeps every path point inside (w, h) for landscape aspect ratios', () => {
    const w = 1173;
    const h = 85;
    const path = buildUturnArrow({ w, h });
    const pts = pathPoints(path);
    expect(pts.length).toBeGreaterThan(0);
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(-1e-6);
      expect(p.x).toBeLessThanOrEqual(w + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(-1e-6);
      expect(p.y).toBeLessThanOrEqual(h + 1e-6);
    }
  });

  it('still fits a moderately wide aspect (w = 3 × h)', () => {
    const w = 600;
    const h = 200;
    const path = buildUturnArrow({ w, h });
    for (const p of pathPoints(path)) {
      expect(p.y).toBeGreaterThanOrEqual(-1e-6);
      expect(p.y).toBeLessThanOrEqual(h + 1e-6);
    }
  });
});

describe('UTURN_ARROW_HANDLES', () => {
  it('exposes two handles', () => {
    expect(UTURN_ARROW_HANDLES.length).toBe(2);
  });
});
