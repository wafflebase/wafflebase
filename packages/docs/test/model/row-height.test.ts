import { describe, test, expect } from 'vitest';
import {
  normalizeRowHeight,
  MAX_ROW_HEIGHT,
} from '../../src/model/row-height.js';
import { treeNodeToBlock } from '../../src/model/crdt-tree.js';
import { computeTableLayout } from '../../src/view/table-layout.js';
import { computeLayout } from '../../src/view/layout.js';
import { paginateLayout } from '../../src/view/pagination.js';
import {
  createTableBlock,
  DEFAULT_PAGE_SETUP,
  getEffectiveDimensions,
} from '../../src/model/types.js';
import { stubMeasurer } from '../view/_stub-measurer.js';

/**
 * A `rowHeights` entry arrives from a peer's Tree attribute or from a
 * pasted payload, and the paginator turns it into one page per loop
 * iteration. `Infinity` never terminates; `1e9` px against a ~864 px
 * content height is over a million pages, each carrying its own
 * `PageLine`. Both are a hang or an OOM for every *reader* of the
 * document, inflicted by one writer.
 */

describe('normalizeRowHeight', () => {
  test('passes an in-band height through', () => {
    expect(normalizeRowHeight(40)).toBe(40);
    expect(normalizeRowHeight(MAX_ROW_HEIGHT)).toBe(MAX_ROW_HEIGHT);
  });

  test('an absent height stays absent (auto)', () => {
    expect(normalizeRowHeight(undefined)).toBeUndefined();
  });

  test('a non-finite height reads as auto', () => {
    expect(normalizeRowHeight(NaN)).toBeUndefined();
    expect(normalizeRowHeight(Infinity)).toBeUndefined();
    expect(normalizeRowHeight(-Infinity)).toBeUndefined();
  });

  test('a non-positive height reads as auto', () => {
    expect(normalizeRowHeight(0)).toBeUndefined();
    expect(normalizeRowHeight(-40)).toBeUndefined();
  });

  test('a height past the ceiling is clamped to it', () => {
    expect(normalizeRowHeight(1e9)).toBe(MAX_ROW_HEIGHT);
  });
});

describe('a poisoned rowHeight at the raw readers', () => {
  test('the CRDT read boundary clamps a peer-supplied height', () => {
    const read = (rowHeights: string): (number | undefined)[] | undefined =>
      treeNodeToBlock({
        type: 'block',
        attributes: { type: 'table', cols: '1', rowHeights },
        children: [
          {
            type: 'row',
            children: [{ type: 'cell', children: [] }],
          },
        ],
      }).tableData?.rowHeights;

    expect(read('40')).toEqual([40]);
    // An empty slot is the serializer's own "auto" marker, kept as-is.
    expect(read('40,')).toEqual([40, undefined]);
    expect(read('1e9')).toEqual([MAX_ROW_HEIGHT]);
    expect(read('Infinity')).toEqual([undefined]);
    expect(read('not-a-number')).toEqual([undefined]);
    expect(read('-40')).toEqual([undefined]);
    // Position is preserved, so a poisoned entry does not shift its
    // neighbours onto the wrong rows.
    expect(read('40,Infinity,60')).toEqual([40, undefined, 60]);
  });

  // The user-specified height is not the only way a row height goes
  // non-finite: steps 3–4 derive one from the cell's content. `computeLayout`
  // is the single place a row height becomes geometry, so it is the one that
  // has to publish a number every consumer — offsets, `totalHeight`, the
  // paginator, the renderers, the hit-tests — can use.
  test('a non-finite content height still publishes finite geometry', () => {
    const block = createTableBlock(1, 1);
    block.tableData!.rows[0].cells[0].blocks[0].inlines[0].style.fontSize =
      Infinity;
    const layout = computeTableLayout(
      block.tableData!,
      'poisoned-content',
      stubMeasurer(7),
      300,
    );
    expect(Number.isFinite(layout.rowHeights[0])).toBe(true);
    expect(Number.isFinite(layout.rowYOffsets[0])).toBe(true);
    expect(Number.isFinite(layout.totalHeight)).toBe(true);
  });

  test('computeTableLayout lays a poisoned height out at finite geometry', () => {
    const block = createTableBlock(1, 1);
    const td = block.tableData!;
    td.rowHeights = [Infinity];
    const layout = computeTableLayout(td, 'poisoned-table', stubMeasurer(7), 300);
    expect(Number.isFinite(layout.rowHeights[0])).toBe(true);
    expect(Number.isFinite(layout.totalHeight)).toBe(true);
  });

  // The clamp that actually matters: `paginateLayout`'s row-split loop
  // emits one page per iteration until it has consumed the row height.
  test('paginateLayout terminates on an unbounded row height', () => {
    const setup = DEFAULT_PAGE_SETUP;
    const { width } = getEffectiveDimensions(setup);
    const contentWidth = width - setup.margins.left - setup.margins.right;

    const paginateWith = (height: number) => {
      const block = createTableBlock(1, 1);
      block.tableData!.rowHeights = [height];
      const { layout } = computeLayout([block], stubMeasurer(7), contentWidth);
      return paginateLayout(layout, setup);
    };

    // Infinity would loop forever; 1e9 would build ~1.1M pages.
    for (const poison of [Infinity, 1e9, NaN, -1e9]) {
      const result = paginateWith(poison);
      // MAX_ROW_HEIGHT / one page's content height, with room to spare.
      expect(result.pages.length).toBeLessThanOrEqual(16);
    }

    // A legitimately tall row still splits across pages.
    expect(paginateWith(2000).pages.length).toBeGreaterThanOrEqual(2);
  });
});
