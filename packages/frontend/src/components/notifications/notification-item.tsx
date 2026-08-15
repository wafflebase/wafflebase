import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { Notification } from "@/api/notifications";
import { formatRelativeTime } from "@/app/documents/document-list-utils";
import { notificationHref, notificationSentence } from "./notification-text";

interface Props {
  notification: Notification;
  onSelect: (notification: Notification) => void;
}

/**
 * One row in the dropdown: actor avatar, what happened, the comment excerpt,
 * and when. Unread rows carry a dot and a tinted background.
 */
export function NotificationItem({ notification, onSelect }: Props) {
  const unread = !notification.readAt;
  const actor = notification.actor;
  const navigable = notificationHref(notification) !== null;

  return (
    <button
      type="button"
      onClick={() => onSelect(notification)}
      className={`flex w-full gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none ${
        unread ? "bg-accent/40" : ""
      } ${navigable ? "" : "cursor-default"}`}
    >
      <Avatar className="mt-0.5 h-6 w-6 shrink-0">
        {actor?.photo && (
          <AvatarImage src={actor.photo} alt={actor.username} />
        )}
        <AvatarFallback className="text-[9px]">
          {(actor?.username ?? "?").slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug">
          {notificationSentence(notification)}
        </p>
        {notification.preview && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {notification.preview}
          </p>
        )}
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {formatRelativeTime(notification.createdAt)}
        </p>
      </div>

      {unread && (
        <span
          aria-label="Unread"
          className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary"
        />
      )}
    </button>
  );
}
