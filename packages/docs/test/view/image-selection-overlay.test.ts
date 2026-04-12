import { describe, it, expect, vi } from 'vitest';
import {
  drawImageSelection,
  hitTestImageHandle,
  hitTestImageRect,
  handleCenter,
  cursorForHandle,
  collectImageRects,
  findImageAtPoint,
  computeResizeDelta,
  computePreviewRect,
  formatResizeHud,
  HANDLE_SIZE,
  IMAGE_HANDLES,
  MIN_IMAGE_DIMENSION,
  type ImageRect,
  type ImageHandle,
} from '../../src/view/image-selection-overlay.js';
import type { DocumentLayout, LayoutBlock } from '../../src/view/layout.js';
import type { PaginatedLayout } from '../../src/view/pagination.js';
import { DEFAULT_BLOCK_STYLE, DEFAULT_PAGE_SETUP } from '../../src/model/types.js';

/**
 * Minimal stub context that records the calls we care about for the
 * overlay's draw pass. We don't need a real 2D context — only the
 * primitive counts + arguments — so the tests stay fast and node-only.
 */
function makeRecordingCtx() {
  const strokeRect = vi.fn();
  const fillRect = vi.fn();
  const save = vi.fn();
  const restore = vi.fn();
  const ctx = {
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    save,
    restore,
    strokeRect,
    fillRect,
  } as unknown as CanvasRenderingContext2D;
  return { ctx, strokeRect, fillRect, save, restore };
}

describe('handleCenter', () => {
  const rect: ImageRect = { x: 100, y: 50, width: 200, height: 80 };

  it('returns the four corners at rect corners', () => {
    expect(handleCenter(rect, 'nw')).toEqual({ x: 100, y: 50 });
    expect(handleCenter(rect, 'ne')).toEqual({ x: 300, y: 50 });
    expect(handleCenter(rect, 'sw')).toEqual({ x: 100, y: 130 });
    expect(handleCenter(rect, 'se')).toEqual({ x: 300, y: 130 });
  });

  it('returns the midpoints for edge handles', () => {
    expect(handleCenter(rect, 'n')).toEqual({ x: 200, y: 50 });
    expect(handleCenter(rect, 's')).toEqual({ x: 200, y: 130 });
    expect(handleCenter(rect, 'w')).toEqual({ x: 100, y: 90 });
    expect(handleCenter(rect, 'e')).toEqual({ x: 300, y: 90 });
  });
});

describe('drawImageSelection', () => {
  it('draws the selection rect plus eight handles', () => {
    const { ctx, strokeRect, fillRect } = makeRecordingCtx();
    const rect: ImageRect = { x: 10, y: 20, width: 100, height: 60 };
    drawImageSelection(ctx, rect);

    // One rect stroke for the border, eight handles drawn with
    // fill + stroke each = 8 fillRect + 9 strokeRect total.
    expect(fillRect).toHaveBeenCalledTimes(IMAGE_HANDLES.length);
    expect(strokeRect).toHaveBeenCalledTimes(IMAGE_HANDLES.length + 1);
  });

  it('draws the border at pixel-center offsets for crispness', () => {
    const { ctx, strokeRect } = makeRecordingCtx();
    drawImageSelection(ctx, { x: 10, y: 20, width: 100, height: 60 });
    // First strokeRect is the selection border — offsets end in .5.
    const [bx, by] = strokeRect.mock.calls[0];
    expect(bx).toBeCloseTo(10.5);
    expect(by).toBeCloseTo(20.5);
  });
});

describe('hitTestImageHandle', () => {
  const rect: ImageRect = { x: 100, y: 100, width: 200, height: 100 };

  it('returns the handle when the pointer is on its center', () => {
    for (const handle of IMAGE_HANDLES) {
      const c = handleCenter(rect, handle);
      expect(hitTestImageHandle(rect, c.x, c.y)).toBe(handle);
    }
  });

  it('returns null when the pointer is clearly off every handle', () => {
    // Inside the rect but nowhere near a handle (dead center).
    expect(hitTestImageHandle(rect, 200, 150)).toBeNull();
  });

  it('has forgiving hit slack near handle edges', () => {
    // nw handle center is at (100, 100). HANDLE_SIZE/2 + slack ≈ 6, so
    // (105, 105) should still hit it.
    expect(hitTestImageHandle(rect, 105, 105)).toBe('nw');
  });

  it('prefers the listed handle when two handles overlap on tiny rects', () => {
    // A rect smaller than HANDLE_SIZE can make corners overlap. The
    // implementation iterates in IMAGE_HANDLES order, so nw wins.
    const tiny: ImageRect = { x: 10, y: 10, width: 2, height: 2 };
    expect(hitTestImageHandle(tiny, 10, 10)).toBe('nw');
  });
});

