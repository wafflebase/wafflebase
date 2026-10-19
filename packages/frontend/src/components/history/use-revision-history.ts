import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRevisions, type RevisionSummary } from '@yorkie-js/react';
import { groupRevisions, type TimelineDay } from './group-revisions';
import { beginRestore, endRestore } from './restore-lock';
import { writeRevisionMeta } from './revision-meta';

/**
 * How many revisions one page of the timeline holds. This is a page size,
 * not a cap: `loadMore` asks for the next page at an offset and the panel
 * offers "Load older versions" for as long as more exist. It still bounds
 * the *first* read, which matters because storage is unbounded upstream
 * (one snapshot per 500 changes, forever, with no delete RPC).
 */
const REVISION_PAGE_SIZE = 50;

const SAFETY_LABEL = 'Before restore';

/**
 * Append `next` to `prev`, dropping anything already listed.
 *
 * Offsets are resolved against the server's list as it stands when the
 * request lands, so a revision created between two page loads shifts every
 * later offset by one and the entry at the boundary comes back twice. The id
 * is what identifies a revision across those shifts — which also means a
 * page can contribute fewer than `REVISION_PAGE_SIZE` new entries without
 * meaning the history ended.
 */
function appendUnseen(
  prev: Array<RevisionSummary>,
  next: ReadonlyArray<RevisionSummary>,
): Array<RevisionSummary> {
  const seen = new Set(prev.map((r) => r.id));
  const fresh: Array<RevisionSummary> = [];
  for (const revision of next) {
    if (seen.has(revision.id)) continue;
    seen.add(revision.id);
    fresh.push(revision);
  }
  return fresh.length ? [...prev, ...fresh] : prev;
}

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
  const [revisions, setRevisions] = useState<Array<RevisionSummary>>([]);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const days: TimelineDay[] = useMemo(
    () => groupRevisions(revisions),
    [revisions],
  );

  /**
   * The most recently *started* `refresh`. Nothing serializes these calls —
   * the mount effect and the refresh `nameCurrentVersion` triggers can be in
   * flight at once — so without this an older `listRevisions` that resolves
   * last would overwrite the newer timeline, and the version just named
   * would vanish from the panel until something refreshed it again.
   *
   * `loadMore` reads it too: its offset describes the list it started from,
   * so a refresh that lands in between invalidates the append.
   */
  const generation = useRef(0);

  /** Refuses a second `loadMore` while one is in flight — see below. */
  const loadMoreInFlight = useRef(false);

  /**
   * One page, plus one entry we never show. `listRevisions` reports neither a
   * total nor a "more exist" flag, so asking for `pageSize + 1` and seeing
   * whether it comes back is the only way to know whether to offer the
   * button — and it costs one extra row rather than a second round trip.
   */
  const fetchPage = useCallback(
    async (offset: number) => {
      const page = await listRevisions({
        pageSize: REVISION_PAGE_SIZE + 1,
        offset,
      });
      return {
        page: page.slice(0, REVISION_PAGE_SIZE),
        more: page.length > REVISION_PAGE_SIZE,
      };
    },
    [listRevisions],
  );

  const refresh = useCallback(async () => {
    const mine = ++generation.current;
    setIsLoading(true);
    try {
      // Back to the first page: the list may have changed under every offset
      // the user had already paged past, so re-reading from 0 is the only
      // answer that is certainly consistent with itself.
      const { page, more } = await fetchPage(0);
      if (mine !== generation.current) return;
      setRevisions(page);
      setHasMore(more);
      setError(null);
    } catch (err) {
      // Leave the timeline untouched: an empty timeline and a failed load are
      // different things and must not look the same.
      if (mine !== generation.current) return;
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      // `finally` runs on the stale returns above too, so guard it as well:
      // a superseded request must not clear the spinner a live one owns.
      if (mine === generation.current) setIsLoading(false);
    }
  }, [fetchPage]);

  /**
   * Append the next page of older revisions.
   *
   * Rejects on failure rather than setting `error`, because `error` hides the
   * whole timeline: the pages already loaded are still good, and only the
   * attempt to extend them failed. The panel reports it beside the button,
   * the way it already reports a failed name or restore.
   */
  const loadMore = useCallback(async () => {
    // A second click at the same offset would ask for the page already being
    // fetched; deduping would drop all of it and the button would look dead.
    if (loadMoreInFlight.current) return;
    const mine = generation.current;
    loadMoreInFlight.current = true;
    setIsLoadingMore(true);
    try {
      const { page, more } = await fetchPage(revisions.length);
      // A refresh started after this request reset the timeline to its first
      // page, so this response describes a list that is no longer on screen.
      if (mine !== generation.current) return;
      setRevisions((prev) => appendUnseen(prev, page));
      setHasMore(more);
    } finally {
      loadMoreInFlight.current = false;
      setIsLoadingMore(false);
    }
  }, [fetchPage, revisions.length]);

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

  return {
    days,
    hasMore,
    isLoading,
    isLoadingMore,
    error,
    refresh,
    loadMore,
    nameCurrentVersion,
    restore,
  };
}
