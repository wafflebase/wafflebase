import { useDocument, usePresences } from "@yorkie-js/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserPresence as UserPresenceType } from "@/types/users";

interface UserPresenceProps {
  className?: string;
  onSelectActiveCell?: (
    activeCell: NonNullable<UserPresenceType["activeCell"]>,
    activeTabId?: UserPresenceType["activeTabId"],
  ) => void;
}

/**
 * Renders the UserPresence component.
 */
export function UserPresence({
  className,
  onSelectActiveCell,
}: UserPresenceProps) {
  const { doc } = useDocument<Record<string, unknown>, UserPresenceType>();
  const presences = usePresences<UserPresenceType>();
  const otherClientIDs = new Set(
    doc?.getOthersPresences().map((presence) => presence.clientID) || [],
  );
  const currentClientID = presences.find(
    (presence) => !otherClientIDs.has(presence.clientID),
  )?.clientID;
  const users = presences
    .map((presenceData) => {
      const username = ((presenceData.presence?.username as string) || "").trim();
      const photo = presenceData.presence?.photo as string | undefined;
      const activeCell = presenceData.presence
        ?.activeCell as UserPresenceType["activeCell"] | undefined;
      const activeTabId = presenceData.presence
        ?.activeTabId as UserPresenceType["activeTabId"] | undefined;
      const isCurrentUser = presenceData.clientID === currentClientID;

      return {
        clientID: presenceData.clientID,
        username: username || "Anonymous",
        photo,
        activeCell,
        activeTabId,
        isCurrentUser,
      };
    })
    .filter((user) => user.username.length > 0);

  const visibleCount = 4;
  const visibleUsers = users.slice(0, visibleCount);
  const hiddenUsers = users.slice(visibleCount);
  const totalUsers = users.length;

  const renderAvatar = (user: (typeof users)[number]) => {
    const canJump =
      !!onSelectActiveCell && !!user.activeCell && !user.isCurrentUser;

    return (
      <Tooltip key={user.clientID}>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="relative rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default"
            onClick={() => {
              if (!canJump || !user.activeCell) return;
              onSelectActiveCell(user.activeCell, user.activeTabId);
            }}
            disabled={!canJump}
          >
            <Avatar className="h-8 w-8 border-2 border-background">
              {user.photo && <AvatarImage src={user.photo} alt={user.username} />}
              <AvatarFallback className="text-xs">
                {user.username.slice(0, 2).toUpperCase() || "??"}
              </AvatarFallback>
            </Avatar>
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p>
            {user.username}
            {user.isCurrentUser ? " (You)" : ""}
          </p>
          {canJump && user.activeCell && <p>Click to jump to {user.activeCell}</p>}
        </TooltipContent>
      </Tooltip>
    );
  };

  return (
    <TooltipProvider>
      <div className={`flex items-center gap-2 min-h-[2.5rem] ${className}`}>
        {totalUsers > 0 ? (
          <>
            <div className="flex items-center -space-x-2">
              {visibleUsers.map(renderAvatar)}

              {hiddenUsers.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full border-2 border-background bg-muted text-xs font-medium"
                      aria-label={`${hiddenUsers.length} more users`}
                    >
                      +{hiddenUsers.length}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel>More users</DropdownMenuLabel>
                    {hiddenUsers.map((user) => {
                      const canJump =
                        !!onSelectActiveCell &&
                        !!user.activeCell &&
                        !user.isCurrentUser;
                      return (
                        <DropdownMenuItem
                          key={user.clientID}
                          className={canJump ? "cursor-pointer" : undefined}
                          onSelect={() => {
                            if (!canJump || !user.activeCell) return;
                            onSelectActiveCell(user.activeCell, user.activeTabId);
                          }}
                        >
                          <Avatar className="h-6 w-6">
                            {user.photo && (
                              <AvatarImage src={user.photo} alt={user.username} />
                            )}
                            <AvatarFallback className="text-[10px]">
                              {user.username.slice(0, 2).toUpperCase() || "??"}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <p className="truncate">
                              {user.username}
                              {user.isCurrentUser ? " (You)" : ""}
                            </p>
                            {user.activeCell && (
                              <p className="truncate text-xs text-muted-foreground">
                                {canJump ? `Jump: ${user.activeCell}` : user.activeCell}
                              </p>
                            )}
                          </div>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </>
        ) : (
          <div className="w-32 opacity-0" />
        )}
      </div>
    </TooltipProvider>
  );
}