describe('hitTestImageRect', () => {
  const rect: ImageRect = { x: 50, y: 50, width: 100, height: 100 };
  it('detects inside vs outside', () => {
    expect(hitTestImageRect(rect, 100, 100)).toBe(true);
    expect(hitTestImageRect(rect, 49, 100)).toBe(false);
    expect(hitTestImageRect(rect, 200, 100)).toBe(false);
  });
  it('treats rect edges as hits', () => {
    expect(hitTestImageRect(rect, 50, 50)).toBe(true);
    expect(hitTestImageRect(rect, 150, 150)).toBe(true);
  });
});

describe('cursorForHandle', () => {
  it('maps each handle to the expected CSS cursor', () => {
    const expected: Record<ImageHandle, string> = {
      nw: 'nwse-resize', se: 'nwse-resize',
      ne: 'nesw-resize', sw: 'nesw-resize',
      n: 'ns-resize',   s: 'ns-resize',
      e: 'ew-resize',   w: 'ew-resize',
    };
    for (const h of IMAGE_HANDLES) {
      expect(cursorForHandle(h)).toBe(expected[h]);
    }
  });
});

describe('collectImageRects', () => {
  function makeSingleImageLayout(): { layout: DocumentLayout; paginatedLayout: PaginatedLayout } {
    const image = { src: 'x.png', width: 120, height: 80 };
    const lb: LayoutBlock = {
      block: {
        id: 'b1',
        type: 'paragraph',
        style: { ...DEFAULT_BLOCK_STYLE },
        inlines: [
          { text: 'ab', style: {} },
          { text: '\uFFFC', style: { image } },
        ],
      },
      x: 0,
      y: 0,
      width: 500,
      height: 80,
      lines: [
        {
          y: 0,
          height: 80,
          width: 240,
          runs: [
            {
              inline: { text: 'ab', style: {} },
              text: 'ab',
              x: 0,
              width: 20,
              inlineIndex: 0,
              charStart: 0,
              charEnd: 2,
              charOffsets: [10, 20],
            },
            {
              inline: { text: '\uFFFC', style: { image } },
              text: '\uFFFC',
              x: 20,
              width: 120,
              inlineIndex: 1,
              charStart: 0,
              charEnd: 1,
              charOffsets: [120],
              imageHeight: 80,
            },
          ],
        },
      ],
    };
    const layout: DocumentLayout = {
      blocks: [lb],
      totalHeight: 80,
      blockParentMap: new Map(),
    };
    // Match what `paginateLayout` produces in production: each
    // PageLine's x/y already have the page margins baked in
    // (x = margins.left, y = margins.top + currentY). `collectImageRects`
    // mirrors `DocCanvas.renderRun` which adds `pageX + pl.x` — adding
    // `margins.left` a second time would shift handles right.
    const paginatedLayout: PaginatedLayout = {
      pageSetup: DEFAULT_PAGE_SETUP,
      pages: [
        {
          pageIndex: 0,
          width: 816,
          height: 1056,
          lines: [
            {
              blockIndex: 0,
              lineIndex: 0,
              line: lb.lines[0],
              x: DEFAULT_PAGE_SETUP.margins.left, // 96
              y: DEFAULT_PAGE_SETUP.margins.top,  // 96
            },
          ],
        },
      ],
    };
    return { layout, paginatedLayout };
  }

  it('returns a rect keyed by the image run\'s block-level offset', () => {
    const { layout, paginatedLayout } = makeSingleImageLayout();
    const rects = collectImageRects(layout, paginatedLayout, 816);
    // Two characters precede the image ('ab'), so the image's block
    // offset is 2.
    expect([...rects.keys()]).toEqual(['b1:2']);
    const rect = rects.get('b1:2')!;
    // Left of the image = pageX + pl.x + run.x
    //                   = 0 + 96 + 20 = 116
    expect(rect.x).toBe(116);
    expect(rect.width).toBe(120);
    expect(rect.height).toBe(80);
    // Bottom-aligned to the line: y = pageY + pl.y + lineHeight - drawHeight
    //   pageY = Theme.pageGap = 40 (page 0's top gap)
    //   pl.y  = margins.top = 96
    //   lineHeight - drawHeight = 80 - 80 = 0
    //   → y = 40 + 96 + 0 = 136
    expect(rect.y).toBe(136);
  });

  it('returns an empty map when there are no images', () => {
    const lb: LayoutBlock = {
      block: {
        id: 'b1',
        type: 'paragraph',
        style: { ...DEFAULT_BLOCK_STYLE },
        inlines: [{ text: 'hello', style: {} }],
      },
      x: 0, y: 0, width: 500, height: 20,
      lines: [
        {
          y: 0,
          height: 20,
          width: 50,
          runs: [
            {
              inline: { text: 'hello', style: {} },
              text: 'hello',
              x: 0,
              width: 50,
              inlineIndex: 0,
              charStart: 0,
              charEnd: 5,
              charOffsets: [10, 20, 30, 40, 50],
            },
          ],
        },
      ],
    };
    const layout: DocumentLayout = {
      blocks: [lb],
      totalHeight: 20,
      blockParentMap: new Map(),
    };
    const paginatedLayout: PaginatedLayout = {
      pageSetup: DEFAULT_PAGE_SETUP,
      pages: [
        {
          pageIndex: 0,
          width: 816,
          height: 1056,
          lines: [
            {
              blockIndex: 0,
              lineIndex: 0,
              line: lb.lines[0],
              x: DEFAULT_PAGE_SETUP.margins.left,
              y: DEFAULT_PAGE_SETUP.margins.top,
            },
          ],
        },
      ],
    };
    expect(collectImageRects(layout, paginatedLayout, 816).size).toBe(0);
  });

  it('computes rects for images inside simple top-aligned table cells', () => {
    // One 1×1 table, cell at (0,0) contains a single paragraph with a
    // pending image inline (`\uFFFC`). The rect math mirrors
    // `renderTableContent`:
    //   cellX = pageX + pl.x + columnXOffsets[c]       = 0 + 96 + 10 = 106
    //   cellY = pageY + pl.y                           = 40 + 96    = 136
    //   imgX  = cellX + padding + run.x                = 106 + 4 + 0 = 110
    //   imgY  = cellY + padding + line.y + line.height - drawHeight
    //         = 136 + 4 + 0 + 80 - 80                   = 140
    const image = { src: 'cell.png', width: 120, height: 80 };
    const innerBlockId = 'cell-block-0';
    const cellData = {
      blocks: [
        {
          id: innerBlockId,
          type: 'paragraph' as const,
          style: { ...DEFAULT_BLOCK_STYLE },
          inlines: [{ text: '\uFFFC', style: { image } }],
        },
      ],
      style: { padding: 4 },
      colSpan: undefined,
      rowSpan: undefined,
    };
    const tableBlockId = 'table-1';
    const tableBlock = {
      id: tableBlockId,
      type: 'table' as const,
      style: { ...DEFAULT_BLOCK_STYLE },
      inlines: [],
      tableData: {
        rows: [{ cells: [cellData] }],
        columnWidths: [1],
      },
    };
    const layoutCell = {
      lines: [
        {
          y: 0,
          height: 80,
          width: 120,
          runs: [
            {
              inline: { text: '\uFFFC', style: { image } },
              text: '\uFFFC',
              x: 0,
              width: 120,
              inlineIndex: 0,
              charStart: 0,
              charEnd: 1,
              charOffsets: [120],
              imageHeight: 80,
            },
          ],
        },
      ],
      blockBoundaries: [0],
      width: 130,
      height: 88,
      merged: false,
    };
    const layoutTable = {
      cells: [[layoutCell]],
      columnXOffsets: [10],
      columnPixelWidths: [130],
      rowYOffsets: [0],
      rowHeights: [88],
      totalWidth: 130,
      totalHeight: 88,
      blockParentMap: new Map(),
    };
    const lb = {
      block: tableBlock,
      x: 0,
      y: 0,
      width: 130,
      height: 88,
      lines: [
        { y: 0, height: 88, width: 130, runs: [] },
      ],
      layoutTable,
    } as unknown as LayoutBlock;
    const layout: DocumentLayout = {
      blocks: [lb],
      totalHeight: 88,
      // Cell-block → table info so the editor's cell lookup stays
      // consistent with what pagination produces.
      blockParentMap: new Map([
        [innerBlockId, {
          tableBlockId,
          rowIndex: 0,
          colIndex: 0,
        }],
      ]),
    };
    const paginatedLayout: PaginatedLayout = {
      pageSetup: DEFAULT_PAGE_SETUP,
      pages: [
        {
          pageIndex: 0,
          width: 816,
          height: 1056,
          lines: [
            {
              blockIndex: 0,
              lineIndex: 0,
              line: lb.lines[0],
              x: DEFAULT_PAGE_SETUP.margins.left,
              y: DEFAULT_PAGE_SETUP.margins.top,
            },
          ],
        },
      ],
    };
    const rects = collectImageRects(layout, paginatedLayout, 816);
    expect([...rects.keys()]).toEqual([`${innerBlockId}:0`]);
    const rect = rects.get(`${innerBlockId}:0`)!;
    expect(rect.x).toBe(110);
    expect(rect.y).toBe(140);
    expect(rect.width).toBe(120);
    expect(rect.height).toBe(80);
  });

  it('skips merged placeholder cells', () => {
    // One 1×2 row with col 1 as a merged placeholder. The placeholder
    // must NOT emit an image rect even if its `layoutCell.lines`
    // contains an image run (defensive: in practice merged cells
    // carry no lines, but the guard matters).
    const image = { src: 'x.png', width: 50, height: 50 };
    const fakeImageLine = {
      y: 0,
      height: 50,
      width: 50,
      runs: [
        {
          inline: { text: '\uFFFC', style: { image } },
          text: '\uFFFC',
          x: 0,
          width: 50,
          inlineIndex: 0,
          charStart: 0,
          charEnd: 1,
          charOffsets: [50],
          imageHeight: 50,
        },
      ],
    };
    const ownerCellLayout = {
      lines: [],
      blockBoundaries: [0],
      width: 130,
      height: 88,
      merged: false,
    };
    const placeholderLayout = {
      lines: [fakeImageLine], // defensive — should be skipped anyway
      blockBoundaries: [0],
      width: 130,
      height: 88,
      merged: true,
    };
    const layoutTable = {
      cells: [[ownerCellLayout, placeholderLayout]],
      columnXOffsets: [0, 130],
      columnPixelWidths: [130, 130],
      rowYOffsets: [0],
      rowHeights: [88],
      totalWidth: 260,
      totalHeight: 88,
      blockParentMap: new Map(),
    };
    const lb = {
      block: {
        id: 'tbl',
        type: 'table' as const,
        style: { ...DEFAULT_BLOCK_STYLE },
        inlines: [],
        tableData: {
          rows: [
            {
              cells: [
                {
                  blocks: [
                    {
                      id: 'owner',
                      type: 'paragraph' as const,
                      style: { ...DEFAULT_BLOCK_STYLE },
                      inlines: [{ text: '', style: {} }],
                    },
                  ],
                  style: { padding: 4 },
                  colSpan: 2,
                },
                {
                  blocks: [],
                  style: { padding: 4 },
                },
              ],
            },
          ],
          columnWidths: [0.5, 0.5],
        },
      },
      x: 0, y: 0, width: 260, height: 88,
      lines: [{ y: 0, height: 88, width: 260, runs: [] }],
      layoutTable,
    } as unknown as LayoutBlock;
    const layout: DocumentLayout = {
      blocks: [lb],
      totalHeight: 88,
      blockParentMap: new Map(),
    };
    const paginatedLayout: PaginatedLayout = {
      pageSetup: DEFAULT_PAGE_SETUP,
      pages: [
        {
          pageIndex: 0,
          width: 816,
          height: 1056,
          lines: [
            {
              blockIndex: 0,
              lineIndex: 0,
              line: lb.lines[0],
              x: DEFAULT_PAGE_SETUP.margins.left,
              y: DEFAULT_PAGE_SETUP.margins.top,
            },
          ],
        },
      ],
    };
    expect(collectImageRects(layout, paginatedLayout, 816).size).toBe(0);
  });
});

