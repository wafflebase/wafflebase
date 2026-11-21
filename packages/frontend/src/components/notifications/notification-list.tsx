import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import type { Notification } from "@/api/notifications";
import { NotificationItem } from "./notification-item";
import { notificationHref } from "./notification-text";
import {
  useMarkRead,
  useNotifications,
  useUnreadCount,
} from "./use-notifications";

interface Props {
  /** Close the popover once a row navigates away. */
  onNavigate: () => void;
}

/**
 * The dropdown body: header with "Mark all read" (only while something is
 * unread), then the rows, then "Load more" while older pages remain.
 * Selecting a row marks just that one read and navigates if it has a
 * destination — which `notificationHref` decides from the type, not from the
 * rows it carries.
 */
export function NotificationList({ onNavigate }: Props) {
  const navigate = useNavigate();
  const {
    data,
    isLoading,
    isError,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
  } = useNotifications(true);
  // The badge's query — already mounted by the bell, so this reads its cache.
  const { data: unreadCount = 0 } = useUnreadCount(true);
  const markRead = useMarkRead();

  const notifications = data?.pages.flat();
  // Keyed on the badge, not the loaded rows: with more recent read rows than
  // one page holds, every unread row sits on a page not yet fetched, and an
  // action gated on the visible rows left a badge nothing could clear.
  const hasUnread =
    unreadCount > 0 || (notifications?.some((n) => !n.readAt) ?? false);

  function handleSelect(notification: Notification) {
    if (!notification.readAt) markRead.mutate([notification.id]);
    const href = notificationHref(notification);
    if (!href) return;
    onNavigate();
    void navigate(href);
  }

  return (
    <div className="flex max-h-[26rem] w-80 flex-col">
      {/* A fixed height, so the row does not shrink when the action leaves —
          and `shrink-0`, or an overflowing list squeezes it below `h-11`. */}
      <div className="flex h-11 shrink-0 items-center justify-between border-b px-3">
        <span className="text-sm font-medium">Notifications</span>
        {/* Absent rather than disabled when there is nothing to mark: a
            greyed-out action in an empty inbox reads as broken, and an
            explicit "nothing to do" is what "You are all caught up" says. */}
        {hasUnread && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={markRead.isPending}
            onClick={() => markRead.mutate(undefined)}
          >
            Mark all read
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            Loading…
          </p>
        )}
        {/* Only before any page arrived: a failed "Load more" also sets
            `isError`, and that is reported on its own button instead. */}
        {isError && !data && (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            Couldn't load notifications.
          </p>
        )}
        {!isLoading && !isError && notifications?.length === 0 && (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            You are all caught up.
          </p>
        )}
        {notifications?.map((notification) => (
          <NotificationItem
            key={notification.id}
            notification={notification}
            onSelect={handleSelect}
          />
        ))}
        {/* An explicit button rather than scroll-triggered loading: the list
            sits in a 26rem popover, and a page arriving under the pointer
            mid-scroll would move the row about to be clicked. */}
        {hasNextPage && (
          <div className="border-t p-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-full text-xs text-muted-foreground"
              disabled={isFetchingNextPage}
              onClick={() => void fetchNextPage()}
            >
              {isFetchingNextPage
                ? "Loading…"
                : isFetchNextPageError
                  ? "Couldn't load more. Try again"
                  : "Load more"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
