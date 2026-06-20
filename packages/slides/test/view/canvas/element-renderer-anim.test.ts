// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import type { Element } from '../../../src/model/element';
import type { SlidesDocument } from '../../../src/model/presentation';
import type { Theme } from '../../../src/model/theme';
import type { AnimState } from '../../../src/anim/state';
import { DEFAULT_MASTER } from '../../../src/model/master';
import { BUILT_IN_LAYOUTS } from '../../../src/model/layout';
import { asCtx, createCtxSpy } from '../../../src/view/canvas/ctx-spy';
// Install the OffscreenCanvas shim before importing the renderer.
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

// A minimal shape element at (50, 40, 100×60) for centre = (100, 70).
const SHAPE: Element = {
  id: 'e-anim',
  type: 'shape',
  frame: { x: 50, y: 40, w: 100, h: 60, rotation: 0 },
  data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
};

describe('drawElement — anim injection', () => {
  it('skips paint when anim.hidden is true', () => {
    const ctx = createCtxSpy();
    const anim: AnimState = { opacity: 1, scale: 1, dx: 0, dy: 0, rotation: 0, hidden: true };
    drawElement(asCtx(ctx), SHAPE, DOC, THEME, () => undefined, undefined, undefined, undefined, anim);
    // The shape painter calls ctx.fill — if hidden, it must not be invoked.
    expect(ctx.fill).not.toHaveBeenCalled();
    // No save/restore should have been called either.
    expect(ctx.save).not.toHaveBeenCalled();
    expect(ctx.restore).not.toHaveBeenCalled();
  });

  it('applies ctx.save/restore and translate/scale when anim has non-identity values', () => {
    const ctx = createCtxSpy();
    const anim: AnimState = { opacity: 0.5, scale: 2, dx: 10, dy: 20, rotation: 0, hidden: false };
    drawElement(asCtx(ctx), SHAPE, DOC, THEME, () => undefined, undefined, undefined, undefined, anim);

    // The anim save wraps the entire body — at least one save/restore pair.
    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();
    // save and restore are balanced.
    expect(ctx.save.mock.calls.length).toBe(ctx.restore.mock.calls.length);

    // First translate call must be the dx/dy offset.
    expect(ctx.translate).toHaveBeenCalledWith(10, 20);

    // scale(2, 2) must be present for the anim scale.
    expect(ctx.scale).toHaveBeenCalledWith(2, 2);
  });

  it('save and restore are balanced when anim has opacity only', () => {
    const ctx = createCtxSpy();
    const anim: AnimState = { opacity: 0.3, scale: 1, dx: 0, dy: 0, rotation: 0, hidden: false };
    drawElement(asCtx(ctx), SHAPE, DOC, THEME, () => undefined, undefined, undefined, undefined, anim);

    expect(ctx.save.mock.calls.length).toBe(ctx.restore.mock.calls.length);
    // The shape was still painted (fill called).
    expect(ctx.fill).toHaveBeenCalled();
  });

  it('does NOT call extra save/restore when anim is undefined (identity path)', () => {
    const ctxNoAnim = createCtxSpy();
    drawElement(asCtx(ctxNoAnim), SHAPE, DOC, THEME, () => undefined);

    const ctxAnim = createCtxSpy();
    drawElement(asCtx(ctxAnim), SHAPE, DOC, THEME, () => undefined, undefined, undefined, undefined, undefined);

    // Both paths must produce the same save/restore count and the same fill call.
    expect(ctxAnim.save.mock.calls.length).toBe(ctxNoAnim.save.mock.calls.length);
    expect(ctxAnim.restore.mock.calls.length).toBe(ctxNoAnim.restore.mock.calls.length);
    expect(ctxAnim.fill.mock.calls.length).toBe(ctxNoAnim.fill.mock.calls.length);
  });

  it('applies ctx.rotate when anim.rotation is non-zero', () => {
    const ctx = createCtxSpy();
    const anim: AnimState = { opacity: 1, scale: 1, dx: 0, dy: 0, rotation: Math.PI / 4, hidden: false };
    drawElement(asCtx(ctx), SHAPE, DOC, THEME, () => undefined, undefined, undefined, undefined, anim);

    // rotate must have been called with the anim rotation value.
    const rotateCalls = ctx.rotate.mock.calls;
    expect(rotateCalls.some(([r]) => Math.abs(r - Math.PI / 4) < 1e-9)).toBe(true);
    expect(ctx.save.mock.calls.length).toBe(ctx.restore.mock.calls.length);
  });

  // Transform order test: anim wrapper transforms must precede the element's
  // own local frame rotate in the ctx call sequence.
  //
  // Render sequence when hasAnim=true and frame.rotation≠0:
  //   outer: translate(dx, dy)  ← anim offset
  //   outer: translate(cx, cy)  ← anim centre pivot
  //   outer: scale(2, 2)        ← anim scale
  //   outer: translate(-cx,-cy) ← anim centre inverse
  //   inner: translate(frame.x + frame.w/2, frame.y + frame.h/2)
  //   inner: rotate(frame.rotation)   ← element's own local rotate
  //
  // We verify that the first anim translate call (dx=10, dy=20) and the
  // anim scale call (2, 2) each have a lower invocationCallOrder than the
  // element's frame rotate call (Math.PI/4), proving the anim wrapper
  // is applied before the element's local transform.
  it('anim wrapper transforms (translate+scale) are applied BEFORE the element local rotate', () => {
    // Use a shape with a non-zero frame rotation so the inner rotate fires.
    const ROTATED_SHAPE: Element = {
      id: 'e-rotated',
      type: 'shape',
      frame: { x: 50, y: 40, w: 100, h: 60, rotation: Math.PI / 4 },
      data: { kind: 'rect', fill: { kind: 'srgb' as const, value: '#abc' } },
    };

    const ctx = createCtxSpy();
    const anim: AnimState = { opacity: 1, scale: 2, dx: 10, dy: 20, rotation: 0, hidden: false };
    drawElement(asCtx(ctx), ROTATED_SHAPE, DOC, THEME, () => undefined, undefined, undefined, undefined, anim);

    // Collect invocation call orders for each method.
    const translateOrders = ctx.translate.mock.invocationCallOrder;
    const scaleOrders = ctx.scale.mock.invocationCallOrder;
    const rotateOrders = ctx.rotate.mock.invocationCallOrder;

    // The anim translate(10, 20) is the FIRST translate call in the sequence.
    // Its invocationCallOrder must be less than the frame rotate's order.
    const firstTranslateOrder = Math.min(...translateOrders);
    const firstScaleOrder = Math.min(...scaleOrders);
    // The frame rotate(Math.PI/4) is the only rotate call here (anim.rotation=0).
    const frameRotateOrder = rotateOrders[0];

    expect(frameRotateOrder).toBeDefined();
    expect(firstTranslateOrder).toBeLessThan(frameRotateOrder);
    expect(firstScaleOrder).toBeLessThan(frameRotateOrder);
  });
});
