import { describe, it, expect, vi } from 'vitest';
import type { ShapeElement } from '../../model/element';
import type { Theme } from '../../model/theme';
import { asCtx, createCtxSpy } from './ctx-spy';
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
  it('fills a rectangle at (0,0,w,h) with the given fill', () => {
    const ctx = createCtxSpy();
    drawShape(asCtx(ctx), size, shape({ kind: 'rect', fill: srgb('#abc') }), THEME);
    expect(ctx.fillStyle).toBe('#abc');
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 100, 60);
  });

  it('strokes a rectangle when stroke is set', () => {
    const ctx = createCtxSpy();
    drawShape(asCtx(ctx), size, shape({
      kind: 'rect', stroke: { color: srgb('#000'), width: 3 },
    }), THEME);
    expect(ctx.strokeStyle).toBe('#000');
    expect(ctx.lineWidth).toBe(3);
    expect(ctx.strokeRect).toHaveBeenCalledWith(0, 0, 100, 60);
  });

  it('skips fill and stroke when neither is set', () => {
    const ctx = createCtxSpy();
    drawShape(asCtx(ctx), size, shape({ kind: 'rect' }), THEME);
    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.strokeRect).not.toHaveBeenCalled();
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
  // TODO(T6): re-tighten to assert ctx.beginPath() / ctx.ellipse() / ctx.fill()
  // once the ellipse path builder is registered. Until then, ellipse routes
  // through the placeholder-rect fallback in the dispatcher.
  it('paints an ellipse centred in the frame', () => {
    const ctx = createCtxSpy();
    drawShape(asCtx(ctx), size, shape({ kind: 'ellipse', fill: srgb('#0a0') }), THEME);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 100, 60);
    expect(ctx.fillStyle).toBe('#0a0');
  });

  it('resolves a role-bound fill through the theme', () => {
    const ctx = createCtxSpy();
    drawShape(asCtx(ctx), size, shape({
      kind: 'ellipse', fill: { kind: 'role', role: 'accent2' },
    }), THEME);
    expect(ctx.fillStyle).toBe('#bcd'); // accent2
  });
});

describe('drawShape — line', () => {
  it('strokes a single line from (0,0) to (w,h)', () => {
    const ctx = createCtxSpy();
    drawShape(asCtx(ctx), size, shape({
      kind: 'line', stroke: { color: srgb('#222'), width: 2 },
    }), THEME);
    expect(ctx.beginPath).toHaveBeenCalledTimes(1);
    expect(ctx.moveTo).toHaveBeenCalledWith(0, 0);
    expect(ctx.lineTo).toHaveBeenCalledWith(100, 60);
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
  });

  it('does nothing when no stroke is set (a line with no stroke is invisible)', () => {
    const ctx = createCtxSpy();
    drawShape(asCtx(ctx), size, shape({ kind: 'line' }), THEME);
    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  it('resolves a role-bound stroke through the theme', () => {
    const ctx = createCtxSpy();
    drawShape(asCtx(ctx), size, shape({
      kind: 'line', stroke: { color: { kind: 'role', role: 'accent3' }, width: 1 },
    }), THEME);
    expect(ctx.strokeStyle).toBe('#cde'); // accent3
  });
});

describe('drawShape — arrow', () => {
  it('strokes the shaft and fills the head', () => {
    const ctx = createCtxSpy();
    drawShape(asCtx(ctx), size, shape({
      kind: 'arrow',
      stroke: { color: srgb('#222'), width: 2 },
      fill: srgb('#222'),
    }), THEME);
    // Shaft
    expect(ctx.moveTo).toHaveBeenCalledWith(0, 0);
    expect(ctx.lineTo).toHaveBeenCalledWith(100, 60);
    expect(ctx.stroke).toHaveBeenCalled();
    // Head (filled triangle) — three points + fill
    expect(ctx.fill).toHaveBeenCalled();
  });

  it('resolves a role-bound fill through the theme', () => {
    const ctx = createCtxSpy();
    drawShape(asCtx(ctx), size, shape({
      kind: 'arrow',
      stroke: { color: { kind: 'role', role: 'accent4' }, width: 2 },
      fill: { kind: 'role', role: 'accent4' },
    }), THEME);
    expect(ctx.fillStyle).toBe('#def'); // accent4
  });

  it('falls back to the text role when neither fill nor stroke is set', () => {
    const ctx = createCtxSpy();
    drawShape(asCtx(ctx), size, shape({ kind: 'arrow' }), THEME);
    // Head is still painted using the text role as a sensible default.
    expect(ctx.fillStyle).toBe('#000'); // text
    expect(ctx.fill).toHaveBeenCalled();
  });
});

describe('drawShape — unknown kind fallback', () => {
  it('falls back to a placeholder rect for unknown ShapeKind values', () => {
    const ctx = createCtxSpy();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    drawShape(
      asCtx(ctx),
      size,
      // Cast: forward-compat for kinds not yet in the registry.
      shape({ kind: 'donut' as never, fill: srgb('#abc') }),
      THEME,
    );
    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 100, 60);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
