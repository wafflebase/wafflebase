import { describe, test, expect } from 'vitest';
import {
  MAX_CELL_PADDING,
  MAX_FONT_SIZE,
  MAX_IMAGE_SIZE,
  MAX_LINE_HEIGHT,
  MAX_TABLE_COLUMNS,
  MAX_TABLE_SPAN,
  isPaintableImageSize,
  normalizeCellPadding,
  normalizeFontSize,
  normalizeLineHeight,
  normalizeTableSpan,
  parseColumnWidthsAttr,
  bandBlockNumerics,
} from '../../src/model/numeric-attrs.js';
import { expandCellRangeForMerges } from '../../src/view/selection.js';
import { treeNodeToBlock } from '../../src/model/crdt-tree.js';
import { computeLayout } from '../../src/view/layout.js';
import { paginateLayout } from '../../src/view/pagination.js';
import {
  createTableBlock,
  DEFAULT_BLOCK_STYLE,
  DEFAULT_PAGE_SETUP,
  getEffectiveDimensions,
} from '../../src/model/types.js';
import type { Block } from '../../src/model/types.js';
import { stubMeasurer } from '../view/_stub-measurer.js';

/**
 * `rowHeights` is not the only untrusted number that becomes a table row
 * height: steps 3–4 of `computeTableLayout` derive one from the cell's
 * content, and every line height in that sum comes from a font size, an
 * inline image, or a paragraph's line spacing. Each of those is its own
 * peer-writable Tree attribute, so each reaches `paginateLayout`'s
 * `while (consumed < rowHeight)` loop the same way a poisoned `rowHeights`
 * entry does — a hang, or a million `PageLine`s, for every *reader* of the
 * document.
 */

describe('the numeric attribute bands', () => {
  test('normalizeFontSize', () => {
    expect(normalizeFontSize(11)).toBe(11);
    expect(normalizeFontSize(MAX_FONT_SIZE)).toBe(MAX_FONT_SIZE);
    expect(normalizeFontSize(undefined)).toBeUndefined();
    expect(normalizeFontSize(NaN)).toBeUndefined();
    expect(normalizeFontSize(Infinity)).toBeUndefined();
    expect(normalizeFontSize(0)).toBeUndefined();
    expect(normalizeFontSize(-11)).toBeUndefined();
    expect(normalizeFontSize(1e9)).toBe(MAX_FONT_SIZE);
  });

  test('normalizeLineHeight', () => {
    expect(normalizeLineHeight(1.5)).toBe(1.5);
    expect(normalizeLineHeight(MAX_LINE_HEIGHT)).toBe(MAX_LINE_HEIGHT);
    expect(normalizeLineHeight(undefined)).toBeUndefined();
    expect(normalizeLineHeight(NaN)).toBeUndefined();
    expect(normalizeLineHeight(-Infinity)).toBeUndefined();
    expect(normalizeLineHeight(0)).toBeUndefined();
    expect(normalizeLineHeight(1e9)).toBe(MAX_LINE_HEIGHT);
  });

  test('normalizeCellPadding keeps zero — no padding is a real style', () => {
    expect(normalizeCellPadding(0)).toBe(0);
    expect(normalizeCellPadding(4)).toBe(4);
    expect(normalizeCellPadding(undefined)).toBeUndefined();
    expect(normalizeCellPadding(NaN)).toBeUndefined();
    expect(normalizeCellPadding(Infinity)).toBeUndefined();
    expect(normalizeCellPadding(-4)).toBeUndefined();
    expect(normalizeCellPadding(1e9)).toBe(MAX_CELL_PADDING);
  });

  test('isPaintableImageSize rejects a pair either edge of which is poisoned', () => {
    expect(isPaintableImageSize(300, 200)).toBe(true);
    expect(isPaintableImageSize(MAX_IMAGE_SIZE, MAX_IMAGE_SIZE)).toBe(true);
    expect(isPaintableImageSize(300, Infinity)).toBe(false);
    expect(isPaintableImageSize(NaN, 200)).toBe(false);
    expect(isPaintableImageSize(300, 0)).toBe(false);
    expect(isPaintableImageSize(300, 1e9)).toBe(false);
    expect(isPaintableImageSize(1e9, 200)).toBe(false);
  });
});

