/**
 * Throttled presence publisher (peer cursors v2), extracted from
 * `BoardView` so the timing rules are unit-testable without a DOM or a
 * Yorkie document. It is driven by injected clock and timer functions
 * rather than the real `setTimeout` / `Date.now` globals.
 *
 * The send rule is the Yorkie `simultaneous-cursors` example's
 * (docs/design/board/board-figjam-parity.md § Second pass B):
 *
 * 1. **At most one write per `intervalMs`** (40 ms for the cursor). A
 *    `queue()` inside the interval is held and sent when it ends, so a
 *    burst of pointer samples costs one write per interval, not one per
 *    frame.
 * 2. **Dead-band.** A throttled send whose value is within the dead-band
 *    of what presence already holds is skipped, but the intent is kept:
 * 3. **Rest send.** `restMs` (100 ms) after the last `queue()`, the exact
 *    final value is sent if it differs at all from what presence holds.
 *    The dead-band therefore never leaves a peer's cursor short of where
 *    the pointer actually stopped.
 *
 * Two further gates keep a write from happening at all, because a
 * presence write is not free: it emits a SELF `presence-changed`, which
 * `@yorkie-js/react` turns into a new state object, which re-renders the
 * board view and toolbar tree.
 *
 * - **Exact repeat.** A value equal to the one last published is dropped.
 * - **Audience** (optional `shouldPublish`). Nobody is looking at a solo
 *   user's cursor.
 *
 * The audience gate skips a write, so it must never claim one happened:
 * `published` — "what presence currently holds" — is updated ONLY on an
 * actual write. A gated send therefore leaves an intent undelivered,
 * and {@link ThrottledPublisher.resend} is how the host says "the audience
 * changed, deliver it now". Without that, a gate that closes over a
 * pending `null` strands a ghost cursor in presence, and a user who was
 * stationary when a peer joined stays invisible until they move.
 *
 * `published` starts UNKNOWN rather than `null`, because `BoardView`'s
 * mount effect can re-run (e.g. `workspaceId` resolving after first
 * render) and build a fresh publisher against a presence that may already
 * carry a value. Assuming `null` there would swallow the next
 * `pointerleave` as redundant and strand that cursor forever; assuming
 * nothing costs at most one extra write.
 */
export interface CursorPosition {
  x: number;
  y: number;
}

