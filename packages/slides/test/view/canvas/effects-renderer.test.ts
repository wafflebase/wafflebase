// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import type { Theme } from '../../../src/model/theme';
import type { DropShadow, Reflection } from '../../../src/model/element';
import {
  applyShadow,
  clearShadow,
  colorWithAlpha,
  paintReflection,
} from '../../../src/view/canvas/effects-renderer';
import { asCtx, createCtxSpy } from '../../../src/view/canvas/ctx-spy';

const THEME: Theme = {
  id: 't',
  name: 't',
  colors: {
    text: '#000000',
    background: '#ffffff',
    textSecondary: '#444444',
    backgroundAlt: '#f3f3f3',
    accent1: '#aabbcc',
    accent2: '#bbccdd',
    accent3: '#ccddee',
    accent4: '#ddeeff',
    accent5: '#e0e1e2',
    accent6: '#f0f1f2',
    hyperlink: '#1111cc',
    visitedHyperlink: '#7711aa',
  },
  fonts: { heading: 'Inter', body: 'Inter' },
};

describe('colorWithAlpha', () => {
  it('expands 6-digit hex into rgba with the given opacity', () => {
    expect(colorWithAlpha('#000000', 0.4)).toBe('rgba(0, 0, 0, 0.4)');
    expect(colorWithAlpha('#aabbcc', 1)).toBe('rgba(170, 187, 204, 1)');
  });

  it('expands 3-digit shorthand hex', () => {
    expect(colorWithAlpha('#abc', 0.5)).toBe('rgba(170, 187, 204, 0.5)');
  });

  it('drops an existing 8-digit alpha and applies the new opacity', () => {
    expect(colorWithAlpha('#11223344', 0.25)).toBe('rgba(17, 34, 51, 0.25)');
  });

  it('clamps opacity into [0, 1]', () => {
    expect(colorWithAlpha('#000000', 2)).toBe('rgba(0, 0, 0, 1)');
    expect(colorWithAlpha('#000000', -1)).toBe('rgba(0, 0, 0, 0)');
  });

  it('passes non-hex CSS through unchanged', () => {
    expect(colorWithAlpha('red', 0.5)).toBe('red');
  });
});

describe('applyShadow / clearShadow', () => {
  const shadow: DropShadow = {
    color: '#000000',
    opacity: 0.5,
    angle: 0,
    distance: 10,
    blur: 4,
  };

  it('sets shadow state with a polar offset derived from angle/distance', () => {
    const ctx = createCtxSpy();
    applyShadow(asCtx(ctx), shadow, THEME);
    expect(ctx.shadowColor).toBe('rgba(0, 0, 0, 0.5)');
    expect(ctx.shadowBlur).toBe(4);
    // angle 0 ⇒ pure +x offset.
    expect(ctx.shadowOffsetX).toBeCloseTo(10);
    expect(ctx.shadowOffsetY).toBeCloseTo(0);
  });

  it('points the offset down-right at 45°', () => {
    const ctx = createCtxSpy();
    applyShadow(asCtx(ctx), { ...shadow, angle: Math.PI / 4 }, THEME);
    expect(ctx.shadowOffsetX).toBeCloseTo(10 * Math.SQRT1_2);
    expect(ctx.shadowOffsetY).toBeCloseTo(10 * Math.SQRT1_2);
  });

  it('resolves a theme color reference for the shadow color', () => {
    const ctx = createCtxSpy();
    applyShadow(
      asCtx(ctx),
      { ...shadow, color: { kind: 'role', role: 'accent1' } },
      THEME,
    );
    expect(ctx.shadowColor).toBe('rgba(170, 187, 204, 0.5)');
  });

  it('clears the shadow state', () => {
    const ctx = createCtxSpy();
    applyShadow(asCtx(ctx), shadow, THEME);
    clearShadow(asCtx(ctx));
    expect(ctx.shadowColor).toBe('transparent');
    expect(ctx.shadowBlur).toBe(0);
    expect(ctx.shadowOffsetX).toBe(0);
    expect(ctx.shadowOffsetY).toBe(0);
  });
});

