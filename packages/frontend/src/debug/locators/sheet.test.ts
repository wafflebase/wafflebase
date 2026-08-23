import { afterEach, describe, expect, it, vi } from 'vitest';
import { locateSheetPoint } from './sheet';
import type { SheetSurface } from '../surface-registry';
import { hostWithCanvas, withBox } from '@wafflebase/debug-report/testing';

const GRID = { x: 0, y: 100, w: 800, h: 500 };

function surface(overrides: Partial<SheetSurface> = {}): SheetSurface {
  return {
    kind: 'sheet',
    cellRefFromPoint: () => ({ r: 7, c: 3 }),
    cellRect: () => ({ left: 120, top: 40, width: 80, height: 21 }),
    sheetName: () => 'Sheet1',
    host: hostWithCanvas(GRID),
    ...overrides,
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('locateSheetPoint', () => {
  it('names the cell and places the rectangle against the CANVAS origin', () => {
    const target = locateSheetPoint({ x: 200, y: 300 }, surface());
    expect(target).toEqual({
      kind: 'canvas',
      surface: 'sheet',
      // The engine's rect is canvas-relative; adding the container origin
      // instead would put every report a row or two off — the same trap the
      // hunt bridge's `sheet.cellCenter` documents.
      rect: { x: GRID.x + 120, y: GRID.y + 40, w: 80, h: 21 },
      address: 'Sheet1!C7',
    });
  });

  it('omits the tab name when the view does not know it', () => {
    const target = locateSheetPoint(
      { x: 200, y: 300 },
      surface({ sheetName: undefined }),
    );
    expect(target?.kind === 'canvas' && target.address).toBe('C7');
  });

  it('declines a point outside the grid rather than guessing a cell', () => {
    // Above the canvas: the header band, or the toolbar. The engine would
    // happily map it, and the report would name a cell nobody aimed at.
    expect(locateSheetPoint({ x: 200, y: 20 }, surface())).toBeUndefined();
    expect(locateSheetPoint({ x: 900, y: 300 }, surface())).toBeUndefined();
  });

  it('declines when the host has no measurable canvas', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    expect(locateSheetPoint({ x: 10, y: 10 }, surface({ host }))).toBeUndefined();
  });

  it('declines an out-of-range reference instead of emitting one', () => {
    const zero = surface({ cellRefFromPoint: () => ({ r: 0, c: 0 }) });
    expect(locateSheetPoint({ x: 200, y: 300 }, zero)).toBeUndefined();
  });

  it('declines a degenerate cell rectangle', () => {
    const collapsed = surface({
      cellRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
    });
    expect(locateSheetPoint({ x: 200, y: 300 }, collapsed)).toBeUndefined();
  });

  it('swallows an engine that throws, because a refusal is an answer', () => {
    const throwing = surface({
      cellRefFromPoint: vi.fn(() => {
        throw new Error('no mapping');
      }),
    });
    expect(locateSheetPoint({ x: 200, y: 300 }, throwing)).toBeUndefined();
  });

  it('picks the largest canvas when a small chrome canvas is also present', () => {
    const host = hostWithCanvas(GRID);
    host.appendChild(
      withBox(document.createElement('canvas'), { x: 0, y: 100, w: 40, h: 20 }),
    );
    const target = locateSheetPoint({ x: 400, y: 300 }, surface({ host }));
    expect(target?.kind).toBe('canvas');
  });
});
