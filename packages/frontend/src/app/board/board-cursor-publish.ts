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

  const flush = () => {
    scheduled = false;
    deps.publish(pending);
  };

  return {
    queue(position) {
      pending = position;
      if (scheduled) return;
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
