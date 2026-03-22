import { describe, it, expect, beforeEach } from 'vitest';
import { computeLayout, clearMeasureCache } from '../../src/view/layout.js';
import type { LayoutCache } from '../../src/view/layout.js';
import type { Block } from '../../src/model/types.js';
import { createEmptyBlock } from '../../src/model/types.js';

function makeBlock(text: string): Block {
  const block = createEmptyBlock();
  block.inlines = [{ text, style: {} }];
  return block;
}

function mockCtx(): CanvasRenderingContext2D {
  return {
    font: '',
    measureText: (text: string) => ({ width: text.length * 8 } as TextMetrics),
  } as unknown as CanvasRenderingContext2D;
}

describe('incremental layout', () => {
  beforeEach(() => clearMeasureCache());

  it('returns a cache on first call', () => {
    const blocks = [makeBlock('Hello'), makeBlock('World')];
    const result = computeLayout(blocks, mockCtx(), 500);
    expect(result.cache).toBeDefined();
    expect(result.cache.blocks.size).toBe(2);
  });

  it('reuses cached blocks when dirtyBlockIds is empty', () => {
    const blocks = [makeBlock('Hello'), makeBlock('World')];
    const first = computeLayout(blocks, mockCtx(), 500);
    const second = computeLayout(blocks, mockCtx(), 500, new Set(), first.cache);
    expect(second.layout.blocks[0].lines).toBe(first.layout.blocks[0].lines);
    expect(second.layout.blocks[1].lines).toBe(first.layout.blocks[1].lines);
  });

  it('recomputes only the dirty block', () => {
    const blocks = [makeBlock('Hello'), makeBlock('World')];
    const first = computeLayout(blocks, mockCtx(), 500);
    blocks[1] = makeBlock('Changed');
    const dirty = new Set([blocks[1].id]);
    const second = computeLayout(blocks, mockCtx(), 500, dirty, first.cache);
    expect(second.layout.blocks[0].lines).toBe(first.layout.blocks[0].lines);
    expect(second.layout.blocks[1].lines).not.toBe(first.layout.blocks[1].lines);
  });

  it('recalculates Y offsets even for cached blocks', () => {
    const blocks = [makeBlock('Hello'), makeBlock('World')];
    const first = computeLayout(blocks, mockCtx(), 500);
    const origY = first.layout.blocks[1].y;
    blocks[0] = makeBlock('A '.repeat(200));
    const dirty = new Set([blocks[0].id]);
    const second = computeLayout(blocks, mockCtx(), 500, dirty, first.cache);
    expect(second.layout.blocks[1].y).toBeGreaterThan(origY);
  });

  it('does full recompute when cache contentWidth differs', () => {
    const blocks = [makeBlock('Hello')];
    const first = computeLayout(blocks, mockCtx(), 500);
    const second = computeLayout(blocks, mockCtx(), 400, new Set(), first.cache);
    expect(second.layout.blocks[0].lines).not.toBe(first.layout.blocks[0].lines);
  });
});
