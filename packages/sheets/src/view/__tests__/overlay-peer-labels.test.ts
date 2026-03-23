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

  it('uses dark text on light backgrounds', () => {
    const ctx = createMockCtx();
    const cellRect = { left: 100, top: 50, width: 80, height: 25 };
    const port = { left: 0, top: 0, width: 800, height: 600 };

    // Light yellow background — should get dark text
    drawPeerLabel(ctx, 'user1', '#FFEAA7', cellRect, port, 0);
    // fillStyle is set twice: first for background, then for text
    // We check the last assignment before fillText
    const fillStyleCalls: string[] = [];
    Object.defineProperty(ctx, 'fillStyle', {
      set(v: string) { fillStyleCalls.push(v); },
      get() { return fillStyleCalls[fillStyleCalls.length - 1] ?? ''; },
    });
    drawPeerLabel(ctx, 'user1', '#FFEAA7', cellRect, port, 0);
    // Last fillStyle before fillText should be black
    expect(fillStyleCalls[fillStyleCalls.length - 1]).toBe('#000000');
  });

  it('uses white text on dark backgrounds', () => {
    const ctx = createMockCtx();
    const cellRect = { left: 100, top: 50, width: 80, height: 25 };
    const port = { left: 0, top: 0, width: 800, height: 600 };

    const fillStyleCalls: string[] = [];
    Object.defineProperty(ctx, 'fillStyle', {
      set(v: string) { fillStyleCalls.push(v); },
      get() { return fillStyleCalls[fillStyleCalls.length - 1] ?? ''; },
    });
    // Dark red background — should get white text
    drawPeerLabel(ctx, 'user2', '#FF6B6B', cellRect, port, 0);
    expect(fillStyleCalls[fillStyleCalls.length - 1]).toBe('#FFFFFF');
  });

  it('stacks labels for peers on the same cell', () => {
    const ctx = createMockCtx();
    const cellRect = { left: 100, top: 80, width: 80, height: 25 };
    const port = { left: 0, top: 0, width: 800, height: 600 };

    drawPeerLabel(ctx, 'u1', '#4ECDC4', cellRect, port, 0);
    const y0 = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls[0][2];

    drawPeerLabel(ctx, 'u2', '#4ECDC4', cellRect, port, 1);
    const y1 = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls[1][2];

    expect(y1).toBeLessThan(y0);
  });

  it('clamps label within viewport on right edge', () => {
    const ctx = createMockCtx();
    const port = { left: 0, top: 0, width: 200, height: 600 };
    const cellRect = { left: 180, top: 50, width: 80, height: 25 };

    drawPeerLabel(ctx, 'edge_user', '#FF6B6B', cellRect, port, 0);

    const fillTextX = (ctx.fillText as ReturnType<typeof vi.fn>).mock.calls[0][1];
    // fillText x + measured text width should not exceed viewport
    expect(fillTextX).toBeGreaterThanOrEqual(0);
    expect(fillTextX).toBeLessThan(port.width);
  });
});
