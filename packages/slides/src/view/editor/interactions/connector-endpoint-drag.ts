import type { ConnectorElement } from '../../../model/connector';
import type { Element } from '../../../model/element';
import type { SlidesStore } from '../../../store/store';
import { snappedEndpoint } from './insert-connector';

/**
 * Move one endpoint of a selected connector. Snaps to a connection
 * site when the cursor is within `SITE_SNAP_RADIUS` screen pixels of
 * one (converted to slide-logical via `zoom`), otherwise drops as a
 * `free` endpoint at the raw cursor position.
 *
 * The connector itself is excluded from snap candidates so an endpoint
 * cannot self-link (and so other connectors — which have no connection
 * sites — are skipped anyway by `findSnapTarget`). For PR1 we excludes
 * self only; if that produces a zero-length self-loop because the
 * *other* endpoint already attaches to the same shape, the user can
 * undo or drag the second endpoint away — PR2 may tighten this.
 *
 * Mutation is a single `updateConnectorEndpoint` call so the batch
 * boundary lives with the caller (the editor's `startEndpointDrag`
 * wraps the whole drag in one `store.batch` for atomic undo).
 */
export function dragEndpoint(
  store: SlidesStore,
  slideId: string,
  connector: ConnectorElement,
  side: 'start' | 'end',
  cursor: { x: number; y: number },
  elements: readonly Element[],
  zoom: number,
): void {
  const candidates = elements.filter((e) => e.id !== connector.id);
  const endpoint = snappedEndpoint(cursor, candidates, zoom);
  store.updateConnectorEndpoint(slideId, connector.id, side, endpoint);
}
