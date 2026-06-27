// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import {
  renderTable,
  renderTableBackgrounds,
  renderTableContent,
} from '../../src/view/table-renderer.js';
import type { TableData } from '../../src/model/types.js';
import { DEFAULT_BLOCK_STYLE, DEFAULT_CELL_STYLE } from '../../src/model/types.js';
import type { LayoutTable } from '../../src/view/table-layout.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Minimal canvas stub that records method calls in the order they
 * arrive. Enough for verifying that the background and content passes
 * stay separable — we do not need a real 2D context.
 */
function makeRecordingCtx(): {
  ctx: CanvasRenderingContext2D;
  fillRect: ReturnType<typeof vi.fn>;
  fillText: ReturnType<typeof vi.fn>;
  stroke: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
} {
  const fillRect = vi.fn();
  const fillText = vi.fn();
  const stroke = vi.fn();
  const drawImage = vi.fn();
  const ctx = {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    textBaseline: 'alphabetic' as const,
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    setLineDash: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })),
    fillRect,
    fillText,
    stroke,
    drawImage,
  } as unknown as CanvasRenderingContext2D;
  return { ctx, fillRect, fillText, stroke, drawImage };
}

function makeTable(): { tableData: TableData; layout: LayoutTable } {
  // 2-row × 2-col table. Cell [0][0] has a red background.
  const tableData: TableData = {
    rows: [
      {
        cells: [
          {
            blocks: [{ id: 'b1', type: 'paragraph', inlines: [{ text: 'A1', style: {} }], style: { ...DEFAULT_BLOCK_STYLE } }],
            style: { ...DEFAULT_CELL_STYLE, backgroundColor: '#ff0000' },
          },
          {
            blocks: [{ id: 'b2', type: 'paragraph', inlines: [{ text: 'B1', style: {} }], style: { ...DEFAULT_BLOCK_STYLE } }],
            style: { ...DEFAULT_CELL_STYLE },
          },
        ],
      },
      {
        cells: [
          {
            blocks: [{ id: 'b3', type: 'paragraph', inlines: [{ text: 'A2', style: {} }], style: { ...DEFAULT_BLOCK_STYLE } }],
            style: { ...DEFAULT_CELL_STYLE },
          },
          {
            blocks: [{ id: 'b4', type: 'paragraph', inlines: [{ text: 'B2', style: {} }], style: { ...DEFAULT_BLOCK_STYLE } }],
            style: { ...DEFAULT_CELL_STYLE },
          },
        ],
      },
    ],
    columnWidths: [0.5, 0.5],
  };
  const layout: LayoutTable = {
    cells: [
      [
        {
          lines: [
            { y: 0, height: 16, width: 40, runs: [{ inline: { text: 'A1', style: {} }, text: 'A1', x: 0, width: 20, inlineIndex: 0, charStart: 0, charEnd: 2, charOffsets: [10, 20] }] },
          ],
          blockBoundaries: [0],
          width: 40,
          height: 16,
          merged: false,
        },
        {
          lines: [
            { y: 0, height: 16, width: 40, runs: [{ inline: { text: 'B1', style: {} }, text: 'B1', x: 0, width: 20, inlineIndex: 0, charStart: 0, charEnd: 2, charOffsets: [10, 20] }] },
          ],
          blockBoundaries: [0],
          width: 40,
          height: 16,
          merged: false,
        },
      ],
      [
        {
          lines: [
            { y: 0, height: 16, width: 40, runs: [{ inline: { text: 'A2', style: {} }, text: 'A2', x: 0, width: 20, inlineIndex: 0, charStart: 0, charEnd: 2, charOffsets: [10, 20] }] },
          ],
          blockBoundaries: [0],
          width: 40,
          height: 16,
          merged: false,
        },
        {
          lines: [
            { y: 0, height: 16, width: 40, runs: [{ inline: { text: 'B2', style: {} }, text: 'B2', x: 0, width: 20, inlineIndex: 0, charStart: 0, charEnd: 2, charOffsets: [10, 20] }] },
          ],
          blockBoundaries: [0],
          width: 40,
          height: 16,
          merged: false,
        },
      ],
    ],
    columnXOffsets: [0, 40],
    columnPixelWidths: [40, 40],
    rowYOffsets: [0, 16],
    rowHeights: [16, 16],
    totalWidth: 80,
    totalHeight: 32,
    blockParentMap: new Map(),
  };
  return { tableData, layout };
}