export interface ThrottledPublisherDeps<T> {
  /** Milliseconds since some fixed origin. */
  now: () => number;
  /** Run `callback` after `ms`; returns a handle for {@link clearTimer}. */
  setTimer: (callback: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  /** Write the value into presence. */
  publish: (value: T) => void;
  /** Exact equality: an equal value is never re-sent. */
  equals: (a: T, b: T) => boolean;
  /**
   * Whether `next` is close enough to `published` to skip a THROTTLED
   * send (the rest send ignores it). Absent ⇒ no dead-band.
   */
  withinDeadBand?: (next: T, published: T) => boolean;
  /**
   * Optional audience gate, consulted at send time. Return `false` to
   * skip the write entirely (e.g. nobody else is on the board). Absent
   * ⇒ always publish.
   */
  shouldPublish?: () => boolean;
  /** Minimum gap between two writes. */
  intervalMs: number;
  /** Quiet time after the last `queue()` before the exact rest send. */
  restMs: number;
}

export interface ThrottledPublisher<T> {
  /** Offer a new value. */
  queue(value: T): void;
  /**
   * Re-offer the last queued intent when it never made it into presence
   * — call this when the audience opens (peer count 0 → >0). A no-op
   * when nothing was ever queued, or when the last intent is already
   * what presence holds, so it is safe to call on any peer change.
   */
  resend(): void;
  /** Cancel pending timers without publishing. Safe to call repeatedly. */
  dispose(): void;
}

export function createThrottledPublisher<T>(
  deps: ThrottledPublisherDeps<T>,
): ThrottledPublisher<T> {
  let pending: T | undefined;
  let everQueued = false;
  // `undefined` = unknown (see the module comment). Written only when a
  // publish actually happens.
  let published: { value: T } | undefined;
  let lastSentAt = -Infinity;
  let throttleTimer: unknown = null;
  let restTimer: unknown = null;
  let disposed = false;

  const unchanged = (value: T): boolean =>
    published !== undefined && deps.equals(value, published.value);

  const send = (useDeadBand: boolean) => {
    if (disposed || !everQueued) return;
    const value = pending as T;
    if (unchanged(value)) return;
    if (
      useDeadBand &&
      published !== undefined &&
      deps.withinDeadBand?.(value, published.value)
    ) {
      return;
    }
    // Gate closed: publish nothing AND remember nothing. `pending` stays
    // undelivered, so `resend()` can hand it over once it opens.
    if (deps.shouldPublish && !deps.shouldPublish()) return;
    published = { value };
    lastSentAt = deps.now();
    deps.publish(value);
  };

  const clearThrottle = () => {
    if (throttleTimer === null) return;
    deps.clearTimer(throttleTimer);
    throttleTimer = null;
  };
  const clearRest = () => {
    if (restTimer === null) return;
    deps.clearTimer(restTimer);
    restTimer = null;
  };

  return {
    queue(value) {
      if (disposed) return;
      everQueued = true;
      pending = value;
      // The rest send restarts on every sample: it fires once the
      // pointer has been still for `restMs`.
      clearRest();
      restTimer = deps.setTimer(() => {
        restTimer = null;
        send(false);
      }, deps.restMs);
      if (throttleTimer !== null) return; // a send is already booked
      const wait = lastSentAt + deps.intervalMs - deps.now();
      if (wait <= 0) {
        send(true);
        return;
      }
      throttleTimer = deps.setTimer(() => {
        throttleTimer = null;
        send(true);
      }, wait);
    },
    resend() {
      // Never invent a value for a pointer that never entered the canvas.
      if (disposed || !everQueued) return;
      if (unchanged(pending as T)) return;
      // Deferred, not synchronous: the caller is usually a Yorkie
      // subscription callback, and a presence write from inside one is
      // a nested `doc.update`.
      clearThrottle();
      throttleTimer = deps.setTimer(() => {
        throttleTimer = null;
        send(false);
      }, 0);
    },
    dispose() {
      disposed = true;
      clearThrottle();
      clearRest();
    },
  };
}

/** Send interval for the pointer, from the design (§ Second pass B). */
export const CURSOR_INTERVAL_MS = 40;
/** Quiet time before the exact final position is sent. */
export const CURSOR_REST_MS = 100;

export type CursorPublisher = ThrottledPublisher<CursorPosition | null>;

/**
 * The board's pointer publisher: world coordinates (so two peers with
 * different pan and zoom agree), 40 ms throttle, a dead-band of
 * `deadBand()` world units, and a 100 ms rest send. `null` means "the
 * pointer left the canvas" and is never inside a dead-band.
 */
export function createCursorPublisher(deps: {
  now: () => number;
  setTimer: (callback: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  publish: (position: CursorPosition | null) => void;
  shouldPublish?: () => boolean;
  /** Dead-band radius in WORLD units, read per send (it depends on zoom). */
  deadBand?: () => number;
}): CursorPublisher {
  return createThrottledPublisher<CursorPosition | null>({
    now: deps.now,
    setTimer: deps.setTimer,
    clearTimer: deps.clearTimer,
    publish: deps.publish,
    shouldPublish: deps.shouldPublish,
    intervalMs: CURSOR_INTERVAL_MS,
    restMs: CURSOR_REST_MS,
    equals: (a, b) =>
      a === null || b === null ? a === b : a.x === b.x && a.y === b.y,
    withinDeadBand: (next, prev) => {
      if (next === null || prev === null || !deps.deadBand) return false;
      const r = deps.deadBand();
      return Math.hypot(next.x - prev.x, next.y - prev.y) < r;
    },
  });
}
