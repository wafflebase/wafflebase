import { describe, it, expect } from 'vitest';
import { DEFAULT_BLOCK_STYLE } from '@wafflebase/docs';
import type { TableElement } from '../../../src/model/element';
import type { Theme } from '../../../src/model/theme';
import { asCtx, createCtxSpy } from '../../../src/view/canvas/ctx-spy';
import '../../../src/view/canvas/test-canvas-env';
import { drawTable } from '../../../src/view/canvas/table-renderer';

const THEME: Theme = {
  id: 't',
  name: 't',
  colors: {
    text: '#000',
    background: '#fff',
    textSecondary: '#444',
    backgroundAlt: '#f3f3f3',
    accent1: '#abc',
    accent2: '#bcd',
    accent3: '#cde',
    accent4: '#def',
    accent5: '#e0e1e2',
    accent6: '#f0f1f2',
    hyperlink: '#11c',
    visitedHyperlink: '#71a',
  },
  fonts: { heading: 'Inter', body: 'Inter' },
};

const data = (d: TableElement['data']) => d;

describe('drawTable — cell fills', () => {
  it('fills a single 1×1 cell with the cell fill color', () => {
    const ctx = createCtxSpy();
    drawTable(
      asCtx(ctx),
      { w: 100, h: 50 },
      data({
        columnWidths: [100],
        rows: [
          {
            height: 50,
            cells: [{ body: { blocks: [] }, style: { fill: '#abc' } }],
          },
        ],
      }),
      THEME,
    );
    expect(ctx.fillStyle).toBe('#abc');
    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    expect(ctx.fillRect.mock.calls[0]).toEqual([0, 0, 100, 50]);
  });

  it('skips fill when cell has no fill style', () => {
    const ctx = createCtxSpy();
    drawTable(
      asCtx(ctx),
      { w: 100, h: 50 },
      data({
        columnWidths: [100],
        rows: [
          {
            height: 50,
            cells: [{ body: { blocks: [] }, style: {} }],
          },
        ],
      }),
      THEME,
    );
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it('paints adjacent cells at their column offsets', () => {
    const ctx = createCtxSpy();
    drawTable(
      asCtx(ctx),
      { w: 200, h: 50 },
      data({
        columnWidths: [60, 140],
        rows: [
          {
            height: 50,
            cells: [
              { body: { blocks: [] }, style: { fill: '#abc' } },
              { body: { blocks: [] }, style: { fill: '#bcd' } },
            ],
          },
        ],
      }),
      THEME,
    );
    expect(ctx.fillRect).toHaveBeenCalledTimes(2);
    expect(ctx.fillRect.mock.calls[0]).toEqual([0, 0, 60, 50]);
    expect(ctx.fillRect.mock.calls[1]).toEqual([60, 0, 140, 50]);
  });

  it('resolves role-bound fill through the theme', () => {
    const ctx = createCtxSpy();
    drawTable(
      asCtx(ctx),
      { w: 100, h: 50 },
      data({
        columnWidths: [100],
        rows: [
          {
            height: 50,
            cells: [
              {
                body: { blocks: [] },
                style: { fill: { kind: 'role', role: 'accent1' } },
              },
            ],
          },
        ],
      }),
      THEME,
    );
    expect(ctx.fillStyle).toBe('#abc');
  });
});

describe('drawTable — merged cells (gridSpan / rowSpan)', () => {
  it('paints anchor cell across its full gridSpan and skips covered cells', () => {
    const ctx = createCtxSpy();
    drawTable(
      asCtx(ctx),
      { w: 200, h: 50 },
      data({
        columnWidths: [100, 100],
        rows: [
          {
            height: 50,
            cells: [
              {
                body: { blocks: [] },
                style: { fill: '#abc' },
                gridSpan: 2,
              },
              {
                body: { blocks: [] },
                style: { fill: '#bcd' },
                gridSpan: 0,
              },
            ],
          },
        ],
      }),
      THEME,
    );
    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    expect(ctx.fillRect.mock.calls[0]).toEqual([0, 0, 200, 50]);
  });

  it('paints anchor cell across its full rowSpan and skips covered cells', () => {
    const ctx = createCtxSpy();
    drawTable(
      asCtx(ctx),
      { w: 100, h: 100 },
      data({
        columnWidths: [100],
        rows: [
          {
            height: 50,
            cells: [
              {
                body: { blocks: [] },
                style: { fill: '#abc' },
                rowSpan: 2,
              },
            ],
          },
          {
            height: 50,
            cells: [
              {
                body: { blocks: [] },
                style: { fill: '#bcd' },
                rowSpan: 0,
              },
            ],
          },
        ],
      }),
      THEME,
    );
    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    expect(ctx.fillRect.mock.calls[0]).toEqual([0, 0, 100, 100]);
  });
});

describe('drawTable — per-side borders', () => {
  it('draws a single bottom border between two stacked rows', () => {
    const ctx = createCtxSpy();
    drawTable(
      asCtx(ctx),
      { w: 100, h: 100 },
      data({
        columnWidths: [100],
        rows: [
          {
            height: 50,
            cells: [
              {
                body: { blocks: [] },
                style: { border: { bottom: { color: '#000', width: 2 } } },
              },
            ],
          },
          {
            height: 50,
            cells: [{ body: { blocks: [] }, style: {} }],
          },
        ],
      }),
      THEME,
    );
    expect(ctx.strokeStyle).toBe('#000');
    expect(ctx.lineWidth).toBe(2);
    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.moveTo).toHaveBeenCalledWith(0, 50);
    expect(ctx.lineTo).toHaveBeenCalledWith(100, 50);
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
  });

  it('uses thicker border when adjacent cells share an edge (border-collapse)', () => {
    const ctx = createCtxSpy();
    drawTable(
      asCtx(ctx),
      { w: 100, h: 100 },
      data({
        columnWidths: [100],
        rows: [
          {
            height: 50,
            cells: [
              {
                body: { blocks: [] },
                style: { border: { bottom: { color: '#000', width: 1 } } },
              },
            ],
          },
          {
            height: 50,
            cells: [
              {
                body: { blocks: [] },
                style: { border: { top: { color: '#f00', width: 3 } } },
              },
            ],
          },
        ],
      }),
      THEME,
    );
    expect(ctx.lineWidth).toBe(3);
    expect(ctx.strokeStyle).toBe('#f00');
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
  });

  it('resolves ThemeColor borders through the theme before comparing luminance (darker theme color wins on shared edge)', () => {
    // Regression guard: before threading `theme` into dominantBorder /
    // luminance, both ThemeColor objects returned the 0.5 fallback and
    // the OOXML "darker wins" tiebreak always lost to first-registered
    // (scan order: top row's `bottom` border).
    // accent1 is the brand-light hex (#abc → luminance ≈ 0.66); text is
    // near-black (#000 → luminance 0). The dark side should paint.
    const ctx = createCtxSpy();
    drawTable(
      asCtx(ctx),
      { w: 100, h: 100 },
      data({
        columnWidths: [100],
        rows: [
          {
            height: 50,
            cells: [
              {
                body: { blocks: [] },
                style: {
                  border: {
                    bottom: {
                      color: { kind: 'role', role: 'accent1' }, // #abc, light
                      width: 1,
                    },
                  },
                },
              },
            ],
          },
          {
            height: 50,
            cells: [
              {
                body: { blocks: [] },
                style: {
                  border: {
                    top: {
                      color: { kind: 'role', role: 'text' }, // #000, dark
                      width: 1,
                    },
                  },
                },
              },
            ],
          },
        ],
      }),
      THEME,
    );
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
    // The painted stroke color must be the theme-resolved dark color,
    // not the light one. Before the fix, the light bottom border (first
    // registered) won the tie because both ThemeColor objects hashed to
    // luminance 0.5.
    expect(ctx.strokeStyle).toBe('#000');
  });
});

describe('drawTable — content layout (text body)', () => {
  it('paints non-empty cell text via the existing text body engine', () => {
    const ctx = createCtxSpy();
    drawTable(
      asCtx(ctx),
      { w: 100, h: 50 },
      data({
        columnWidths: [100],
        rows: [
          {
            height: 50,
            cells: [
              {
                body: {
                  blocks: [
                    {
                      id: 'b',
                      type: 'paragraph',
                      inlines: [{ text: 'hi', style: {} }],
                      style: { ...DEFAULT_BLOCK_STYLE },
                    },
                  ],
                },
                style: {},
              },
            ],
          },
        ],
      }),
      THEME,
    );
    expect(ctx.fillText).toHaveBeenCalled();
  });
});

describe('drawTable — row content auto-grow', () => {
  it('grows row height to fit content when declared height is too small', () => {
    // Two-row table: row 0 declared at 4 px (smaller than text line height,
    // forcing auto-grow); row 1 declared at 50 px. Row 1's fill should
    // start at y > 4 because row 0 grew to fit the paragraph.
    const ctx = createCtxSpy();
    drawTable(
      asCtx(ctx),
      { w: 100, h: 200 },
      data({
        columnWidths: [100],
        rows: [
          {
            height: 4,
            cells: [
              {
                body: {
                  blocks: [
                    {
                      id: 'b',
                      type: 'paragraph',
                      inlines: [
                        { text: 'content', style: { fontSize: 14 } },
                      ],
                      style: { ...DEFAULT_BLOCK_STYLE },
                    },
                  ],
                },
                style: { fill: '#abc' },
              },
            ],
          },
          {
            height: 50,
            cells: [{ body: { blocks: [] }, style: { fill: '#bcd' } }],
          },
        ],
      }),
      THEME,
    );
    expect(ctx.fillRect).toHaveBeenCalledTimes(2);
    const row0Rect = ctx.fillRect.mock.calls[0] as [
      number, number, number, number,
    ];
    const row1Rect = ctx.fillRect.mock.calls[1] as [
      number, number, number, number,
    ];
    expect(row0Rect[1]).toBe(0);
    // Row 0 auto-grew above its declared 4 px, so row 1 starts later.
    expect(row1Rect[1]).toBeGreaterThan(4);
    expect(row0Rect[3]).toBe(row1Rect[1]); // contiguous: y1 + h1 == y2
  });
});

describe('drawTable — vertical anchor', () => {
  it('routes cell.style.verticalAlign into the text body anchor', () => {
    // Anchor `'middle'` places the laid-out content at the center of the
    // inner rect — the paint origin (ctx.translate after the cell origin)
    // should be y > top padding for a body shorter than the inner height.
    const ctx = createCtxSpy();
    drawTable(
      asCtx(ctx),
      { w: 100, h: 200 },
      data({
        columnWidths: [100],
        rows: [
          {
            height: 200,
            cells: [
              {
                body: {
                  blocks: [
                    {
                      id: 'b',
                      type: 'paragraph',
                      inlines: [{ text: 'x', style: { fontSize: 12 } }],
                      style: { ...DEFAULT_BLOCK_STYLE },
                    },
                  ],
                },
                style: { verticalAlign: 'middle' },
              },
            ],
          },
        ],
      }),
      THEME,
    );
    // Text should be painted (covered by content test above); here we
    // assert the y-origin of fillText is shifted down vs. the default
    // top-anchor. Default top would place text at y ≈ pad.top (4 px).
    expect(ctx.fillText).toHaveBeenCalled();
    const calls = ctx.fillText.mock.calls;
    const ys = calls.map((c) => c[2] as number);
    const minY = Math.min(...ys);
    // Middle-anchor on a 200 px tall cell with ~12 px content puts the
    // baseline well past the top padding.
    expect(minY).toBeGreaterThan(50);
  });
});
