import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { parseSummaryEvent } from "./notification-stream";
import { NOTIFICATIONS_KEY, UNREAD_COUNT_KEY } from "./use-notifications";

/**
 * Subscribe to the badge stream.
 *
 * The stream carries only `{ unreadCount, latestId }`, so this writes the
 * badge straight into the cache and invalidates the list rather than trying
 * to merge a notification it never received. `EventSource` reconnects on its
 * own, and the server sends the current summary on every connect, so a
 * dropped connection self-heals without any retry logic here.
 */
export function useNotificationStream(enabled: boolean) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    const source = new EventSource(
      `${import.meta.env.VITE_BACKEND_API_URL}/notifications/stream`,
      // Cookie auth: the JWT session cookie must ride along.
      { withCredentials: true },
    );

    const onSummary = (event: MessageEvent<string>) => {
      const summary = parseSummaryEvent(event.data);
      if (!summary) return;
      queryClient.setQueryData(UNREAD_COUNT_KEY, summary.unreadCount);
      // The dropdown refetches on open; this only matters when it is already
      // open while a notification arrives.
      void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY });
    };

    source.addEventListener("summary", onSummary as EventListener);
    return () => {
      source.removeEventListener("summary", onSummary as EventListener);
      source.close();
    };
  }, [enabled, queryClient]);
}
