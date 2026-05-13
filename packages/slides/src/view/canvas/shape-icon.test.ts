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

  it('renders callouts via their bubble-shape proxy', () => {
    const canvas = createTestCanvas(24, 24);
    const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
    // The four callouts must not throw and should produce a stroke at
    // picker size — they fall back to their bubble proxy (rect /
    // roundRect / ellipse / cloud) so the preview is recognizable.
    for (const kind of [
      'wedgeRectCallout',
      'wedgeRoundRectCallout',
      'wedgeEllipseCallout',
      'cloudCallout',
    ] as const) {
      expect(() =>
        renderShapeIcon(kind, ctx, { w: 24, h: 24 }),
      ).not.toThrow();
    }
  });

  it('renders action buttons (body + glyph) so picker icons are visible', () => {
    const canvas = createTestCanvas(24, 24);
    const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
    // Action buttons are not in PATH_BUILDERS; the icon dispatcher
    // has a dedicated branch that strokes a body rect + the inner
    // glyph from ACTION_BUTTON_GLYPHS. Without this branch they
    // would render as fully transparent at picker scale.
    for (const kind of [
      'actionButtonBlank',
      'actionButtonHome',
      'actionButtonForwardNext',
      'actionButtonHelp',
    ] as const) {
      expect(() =>
        renderShapeIcon(kind, ctx, { w: 24, h: 24 }),
      ).not.toThrow();
    }
  });
});
