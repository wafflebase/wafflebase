import { describe, it, expect, vi } from 'vitest';
import type { ShapeElement } from '../../model/element';
import type { Theme } from '../../model/theme';
import { asCtx, createCtxSpy } from './ctx-spy';
// Install Path2D global before importing the renderer/builders.
import './test-canvas-env';
import { drawShape } from './shape-renderer';

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

describe('drawShape — donut (evenodd fill rule)', () => {
  it('passes the evenodd fill rule to ctx.fill so the hole shows', () => {
    const ctx = createCtxSpy();
    drawShape(asCtx(ctx), size, shape({ kind: 'donut', fill: srgb('#abc') }), THEME);
    expect(ctx.fill).toHaveBeenCalledTimes(1);
    expect(ctx.fill.mock.calls[0][0]).toBeInstanceOf(Path2D);
    expect(ctx.fill.mock.calls[0][1]).toBe('evenodd');
  });
});