describe('findImageAtPoint', () => {
  it('returns the matching image and parses the block offset', () => {
    const rects = new Map<string, ImageRect>([
      ['block-1:7', { x: 50, y: 50, width: 100, height: 80 }],
    ]);
    const hit = findImageAtPoint(rects, 100, 100);
    expect(hit).not.toBeNull();
    expect(hit!.blockId).toBe('block-1');
    expect(hit!.offset).toBe(7);
  });

  it('handles block IDs that contain colons (uses lastIndexOf)', () => {
    const rects = new Map<string, ImageRect>([
      ['block:with:colons:3', { x: 0, y: 0, width: 10, height: 10 }],
    ]);
    const hit = findImageAtPoint(rects, 5, 5);
    expect(hit).not.toBeNull();
    expect(hit!.blockId).toBe('block:with:colons');
    expect(hit!.offset).toBe(3);
  });

  it('returns null when the pointer misses every rect', () => {
    const rects = new Map<string, ImageRect>([
      ['b:0', { x: 0, y: 0, width: 10, height: 10 }],
    ]);
    expect(findImageAtPoint(rects, 100, 100)).toBeNull();
  });
});

describe('HANDLE_SIZE + IMAGE_HANDLES', () => {
  it('exposes the canonical 8-handle set in drawing order', () => {
    expect(IMAGE_HANDLES).toEqual(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);
  });
  it('uses a visible handle size', () => {
    expect(HANDLE_SIZE).toBeGreaterThan(0);
  });
});

