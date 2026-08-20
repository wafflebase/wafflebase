// Settling a prediction read — deciding WHEN the value the hunter predicted is safe
// to look at.
//
// WHY THIS IS NOT THE RUNNER'S PROBLEM TO SOLVE INLINE. A prediction is submitted
// atomically with the action that provokes it, precisely so the caller cannot look
// before committing. That atomicity means the caller has no way to insert a wait of
// its own: if the read happens too early, a CORRECT prediction is recorded as
// `violated`, which is an eligible candidate, which spends a verifier panel on a
// defect that does not exist. The settling has to happen here, and it has to be right.
//
// WHY IT IS PREDICTION-BLIND, AND MUST STAY THAT WAY. The obvious "fix" is to wait
// until the value matches what was predicted. That would make every prediction hold
// and destroy the only signal this harness produces. Nothing in this module may see
// the expectation — it takes a `read` and returns what the page settled on, whatever
// that turns out to be.
//
// WHY THE CLOCK AND THE READ ARE INJECTED. The bug this module was extracted to fix
// is a TIMING bug, and a timing bug that can only be reproduced by driving a real
// browser is a bug with no regression test. With `read`/`sleep`/`now` supplied by the
// caller, the exact interleaving that produced a stale read is an ordinary unit test.

/** Gap between polls once watching has started. */
export const SETTLE_POLL_MS = 25;

/**
 * How long the value must hold still before it counts as settled.
 *
 * THIS CONSTANT IS THE BUG FIX. The previous rule was "two consecutive equal reads",
 * which cannot distinguish the two states it most needs to tell apart:
 *
 *   already finished   read, read again 25ms later, same value — settled
 *   not yet started    read, read again 25ms later, same value — STALE PRE-STATE
 *
 * Both look identical from inside. Any effect that took longer than one poll to land
 * — a debounce, a batched React commit, a Yorkie update, an async layout pass —
 * returned the value from BEFORE the action, on every surface. The prediction that
 * correctly described the after-state was then scored `violated`.
 *
 * A quiet WINDOW is the smallest honest change: the value must be unchanged for this
 * long, so a late effect gets seen, resets the window, and is waited out. There is no
 * way to distinguish "will never change" from "has not changed yet" without a
 * completion signal the app does not expose, so this is a bound on how late an effect
 * may be, not a proof. 150ms is ~6 polls and comfortably past a frame boundary.
 *
 * The cost is paid on no-op actions, which now wait the full window instead of
 * returning at 25ms. That is the right trade: at ~100 predictions per run it is a few
 * seconds of wall clock, against a false candidate that costs a verifier panel in real
 * spend plus the hand-audit to throw it out.
 */
export const SETTLE_QUIET_MS = 150;

/** `undefined` and a missing value serialize alike; matches the original comparison. */
function serialize(value) {
  return JSON.stringify(value ?? null);
}

/**
 * Read until the value stops moving.
 *
 * Returns `{ value, settled }`. `settled: false` means the value was STILL CHANGING
 * when the deadline expired — the caller must not compare it, because a value caught
 * mid-flight is exactly as untrustworthy as one that was too big to serialize. The
 * old signature returned a bare value, so this case was indistinguishable from a
 * clean read and was silently scored as if it were one.
 */
export async function readSettled({
  read,
  sleep,
  now,
  deadlineMs,
  quietMs = SETTLE_QUIET_MS,
  pollMs = SETTLE_POLL_MS,
}) {
  // A quiet window at or past the deadline can never elapse, so EVERY read would come
  // back unsettled and every prediction would score `unevaluable` — the whole oracle
  // switched off by a config value, silently and with no failing test. Refused at the
  // boundary rather than clamped, because clamping would honour neither number.
  if (!(deadlineMs > quietMs)) {
    throw new Error(
      `readSettled: deadlineMs (${deadlineMs}) must exceed quietMs (${quietMs}), ` +
        `or no read can ever settle`,
    );
  }

  const deadline = now() + deadlineMs;
  let value = await read();
  let serialized = serialize(value);
  let lastChange = now();

  for (;;) {
    if (now() - lastChange >= quietMs) return { value, settled: true };
    if (now() >= deadline) return { value, settled: false };
    await sleep(pollMs);
    const next = await read();
    const nextSerialized = serialize(next);
    if (nextSerialized !== serialized) {
      serialized = nextSerialized;
      lastChange = now();
    }
    // Kept even when equal: `read` may return a fresh object each call, and the
    // caller should get the most recent one rather than a stale-but-equal earlier one.
    value = next;
  }
}
