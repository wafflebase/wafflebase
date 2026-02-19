import { describe, expect, it, vi } from 'vitest';
import { Worksheet } from '../../src/view/worksheet';

type MouseMoveContext = {
  gridContainer: {
    getScrollContainer: ReturnType<typeof vi.fn>;
  };
  resizeHover: { axis: 'row' | 'column'; index: number } | null;
  renderOverlay: ReturnType<typeof vi.fn>;
};

type MouseLeaveContext = {
  gridContainer: {
    getScrollContainer: ReturnType<typeof vi.fn>;
  };
  filterButtonHoverCol: number | null;
  resizeHover: { axis: 'row' | 'column'; index: number } | null;
  freezeHandleHover: 'row' | 'column' | null;
  render: ReturnType<typeof vi.fn>;
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
    };

    handleMouseMove.call(
      ctx,
      {
        buttons: 1,
      } as MouseEvent,
    );

    expect(ctx.resizeHover).toBeNull();
    expect(ctx.renderOverlay).toHaveBeenCalledTimes(1);
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
    };

    handleScrollContainerMouseLeave.call(ctx);

    expect(scrollContainer.style.cursor).toBe('');
    expect(ctx.filterButtonHoverCol).toBeNull();
    expect(ctx.resizeHover).toBeNull();
    expect(ctx.freezeHandleHover).toBeNull();
    expect(ctx.render).toHaveBeenCalledTimes(1);
  });
});
