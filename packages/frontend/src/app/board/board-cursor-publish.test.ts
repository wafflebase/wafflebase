import { describe, expect, it, vi } from "vitest";
import { createCursorPublisher } from "./board-cursor-publish";

/**
 * A fake `requestAnimationFrame`/`cancelAnimationFrame` pair: callbacks
 * queue up by handle instead of firing on a real frame, so tests can
 * flush deterministically without a browser event loop.
 */
function makeFakeScheduler() {
  let nextHandle = 1;
  const pending = new Map<number, () => void>();
  return {
    requestFrame: vi.fn((cb: () => void) => {
      const handle = nextHandle++;
      pending.set(handle, cb);
      return handle;
    }),
    cancelFrame: vi.fn((handle: number) => {
      pending.delete(handle);
    }),
    /** Run every callback currently queued (simulates one animation frame). */
    flushAll() {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const cb of callbacks) cb();
    },
  };
}

describe("createCursorPublisher", () => {
  it("coalesces multiple positions queued within one frame into a single publish carrying the last one", () => {
    const scheduler = makeFakeScheduler();
    const publish = vi.fn();
    const publisher = createCursorPublisher({ ...scheduler, publish });

    publisher.queue({ x: 1, y: 1 });
    publisher.queue({ x: 2, y: 2 });
    publisher.queue({ x: 3, y: 3 });

    // Only the first queue() in a frame should schedule.
    expect(scheduler.requestFrame).toHaveBeenCalledTimes(1);

    scheduler.flushAll();

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith({ x: 3, y: 3 });
  });

  it("delivers a null (pointer-left) queue rather than dropping it", () => {
    const scheduler = makeFakeScheduler();
    const publish = vi.fn();
    const publisher = createCursorPublisher({ ...scheduler, publish });

    publisher.queue({ x: 5, y: 5 });
    publisher.queue(null);
    scheduler.flushAll();

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(null);
  });

  it("schedules a fresh frame for a move queued after the previous frame already flushed", () => {
    const scheduler = makeFakeScheduler();
    const publish = vi.fn();
    const publisher = createCursorPublisher({ ...scheduler, publish });

    publisher.queue({ x: 1, y: 1 });
    scheduler.flushAll();
    expect(scheduler.requestFrame).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(1);

    publisher.queue({ x: 2, y: 2 });
    expect(scheduler.requestFrame).toHaveBeenCalledTimes(2);

    scheduler.flushAll();
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenNthCalledWith(2, { x: 2, y: 2 });
  });

  it("cancels a pending frame on dispose so no publish happens after teardown", () => {
    const scheduler = makeFakeScheduler();
    const publish = vi.fn();
    const publisher = createCursorPublisher({ ...scheduler, publish });

    publisher.queue({ x: 1, y: 1 });
    publisher.dispose();

    expect(scheduler.cancelFrame).toHaveBeenCalledTimes(1);

    // Even if something still ran the frame (it shouldn't — the fake
    // scheduler already dropped the handle), publish must never fire.
    scheduler.flushAll();
    expect(publish).not.toHaveBeenCalled();
  });

  it("dispose is a safe no-op when nothing was ever queued", () => {
    const scheduler = makeFakeScheduler();
    const publish = vi.fn();
    const publisher = createCursorPublisher({ ...scheduler, publish });

    expect(() => publisher.dispose()).not.toThrow();
    expect(scheduler.cancelFrame).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});
