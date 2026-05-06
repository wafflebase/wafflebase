import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import type { Slide } from '../../model/presentation';
import { DEFAULT_BACKGROUND } from '../../model/presentation';
import { asCtx, createCtxSpy } from './ctx-spy';
import { ThumbnailScheduler, renderThumbnail } from './thumbnail';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const blankSlide = (id: string): Slide => ({
  id, layoutId: 'blank',
  background: { ...DEFAULT_BACKGROUND, fill: '#fff' },
  elements: [], notes: [],
});

describe('renderThumbnail', () => {
  it('paints the slide at the requested host size', () => {
    const ctx = createCtxSpy();
    renderThumbnail(asCtx(ctx), blankSlide('s1'), { hostWidth: 192, hostHeight: 108, dpr: 1 });
    expect(ctx.clearRect).toHaveBeenCalled();
    expect(ctx.fillRect).toHaveBeenCalled();
    // Scale = 192 / 1920 = 0.1
    expect(ctx.scale).toHaveBeenCalledWith(0.1, 0.1);
  });
});

describe('ThumbnailScheduler', () => {
  it('coalesces multiple schedule() calls into one render after the debounce window', () => {
    const onFlush = vi.fn();
    const scheduler = new ThumbnailScheduler(200, onFlush);
    scheduler.schedule('s1');
    scheduler.schedule('s1');
    scheduler.schedule('s1');
    expect(onFlush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(199);
    expect(onFlush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith(['s1']);
  });

  it('batches different slide ids into a single flush', () => {
    const onFlush = vi.fn();
    const scheduler = new ThumbnailScheduler(200, onFlush);
    scheduler.schedule('s1');
    scheduler.schedule('s2');
    scheduler.schedule('s1');
    vi.advanceTimersByTime(200);
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0][0].sort()).toEqual(['s1', 's2']);
  });

  it('a fresh schedule after a flush starts a new debounce window', () => {
    const onFlush = vi.fn();
    const scheduler = new ThumbnailScheduler(200, onFlush);
    scheduler.schedule('s1');
    vi.advanceTimersByTime(200);
    expect(onFlush).toHaveBeenCalledTimes(1);
    scheduler.schedule('s2');
    vi.advanceTimersByTime(200);
    expect(onFlush).toHaveBeenCalledTimes(2);
  });
});
