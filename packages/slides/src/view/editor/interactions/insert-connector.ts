import type { ConnectorElement, Endpoint } from '../../../model/connector';
import type { Element } from '../../../model/element';
import type { SlidesStore } from '../../../store/store';
import {
  getConnectionSites,
  siteWorldPos,
} from '../../canvas/connection-sites';
import { computeConnectorFrame } from '../../canvas/connector-frame';

/**
 * Connector-insert variants exposed to the editor. PR1 ships only two:
 *   - `'line'`  — straight line, no arrowheads.
 *   - `'arrow'` — straight line, triangle arrowhead at `end`.
 * The variant maps directly to the toolbar `'connector:line'` /
 * `'connector:arrow'` insert-mode keys.
 */
export type ConnectorInsertVariant = 'line' | 'arrow';

/**
 * Distance (in slide-logical units) within which a cursor counts as
 * "over" a shape for connection-points display. Currently consumed by
 * the overlay (Task 13); exported so the overlay and snap helpers share
 * one source of truth.
 */
export const SHAPE_HOVER_RADIUS = 24;

/**
 * Distance within which the cursor snaps to a connection site. Smaller
 * than `SHAPE_HOVER_RADIUS` so the user sees the dots first, then has
 * to deliberately move closer to commit to a snap.
 */
export const SITE_SNAP_RADIUS = 12;

/**
 * Minimum drag distance before a connector-insert commits. A click or
 * micro-drag cancels insertion — connectors with near-zero length are
 * almost always accidental.
 */
export const MIN_DRAG_DISTANCE = 4;

export interface SnapHit {
  elementId: string;
  siteIndex: number;
  worldX: number;
  worldY: number;
}

/**
 * Find the nearest connection site to `cursor` across all candidate
 * elements. Returns null if no site is within `SITE_SNAP_RADIUS`.
 * Connector elements have no connection sites and are skipped, so a
 * fresh connector never accidentally snaps to a sibling connector's
 * endpoint.
 */
export function findSnapTarget(
  cursor: { x: number; y: number },
  elements: readonly Element[],
): SnapHit | null {
  let best: SnapHit | null = null;
  let bestD2 = SITE_SNAP_RADIUS * SITE_SNAP_RADIUS;
  for (const el of elements) {
    if (el.type === 'connector') continue;
    const sites = getConnectionSites(el);
    for (let i = 0; i < sites.length; i++) {
      const s = siteWorldPos(el, sites[i]);
      const dx = s.x - cursor.x;
      const dy = s.y - cursor.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = { elementId: el.id, siteIndex: i, worldX: s.x, worldY: s.y };
      }
    }
  }
  return best;
}

/**
 * Resolve the cursor to an `Endpoint`. When the cursor is within the
 * snap radius of a connection site, returns an `attached` endpoint;
 * otherwise a `free` endpoint at the raw cursor position.
 */
export function snappedEndpoint(
  cursor: { x: number; y: number },
  elements: readonly Element[],
): Endpoint {
  const hit = findSnapTarget(cursor, elements);
  if (hit) {
    return { kind: 'attached', elementId: hit.elementId, siteIndex: hit.siteIndex };
  }
  return { kind: 'free', x: cursor.x, y: cursor.y };
}

/**
 * Build the `ElementInit` for a connector-insert drag — used by both
 * the live drag preview (no store mutation) and `finalizeInsert`
 * (which commits to the store). Centralising the shape keeps the
 * preview and the committed element perfectly in sync.
 */
export function buildConnectorInit(
  variant: ConnectorInsertVariant,
  start: { x: number; y: number },
  end: { x: number; y: number },
  elements: readonly Element[],
): Omit<ConnectorElement, 'id'> {
  const startEp = snappedEndpoint(start, elements);
  const endEp = snappedEndpoint(end, elements);

  const arrowheads: ConnectorElement['arrowheads'] =
    variant === 'arrow'
      ? { end: { kind: 'triangle', size: 'md' } }
      : {};

  const init: Omit<ConnectorElement, 'id'> = {
    type: 'connector',
    routing: 'straight',
    start: startEp,
    end: endEp,
    arrowheads,
    frame: { x: 0, y: 0, w: 0, h: 0, rotation: 0 },
    stroke: { color: { kind: 'role', role: 'text' }, width: 2 },
  };
  // Pre-fill the frame so insertion-time selection bbox is correct.
  init.frame = computeConnectorFrame(
    { id: '_', ...init } as ConnectorElement,
    new Map(elements.map((e) => [e.id, e])),
  );
  return init;
}

/**
 * Finalize a connector-insert drag. Returns the new element id, or
 * null if the drag was too short to be meaningful. The caller is
 * responsible for batching this call and clearing insert mode after.
 */
export function finalizeInsert(
  store: SlidesStore,
  slideId: string,
  variant: ConnectorInsertVariant,
  start: { x: number; y: number },
  end: { x: number; y: number },
  elements: readonly Element[],
): string | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.hypot(dx, dy) < MIN_DRAG_DISTANCE) return null;
  const init = buildConnectorInit(variant, start, end, elements);
  return store.addElement(slideId, init);
}
