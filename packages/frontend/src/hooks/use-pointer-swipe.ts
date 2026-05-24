import { useEffect, type RefObject } from "react";

/** Minimum |dx| in px before a swipe fires. */
const DEFAULT_THRESHOLD_PX = 50;
/** Maximum time (ms) between pointerdown and pointerup for the gesture to
 * still register — guards against slow drags being mistaken for swipes. */
const DEFAULT_MAX_DURATION_MS = 600;
/** |dx| at which the gesture commits to horizontal mode and starts
 * suppressing the browser's default (e.g. iOS swipe-back). */
const DEFAULT_CLASSIFY_AT_PX = 10;

export interface PointerSwipeOptions {
  onSwipeLeft: () => void;
  onSwipeRight: () => void;
  thresholdPx?: number;
  maxDurationMs?: number;
  classifyAtPx?: number;
}

type Phase = "idle" | "pending" | "horizontal" | "cancelled";

/**
 * DOM-only attach helper. Wires `pointerdown` / `pointermove` /
 * `pointerup` / `pointercancel` on `el` and fires `onSwipeLeft` /
 * `onSwipeRight` when a left/right swipe past `thresholdPx` finishes
 * inside `maxDurationMs`. Once the gesture is classified as horizontal
 * (`|dx| > classifyAtPx` and `|dx| > |dy|`), subsequent `pointermove`
 * events call `preventDefault` so the browser does not start a
 * competing scroll or history-back swipe.
 *
 * Exposed separately from `usePointerSwipe` so the gesture logic can
 * be unit-tested directly, without mounting a React component.
 *
 * Returns the cleanup function the caller should invoke on teardown.
 */
export function attachPointerSwipe(
  el: HTMLElement,
  options: PointerSwipeOptions,
): () => void {
  const threshold = options.thresholdPx ?? DEFAULT_THRESHOLD_PX;
  const maxDuration = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
  const classifyAt = options.classifyAtPx ?? DEFAULT_CLASSIFY_AT_PX;

  let phase: Phase = "idle";
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let pointerId: number | null = null;

  const onDown = (e: PointerEvent) => {
    // Ignore additional pointerdowns while we're tracking another
    // pointer. Without this, a second finger landing mid-swipe would
    // overwrite the first finger's start coordinates and pointerId,
    // turning the in-flight gesture into nonsense. `pointerId` is
    // cleared on pointerup / pointercancel, so a fresh gesture
    // starts cleanly after either path.
    if (pointerId !== null) return;
    phase = "pending";
    startX = e.clientX;
    startY = e.clientY;
    startTime = e.timeStamp;
    pointerId = e.pointerId;
    if (typeof el.setPointerCapture === "function") {
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Some environments (jsdom, or pointers that don't allow capture)
        // throw — safe to ignore; the gesture still works through bubbled
        // events.
      }
    }
  };

  const onMove = (e: PointerEvent) => {
    if (phase === "idle" || phase === "cancelled") return;
    if (pointerId !== null && e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (phase === "pending") {
      if (Math.abs(dx) > classifyAt && Math.abs(dx) > Math.abs(dy)) {
        phase = "horizontal";
        if (e.cancelable) e.preventDefault();
      } else if (Math.abs(dy) > classifyAt && Math.abs(dy) >= Math.abs(dx)) {
        phase = "cancelled";
      }
    } else if (phase === "horizontal") {
      if (e.cancelable) e.preventDefault();
    }
  };

  const onUp = (e: PointerEvent) => {
    if (pointerId !== null && e.pointerId !== pointerId) return;
    const wasHorizontal = phase === "horizontal";
    phase = "idle";
    pointerId = null;
    if (!wasHorizontal) return;
    const dx = e.clientX - startX;
    const elapsed = e.timeStamp - startTime;
    if (elapsed > maxDuration) return;
    if (Math.abs(dx) < threshold) return;
    if (dx < 0) options.onSwipeLeft();
    else options.onSwipeRight();
  };

  const onCancel = (e: PointerEvent) => {
    if (pointerId !== null && e.pointerId !== pointerId) return;
    phase = "cancelled";
    pointerId = null;
  };

  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onCancel);

  return () => {
    el.removeEventListener("pointerdown", onDown);
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", onUp);
    el.removeEventListener("pointercancel", onCancel);
  };
}

/**
 * React wrapper around `attachPointerSwipe`. Mounts the gesture
 * listeners on `ref.current` when present.
 */
export function usePointerSwipe(
  ref: RefObject<HTMLElement | null>,
  options: PointerSwipeOptions,
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return attachPointerSwipe(el, options);
  }, [ref, options]);
}
