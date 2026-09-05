import { describe, it, expect } from 'vitest';
import {
  computeLayout,
  DOCS_LAYOUT_OPTIONS,
  type LayoutOptions,
} from '../../src/view/layout.js';
import { computeTableLayout } from '../../src/view/table-layout.js';
import {
  createBlock,
  createTableBlock,
  createTableCell,
} from '../../src/model/types.js';
import type { Block, TableData } from '../../src/model/types.js';
import { stubMeasurer } from './_stub-measurer.js';

const DARK: LayoutOptions = { ...DOCS_LAYOUT_OPTIONS, surface: 'dark' };
const LIGHT: LayoutOptions = { ...DOCS_LAYOUT_OPTIONS, surface: 'light' };

function heading3(text = 'Details'): Block {
  const b = createBlock('heading', { headingLevel: 3 });
  b.inlines = [{ text, style: {} }];
  return b;
}

function firstRunColor(
  blocks: Block[],
  opts?: LayoutOptions,
): unknown {
  const { layout } = computeLayout(
    blocks, stubMeasurer(), 600, undefined, undefined, undefined, undefined, opts,
  );
  return layout.blocks[0].lines[0].runs[0].inline.style.color;
}

describe('named-style colors are resolved per surface', () => {
  it('paints the Google Docs grey on the light surface, and when no surface is asked for', () => {
    expect(firstRunColor([heading3()])).toBe('#434343');
    expect(firstRunColor([heading3()], DOCS_LAYOUT_OPTIONS)).toBe('#434343');
    expect(firstRunColor([heading3()], LIGHT)).toBe('#434343');
  });

  it('paints the lighter grey on the dark surface', () => {
    expect(firstRunColor([heading3()], DARK)).toBe('#B0B0B0');

    const sub = createBlock('subtitle');
    sub.inlines = [{ text: 'A subtitle', style: {} }];
    expect(firstRunColor([sub], DARK)).toBe('#999999');
  });

  it('leaves a style that carries no grey inheriting the theme ink', () => {
    const h1 = createBlock('heading', { headingLevel: 1 });
    h1.inlines = [{ text: 'Decisions', style: {} }];
    expect(firstRunColor([h1], DARK)).toBeUndefined();
    expect(firstRunColor([h1], LIGHT)).toBeUndefined();
  });

  it('never remaps a color the user explicitly picked', () => {
    // The remap only ever writes into the *defaults* layer, and the run's own
    // style spreads over it — so someone who deliberately chose the same grey
    // the catalog uses keeps it on both surfaces.
    const b = heading3();
    b.inlines = [{ text: 'Details', style: { color: '#666666' } }];
    expect(firstRunColor([b], DARK)).toBe('#666666');
    expect(firstRunColor([b], LIGHT)).toBe('#666666');
  });

  it('lets a document style override beat the dark remap', () => {
    const { layout } = computeLayout(
      [heading3()], stubMeasurer(), 600, undefined, undefined, undefined,
      { 'heading-3': { inline: { color: '#00ff00' } } },
      DARK,
    );
    expect(layout.blocks[0].lines[0].runs[0].inline.style.color).toBe('#00ff00');
  });

  it('changes no metric between the two surfaces', () => {
    // Load-bearing: the exporters resolve light while the screen may resolve
    // dark, so any metric difference would move page breaks on export.
    const blocks = () => [heading3('A heading that is long enough to wrap once or twice'), createBlock('paragraph')];
    const light = computeLayout(blocks(), stubMeasurer(), 200, undefined, undefined, undefined, undefined, LIGHT).layout;
    const dark = computeLayout(blocks(), stubMeasurer(), 200, undefined, undefined, undefined, undefined, DARK).layout;
    expect(dark.totalHeight).toBe(light.totalHeight);
    expect(dark.blocks.map((b) => [b.y, b.height, b.lines.length]))
      .toEqual(light.blocks.map((b) => [b.y, b.height, b.lines.length]));
  });

  it('invalidates the incremental layout cache across a theme toggle', () => {
    // A cached `LayoutRun.inline` holds the *merged* style, so reusing lines
    // would repaint the previous surface's grey. Nothing is dirty here, which
    // is exactly the case the cache key has to catch.
    const blocks = [heading3()];
    const first = computeLayout(
      blocks, stubMeasurer(), 600, new Set<string>(), undefined, undefined, undefined, LIGHT,
    );
    expect(first.layout.blocks[0].lines[0].runs[0].inline.style.color).toBe('#434343');

    const second = computeLayout(
      blocks, stubMeasurer(), 600, new Set<string>(), first.cache, undefined, undefined, DARK,
    );
    expect(second.layout.blocks[0].lines[0].runs[0].inline.style.color).toBe('#B0B0B0');

    // ...and reusing the cache on the *same* surface still hits it.
    const third = computeLayout(
      blocks, stubMeasurer(), 600, new Set<string>(), second.cache, undefined, undefined, DARK,
    );
    expect(third.layout.blocks[0].lines[0].runs[0].inline.style.color).toBe('#B0B0B0');
    expect(third.layout.blocks[0].lines[0]).toBe(second.layout.blocks[0].lines[0]);
  });

  it('keeps `surface` out of the shared docs options constant', () => {
    // The exporters and the CLI paginator lay out with this constant. If a
    // `surface` key ever appears on it, a PDF exported from a dark-mode
    // editor starts printing dark-mode greys on white paper.
    expect('surface' in DOCS_LAYOUT_OPTIONS).toBe(false);
  });
});

