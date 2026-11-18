import type { Element, Stroke } from '../../../model/element';
import type { Point } from './insert';
import {
  INK_MIN_STEP_SCREEN_PX,
  INK_SIMPLIFY_SCREEN_PX,
  pushDecimated,
  simplifyStroke,
  snapStraight,
} from './ink';
import { isFreeformShape, segmentHitsFreeform } from '../freeform-hit';
import type { LiveInkLayer } from '../live-ink-layer';

/**
 * Pointer capture for freehand ink (the `'freeform'` insert kind) and
 * the stroke eraser (the `'eraser'` insert kind). Lives outside
 * `editor.ts` so the editor only routes into it; everything the loops
 * need from the editor comes through {@link InkCaptureHost}.
 */

/** Live-layer key for this client's own stroke. */
export const LOCAL_INK_KEY = 'local';

/** Eraser reach, in SCREEN px, either side of the pointer's path. */
export const ERASER_RADIUS_SCREEN_PX = 8;

export interface InkCaptureHost {
  clientToLogical(clientX: number, clientY: number): Point;
  /** World units → CSS px. */
  scale(): number;
  liveLayer: LiveInkLayer;
  /** Resolve a stored stroke colour (theme role or CSS) for painting. */
  resolveColor(color: Stroke['color']): string;
  /**
   * Keep the tool armed after a stroke (board marker) instead of the
   * Slides default of dropping back to Select. Also makes Esc mid-stroke
   * cancel only that stroke.
   */
  sticky: boolean;
}

/** What the editor does with a finished stroke. */
export interface InkCaptureCallbacks {
  /** Commit `points` (world, already simplified) as one undo unit. */
  commit(points: Point[]): void;
  /**
   * The stroke in progress changed (world points, unsimplified). The
   * board mirrors it into presence so peers see the line being drawn.
   */
  progress?(points: readonly Point[]): void;
  /**
   * The gesture ended — committed, cancelled, or aborted. `disarm` is
   * whether the editor should drop the insert mode (non-sticky, or Esc
   * in Slides).
   */
  end(disarm: boolean): void;
}

/**
 * Run one freehand stroke from `start` until pointerup / Esc / cancel.
 * Returns an abort function (pointercancel, a host taking the touch for
 * a pinch): discards the stroke and keeps the mode armed when sticky.
 */
export function captureInkStroke(
  host: InkCaptureHost,
  start: Point,
  pointerId: number | null,
  stroke: Stroke,
  callbacks: InkCaptureCallbacks,
): () => void {
  const points: Point[] = [start];
  const color = host.resolveColor(stroke.color);
  const show = (): void => {
    const snapshot = points.slice();
    host.liveLayer.set(LOCAL_INK_KEY, {
      points: snapshot,
      color,
      width: stroke.width,
      cap: stroke.cap,
    });
    callbacks.progress?.(snapshot);
  };
  // A dot under the pointer right away, so a press reads as "drawing".
  show();
  let done = false;

  const ours = (ev: PointerEvent): boolean =>
    pointerId === null || ev.pointerId === undefined || ev.pointerId === pointerId;

  const onMove = (ev: PointerEvent): void => {
    if (!ours(ev)) return;
    if (ev.shiftKey) {
      // Straight line from the start point, snapped to 15°.
      const end = snapStraight(start, host.clientToLogical(ev.clientX, ev.clientY));
      points.length = 1;
      points.push(end);
      show();
      return;
    }
    const minStep = INK_MIN_STEP_SCREEN_PX / host.scale();
    // `getCoalescedEvents` carries the samples the browser merged into
    // this frame's single `pointermove`; without them a fast curve turns
    // into visible chords.
    const samples =
      typeof ev.getCoalescedEvents === 'function' ? ev.getCoalescedEvents() : [];
    let changed = false;
    for (const s of samples.length > 0 ? samples : [ev]) {
      const p = host.clientToLogical(s.clientX, s.clientY);
      if (pushDecimated(points, p, minStep)) changed = true;
    }
    if (changed) show();
  };

  const cleanup = (): void => {
    done = true;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onCancel);
    document.removeEventListener('keydown', onKey, true);
  };

  const finish = (commit: boolean, disarm: boolean): void => {
    if (done) return;
    cleanup();
    if (commit) {
      callbacks.commit(simplifyStroke(points, INK_SIMPLIFY_SCREEN_PX / host.scale()));
    }
    // Cleared after the commit's repaint, so the stroke never blinks
    // out between the live layer and the scene. Only this client's key:
    // a peer's stroke in progress on the same layer stays.
    host.liveLayer.set(LOCAL_INK_KEY, null);
    host.liveLayer.flush();
    callbacks.end(disarm);
  };

  const onUp = (ev: PointerEvent): void => {
    if (!ours(ev)) return;
    finish(true, !host.sticky);
  };
  const onCancel = (ev: PointerEvent): void => {
    if (!ours(ev)) return;
    finish(false, !host.sticky);
  };
  // Esc mid-stroke discards it. Capture phase + stopImmediatePropagation
  // so the editor's own Esc key rule does not ALSO run: in Slides that
  // rule disarms (and so does this, matching the old scribble), but a
  // sticky board marker stays armed — Esc with no stroke in progress is
  // what disarms it.
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    finish(false, !host.sticky);
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onCancel);
  document.addEventListener('keydown', onKey, true);
  return () => finish(false, !host.sticky);
}

