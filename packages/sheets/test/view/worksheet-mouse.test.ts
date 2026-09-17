import { describe, expect, it, vi } from 'vitest';
import { Worksheet } from '../../src/view/worksheet';

type MouseMoveContext = {
  gridContainer: {
    getScrollContainer: ReturnType<typeof vi.fn>;
  };
  resizeHover: { axis: 'row' | 'column'; index: number } | null;
  renderOverlay: ReturnType<typeof vi.fn>;
  hoveredValidationCandidate: string | null;
  hideValidationTooltip: ReturnType<typeof vi.fn>;
  resetLinkHover: ReturnType<typeof vi.fn>;
};

type MouseLeaveContext = {
  gridContainer: {
    getScrollContainer: ReturnType<typeof vi.fn>;
  };
  filterButtonHoverCol: number | null;
  resizeHover: { axis: 'row' | 'column'; index: number } | null;
  freezeHandleHover: 'row' | 'column' | null;
  render: ReturnType<typeof vi.fn>;
  hoveredValidationCandidate: string | null;
  hideValidationTooltip: ReturnType<typeof vi.fn>;
  resetLinkHover: ReturnType<typeof vi.fn>;
};

const handleMouseMove = (
  Worksheet.prototype as unknown as {
    handleMouseMove(e: MouseEvent): void;
  }
).handleMouseMove;

const handleScrollContainerMouseLeave = (
  Worksheet.prototype as unknown as {
    handleScrollContainerMouseLeave(): void;
  }
).handleScrollContainerMouseLeave;

describe('Worksheet mouse hover behavior', () => {
  it('clears resize hover while primary-button dragging', () => {
    const scrollContainer = { style: { cursor: '' } } as unknown as HTMLElement;
    const ctx: MouseMoveContext = {
      gridContainer: {
        getScrollContainer: vi.fn().mockReturnValue(scrollContainer),
      },
      resizeHover: { axis: 'column', index: 3 },
      renderOverlay: vi.fn(),
      hoveredValidationCandidate: null,
      hideValidationTooltip: vi.fn(),
      resetLinkHover: vi.fn(),
    };

    handleMouseMove.call(
      ctx,
      {
        buttons: 1,
      } as MouseEvent,
    );

    expect(ctx.resizeHover).toBeNull();
    expect(ctx.renderOverlay).toHaveBeenCalledTimes(1);
    // A drag returns before the hover pass, so the link card has to be
    // dismissed here or it floats over the selection for the whole gesture.
    expect(ctx.resetLinkHover).toHaveBeenCalledTimes(1);
  });

  it('clears hover artifacts when pointer leaves the sheet', () => {
    const scrollContainer = { style: { cursor: 'col-resize' } } as unknown as HTMLElement;
    const ctx: MouseLeaveContext = {
      gridContainer: {
        getScrollContainer: vi.fn().mockReturnValue(scrollContainer),
      },
      filterButtonHoverCol: 2,
      resizeHover: { axis: 'row', index: 5 },
      freezeHandleHover: 'column',
      render: vi.fn(),
      hoveredValidationCandidate: null,
      hideValidationTooltip: vi.fn(),
      resetLinkHover: vi.fn(),
    };

    handleScrollContainerMouseLeave.call(ctx);

    expect(scrollContainer.style.cursor).toBe('');
    expect(ctx.filterButtonHoverCol).toBeNull();
    expect(ctx.resizeHover).toBeNull();
    expect(ctx.freezeHandleHover).toBeNull();
    expect(ctx.render).toHaveBeenCalledTimes(1);
    // The link card is anchored to a cell the pointer has now left, so it must
    // go with the rest of the hover state rather than outlive the grid.
    expect(ctx.resetLinkHover).toHaveBeenCalledTimes(1);
  });
});

/**
 * The headers are `RowHeaderWidth` / `DefaultCellHeight` in unzoomed space
 * while a mouse event carries CSS pixels, so a raw comparison writes off part
 * of the grid whenever zoom is below 1 — the part where column A lives.
 */
const isInsideGrid = (
  Worksheet.prototype as unknown as {
    isInsideGrid(x: number, y: number): boolean;
  }
).isInsideGrid;

describe('isInsideGrid', () => {
  it('scales the header dimensions by zoom', () => {
    // At 0.5 the row header ends at 25 CSS px and the column header at 11.5.
    expect(isInsideGrid.call({ zoom: 0.5 }, 30, 20)).toBe(true);
    expect(isInsideGrid.call({ zoom: 0.5 }, 20, 20)).toBe(false);
    expect(isInsideGrid.call({ zoom: 0.5 }, 30, 10)).toBe(false);
  });

  it('is unchanged at zoom 1', () => {
    expect(isInsideGrid.call({ zoom: 1 }, 60, 30)).toBe(true);
    expect(isInsideGrid.call({ zoom: 1 }, 40, 30)).toBe(false);
    expect(isInsideGrid.call({ zoom: 1 }, 60, 20)).toBe(false);
  });

  it('keeps a zoomed-in grid from claiming the headers', () => {
    // At 2 the row header ends at 100 CSS px, so 60 is over the header.
    expect(isInsideGrid.call({ zoom: 2 }, 60, 60)).toBe(false);
    expect(isInsideGrid.call({ zoom: 2 }, 110, 60)).toBe(true);
  });
});