describe('the CRDT read boundary bands them', () => {
  const inlineStyle = (attributes: Record<string, string>) =>
    treeNodeToBlock({
      type: 'block',
      attributes: { type: 'paragraph' },
      children: [
        {
          type: 'inline',
          attributes,
          children: [{ type: 'text', value: 'hi' }],
        },
      ],
    }).inlines[0].style;

  test('fontSize', () => {
    expect(inlineStyle({ fontSize: '11' }).fontSize).toBe(11);
    // Non-finite or non-positive is dropped, so the resolved default applies.
    expect(inlineStyle({ fontSize: 'Infinity' }).fontSize).toBeUndefined();
    expect(inlineStyle({ fontSize: 'not-a-number' }).fontSize).toBeUndefined();
    expect(inlineStyle({ fontSize: '-11' }).fontSize).toBeUndefined();
    // Finite but above the ceiling is clamped and kept *present*.
    expect(inlineStyle({ fontSize: '1e9' }).fontSize).toBe(MAX_FONT_SIZE);
  });

  test('the inline image size', () => {
    const image = (width: string, height: string) =>
      inlineStyle({ 'image.src': 'x.png', 'image.width': width, 'image.height': height }).image;

    expect(image('300', '200')).toMatchObject({ width: 300, height: 200 });
    expect(image('300', 'Infinity')).toBeUndefined();
    expect(image('300', '1e9')).toBeUndefined();
  });

  test('the block lineHeight', () => {
    const lineHeight = (value: string) =>
      treeNodeToBlock({
        type: 'block',
        attributes: { type: 'paragraph', lineHeight: value },
        children: [],
      }).style.lineHeight;

    expect(lineHeight('1.5')).toBe(1.5);
    // Non-finite or non-positive is dropped, so `parseBlockStyleAttrs`'s
    // spread over `DEFAULT_BLOCK_STYLE` supplies the multiple — not the
    // ceiling.
    expect(lineHeight('Infinity')).toBe(DEFAULT_BLOCK_STYLE.lineHeight);
    expect(lineHeight('-2')).toBe(DEFAULT_BLOCK_STYLE.lineHeight);
    // Finite but above the ceiling is clamped and kept *present*.
    expect(lineHeight('1e9')).toBe(MAX_LINE_HEIGHT);
  });

  test('the cell padding', () => {
    const padding = (value: string) =>
      treeNodeToBlock({
        type: 'block',
        attributes: { type: 'table', cols: '1' },
        children: [
          {
            type: 'row',
            children: [{ type: 'cell', attributes: { padding: value }, children: [] }],
          },
        ],
      }).tableData?.rows[0].cells[0].style.padding;

    expect(padding('8')).toBe(8);
    // Dropped, then clamped-and-kept — the band's two branches.
    expect(padding('Infinity')).toBeUndefined();
    expect(padding('not-a-number')).toBeUndefined();
    expect(padding('1e9')).toBe(MAX_CELL_PADDING);
  });
});

/**
 * The bands above are one half. The other is that `paginateLayout` bounds its
 * own row-split loop, because `LayoutTable.rowHeights` has producers that
 * never pass a read boundary at all — the paste sanitizer, and the cell
 * content path exercised here.
 */
describe('paginateLayout bounds a content-derived row height', () => {
  const setup = DEFAULT_PAGE_SETUP;
  const { width } = getEffectiveDimensions(setup);
  const contentWidth = width - setup.margins.left - setup.margins.right;

  const paginateCellWith = (mutate: (block: ReturnType<typeof createTableBlock>) => void) => {
    const block = createTableBlock(1, 1);
    mutate(block);
    const { layout } = computeLayout([block], stubMeasurer(7), contentWidth);
    return paginateLayout(layout, setup);
  };

  test('a poisoned font size inside a cell neither hangs nor floods pages', () => {
    for (const fontSize of [Infinity, 1e9, NaN]) {
      const result = paginateCellWith((block) => {
        block.tableData!.rows[0].cells[0].blocks[0].inlines[0].style.fontSize = fontSize;
      });
      // 200 pages is the loop's own ceiling; anything under it proves the
      // loop terminated rather than looping on `Infinity`.
      expect(result.pages.length).toBeLessThanOrEqual(202);
    }
  });

  test('a poisoned cell padding neither hangs nor floods pages', () => {
    for (const padding of [Infinity, 1e9]) {
      const result = paginateCellWith((block) => {
        block.tableData!.rows[0].cells[0].style.padding = padding;
      });
      expect(result.pages.length).toBeLessThanOrEqual(202);
    }
  });

  test('a poisoned line height inside a cell neither hangs nor floods pages', () => {
    for (const lineHeight of [Infinity, 1e9]) {
      const result = paginateCellWith((block) => {
        block.tableData!.rows[0].cells[0].blocks[0].style.lineHeight = lineHeight;
      });
      expect(result.pages.length).toBeLessThanOrEqual(202);
    }
  });

  // The bound must not make the paginator disagree with the layout about how
  // tall the row is: `LayoutTable.rowHeights` / `rowYOffsets` / `totalHeight`
  // are what the renderers, the hit-tests and the selection geometry read, and
  // they read them raw. So the fragments of a bounded row still have to sum to
  // the row height the layout published, and each fragment's `PageLine.height`
  // still has to *be* that row height.
  test('a bounded row still agrees with the layout geometry', () => {
    const block = createTableBlock(1, 1);
    block.tableData!.rows[0].cells[0].blocks[0].inlines[0].style.fontSize = 1e9;
    const { layout } = computeLayout([block], stubMeasurer(7), contentWidth);
    const rowHeight = layout.blocks[0].layoutTable!.rowHeights[0];
    const result = paginateLayout(layout, setup);
    const fragments = result.pages
      .flatMap((p) => p.lines)
      .filter((l) => l.blockIndex === 0 && l.lineIndex === 0);

    expect(result.pages.length).toBeLessThanOrEqual(202);
    expect(fragments.length).toBeGreaterThan(1);
    for (const f of fragments) expect(f.line.height).toBe(rowHeight);
    const consumed = fragments.reduce(
      (sum, f) => sum + (f.rowSplitHeight ?? f.line.height),
      0,
    );
    expect(consumed).toBe(rowHeight);
  });

  test('a genuinely tall cell still splits across pages', () => {
    const result = paginateCellWith((block) => {
      const cell = block.tableData!.rows[0].cells[0];
      cell.blocks = Array.from({ length: 200 }, (_, i) => ({
        id: `p${i}`,
        type: 'paragraph' as const,
        inlines: [{ text: 'content', style: {} }],
        style: { ...DEFAULT_BLOCK_STYLE },
      }));
    });
    expect(result.pages.length).toBeGreaterThanOrEqual(2);
  });
});

