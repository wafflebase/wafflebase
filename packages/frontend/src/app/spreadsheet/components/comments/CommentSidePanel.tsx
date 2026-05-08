import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { formatRelativeTime } from "@/lib/utils";
import type { Thread, CommentAnchor } from "@wafflebase/sheets";

type Props = {
  threads: Thread[];
  onJumpTo: (anchor: CommentAnchor) => void;
  onClose: () => void;
};

/**
 * Side panel that lists all comment threads across all tabs, grouped by
 * "Open" and "Resolved" tabs. Clicking a thread row jumps to its anchor cell.
 */
export function CommentSidePanel({ threads, onJumpTo, onClose }: Props) {
  const [tab, setTab] = useState<"open" | "resolved">("open");
  const visible = threads.filter((t) => t.resolved === (tab === "resolved"));
  const openCount = threads.filter((t) => !t.resolved).length;
  const resolvedCount = threads.filter((t) => t.resolved).length;

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

      <div className="flex border-b">
        <button
          type="button"
          className={`flex-1 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
            tab === "open"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          aria-pressed={tab === "open"}
          onClick={() => setTab("open")}
        >
          Open ({openCount})
        </button>
        <button
          type="button"
          className={`flex-1 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
            tab === "resolved"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
          aria-pressed={tab === "resolved"}
          onClick={() => setTab("resolved")}
        >
          Resolved ({resolvedCount})
        </button>
      </div>

      <ul className="flex-1 overflow-y-auto">
        {visible.map((t) => {
          const root = t.comments[0];
          if (!root) return null;
          return (
            <li key={t.id} className="border-b last:border-0">
              <button
                type="button"
                className="w-full px-4 py-3 text-left hover:bg-muted/50 transition-colors flex flex-col gap-1"
                onClick={() => onJumpTo(t.anchor)}
                aria-label={`Jump to comment by ${root.author.username}`}
              >
                {/* Item 2: Author avatar + Item 1: Relative time */}
                <div className="flex items-center gap-2">
                  <Avatar className="h-4 w-4 shrink-0">
                    {root.author.photo && (
                      <AvatarImage
                        src={root.author.photo}
                        alt={root.author.username}
                      />
                    )}
                    <AvatarFallback className="text-[8px]">
                      {root.author.username.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <strong className="text-xs font-medium text-foreground">
                    {root.author.username}
                  </strong>
                  <time className="text-xs text-muted-foreground">
                    {formatRelativeTime(root.createdAt)}
                  </time>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {root.body.split("\n")[0].slice(0, 80)}
                </p>
                {t.comments.length > 1 && (
                  <span className="text-xs text-muted-foreground">
                    {t.comments.length} comments
                  </span>
                )}
              </button>
            </li>
          );
        })}
        {visible.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">
            No {tab === "open" ? "open" : "resolved"} comments.
          </li>
        )}
      </ul>
    </aside>
  );
}
