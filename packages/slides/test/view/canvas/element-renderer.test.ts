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

describe('drawElement — drop shadow', () => {
  it('activates the shadow during the shape fill, then clears it', () => {
    const ctx = createCtxSpy();
    // Record the shadowColor in effect at the moment fill() is called.
    let shadowAtFill: string | undefined;
    ctx.fill.mockImplementation(() => {
      shadowAtFill = ctx.shadowColor;
    });
    const el: Element = {
      id: 'e-shadow',
      type: 'shape',
      frame: { x: 0, y: 0, w: 100, h: 60, rotation: 0 },
      data: {
        kind: 'rect',
        fill: { kind: 'srgb', value: '#abc' },
        effects: {
          shadow: {
            color: '#000000',
            opacity: 0.5,
            angle: 0,
            distance: 8,
            blur: 4,
          },
        },
      },
    };
    drawElement(asCtx(ctx), el, DOC, THEME, () => undefined);
    expect(shadowAtFill).toBe('rgba(0, 0, 0, 0.5)');
    // Cleared after the geometry pass (before any text paint).
    expect(ctx.shadowColor).toBe('transparent');
  });

  it('leaves the shadow unset when no effects are present', () => {
    const ctx = createCtxSpy();
    let shadowAtFill: string | undefined;
    ctx.fill.mockImplementation(() => {
      shadowAtFill = ctx.shadowColor;
    });
    drawElement(asCtx(ctx), shapeAt(0, 0), DOC, THEME, () => undefined);
    expect(shadowAtFill).toBe('transparent');
  });
});

