import * as React from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export type AvatarStackUser = {
  key: string;
  username: string;
  photo?: string;
  borderColor?: string;
};

type AvatarStackProps = {
  users: AvatarStackUser[];
  /** Pixel size of each avatar. Defaults to 24 (compact). */
  size?: 24 | 32;
  maxVisible?: number;
  /** Render trigger around each avatar. Defaults to a non-interactive span. */
  renderAvatar?: (user: AvatarStackUser, avatar: React.ReactNode) => React.ReactNode;
  /** Render an overflow indicator for users beyond maxVisible. */
  renderOverflow?: (overflow: AvatarStackUser[]) => React.ReactNode;
  className?: string;
};

const SIZE_CLASS = {
  24: "h-6 w-6",
  32: "h-8 w-8",
} as const;

const INITIALS_CLASS = {
  24: "text-[10px]",
  32: "text-xs",
} as const;

/**
 * Overlapping avatar row primitive used by both the documents-list
 * "currently editing" indicator and the in-document `UserPresence` peer
 * list. Callers customize the trigger wrapper and the overflow renderer.
 */
export function AvatarStack({
  users,
  size = 24,
  maxVisible = 3,
  renderAvatar,
  renderOverflow,
  className,
}: AvatarStackProps) {
  if (users.length === 0) return null;
  const visible = users.slice(0, maxVisible);
  const overflow = users.slice(maxVisible);
  const sizeClass = SIZE_CLASS[size];
  const initialsClass = INITIALS_CLASS[size];

  return (
    <div className={`flex items-center -space-x-1.5 ${className ?? ""}`}>
      {visible.map((user) => {
        const avatar = (
          <Avatar
            className={`${sizeClass} border-2 border-background`}
            style={user.borderColor ? { borderColor: user.borderColor } : undefined}
          >
            {user.photo && <AvatarImage src={user.photo} alt={user.username} />}
            <AvatarFallback className={initialsClass}>
              {user.username.slice(0, 2).toUpperCase() || "??"}
            </AvatarFallback>
          </Avatar>
        );
        return (
          <React.Fragment key={user.key}>
            {renderAvatar ? renderAvatar(user, avatar) : avatar}
          </React.Fragment>
        );
      })}
      {overflow.length > 0 &&
        (renderOverflow ? (
          renderOverflow(overflow)
        ) : (
          <span
            className={`inline-flex ${sizeClass} min-w-[1.5rem] items-center justify-center rounded-full border-2 border-background bg-muted px-1 ${initialsClass} font-medium`}
          >
            +{overflow.length}
          </span>
        ))}
    </div>
  );
}
