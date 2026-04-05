import { describe, it, expect, vi } from 'vitest';
import { resolvePositionPixel, drawPeerCaret, drawPeerLabel } from '../../src/view/peer-cursor.js';
import type { DocumentLayout, LayoutBlock, LayoutLine, LayoutRun } from '../../src/view/layout.js';
import type { PaginatedLayout } from '../../src/view/pagination.js';
import { DEFAULT_PAGE_SETUP } from '../../src/model/types.js';

function mockRun(text: string, x: number, width: number, charStart: number): LayoutRun {
  return {
    inline: {
      text,
      style: { fontSize: 11, fontFamily: 'Arial' },
    },
    text,
    x,
    width,
    inlineIndex: 0,
    charStart,
    charEnd: charStart + text.length,
    charOffsets: Array.from({ length: text.length }, (_, i) => (width / text.length) * (i + 1)),
  };
}

function mockLine(runs: LayoutRun[], height = 20): LayoutLine {
  return { runs, y: 0, height, width: runs.reduce((s, r) => s + r.width, 0) };
}

function mockBlock(id: string, lines: LayoutLine[]): LayoutBlock {
  return {
    block: {
      id,
      type: 'paragraph',
      inlines: [{ text: 'hello', style: {} }],
      style: { alignment: 'left', lineHeight: 1.5, marginTop: 0, marginBottom: 8, textIndent: 0, marginLeft: 0 },
    },
    x: 0,
    y: 0,
    width: 624,
    height: lines.reduce((s, l) => s + l.height, 0),
    lines,
  };
}

function makeCtx(): CanvasRenderingContext2D {
  return {
    font: '',
    measureText: vi.fn(() => ({ width: 30 })),
    fillStyle: '',
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arcTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
    textBaseline: 'top',
  } as unknown as CanvasRenderingContext2D;
}

function makePaginatedLayout(blocks: LayoutBlock[]): PaginatedLayout {
  // Build a simple single-page paginated layout manually
  const lines = blocks.flatMap((b, bi) =>
    b.lines.map((line, li) => ({
      blockIndex: bi,
      lineIndex: li,
      line,
      x: 96, // margins.left
      y: 96 + li * line.height, // margins.top + offset
    }))
  );
  return {
    pages: [{ pageIndex: 0, lines, width: 816, height: 1056 }],
    pageSetup: DEFAULT_PAGE_SETUP,
  };
}

describe('resolvePositionPixel', () => {
  it('returns undefined for unknown blockId', () => {
    const run = mockRun('hello', 0, 50, 0);
    const line = mockLine([run]);
    const block = mockBlock('b1', [line]);
    const layout: DocumentLayout = { blocks: [block], totalHeight: 20, blockParentMap: new Map() };
    const paginatedLayout = makePaginatedLayout([block]);
    const ctx = makeCtx();

    const result = resolvePositionPixel(
      { blockId: 'nonexistent', offset: 0 },
      'backward',
      paginatedLayout,
      layout,
      ctx,
      1200,
    );
    expect(result).toBeUndefined();
  });

  it('returns pixel coords for a valid position at offset 0', () => {
    const run = mockRun('hello', 0, 50, 0);
    const line = mockLine([run]);
    const block = mockBlock('b1', [line]);
    const layout: DocumentLayout = { blocks: [block], totalHeight: 20, blockParentMap: new Map() };
    const paginatedLayout = makePaginatedLayout([block]);
    const ctx = makeCtx();

    const result = resolvePositionPixel(
      { blockId: 'b1', offset: 0 },
      'backward',
      paginatedLayout,
      layout,
      ctx,
      1200,
    );
    expect(result).toBeDefined();
    expect(typeof result!.x).toBe('number');
    expect(typeof result!.y).toBe('number');
    expect(typeof result!.height).toBe('number');
    expect(result!.height).toBe(20);
  });

  it('returns pixel coords for a valid position at end of text', () => {
    const run = mockRun('hello', 0, 50, 0);
    const line = mockLine([run]);
    const block = mockBlock('b1', [line]);
    const layout: DocumentLayout = { blocks: [block], totalHeight: 20, blockParentMap: new Map() };
    const paginatedLayout = makePaginatedLayout([block]);
    const ctx = makeCtx();

    const result = resolvePositionPixel(
      { blockId: 'b1', offset: 5 },
      'backward',
      paginatedLayout,
      layout,
      ctx,
      1200,
    );
    expect(result).toBeDefined();
    expect(result!.height).toBe(20);
  });
});

describe('drawPeerCaret', () => {
  it('calls fillRect with correct color and position', () => {
    const ctx = makeCtx();
    const pixel = { x: 100, y: 50, height: 20 };

    drawPeerCaret(ctx, pixel, '#FF0000');

    expect(ctx.fillStyle).toBe('#FF0000');
    expect(ctx.fillRect).toHaveBeenCalledWith(100, 50, 2, 20);
  });

  it('uses the provided color', () => {
    const ctx = makeCtx();
    const pixel = { x: 0, y: 0, height: 15 };

    drawPeerCaret(ctx, pixel, '#00BFFF');

    expect(ctx.fillStyle).toBe('#00BFFF');
    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
  });
});

describe('drawPeerLabel', () => {
  it('does not throw for a normal username', () => {
    const ctx = makeCtx();
    const pixel = { x: 100, y: 50, height: 20 };

    expect(() => {
      drawPeerLabel(ctx, pixel, 'Alice', '#3B82F6', 40, 1200);
    }).not.toThrow();

    expect(ctx.fill).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalled();
  });

  it('does not throw for a very long username (triggers truncation)', () => {
    const ctx = makeCtx();
    const pixel = { x: 100, y: 50, height: 20 };

    // Mock measureText to return large widths for long strings
    const mockCtx = {
      ...ctx,
      measureText: vi.fn((text: string) => ({ width: text.length * 10 })),
    } as unknown as CanvasRenderingContext2D;

    expect(() => {
      drawPeerLabel(mockCtx, pixel, 'A'.repeat(50), '#EF4444', 40, 1200);
    }).not.toThrow();
  });

  it('flips label below caret when y would overflow page top', () => {
    const ctx = makeCtx();
    // Position near top of page — label would go above page top
    const pixel = { x: 100, y: 42, height: 20 };
    const pageTopY = 40;

    expect(() => {
      drawPeerLabel(ctx, pixel, 'Bob', '#10B981', pageTopY, 1200);
    }).not.toThrow();

    // The label y should have been placed below the caret (pixel.y + pixel.height)
    // We verify fill was called (label was drawn)
    expect(ctx.fill).toHaveBeenCalled();
  });

  it('clamps label x when it overflows canvas right edge', () => {
    const ctx = makeCtx();
    // Position near right edge
    const pixel = { x: 1180, y: 200, height: 20 };

    expect(() => {
      drawPeerLabel(ctx, pixel, 'Carol', '#8B5CF6', 40, 1200);
    }).not.toThrow();

    expect(ctx.fill).toHaveBeenCalled();
  });
});