describe('drawElement — counter-flip for text', () => {
  const block = (text: string) => ({
    id: 'b1', type: 'paragraph',
    inlines: [{ text, style: {} }],
    style: {},
  });

  const shapeWithText = (
    x: number,
    y: number,
    flip: { flipH?: boolean; flipV?: boolean } = {},
  ): Element => ({
    id: 'shape-with-text',
    type: 'shape',
    frame: {
      x, y, w: 100, h: 60, rotation: 0,
      ...(flip.flipH ? { flipH: true } : {}),
      ...(flip.flipV ? { flipV: true } : {}),
    },
    data: {
      kind: 'rect',
      fill: { kind: 'srgb', value: '#abc' },
      text: { blocks: [block('Hello')] as never },
    },
  });

  const textElement = (
    x: number,
    y: number,
    flip: { flipH?: boolean; flipV?: boolean } = {},
  ): Element => ({
    id: 'text-el',
    type: 'text',
    frame: {
      x, y, w: 200, h: 80, rotation: 0,
      ...(flip.flipH ? { flipH: true } : {}),
      ...(flip.flipV ? { flipV: true } : {}),
    },
    data: { blocks: [block('hi')] as never },
  });

  it('flipped shape with inline text — counter-flip wraps the text paint', () => {
    const ctx = createCtxSpy();
    drawElement(asCtx(ctx), shapeWithText(10, 20, { flipH: true }), DOC, THEME, () => undefined);
    // First scale: own flip in the base transform (mirrors geometry).
    // Second scale: counter-flip wrapper around paintShapeText so glyphs
    // read upright. Both around the same centre.
    const scaleCalls = ctx.scale.mock.calls.filter(
      ([sx, sy]) => sx === -1 || sy === -1,
    );
    expect(scaleCalls).toHaveLength(2);
    expect(scaleCalls[0]).toEqual([-1, 1]);
    expect(scaleCalls[1]).toEqual([-1, 1]);
    // Text was still painted ("Hello").
    expect(ctx.fillText).toHaveBeenCalled();
  });

  it('flipped text element — counter-flip wraps drawText', () => {
    const ctx = createCtxSpy();
    drawElement(asCtx(ctx), textElement(10, 20, { flipV: true }), DOC, THEME, () => undefined);
    const flipCalls = ctx.scale.mock.calls.filter(
      ([sx, sy]) => sx === -1 || sy === -1,
    );
    // Own flipV in base transform + counter-flipV around drawText.
    expect(flipCalls).toHaveLength(2);
    expect(flipCalls[0]).toEqual([1, -1]);
    expect(flipCalls[1]).toEqual([1, -1]);
    expect(ctx.fillText).toHaveBeenCalled();
  });

  it('non-flipped shape with text — no counter-flip applied', () => {
    const ctx = createCtxSpy();
    drawElement(asCtx(ctx), shapeWithText(10, 20), DOC, THEME, () => undefined);
    // No flip ops at all — neither own nor counter.
    const flipCalls = ctx.scale.mock.calls.filter(
      ([sx, sy]) => sx === -1 || sy === -1,
    );
    expect(flipCalls).toHaveLength(0);
    // Text still paints normally.
    expect(ctx.fillText).toHaveBeenCalled();
  });

  it('deck.meta.pxPerPt drives a larger font box (10" deck ≈ 2× docs default)', () => {
    // For a 10" deck pxPerPt ≈ 2.667 (= 1920 / (10 × 72)). deckFontScale =
    // pxPerPt / (96/72) = 2 → blocks fed to docs have 2× larger fontSize.
    // The resulting `ctx.font` (built by docs from the scaled pt) should
    // be ~2× the unscaled-deck font size. Track `font` writes via a
    // Proxy since the plain ctx-spy stores the property without history.
    const fontSizeForRender = (doc: SlidesDocument): number => {
      const spy = createCtxSpy();
      const fontWrites: string[] = [];
      const ctx = new Proxy(spy as object, {
        set(target, prop, value): boolean {
          if (prop === 'font') fontWrites.push(value as string);
          (target as Record<string | symbol, unknown>)[prop] = value;
          return true;
        },
      }) as unknown as CanvasRenderingContext2D;
      const el: Element = {
        id: 'e-text',
        type: 'text',
        frame: { x: 0, y: 0, w: 400, h: 200, rotation: 0 },
        data: {
          blocks: [{
            id: 'b1', type: 'paragraph',
            inlines: [{ text: 'hello', style: { fontSize: 52 } }],
            style: {},
          }] as never,
        },
      };
      drawElement(ctx, el, doc, THEME, () => undefined);
      // Grab the largest font px value written; docs paintLayout writes
      // the run's font right before `fillText`, and any smaller writes
      // (e.g. for selection highlights) shouldn't dominate the answer.
      const sizes = fontWrites
        .map((f) => Number(f.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? 0))
        .filter((n) => n > 0);
      return sizes.length > 0 ? Math.max(...sizes) : 0;
    };

    const baseline = fontSizeForRender({ ...DOC, meta: { ...DOC.meta } });
    const scaled = fontSizeForRender({
      ...DOC,
      meta: { ...DOC.meta, pxPerPt: 2.6667 },
    });
    expect(baseline).toBeGreaterThan(0);
    expect(scaled / baseline).toBeCloseTo(2, 1);
  });

  it('text child inside a flipH group — counter-flip uses accumulated flip', () => {
    const ctx = createCtxSpy();
    const group: Element = {
      id: 'g1',
      type: 'group',
      frame: { x: 0, y: 0, w: 400, h: 200, rotation: 0, flipH: true },
      data: {
        refSize: { w: 400, h: 200 },
        // Child has NO own flip; the counter-flip must still trigger
        // because the group flips its descendants.
        children: [textElement(50, 30)],
      },
    };
    drawElement(asCtx(ctx), group, DOC, THEME, () => undefined);
    const flipCalls = ctx.scale.mock.calls.filter(
      ([sx, sy]) => sx === -1 || sy === -1,
    );
    // 1 from group's own flip in its base transform; 1 from counter-flip
    // around the child's drawText (own flipH=false XOR parent flipH=true).
    expect(flipCalls).toHaveLength(2);
    expect(flipCalls[0]).toEqual([-1, 1]); // group base
    expect(flipCalls[1]).toEqual([-1, 1]); // counter-flip around text
    expect(ctx.fillText).toHaveBeenCalled();
  });
});