describe('computeResizeDelta', () => {
  const max = { maxWidth: 1000, maxHeight: 1000, aspectLock: true };

  it('se drag enlarges both dimensions, ratio locked', () => {
    // Start 100×50 (ratio 2). Drag +40x, +0y. With ratio lock and
    // the larger proportional change on width, the scale = 1.4 so
    // width → 140, height → 70.
    const result = computeResizeDelta('se', 100, 50, 40, 0, max);
    expect(result.width).toBeCloseTo(140);
    expect(result.height).toBeCloseTo(70);
  });

  it('nw drag enlarges both dimensions when both deltas are negative', () => {
    // NW drag moves the top-left outward (away from the anchor),
    // which visually enlarges the rect. Delta (-40, 0) on a 100×50
    // rect → width 140 under aspect lock (height follows via scale).
    const result = computeResizeDelta('nw', 100, 50, -40, 0, max);
    expect(result.width).toBeCloseTo(140);
    expect(result.height).toBeCloseTo(70);
  });

  it('side handle e changes only width', () => {
    const result = computeResizeDelta('e', 100, 50, 30, 0, { ...max, aspectLock: false });
    expect(result.width).toBe(130);
    expect(result.height).toBe(50);
  });

  it('side handle s changes only height', () => {
    const result = computeResizeDelta('s', 100, 50, 0, 25, { ...max, aspectLock: false });
    expect(result.width).toBe(100);
    expect(result.height).toBe(75);
  });

  it('corner handle without aspect lock drives each axis independently', () => {
    // Shift held → aspectLock: false. SE drag with (dx=40, dy=-10)
    // maps to width 140, height 40 without any ratio correction.
    const result = computeResizeDelta('se', 100, 50, 40, -10, { ...max, aspectLock: false });
    expect(result.width).toBe(140);
    expect(result.height).toBe(40);
  });

  it('clamps to MIN_IMAGE_DIMENSION on shrink', () => {
    const result = computeResizeDelta('se', 100, 50, -500, -500, { ...max, aspectLock: false });
    expect(result.width).toBe(MIN_IMAGE_DIMENSION);
    expect(result.height).toBe(MIN_IMAGE_DIMENSION);
  });

  it('clamps to maxWidth/Height on enlarge', () => {
    const result = computeResizeDelta('se', 100, 50, 5000, 5000, { ...max, aspectLock: false });
    expect(result.width).toBe(1000);
    expect(result.height).toBe(1000);
  });

  it('picks the dominant axis on corner drags with unequal motion', () => {
    // SE drag with (dx=5, dy=40) on 100×50: wScale=1.05, hScale=1.8.
    // Height dominates, so scale = 1.8 → width 180, height 90.
    const result = computeResizeDelta('se', 100, 50, 5, 40, max);
    expect(result.width).toBeCloseTo(180);
    expect(result.height).toBeCloseTo(90);
  });

  it('leaves the rect unchanged on a zero-delta mousemove', () => {
    const result = computeResizeDelta('se', 100, 50, 0, 0, max);
    expect(result.width).toBe(100);
    expect(result.height).toBe(50);
  });
});

