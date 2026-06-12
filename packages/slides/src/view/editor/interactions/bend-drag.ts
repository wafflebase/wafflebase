import type { ConnectorElement } from '../../../model/connector';
import type { SlidesStore } from '../../../store/store';

/**
 * Commit a bend value to a connector through the store, choosing the
 * right method based on routing. Caller is responsible for wrapping
 * in `store.batch(...)` so undo treats the whole drag as one op.
 *
 * Straight connectors are no-ops — `bendFromCursor` returns `null`
 * before we ever get here, so this path is defensive only.
 */
export function commitBend(
  store: SlidesStore,
  slideId: string,
  connector: ConnectorElement,
  bend: number,
): void {
  if (connector.routing === 'elbow') {
    store.updateConnectorElbowBend(slideId, connector.id, bend);
  } else if (connector.routing === 'curved') {
    store.updateConnectorCurveBend(slideId, connector.id, bend);
  }
}
