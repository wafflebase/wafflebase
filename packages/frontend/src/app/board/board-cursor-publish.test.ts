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

    // Put a cursor on the peers' screens first — that is what a leave
    // has to clear. (A leave with nothing published clears nothing; see
    // the redundant-null case below.)
    publisher.queue({ x: 1, y: 1 });
    scheduler.flushAll();
    publish.mockClear();

    // Coalescing must not swallow the leave that follows a move inside
    // the same frame.
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

  it("skips a frame entirely when the position has not moved", () => {
    const scheduler = makeFakeScheduler();
    const publish = vi.fn();
    const publisher = createCursorPublisher({ ...scheduler, publish });

    publisher.queue({ x: 7, y: 7 });
    scheduler.flushAll();
    expect(publish).toHaveBeenCalledTimes(1);

    // A `pointermove` carrying the same world position (sub-pixel jitter
    // quantized by the viewport transform) must not book a frame at all.
    publisher.queue({ x: 7, y: 7 });
    expect(scheduler.requestFrame).toHaveBeenCalledTimes(1);
    scheduler.flushAll();
    expect(publish).toHaveBeenCalledTimes(1);

    publisher.queue({ x: 8, y: 7 });
    scheduler.flushAll();
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenLastCalledWith({ x: 8, y: 7 });
  });

  it("does not publish when the pointer returns to the last published point within one frame", () => {
    const scheduler = makeFakeScheduler();
    const publish = vi.fn();
    const publisher = createCursorPublisher({ ...scheduler, publish });

    publisher.queue({ x: 1, y: 1 });
    scheduler.flushAll();
    expect(publish).toHaveBeenCalledTimes(1);

    publisher.queue({ x: 50, y: 50 });
    publisher.queue({ x: 1, y: 1 });
    scheduler.flushAll();

    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("does not re-publish a redundant null after the pointer already left", () => {
    const scheduler = makeFakeScheduler();
    const publish = vi.fn();
    const publisher = createCursorPublisher({ ...scheduler, publish });

    publisher.queue({ x: 3, y: 4 });
    scheduler.flushAll();
    publisher.queue(null);
    scheduler.flushAll();
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenLastCalledWith(null);

    // Leaving again without having re-entered clears nothing new.
    publisher.queue(null);
    scheduler.flushAll();
    expect(publish).toHaveBeenCalledTimes(2);
  });

  // A publisher cannot know what presence already holds: `BoardView`'s
  // mount effect re-runs (e.g. `workspaceId` resolving after the first
  // render) build a fresh one against a presence that may still carry a
  // cursor. Assuming "nothing published yet" would swallow the next
  // pointerleave and strand that cursor on every peer's screen.
  it("publishes the first queued value even when it is null", () => {
    const scheduler = makeFakeScheduler();
    const publish = vi.fn();
    const publisher = createCursorPublisher({ ...scheduler, publish });

    publisher.queue(null);
    scheduler.flushAll();

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(null);
  });

  it("skips the publish while shouldPublish() is false, and resumes without needing a move", () => {
    const scheduler = makeFakeScheduler();
    const publish = vi.fn();
    let hasPeers = false;
    const publisher = createCursorPublisher({
      ...scheduler,
      publish,
      shouldPublish: () => hasPeers,
    });

    publisher.queue({ x: 1, y: 1 });
    scheduler.flushAll();
    expect(publish).not.toHaveBeenCalled();

    // A gated frame must not record what it skipped: once a peer joins,
    // the very next queued position publishes even though the pointer
    // has been at (1, 1) all along.
    hasPeers = true;
    publisher.queue({ x: 1, y: 1 });
    scheduler.flushAll();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith({ x: 1, y: 1 });
  });
});

/**
 * The audience gate saves a solo user 60 presence writes a second, but a
 * skipped write is not a delivered one: without a replay path it loses a
 * stationary user's cursor and strands a departed one. `resend()` is that
 * path, driven by the peer-count 0 → >0 transition in `BoardView`.
 */
describe("createCursorPublisher — audience re-open", () => {
  function gatedHarness() {
    const scheduler = makeFakeScheduler();
    const publish = vi.fn();
    let hasPeers = false;
    const publisher = createCursorPublisher({
      ...scheduler,
      publish,
      shouldPublish: () => hasPeers,
    });
    return {
      scheduler,
      publish,
      publisher,
      openAudience: () => {
        hasPeers = true;
      },
    };
  }

  // Probe A: the user moved, then stopped, then a peer joined. No pointer
  // event follows the join, so only a replay can make them visible.
  it("makes a stationary cursor visible when the audience opens", () => {
    const h = gatedHarness();

    h.publisher.queue({ x: 42, y: 7 });
    h.scheduler.flushAll();
    expect(h.publish).not.toHaveBeenCalled();

    h.openAudience();
    h.publisher.resend();
    h.scheduler.flushAll();

    expect(h.publish).toHaveBeenCalledTimes(1);
    expect(h.publish).toHaveBeenCalledWith({ x: 42, y: 7 });
  });

  // Probe B: a peer was present, then left, and the local pointerleave
  // fell into the closed gate — presence still holds the old position, so
  // the next peer to join would meet a ghost cursor.
  it("replays a swallowed pointerleave instead of stranding a ghost cursor", () => {
    const scheduler = makeFakeScheduler();
    const publish = vi.fn();
    let hasPeers = true;
    const publisher = createCursorPublisher({
      ...scheduler,
      publish,
      shouldPublish: () => hasPeers,
    });

    // A peer is watching: the position lands in presence.
    publisher.queue({ x: 5, y: 5 });
    scheduler.flushAll();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenLastCalledWith({ x: 5, y: 5 });

    // The peer leaves, then the local pointer leaves the canvas. The
    // clear is gated away — presence still holds { x: 5, y: 5 }.
    hasPeers = false;
    publisher.queue(null);
    scheduler.flushAll();
    expect(publish).toHaveBeenCalledTimes(1);

    // A new peer joins. The swallowed clear must NOT have been recorded
    // as delivered, or that stale cursor sits on their screen forever.
    hasPeers = true;
    publisher.resend();
    scheduler.flushAll();

    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenLastCalledWith(null);
  });

  it("still writes nothing at all while the user is solo", () => {
    const h = gatedHarness();

    h.publisher.queue({ x: 1, y: 1 });
    h.publisher.queue({ x: 2, y: 2 });
    h.scheduler.flushAll();
    h.publisher.queue({ x: 3, y: 3 });
    h.scheduler.flushAll();
    // Even a peer-change tick that fires while still solo must not write.
    h.publisher.resend();
    h.scheduler.flushAll();

    expect(h.publish).not.toHaveBeenCalled();
  });

  it("resend is a no-op when nothing was queued or when presence is current", () => {
    const scheduler = makeFakeScheduler();
    const publish = vi.fn();
    const publisher = createCursorPublisher({ ...scheduler, publish });

    // Never entered the canvas — must not invent a cursor.
    publisher.resend();
    scheduler.flushAll();
    expect(publish).not.toHaveBeenCalled();
    expect(scheduler.requestFrame).not.toHaveBeenCalled();

    publisher.queue({ x: 1, y: 1 });
    scheduler.flushAll();
    expect(publish).toHaveBeenCalledTimes(1);

    // Already delivered — a peer joining must not re-write it.
    publisher.resend();
    scheduler.flushAll();
    expect(publish).toHaveBeenCalledTimes(1);
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
