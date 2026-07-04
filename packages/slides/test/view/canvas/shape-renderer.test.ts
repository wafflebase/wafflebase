import { describe, it, expect, vi } from 'vitest';
import type { ShapeElement } from '../../../src/model/element';
import type { Theme } from '../../../src/model/theme';
import { asCtx, createCtxSpy } from '../../../src/view/canvas/ctx-spy';
// Install Path2D global before importing the renderer/builders.
import '../../../src/view/canvas/test-canvas-env';
import {
  drawShape,
  shapeTextInset,
  shapeTextFrame,
  SHAPE_TEXT_PADDING,
} from '../../../src/view/canvas/shape-renderer';

const THEME: Theme = {
  id: 't', name: 't',
  colors: {
    text: '#000', background: '#fff', textSecondary: '#444', backgroundAlt: '#f3f3f3',
    accent1: '#abc', accent2: '#bcd', accent3: '#cde', accent4: '#def',
    accent5: '#e0e1e2', accent6: '#f0f1f2',
    hyperlink: '#11c', visitedHyperlink: '#71a',
  },
  fonts: { heading: 'Inter', body: 'Inter' },
};

const size = { w: 100, h: 60 };
const shape = (data: ShapeElement['data']): ShapeElement['data'] => data;
const srgb = (value: string) => ({ kind: 'srgb' as const, value });

