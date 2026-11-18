import { describe, expect, it, vi } from "vitest";
import {
  CURSOR_INTERVAL_MS,
  CURSOR_REST_MS,
  createCursorPublisher,
  createThrottledPublisher,
} from "./board-cursor-publish";

/** A fake clock + timer pair, advanced by hand. */
function makeClock() {
  let t = 1000;
  let nextId = 1;
  const timers = new Map<number, { at: number; cb: () => void }>();
  return {
    now: () => t,
    setTimer: vi.fn((cb: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, { at: t + ms, cb });
      return id;
    }),
    clearTimer: vi.fn((id: unknown) => {
      timers.delete(id as number);
    }),
    advance(ms: number) {
      const end = t + ms;
      for (;;) {
        let next: [number, { at: number; cb: () => void }] | undefined;
        for (const entry of timers) {
          if (entry[1].at <= end && (!next || entry[1].at < next[1].at)) next = entry;
        }
        if (!next) break;
        timers.delete(next[0]);
        t = next[1].at;
        next[1].cb();
      }
      t = end;
    },
  };
}

function setup(opts: { deadBand?: number; audience?: () => boolean } = {}) {
  const clock = makeClock();
  const publish = vi.fn();
  const publisher = createCursorPublisher({
    ...clock,
    publish,
    shouldPublish: opts.audience,
    deadBand: opts.deadBand === undefined ? undefined : () => opts.deadBand!,
  });
  return { clock, publish, publisher };
}

describe("createCursorPublisher (peer cursors v2)", () => {
  it("sends the first move at once, then at most one per interval carrying the last position", () => {
    const { clock, publish, publisher } = setup();
    publisher.queue({ x: 1, y: 1 });
    expect(publish).toHaveBeenCalledTimes(1);
    for (let i = 2; i <= 5; i++) {
      clock.advance(5);
      publisher.queue({ x: i, y: i });
    }
    expect(publish).toHaveBeenCalledTimes(1);
    clock.advance(CURSOR_INTERVAL_MS);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenLastCalledWith({ x: 5, y: 5 });
  });

  it("halves traffic against a 60 Hz pointer stream", () => {
    const { clock, publish, publisher } = setup();
    for (let i = 0; i < 60; i++) {
      publisher.queue({ x: i * 10, y: 0 });
      clock.advance(1000 / 60);
    }
    // 1 s of 60 samples → ≤ 26 writes (one per 40 ms, plus the first).
    expect(publish.mock.calls.length).toBeLessThanOrEqual(26);
    expect(publish.mock.calls.length).toBeGreaterThan(20);
  });

  it("skips a throttled move inside the dead-band, then sends the exact rest position", () => {
    const { clock, publish, publisher } = setup({ deadBand: 3 });
    publisher.queue({ x: 0, y: 0 });
    publish.mockClear();
    clock.advance(CURSOR_INTERVAL_MS);
    publisher.queue({ x: 1, y: 1 });
    expect(publish).not.toHaveBeenCalled();
    clock.advance(CURSOR_REST_MS);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith({ x: 1, y: 1 });
  });

  it("never treats a leave as inside the dead-band", () => {
    const { clock, publish, publisher } = setup({ deadBand: 1000 });
    publisher.queue({ x: 0, y: 0 });
    clock.advance(CURSOR_INTERVAL_MS);
    publisher.queue(null);
    expect(publish).toHaveBeenLastCalledWith(null);
  });

  it("drops an exact repeat of what presence already holds", () => {
    const { clock, publish, publisher } = setup();
    publisher.queue({ x: 2, y: 2 });
    clock.advance(500);
    publisher.queue({ x: 2, y: 2 });
    clock.advance(500);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("does not record a gated send, and resend delivers it when the audience opens", () => {
    let audience = false;
    const { clock, publish, publisher } = setup({ audience: () => audience });
    publisher.queue({ x: 4, y: 4 });
    clock.advance(500);
    expect(publish).not.toHaveBeenCalled();
    audience = true;
    publisher.resend();
    // Deferred (never inside the caller's Yorkie callback).
    expect(publish).not.toHaveBeenCalled();
    clock.advance(0);
    expect(publish).toHaveBeenCalledWith({ x: 4, y: 4 });
  });

  it("resend is a no-op before anything was queued", () => {
    const { clock, publish, publisher } = setup();
    publisher.resend();
    clock.advance(500);
    expect(publish).not.toHaveBeenCalled();
  });

  it("starts from an unknown published state, so a first leave is delivered", () => {
    const { publish, publisher } = setup();
    publisher.queue(null);
    expect(publish).toHaveBeenCalledWith(null);
  });

  it("dispose cancels the pending sends", () => {
    const { clock, publish, publisher } = setup();
    publisher.queue({ x: 1, y: 1 });
    clock.advance(5);
    publisher.queue({ x: 9, y: 9 });
    publisher.dispose();
    clock.advance(1000);
    expect(publish).toHaveBeenCalledTimes(1);
  });
});

describe("createThrottledPublisher", () => {
  it("throttles an arbitrary value with its own interval and rest", () => {
    const clock = makeClock();
    const publish = vi.fn();
    const p = createThrottledPublisher<string>({
      ...clock,
      publish,
      equals: (a, b) => a === b,
      intervalMs: 100,
      restMs: 150,
    });
    p.queue("a");
    clock.advance(10);
    p.queue("ab");
    clock.advance(10);
    p.queue("abc");
    expect(publish.mock.calls).toEqual([["a"]]);
    clock.advance(200);
    expect(publish.mock.calls).toEqual([["a"], ["abc"]]);
  });
});
