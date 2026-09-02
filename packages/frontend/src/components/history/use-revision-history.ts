import { useCallback, useEffect, useState } from 'react';
import { useRevisions } from '@yorkie-js/react';
import { groupRevisions, type TimelineDay } from './group-revisions';
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

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const revisions = await listRevisions({ pageSize: REVISION_LIST_LIMIT });
      setDays(groupRevisions(revisions));
      setError(null);
    } catch (err) {
      // Leave `days` untouched: an empty timeline and a failed load are
      // different things and must not look the same.
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setIsLoading(false);
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
      // Safety first, and deliberately un-caught: if the current state cannot
      // be preserved, the restore must not happen.
      await createRevision(SAFETY_LABEL, writeRevisionMeta('safety', userId));
      await restoreRevision(revisionId);
      onRestored?.();
      await refresh();
    },
    [createRevision, onRestored, refresh, restoreRevision, userId],
  );

  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh]);

  return { days, isLoading, error, refresh, nameCurrentVersion, restore };
}