describe('drawShape — rect', () => {
  it('fills a rectangle path with the given fill', () => {
    const ctx = createCtxSpy();
    drawShape(asCtx(ctx), size, shape({ kind: 'rect', fill: srgb('#abc') }), THEME);
    expect(ctx.fillStyle).toBe('#abc');
    expect(ctx.fill).toHaveBeenCalledTimes(1);
    expect(ctx.fill.mock.calls[0][0]).toBeInstanceOf(Path2D);
  });

  it('strokes a rectangle path when stroke is set', () => {
    const ctx = createCtxSpy();
    drawShape(asCtx(ctx), size, shape({
      kind: 'rect', stroke: { color: srgb('#000'), width: 3 },
    }), THEME);
    expect(ctx.strokeStyle).toBe('#000');
    expect(ctx.lineWidth).toBe(3);
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
    expect(ctx.stroke.mock.calls[0][0]).toBeInstanceOf(Path2D);
  });

  it('skips fill and stroke when neither is set', () => {
    const ctx = createCtxSpy();
    drawShape(asCtx(ctx), size, shape({ kind: 'rect' }), THEME);
    expect(ctx.fill).not.toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  it('resolves a role-bound fill through the theme', () => {
    const ctx = createCtxSpy();
    drawShape(asCtx(ctx), size, shape({
      kind: 'rect', fill: { kind: 'role', role: 'accent1' },
    }), THEME);
    expect(ctx.fillStyle).toBe('#abc'); // accent1
  });
});

describe('drawShape — ellipse', () => {
  it('fills an ellipse path with the given fill', () => {
    const ctx = createCtxSpy();
    drawShape(asCtx(ctx), size, shape({ kind: 'ellipse', fill: srgb('#0a0') }), THEME);
    expect(ctx.fillStyle).toBe('#0a0');
    expect(ctx.fill).toHaveBeenCalledTimes(1);
    // Dispatcher passes a Path2D produced by buildEllipse; the actual
    // ellipse() call lives on Path2D and is opaque to the spy. Assert
    // on the dispatcher-level signal: a single Path2D argument (not the
    // 'evenodd' fill-rule literal that donut/star will use later).
    expect(ctx.fill.mock.calls[0][0]).toBeInstanceOf(Path2D);
  });

  it('resolves a role-bound fill through the theme', () => {
    const ctx = createCtxSpy();
    drawShape(asCtx(ctx), size, shape({
      kind: 'ellipse', fill: { kind: 'role', role: 'accent2' },
    }), THEME);
    expect(ctx.fillStyle).toBe('#bcd'); // accent2
  });
});

describe('drawShape — unknown kind fallback', () => {
  it('falls back to a placeholder rect for unregistered ShapeKind values', () => {
    const ctx = createCtxSpy();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    drawShape(
      asCtx(ctx),
      size,
      // Cast: P4's PPTX importer can produce shape kinds that are not in
      // the union (forward-compat for OOXML kinds that ship later). Use a
      // synthetic name that is guaranteed to never be a real ShapeKind so
      // this test stays meaningful even after T10 registers all current
      // union members.
      shape({ kind: '__test_unknown__' as never, fill: srgb('#abc') }),
      THEME,
    );
    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 100, 60);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe('drawShape — freeform', () => {
  const triangle = {
    commands: [
      { c: 'M' as const, x: 0, y: 0 },
      { c: 'L' as const, x: 1, y: 1 },
      { c: 'L' as const, x: 0, y: 1 },
      { c: 'Z' as const },
    ],
  };

  it('fills the freeform path with the given fill', () => {
    const ctx = createCtxSpy();
    drawShape(asCtx(ctx), size, shape({ kind: 'freeform', path: triangle, fill: srgb('#4b6bf5') }), THEME);
    expect(ctx.fillStyle).toBe('#4b6bf5');
    expect(ctx.fill).toHaveBeenCalledTimes(1);
    expect(ctx.fill.mock.calls[0][0]).toBeInstanceOf(Path2D);
  });

  it('strokes the freeform path when stroke is set', () => {
    const ctx = createCtxSpy();
    drawShape(asCtx(ctx), size, shape({
      kind: 'freeform', path: triangle, stroke: { color: srgb('#000'), width: 2 },
    }), THEME);
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
    expect(ctx.stroke.mock.calls[0][0]).toBeInstanceOf(Path2D);
  });

  it('falls back to a placeholder rect when path is missing', () => {
    const ctx = createCtxSpy();
    drawShape(asCtx(ctx), size, shape({ kind: 'freeform', fill: srgb('#abc') }), THEME);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 100, 60);
  });

  // Open path along +x so the end tangent is unambiguous: the tip lands on
  // the last anchor (scaled to frame) and the arrowhead is filled with the
  // stroke color.
  const openLine = {
    commands: [
      { c: 'M' as const, x: 0, y: 0.5 },
      { c: 'C' as const, x1: 0.3, y1: 0.5, x2: 0.7, y2: 0.5, x: 1, y: 0.5 },
    ],
  };

  it('draws the end arrowhead tip at the last anchor, filled with stroke color', () => {
    const ctx = createCtxSpy();
    drawShape(asCtx(ctx), size, shape({
      kind: 'freeform', path: openLine,
      stroke: { color: srgb('#292929'), width: 1 },
      arrowheads: { end: { kind: 'triangle', size: 'md' } },
    }), THEME);
    // Only the arrowhead uses ctx.fill (freeform body has no fill here);
    // the triangle tip is moveTo'd at the scaled last anchor (100, 30).
    expect(ctx.fill).toHaveBeenCalledTimes(1);
    expect(ctx.fillStyle).toBe('#292929');
    const tip = ctx.moveTo.mock.calls.find(
      (c: number[]) => Math.abs(c[0] - 100) < 1e-6 && Math.abs(c[1] - 30) < 1e-6,
    );
    expect(tip).toBeTruthy();
  });

  it('draws no arrowhead when arrowheads is absent', () => {
    const ctx = createCtxSpy();
    drawShape(asCtx(ctx), size, shape({
      kind: 'freeform', path: openLine, stroke: { color: srgb('#292929'), width: 1 },
    }), THEME);
    expect(ctx.fill).not.toHaveBeenCalled();
  });

  it('uses the true ellipse tangent (not the chord) for an arc endpoint', () => {
    // Quarter arc, isotropic 100x100 frame: start θ=0 at (100,50), end θ=π/2
    // at (50,100). True travel tangent at the end points -x (angle π), so the
    // triangle base extends back toward +x (baseX = 100 - cos(π)*12 = 62).
    const ctx = createCtxSpy();
    drawShape(asCtx(ctx), { w: 100, h: 100 }, shape({
      kind: 'freeform',
      path: {
        commands: [
          { c: 'M', x: 1, y: 0.5 },
          { c: 'A', cx: 0.5, cy: 0.5, rx: 0.5, ry: 0.5, start: 0, sweep: Math.PI / 2 },
        ],
      },
      stroke: { color: srgb('#292929'), width: 1 },
      arrowheads: { end: { kind: 'triangle', size: 'md' } },
    }), THEME);
    // Tip on the arc end (50,100).
    const tip = ctx.moveTo.mock.calls.find(
      (c: number[]) => Math.abs(c[0] - 50) < 1e-6 && Math.abs(c[1] - 100) < 1e-6,
    );
    expect(tip).toBeTruthy();
    // A chord approximation would give angle ≈ atan2(50,-50)=135°, base to the
    // lower-right; the true tangent puts both base corners at x≈62 (>50).
    const [c1, c2] = ctx.lineTo.mock.calls as number[][];
    expect(c1[0]).toBeCloseTo(62);
    expect(c2[0]).toBeCloseTo(62);
  });
});

describe('drawShape — donut (evenodd fill rule)', () => {
  it('passes the evenodd fill rule to ctx.fill so the hole shows', () => {
    const ctx = createCtxSpy();
    drawShape(asCtx(ctx), size, shape({ kind: 'donut', fill: srgb('#abc') }), THEME);
    expect(ctx.fill).toHaveBeenCalledTimes(1);
    expect(ctx.fill.mock.calls[0][0]).toBeInstanceOf(Path2D);
    expect(ctx.fill.mock.calls[0][1]).toBe('evenodd');
  });
});

describe('shapeTextInset', () => {
  it('defaults to the uniform SHAPE_TEXT_PADDING for a rect (no preset rect)', () => {
    expect(shapeTextInset('rect', 200, 100)).toEqual({
      left: SHAPE_TEXT_PADDING.x,
      top: SHAPE_TEXT_PADDING.y,
      right: SHAPE_TEXT_PADDING.x,
      bottom: SHAPE_TEXT_PADDING.y,
    });
  });

  it('uses a per-side pad override in place of SHAPE_TEXT_PADDING', () => {
    const pad = { left: 20, top: 20, right: 20, bottom: 20 };
    expect(shapeTextInset('rect', 200, 100, pad)).toEqual(pad);
  });

  it('composes the pad override with a shape preset rect', () => {
    // A kind with a preset text rect insets by rect fractions plus the pad.
    const pad = { left: 5, top: 5, right: 5, bottom: 5 };
    const withPad = shapeTextInset('ellipse', 200, 100, pad);
    const withDefault = shapeTextInset('ellipse', 200, 100);
    // The preset-rect portion is identical; only the additive pad differs.
    expect(withPad.left).toBeCloseTo(
      withDefault.left - SHAPE_TEXT_PADDING.x + pad.left,
    );
    expect(withPad.top).toBeCloseTo(
      withDefault.top - SHAPE_TEXT_PADDING.y + pad.top,
    );
  });

  it('shapeTextFrame threads the pad override so edit frame matches paint', () => {
    const frame = { x: 10, y: 20, w: 200, h: 100, rotation: 0 };
    const pad = { left: 30, top: 30, right: 30, bottom: 30 };
    // rect has no preset text rect, so the inner frame is the pad inset.
    expect(shapeTextFrame('rect', frame, pad)).toEqual({
      x: 40,
      y: 50,
      w: 140,
      h: 40,
      rotation: 0,
    });
  });
});
