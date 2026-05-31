// @vitest-environment jsdom
import { beforeAll, describe, it, expect } from 'vitest';
import type { Block } from '@wafflebase/docs';
import type { TextElement } from '../../../src/model/element';
import type { PlaceholderStyle } from '../../../src/model/master';
import type { Theme } from '../../../src/model/theme';
import { asCtx, createCtxSpy } from '../../../src/view/canvas/ctx-spy';
// Install the OffscreenCanvas shim before importing the renderer; see
// test-canvas-env.ts for the rationale and dynamic-import requirement.
import '../../../src/view/canvas/test-canvas-env';

// Import the renderer *after* the shim is installed so the module-scope
// measurer can lazily acquire the fake ctx on first use.
const { drawText } = await import('../../../src/view/canvas/text-renderer');

const size = { w: 400, h: 200 };

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

function paragraph(text: string): Block {
  return {
    id: `b${Math.random().toString(36).slice(2, 8)}`,
    type: 'paragraph',
    inlines: [{ text, style: {} }],
    style: {},
  } as Block;
}

const data = (blocks: Block[]): TextElement['data'] => ({ blocks });

const TITLE_STYLE: PlaceholderStyle = {
  fontRole: 'heading',
  fontSize: 44,
  colorRole: 'text',
  align: 'left',
  lineHeight: 1.2,
};

