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
