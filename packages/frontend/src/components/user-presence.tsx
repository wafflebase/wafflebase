import { useDocument, usePresences } from "@yorkie-js/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getPeerCursorColor } from "@wafflebase/sheets";
import { useTheme } from "@/components/theme-provider";

interface UserPresenceProps {
  className?: string;
  /**
   * Invoked when a peer avatar is clicked. Avatars are non-clickable
   * when this callback is omitted.
   */
  onSelectPeer?: (clientID: string) => void;
  /**
   * Returns a hint string describing where the click will jump to,
   * or undefined if the peer is not jumpable. Used both to gate the
   * click affordance and to populate the tooltip text.
   */
  getJumpHint?: (clientID: string) => string | undefined;
}

/**
 * Renders the UserPresence component.
 */
export function UserPresence({
  className,
  onSelectPeer,
  getJumpHint,
}: UserPresenceProps) {
  const { doc } = useDocument<Record<string, unknown>, Record<string, unknown>>();
  const presences = usePresences<Record<string, unknown>>();
  const { resolvedTheme } = useTheme();
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
      const isCurrentUser = presenceData.clientID === currentClientID;

      return {
        clientID: presenceData.clientID,
        username: username || "Anonymous",
        photo,
        isCurrentUser,
      };
    })
    .filter((user) => user.username.length > 0);

  const visibleCount = 4;
  const visibleUsers = users.slice(0, visibleCount);
  const hiddenUsers = users.slice(visibleCount);
  const totalUsers = users.length;

  const resolveHint = (clientID: string, isCurrentUser: boolean) =>
    !isCurrentUser && getJumpHint ? getJumpHint(clientID) : undefined;

  const renderAvatar = (user: (typeof users)[number]) => {
    const hint = resolveHint(user.clientID, user.isCurrentUser);
    const canJump = !!onSelectPeer && hint !== undefined && !user.isCurrentUser;

    return (
      <Tooltip key={user.clientID}>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="relative cursor-pointer rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default"
            onClick={() => {
              if (!canJump || !onSelectPeer) return;
              onSelectPeer(user.clientID);
            }}
            disabled={!canJump}
          >
            <Avatar
              className="h-8 w-8 border-2 bg-background"
              style={{
                borderColor: user.isCurrentUser
                  ? undefined
                  : getPeerCursorColor(resolvedTheme, user.clientID),
              }}
            >
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
          {canJump && hint && <p>Click to jump to {hint}</p>}
        </TooltipContent>
      </Tooltip>
    );
  };

  return (
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
                    className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-2 border-background bg-muted text-xs font-medium"
                    aria-label={`${hiddenUsers.length} more users`}
                  >
                    +{hiddenUsers.length}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>More users</DropdownMenuLabel>
                  {hiddenUsers.map((user) => {
                    const hint = resolveHint(user.clientID, user.isCurrentUser);
                    const canJump =
                      !!onSelectPeer && hint !== undefined && !user.isCurrentUser;
                    return (
                      <DropdownMenuItem
                        key={user.clientID}
                        className={canJump ? "cursor-pointer" : undefined}
                        onSelect={() => {
                          if (!canJump || !onSelectPeer) return;
                          onSelectPeer(user.clientID);
                        }}
                      >
                        <Avatar
                          className="h-6 w-6 border-2"
                          style={{
                            borderColor: user.isCurrentUser
                              ? undefined
                              : getPeerCursorColor(resolvedTheme, user.clientID),
                          }}
                        >
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
                          {hint && (
                            <p className="truncate text-xs text-muted-foreground">
                              {canJump ? `Jump: ${hint}` : hint}
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
  );
}
