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
 *    user's cursor. A gated frame does NOT record what it skipped, so the
 *    next queued position after a peer joins is published even if the
 *    pointer never moved again.
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
  let pending: CursorPosition | null = null;
  // What the peers currently see. Starts at `null` — presence carries no
  // cursor until we write one — so a `pointerleave` before any move is
  // correctly a no-op rather than a wasted "clear nothing" write.
  let published: CursorPosition | null = null;

  const unchanged = (position: CursorPosition | null): boolean => {
    if (position === null || published === null) return position === published;
    return position.x === published.x && position.y === published.y;
  };

  const flush = () => {
    scheduled = false;
    // Re-checked here, not only in `queue()`: a pointer that wandered off
    // and came back to the exact last-published point within one frame
    // leaves `pending` different from what was queued first.
    if (unchanged(pending)) return;
    if (deps.shouldPublish && !deps.shouldPublish()) return;
    published = pending === null ? null : { x: pending.x, y: pending.y };
    deps.publish(pending);
  };

  return {
    queue(position) {
      pending = position;
      if (scheduled) return;
      // Nothing to say this frame — don't even book one.
      if (unchanged(position)) return;
      scheduled = true;
      handle = deps.requestFrame(flush);
    },
    dispose() {
      if (!scheduled) return;
      scheduled = false;
      deps.cancelFrame(handle);
    },
  };
}
