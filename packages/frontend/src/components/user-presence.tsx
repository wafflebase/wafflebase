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
import {
  AVATAR_SIZE_CLASS,
  avatarInitials,
  type AvatarSize,
} from "@/components/avatar-size";

/**
 * One literal for both the drawn stack and the slot held open before it
 * exists, so the two cannot be changed apart.
 *
 * Exported so the test that pins them together reads this rather than
 * restating the size, which would make changing it here a false failure.
 */
export const PRESENCE_AVATAR_SIZE: AvatarSize = 32;

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

/** "hackerwins (you)" for the current user, the bare name for a peer. */
function displayName(user: PresenceUser): string {
  return user.isCurrentUser ? `${user.username} (you)` : user.username;
}

/**
 * The name of the whole stack, so a screen reader landing in it hears who is
 * here before it hears avatars one by one: "Collaborators: alice and 2
 * others". Peers lead, since "you" is never news.
 */
function collaboratorsLabel(users: PresenceUser[]): string {
  const ordered = [
    ...users.filter((user) => !user.isCurrentUser),
    ...users.filter((user) => user.isCurrentUser),
  ];
  const [first, ...rest] = ordered;
  if (!first) return "Collaborators";
  const lead = first.isCurrentUser ? "only you" : first.username;
  if (rest.length === 0) return `Collaborators: ${lead}`;
  const others = rest.length === 1 ? "1 other" : `${rest.length} others`;
  return `Collaborators: ${lead} and ${others}`;
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
  const users: PresenceUser[] = presences
    .map((presenceData) => {
      const username = ((presenceData.presence?.username as string) || "").trim();
      const photo = presenceData.presence?.photo as string | undefined;
      const isCurrentUser = presenceData.clientID === currentClientID;

      return {
        key: presenceData.clientID,
        clientID: presenceData.clientID,
        username,
        photo,
        isCurrentUser,
        borderColor: isCurrentUser
          ? undefined
          : getPeerCursorColor(resolvedTheme, presenceData.clientID),
      };
    })
    // A presence with no username is not a person to draw. It used to be
    // substituted with "Anonymous", which made this filter dead code and
    // reported a phantom participant whenever presence failed to initialize —
    // the visible half of issue #1004, where the signed-in user's own avatar
    // was replaced by a lone "Anonymous (You)". Genuinely anonymous
    // share-link visitors are unaffected: `shared-document.tsx` puts the
    // literal string "Anonymous" in their presence, so they still have a
    // username and still render.
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
            // Without a label the name came from the avatar's contents, which
            // is the initials whenever the photo is missing or still loading
            // — "HA", not a person.
            aria-label={
              canJump && hint
                ? `${displayName(user)}, jump to ${hint}`
                : displayName(user)
            }
            className="relative cursor-pointer rounded-full focus-ring disabled:cursor-default"
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
          <p>{displayName(user)}</p>
          {canJump && hint && <p>Click to jump to {hint}</p>}
        </TooltipContent>
      </Tooltip>
    );
  };

  return (
    <div
      role={totalUsers > 0 ? "group" : undefined}
      aria-label={totalUsers > 0 ? collaboratorsLabel(users) : undefined}
      className={`flex items-center gap-2 min-h-[2.5rem] ${className ?? ""}`}
    >
      {totalUsers > 0 ? (
        <AvatarStack
          users={users}
          size={PRESENCE_AVATAR_SIZE}
          maxVisible={MAX_VISIBLE}
          renderAvatar={(user, avatar) =>
            renderAvatarTrigger(user as PresenceUser, avatar)
          }
          renderOverflow={(overflow) => (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-2 border-background bg-muted text-xs font-medium focus-ring"
                  aria-label={`Show ${overflow.length} more users`}
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
                        <AvatarFallback className="text-2xs">
                          {avatarInitials(user.username)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate">{displayName(user)}</p>
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
        // Empty only until the Yorkie document attaches — after that the list
        // always holds at least this user. This slot lives in the header's
        // right-anchored control cluster, so its width is subtracted from
        // where Share and the other controls sit; reserving more than the
        // attached state needs made every document open jolt them sideways.
        // One avatar is the floor of that state, so reserve exactly that.
        <div
          data-testid="presence-placeholder"
          aria-hidden
          className={`${AVATAR_SIZE_CLASS[PRESENCE_AVATAR_SIZE]} shrink-0`}
        />
      )}
    </div>
  );
}
