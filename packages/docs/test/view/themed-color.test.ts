// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { computeLayout } from '../../src/view/layout.js';
import { paintLayout } from '../../src/view/paint-layout.js';
import { DEFAULT_BLOCK_STYLE, type Block } from '../../src/model/types.js';
import type { ColorResolver } from '../../src/model/color.js';
import { StubMeasurer } from './_stub-measurer.js';

/**
 * Records every value written to `fillStyle` so the assertion can prove
 * the resolver-supplied hex actually reached the painter. Plain
 * `vi.fn()` cannot intercept setter writes, so we use a JS getter/setter
 * pair backed by a string array.
 */
function makeFakeCtx(): {
  ctx: CanvasRenderingContext2D;
  fillStyles: string[];
} {
  const fillStyles: string[] = [];
  let current = '';
  const ctx = {
    get fillStyle() {
      return current;
    },
    set fillStyle(v: string) {
      current = v;
      fillStyles.push(v);
    },
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textBaseline: 'alphabetic' as const,
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    drawImage: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })),
  } as unknown as CanvasRenderingContext2D;
  return { ctx, fillStyles };
}

describe('paintLayout colorResolver', () => {
  it('uses the supplied colorResolver for ThemeColor values', () => {
    const blocks: Block[] = [
      {
        id: 'b1',
        type: 'paragraph',
        inlines: [
          { text: 'Hi', style: { color: { kind: 'role', role: 'accent1' } } },
        ],
        style: { ...DEFAULT_BLOCK_STYLE },
      },
    ];
    const { ctx, fillStyles } = makeFakeCtx();
    const measurer = new StubMeasurer();
    const resolver: ColorResolver = (c) => {
      if (c && typeof c === 'object' && c.kind === 'role' && c.role === 'accent1') {
        return '#ff9900';
      }
      return undefined;
    };
    const { layout } = computeLayout(blocks, measurer, 200);
    paintLayout(ctx, layout, 0, 0, { colorResolver: resolver });
    expect(fillStyles).toContain('#ff9900');
  });

  it('falls back to theme defaultColor when the resolver returns undefined', () => {
    const blocks: Block[] = [
      {
        id: 'b1',
        type: 'paragraph',
        inlines: [
          { text: 'Hi', style: { color: { kind: 'role', role: 'unknown' } } },
        ],
        style: { ...DEFAULT_BLOCK_STYLE },
      },
    ];
    const { ctx, fillStyles } = makeFakeCtx();
    const measurer = new StubMeasurer();
    const { layout } = computeLayout(blocks, measurer, 200);
    paintLayout(ctx, layout, 0, 0); // no resolver — defaultColorResolver
    // Default resolver returns undefined for role colors; renderRun
    // should fall back to the theme default rather than the literal
    // string "undefined".
    expect(fillStyles).not.toContain('undefined');
    expect(fillStyles.some((s) => s.startsWith('#'))).toBe(true);
  });
});
