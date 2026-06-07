import type { Element } from '../../../model/element';
import type { SlidesStore } from '../../../store/store';

/**
 * Slow double-click tuning constants — kept here so dogfooding can adjust
 * the timing/distance window without touching the editor state machine.
 *
 * See docs/design/slides/slides-hover-and-text-edit-entry.md § P1.5.
 */
export const SLOW_DOUBLE_CLICK_MAX_DISTANCE_PX = 3;
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
