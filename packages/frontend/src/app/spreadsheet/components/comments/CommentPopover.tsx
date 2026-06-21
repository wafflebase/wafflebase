import { useEffect, useRef } from "react";

import {
  CommentComposer,
  type MentionMember,
} from "@/components/comments/components/CommentComposer";
import { CommentThreadCard } from "@/components/comments/components/CommentThreadCard";
import type { CommentAuthor } from "@/types/comments";
import type { Thread } from "@wafflebase/sheets";

type Props = {
  threads: Thread[];
  currentUser: CommentAuthor | null;
  members?: MentionMember[];
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
 * Popover listing all open threads on the active cell, with the
 * empty-state composer to start a new one. The per-thread layout
 * (header avatar, hover-reveal Edit/Delete, indented replies,
 * always-visible reply composer) is delegated to the shared
 * `CommentThreadCard` so docs and sheets render the same card. Only
 * the outer multi-thread scaffold and the cell-anchored dismiss
 * behavior live here.
 */
export function CommentPopover({
  threads,
  currentUser,
  members,
  onAddThread,
  onReply,
  onResolve,
  onEditComment,
  onDeleteComment,
  onClose,
}: Props) {
  const isReadOnly = currentUser === null;
  const popoverRef = useRef<HTMLDivElement>(null);

  // Dismiss on outside click. Skip clicks inside Radix portals (dropdown
  // menus, tooltips, etc.) so picking Edit / Delete from the "more"
  // menu doesn't unmount the popover before the item runs.
  useEffect(() => {
    function handler(e: MouseEvent) {
      const target = e.target as Element | null;
      if (!target) return;
      if (popoverRef.current?.contains(target)) return;
      if (
        target.closest('[role="menu"]') ||
        target.closest('[role="dialog"]') ||
        target.closest('[data-radix-popper-content-wrapper]')
      ) {
        return;
      }
      onClose();
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      ref={popoverRef}
      className="flex w-80 flex-col gap-3 rounded-lg border bg-background p-4 shadow-lg"
      role="dialog"
      aria-label="Comments"
    >
      {threads.map((thread, threadIdx) => (
        <div
          key={thread.id}
          className="first:pt-0 [&:not(:first-child)]:border-t [&:not(:first-child)]:pt-3"
        >
          <CommentThreadCard
            thread={thread}
            currentUserId={currentUser?.userId}
            readOnly={isReadOnly}
            autoFocusReply={threadIdx === 0}
            members={members}
            onReply={(body) => onReply(thread.id, body)}
            onResolveToggle={() => onResolve(thread.id)}
            onEdit={(commentId, body) => onEditComment(thread.id, commentId, body)}
            onDelete={(commentId) => onDeleteComment(thread.id, commentId)}
          />
        </div>
      ))}

      {threads.length === 0 && !isReadOnly && (
        <CommentComposer
          submitLabel="Comment"
          onSubmit={(body) => onAddThread(body)}
          autoFocus
          members={members}
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
