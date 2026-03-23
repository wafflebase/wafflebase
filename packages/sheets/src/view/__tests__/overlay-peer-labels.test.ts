import { describe, it, expect, vi } from 'vitest';
import { drawPeerLabel } from '../overlay';

function createMockCtx() {
  return {
    font: '',
    fillStyle: '',
    textBaseline: '',
    measureText: vi.fn((text: string) => ({ width: text.length * 7 })),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arcTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

describe('drawPeerLabel', () => {
  it('draws username text above the cell', () => {
    const ctx = createMockCtx();
    const cellRect = { left: 100, top: 50, width: 80, height: 25 };
    const port = { left: 0, top: 0, width: 800, height: 600 };
    drawPeerLabel(ctx, 'alice', '#FF6B6B', cellRect, port, 0);
    expect(ctx.fill).toHaveBeenCalled();
    expect(ctx.fillText).toHaveBeenCalledWith('alice', expect.any(Number), expect.any(Number));
    const fillTextY = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(fillTextY).toBeLessThan(cellRect.top);
  });

  it('flips tag below cell when at top boundary', () => {
    const ctx = createMockCtx();
    const cellRect = { left: 100, top: 5, width: 80, height: 25 };
    const port = { left: 0, top: 0, width: 800, height: 600 };
    drawPeerLabel(ctx, 'bob', '#4ECDC4', cellRect, port, 0);
    const fillTextY = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(fillTextY).toBeGreaterThanOrEqual(cellRect.top + cellRect.height);
  });

  it('truncates long usernames with ellipsis', () => {
    const ctx = createMockCtx();
    (ctx.measureText as ReturnType<typeof vi.fn>).mockImplementation(
      (text: string) => ({ width: text.length * 10 }),
    );
    const cellRect = { left: 100, top: 50, width: 80, height: 25 };
    const port = { left: 0, top: 0, width: 800, height: 600 };
    drawPeerLabel(ctx, 'a_very_long_username_here', '#FF6B6B', cellRect, port, 0);
    const displayedText = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(displayedText).toContain('…');
    expect(displayedText.length).toBeLessThan('a_very_long_username_here'.length);
  });
});
