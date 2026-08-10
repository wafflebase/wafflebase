import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconBell } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { fetchMe } from "@/api/auth";
import { NotificationList } from "./notification-list";
import { useNotificationStream } from "./use-notification-stream";
import { useUnreadCount } from "./use-notifications";

/** Above this the badge stops counting and starts nagging. */
const BADGE_CAP = 99;

/**
 * Header bell with an unread badge. Mounted once in `SiteHeader`, so it
 * appears on the documents list and inside every editor.
 *
 * Renders nothing without a signed-in session — an anonymous share-link
 * viewer has no inbox, and opening an SSE stream for them would only produce
 * a 401 reconnect loop.
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    retry: false,
  });

  const signedIn = Boolean(me);
  useNotificationStream(signedIn);
  const { data: unreadCount = 0 } = useUnreadCount(signedIn);

  if (!signedIn) return null;

  const label =
    unreadCount > 0
      ? `Notifications (${unreadCount} unread)`
      : "Notifications";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-8 w-8 shrink-0"
          aria-label={label}
        >
          <IconBell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium leading-none text-primary-foreground">
              {unreadCount > BADGE_CAP ? `${BADGE_CAP}+` : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <NotificationList onNavigate={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
