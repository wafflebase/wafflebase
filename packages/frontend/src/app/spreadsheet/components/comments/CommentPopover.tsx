import { useEffect, useRef, useState } from "react";
import { Check, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatRelativeTime } from "@/lib/utils";
import { CommentComposer } from "./CommentComposer";
import type { Thread, CommentAuthor, Comment } from "@wafflebase/sheets";

type Props = {
  threads: Thread[];
  currentUser: CommentAuthor | null;
  onAddThread: (body: string) => Promise<void>;
  onReply: (threadId: string, body: string) => Promise<void>;
  onResolve: (threadId: string) => Promise<void>;
  onEditComment: (
    threadId: string,
    commentId: string,
    body: string,
  ) => Promise<void>;
  onDeleteComment: (threadId: string, commentId: string) => Promise<void>;
  onClose: () => void;
};

/**
 * Popover that lists all open threads on the active cell and provides
 * controls to reply, resolve, edit, and delete comments.
 *
 * Layout decisions (driven by user testing feedback):
 * - No header bar — outside-click and Escape both dismiss, freeing vertical space.
 * - Resolve sits as a small icon button on the root comment header so it stays
 *   discoverable without occupying its own row.
 * - Reply is an always-visible inline textarea; submit button only appears once
 *   the user has typed content.
 * - Composer textarea uses the same `text-xs` size as rendered comment bodies
 *   so editing/display feels seamless.
 */
export function CommentPopover({
  threads,
  currentUser,
  onAddThread,
  onReply,
  onResolve,
  onEditComment,
  onDeleteComment,
  onClose,
}: Props) {
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const isReadOnly = currentUser === null;
  const popoverRef = useRef<HTMLDivElement>(null);

  // Dismiss on outside click. Skip clicks inside Radix portals (dropdown menus,
  // tooltips, etc.) — without this guard, clicking an Edit/Delete menu item
  // unmounts the popover on mousedown before the item's onClick can fire.
  useEffect(() => {
    function handler(e: MouseEvent) {
      const target = e.target as Element | null;
      if (!target) return;
      if (popoverRef.current?.contains(target)) return;
      if (
        target.closest('[role="menu"]') ||
        target.closest('[role="dialog"]') ||
        target.closest("[data-radix-popper-content-wrapper]")
      ) {
        return;
      }
      onClose();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  // Escape closes the popover for keyboard users
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const renderComment = (
    thread: Thread,
    c: Comment,
    isRoot: boolean,
  ) => {
    const canEditOrDelete =
      !isReadOnly &&
      currentUser.userId === c.author.userId &&
      editingCommentId !== c.id;

    return (
      <div key={c.id} className="group flex flex-col gap-1">
        <header className="flex items-center gap-2 text-xs text-muted-foreground">
          <Avatar className="h-5 w-5 shrink-0">
            {c.author.photo && (
              <AvatarImage src={c.author.photo} alt={c.author.username} />
            )}
            <AvatarFallback className="text-[9px]">
              {c.author.username.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <strong className="font-medium text-foreground">
            {c.author.username}
          </strong>
          <time>{formatRelativeTime(c.createdAt)}</time>
          {c.editedAt && <span>(edited)</span>}

          {/* Right-aligned action cluster */}
          <div className="ml-auto flex items-center gap-0.5">
            {/* Resolve only on root */}
            {isRoot && !isReadOnly && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => onResolve(thread.id)}
                aria-label="Resolve thread"
                title="Resolve"
              >
                <Check className="h-3.5 w-3.5" />
              </Button>
            )}

            {/* Edit/Delete behind a "more" menu, hover/focus reveal */}
            {canEditOrDelete && (
              <div className="invisible group-hover:visible group-focus-within:visible">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      aria-label="More actions"
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setEditingCommentId(c.id)}>
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => onDeleteComment(thread.id, c.id)}
                    >
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>
        </header>

        {editingCommentId === c.id ? (
          <CommentComposer
            initialBody={c.body}
            submitLabel="Save"
            onSubmit={async (body) => {
              await onEditComment(thread.id, c.id, body);
              setEditingCommentId(null);
            }}
            onCancel={() => setEditingCommentId(null)}
            autoFocus
          />
        ) : (
          <p className="text-xs whitespace-pre-wrap">{c.body}</p>
        )}
      </div>
    );
  };

  return (
    <div
      ref={popoverRef}
      className="flex w-80 flex-col gap-3 rounded-lg border bg-background p-4 shadow-lg"
      role="dialog"
      aria-label="Comments"
    >
      {threads.map((thread, threadIdx) => {
        const [rootComment, ...replyComments] = thread.comments;

        return (
          <article
            key={thread.id}
            className="flex flex-col gap-2 first:pt-0 [&:not(:first-child)]:border-t [&:not(:first-child)]:pt-3"
          >
            {rootComment && renderComment(thread, rootComment, true)}

            {replyComments.length > 0 && (
              <div className="ml-4 border-l pl-4 flex flex-col gap-2">
                {replyComments.map((c) => renderComment(thread, c, false))}
              </div>
            )}

            {/* Always-visible inline reply composer (compact).
                Auto-focuses the first thread's reply input on popover open
                so explicit "Insert comment" / cell click immediately accepts
                typing without an extra click. */}
            {!isReadOnly && (
              <div className="ml-4 border-l pl-4">
                <CommentComposer
                  submitLabel="Reply"
                  onSubmit={(body) => onReply(thread.id, body)}
                  compact
                  autoFocus={threadIdx === 0}
                />
              </div>
            )}
          </article>
        );
      })}

      {threads.length === 0 && !isReadOnly && (
        <CommentComposer
          submitLabel="Comment"
          onSubmit={(body) => onAddThread(body)}
          autoFocus
        />
      )}

      {isReadOnly && threads.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Sign in to leave a comment.
        </p>
      )}
    </div>
  );
}
