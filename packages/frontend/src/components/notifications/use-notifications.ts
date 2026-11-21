import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  fetchNotifications,
  fetchUnreadCount,
  markNotificationsRead,
  NOTIFICATIONS_PAGE_SIZE,
  type Notification,
  type NotificationCursor,
} from "@/api/notifications";
import { applyRead, nextUnreadCount } from "./read-state";

// Siblings, not nested. React Query invalidates by key *prefix*, so a
// `["notifications"]` list key would also invalidate the always-mounted
// unread-count query and refetch it — turning every stream event into the
// HTTP round trip the summary payload exists to avoid.
export const NOTIFICATIONS_KEY = ["notifications", "list"] as const;
export const UNREAD_COUNT_KEY = ["notifications", "unread-count"] as const;

export type NotificationPages = InfiniteData<
  Notification[],
  NotificationCursor | undefined
>;

/**
 * The cursor after `page`, or undefined when it was the last one. A full page
 * may still be the last — the next fetch then returns `[]` and ends paging.
 */
export function nextCursor(
  page: ReadonlyArray<Notification>,
): NotificationCursor | undefined {
  if (page.length < NOTIFICATIONS_PAGE_SIZE) return undefined;
  const last = page[page.length - 1];
  return { before: last.createdAt, beforeId: last.id };
}

/**
 * The dropdown's list, one page at a time. Only fetched while the dropdown is
 * open (`enabled`): the badge rides the SSE stream, so there is no reason to
 * hold a list in memory for a popover nobody has opened.
 *
 * Paged rather than one fixed page because the badge counts *every* unread
 * row: with more recent read rows than fit on a page, the unread ones sat
 * past it, reachable from nowhere.
 */
export function useNotifications(enabled: boolean) {
  return useInfiniteQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: ({ pageParam }) => fetchNotifications(pageParam),
    initialPageParam: undefined as NotificationCursor | undefined,
    getNextPageParam: (lastPage) => nextCursor(lastPage),
    enabled,
    staleTime: 10_000,
  });
}

/**
 * The badge. Fetched once on mount and thereafter written directly by the SSE
 * stream, so the interval here is only a backstop for a stream that never
 * connected at all.
 */
export function useUnreadCount(enabled: boolean) {
  return useQuery<number>({
    queryKey: UNREAD_COUNT_KEY,
    queryFn: fetchUnreadCount,
    enabled,
    refetchInterval: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

/** Mark some (or with no argument, all) notifications read. */
export function useMarkRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ids?: string[]) => markNotificationsRead(ids),
    onSuccess: (_data, ids) => {
      const readAt = new Date().toISOString();
      const before =
        queryClient
          .getQueryData<NotificationPages>(NOTIFICATIONS_KEY)
          ?.pages.flat() ?? [];

      // Every loaded page, not just the first: the row read may be on page 2.
      queryClient.setQueryData<NotificationPages>(NOTIFICATIONS_KEY, (prev) =>
        prev
          ? {
              ...prev,
              pages: prev.pages.map((page) => applyRead(page, ids, readAt)),
            }
          : prev,
      );
      // Optimistic, so the badge responds to the click immediately...
      queryClient.setQueryData<number>(UNREAD_COUNT_KEY, (prev) =>
        nextUnreadCount(prev, before, ids),
      );
      // ...then let an authoritative read settle it. A notification that
      // arrived between the server processing this request and its response
      // resolving has already been written to the cache by the stream, and
      // the line above would erase it until the next poll.
      void queryClient.invalidateQueries({
        queryKey: UNREAD_COUNT_KEY,
        exact: true,
      });
    },
  });
}
