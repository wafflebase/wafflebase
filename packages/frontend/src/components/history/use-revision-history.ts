import { useCallback, useEffect, useState } from 'react';
import { useRevisions } from '@yorkie-js/react';
import { groupRevisions, type TimelineDay } from './group-revisions';
import { writeRevisionMeta } from './revision-meta';

/** How many revisions the panel lists. Revision storage is unbounded upstream. */
const PAGE_SIZE = 50;

const SAFETY_LABEL = 'Before restore';

export function useRevisionHistory({
  enabled,
  userId,
}: {
  enabled: boolean;
  userId: number;
}) {
  const { listRevisions, createRevision, restoreRevision } = useRevisions();
  const [days, setDays] = useState<TimelineDay[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const revisions = await listRevisions({ pageSize: PAGE_SIZE });
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
      await refresh();
    },
    [createRevision, refresh, restoreRevision, userId],
  );

  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh]);

  return { days, isLoading, error, refresh, nameCurrentVersion, restore };
}