describe('paintReflection', () => {
  const reflection: Reflection = { opacity: 0.4, distance: 5, size: 0.5 };

  it('no-ops gracefully when no offscreen 2D context is available', () => {
    // Force `getContext` to return null so the test is deterministic
    // regardless of whether the `canvas` package is present.
    const fakeCanvas = { width: 0, height: 0, getContext: vi.fn(() => null) };
    const create = vi
      .spyOn(document, 'createElement')
      .mockReturnValue(fakeCanvas as unknown as HTMLCanvasElement);
    try {
      const ctx = createCtxSpy();
      let bodyCalls = 0;
      paintReflection(asCtx(ctx), { w: 100, h: 60 }, reflection, () => {
        bodyCalls++;
      });
      expect(bodyCalls).toBe(0);
      expect(ctx.drawImage).not.toHaveBeenCalled();
    } finally {
      create.mockRestore();
    }
  });

  it('skips when reflection size is zero', () => {
    const ctx = createCtxSpy();
    let bodyCalls = 0;
    paintReflection(
      asCtx(ctx),
      { w: 100, h: 60 },
      { ...reflection, size: 0 },
      () => {
        bodyCalls++;
      },
    );
    expect(bodyCalls).toBe(0);
  });

  it('renders the body offscreen, fades it, and draws it flipped below', () => {
    const grad = { addColorStop: vi.fn() };
    const offCtx = {
      globalCompositeOperation: 'source-over' as GlobalCompositeOperation,
      fillStyle: '' as string | CanvasGradient,
      createLinearGradient: vi.fn(() => grad),
      fillRect: vi.fn(),
    };
    const fakeCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => offCtx),
    };
    const create = vi
      .spyOn(document, 'createElement')
      .mockReturnValue(fakeCanvas as unknown as HTMLCanvasElement);
    try {
      const ctx = createCtxSpy();
      let bodyTarget: unknown;
      paintReflection(asCtx(ctx), { w: 100, h: 60 }, reflection, (t) => {
        bodyTarget = t;
      });
      // Body painted into the offscreen ctx.
      expect(bodyTarget).toBe(offCtx);
      // Faded with a destination-out linear gradient.
      expect(offCtx.globalCompositeOperation).toBe('destination-out');
      expect(offCtx.createLinearGradient).toHaveBeenCalled();
      expect(offCtx.fillRect).toHaveBeenCalledWith(0, 0, 100, 60);
      // Mirror drawn below, vertically flipped.
      expect(ctx.globalAlpha).toBeCloseTo(0.4);
      expect(ctx.scale).toHaveBeenCalledWith(1, -1);
      expect(ctx.drawImage).toHaveBeenCalledWith(fakeCanvas, 0, 0, 100, 60);
    } finally {
      create.mockRestore();
    }
  });

  it('does not inherit the caller’s shadow when blitting the mirror', () => {
    const grad = { addColorStop: vi.fn() };
    const offCtx = {
      globalCompositeOperation: 'source-over' as GlobalCompositeOperation,
      fillStyle: '' as string | CanvasGradient,
      createLinearGradient: vi.fn(() => grad),
      fillRect: vi.fn(),
    };
    const fakeCanvas = { width: 0, height: 0, getContext: vi.fn(() => offCtx) };
    const create = vi
      .spyOn(document, 'createElement')
      .mockReturnValue(fakeCanvas as unknown as HTMLCanvasElement);
    try {
      const ctx = createCtxSpy();
      // Simulate an active drop shadow on the caller's context (the text /
      // image branches reach paintReflection right after applyShadow).
      applyShadow(
        asCtx(ctx),
        { color: '#000000', opacity: 0.5, angle: 0, distance: 8, blur: 4 },
        THEME,
      );
      // Capture the shadow state at the moment the mirror is blitted.
      let shadowAtBlit: string | undefined;
      ctx.drawImage.mockImplementation(() => {
        shadowAtBlit = ctx.shadowColor;
      });
      paintReflection(asCtx(ctx), { w: 100, h: 60 }, reflection, () => {});
      expect(shadowAtBlit).toBe('transparent');
    } finally {
      create.mockRestore();
    }
  });
});
