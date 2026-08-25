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
  /**
   * There is local work the server is not yet known to have taken.
   *
   * Deliberately NOT "`doc.hasLocalChanges()` right now". That getter is a
   * knife edge — a push lands within milliseconds, so between two keystrokes
   * it reads empty while the user is plainly still working, and a chip driven
   * off it strobes. `use-sync-status.ts` raises this on the `local-change`
   * event and lowers it only after the editor has been quiet *and* the queue
   * has actually drained.
   */
  pending: boolean;
  /** The last sync attempt reported `DocSyncStatus.SyncFailed`. */
  syncFailed: boolean;
}

/**
 * Severity keys on `pending`, not on connectivity.
 *
 * A reader on a flaky connection loses nothing, so they get the muted
 * `reconnecting` and no unload guard. Only outstanding work that is not
 * reaching the server escalates to `not-saved` — the one state that is loud,
 * because it is the one state where closing the tab destroys work.
 *
 * `syncFailed` is deliberately ignored when nothing is pending: a failed
 * *pull* costs the user none of their own edits, and reporting it would be
 * alarm with no consequence behind it. It matters only alongside pending
 * work, where it separates "in flight" from "being rejected" — otherwise a
 * push that keeps failing would sit on `saving` forever, claiming progress
 * that is not happening.
 */
export function deriveSyncState({
  connected,
  pending,
  syncFailed,
}: SyncSignals): SyncState {
  if (!pending) {
    return connected ? 'saved' : 'reconnecting';
  }
  if (!connected || syncFailed) {
    return 'not-saved';
  }
  return 'saving';
}
