import { describe, expect, it, vi } from 'vitest';
import { Worksheet } from '../../src/view/worksheet';
import {
  CellDragMoveThreshold,
  cellDragMoveDestination,
  exceedsCellDragMoveThreshold,
} from '../../src/view/cell-drag-move';
import type { Range, Ref } from '../../src/model/core/types';

describe('cellDragMoveDestination', () => {
  it('stays put while the pointer is still in the grabbed cell', () => {
    // The press on B2's bottom border landed in B3, the neighbouring cell.
    const source: Range = [{ r: 2, c: 2 }, { r: 2, c: 2 }];
    const anchor: Ref = { r: 3, c: 2 };
    expect(cellDragMoveDestination(source, anchor, anchor)).toEqual({
      r: 2,
      c: 2,
    });
  });

  it('moves by the cells the pointer crossed, not to the pointer', () => {
    // Grabbing the bottom edge of A1:A5 and crossing one row moves it to
    // A2:A6 — the old behavior put its top-left under the pointer at A7.
    const source: Range = [{ r: 1, c: 1 }, { r: 5, c: 1 }];
    const anchor: Ref = { r: 6, c: 1 };
    expect(cellDragMoveDestination(source, anchor, { r: 7, c: 1 })).toEqual({
      r: 2,
      c: 1,
    });
  });

  it('normalizes a source range selected bottom-up', () => {
    const source: Range = [{ r: 5, c: 3 }, { r: 2, c: 1 }];
    expect(
      cellDragMoveDestination(source, { r: 2, c: 1 }, { r: 4, c: 2 }),
    ).toEqual({ r: 4, c: 2 });
  });

  it('never lands above row 1 or left of column 1', () => {
    const source: Range = [{ r: 2, c: 2 }, { r: 3, c: 3 }];
    expect(
      cellDragMoveDestination(source, { r: 3, c: 3 }, { r: 1, c: 1 }),
    ).toEqual({ r: 1, c: 1 });
  });
});

describe('exceedsCellDragMoveThreshold', () => {
  it('needs the pointer to travel the threshold distance', () => {
    expect(exceedsCellDragMoveThreshold(10, 10, 10, 10)).toBe(false);
    expect(
      exceedsCellDragMoveThreshold(10, 10, 10 + CellDragMoveThreshold - 1, 10),
    ).toBe(false);
    expect(
      exceedsCellDragMoveThreshold(10, 10, 10, 10 + CellDragMoveThreshold),
    ).toBe(true);
  });
});

const startCellDragMove = (
  Worksheet.prototype as unknown as {
    startCellDragMove(e: MouseEvent): void;
  }
).startCellDragMove;

type Session = {
  onMove: (e: MouseEvent) => void;
  onComplete?: () => void;
  onCleanup?: () => void;
};

const RowHeight = 20;
const ColWidth = 100;

/**
 * A worksheet stand-in with a fixed grid of 100×20 cells starting at (0, 0),
 * so client coordinates map to refs without scrolling or headers.
 */
function createContext(selection: Range) {
  let session: Session | undefined;
  const sheet = {
    getRangeOrActiveCell: vi.fn(() => selection),
    moveRangeTo: vi.fn(async () => {}),
    selectStart: vi.fn(),
    selectEnd: vi.fn(),
    addSelection: vi.fn(),
  };
  const ctx = {
    sheet,
    gridContainer: {
      getScrollContainer: () => ({ style: { cursor: '' } }),
      scrollBy: vi.fn(),
    },
    viewport: { left: 0, top: 0, width: 1000, height: 1000 },
    cellDragMovePreview: undefined as Range | undefined,
    clampClientPointToViewport: (x: number, y: number) => ({ x, y }),
    toRefFromMouse: (x: number, y: number): Ref => ({
      r: Math.floor(y / RowHeight) + 1,
      c: Math.floor(x / ColWidth) + 1,
    }),
    getAutoScrollVelocity: () => 0,
    beginNativeSelectionBlock: vi.fn(),
    endNativeSelectionBlock: vi.fn(),
    renderOverlay: vi.fn(),
    render: vi.fn(),
    startMouseDragSession: (config: Session) => {
      session = config;
      return () => {};
    },
  };
  const press = (x: number, y: number, init: Partial<MouseEvent> = {}) => {
    startCellDragMove.call(ctx, { clientX: x, clientY: y, ...init } as MouseEvent);
  };
  const move = (x: number, y: number) =>
    session!.onMove({ clientX: x, clientY: y } as MouseEvent);
  const release = () => {
    session!.onComplete?.();
    session!.onCleanup?.();
  };
  return { ctx, sheet, press, move, release };
}

describe('Worksheet cell drag-move gesture', () => {
  // B2 spans x 100–200, y 20–40; its bottom border is at y = 40, and the
  // outer half of the hit band (y 40–42) belongs to B3.
  const b2: Range = [{ r: 2, c: 2 }, { r: 2, c: 2 }];

  it('treats a press and release on the bottom border as a click', () => {
    const { sheet, press, release } = createContext(b2);
    press(150, 41);
    release();

    expect(sheet.moveRangeTo).not.toHaveBeenCalled();
    expect(sheet.selectStart).toHaveBeenCalledWith({ r: 3, c: 2 });
  });

  it('keeps the click modifiers when the press never became a drag', () => {
    const { sheet, press, release } = createContext(b2);
    press(150, 41, { shiftKey: true });
    release();

    expect(sheet.moveRangeTo).not.toHaveBeenCalled();
    expect(sheet.selectEnd).toHaveBeenCalledWith({ r: 3, c: 2 });
  });

  it('ignores a jitter below the drag threshold', () => {
    const { ctx, sheet, press, move, release } = createContext(b2);
    press(150, 41);
    move(152, 42);
    expect(ctx.cellDragMovePreview).toBeUndefined();
    release();

    expect(sheet.moveRangeTo).not.toHaveBeenCalled();
  });

  it('does not move a range dragged within the grabbed cell', () => {
    const { ctx, sheet, press, move, release } = createContext(b2);
    press(150, 41);
    move(150, 50);
    expect(ctx.cellDragMovePreview).toEqual(b2);
    release();

    expect(sheet.moveRangeTo).not.toHaveBeenCalled();
    expect(sheet.selectStart).not.toHaveBeenCalled();
  });

  it('moves by the rows crossed after the threshold', () => {
    const range: Range = [{ r: 1, c: 1 }, { r: 5, c: 1 }];
    const { ctx, sheet, press, move, release } = createContext(range);
    // A1:A5's bottom border is at y = 100; pressing at 101 lands in A6.
    press(50, 101);
    move(50, 125); // A7: one row down from the grab point
    expect(ctx.cellDragMovePreview).toEqual([
      { r: 2, c: 1 },
      { r: 6, c: 1 },
    ]);
    release();

    expect(sheet.moveRangeTo).toHaveBeenCalledWith(range, { r: 2, c: 1 });
  });
});