describe('formatResizeHud', () => {
  const rect: ImageRect = { x: 0, y: 0, width: 240, height: 120 };

  it('corner drag + aspectLocked → dimensions with "ratio" suffix', () => {
    expect(formatResizeHud('se', rect, true)).toBe('240 × 120  ·  ratio');
    expect(formatResizeHud('nw', rect, true)).toBe('240 × 120  ·  ratio');
    expect(formatResizeHud('ne', rect, true)).toBe('240 × 120  ·  ratio');
    expect(formatResizeHud('sw', rect, true)).toBe('240 × 120  ·  ratio');
  });

  it('corner drag with Shift → dimensions with "free" suffix', () => {
    expect(formatResizeHud('se', rect, false)).toBe('240 × 120  ·  free');
  });

  it('side drags show pure dimensions regardless of aspectLocked', () => {
    // Side handles only change one axis, so the lock state is not
    // meaningful — the HUD should not show it either.
    expect(formatResizeHud('n', rect, true)).toBe('240 × 120');
    expect(formatResizeHud('s', rect, false)).toBe('240 × 120');
    expect(formatResizeHud('e', rect, true)).toBe('240 × 120');
    expect(formatResizeHud('w', rect, false)).toBe('240 × 120');
  });

  it('rounds fractional dimensions to the nearest integer', () => {
    const frac: ImageRect = { x: 0, y: 0, width: 239.6, height: 119.4 };
    expect(formatResizeHud('se', frac, true)).toBe('240 × 119  ·  ratio');
  });
});

