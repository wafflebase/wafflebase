import { describe, expect, it, vi } from 'vitest';
import { Worksheet } from '../../src/view/worksheet';
import {
  CellDragThreshold,
  cellDragGrabOffset,
  exceedsCellDragThreshold,
} from '../../src/view/cell-drag-move';
import type { BoundingRect } from '../../src/view/layout';
import type { Range, Ref } from '../../src/model/core/types';

describe('cellDragGrabOffset', () => {
  it('measures the press from the centre of the top-left cell', () => {
    const cell: BoundingRect = { left: 100, top: 20, width: 100, height: 20 };
    // The bottom border's outer half, 11px below the cell's centre.
    expect(cellDragGrabOffset({ x: 150, y: 41 }, cell)).toEqual({
      x: 0,
      y: 11,
    });
  });
});

describe('exceedsCellDragThreshold', () => {
  it('needs the pointer to travel the threshold distance', () => {
    expect(exceedsCellDragThreshold(10, 10, 10, 10)).toBe(false);
    expect(
      exceedsCellDragThreshold(10, 10, 10 + CellDragThreshold - 1, 10),
    ).toBe(false);
    expect(
      exceedsCellDragThreshold(10, 10, 10, 10 + CellDragThreshold),
    ).toBe(true);
  });
});

const { startCellDragMove, startAutofillDrag, handleMouseDown } =
  Worksheet.prototype as unknown as {
    startCellDragMove(e: MouseEvent): void;
    startAutofillDrag(e: MouseEvent): void;
    handleMouseDown(e: MouseEvent): Promise<void>;
  };
const { isOnSelectionEdge, isOverSelectionEdge } =
  Worksheet.prototype as unknown as {
    isOnSelectionEdge(clientX: number, clientY: number): boolean;
    isOverSelectionEdge(x: number, y: number): boolean;
  };

type Session = {
  onMove: (e: MouseEvent) => void;
  onComplete?: () => void;
  onCleanup?: () => void;
};

const RowHeight = 20;
const ColWidth = 100;

/**
 * How the stand-in grid maps pixels to rows: rows from the top of the
 * viewport, beside 100px-wide columns from its left, no headers.
 */
type Grid = {
  rowAt(y: number): number;
  rowRect(r: number): { top: number; height: number };
};

/** Uniform 20px rows. */
const uniformGrid: Grid = {
  rowAt: (y) => Math.floor(y / RowHeight) + 1,
  rowRect: (r) => ({ top: (r - 1) * RowHeight, height: RowHeight }),
};

/** 20px rows with `hidden` collapsed to zero height, as a filter leaves them. */
function gridWithHiddenRows(hidden: Set<number>): Grid {
  const top = (r: number) => {
    let y = 0;
    for (let i = 1; i < r; i++) y += hidden.has(i) ? 0 : RowHeight;
    return y;
  };
  return {
    rowAt: (y) => {
      let r = 1;
      while (hidden.has(r) || top(r) + RowHeight <= y) r++;
      return r;
    },
    rowRect: (r) => ({ top: top(r), height: hidden.has(r) ? 0 : RowHeight }),
  };
}

/**
 * One frozen row, the 4px freeze gap, then the scrollable rows scrolled so
 * row 49 is the first visible one. `toRefWithFreeze` gives the gap to the
 * frozen side, where it maps to the first *unscrolled* row — row 2.
 */
const frozenScrolledGrid: Grid = {
  rowAt: (y) => (y < 20 ? 1 : y < 24 ? 2 : 49 + Math.floor((y - 24) / 20)),
  rowRect: (r) =>
    r === 1 ? { top: 0, height: 20 } : { top: 24 + (r - 49) * 20, height: 20 },
};

