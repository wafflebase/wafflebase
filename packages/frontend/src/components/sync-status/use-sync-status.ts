import { useCallback, useEffect, useRef, useState } from 'react';
import { useDocument } from '@yorkie-js/react';
import { deriveSyncState, type SyncState } from './sync-state';

/**
 * How long the editor must be quiet — no new edit, and nothing of the user's
 * still ahead of the server — before `Saving…` resolves to `Saved`.
 *
 * Needed because the underlying truth genuinely oscillates: a push is accepted
 * within milliseconds, so between two keystrokes there really is nothing
 * outstanding, and a chip that reported each of those transitions strobed —
 * which is what a smoke test of the docs editor found. An earlier attempt to
 * delay only the "nothing outstanding" observation did not fix it, because
 * nothing re-raised the state when the next keystroke arrived.
 *
 * Chosen to sit comfortably above the pauses inside ordinary typing, so that
 * thinking for a moment mid-sentence does not flip the chip.
 */
const QUIET_MS = 2000;

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
 * context and sync outcomes from the document's own `sync` events. Whether
 * work is outstanding comes from two sources that have to be combined: the
 * `local-change` event, which is edge-triggered and says the user just edited,
 * and `doc.hasLocalChanges()`, which is a getter and says whether the server
 * has taken it. Neither alone is enough — see `QUIET_MS`.
 *
 * Design: docs/design/sync-status.md
 */
export function useSyncStatus(): SyncStatus {
  const { doc, connection } = useDocument();
  const connected = String(connection) === CONNECTED;

  const [pending, setPending] = useState(false);
  const [pendingSince, setPendingSince] = useState<Date | null>(null);
  const [syncFailed, setSyncFailed] = useState(false);

  // Mirrors `pending` so a signal can tell whether anything actually changed
  // without taking `pending` as a dependency — which would rebuild the
  // subscription on every flip and, worse, make an unchanged tick cost a
  // render.
  const pendingRef = useRef(false);

  // The client sequence of the user's most recent *edit*. Compared against the
  // sequence the server has acknowledged to answer "is their work on the
  // server yet"; see `unflushed` below for why this is tracked rather than
  // read off the queue.
  const lastEditSeqRef = useRef(0);

  // The outstanding "has it been quiet long enough yet?" check. One is always
  // scheduled while `pending` is true, and every new edit pushes it back.
  const quietRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Whether the user's own edits are still ahead of what the server has taken.
   *
   * NOT `doc.hasLocalChanges()`. That reports the change *queue*, and the queue
   * is not a record of the user's work: `Document.update()` pushes every change
   * onto it, presence-only ones included, while emitting `local-change` only
   * when the change carried operations. Dragging a selection or moving a caret
   * therefore fills the queue without editing anything — which is exactly how
   * Sheets ended up toggling Saving/Saved on a bare drag.
   *
   * Comparing the last *edit*'s client sequence against the checkpoint's asks
   * the question the chip actually means, and presence can never enter into it.
   */
  const unflushed = useCallback(
    () => !!doc && lastEditSeqRef.current > doc.getCheckpoint().getClientSeq(),
    [doc],
  );

  /**
   * Record an edit: raise the pending state and restart the quiet window.
   */
  const markEdited = useCallback(
    (clientSeq: number) => {
      lastEditSeqRef.current = Math.max(lastEditSeqRef.current, clientSeq);
      if (!pendingRef.current) {
        pendingRef.current = true;
        setPending(true);
        setPendingSince(new Date());
      }
      if (quietRef.current !== null) clearTimeout(quietRef.current);
      const settle = () => {
        // A quiet keyboard is not a flushed document. If the server still has
        // not taken the work, keep waiting rather than reassure.
        if (unflushed()) {
          quietRef.current = setTimeout(settle, QUIET_MS);
          return;
        }
        quietRef.current = null;
        pendingRef.current = false;
        setPending(false);
        setPendingSince(null);
      };
      quietRef.current = setTimeout(settle, QUIET_MS);
    },
    [unflushed],
  );

  useEffect(
    () => () => {
      if (quietRef.current !== null) clearTimeout(quietRef.current);
    },
    [],
  );

  // `local-change` is the only thing that raises this state. It is
  // edge-triggered, so no poll can miss it, and it fires only for changes that
  // carried operations — which is what makes a moved selection a non-event.
  // Remote changes are somebody else's work and must not hold this chip up.
  useEffect(() => {
    if (!doc) return;
    return doc.subscribe((event) => {
      if (event.type !== 'local-change') return;
      const { clientSeq } = event.value as { clientSeq?: number };
      markEdited(clientSeq ?? lastEditSeqRef.current + 1);
    });
  }, [doc, markEdited]);

  useEffect(() => {
    if (!doc) return;
    return doc.subscribe('sync', (event) => {
      setSyncFailed(String(event.value) === SYNC_FAILED);
    });
  }, [doc]);

  // Before the provider has a document there is no connection to have lost and
  // nothing queued to lose, so the honest answer is `saved` — "you have no
  // unsaved work". Falling through to `deriveSyncState` would instead report
  // `reconnecting`, flashing that on every document open for the length of the
  // attach.
  if (!doc) {
    return { state: 'saved', pendingSince: null };
  }

  return {
    state: deriveSyncState({ connected, pending, syncFailed }),
    pendingSince,
  };
}