describe('renderTableBackgrounds', () => {
  it('fills only cells with a backgroundColor and never draws text or borders', () => {
    const { ctx, fillRect, fillText, stroke } = makeRecordingCtx();
    const { tableData, layout } = makeTable();
    renderTableBackgrounds(ctx, tableData, layout, 0, 0);
    // Exactly one cell has a background, so exactly one fillRect call.
    expect(fillRect).toHaveBeenCalledTimes(1);
    expect(fillRect).toHaveBeenCalledWith(0, 0, 40, 16);
    // No text rendering and no border strokes happen in the background pass.
    expect(fillText).not.toHaveBeenCalled();
    expect(stroke).not.toHaveBeenCalled();
  });
});

describe('renderTableContent', () => {
  it('draws cell text (fillText) and borders (stroke) but no cell backgrounds', () => {
    const { ctx, fillRect, fillText, stroke } = makeRecordingCtx();
    const { tableData, layout } = makeTable();
    renderTableContent(ctx, tableData, layout, 0, 0);
    // Four cells × one text run each.
    expect(fillText).toHaveBeenCalledTimes(4);
    // Borders are drawn with stroke(). At least one stroke per visible
    // cell edge — we just check the content pass touches stroke at all.
    expect(stroke).not.toHaveBeenCalledTimes(0);
    // fillRect must NOT be used for cell backgrounds here. Inline run
    // backgrounds would also be fillRects — this test uses plain runs
    // without backgrounds, so fillRect should stay at zero.
    expect(fillRect).not.toHaveBeenCalled();
  });
});

describe('inline run backgroundColor render order', () => {
  // Regression: when a run inside a table cell carried
  // `style.backgroundColor`, the bg fillRect was painted in
  // renderTableContent — i.e. AFTER the editor's selection layer was
  // drawn between the two passes — so the translucent selection
  // highlight became invisible inside the colored span. Inline bg
  // must now land in renderTableBackgrounds.
  function makeTableWithInlineBg(): {
    tableData: TableData;
    layout: LayoutTable;
  } {
    const yellowStyle = { backgroundColor: '#ffeb3b' };
    const tableData: TableData = {
      rows: [
        {
          cells: [
            {
              blocks: [
                {
                  id: 'b1',
                  type: 'paragraph',
                  inlines: [{ text: 'hi', style: yellowStyle }],
                  style: { ...DEFAULT_BLOCK_STYLE },
                },
              ],
              style: { ...DEFAULT_CELL_STYLE },
            },
          ],
        },
      ],
      columnWidths: [1],
    };
    const layout: LayoutTable = {
      cells: [
        [
          {
            lines: [
              {
                y: 0,
                height: 16,
                width: 40,
                runs: [
                  {
                    inline: { text: 'hi', style: yellowStyle },
                    text: 'hi',
                    x: 0,
                    width: 20,
                    inlineIndex: 0,
                    charStart: 0,
                    charEnd: 2,
                    charOffsets: [10, 20],
                  },
                ],
              },
            ],
            blockBoundaries: [0],
            width: 40,
            height: 16,
            merged: false,
          },
        ],
      ],
      columnXOffsets: [0],
      columnPixelWidths: [40],
      rowYOffsets: [0],
      rowHeights: [16],
      totalWidth: 40,
      totalHeight: 16,
      blockParentMap: new Map(),
    };
    return { tableData, layout };
  }

  it('paints inline run backgrounds during renderTableBackgrounds', () => {
    const { ctx, fillRect } = makeRecordingCtx();
    const { tableData, layout } = makeTableWithInlineBg();
    renderTableBackgrounds(ctx, tableData, layout, 0, 0);
    // No cell-level bg in this fixture, so the only fillRect should be
    // the run's inline bg painted in the background pass.
    expect(fillRect).toHaveBeenCalledTimes(1);
    // padding=4 (default), runX = 0 + 4 + 0 = 4; lineY = 4 (top
    // alignment, padding); width=20, height=16.
    expect(fillRect).toHaveBeenCalledWith(4, 4, 20, 16);
  });

  it('renderTableContent skips inline run backgrounds (drawn in pre-pass)', () => {
    const { ctx, fillRect } = makeRecordingCtx();
    const { tableData, layout } = makeTableWithInlineBg();
    renderTableContent(ctx, tableData, layout, 0, 0);
    // The bg was already drawn in renderTableBackgrounds; the content
    // pass must not redraw it, otherwise it would cover the selection
    // layer that the editor draws between the two passes.
    expect(fillRect).not.toHaveBeenCalled();
  });
});

