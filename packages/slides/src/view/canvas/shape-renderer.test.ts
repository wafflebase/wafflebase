import { describe, it, expect } from 'vitest';
import type { ShapeElement } from '../../model/element';
import { asCtx, createCtxSpy } from './ctx-spy';
import { drawShape } from './shape-renderer';

const size = { w: 100, h: 60 };
const shape = (data: ShapeElement['data']): ShapeElement['data'] => data;

describe('drawShape — rect', () => {
  it('fills a rectangle at (0,0,w,h) with the given fill', () => {
    const ctx = createCtxSpy();
    drawShape(asCtx(ctx), size, shape({ kind: 'rect', fill: '#abc' }));
    expect(ctx.fillStyle).toBe('#abc');
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 100, 60);
  });

  it('strokes a rectangle when stroke is set', () => {
    const ctx = createCtxSpy();
    drawShape(asCtx(ctx), size, shape({
      kind: 'rect', stroke: { color: '#000', width: 3 },
    }));
    expect(ctx.strokeStyle).toBe('#000');
    expect(ctx.lineWidth).toBe(3);
    expect(ctx.strokeRect).toHaveBeenCalledWith(0, 0, 100, 60);
  });

  it('skips fill and stroke when neither is set', () => {
    const ctx = createCtxSpy();
    drawShape(asCtx(ctx), size, shape({ kind: 'rect' }));
    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(ctx.strokeRect).not.toHaveBeenCalled();
  });
});

describe('drawShape — ellipse', () => {
  it('paints an ellipse centred in the frame', () => {
    const ctx = createCtxSpy();
    drawShape(asCtx(ctx), size, shape({ kind: 'ellipse', fill: '#0a0' }));
    expect(ctx.beginPath).toHaveBeenCalledTimes(1);
    expect(ctx.ellipse).toHaveBeenCalledWith(50, 30, 50, 30, 0, 0, Math.PI * 2);
    expect(ctx.fill).toHaveBeenCalledTimes(1);
    expect(ctx.fillStyle).toBe('#0a0');
  });
});

describe('drawShape — line', () => {
  it('strokes a single line from (0,0) to (w,h)', () => {
    const ctx = createCtxSpy();
    drawShape(asCtx(ctx), size, shape({
      kind: 'line', stroke: { color: '#222', width: 2 },
    }));
    expect(ctx.beginPath).toHaveBeenCalledTimes(1);
    expect(ctx.moveTo).toHaveBeenCalledWith(0, 0);
    expect(ctx.lineTo).toHaveBeenCalledWith(100, 60);
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
  });

  it('does nothing when no stroke is set (a line with no stroke is invisible)', () => {
    const ctx = createCtxSpy();
    drawShape(asCtx(ctx), size, shape({ kind: 'line' }));
    expect(ctx.stroke).not.toHaveBeenCalled();
  });
});

describe('drawShape — arrow', () => {
  it('strokes the shaft and fills the head', () => {
    const ctx = createCtxSpy();
    drawShape(asCtx(ctx), size, shape({
      kind: 'arrow',
      stroke: { color: '#222', width: 2 },
      fill: '#222',
    }));
    // Shaft
    expect(ctx.moveTo).toHaveBeenCalledWith(0, 0);
    expect(ctx.lineTo).toHaveBeenCalledWith(100, 60);
    expect(ctx.stroke).toHaveBeenCalled();
    // Head (filled triangle) — three points + fill
    expect(ctx.fill).toHaveBeenCalled();
  });
});
