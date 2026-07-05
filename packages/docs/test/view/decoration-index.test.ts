import { describe, it, expect, beforeEach } from 'vitest';
import { computeLayout, clearMeasureCache } from '../../src/view/layout.js';
import {
  paginateLayout,
  findPageForPosition,
  getBlockIndex,
  getBlockPageLines,
  getBlockYExtent,
  getPageYOffset,
} from '../../src/view/pagination.js';
import { DEFAULT_PAGE_SETUP, getEffectiveDimensions } from '../../src/model/types.js';
import type { Block } from '../../src/model/types.js';
import { createEmptyBlock } from '../../src/model/types.js';
import { stubMeasurer } from './_stub-measurer.js';

function makeBlock(text: string): Block {
  const block = createEmptyBlock();
  block.inlines = [{ text, style: {} }];
  return block;
}

function buildDoc(nBlocks: number) {
  const blocks = Array.from({ length: nBlocks }, (_, i) =>
    makeBlock(`Block number ${i} content`),
  );
  const setup = DEFAULT_PAGE_SETUP;
  const { width } = getEffectiveDimensions(setup);
  const contentWidth = width - setup.margins.left - setup.margins.right;
  const layout = computeLayout(blocks, stubMeasurer(), contentWidth).layout;
  const paginated = paginateLayout(layout, setup);
  return { blocks, layout, paginated };
}

describe('decoration index helpers', () => {
  beforeEach(() => clearMeasureCache());

  it('builds a multi-page fixture', () => {
    const { paginated } = buildDoc(200);
    expect(paginated.pages.length).toBeGreaterThan(1);
  });

  describe('getBlockIndex', () => {
    it('maps every block id to its document-order index', () => {
      const { blocks, layout } = buildDoc(50);
      blocks.forEach((b, i) => {
        expect(getBlockIndex(layout, b.id)).toBe(i);
      });
    });

    it('returns -1 for unknown ids', () => {
      const { layout } = buildDoc(10);
      expect(getBlockIndex(layout, 'no-such-block')).toBe(-1);
    });

    it('memoizes per layout object (same Map instance reused)', () => {
      const { layout } = buildDoc(10);
      // Prime the cache, then a second lookup must hit the same structure —
      // observable only via correctness, so assert repeated calls agree.
      const first = getBlockIndex(layout, layout.blocks[3].block.id);
      const second = getBlockIndex(layout, layout.blocks[3].block.id);
      expect(first).toBe(3);
      expect(second).toBe(3);
    });
  });

  describe('getBlockPageLines', () => {
    it('groups every page line under its block index in page order', () => {
      const { layout, paginated } = buildDoc(200);
      const map = getBlockPageLines(paginated);

      // Reconstruct the same grouping by brute force and compare.
      const expected = new Map<number, Array<{ pageIndex: number; lineIndex: number }>>();
      for (const page of paginated.pages) {
        for (const pl of page.lines) {
          const arr = expected.get(pl.blockIndex) ?? [];
          arr.push({ pageIndex: page.pageIndex, lineIndex: pl.lineIndex });
          expected.set(pl.blockIndex, arr);
        }
      }

      expect(map.size).toBe(expected.size);
      for (const [blockIndex, entries] of expected) {
        const got = map.get(blockIndex);
        expect(got).toBeDefined();
        expect(got!.map((e) => ({ pageIndex: e.pageIndex, lineIndex: e.pageLine.lineIndex }))).toEqual(
          entries,
        );
      }
      // Every block that has layout lines is represented.
      expect(map.has(0)).toBe(true);
      expect(map.has(layout.blocks.length - 1)).toBe(true);
    });
  });

  describe('getBlockYExtent', () => {
    it('returns absolute top/bottom Y bounds per block', () => {
      const { paginated } = buildDoc(200);
      const extent = getBlockYExtent(paginated);

      for (const page of paginated.pages) {
        const pageY = getPageYOffset(paginated, page.pageIndex);
        for (const pl of page.lines) {
          const top = pageY + pl.y;
          const bottom = top + (pl.rowSplitHeight ?? pl.line.height);
          const ext = extent.get(pl.blockIndex);
          expect(ext).toBeDefined();
          expect(ext!.top).toBeLessThanOrEqual(top);
          expect(ext!.bottom).toBeGreaterThanOrEqual(bottom);
        }
      }
    });

    it('orders block extents monotonically down the document', () => {
      const { layout, paginated } = buildDoc(200);
      const extent = getBlockYExtent(paginated);
      let prevTop = -Infinity;
      for (let i = 0; i < layout.blocks.length; i++) {
        const ext = extent.get(i);
        if (!ext) continue;
        expect(ext.top).toBeGreaterThanOrEqual(prevTop);
        prevTop = ext.top;
      }
    });
  });

  describe('findPageForPosition (refactored, behavior preserved)', () => {
    it('resolves each block start to the page whose extent contains it', () => {
      const { layout, paginated } = buildDoc(200);
      const extent = getBlockYExtent(paginated);
      for (let i = 0; i < layout.blocks.length; i++) {
        const blockId = layout.blocks[i].block.id;
        const found = findPageForPosition(paginated, blockId, 0, layout);
        expect(found).toBeDefined();
        const pageY = getPageYOffset(paginated, found!.pageIndex);
        const absY = pageY + found!.pageLine.y;
        const ext = extent.get(i)!;
        expect(absY).toBeGreaterThanOrEqual(ext.top - 0.5);
        expect(absY).toBeLessThanOrEqual(ext.bottom + 0.5);
      }
    });

    it('returns undefined for unknown block ids', () => {
      const { layout, paginated } = buildDoc(10);
      expect(findPageForPosition(paginated, 'nope', 0, layout)).toBeUndefined();
    });
  });
});
