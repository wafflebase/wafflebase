import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import type { Notification } from "@/api/notifications";
import { NotificationItem } from "./notification-item";
import { notificationHref } from "./notification-text";
import { useMarkRead, useNotifications } from "./use-notifications";

interface Props {
  /** Close the popover once a row navigates away. */
  onNavigate: () => void;
}

/**
 * The dropdown body: header with "Mark all read", then the rows. Selecting a
 * row marks just that one read and navigates if it points at a document.
 */
export function NotificationList({ onNavigate }: Props) {
  const navigate = useNavigate();
  const { data: notifications, isLoading, isError } = useNotifications(true);
  const markRead = useMarkRead();

  const hasUnread = notifications?.some((n) => !n.readAt) ?? false;

  function handleSelect(notification: Notification) {
    if (!notification.readAt) markRead.mutate([notification.id]);
    const href = notificationHref(notification);
    if (!href) return;
    onNavigate();
    void navigate(href);
  }

  return (
    <div className="flex max-h-[26rem] w-80 flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-sm font-medium">Notifications</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={!hasUnread || markRead.isPending}
          onClick={() => markRead.mutate(undefined)}
        >
          Mark all read
        </Button>
      </div>

      {/* One page, no "load more". `fetchNotifications` takes a cursor and the
          API pages, but the dropdown is the whole surface for now — the seam
          is deliberate, for the deferred /notifications page. */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            Loading…
          </p>
        )}
        {isError && (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            Could not load notifications.
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
      </div>
    </div>
  );
}
