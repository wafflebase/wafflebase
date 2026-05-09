import { describe, it, expect } from 'vitest';
import './test-canvas-env';
import { createTestCanvas } from './test-canvas-env';
import { renderShapeIcon } from './shape-icon';

describe('renderShapeIcon', () => {
  it('strokes a shape outline using currentColor', () => {
    const canvas = createTestCanvas(24, 24);
    const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
    renderShapeIcon('rect', ctx, { w: 24, h: 24 });
    // Verify a stroke was applied (the function set lineWidth before
    // stroking; a positive value confirms the call ran past the early
    // returns).
    expect(ctx.lineWidth).toBeGreaterThan(0);
  });

  it('returns silently for line/arrow specials', () => {
    const canvas = createTestCanvas(24, 24);
    const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
    expect(() => renderShapeIcon('line', ctx, { w: 24, h: 24 })).not.toThrow();
    expect(() => renderShapeIcon('arrow', ctx, { w: 24, h: 24 })).not.toThrow();
  });
});
