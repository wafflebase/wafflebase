import { useCallback, useEffect, useRef, useState } from 'react';
import { useDocument } from '@yorkie-js/react';
import { deriveSyncState, type SyncState } from './sync-state';

/**
 * How often the change queue is re-read while it matters. The call is a length
 * check on an array, so the cost is nil; what this bounds is how stale the
 * chip can look, and a second is well under the point where that is
 * noticeable. See the effect below for why a healthy document schedules
 * nothing at all.
 */
const POLL_MS = 1000;

/**
 * `@yorkie-js/sdk` is a devDependency here (every `src` import of it is a type
 * import), so its `StreamConnectionStatus` / `DocSyncStatus` enums cannot be
 * pulled in as values. Both are string enums, and these are their members —
 * compared through `String()` because TypeScript rejects a direct enum-to-
 * literal comparison.
 */
const CONNECTED = 'connected';
const SYNC_FAILED = 'sync-failed';

export interface SyncStatus {
  state: SyncState;
  /**
   * When the queue last went from empty to non-empty — i.e. how far back the
   * work now at risk begins. Null whenever nothing is queued.
   */
  pendingSince: Date | null;
}

/**
 * Reports whether this document's local edits have reached the server.
 *
 * Must be called inside a `DocumentProvider`. Connection state comes from that
 * context, sync outcomes from the document's own `sync` events, and the queue
 * itself from `doc.hasLocalChanges()` — which is a getter, not an event, and
 * so is sampled.
 *
 * Design: docs/design/sync-status.md
 */
export function useSyncStatus(): SyncStatus {
  const { doc, connection } = useDocument();
  const connected = String(connection) === CONNECTED;

  const [queued, setQueued] = useState(false);
  const [pendingSince, setPendingSince] = useState<Date | null>(null);
  const [syncFailed, setSyncFailed] = useState(false);

  // Mirrors `queued` so a sample can decide whether anything changed without
  // taking `queued` as a dependency — which would rebuild the interval on
  // every flip and, worse, make an unchanged tick still cost a render.
  const queuedRef = useRef(false);

  const sample = useCallback(() => {
    const next = doc?.hasLocalChanges() ?? false;
    if (next === queuedRef.current) return;
    queuedRef.current = next;
    setQueued(next);
    setPendingSince(next ? new Date() : null);
  }, [doc]);

  // On mount, and whenever the connection flips — a reconnect is exactly when
  // the queue is most likely to start draining.
  useEffect(() => {
    sample();
  }, [sample, connected]);

  useEffect(() => {
    if (!doc) return;
    return doc.subscribe('sync', (event) => {
      setSyncFailed(String(event.value) === SYNC_FAILED);
      sample();
    });
  }, [doc, sample]);

  // The queue is polled only while something is actually at stake. A connected
  // document with an empty queue — the overwhelmingly common case — schedules
  // no timer at all, so an idle editor costs nothing.
  useEffect(() => {
    if (connected && !queued) return;
    const id = setInterval(sample, POLL_MS);
    return () => clearInterval(id);
  }, [connected, queued, sample]);

  // Before the provider has a document there is no connection to have lost and
  // nothing queued to lose, so the honest answer is `saved` — "you have no
  // unsaved work". Falling through to `deriveSyncState` would instead report
  // `reconnecting`, flashing that on every document open for the length of the
  // attach.
  if (!doc) {
    return { state: 'saved', pendingSince: null };
  }

  return {
    state: deriveSyncState({ connected, hasLocalChanges: queued, syncFailed }),
    pendingSince,
  };
}