describe('named-style colors inside tables', () => {
  function cellHeadingColor(layoutCells: { lines: Array<{ runs: Array<{ inline: { style: { color?: unknown } } }> }> }): unknown {
    for (const line of layoutCells.lines) {
      if (line.runs.length > 0) return line.runs[0].inline.style.color;
    }
    return undefined;
  }

  it('reaches a heading in a table cell', () => {
    const table = createTableBlock(1, 1);
    table.tableData!.rows[0].cells[0].blocks = [heading3()];
    const dark = computeTableLayout(
      table.tableData!, table.id, stubMeasurer(), 400, undefined, undefined, 'dark',
    );
    const light = computeTableLayout(
      table.tableData!, table.id, stubMeasurer(), 400, undefined, undefined, undefined,
    );
    expect(cellHeadingColor(dark.cells[0][0])).toBe('#B0B0B0');
    expect(cellHeadingColor(light.cells[0][0])).toBe('#434343');
  });

  it('reaches a heading in a NESTED table cell', () => {
    // The recursion is the hop most likely to be dropped when threading;
    // missing it leaves headings deep in a table unreadable while the body's
    // are fixed, which reads as a different bug.
    const inner = createTableBlock(1, 1);
    inner.tableData!.rows[0].cells[0].blocks = [heading3('Nested')];
    const outerCell = createTableCell();
    outerCell.blocks.push(inner);
    const outer: TableData = { rows: [{ cells: [outerCell] }], columnWidths: [1] };

    const dark = computeTableLayout(
      outer, 'outer', stubMeasurer(), 400, undefined, undefined, 'dark',
    );
    const nested = dark.cells[0][0].lines.find((l) => l.nestedTable)!.nestedTable!;
    expect(cellHeadingColor(nested.cells[0][0])).toBe('#B0B0B0');
  });

  it('reaches a heading in a table laid out through computeLayout', () => {
    const table = createTableBlock(1, 1);
    table.tableData!.rows[0].cells[0].blocks = [heading3()];
    const { layout } = computeLayout(
      [table], stubMeasurer(), 600, undefined, undefined, undefined, undefined, DARK,
    );
    const cell = layout.blocks[0].layoutTable!.cells[0][0];
    expect(cellHeadingColor(cell)).toBe('#B0B0B0');
  });
});
