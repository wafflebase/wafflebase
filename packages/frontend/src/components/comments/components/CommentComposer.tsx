import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";

import { Button } from "@/components/ui/button";

import {
  applySelectedMentions,
  detectMentionQuery,
  type MentionRef,
} from "../mentions.ts";
import { AuthorAvatar } from "./AuthorAvatar";

const MAX_TEXTAREA_HEIGHT_PX = 200;
const MAX_MENTION_RESULTS = 8;

/** A workspace member offered in the `@` mention autocomplete. */
export type MentionMember = {
  userId: string;
  username: string;
  photo?: string;
};

type CommentComposerProps = {
  initialBody?: string;
  submitLabel: string;
  onSubmit: (body: string) => void | Promise<void>;
  onCancel?: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
  /**
   * Compact variant for always-visible inline reply use case.
   * Smaller textarea, hides submit button until content is present,
   * matches the comment body font size for visual continuity.
   */
  compact?: boolean;
  /**
   * Workspace members offered in the `@` mention autocomplete. When omitted
   * (or empty), mentions are disabled and the composer behaves as a plain
   * textarea — existing mention tokens still render fine elsewhere.
   */
  members?: MentionMember[];
};

/**
 * Plain-text comment input form with submit/cancel actions and optional
 * `@user` mention autocomplete. Used for new threads and replies, by any
 * consumer (docs, sheets, slides).
 *
 * Keyboard:
 * - Cmd/Ctrl+Enter: submit
 * - Escape: cancel (only when onCancel is provided)
 * - When the mention dropdown is open: ↑/↓ move, Enter/Tab select, Esc closes
 *
 * Mentions are tokenized on submit (approach B): the textarea shows clean
 * `@username` text; `serializeMention` runs over the selected mentions just
 * before `onSubmit`, so the body handed up already contains
 * `@[username](userId)` tokens and every store works unchanged.
 */