/**
 * The table *structure* attributes are bands of their own, and their sinks are
 * worse than a tall row: a span is the bound of a fixed-point loop, and the
 * column count is the inner bound of an allocation loop.
 */
describe('the table structure bands', () => {
  test('normalizeTableSpan keeps the covered-cell marker', () => {
    // `0` is the marker `computeTableLayout` and `normalizeTableMerges` key
    // on — dropping it would take every merged table apart.
    expect(normalizeTableSpan(0)).toBe(0);
    expect(normalizeTableSpan(2)).toBe(2);
    expect(normalizeTableSpan(2.7)).toBe(2);
    expect(normalizeTableSpan(undefined)).toBeUndefined();
    expect(normalizeTableSpan(NaN)).toBeUndefined();
    expect(normalizeTableSpan(Infinity)).toBeUndefined();
    expect(normalizeTableSpan(-1)).toBeUndefined();
    expect(normalizeTableSpan(1e9)).toBe(MAX_TABLE_SPAN);
  });

  test('parseColumnWidthsAttr bounds the count and the magnitude', () => {
    expect(parseColumnWidthsAttr(undefined)).toEqual([]);
    expect(parseColumnWidthsAttr('0.5,0.5')).toEqual([0.5, 0.5]);
    // `Number('1e400')` is `Infinity`, which the old `!isNaN` filter passed.
    expect(parseColumnWidthsAttr('1e400,0.5')).toEqual([0.5]);
    expect(parseColumnWidthsAttr('-1,2')).toEqual([0, 2]);
    expect(
      parseColumnWidthsAttr(new Array(5000).fill('0.001').join(',')).length,
    ).toBe(MAX_TABLE_COLUMNS);
  });

  test('the CRDT read boundary bands a peer-written span', () => {
    const cellOf = (attributes: Record<string, string>) =>
      treeNodeToBlock({
        type: 'block',
        attributes: { type: 'table', cols: '1' },
        children: [
          { type: 'row', children: [{ type: 'cell', attributes, children: [] }] },
        ],
      }).tableData!.rows[0].cells[0];

    expect(cellOf({ colSpan: '2' }).colSpan).toBe(2);
    expect(cellOf({ colSpan: '0' }).colSpan).toBe(0);
    expect(cellOf({ rowSpan: 'Infinity' }).rowSpan).toBeUndefined();
    expect(cellOf({ rowSpan: '1e9' }).rowSpan).toBe(MAX_TABLE_SPAN);
  });

  test('the CRDT read boundary bands a peer-written cols attribute', () => {
    const colsOf = (cols: string) =>
      treeNodeToBlock({
        type: 'block',
        attributes: { type: 'table', cols },
        children: [],
      }).tableData!.columnWidths;

    expect(colsOf('0.5,0.5')).toEqual([0.5, 0.5]);
    expect(colsOf('1e400')).toEqual([]);
    expect(colsOf(new Array(5000).fill('0.001').join(',')).length).toBe(
      MAX_TABLE_COLUMNS,
    );
  });

  // The regression this band exists for: `expandCellRangeForMerges` widens the
  // selected rectangle to `r + rowSpan - 1` inside a `while (changed)` loop,
  // so an unbanded `Infinity` makes `rowEnd` infinite and the `for` inside it
  // never terminates — a permanently hung tab for anyone who selects cells.
  test('a table read from a poisoned tree can still be cell-selected', () => {
    const block = treeNodeToBlock({
      type: 'block',
      attributes: { type: 'table', cols: '0.5,0.5' },
      children: [
        {
          type: 'row',
          children: [
            { type: 'cell', attributes: { rowSpan: 'Infinity' }, children: [] },
            { type: 'cell', attributes: {}, children: [] },
          ],
        },
      ],
    });
    const expanded = expandCellRangeForMerges(
      {
        blockId: block.id,
        start: { rowIndex: 0, colIndex: 0 },
        end: { rowIndex: 0, colIndex: 1 },
      },
      block.tableData!,
    );
    expect(Number.isFinite(expanded.end.rowIndex)).toBe(true);
  });
});

