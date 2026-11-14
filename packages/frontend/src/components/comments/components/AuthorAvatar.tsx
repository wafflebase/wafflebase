import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { CommentAuthor } from "@/types/comments";
import { avatarInitials } from "@/components/avatar-size";

type Size = "sm" | "md";

interface Props {
  author: CommentAuthor;
  /**
   * `sm` (default) matches the row preview in the side panel; `md` is
   * used by the popover thread card where the avatar carries more
   * weight next to the body text.
   */
  size?: Size;
}

/**
 * Small comment-author avatar with a username-initials fallback.
 * Shared between the popover thread card, the side panel row, and the
 * orphan card so the visual weight stays in sync across surfaces.
 */
export function AuthorAvatar({ author, size = "sm" }: Props) {
  const sizeClass = size === "md" ? "h-5 w-5" : "h-4 w-4";
  // Initials sit at the Micro step (10px), the smallest legible size. Two
  // letters at 10px overrun a 16px circle, so `sm` carries only the first of
  // the shared rule's letters.
  const all = avatarInitials(author.username);
  const initials = size === "md" ? all : Array.from(all)[0];

  return (
    <Avatar className={`${sizeClass} shrink-0`}>
      {author.photo && (
        <AvatarImage src={author.photo} alt={author.username} />
      )}
      <AvatarFallback className="text-2xs">
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}
