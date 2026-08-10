import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchNotifications,
  fetchUnreadCount,
  markNotificationsRead,
  type Notification,
} from "@/api/notifications";
import { applyRead, nextUnreadCount } from "./read-state";

// Siblings, not nested. React Query invalidates by key *prefix*, so a
// `["notifications"]` list key would also invalidate the always-mounted
// unread-count query and refetch it — turning every stream event into the
// HTTP round trip the summary payload exists to avoid.
export const NOTIFICATIONS_KEY = ["notifications", "list"] as const;
export const UNREAD_COUNT_KEY = ["notifications", "unread-count"] as const;

/**
 * The dropdown's list. Only fetched while the dropdown is open (`enabled`):
 * the badge rides the SSE stream, so there is no reason to hold a list in
 * memory for a popover nobody has opened.
 */
export function useNotifications(enabled: boolean) {
  return useQuery<Notification[]>({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: () => fetchNotifications(),
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
        queryClient.getQueryData<Notification[]>(NOTIFICATIONS_KEY) ?? [];

      queryClient.setQueryData<Notification[]>(NOTIFICATIONS_KEY, (prev) =>
        prev ? applyRead(prev, ids, readAt) : prev,
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
