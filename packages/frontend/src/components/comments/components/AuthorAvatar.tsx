import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { CommentAuthor } from "@/types/comments";

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
 * Small comment-author avatar with two-letter username fallback.
 * Shared between the popover thread card, the side panel row, and the
 * orphan card so the visual weight stays in sync across surfaces.
 */
export function AuthorAvatar({ author, size = "sm" }: Props) {
  const sizeClass = size === "md" ? "h-5 w-5" : "h-4 w-4";
  const fallbackClass = size === "md" ? "text-[9px]" : "text-[8px]";

  return (
    <Avatar className={`${sizeClass} shrink-0`}>
      {author.photo && (
        <AvatarImage src={author.photo} alt={author.username} />
      )}
      <AvatarFallback className={fallbackClass}>
        {author.username.slice(0, 2).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}
