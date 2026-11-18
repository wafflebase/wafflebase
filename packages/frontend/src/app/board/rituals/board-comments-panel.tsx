import { IconMessage } from "@tabler/icons-react";

import { HeaderPanelToggle } from "@/components/site-header";
import { CommentSidePanel } from "@/components/comments/components/CommentSidePanel";
import { CommentThreadCard } from "@/components/comments/components/CommentThreadCard";
import { boardAnchorLabel } from "./board-anchor";
import { useBoardCollab } from "./board-collab-hook";

/** Header toggle beside History / Share, like the other editors. */
export function BoardCommentsToggle() {
  const collab = useBoardCollab();
  if (!collab) return null;
  return (
    <HeaderPanelToggle
      icon={IconMessage}
      label="comments"
      pressed={collab.panelOpen}
      onPressedChange={(next) => {
        collab.setPanelOpen(next);
        if (!next) collab.setActiveThreadId(null);
      }}
    />
  );
}

/**
 * The board's comments side panel: the shared `CommentSidePanel` list, or
 * one thread's detail when a pin or row is selected. Rendered by
 * `board-detail.tsx` in the same slot as the history panel.
 */
export function BoardCommentsPanel() {
  const collab = useBoardCollab();
  if (!collab || !collab.panelOpen) return null;
  const {
    threads,
    liveIds,
    activeThreadId,
    setActiveThreadId,
    setPanelOpen,
    user,
    readOnly,
    members,
  } = collab;
  const close = () => {
    setPanelOpen(false);
    setActiveThreadId(null);
  };
  const active = activeThreadId
    ? (threads.find((t) => t.id === activeThreadId) ?? null)
    : null;

  if (!active) {
    return (
      <CommentSidePanel
        threads={threads}
        onJumpTo={(t) => collab.openThread(t)}
        onClose={close}
        renderAnchorLabel={(t) => boardAnchorLabel(t.anchor, liveIds)}
      />
    );
  }

  return (
    <aside
      className="flex h-full w-72 flex-col border-l bg-background"
      aria-label="Comment thread detail"
    >
      <header className="flex items-center justify-between border-b px-4 py-3">
        <button
          type="button"
          className="text-xs font-medium text-muted-foreground hover:text-foreground"
          onClick={() => setActiveThreadId(null)}
        >
          &larr; Back
        </button>
        <span className="text-xs text-muted-foreground">
          {boardAnchorLabel(active.anchor, liveIds)}
        </span>
        <button
          type="button"
          className="h-6 w-6 rounded p-0 text-sm hover:bg-muted"
          onClick={close}
          aria-label="Close comments panel"
        >
          &times;
        </button>
      </header>
      <div className="flex-1 overflow-y-auto p-4">
        <CommentThreadCard
          thread={active}
          currentUserId={user?.author.userId}
          readOnly={readOnly || !user}
          members={members}
          onReply={(body) => collab.addReply(active.id, body)}
          onResolveToggle={() => collab.setResolved(active.id, !active.resolved)}
          onEdit={(commentId, body) => collab.editComment(active.id, commentId, body)}
          onDelete={async (commentId) => {
            const wasRoot = commentId === active.comments[0]?.id;
            await collab.deleteComment(active.id, commentId);
            if (wasRoot) setActiveThreadId(null);
          }}
        />
      </div>
    </aside>
  );
}
