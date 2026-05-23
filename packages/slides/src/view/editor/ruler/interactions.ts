/**
 * Ruler / guide drag interactions for the slides editor.
 *
 * Three gestures share the same drag-state machine, all driven through
 * pointer events on the editor surface:
 *
 * 1. **Create**: mousedown on the H or V ruler canvas seeds a pending
 *    guide. mousemove updates its position. mouseup inside the slide
 *    commits via `store.addGuide`; mouseup outside cancels.
 *
 * 2. **Move**: mousedown within `GUIDE_HIT_PX` of an existing guide
 *    seeds a pending guide carrying the guide's id. mousemove updates
 *    position. mouseup over the slide commits via `store.moveGuide`;
 *    mouseup over a ruler deletes via `store.removeGuide`.
 *
 * 3. **Delete-by-drag**: a sub-case of (2) — mouseup over a ruler
 *    triggers `removeGuide` instead of `moveGuide`.
 *
 * The editor owns the pending state (`pendingGuide` on `SlidesEditorImpl`)
 * and the overlay repaint pipeline; this module is a stateless helper
 * that wires document-level pointer listeners and calls back into the
 * editor through a narrow API.
 *
 * Hit-test distance is in slide-logical pixels (4 px on the slide
 * canvas, scaled by the editor zoom to get the screen tolerance).
 */

import { SLIDE_HEIGHT, SLIDE_WIDTH, type Guide } from '../../../model/presentation';

/** Hit-test tolerance for grabbing an existing guide, in slide-logical px. */
export const GUIDE_HIT_PX = 4;

export interface GuideDragHost {
  /** Update the pending preview + repaint overlay; also broadcast presence. */
  setPendingGuide(
    guide: { id?: string; axis: 'x' | 'y'; position: number } | null,
  ): void;
  /** Commit add / move / remove inside a batch. */
  commitAddGuide(axis: 'x' | 'y', position: number): void;
  commitMoveGuide(id: string, position: number): void;
  commitRemoveGuide(id: string): void;
  /** Read the live guide list for hit-testing. */
  readGuides(): readonly Guide[];
  /**
   * Convert a client (screen-space) coordinate into slide-logical
   * coordinates. Caller does the actual scale and origin math; this
   * keeps the interactions module unaware of zoom + DPR specifics.
   */
  clientToLogical(clientX: number, clientY: number): { x: number; y: number };
  /** True if a client point falls over the H or V ruler region. */
  isOverRuler(clientX: number, clientY: number): 'h' | 'v' | null;
  /**
   * True if a logical point falls inside the slide bounds
   * `[0, SLIDE_WIDTH] × [0, SLIDE_HEIGHT]`. Used to gate
   * commit-vs-cancel on mouseup.
   */
  isInsideSlide(x: number, y: number): boolean;
  /** Pointer position relative to the slide canvas (slide-logical px). */
  setBodyCursor(cursor: string | null): void;
}

/**
 * Hit-test a slide-logical pointer against the live guide list.
 * Returns the closest guide within `GUIDE_HIT_PX` of the pointer, or
 * null if none qualify. Caller is responsible for picking among
 * overlapping guides — `find` returns the first match in `guides[]`
 * order, which is the deck's authored z-order.
 */
export function hitTestGuide(
  guides: readonly Guide[],
  point: { x: number; y: number },
): Guide | null {
  for (const g of guides) {
    const d =
      g.axis === 'x'
        ? Math.abs(point.x - g.position)
        : Math.abs(point.y - g.position);
    if (d <= GUIDE_HIT_PX) return g;
  }
  return null;
}

/**
 * Start a drag-out from the ruler: the user pressed down on the
 * horizontal or vertical ruler. We seed a pending guide at the
 * cursor's projection onto the slide, then attach document-level
 * pointermove + pointerup so the gesture continues even if the
 * cursor wanders off the ruler.
 *
 * Returns a disposer that detaches the listeners (mostly for tests;
 * production callers can rely on mouseup teardown).
 */
export function startRulerDragOut(
  host: GuideDragHost,
  axis: 'x' | 'y',
  initialEvent: PointerEvent,
): () => void {
  initialEvent.preventDefault();
  host.setBodyCursor(axis === 'x' ? 'col-resize' : 'row-resize');

  const onMove = (e: PointerEvent) => {
    const { x, y } = host.clientToLogical(e.clientX, e.clientY);
    const position = axis === 'x' ? x : y;
    host.setPendingGuide({ axis, position });
  };
  const onUp = (e: PointerEvent) => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    host.setBodyCursor(null);
    const { x, y } = host.clientToLogical(e.clientX, e.clientY);
    if (host.isInsideSlide(x, y)) {
      const position = clamp(axis === 'x' ? x : y, axis);
      host.commitAddGuide(axis, position);
    }
    host.setPendingGuide(null);
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);

  // Prime the preview at the current cursor so the user sees the line
  // immediately, before any pointer movement.
  const start = host.clientToLogical(initialEvent.clientX, initialEvent.clientY);
  host.setPendingGuide({ axis, position: axis === 'x' ? start.x : start.y });

  return () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
  };
}

/**
 * Start dragging an existing guide. mouseup over the slide commits a
 * `moveGuide`; mouseup over either ruler triggers `removeGuide` —
 * this is the "drag back to delete" affordance.
 */
export function startGuideMove(
  host: GuideDragHost,
  guide: Guide,
  initialEvent: PointerEvent,
): () => void {
  initialEvent.preventDefault();
  host.setBodyCursor(guide.axis === 'x' ? 'col-resize' : 'row-resize');

  const onMove = (e: PointerEvent) => {
    const { x, y } = host.clientToLogical(e.clientX, e.clientY);
    const position = clamp(guide.axis === 'x' ? x : y, guide.axis);
    host.setPendingGuide({ id: guide.id, axis: guide.axis, position });
  };
  const onUp = (e: PointerEvent) => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    host.setBodyCursor(null);
    const overRuler = host.isOverRuler(e.clientX, e.clientY);
    if (overRuler) {
      host.commitRemoveGuide(guide.id);
    } else {
      const { x, y } = host.clientToLogical(e.clientX, e.clientY);
      const position = clamp(guide.axis === 'x' ? x : y, guide.axis);
      if (position !== guide.position) {
        host.commitMoveGuide(guide.id, position);
      }
    }
    host.setPendingGuide(null);
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);

  // Seed the preview at the guide's current position so the line
  // visibly "lifts off" without needing the first mousemove.
  host.setPendingGuide({
    id: guide.id,
    axis: guide.axis,
    position: guide.position,
  });

  return () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
  };
}

function clamp(value: number, axis: 'x' | 'y'): number {
  const max = axis === 'x' ? SLIDE_WIDTH : SLIDE_HEIGHT;
  return Math.max(0, Math.min(max, value));
}
