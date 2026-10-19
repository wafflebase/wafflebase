import { useSyncExternalStore } from 'react';

/**
 * Which revision's snapshot is currently being fetched for a preview, shared
 * by every version-history surface on the page.
 *
 * `RevisionPreview` is the only thing that knows a `getRevision` is in
 * flight, but `HistoryPanel` is where the user clicked — and the two are
 * *siblings*, mounted independently by each of the five editors (every one
 * renders the panel on `historyOpen` and the overlay on
 * `previewRevisionId`), with no common owner below the editor itself. So
 * marking the clicked row as loading has no prop path that does not run
 * through all five detail components, and each surface owns its own
 * `useRevisionHistory` instance besides.
 *
 * That is the same shape as the problem `restore-lock.ts` solves, so this is
 * the same answer: a module-level value with a `useSyncExternalStore`
 * subscription. It carries the same caveat — safe **because exactly one
 * document is open per page**. A split view or a multi-document shell (or a
 * test rendering two editors side by side) would need this keyed on the
 * Yorkie doc key, or threaded from each editor as context; a module global
 * would otherwise let one document's preview spin a row in another's panel.
 *
 * Unlike the restore lock this refuses nothing: two previews cannot run at
 * once anyway (there is one overlay), so it is a notification channel, not a
 * mutex.
 */
let loadingRevisionId: string | null = null;

const listeners = new Set<() => void>();

/**
 * Announces that `revisionId`'s snapshot is being fetched, or — with `null` —
 * that no fetch is outstanding. Called from the preview's own load effect,
 * including its cleanup, so an overlay that unmounts mid-flight leaves no row
 * spinning.
 */
export function setPreviewLoadingId(revisionId: string | null): void {
  if (loadingRevisionId === revisionId) return;
  loadingRevisionId = revisionId;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): string | null {
  return loadingRevisionId;
}

/**
 * The id of the revision whose snapshot is being fetched, or `null`. Read by
 * `HistoryPanel` so the row the user clicked reflects a load started in the
 * overlay beside it.
 */
export function usePreviewLoadingId(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
