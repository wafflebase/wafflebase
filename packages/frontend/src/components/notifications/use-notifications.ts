import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchNotifications,
  fetchUnreadCount,
  markNotificationsRead,
  type Notification,
} from "@/api/notifications";

export const NOTIFICATIONS_KEY = ["notifications"] as const;
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
export function useUnreadCount() {
  return useQuery<number>({
    queryKey: UNREAD_COUNT_KEY,
    queryFn: fetchUnreadCount,
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
      queryClient.setQueryData<Notification[]>(NOTIFICATIONS_KEY, (prev) =>
        prev?.map((n) =>
          n.readAt || (ids && !ids.includes(n.id)) ? n : { ...n, readAt },
        ),
      );
      // Recount from the patched list rather than decrementing: it stays
      // correct whether one id or the whole inbox was marked.
      const list = queryClient.getQueryData<Notification[]>(NOTIFICATIONS_KEY);
      if (!ids) {
        queryClient.setQueryData(UNREAD_COUNT_KEY, 0);
      } else if (list) {
        queryClient.setQueryData(
          UNREAD_COUNT_KEY,
          list.filter((n) => !n.readAt).length,
        );
      }
    },
  });
}