// The band for the bodies that reach the same layout engine through a door
// with no attribute codec behind it: a slide's text boxes, shape text, table
// cells and notes are stored as plain JSON and read back verbatim, so this
// walk is what the Tree codec above is for a docs body.
describe('bandBlockNumerics — the codec-free bodies', () => {
  test('bands a run font size, a line height and a list level', () => {
    const blocks = [
      {
        id: 'b1',
        type: 'list-item',
        listLevel: Infinity,
        style: { lineHeight: 1e9 },
        inlines: [
          { text: 'a', style: { fontSize: 1e9 } },
          { text: 'b', style: { fontSize: Infinity } },
        ],
      },
    ] as unknown as Block[];

    const out = bandBlockNumerics(blocks);

    expect(out).toBe(blocks);
    const block = out[0] as unknown as {
      listLevel: number;
      style: { lineHeight?: number };
      inlines: { style: { fontSize?: number } }[];
    };
    expect(block.listLevel).toBe(0);
    expect(block.style.lineHeight).toBe(MAX_LINE_HEIGHT);
    expect(block.inlines[0].style.fontSize).toBe(MAX_FONT_SIZE);
    // Non-finite drops rather than clamps, so the resolved default applies.
    expect(block.inlines[1].style.fontSize).toBeUndefined();
  });

  test('drops an inline image whose size cannot be painted', () => {
    const blocks = [
      {
        id: 'b1',
        type: 'paragraph',
        style: {},
        inlines: [
          { text: '', style: { image: { src: 'x', width: 1e9, height: 10 } } },
          { text: '', style: { image: { src: 'y', width: 10, height: 10 } } },
        ],
      },
    ] as unknown as Block[];

    const inlines = (bandBlockNumerics(blocks)[0] as unknown as {
      inlines: { style: { image?: unknown } }[];
    }).inlines;
    expect(inlines[0].style.image).toBeUndefined();
    expect(inlines[1].style.image).toEqual({ src: 'y', width: 10, height: 10 });
  });

  test('bands a table block and recurses into its cells', () => {
    const blocks = [
      {
        id: 'b1',
        type: 'table',
        style: {},
        inlines: [],
        tableData: {
          rowHeights: [Infinity, 40],
          columnWidths: new Array(5000).fill(0.0002).concat([Infinity]),
          rows: [
            {
              cells: [
                {
                  style: { padding: Infinity },
                  rowSpan: Infinity,
                  colSpan: 1e9,
                  blocks: [
                    {
                      id: 'c1',
                      type: 'paragraph',
                      style: {},
                      inlines: [{ text: 'x', style: { fontSize: 1e9 } }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    ] as unknown as Block[];

    const table = (bandBlockNumerics(blocks)[0] as unknown as {
      tableData: {
        rowHeights: (number | undefined)[];
        columnWidths: number[];
        rows: {
          cells: {
            style: { padding?: number };
            rowSpan?: number;
            colSpan?: number;
            blocks: { inlines: { style: { fontSize?: number } }[] }[];
          }[];
        }[];
      };
    }).tableData;

    expect(table.rowHeights).toEqual([undefined, 40]);
    expect(table.columnWidths.length).toBe(MAX_TABLE_COLUMNS);
    const cell = table.rows[0].cells[0];
    expect(cell.style.padding).toBeUndefined();
    expect(cell.rowSpan).toBeUndefined();
    expect(cell.colSpan).toBe(MAX_TABLE_SPAN);
    expect(cell.blocks[0].inlines[0].style.fontSize).toBe(MAX_FONT_SIZE);
  });

  test('leaves values inside the band exactly as stored', () => {
    const blocks = [
      {
        id: 'b1',
        type: 'list-item',
        listLevel: 2,
        style: { lineHeight: 1.5 },
        inlines: [{ text: 'a', style: { fontSize: 11 } }],
      },
    ] as unknown as Block[];

    expect(bandBlockNumerics(structuredClone(blocks))).toEqual(blocks);
  });
});
