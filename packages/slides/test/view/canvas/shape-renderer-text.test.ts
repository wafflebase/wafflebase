// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import type { Block } from '@wafflebase/docs';
import type { ShapeElement } from '../../../src/model/element';
import type { Theme } from '../../../src/model/theme';
import { asCtx, createCtxSpy } from '../../../src/view/canvas/ctx-spy';
import '../../../src/view/canvas/test-canvas-env';

// Import the renderer *after* the canvas shim is installed so the docs
// measurer can lazily acquire its fake ctx on first text layout.
const { drawShape } = await import('../../../src/view/canvas/shape-renderer');

const THEME: Theme = {
  id: 't',
  name: 't',
  colors: {
    text: '#000',
    background: '#fff',
    textSecondary: '#444',
    backgroundAlt: '#f3f3f3',
    accent1: '#abc',
    accent2: '#bcd',
    accent3: '#cde',
    accent4: '#def',
    accent5: '#e0e1e2',
    accent6: '#f0f1f2',
    hyperlink: '#11c',
    visitedHyperlink: '#71a',
  },
  fonts: { heading: 'Inter', body: 'Inter' },
};

const size = { w: 400, h: 200 };
const srgb = (value: string) => ({ kind: 'srgb' as const, value });

function paragraph(text: string): Block {
  return {
    id: `b${Math.random().toString(36).slice(2, 8)}`,
    type: 'paragraph',
    inlines: [{ text, style: {} }],
    style: {},
  } as Block;
}

const shape = (data: ShapeElement['data']): ShapeElement['data'] => data;

describe('drawShape — inline text', () => {
  beforeAll(() => {
    expect(
      typeof (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas,
    ).toBe('function');
  });

  it('skips text paint when data.text is absent', () => {
    const ctx = createCtxSpy();
    drawShape(asCtx(ctx), size, shape({ kind: 'rect', fill: srgb('#abc') }), THEME);
    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  it('skips text paint when data.text has no visible characters', () => {
    const ctx = createCtxSpy();
    drawShape(
      asCtx(ctx),
      size,
      shape({
        kind: 'rect',
        fill: srgb('#abc'),
        text: { blocks: [paragraph('')] },
      }),
      THEME,
    );
    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  it('paints the inline text on top of the shape fill', () => {
    const ctx = createCtxSpy();
    drawShape(
      asCtx(ctx),
      size,
      shape({
        kind: 'rect',
        fill: srgb('#abc'),
        text: { blocks: [paragraph('Hello')] },
      }),
      THEME,
    );
    // Fill happens first; the text runs follow.
    expect(ctx.fill).toHaveBeenCalledTimes(1);
    expect(ctx.fillText).toHaveBeenCalled();
    const joined = ctx.fillText.mock.calls.map((c) => c[0]).join('');
    expect(joined).toBe('Hello');
  });

  it('paints text on top of the placeholder-rect fallback for unknown shape kinds', () => {
    const ctx = createCtxSpy();
    drawShape(
      asCtx(ctx),
      size,
      shape({
        kind: '__test_unknown__' as never,
        fill: srgb('#abc'),
        text: { blocks: [paragraph('X')] },
      }),
      THEME,
    );
    expect(ctx.fillRect).toHaveBeenCalledTimes(1); // placeholder fill
    expect(ctx.fillText).toHaveBeenCalled();
  });

  it('applies the PowerPoint-default 14.4 / 7.2 px insets to the text origin', () => {
    const ctx = createCtxSpy();
    drawShape(
      asCtx(ctx),
      size,
      shape({
        kind: 'rect',
        text: {
          blocks: [paragraph('a')],
          // Anchor 'top' so we can read the inset y directly from the
          // first fillText call without subtracting the middle-anchor
          // offset.
          verticalAnchor: 'top',
        },
      }),
      THEME,
    );
    expect(ctx.fillText).toHaveBeenCalled();
    const [, x, y] = ctx.fillText.mock.calls[0];
    // `paintLayout` snaps x/y to integer pixels, so 14.4 lands at 14
    // and 7.2 floors into the baseline. Bound y from above too — the
    // first-line baseline can't be more than ~25 px below the inset
    // for the docs default 11 pt font; if it ends up far below
    // (e.g., y = 50) something is centering or anchoring wrong.
    expect(x).toBeGreaterThanOrEqual(14);
    expect(x).toBeLessThan(15);
    expect(y).toBeGreaterThanOrEqual(7);
    expect(y).toBeLessThan(25);
  });
});