describe('drawText', () => {
  beforeAll(() => {
    // Sanity: confirm the OffscreenCanvas shim is in place. If a future
    // change drops the shim we want a clear failure here, not a confusing
    // 'no Canvas 2D context available' deep in the layout engine.
    expect(typeof (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas).toBe(
      'function',
    );
  });

  it('emits one fillText per run for a single paragraph', () => {
    const ctx = createCtxSpy();
    // docs `computeLayout` segments at the word level, so "Hello world"
    // becomes two runs: "Hello " and "world". Concatenating the
    // recorded run texts must round-trip to the original paragraph.
    drawText(asCtx(ctx), size, data([paragraph('Hello world')]), THEME);
    expect(ctx.fillText).toHaveBeenCalledTimes(2);
    const joined = ctx.fillText.mock.calls.map((c) => c[0]).join('');
    expect(joined).toBe('Hello world');
    // x at the run's x position; y at the layout-derived line baseline.
    for (const call of ctx.fillText.mock.calls) {
      expect(typeof call[1]).toBe('number');
      expect(typeof call[2]).toBe('number');
    }
  });

  it('emits one fillText per inline run when the paragraph has multiple inlines', () => {
    const ctx = createCtxSpy();
    const block: Block = {
      id: 'b1',
      type: 'paragraph',
      inlines: [
        { text: 'Hello ', style: {} },
        { text: 'bold', style: { bold: true } },
      ],
      style: {},
    } as Block;
    drawText(asCtx(ctx), size, data([block]), THEME);
    expect(ctx.fillText).toHaveBeenCalledTimes(2);
    expect(ctx.fillText.mock.calls[0][0]).toBe('Hello ');
    expect(ctx.fillText.mock.calls[1][0]).toBe('bold');
  });

  it('does not paint anything for an empty blocks array', () => {
    const ctx = createCtxSpy();
    drawText(asCtx(ctx), size, data([]), THEME);
    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  it('emits one fillText per block for two paragraphs', () => {
    const ctx = createCtxSpy();
    drawText(asCtx(ctx), size, data([paragraph('one'), paragraph('two')]), THEME);
    expect(ctx.fillText).toHaveBeenCalledTimes(2);
  });

  it('paints at y=0 by default (top-anchored, no field)', () => {
    const ctx = createCtxSpy();
    drawText(asCtx(ctx), { w: 400, h: 200 }, data([paragraph('Hi')]), THEME);
    expect(ctx.fillText).toHaveBeenCalledTimes(1);
    // y is the baseline of the first line; for default body text the
    // baseline sits well within the top quartile of the frame.
    const firstY = ctx.fillText.mock.calls[0][2] as number;
    expect(firstY).toBeLessThan(40);
  });

  it('paints near the bottom of the frame when verticalAnchor="bottom"', () => {
    const ctx = createCtxSpy();
    const d: TextElement['data'] = { blocks: [paragraph('Hi')], verticalAnchor: 'bottom' };
    drawText(asCtx(ctx), { w: 400, h: 200 }, d, THEME);
    expect(ctx.fillText).toHaveBeenCalledTimes(1);
    // Bottom-anchored text in a 200px-tall frame must paint in the lower
    // half — guards against the old "always paint at the top" behavior.
    const firstY = ctx.fillText.mock.calls[0][2] as number;
    expect(firstY).toBeGreaterThan(150);
  });

  it('paints near the vertical center when verticalAnchor="middle"', () => {
    const ctx = createCtxSpy();
    const d: TextElement['data'] = { blocks: [paragraph('Hi')], verticalAnchor: 'middle' };
    drawText(asCtx(ctx), { w: 400, h: 200 }, d, THEME);
    const firstY = ctx.fillText.mock.calls[0][2] as number;
    expect(firstY).toBeGreaterThan(80);
    expect(firstY).toBeLessThan(130);
  });

  it('preserves the bottom anchor when content overflows the frame', () => {
    const ctx = createCtxSpy();
    // 30 paragraphs of default-size text is comfortably > 40 px tall.
    const blocks = Array.from({ length: 30 }, (_, i) => paragraph(`line ${i}`));
    const d: TextElement['data'] = { blocks, verticalAnchor: 'bottom' };
    drawText(asCtx(ctx), { w: 400, h: 40 }, d, THEME);
    // Bottom anchor pins the LAST line baseline to the frame bottom, so
    // the FIRST line baseline lands well above the frame top (negative).
    // PowerPoint/Google Slides behavior — without this we'd lose visual
    // parity on PPTX import (e.g. slide 22 of `Yorkie, 캐즘 뛰어넘기.pptx`).
    const firstY = ctx.fillText.mock.calls[0][2] as number;
    expect(firstY).toBeLessThan(0);
  });

  it('preserves the middle anchor when content overflows the frame', () => {
    const ctx = createCtxSpy();
    const blocks = Array.from({ length: 30 }, (_, i) => paragraph(`line ${i}`));
    const d: TextElement['data'] = { blocks, verticalAnchor: 'middle' };
    drawText(asCtx(ctx), { w: 400, h: 40 }, d, THEME);
    // Middle anchor on overflow → first-line baseline is well above the
    // frame top (text extends symmetrically above and below the frame).
    const firstY = ctx.fillText.mock.calls[0][2] as number;
    expect(firstY).toBeLessThan(0);
  });

  it('still paints at the top when top-anchored content overflows', () => {
    const ctx = createCtxSpy();
    const blocks = Array.from({ length: 30 }, (_, i) => paragraph(`line ${i}`));
    const d: TextElement['data'] = { blocks, verticalAnchor: 'top' };
    drawText(asCtx(ctx), { w: 400, h: 40 }, d, THEME);
    const firstY = ctx.fillText.mock.calls[0][2] as number;
    expect(firstY).toBeGreaterThanOrEqual(0);
    expect(firstY).toBeLessThan(20);
  });
});

describe('drawText placeholder hint', () => {
  it('paints the hint when blocks are empty and a hint is supplied', () => {
    const ctx = createCtxSpy();
    // A single block whose lone inline has an empty string — the same
    // shape `isElementEmpty` treats as "empty" — must surface the ghost.
    drawText(
      asCtx(ctx),
      size,
      data([paragraph('')]),
      THEME,
      { placeholderHint: { text: 'Click to add title', style: TITLE_STYLE } },
    );
    const texts = ctx.fillText.mock.calls.map((c) => c[0]);
    expect(texts).toContain('Click to add title');
  });

  it('does not paint the hint when blocks contain real text', () => {
    const ctx = createCtxSpy();
    // The real text wins — the hint must NOT appear, otherwise authors
    // would see the ghost layered behind their first character.
    drawText(
      asCtx(ctx),
      size,
      data([paragraph('Hello')]),
      THEME,
      { placeholderHint: { text: 'Click to add title', style: TITLE_STYLE } },
    );
    const texts = ctx.fillText.mock.calls.map((c) => c[0]);
    expect(texts).not.toContain('Click to add title');
  });

  it('does not paint the hint when no hint is supplied', () => {
    const ctx = createCtxSpy();
    // User-added text boxes (no placeholderRef) flow through this path:
    // empty blocks, no hint — must paint nothing.
    drawText(asCtx(ctx), size, data([paragraph('')]), THEME);
    expect(ctx.fillText).not.toHaveBeenCalled();
  });

  it('left-aligned hint anchors at (padding, padding)', () => {
    const ctx = createCtxSpy();
    drawText(
      asCtx(ctx),
      size,
      data([paragraph('')]),
      THEME,
      { placeholderHint: { text: 'Click to add title', style: TITLE_STYLE } },
    );
    // Title style is left-aligned → x = padding (8), y = padding (8).
    expect(ctx.fillText).toHaveBeenCalledWith('Click to add title', 8, 8);
  });

  it('center-aligned hint anchors at (w/2, padding)', () => {
    const ctx = createCtxSpy();
    const centerStyle: PlaceholderStyle = { ...TITLE_STYLE, align: 'center' };
    drawText(
      asCtx(ctx),
      size,
      data([paragraph('')]),
      THEME,
      { placeholderHint: { text: 'Click to add number', style: centerStyle } },
    );
    expect(ctx.fillText).toHaveBeenCalledWith('Click to add number', size.w / 2, 8);
  });
});
