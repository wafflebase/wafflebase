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
  /**
   * Unpushed edits exist, are not reaching the server, **and are on this
   * device's disk**. Muted rather than loud: the work survives the tab.
   */
  | 'saved-locally'
  /** Unpushed edits exist and are not currently reaching the server. */
  | 'not-saved';

/**
 * Why local durability does not apply right now.
 *
 * Every value collapses to the same chip state and differs only in what the
 * tooltip says, so the user always learns *that* the guarantee has lapsed even
 * when the cause is one we did not anticipate — a failure the store cannot
 * classify still flips `durable`, because the default is to under-promise.
 */
export type DurabilityLapse =
  /** Not turned on for this device. The one row that is a call to action. */
  | 'not-enabled'
  /** Another tab holds this document's election and is the one saving. */
  | 'other-tab'
  /** No usable local storage at all (private browsing, disabled storage). */
  | 'unavailable'
  /** The SDK latched persistence off for this document: too large or too slow. */
  | 'too-large'
  /** Out of room even after eviction. */
  | 'out-of-space'
  /** Writes are failing for a reason we could not classify. */
  | 'failing';

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
  /**
   * Unpushed work is on this device's disk and will survive the tab.
   *
   * The conjunction of three facts: this tab won the app lock, no
   * `PersistDisabled` event has latched this document off, and the store is not
   * failing its writes. Absent — which is what every non-persisting caller
   * passes — it is false, so nothing about the existing states changes.
   */
  durable?: boolean;
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
  durable = false,
}: SyncSignals): SyncState {
  if (!pending) {
    return connected ? 'saved' : 'reconnecting';
  }
  if (!connected || syncFailed) {
    // The one row this feature changes, and the entire user-facing value of
    // it: the same situation drops from destructive to muted when the pending
    // work is on disk. Severity keys on where the edits actually are, which is
    // the same principle that put `pending` rather than connectivity at the
    // centre of this function — and the same one Google Docs applies.
    //
    // Deliberately not restricted to the disconnected case. A push that keeps
    // being rejected while connected leaves the work exactly as unsent, and
    // exactly as safe on disk.
    return durable ? 'saved-locally' : 'not-saved';
  }
  return 'saving';
}
