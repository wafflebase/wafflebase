import type { ReactNode } from "react";

import { formatRelativeTime } from "@/lib/utils";
import type { Comment } from "@/types/comments";

import { AuthorAvatar } from "./AuthorAvatar";

type Props = {
  /** Snapshot of the original anchored text, captured at thread creation. */
  quotedText: string;
  /** The root (first) comment — shown as the conversation preview. */
  root: Comment;
  /** Number of comments on the thread, including the root. */
  commentCount: number;
  /**
   * Optional trailing slot the parent may use to drop in action buttons
   * (resolve, reopen) inside the card without coupling this view to a
   * specific store API.
   */
  trailing?: ReactNode;
};

/**
 * Side-panel card for an orphan thread — the anchored text has been
 * deleted, so there is no in-doc marker to click. The card preserves
 * the conversation and shows the quoted text as a gray box.
 *
 * Jump-to-anchor is intentionally not offered; the anchor location no
 * longer exists.
 */
export function OrphanedCard({ quotedText, root, commentCount, trailing }: Props) {
  return (
    <article
      className="flex flex-col gap-2 border-b px-4 py-3 last:border-0 opacity-80"
      aria-label="Orphaned comment"
    >
      <div className="flex items-center gap-2">
        <AuthorAvatar author={root.author} />
        <strong className="text-xs font-medium">{root.author.username}</strong>
        <time className="text-xs text-muted-foreground">
          {formatRelativeTime(root.createdAt)}
        </time>
        <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          Orphaned
        </span>
      </div>
      {quotedText && (
        <blockquote className="border-l-2 border-muted-foreground/30 bg-muted/40 px-2 py-1 text-xs italic text-muted-foreground line-clamp-2">
          {quotedText}
        </blockquote>
      )}
      <p className="line-clamp-2 text-xs text-foreground">{root.body}</p>
      {commentCount > 1 && (
        <span className="text-xs text-muted-foreground">
          {commentCount} comments
        </span>
      )}
      {trailing}
    </article>
  );
}

