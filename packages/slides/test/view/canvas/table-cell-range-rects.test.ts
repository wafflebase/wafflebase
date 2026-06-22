// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import '../../../src/view/canvas/test-canvas-env';
import type { Frame, TableElement } from '../../../src/model/element';
import {
  computeTableLayout,
  projectCellRangeRects,
} from '../../../src/view/canvas/table-renderer';

/** Build a uniform-grid table at `frame` with the given column widths /
 *  row heights, all cells empty + unmerged unless overridden. */
function table(
  frame: Frame,
  columnWidths: number[],
  rowHeights: number[],
  override: (r: number, c: number) => Partial<TableElement['data']['rows'][number]['cells'][number]> = () => ({}),
): TableElement {
  return {
    id: 't1',
    type: 'table',
    frame,
    data: {
      columnWidths,
      rows: rowHeights.map((height, r) => ({
        height,
        cells: columnWidths.map((_, c) => ({
          body: { blocks: [] },
          style: {},
          ...override(r, c),
        })),
      })),
    },
  };
}

const f = (x: number, y: number, w: number, h: number, rotation = 0): Frame => ({
  x,
  y,
  w,
  h,
  rotation,
});

describe('projectCellRangeRects', () => {
  it('projects a single cell to a frame offset by the table origin', () => {
    const t = table(f(100, 200, 100, 40), [40, 60], [20, 20]);
    const layout = computeTableLayout(t.data);
    const rects = projectCellRangeRects(t, { r0: 1, c0: 1, r1: 1, c1: 1 }, layout);
    // Cell (1,1): x = 100 + 40, y = 200 + 20, w = 60, h = 20.
    expect(rects).toEqual([f(140, 220, 60, 20)]);
  });

  it('emits one rect per non-covered cell across a range', () => {
    const t = table(f(0, 0, 100, 40), [50, 50], [20, 20]);
    const layout = computeTableLayout(t.data);
    const rects = projectCellRangeRects(t, { r0: 0, c0: 0, r1: 1, c1: 1 }, layout);
    expect(rects).toEqual([
      f(0, 0, 50, 20),
      f(50, 0, 50, 20),
      f(0, 20, 50, 20),
      f(50, 20, 50, 20),
    ]);
  });

  it('normalizes a reversed (focus-before-anchor) range', () => {
    const t = table(f(0, 0, 100, 40), [50, 50], [20, 20]);
    const layout = computeTableLayout(t.data);
    const forward = projectCellRangeRects(t, { r0: 0, c0: 0, r1: 1, c1: 1 }, layout);
    const reversed = projectCellRangeRects(t, { r0: 1, c0: 1, r1: 0, c1: 0 }, layout);
    expect(reversed).toEqual(forward);
  });

  it('expands a merge anchor to its full span and skips covered cells', () => {
    // Top row is one 2-wide merged cell: anchor (0,0) gridSpan 2,
    // covered cell (0,1) gridSpan 0.
    const t = table(f(0, 0, 100, 40), [50, 50], [20, 20], (r, c) => {
      if (r === 0 && c === 0) return { gridSpan: 2 };
      if (r === 0 && c === 1) return { gridSpan: 0 };
      return {};
    });
    const layout = computeTableLayout(t.data);
    const rects = projectCellRangeRects(t, { r0: 0, c0: 0, r1: 0, c1: 1 }, layout);
    // Only the anchor contributes a rect, spanning both columns.
    expect(rects).toEqual([f(0, 0, 100, 20)]);
  });

  it('carries the table rotation onto every rect', () => {
    const t = table(f(0, 0, 100, 20), [50, 50], [20], () => ({}));
    t.frame.rotation = 0.5;
    const layout = computeTableLayout(t.data);
    const rects = projectCellRangeRects(t, { r0: 0, c0: 0, r1: 0, c1: 1 }, layout);
    expect(rects.every((r) => r.rotation === 0.5)).toBe(true);
  });
});
