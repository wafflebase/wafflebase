import test from "node:test";
import assert from "node:assert/strict";

import { readSettled, SETTLE_POLL_MS, SETTLE_QUIET_MS } from "./hunt-ui-settle.mjs";

/**
 * A virtual clock. `sleep` advances time instead of consuming it, so a test can place
 * an effect at "80ms after the action" and assert on the interleaving exactly, with no
 * real waiting and no flake.
 */
function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
  };
}

test("readSettled: an effect that lands after the first poll is NOT read as the pre-state", async () => {
  // THE REGRESSION. The old rule returned as soon as two consecutive reads agreed, so
  // an effect slower than one poll produced two identical PRE-state reads and settled
  // on the value from before the action — scoring a correct prediction `violated`.
  const clock = fakeClock();
  const result = await readSettled({
    read: async () => (clock.now() < 80 ? "before" : "after"),
    sleep: clock.sleep,
    now: clock.now,
    deadlineMs: 5_000,
  });
  assert.equal(result.value, "after");
  assert.equal(result.settled, true);
});

test("readSettled: each late change restarts the quiet window", async () => {
  // Two effects, the second landing well after the first would have settled. Stopping
  // at the first is the same defect one step later.
  const clock = fakeClock();
  const result = await readSettled({
    // "c" lands at 180ms — INSIDE the window "b" started at ~75ms, so a correct
    // implementation is still watching and must pick it up. (Placed after that window
    // closed, this would settle on "b" legitimately and prove nothing.)
    read: async () => (clock.now() < 60 ? "a" : clock.now() < 180 ? "b" : "c"),
    sleep: clock.sleep,
    now: clock.now,
    deadlineMs: 5_000,
  });
  assert.equal(result.value, "c");
  assert.equal(result.settled, true);
});

test("readSettled: a value that never moves still settles, and waits the quiet window", async () => {
  // The no-op action — a refused click, a held prediction. It must keep working, and
  // it must not return before the window has actually elapsed, or the window is a lie.
  const clock = fakeClock();
  const reads = [];
  const result = await readSettled({
    read: async () => {
      reads.push(clock.now());
      return 42;
    },
    sleep: clock.sleep,
    now: clock.now,
    deadlineMs: 5_000,
  });
  assert.deepEqual(result, { value: 42, settled: true });
  assert.ok(
    clock.now() >= SETTLE_QUIET_MS,
    `settled at ${clock.now()}ms, before the ${SETTLE_QUIET_MS}ms window elapsed`,
  );
  assert.ok(reads.length > 1, "polled only once, so nothing was actually watched");
});

test("readSettled: a value still moving at the deadline reports settled=false", async () => {
  // The caller MUST be able to tell this from a clean read. Reporting the last sample
  // as though it were final is what let a mid-flight value be compared.
  const clock = fakeClock();
  const result = await readSettled({
    read: async () => clock.now(),
    sleep: clock.sleep,
    now: clock.now,
    deadlineMs: 200,
  });
  assert.equal(result.settled, false);
});

test("readSettled: refuses a quiet window that the deadline cannot contain", async () => {
  // Left unguarded, this silently switches the oracle off: nothing can ever settle, so
  // every prediction scores `unevaluable` and the hunter reports no findings at all.
  // Driven by an ADVANCING clock on purpose: with the guard deleted this call must
  // still terminate (returning an unsettled read at the deadline) so the assertion
  // fails loudly. A frozen clock would spin forever and the regression would show up
  // as a hung suite instead of a failing test.
  const clock = fakeClock();
  await assert.rejects(
    () =>
      readSettled({
        read: async () => 1,
        sleep: clock.sleep,
        now: clock.now,
        deadlineMs: 100,
        quietMs: 150,
      }),
    /must exceed quietMs/,
  );
});

test("readSettled: equal-but-distinct reads return the most recent object", async () => {
  // `read` may build a fresh object per call. Two are equal by value, so the window
  // keeps running; the one handed back should still be the latest sample.
  const clock = fakeClock();
  const seen = [];
  const result = await readSettled({
    read: async () => {
      const v = { ids: ["a", "b"] };
      seen.push(v);
      return v;
    },
    sleep: clock.sleep,
    now: clock.now,
    deadlineMs: 5_000,
  });
  assert.equal(result.settled, true);
  assert.equal(result.value, seen[seen.length - 1]);
});

test("readSettled: polls at the configured interval", async () => {
  const clock = fakeClock();
  const at = [];
  await readSettled({
    read: async () => {
      at.push(clock.now());
      return "x";
    },
    sleep: clock.sleep,
    now: clock.now,
    deadlineMs: 5_000,
  });
  assert.deepEqual(at.slice(0, 3), [0, SETTLE_POLL_MS, SETTLE_POLL_MS * 2]);
});

test("readSettled: never polls past the deadline, even when it is not a multiple of the poll", async () => {
  // A deadline of 170ms with a 25ms poll lands mid-interval. Uncapped, the last sleep
  // overshot to 175ms and `deadlineMs` was advisory rather than a bound.
  const clock = fakeClock();
  const result = await readSettled({
    read: async () => clock.now(), // never repeats, so it can only end at the deadline
    sleep: clock.sleep,
    now: clock.now,
    deadlineMs: 170,
  });
  assert.equal(result.settled, false);
  assert.equal(clock.now(), 170, `returned at ${clock.now()}ms, past the 170ms deadline`);
});

test("readSettled: a window that closes exactly ON the deadline still counts as settled", async () => {
  // Pins a REJECTED review suggestion: checking the deadline before the quiet window.
  //
  // The value changes at 50ms and holds to 200ms — a complete 150ms window, whose last
  // tick coincides with the deadline. That the budget ran out on the same tick does not
  // unmake the observation. Deadline-first would return `settled: false` here, the runner
  // would emit `{__unsettled}`, and a genuinely settled reading would score `unevaluable`
  // instead of yielding its verdict. Losing signal is worse than overrunning a budget
  // that is already spent.
  const clock = fakeClock();
  const result = await readSettled({
    read: async () => (clock.now() < 50 ? "a" : "b"),
    sleep: clock.sleep,
    now: clock.now,
    deadlineMs: 200,
  });
  assert.deepEqual(result, { value: "b", settled: true });
  assert.equal(clock.now(), 200);
});