describe('renderTableContent image inlines', () => {
  // Regression: inline image runs inside a table cell were rendered with
  // fillText(run.text) where `run.text` is the Object Replacement Character
  // (U+FFFC), so the picture was never painted — only a blank placeholder
  // glyph. Body paragraphs in doc-canvas handled this via drawImage; the
  // table renderer must do the same.
  const ORC = '\uFFFC';

  function makeImageCellTable(): { tableData: TableData; layout: LayoutTable } {
    const imageStyle = {
      image: { src: 'https://example.invalid/cell-image.png', width: 60, height: 20 },
    };
    const tableData: TableData = {
      rows: [
        {
          cells: [
            {
              blocks: [
                {
                  id: 'b1',
                  type: 'paragraph',
                  inlines: [{ text: ORC, style: imageStyle }],
                  style: { ...DEFAULT_BLOCK_STYLE },
                },
              ],
              style: { ...DEFAULT_CELL_STYLE },
            },
          ],
        },
      ],
      columnWidths: [1],
    };
    const layout: LayoutTable = {
      cells: [
        [
          {
            lines: [
              {
                y: 0,
                height: 20,
                width: 60,
                runs: [
                  {
                    inline: { text: ORC, style: imageStyle },
                    text: ORC,
                    x: 0,
                    width: 60,
                    inlineIndex: 0,
                    charStart: 0,
                    charEnd: 1,
                    charOffsets: [60],
                    imageHeight: 20,
                  },
                ],
              },
            ],
            blockBoundaries: [0],
            width: 60,
            height: 20,
            merged: false,
          },
        ],
      ],
      columnXOffsets: [0],
      columnPixelWidths: [80],
      rowYOffsets: [0],
      rowHeights: [28],
      totalWidth: 80,
      totalHeight: 28,
      blockParentMap: new Map(),
    };
    return { tableData, layout };
  }

  it('never calls fillText with the ORC placeholder for image runs', () => {
    const { ctx, fillText } = makeRecordingCtx();
    const { tableData, layout } = makeImageCellTable();
    renderTableContent(ctx, tableData, layout, 0, 0);
    // The regression: before the fix, this was exactly one fillText(ORC)
    // call per image inline.
    for (const call of fillText.mock.calls) {
      expect(call[0]).not.toBe(ORC);
    }
  });

  it('does not synchronously draw or call requestRender while the image is loading', () => {
    // Under jsdom the image never finishes loading during the render
    // call, so drawImage stays uncalled and requestRender is only
    // invoked later from the Image's onload. Synchronously during the
    // renderTableContent call, neither should fire — and the absence of
    // a fillText(ORC) call in the test above guarantees the image
    // branch was actually taken rather than falling through to text.
    const { ctx, drawImage } = makeRecordingCtx();
    const { tableData, layout } = makeImageCellTable();
    const requestRender = vi.fn();
    renderTableContent(
      ctx,
      tableData,
      layout,
      0,
      0,
      undefined,
      undefined,
      undefined,
      requestRender,
    );
    expect(drawImage).not.toHaveBeenCalled();
    expect(requestRender).not.toHaveBeenCalled();
  });
});

