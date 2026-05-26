// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import type { Element } from '../../../src/model/element';
import type { SlidesDocument } from '../../../src/model/presentation';
import type { Theme } from '../../../src/model/theme';
import { DEFAULT_MASTER } from '../../../src/model/master';
import { BUILT_IN_LAYOUTS } from '../../../src/model/layout';
import { asCtx, createCtxSpy } from '../../../src/view/canvas/ctx-spy';
// Install the OffscreenCanvas shim before importing the renderer; the
// text-dispatch test imports text-renderer transitively, which needs
// the shim in place when its module-scope measurer initialises.
import '../../../src/view/canvas/test-canvas-env';

// Import after the shim so the transitive text-renderer import sees it.
const { drawElement } = await import('../../../src/view/canvas/element-renderer');

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

const DOC: SlidesDocument = {
  meta: { title: 't', themeId: 't', masterId: 'default' },
  themes: [THEME],
  masters: [DEFAULT_MASTER],
  layouts: BUILT_IN_LAYOUTS,
  slides: [],
  guides: [],
};

const shapeAt = (
  x: number,
  y: number,
  rotation = 0,
  flip?: { flipH?: boolean; flipV?: boolean },
): Element => ({
  id: 'e1',
  type: 'shape',
  frame: {
    x,
    y,
    w: 100,
    h: 60,
    rotation,
    ...(flip?.flipH ? { flipH: true } : {}),
    ...(flip?.flipV ? { flipV: true } : {}),
  },
  data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
});

describe('drawElement — frame transform', () => {
  it('wraps the per-type painter in save/restore', () => {
    const ctx = createCtxSpy();
    drawElement(asCtx(ctx), shapeAt(10, 20), DOC, THEME, () => undefined);
    expect(ctx.save).toHaveBeenCalledTimes(1);
    expect(ctx.restore).toHaveBeenCalledTimes(1);
  });

  it('translates by frame.x, frame.y for an unrotated element', () => {
    const ctx = createCtxSpy();
    drawElement(asCtx(ctx), shapeAt(10, 20), DOC, THEME, () => undefined);
    expect(ctx.translate).toHaveBeenCalledWith(10, 20);
    expect(ctx.rotate).not.toHaveBeenCalled();
  });

  it('translates to centre, rotates, then translates to top-left when rotation != 0', () => {
    const ctx = createCtxSpy();
    drawElement(asCtx(ctx), shapeAt(10, 20, Math.PI / 4), DOC, THEME, () => undefined);
    // 1) translate to frame centre = (10 + 50, 20 + 30) = (60, 50)
    expect(ctx.translate).toHaveBeenNthCalledWith(1, 60, 50);
    expect(ctx.rotate).toHaveBeenCalledWith(Math.PI / 4);
    expect(ctx.scale).not.toHaveBeenCalled();
    // 2) translate back to top-left = (-w/2, -h/2)
    expect(ctx.translate).toHaveBeenNthCalledWith(2, -50, -30);
  });

  it('applies scale(-1, 1) around the frame centre when flipH is set', () => {
    const ctx = createCtxSpy();
    drawElement(
      asCtx(ctx),
      shapeAt(10, 20, 0, { flipH: true }),
      DOC,
      THEME,
      () => undefined,
    );
    // Order: translate-to-centre, scale, translate-back. No rotate (rotation=0).
    expect(ctx.translate).toHaveBeenNthCalledWith(1, 60, 50);
    expect(ctx.rotate).not.toHaveBeenCalled();
    expect(ctx.scale).toHaveBeenCalledWith(-1, 1);
    expect(ctx.translate).toHaveBeenNthCalledWith(2, -50, -30);
  });

  it('combines rotation and flipH (matches OOXML rot + flipH semantics)', () => {
    const ctx = createCtxSpy();
    // Slide 6 case: rot=180° + flipH=1.
    drawElement(
      asCtx(ctx),
      shapeAt(10, 20, Math.PI, { flipH: true }),
      DOC,
      THEME,
      () => undefined,
    );
    expect(ctx.translate).toHaveBeenNthCalledWith(1, 60, 50);
    expect(ctx.rotate).toHaveBeenCalledWith(Math.PI);
    expect(ctx.scale).toHaveBeenCalledWith(-1, 1);
    expect(ctx.translate).toHaveBeenNthCalledWith(2, -50, -30);
  });

  it('applies scale(1, -1) for flipV alone', () => {
    const ctx = createCtxSpy();
    drawElement(
      asCtx(ctx),
      shapeAt(10, 20, 0, { flipV: true }),
      DOC,
      THEME,
      () => undefined,
    );
    expect(ctx.scale).toHaveBeenCalledWith(1, -1);
  });

  it('dispatches to drawShape for shape elements', () => {
    const ctx = createCtxSpy();
    drawElement(asCtx(ctx), shapeAt(0, 0), DOC, THEME, () => undefined);
    // rect routes through the path-builder dispatcher: ctx.fill(path).
    expect(ctx.fill).toHaveBeenCalledTimes(1);
    expect(ctx.fill.mock.calls[0][0]).toBeInstanceOf(Path2D);
  });

  it('dispatches to drawText for text elements', () => {
    const ctx = createCtxSpy();
    const el: Element = {
      id: 'e2',
      type: 'text',
      frame: { x: 0, y: 0, w: 200, h: 80, rotation: 0 },
      data: {
        blocks: [{
          id: 'b1', type: 'paragraph',
          inlines: [{ text: 'hi', style: {} }],
          style: {},
        }] as never,
      },
    };
    drawElement(asCtx(ctx), el, DOC, THEME, () => undefined);
    expect(ctx.fillText).toHaveBeenCalledTimes(1);
    expect(ctx.fillText.mock.calls[0][0]).toBe('hi');
  });

  it('passes the onAssetLoad callback to drawImage for image elements', () => {
    const ctx = createCtxSpy();
    const el: Element = {
      id: 'e3',
      type: 'image',
      frame: { x: 0, y: 0, w: 100, h: 100, rotation: 0 },
      data: { src: 'never-loads.png' },
    };
    let calledBack = false;
    drawElement(asCtx(ctx), el, DOC, THEME, () => { calledBack = true; });
    // The first render misses the cache; nothing painted, no callback yet.
    expect(ctx.drawImage).not.toHaveBeenCalled();
    expect(calledBack).toBe(false);
  });
});