function createContext(
  selection: Range,
  start: (e: MouseEvent) => void = startCellDragMove,
  grid: Grid = uniformGrid,
) {
  let session: Session | undefined;
  const sheet = {
    getRangeOrActiveCell: vi.fn(() => selection),
    moveRangeTo: vi.fn(async () => {}),
    selectStart: vi.fn(),
    selectEnd: vi.fn(),
    addSelection: vi.fn(),
    autofill: vi.fn(async () => true),
    getAutofillPreviewRange: vi.fn((target: Ref): Range => [
      selection[0],
      target,
    ]),
  };
  const ctx = {
    sheet,
    gridContainer: {
      getScrollContainer: () => ({ style: { cursor: '' } }),
      scrollBy: vi.fn(),
    },
    viewport: { left: 0, top: 0, width: 1000, height: 1000 },
    cellDragMovePreview: undefined as Range | undefined,
    autofillPreview: undefined as Range | undefined,
    clampClientPointToViewport: (x: number, y: number) => ({ x, y }),
    toRefFromMouse: (x: number, y: number): Ref => ({
      r: grid.rowAt(y),
      c: Math.floor(x / ColWidth) + 1,
    }),
    getCellRect: (ref: Ref): BoundingRect => ({
      left: (ref.c - 1) * ColWidth,
      width: ColWidth,
      ...grid.rowRect(ref.r),
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
    start.call(ctx, { clientX: x, clientY: y, ...init } as MouseEvent);
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

  it('changes nothing for a press and release on the border', () => {
    // The press is in B3, but the click was aimed at B2's border: neither a
    // move nor a reselection, whatever the modifiers.
    for (const init of [{}, { shiftKey: true }, { ctrlKey: true }]) {
      const { ctx, sheet, press, release } = createContext(b2);
      press(150, 41, init);
      release();

      expect(sheet.moveRangeTo).not.toHaveBeenCalled();
      expect(sheet.selectStart).not.toHaveBeenCalled();
      expect(sheet.selectEnd).not.toHaveBeenCalled();
      expect(sheet.addSelection).not.toHaveBeenCalled();
      expect(ctx.cellDragMovePreview).toBeUndefined();
    }
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

  it('keeps the grab offset rather than jumping to the pointer', () => {
    const range: Range = [{ r: 1, c: 1 }, { r: 5, c: 1 }];
    const { ctx, sheet, press, move, release } = createContext(range);
    // A1:A5's bottom border is at y = 100; pressing at 101 lands in A6.
    // Moving one row down carries it to A2:A6 — the pointer's own cell, A7,
    // would have put its top-left five rows away.
    press(50, 101);
    move(50, 121);
    expect(ctx.cellDragMovePreview).toEqual([
      { r: 2, c: 1 },
      { r: 6, c: 1 },
    ]);
    release();

    expect(sheet.moveRangeTo).toHaveBeenCalledWith(range, { r: 2, c: 1 });
  });

  it('drops on the visible row below when a filter hid the ones between', () => {
    // Rows 3–10 are hidden, so the press under B2's bottom border is in row
    // 11. Index arithmetic from there sent a one-row drag to hidden row 3.
    const grid = gridWithHiddenRows(new Set([3, 4, 5, 6, 7, 8, 9, 10]));
    const { ctx, sheet, press, move, release } = createContext(
      b2,
      startCellDragMove,
      grid,
    );
    press(150, 41);
    move(150, 61);
    expect(ctx.cellDragMovePreview).toEqual([
      { r: 11, c: 2 },
      { r: 11, c: 2 },
    ]);
    release();

    expect(sheet.moveRangeTo).toHaveBeenCalledWith(b2, { r: 11, c: 2 });
  });

  it('does not throw the range across the freeze gap', () => {
    // B49 is the first visible scrollable row; the outer half of its top
    // border is the freeze gap, which maps to row 2. Index arithmetic from
    // there turned a 5px drag back onto B49 into a move to B96.
    const b49: Range = [{ r: 49, c: 2 }, { r: 49, c: 2 }];
    const { ctx, sheet, press, move, release } = createContext(
      b49,
      startCellDragMove,
      frozenScrolledGrid,
    );
    press(150, 23);
    move(150, 28);
    expect(ctx.cellDragMovePreview).toEqual(b49);
    release();

    expect(sheet.moveRangeTo).not.toHaveBeenCalled();
  });

  it('never lands above row 1 or left of column 1', () => {
    const { sheet, press, move, release } = createContext(b2);
    press(150, 19);
    move(-300, -300);
    release();

    expect(sheet.moveRangeTo).toHaveBeenCalledWith(b2, { r: 1, c: 1 });
  });
});

describe('Worksheet autofill gesture', () => {
  // B2's fill handle straddles its bottom-right corner (200, 40), so the
  // lower half of the handle lies in B3.
  const b2: Range = [{ r: 2, c: 2 }, { r: 2, c: 2 }];

  it('fills nothing when the handle is clicked without dragging', () => {
    const { ctx, sheet, press, release } = createContext(b2, startAutofillDrag);
    press(199, 43);
    release();

    expect(sheet.autofill).not.toHaveBeenCalled();
    expect(ctx.autofillPreview).toBeUndefined();
  });

  it('ignores a jitter below the drag threshold', () => {
    const { sheet, press, move, release } = createContext(
      b2,
      startAutofillDrag,
    );
    press(199, 43);
    move(200, 45);
    release();

    expect(sheet.autofill).not.toHaveBeenCalled();
  });

  it('fills to the cell under the pointer once dragged', () => {
    const { sheet, press, move, release } = createContext(
      b2,
      startAutofillDrag,
    );
    press(199, 43);
    move(150, 85); // B5
    release();

    expect(sheet.autofill).toHaveBeenCalledWith({ r: 5, c: 2 });
  });
});

/**
 * A press on B2's bottom border at (150, 41), which lies in B3. Everything
 * `handleMouseDown` consults before the border branch reports "nothing here",
 * and the plain-click path after it has what it needs to run to the end.
 */
function mouseDownContext(hit: { edge?: boolean; handle?: boolean }) {
  const sheet = {
    getRangeOrActiveCell: vi.fn((): Range => [
      { r: 2, c: 2 },
      { r: 2, c: 2 },
    ]),
    getDataValidationAt: vi.fn(() => undefined),
    selectStart: vi.fn(),
  };
  return {
    sheet,
    readOnly: false,
    openLinksOnClick: false,
    zoom: 1,
    detectFreezeHandle: () => null,
    detectHiddenIndicator: () => null,
    detectResizeEdge: () => null,
    detectFilterButton: () => null,
    isInsideGrid: () => true,
    isInFormulaRangeMode: () => false,
    toRefFromMouse: (x: number, y: number): Ref => ({
      r: Math.floor(y / RowHeight) + 1,
      c: Math.floor(x / ColWidth) + 1,
    }),
    detectCellEdge: () => hit.edge ?? false,
    detectAutofillHandle: () => hit.handle ?? false,
    isOverSelectionEdge,
    finishEditing: vi.fn(async () => true),
    startCellDragMove: vi.fn(),
    startAutofillDrag: vi.fn(),
    render: vi.fn(),
    beginNativeSelectionBlock: vi.fn(),
    startMouseDragSession: vi.fn(),
  };
}

function mouseDownEvent(button: number): MouseEvent {
  return {
    button,
    detail: 1,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    offsetX: 150,
    offsetY: 41,
    clientX: 150,
    clientY: 41,
    preventDefault: vi.fn(),
  } as unknown as MouseEvent;
}

describe('handleMouseDown on the selection border and fill handle', () => {
  it('starts a drag-move only for the primary button', async () => {
    const left = mouseDownContext({ edge: true });
    await handleMouseDown.call(left, mouseDownEvent(0));
    expect(left.startCellDragMove).toHaveBeenCalledTimes(1);

    // The middle button runs the plain-click path instead.
    const middle = mouseDownContext({ edge: true });
    await handleMouseDown.call(middle, mouseDownEvent(1));
    expect(middle.startCellDragMove).not.toHaveBeenCalled();
    expect(middle.sheet.selectStart).toHaveBeenCalledWith({ r: 3, c: 2 });
  });

  it('starts a drag-fill only for the primary button', async () => {
    const left = mouseDownContext({ handle: true });
    await handleMouseDown.call(left, mouseDownEvent(0));
    expect(left.startAutofillDrag).toHaveBeenCalledTimes(1);

    const middle = mouseDownContext({ handle: true });
    await handleMouseDown.call(middle, mouseDownEvent(1));
    expect(middle.startAutofillDrag).not.toHaveBeenCalled();
    expect(middle.sheet.selectStart).toHaveBeenCalledWith({ r: 3, c: 2 });
  });

  it('keeps the selection for a right-click on the border', async () => {
    // B3 is outside the selection, but the press was aimed at its border.
    const ctx = mouseDownContext({ edge: true });
    await handleMouseDown.call(ctx, mouseDownEvent(2));
    expect(ctx.startCellDragMove).not.toHaveBeenCalled();
    expect(ctx.sheet.selectStart).not.toHaveBeenCalled();
  });

  it('keeps the selection for a right-click on the fill handle', async () => {
    const ctx = mouseDownContext({ handle: true });
    await handleMouseDown.call(ctx, mouseDownEvent(2));
    expect(ctx.startAutofillDrag).not.toHaveBeenCalled();
    expect(ctx.sheet.selectStart).not.toHaveBeenCalled();
  });

  it('still moves the selection for a right-click away from it', async () => {
    const ctx = mouseDownContext({});
    await handleMouseDown.call(ctx, mouseDownEvent(2));
    expect(ctx.sheet.selectStart).toHaveBeenCalledWith({ r: 3, c: 2 });
  });
});

describe('isOnSelectionEdge', () => {
  // The context menu asks this with client coordinates, so the frontend can
  // keep the selection when a right-click lands on the border.
  it('hit-tests the border and fill handle in viewport coordinates', () => {
    const detectCellEdge = vi.fn((x: number) => x === 140);
    const detectAutofillHandle = vi.fn((x: number) => x === 190);
    const ctx = {
      viewport: { left: 10, top: 5 },
      detectCellEdge,
      detectAutofillHandle,
      isOverSelectionEdge,
    };

    expect(isOnSelectionEdge.call(ctx, 150, 46)).toBe(true);
    expect(detectCellEdge).toHaveBeenCalledWith(140, 41);
    expect(isOnSelectionEdge.call(ctx, 200, 46)).toBe(true);
    expect(isOnSelectionEdge.call(ctx, 300, 46)).toBe(false);
  });
});
