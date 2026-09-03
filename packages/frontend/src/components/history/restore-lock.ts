import { useSyncExternalStore } from 'react';

/**
 * A single in-flight restore, shared by every version-history surface on the
 * page.
 *
 * A restore is two RPCs — a safety revision, then `restoreRevision` — and two
 * of those sequences interleaved leave the document at whichever
 * `restoreRevision` landed last, not the version the user picked, with the
 * second safety revision recording a state that was never current.
 *
 * There are two entry points that can start one, and they are simultaneously
 * live: `HistoryPanel`'s list rows, and `RevisionPreviewOverlay`'s banner
 * button. The panel deliberately stays mounted and interactive while a
 * preview is open, so a user can switch versions from the list — every editor
 * renders it on `historyOpen`, independent of `previewRevisionId`. Each owns
 * its own `useRevisionHistory` instance, so component-local state cannot
 * serialize the pair: a guard inside either one is invisible to the other.
 *
 * The lock therefore lives in the module, not in a component or a provider.
 * That is safe **because exactly one document is open per page** — every
 * editor route mounts a single document, so "the module's restore" and "this
 * document's restore" are the same thing. What would break it: mounting two
 * documents at once (a split view, a multi-document workspace shell, or a
 * test rendering two editors side by side). At that point this must become a
 * per-document lock — key it on the Yorkie doc key — or a context provider
 * threaded from each editor; a module global would then let one document's
 * restore block an unrelated document's.
 *
 * `beginRestore` is what actually refuses the second call. The
 * `useRestoreInProgress` subscription only drives the disabled state, and a
 * handler captured before that re-render would still read the stale `false`.
 */
let inFlight = false;

const listeners = new Set<() => void>();

/**
 * Claims the lock. Returns `false` when a restore is already running, in
 * which case the caller must not proceed and must not release.
 */
export function beginRestore(): boolean {
  if (inFlight) return false;
  inFlight = true;
  emit();
  return true;
}

/** Releases the lock. Safe to call only after a successful `beginRestore`. */
export function endRestore(): void {
  if (!inFlight) return;
  inFlight = false;
  emit();
}

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): boolean {
  return inFlight;
}

/**
 * True while any surface on the page has a restore in flight. Both entry
 * points read this so each reflects a restore the other started.
 */
export function useRestoreInProgress(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