export function CommentComposer({
  initialBody = "",
  submitLabel,
  onSubmit,
  onCancel,
  disabled = false,
  autoFocus = false,
  compact = false,
  members,
}: CommentComposerProps) {
  const [body, setBody] = useState(initialBody);
  const trimmed = body.trim();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Mention autocomplete state. `selectedRef` is the mention map (approach B):
  // username -> chosen ref, accumulated as the user picks members and replayed
  // at submit. It is view-local and never needs to trigger a render.
  const mentionsEnabled = !!members && members.length > 0;
  const [mentionQuery, setMentionQuery] = useState<{
    query: string;
    start: number;
  } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const selectedRef = useRef<MentionRef[]>([]);
  const composingRef = useRef(false);

  const filteredMembers =
    mentionsEnabled && mentionQuery
      ? members!
          .filter((m) =>
            m.username.toLowerCase().includes(mentionQuery.query.toLowerCase()),
          )
          .slice(0, MAX_MENTION_RESULTS)
      : [];
  const dropdownOpen = mentionQuery !== null && filteredMembers.length > 0;
  const safeIndex = Math.min(activeIndex, filteredMembers.length - 1);

  // Auto-grow the textarea. Reset to "auto" first so scrollHeight reflects
  // current content (otherwise the height never shrinks when lines are
  // deleted). Capped at MAX_TEXTAREA_HEIGHT_PX so a runaway paste does
  // not eat the popover.
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const next = Math.min(ta.scrollHeight, MAX_TEXTAREA_HEIGHT_PX);
    ta.style.height = `${next}px`;
    ta.style.overflowY =
      ta.scrollHeight > MAX_TEXTAREA_HEIGHT_PX ? "auto" : "hidden";
  }, [body]);

  // Force focus when requested. React's autoFocus is unreliable when the
  // popover opens from a Radix context-menu / dropdown: Radix uses its
  // own deferred focus restoration, which can outrun a single RAF. Two
  // RAFs + a 50ms fallback wins the race in practice.
  useEffect(() => {
    if (!autoFocus) return;
    let cancelled = false;
    const focusNow = () => {
      if (cancelled) return;
      const ta = textareaRef.current;
      if (!ta) return;
      if (document.activeElement !== ta) ta.focus();
    };
    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(focusNow);
    });
    const timer = setTimeout(focusNow, 50);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      clearTimeout(timer);
    };
  }, [autoFocus]);

  const [submitting, setSubmitting] = useState(false);

  const refreshMentionQuery = (value: string, caret: number) => {
    if (!mentionsEnabled || composingRef.current) {
      setMentionQuery(null);
      return;
    }
    setMentionQuery(detectMentionQuery(value, caret));
    setActiveIndex(0);
  };

  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setBody(value);
    refreshMentionQuery(value, e.target.selectionStart ?? value.length);
  };

  const selectMember = (member: MentionMember) => {
    const ta = textareaRef.current;
    if (!ta || !mentionQuery) return;
    const value = ta.value;
    const queryEnd = mentionQuery.start + 1 + mentionQuery.query.length;
    const before = value.slice(0, mentionQuery.start);
    const after = value.slice(queryEnd);
    const insertion = `@${member.username} `;
    const newValue = before + insertion + after;
    setBody(newValue);
    if (!selectedRef.current.some((m) => m.username === member.username)) {
      selectedRef.current.push({
        userId: member.userId,
        username: member.username,
      });
    }
    setMentionQuery(null);
    const caret = before.length + insertion.length;
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(caret, caret);
    });
  };

  const submit = async () => {
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      const finalBody = mentionsEnabled
        ? applySelectedMentions(body, selectedRef.current).trim()
        : trimmed;
      await onSubmit(finalBody);
      setBody("");
      selectedRef.current = [];
      setMentionQuery(null);
    } catch (err) {
      console.error("Failed to submit comment:", err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (dropdownOpen && !composingRef.current) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % filteredMembers.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex(
          (i) => (i - 1 + filteredMembers.length) % filteredMembers.length,
        );
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !(e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        selectMember(filteredMembers[safeIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }

    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    } else if (e.key === "Escape" && onCancel) {
      e.preventDefault();
      onCancel();
    }
  };

  const textareaClass = compact
    ? "flex w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
    : "flex w-full rounded-md border border-input bg-background px-3 py-2 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none";

  return (
    <div className={compact ? "flex flex-col gap-1.5" : "flex flex-col gap-3"}>
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={body}
          onChange={handleChange}
          onKeyDown={handleKey}
          onCompositionStart={() => {
            composingRef.current = true;
            setMentionQuery(null);
          }}
          onCompositionEnd={(e) => {
            composingRef.current = false;
            refreshMentionQuery(
              e.currentTarget.value,
              e.currentTarget.selectionStart ?? e.currentTarget.value.length,
            );
          }}
          disabled={disabled}
          rows={compact ? 1 : 3}
          placeholder={
            disabled ? "Sign in to leave a comment." : "Add a comment..."
          }
          aria-label="Comment body"
          className={textareaClass}
        />
        {dropdownOpen && (
          <ul
            role="listbox"
            aria-label="Mention suggestions"
            className="absolute left-0 top-full z-50 mt-1 max-h-48 w-56 overflow-auto rounded-md border bg-popover p-1 shadow-md"
          >
            {filteredMembers.map((m, i) => (
              <li key={m.userId}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === safeIndex}
                  // onMouseDown (not onClick) so the textarea keeps focus and
                  // the selection range stays valid through the insertion.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectMember(m);
                  }}
                  className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs ${
                    i === safeIndex ? "bg-accent" : "hover:bg-accent"
                  }`}
                >
                  <AuthorAvatar author={m} size="md" />
                  <span className="truncate">{m.username}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {(!compact || trimmed.length > 0) && (
        <div className="flex justify-end gap-2">
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              size={compact ? "sm" : "default"}
              onClick={onCancel}
              disabled={disabled}
              className={compact ? "h-7 text-xs" : ""}
            >
              Cancel
            </Button>
          )}
          <Button
            type="button"
            size={compact ? "sm" : "default"}
            onClick={() => {
              void submit();
            }}
            disabled={disabled || submitting || !trimmed}
            className={compact ? "h-7 text-xs" : ""}
          >
            {submitLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