/**
 * Run one eraser drag from `start`. Every top-level freeform whose
 * painted stroke the pointer's path touches is hidden at once and
 * deleted on release, in one batch — one undo restores the whole drag.
 */
export function captureEraserDrag(
  host: InkCaptureHost & {
    /** Top-level elements of the current slide, read once. */
    elements: readonly Element[];
    /** Repaint the scene without the given ids (the erase preview). */
    preview(hidden: ReadonlySet<string>): void;
    /** Delete `ids` as one undo unit. */
    remove(ids: string[]): void;
  },
  start: Point,
  pointerId: number | null,
  callbacks: Pick<InkCaptureCallbacks, 'end'>,
): () => void {
  const candidates = host.elements.filter(isFreeformShape);
  const erased = new Set<string>();
  const trail: Point[] = [start];
  let last = start;
  let done = false;

  const showTrail = (): void => {
    host.liveLayer.set(LOCAL_INK_KEY, {
      points: trail.slice(-24),
      color: 'rgba(120, 120, 120, 0.35)',
      width: (ERASER_RADIUS_SCREEN_PX * 2) / host.scale(),
      cap: 'round',
    });
  };

  const sweep = (a: Point, b: Point): void => {
    const radius = ERASER_RADIUS_SCREEN_PX / host.scale();
    let changed = false;
    for (const el of candidates) {
      if (erased.has(el.id)) continue;
      if (segmentHitsFreeform(el, a, b, radius)) {
        erased.add(el.id);
        changed = true;
      }
    }
    if (changed) host.preview(erased);
  };
  sweep(start, start);
  showTrail();

  const ours = (ev: PointerEvent): boolean =>
    pointerId === null || ev.pointerId === undefined || ev.pointerId === pointerId;

  const onMove = (ev: PointerEvent): void => {
    if (!ours(ev)) return;
    const samples =
      typeof ev.getCoalescedEvents === 'function' ? ev.getCoalescedEvents() : [];
    for (const s of samples.length > 0 ? samples : [ev]) {
      const p = host.clientToLogical(s.clientX, s.clientY);
      sweep(last, p);
      last = p;
      trail.push(p);
    }
    showTrail();
  };
  const cleanup = (): void => {
    done = true;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onCancel);
    document.removeEventListener('keydown', onKey, true);
  };
  const finish = (commit: boolean, disarm: boolean): void => {
    if (done) return;
    cleanup();
    if (commit && erased.size > 0) host.remove([...erased]);
    else if (erased.size > 0) host.preview(new Set());
    host.liveLayer.set(LOCAL_INK_KEY, null);
    host.liveLayer.flush();
    callbacks.end(disarm);
  };
  const onUp = (ev: PointerEvent): void => {
    if (!ours(ev)) return;
    finish(true, !host.sticky);
  };
  const onCancel = (ev: PointerEvent): void => {
    if (!ours(ev)) return;
    finish(false, !host.sticky);
  };
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    finish(false, !host.sticky);
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onCancel);
  document.addEventListener('keydown', onKey, true);
  return () => finish(false, !host.sticky);
}