describe('renderTableContent page-number fields', () => {
  // A header/footer table cell can host a page-number field
  // (`inline.style.pageNumber`). Its layout run carries a `#` placeholder;
  // renderTableContent must substitute the resolved page number when one is
  // threaded through, mirroring the flat header/footer paragraph path.
  function makePageNumberCellTable(): {
    tableData: TableData;
    layout: LayoutTable;
  } {
    const pnStyle = { pageNumber: true };
    const tableData: TableData = {
      rows: [
        {
          cells: [
            {
              blocks: [
                {
                  id: 'b1',
                  type: 'paragraph',
                  inlines: [{ text: '#', style: pnStyle }],
                  style: { ...DEFAULT_BLOCK_STYLE },
                },
              ],
              style: { ...DEFAULT_CELL_STYLE },
            },
          ],
        },
      ],
      columnWidths: [1],
    };
    const layout: LayoutTable = {
      cells: [
        [
          {
            lines: [
              {
                y: 0,
                height: 16,
                width: 40,
                runs: [
                  {
                    inline: { text: '#', style: pnStyle },
                    text: '#',
                    x: 0,
                    width: 10,
                    inlineIndex: 0,
                    charStart: 0,
                    charEnd: 1,
                    charOffsets: [10],
                  },
                ],
              },
            ],
            blockBoundaries: [0],
            width: 40,
            height: 16,
            merged: false,
          },
        ],
      ],
      columnXOffsets: [0],
      columnPixelWidths: [40],
      rowYOffsets: [0],
      rowHeights: [16],
      totalWidth: 40,
      totalHeight: 16,
      blockParentMap: new Map(),
    };
    return { tableData, layout };
  }

  it('substitutes the page number for the placeholder when pageNumber is supplied', () => {
    const { ctx, fillText } = makeRecordingCtx();
    const { tableData, layout } = makePageNumberCellTable();
    renderTableContent(
      ctx, tableData, layout, 0, 0,
      undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, 7,
    );
    const drawn = fillText.mock.calls.map((c) => c[0]);
    expect(drawn).toContain('7');
    expect(drawn).not.toContain('#');
  });

  it('draws the literal placeholder when no page number is threaded (body path)', () => {
    const { ctx, fillText } = makeRecordingCtx();
    const { tableData, layout } = makePageNumberCellTable();
    renderTableContent(ctx, tableData, layout, 0, 0);
    const drawn = fillText.mock.calls.map((c) => c[0]);
    expect(drawn).toContain('#');
  });

  it('propagates the page number into a nested table cell', () => {
    // The page-number run lives in a nested table inside an outer cell. The
    // recursive renderTableContent call must thread pageNumber down so the
    // nested cell substitutes the number, not its '#' placeholder.
    const { ctx, fillText } = makeRecordingCtx();
    const inner = makePageNumberCellTable();
    const nestedBlock = {
      id: 'nested',
      type: 'table' as const,
      inlines: [],
      style: { ...DEFAULT_BLOCK_STYLE },
      tableData: inner.tableData,
    };
    const outerTableData: TableData = {
      rows: [{ cells: [{ blocks: [nestedBlock], style: { ...DEFAULT_CELL_STYLE } }] }],
      columnWidths: [1],
    };
    const outerLayout: LayoutTable = {
      cells: [
        [
          {
            lines: [
              { y: 0, height: 16, width: 40, runs: [], nestedTable: inner.layout },
            ],
            blockBoundaries: [0],
            width: 40,
            height: 16,
            merged: false,
          },
        ],
      ],
      columnXOffsets: [0],
      columnPixelWidths: [40],
      rowYOffsets: [0],
      rowHeights: [16],
      totalWidth: 40,
      totalHeight: 16,
      blockParentMap: new Map(),
    };
    renderTableContent(
      ctx, outerTableData, outerLayout, 0, 0,
      undefined, undefined, undefined, undefined, undefined,
      undefined, undefined, undefined, undefined, 9,
    );
    const drawn = fillText.mock.calls.map((c) => c[0]);
    expect(drawn).toContain('9');
    expect(drawn).not.toContain('#');
  });
});

describe('DocCanvas ↔ table-renderer wiring', () => {
  // A full DocCanvas.render() test would need an HTMLCanvasElement, a
  // paginated layout, a selection object, and a request-render callback —
  // too much setup for a regression guard. The class of bug we're
  // protecting against is doc-canvas.ts drifting back to calling the
  // single-pass renderTable() facade (which would cover the selection
  // highlight again). A static import scan catches that drift cheaply.
  it('doc-canvas imports only the two-pass renderers, not the single-pass facade', () => {
    const docCanvasPath = path.resolve(
      __dirname,
      '../../src/view/doc-canvas.ts',
    );
    const src = readFileSync(docCanvasPath, 'utf8');
    const importMatch = src.match(
      /import\s*\{([^}]+)\}\s*from\s*['"]\.\/table-renderer(?:\.js)?['"]/,
    );
    expect(importMatch, 'doc-canvas must import from ./table-renderer').not.toBeNull();
    const imports = importMatch![1].split(',').map((s) => s.trim());
    expect(imports).toContain('renderTableBackgrounds');
    expect(imports).toContain('renderTableContent');
    expect(imports).not.toContain('renderTable');
  });
});

describe('renderTable (facade)', () => {
  it('produces the union of background + content calls in order', () => {
    const { ctx, fillRect, fillText, stroke } = makeRecordingCtx();
    const { tableData, layout } = makeTable();
    renderTable(ctx, tableData, layout, 0, 0);
    // Background pass: the single red cell → one fillRect.
    expect(fillRect).toHaveBeenCalledTimes(1);
    // Content pass: four cells of text.
    expect(fillText).toHaveBeenCalledTimes(4);
    // Borders still drawn.
    expect(stroke).not.toHaveBeenCalledTimes(0);
  });

  it('draws the cell background before any cell text (so a caller can insert a highlight in between)', () => {
    const { ctx, fillRect, fillText } = makeRecordingCtx();
    const { tableData, layout } = makeTable();
    renderTable(ctx, tableData, layout, 0, 0);
    // The invocationCallOrder on vi.fn lets us assert relative order
    // across different mock functions. The cell background fillRect
    // must land strictly before the first cell text fillText so that
    // the editor's selection highlight (drawn between the two
    // passes) overlays the background and stays visible.
    const bgOrder = fillRect.mock.invocationCallOrder[0];
    const textOrder = fillText.mock.invocationCallOrder[0];
    expect(bgOrder).toBeDefined();
    expect(textOrder).toBeDefined();
    expect(bgOrder).toBeLessThan(textOrder);
  });
});
