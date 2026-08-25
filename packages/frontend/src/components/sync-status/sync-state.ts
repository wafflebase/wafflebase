/**
 * The sync-status state machine, kept pure and separate from the React
 * binding in `use-sync-status.ts` so the decision that matters can be tested
 * as a truth table rather than through a rendered component.
 *
 * Design: docs/design/sync-status.md
 */

export type SyncState =
  /** Connected, nothing queued. */
  | 'saved'
  /** Connected, changes still on their way to the server. */
  | 'saving'
  /** Disconnected, but nothing of the user's is at risk. */
  | 'reconnecting'
  /** Unpushed edits exist and are not currently reaching the server. */
  | 'not-saved';

export interface SyncSignals {
  /** Yorkie's watch stream is open (`StreamConnectionStatus.Connected`). */
  connected: boolean;
  /** `doc.hasLocalChanges()` — the queue of changes the server has not taken. */
  hasLocalChanges: boolean;
  /** The last sync attempt reported `DocSyncStatus.SyncFailed`. */
  syncFailed: boolean;
}

/**
 * Severity keys on `hasLocalChanges`, not on connectivity.
 *
 * A reader on a flaky connection loses nothing, so they get the muted
 * `reconnecting` and no unload guard. Only a non-empty queue that is not
 * draining escalates to `not-saved` — the one state that is loud, because it
 * is the one state where closing the tab destroys work.
 *
 * `syncFailed` is deliberately ignored once the queue has drained: a failed
 * *pull* costs the user none of their own edits, and reporting it would be
 * alarm with no consequence behind it. It matters only alongside pending
 * changes, where it separates "in flight" from "being rejected" — otherwise a
 * push that keeps failing would sit on `saving` forever, claiming progress
 * that is not happening.
 */
export function deriveSyncState({
  connected,
  hasLocalChanges,
  syncFailed,
}: SyncSignals): SyncState {
  if (!hasLocalChanges) {
    return connected ? 'saved' : 'reconnecting';
  }
  if (!connected || syncFailed) {
    return 'not-saved';
  }
  return 'saving';
}
