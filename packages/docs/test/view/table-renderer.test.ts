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
} {
  const fillRect = vi.fn();
  const fillText = vi.fn();
  const stroke = vi.fn();
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
  } as unknown as CanvasRenderingContext2D;
  return { ctx, fillRect, fillText, stroke };
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
