import { useCallback, useEffect, useRef, useState } from 'react';
import { useRevisions } from '@yorkie-js/react';
import { groupRevisions, type TimelineDay } from './group-revisions';
import { beginRestore, endRestore } from './restore-lock';
import { writeRevisionMeta } from './revision-meta';

/**
 * The hard cap on what the panel can show. There is no paging: no offset is
 * tracked, no `loadMore` is exposed, and `listRevisions` reports no
 * "more exist" signal, so a document with more than this many revisions
 * silently shows only its most recent 50 and the older ones are not
 * reachable from the UI at all. Storage is unbounded upstream (one snapshot
 * per 500 changes, forever, with no delete RPC), so this cap is doing real
 * work and the truncation it causes is a known gap, tracked in
 * `docs/design/revision-history.md` §8 — not a placeholder for paging that
 * exists somewhere else.
 */
const REVISION_LIST_LIMIT = 50;

const SAFETY_LABEL = 'Before restore';

export function useRevisionHistory({
  enabled,
  userId,
  onRestored,
}: {
  enabled: boolean;
  userId: number;
  /**
   * Called after a successful restore. A restore replaces the whole root, so
   * the editor must drop its undo stack, selection and caret: they describe a
   * document that no longer exists.
   */
  onRestored?: () => void;
}) {
  const { listRevisions, createRevision, restoreRevision } = useRevisions();
  const [days, setDays] = useState<TimelineDay[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  /**
   * The most recently *started* `refresh`. Nothing serializes these calls —
   * the mount effect and the refresh `nameCurrentVersion` triggers can be in
   * flight at once — so without this an older `listRevisions` that resolves
   * last would overwrite the newer timeline, and the version just named
   * would vanish from the panel until something refreshed it again.
   */
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++generation.current;
    setIsLoading(true);
    try {
      const revisions = await listRevisions({ pageSize: REVISION_LIST_LIMIT });
      if (mine !== generation.current) return;
      setDays(groupRevisions(revisions));
      setError(null);
    } catch (err) {
      // Leave `days` untouched: an empty timeline and a failed load are
      // different things and must not look the same.
      if (mine !== generation.current) return;
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      // `finally` runs on the stale returns above too, so guard it as well:
      // a superseded request must not clear the spinner a live one owns.
      if (mine === generation.current) setIsLoading(false);
    }
  }, [listRevisions]);

  const nameCurrentVersion = useCallback(
    async (label: string) => {
      await createRevision(label, writeRevisionMeta('named', userId));
      await refresh();
    },
    [createRevision, refresh, userId],
  );

  const restore = useCallback(
    async (revisionId: string) => {
      // Every restore in the app funnels through here — the panel's list rows
      // and the preview banner both call this — so this is the one place that
      // can serialize the two entry points, which own separate hook instances
      // and separate `isRestoring` state. See `restore-lock.ts` for why the
      // lock is a module global and what would invalidate that.
      //
      // Refused rather than queued: the second restore was chosen against a
      // document the first one is about to replace, so running it afterwards
      // would apply a choice the user never made about the state it lands on.
      // It throws instead of returning quietly so the caller reports it —
      // both entry points already render whatever `restore` rejects with, and
      // a silent resolve would let the preview close as if it had worked.
      if (!beginRestore()) {
        throw new Error('A restore is already in progress.');
      }
      try {
        // Safety first, and deliberately un-caught: if the current state
        // cannot be preserved, the restore must not happen.
        await createRevision(SAFETY_LABEL, writeRevisionMeta('safety', userId));
        await restoreRevision(revisionId);
        onRestored?.();
        // Only the enabled instance owns a list anyone can see. The preview
        // overlay creates a second, `enabled: false` instance purely for
        // `restore` and never reads its `days`, so refreshing there is a
        // `listRevisions` round-trip whose result is dropped — and it fires
        // at exactly the moment the panel beside it is already re-reading
        // the list via `refreshKey`.
        if (enabled) await refresh();
      } finally {
        endRestore();
      }
    },
    [createRevision, enabled, onRestored, refresh, restoreRevision, userId],
  );

  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh]);

  return { days, isLoading, error, refresh, nameCurrentVersion, restore };
}
