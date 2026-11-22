import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { IconCheck, IconX } from "@tabler/icons-react";

import { Input } from "@/components/ui/input";
import { AuthorAvatar } from "@/components/comments/components/AuthorAvatar";
import type { MentionMember } from "@/components/comments/components/CommentComposer";
import { cn } from "@/lib/utils";

interface MemberPickerProps {
  members: MentionMember[];
  selected: string[];
  onChange: (userIds: string[]) => void;
  /** Most people that can be picked; further rows are disabled. */
  max?: number;
  /** Members shown but not pickable (already in the channel). */
  excluded?: string[];
  /** The member list is still loading: not the same as an empty one. */
  loading?: boolean;
  /** It failed to load: say so, rather than "nobody else is here". */
  failed?: boolean;
  onRetry?: () => void;
  /**
   * Where to invite people, offered when nobody else is in the workspace.
   * Only owners can invite, so anyone else is told to ask one instead.
   */
  inviteHref?: string;
}

/**
 * Search-and-tick list of workspace members, with the picks as removable
 * chips above it. Used to start a DM and to add people to a channel.
 */
export function MemberPicker({
  members,
  selected,
  onChange,
  max,
  excluded = [],
  loading = false,
  failed = false,
  onRetry,
  inviteHref,
}: MemberPickerProps) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members.filter((m) => !q || m.username.toLowerCase().includes(q));
  }, [members, query]);
  const full = max !== undefined && selected.length >= max;
  const byId = new Map(members.map((m) => [m.userId, m]));

  const toggle = (id: string) =>
    onChange(
      selected.includes(id)
        ? selected.filter((s) => s !== id)
        : [...selected, id],
    );

  // Nobody to pick is not a search miss: say so, and say where people come
  // from, instead of a "No one matches" under an empty search box.
  if (failed) {
    return (
      <p className="py-3 text-sm text-muted-foreground">
        Couldn't load the people in this workspace.{" "}
        <button
          type="button"
          onClick={onRetry}
          className="rounded-sm font-medium text-foreground underline underline-offset-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          Try again
        </button>
      </p>
    );
  }
  if (loading) {
    return <p className="py-3 text-sm text-muted-foreground">Loading people…</p>;
  }
  if (members.length === 0) {
    return (
      <p className="py-3 text-sm text-muted-foreground">
        You're the only one in this workspace so far.{" "}
        {inviteHref ? (
          <>
            <Link
              to={inviteHref}
              className="font-medium text-foreground underline underline-offset-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              Invite people
            </Link>{" "}
            from workspace settings.
          </>
        ) : (
          "Ask a workspace owner to invite people."
        )}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Selected people">
          {selected.map((id) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => toggle(id)}
                aria-label={`Remove ${byId.get(id)?.username ?? id}`}
                className="inline-flex items-center gap-1 rounded-md bg-selected px-2 py-0.5 text-xs font-medium text-selected-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:min-h-11"
              >
                {byId.get(id)?.username ?? id}
                <IconX className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search people"
        aria-label="Search people"
        autoFocus
      />
      <ul
        className="-mx-1 flex max-h-64 flex-col overflow-y-auto"
        aria-label="Workspace members"
      >
        {shown.length === 0 && (
          <li className="px-2 py-3 text-sm text-muted-foreground">
            No one matches “{query.trim()}”.
          </li>
        )}
        {shown.map((m) => {
          const isExcluded = excluded.includes(m.userId);
          const isSelected = selected.includes(m.userId);
          const disabled = isExcluded || (!isSelected && full);
          return (
            <li key={m.userId}>
              <button
                type="button"
                role="checkbox"
                aria-checked={isSelected}
                disabled={disabled}
                onClick={() => toggle(m.userId)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none pointer-coarse:min-h-11",
                  "hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                <AuthorAvatar author={m} size="md" />
                <span className="min-w-0 flex-1 truncate">{m.username}</span>
                {isExcluded ? (
                  <span className="text-xs text-muted-foreground">
                    Already here
                  </span>
                ) : isSelected ? (
                  <IconCheck className="size-4 text-foreground" />
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
      {full && (
        <p className="text-xs text-muted-foreground">
          A conversation can include up to {max! + 1} people, you included.
        </p>
      )}
    </div>
  );
}
