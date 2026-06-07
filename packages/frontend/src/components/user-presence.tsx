import { useDocument, usePresences } from "@yorkie-js/react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
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
import { AvatarStack, AvatarStackUser } from "@/components/avatar-stack";

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

type PresenceUser = AvatarStackUser & {
  clientID: string;
  isCurrentUser: boolean;
};

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
  const users: PresenceUser[] = presences
    .map((presenceData) => {
      const username = ((presenceData.presence?.username as string) || "").trim();
      const photo = presenceData.presence?.photo as string | undefined;
      const isCurrentUser = presenceData.clientID === currentClientID;

      return {
        key: presenceData.clientID,
        clientID: presenceData.clientID,
        username: username || "Anonymous",
        photo,
        isCurrentUser,
        borderColor: isCurrentUser
          ? undefined
          : getPeerCursorColor(resolvedTheme, presenceData.clientID),
      };
    })
    .filter((user) => user.username.length > 0);

  const MAX_VISIBLE = 4;
  const totalUsers = users.length;

  const resolveHint = (clientID: string, isCurrentUser: boolean) =>
    !isCurrentUser && getJumpHint ? getJumpHint(clientID) : undefined;

  const renderAvatarTrigger = (
    user: PresenceUser,
    avatar: React.ReactNode,
  ) => {
    const hint = resolveHint(user.clientID, user.isCurrentUser);
    const canJump = !!onSelectPeer && hint !== undefined && !user.isCurrentUser;

    return (
      <Tooltip>
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
            {avatar}
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
        <AvatarStack
          users={users}
          size={32}
          maxVisible={MAX_VISIBLE}
          renderAvatar={(user, avatar) =>
            renderAvatarTrigger(user as PresenceUser, avatar)
          }
          renderOverflow={(overflow) => (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-2 border-background bg-muted text-xs font-medium"
                  aria-label={`${overflow.length} more users`}
                >
                  +{overflow.length}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>More users</DropdownMenuLabel>
                {overflow.map((overflowUser) => {
                  const user = overflowUser as PresenceUser;
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
                        style={{ borderColor: user.borderColor }}
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
        />
      ) : (
        <div className="w-32 opacity-0" />
      )}
    </div>
  );
}
