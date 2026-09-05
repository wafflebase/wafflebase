import type { Element } from '../../../model/element';
import type { SlidesStore } from '../../../store/store';

/**
 * Slow double-click tuning constants — kept here so dogfooding can adjust
 * the timing/distance window without touching the editor state machine.
 *
 * See docs/design/slides/slides-hover-and-text-edit-entry.md § P1.5.
 */
export const SLOW_DOUBLE_CLICK_MAX_DISTANCE_PX = 3;
/**
 * Client-px travel above which a pointer gesture counts as a drag rather
 * than a click. Deliberately the same number as the slow-double-click
 * window above — two thresholds answering "did this move?" would only
 * have to disagree once to produce a gesture that is a click to one rule
 * and a drag to the other.
 *
 * Named separately because the dependency runs the other way too: grid
 * snapping (`editor.ts`, `activeSnapGrid`) will not engage below it, so
 * raising the slow-double-click distance for dogfooding would leave the
 * grid inert for the first few pixels of every board drag. Change it
 * knowing both.
 */
export const DRAG_THRESHOLD_PX = SLOW_DOUBLE_CLICK_MAX_DISTANCE_PX;
/**
 * The same threshold for a fingertip. 3px is a mouse number: a mouse
 * that has not moved reports no movement at all, so anything above
 * noise is intent. A finger reports 5–10px of travel across the span of
 * a tap that the user experienced as stationary — the contact patch
 * shifts as pressure changes and the browser re-centroids it. At 3px
 * that jitter reads as a drag, so every tap nudges the element it
 * landed on and pushes an undo entry for a move nobody asked for.
 *
 * A stylus is not in this bucket: `pen` input is as precise as a mouse,
 * and widening its threshold would only make it feel sluggish.
 */
export const TOUCH_DRAG_THRESHOLD_PX = 10;

/**
 * Pick the drag threshold matching the input device. `undefined` (a
 * synthetic `MouseEvent`, or a test double) takes the precise number,
 * which keeps the mouse path — and every existing test — unchanged.
 */
export function dragThresholdFor(pointerType?: string): number {
  return pointerType === 'touch' ? TOUCH_DRAG_THRESHOLD_PX : DRAG_THRESHOLD_PX;
}

/**
 * Read the input device off an event the editor's drag loops type as
 * `MouseEvent`. Every listener behind them is registered for
 * `pointermove` / `pointerup`, so the value is present at runtime; the
 * `MouseEvent` typing is a leftover of the Pointer Events migration and
 * the cast keeps that migration from having to finish here. `undefined`
 * for a synthetic mouse event or a test double.
 */
export function pointerTypeOf(ev: MouseEvent): string | undefined {
  return (ev as PointerEvent).pointerType;
}

/**
 * Whether the slow-double-click text-entry route is available to this
 * input device. Its window is 3px over 350ms — inside a fingertip's own
 * jitter (see {@link TOUCH_DRAG_THRESHOLD_PX}), so on touch the rule
 * cannot distinguish "clicked the same element twice, deliberately"
 * from "tapped once and held still". Widening the window instead would
 * make every held tap open the keyboard. Touch keeps the browser's
 * `dblclick` (double-tap) route, which is the platform convention and
 * is already wired.
 */
export function allowsSlowDoubleClick(pointerType?: string): boolean {
  return pointerType !== 'touch';
}

/**
 * Touch long-press → context menu. A finger has no second button, and
 * the browser event that would stand in for one is not dependable: iOS
 * withholds `contextmenu` wherever `-webkit-touch-callout: none` is set
 * — which the mobile slides shell sets deliberately, to stop the system
 * callout appearing over the editor's own menu. So the press is timed
 * here rather than delegated.
 *
 * Both numbers match `use-mobile-sheet-gestures`, so the same press
 * opens a menu in a spreadsheet and on a slide.
 */
export const LONG_PRESS_DELAY_MS = 500;
export const LONG_PRESS_TOLERANCE_PX = 10;

export const SLOW_DOUBLE_CLICK_MAX_DURATION_MS = 350;
/**
 * Maximum gap (ms) between two consecutive pointer-downs on the same
 * element for the second to count as the "second click" of a slow
 * double-click sequence. Larger than the up-down window because users
 * can hesitate between clicks; smaller than 1 s so an idle gap doesn't
 * carry stale state. Aligns with Google Slides' observed behaviour.
 */
export const SLOW_DOUBLE_CLICK_SEQUENCE_WINDOW_MS = 600;

/**
 * Pure: classifies a no-drag pointer-up that landed on an already-selected
 * single text-capable element as a "slow double-click" (second click on
 * the same element, tight enough to be intentional but slower than the
 * browser's strict `dblclick` window). Caller is responsible for the
 * selection / text-region pre-conditions; this helper only enforces the
 * timing + distance gate.
 */
export function isSlowDoubleClick(
  downClientX: number,
  downClientY: number,
  downTimeMs: number,
  upClientX: number,
  upClientY: number,
  upTimeMs: number,
): boolean {
  const dist = Math.hypot(upClientX - downClientX, upClientY - downClientY);
  if (dist >= SLOW_DOUBLE_CLICK_MAX_DISTANCE_PX) return false;
  if (upTimeMs - downTimeMs >= SLOW_DOUBLE_CLICK_MAX_DURATION_MS) return false;
  return true;
}

/**
 * Pure: apply a (dx, dy) translation to a single element. Returns a
 * shallow-cloned element (callers can pass through their own state
 * without worrying about input aliasing).
 *
 * For connectors, the cached `frame` is derived from endpoints — we
 * translate every `kind: 'free'` endpoint and let attached endpoints
 * stay anchored to their host. The frame is translated too so that
 * any caller using it for hit-tests or bbox math stays consistent
 * with the renderer (which reads endpoints).
 */
export function translateElement(
  el: Element, dx: number, dy: number,
): Element {
  if (el.type === 'connector') {
    return {
      ...el,
      start: el.start.kind === 'free'
        ? { kind: 'free', x: el.start.x + dx, y: el.start.y + dy }
        : el.start,
      end: el.end.kind === 'free'
        ? { kind: 'free', x: el.end.x + dx, y: el.end.y + dy }
        : el.end,
      frame: { ...el.frame, x: el.frame.x + dx, y: el.frame.y + dy },
    };
  }
  return {
    ...el,
    frame: { ...el.frame, x: el.frame.x + dx, y: el.frame.y + dy },
  };
}

/**
 * Commit a (dx, dy) translation to the store. Routes connectors to
 * `updateConnectorEndpoint` because their `frame` is derived state —
 * `updateElementFrame` would (correctly) throw. Attached endpoints are
 * left in place; the store recomputes the cached connector frame from
 * the surviving endpoints.
 *
 * Must be called inside a `store.batch(...)`.
 */
export function commitTranslate(
  store: SlidesStore, slideId: string, el: Element,
  dx: number, dy: number,
): void {
  if (dx === 0 && dy === 0) return;
  if (el.type === 'connector') {
    for (const side of ['start', 'end'] as const) {
      const ep = side === 'start' ? el.start : el.end;
      if (ep.kind === 'free') {
        store.updateConnectorEndpoint(slideId, el.id, side, {
          kind: 'free', x: ep.x + dx, y: ep.y + dy,
        });
      }
    }
    return;
  }
  store.updateElementFrame(slideId, el.id, {
    x: el.frame.x + dx,
    y: el.frame.y + dy,
  });
}