describe('computePreviewRect', () => {
  const start: ImageRect = { x: 100, y: 50, width: 200, height: 80 };

  it('se anchors on the top-left — origin stays put', () => {
    const r = computePreviewRect(start, 'se', 240, 100);
    expect(r).toEqual({ x: 100, y: 50, width: 240, height: 100 });
  });

  it('nw anchors on the bottom-right — origin moves', () => {
    const r = computePreviewRect(start, 'nw', 240, 100);
    // East edge stays at x=300 → x = 300 - 240 = 60
    // South edge stays at y=130 → y = 130 - 100 = 30
    expect(r).toEqual({ x: 60, y: 30, width: 240, height: 100 });
  });

  it('ne anchors on the bottom-left — only y moves', () => {
    const r = computePreviewRect(start, 'ne', 240, 100);
    expect(r).toEqual({ x: 100, y: 30, width: 240, height: 100 });
  });

  it('sw anchors on the top-right — only x moves', () => {
    const r = computePreviewRect(start, 'sw', 240, 100);
    expect(r).toEqual({ x: 60, y: 50, width: 240, height: 100 });
  });

  it('n, s, e, w only move along one axis', () => {
    expect(computePreviewRect(start, 'n', 200, 100))
      .toEqual({ x: 100, y: 30, width: 200, height: 100 });
    expect(computePreviewRect(start, 's', 200, 100))
      .toEqual({ x: 100, y: 50, width: 200, height: 100 });
    expect(computePreviewRect(start, 'e', 240, 80))
      .toEqual({ x: 100, y: 50, width: 240, height: 80 });
    expect(computePreviewRect(start, 'w', 240, 80))
      .toEqual({ x: 60, y: 50, width: 240, height: 80 });
  });
});
