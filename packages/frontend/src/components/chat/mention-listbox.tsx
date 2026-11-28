import { useEffect } from "react";

import { Badge } from "@/components/ui/badge";
import { AuthorAvatar } from "@/components/comments/components/AuthorAvatar";
import type { MentionMember } from "@/components/comments/components/CommentComposer";
import { cn } from "@/lib/utils";

interface MentionListboxProps {
  id: string;
  optionId: (index: number) => string;
  open: boolean;
  members: MentionMember[];
  activeIndex: number;
  onPick: (member: MentionMember) => void;
}

/**
 * The `@` suggestion list `useMentionAutocomplete` renders. Focus never
 * leaves the textarea: it names the active option through
 * `aria-activedescendant`, and a click lands on `mousedown` so the textarea
 * keeps focus through the insert. The result count is announced politely
 * from a live region that stays mounted, since one that mounts with its
 * text is not read.
 */
export function MentionListbox({
  id,
  optionId,
  open,
  members,
  activeIndex,
  onPick,
}: MentionListboxProps) {
  const count = open ? members.length : 0;
  // Eight rows overflow the list's height; keep the active one in view.
  useEffect(() => {
    if (!open) return;
    document.getElementById(optionId(activeIndex))?.scrollIntoView?.({
      block: "nearest",
    });
  }, [open, activeIndex, optionId]);
  return (
    <>
      <span aria-live="polite" className="sr-only">
        {count === 0
          ? ""
          : `${count} ${count === 1 ? "suggestion" : "suggestions"}`}
      </span>
      {open && (
        <ul
          id={id}
          role="listbox"
          aria-label="Mention suggestions"
          className="absolute bottom-full left-0 z-50 mb-1 max-h-48 w-56 overflow-auto rounded-md border bg-popover p-1 shadow-md"
        >
          {members.map((m, i) => (
            <li
              key={m.userId}
              id={optionId(i)}
              role="option"
              aria-selected={i === activeIndex}
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(m);
              }}
              className={cn(
                "flex w-full cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm pointer-coarse:min-h-11",
                i === activeIndex ? "bg-accent" : "hover:bg-accent",
              )}
            >
              {/* The avatar's initial would prefix the option's name. */}
              <span aria-hidden="true" className="contents">
                <AuthorAvatar author={m} size="md" />
              </span>
              <span className="truncate">{m.username}</span>
              {m.kind === "bot" && <Badge variant="outline">Bot</Badge>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
