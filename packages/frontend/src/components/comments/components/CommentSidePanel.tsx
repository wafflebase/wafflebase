import type { ReactNode } from "react";
import { useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/utils";
import type {
  CommentAnchor,
  CommentAuthor,
  Thread,
} from "@/types/comments";

type Props<A extends CommentAnchor> = {
  /** All live (non-orphan) threads, both open and resolved. */
  threads: ReadonlyArray<Thread<A>>;
  /** Orphan threads — shown in a separate sub-section under "Open". */
  orphanedThreads?: ReadonlyArray<Thread<A>>;
  onJumpTo: (thread: Thread<A>) => void;
  onClose: () => void;
  /**
   * Render the supplementary anchor label below the body preview.
   * Sheets shows "A1"; docs shows the quoted-text snippet. When
   * omitted, the panel renders nothing for the label position.
   */
  renderAnchorLabel?: (thread: Thread<A>) => ReactNode;
  /**
   * Render a card for an orphan thread. Owned by the consumer so the
   * Orphaned section can hand in feature-specific buttons (e.g. resolve
   * straight from the card). When omitted, orphan threads are not shown
   * at all.
   */
  renderOrphan?: (thread: Thread<A>) => ReactNode;
};

/**
 * Side panel listing every comment thread, grouped by "Open" and
 * "Resolved". The "Open" tab can additionally include an "Orphaned"
 * sub-section for threads whose anchored content has been deleted.
 *
 * The panel is anchor-agnostic: feature-specific row labels and orphan
 * cards are injected as render props.
 */
export function CommentSidePanel<A extends CommentAnchor>({
  threads,
  orphanedThreads = [],
  onJumpTo,
  onClose,
  renderAnchorLabel,
  renderOrphan,
}: Props<A>) {
  const [tab, setTab] = useState<"open" | "resolved">("open");

  const open = threads.filter((t) => !t.resolved);
  const resolved = threads.filter((t) => t.resolved);
  const orphans = renderOrphan ? orphanedThreads : [];
  const visible = tab === "open" ? open : resolved;

  return (
    <aside
      className="flex h-full w-72 flex-col border-l bg-background shadow-lg"
      aria-label="Comments"
    >
      <header className="flex items-center justify-between border-b px-4 py-3">
        <span className="text-sm font-semibold">Comments</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={onClose}
          aria-label="Close comments panel"
        >
          ×
        </Button>
      </header>

      <div role="tablist" className="flex border-b">
        <TabButton
          active={tab === "open"}
          onClick={() => setTab("open")}
          label={`Open (${open.length + orphans.length})`}
        />
        <TabButton
          active={tab === "resolved"}
          onClick={() => setTab("resolved")}
          label={`Resolved (${resolved.length})`}
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        <ul>
          {visible.map((t) => {
            const root = t.comments[0];
            if (!root) return null;
            return (
              <li key={t.id} className="border-b last:border-0">
                <button
                  type="button"
                  className="flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-muted/50"
                  onClick={() => onJumpTo(t)}
                  aria-label={`Jump to comment by ${root.author.username}`}
                >
                  <div className="flex items-center gap-2">
                    <AuthorAvatar author={root.author} />
                    <strong className="text-xs font-medium">
                      {root.author.username}
                    </strong>
                    <time className="text-xs text-muted-foreground">
                      {formatRelativeTime(root.createdAt)}
                    </time>
                  </div>
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {root.body.split("\n")[0].slice(0, 80)}
                  </p>
                  {renderAnchorLabel && (
                    <div className="text-[10px] text-muted-foreground">
                      {renderAnchorLabel(t)}
                    </div>
                  )}
                  {t.comments.length > 1 && (
                    <span className="text-xs text-muted-foreground">
                      {t.comments.length} comments
                    </span>
                  )}
                </button>
              </li>
            );
          })}
          {visible.length === 0 && tab === "resolved" && (
            <li className="px-4 py-6 text-center text-sm text-muted-foreground">
              No resolved comments.
            </li>
          )}
        </ul>

        {tab === "open" && orphans.length > 0 && renderOrphan && (
          <section aria-label="Orphaned comments" className="border-t">
            <h3 className="px-4 pt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Orphaned
            </h3>
            <ul>
              {orphans.map((t) => (
                <li key={t.id}>{renderOrphan(t)}</li>
              ))}
            </ul>
          </section>
        )}

        {tab === "open" && open.length === 0 && orphans.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            No open comments.
          </p>
        )}
      </div>
    </aside>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      className={`flex-1 border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
        active
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
      aria-selected={active}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function AuthorAvatar({ author }: { author: CommentAuthor }) {
  return (
    <Avatar className="h-4 w-4 shrink-0">
      {author.photo && <AvatarImage src={author.photo} alt={author.username} />}
      <AvatarFallback className="text-[8px]">
        {author.username.slice(0, 2).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}
