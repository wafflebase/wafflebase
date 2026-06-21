import { useEffect, useRef, useState } from "react";

import { CommentThreadCard } from "@/components/comments/components/CommentThreadCard";
import type { MentionMember } from "@/components/comments/components/CommentComposer";
import type {
  CommentAuthor,
  DocsRangeAnchor,
  Thread,
} from "@/types/comments";

type Props = {
  thread: Thread<DocsRangeAnchor>;
  anchorRect: { x: number; y: number };
  currentUser?: CommentAuthor;
  readOnly?: boolean;
  members?: MentionMember[];
  onReply: (body: string) => Promise<void> | void;
  onResolveToggle: () => Promise<void> | void;
  onEdit: (commentId: string, body: string) => Promise<void> | void;
  onDelete: (commentId: string) => Promise<void> | void;
  onDismiss: () => void;
};

const POPOVER_WIDTH = 320;
const VIEWPORT_PADDING = 8;
const GAP_FROM_MARKER = 6;

/**
 * Floating popover anchored near a clicked comment marker. Repositions
 * itself horizontally to stay on screen and flips above the marker when
 * there isn't room below.
 */
export function DocsCommentPopover({
  thread,
  anchorRect,
  currentUser,
  readOnly,
  members,
  onReply,
  onResolveToggle,
  onEdit,
  onDelete,
  onDismiss,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Compute position after layout so we know the rendered height.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { innerWidth, innerHeight } = window;
    const height = el.getBoundingClientRect().height;
    let left = anchorRect.x;
    if (left + POPOVER_WIDTH > innerWidth - VIEWPORT_PADDING) {
      left = Math.max(VIEWPORT_PADDING, innerWidth - POPOVER_WIDTH - VIEWPORT_PADDING);
    }
    if (left < VIEWPORT_PADDING) left = VIEWPORT_PADDING;

    let top = anchorRect.y + GAP_FROM_MARKER;
    if (top + height > innerHeight - VIEWPORT_PADDING) {
      top = anchorRect.y - height - GAP_FROM_MARKER;
      if (top < VIEWPORT_PADDING) top = VIEWPORT_PADDING;
    }
    setPos({ left, top });
  }, [anchorRect.x, anchorRect.y, thread]);

  // Dismiss on Escape; click-outside is owned by the parent.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Comment thread"
      data-comments-overlay=""
      className="fixed z-50 rounded-md border bg-popover text-popover-foreground shadow-lg"
      style={{
        width: POPOVER_WIDTH,
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        visibility: pos ? "visible" : "hidden",
      }}
      onMouseDown={(e) => {
        // Stop the popover's own mousedown from reaching the text
        // editor under the canvas (would clear the active selection).
        // The container's native click listener that drives marker
        // hit-testing is filtered by data-comments-overlay above, not
        // by React-level stopPropagation here — native bubbling runs
        // before React's synthetic dispatch.
        e.stopPropagation();
      }}
    >
      <div className="px-4 py-4">
        <CommentThreadCard
          thread={thread}
          currentUserId={currentUser?.userId}
          readOnly={readOnly}
          autoFocusReply
          members={members}
          onReply={onReply}
          onResolveToggle={onResolveToggle}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}
