/**
 * rAF-coalesced publisher for the local pointer position, extracted from
 * `BoardView`'s mount effect so the coalescing logic is unit-testable
 * without mounting a DOM + Yorkie doc. Mirrors `board-wheel.ts` /
 * `is-editable-target.ts`: a pure module driven by injected dependencies
 * rather than real `requestAnimationFrame`/`cancelAnimationFrame` globals.
 *
 * A raw `pointermove` publish would push a CRDT presence update per mouse
 * sample and flood the channel, so every `queue()` call within the same
 * animation frame collapses into a single `publish()` carrying only the
 * LAST queued position — including `null` ("pointer left the canvas"),
 * which must be delivered rather than silently dropped so a departed
 * cursor does not stick on peers' screens at its last position.
 *
 * Two further gates keep a frame from publishing anything at all, because
 * a presence write is not free: it emits a SELF `presence-changed`, which
 * `@yorkie-js/react` turns into a new state object, which re-renders the
 * whole board view + toolbar tree.
 *
 * 1. **Position delta.** A position equal to the one last published is
 *    dropped. Browsers emit `pointermove` for sub-pixel and non-move
 *    events, and a world position quantized by the viewport transform
 *    repeats often.
 * 2. **Audience** (optional `shouldPublish`). Nobody is looking at a solo
 *    user's cursor.
 *
 * The audience gate skips a write, so it must never claim one happened:
 * `published` — "what presence currently holds" — is updated ONLY on an
 * actual write. A gated frame therefore leaves an intent undelivered,
 * and {@link CursorPublisher.resend} is how the host says "the audience
 * changed, deliver it now". Without that, a gate that closes over a
 * pending `null` strands a ghost cursor in presence, and a user who was
 * stationary when a peer joined stays invisible until they move.
 *
 * `published` starts UNKNOWN rather than `null`, because a publisher can
 * outlive nothing but itself: `BoardView`'s mount effect re-runs (e.g.
 * `workspaceId` resolving after first render) build a fresh publisher
 * against a presence that may already carry a cursor. Assuming `null`
 * there would swallow the next `pointerleave` as redundant and strand
 * that cursor forever; assuming nothing costs at most one extra write.
 */
export interface CursorPosition {
  x: number;
  y: number;
}

export interface CursorPublisherDeps {
  /** Schedule `callback` to run on the next frame; returns a handle for cancellation. */
  requestFrame: (callback: () => void) => number;
  /** Cancel a handle previously returned by `requestFrame`. */
  cancelFrame: (handle: number) => void;
  /** Called once per flushed frame with the last position queued during it. */
  publish: (position: CursorPosition | null) => void;
  /**
   * Optional audience gate, consulted at flush time. Return `false` to
   * skip the publish entirely (e.g. nobody else is on the board). Absent
   * ⇒ always publish.
   */
  shouldPublish?: () => boolean;
}

export interface CursorPublisher {
  /** Queue a position (or `null` for "pointer left") for the next frame. */
  queue(position: CursorPosition | null): void;
  /**
   * Re-offer the last queued intent when it never made it into presence
   * — call this when the audience opens (peer count 0 → >0). A no-op
   * when nothing was ever queued, or when the last intent is already
   * what presence holds, so it is safe to call on any peer change.
   */
  resend(): void;
  /**
   * Cancel any pending scheduled frame without publishing. Safe to call
   * even when nothing was ever queued (e.g. a read-only mount that never
   * registered the pointer listeners) — a no-op in that case.
   */
  dispose(): void;
}

export function createCursorPublisher(deps: CursorPublisherDeps): CursorPublisher {
  // A boolean flag rather than a truthy-handle check (`if (handle) ...`):
  // a fake scheduler in tests (or, in principle, any real one) is free to
  // hand back `0` as its first handle, which would otherwise be
  // indistinguishable from "nothing scheduled".
  let scheduled = false;
  let handle = 0;
  // The last thing the pointer said — the INTENT, delivered or not.
  let pending: CursorPosition | null = null;
  let everQueued = false;
  // What presence currently holds. `undefined` = unknown (see the module
  // comment); written only when a publish actually happens, so a frame
  // dropped by the audience gate is never mistaken for a delivered one.
  let published: CursorPosition | null | undefined = undefined;

  const unchanged = (position: CursorPosition | null): boolean => {
    if (published === undefined) return false;
    if (position === null || published === null) return position === published;
    return position.x === published.x && position.y === published.y;
  };

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    handle = deps.requestFrame(flush);
  };

  const flush = () => {
    scheduled = false;
    // Re-checked here, not only in `queue()`: a pointer that wandered off
    // and came back to the exact last-published point within one frame
    // leaves `pending` different from what was queued first.
    if (unchanged(pending)) return;
    // Gate closed: publish nothing AND remember nothing. `pending` stays
    // undelivered, so `resend()` can hand it over once it opens.
    if (deps.shouldPublish && !deps.shouldPublish()) return;
    published = pending === null ? null : { x: pending.x, y: pending.y };
    deps.publish(pending);
  };

  return {
    queue(position) {
      everQueued = true;
      pending = position;
      if (scheduled) return;
      // Nothing to say this frame — don't even book one.
      if (unchanged(position)) return;
      schedule();
    },
    resend() {
      // Never invent a cursor for a pointer that never entered the canvas.
      if (!everQueued) return;
      if (unchanged(pending)) return;
      schedule();
    },
    dispose() {
      if (!scheduled) return;
      scheduled = false;
      deps.cancelFrame(handle);
    },
  };
}
