import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { IconSend } from "@tabler/icons-react";

import { CHAT_BODY_MAX } from "@/api/chat";
import { Button } from "@/components/ui/button";
import { AuthorAvatar } from "@/components/comments/components/AuthorAvatar";
import type { MentionMember } from "@/components/comments/components/CommentComposer";
import {
  applySelectedMentions,
  detectMentionQuery,
  type MentionRef,
} from "@/components/comments/mentions";
import { isCoarsePointer } from "@/hooks/use-coarse-pointer";
import { cn } from "@/lib/utils";
import { draftStore } from "./draft-store";

const MAX_TEXTAREA_HEIGHT_PX = 200;
const MAX_MENTION_RESULTS = 8;

interface ComposerProps {
  /** Keys the draft; a thread passes its own key so drafts stay apart. */
  channelId: string;
  onSend: (body: string) => void | Promise<void>;
  members?: MentionMember[];
  placeholder?: string;
  /** Set when the channel cannot take messages; shown in place of sending. */
  disabledReason?: string;
  /** Controls under the box, such as "Also send to channel". */
  footer?: ReactNode;
  autoFocus?: boolean;
}

/**
 * The chat message box. Enter sends and Shift+Enter breaks the line, as every
 * chat app does; an Enter that confirms an IME composition (Korean, Japanese,
 * Chinese input) is the IME's and never sends. `@` opens the member
 * autocomplete, and picked mentions are tokenized on send exactly as the
 * comment composer does. The draft is kept per channel in `sessionStorage`.
 */
export function Composer({
  channelId,
  onSend,
  members,
  placeholder = "Message",
  disabledReason,
  footer,
  autoFocus = false,
}: ComposerProps) {
  const [body, setBody] = useState(() => draftStore.get(channelId));
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const selectedRef = useRef<MentionRef[]>([]);
  const [mentionQuery, setMentionQuery] = useState<{
    query: string;
    start: number;
  } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  // A different channel is a different draft.
  const [draftKey, setDraftKey] = useState(channelId);
  if (draftKey !== channelId) {
    setDraftKey(channelId);
    setBody(draftStore.get(channelId));
    selectedRef.current = [];
    setMentionQuery(null);
  }

  const disabled = !!disabledReason;
  const trimmed = body.trim();
  const tooLong = body.length > CHAT_BODY_MAX;

  const mentionsEnabled = !!members && members.length > 0;
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

  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, MAX_TEXTAREA_HEIGHT_PX)}px`;
    ta.style.overflowY =
      ta.scrollHeight > MAX_TEXTAREA_HEIGHT_PX ? "auto" : "hidden";
  }, [body]);

  // Not on a touch device, where focusing would throw up the keyboard over
  // the conversation the reader just opened.
  useEffect(() => {
    if (autoFocus && !disabled && !isCoarsePointer()) {
      textareaRef.current?.focus();
    }
  }, [autoFocus, disabled, channelId]);

  const update = (value: string) => {
    setBody(value);
    draftStore.set(channelId, value);
  };

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
    update(value);
    refreshMentionQuery(value, e.target.selectionStart ?? value.length);
  };

  const selectMember = (member: MentionMember) => {
    const ta = textareaRef.current;
    if (!ta || !mentionQuery) return;
    const value = ta.value;
    const queryEnd = mentionQuery.start + 1 + mentionQuery.query.length;
    const before = value.slice(0, mentionQuery.start);
    const insertion = `@${member.username} `;
    update(before + insertion + value.slice(queryEnd));
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

  const canSend = !disabled && !sending && !!trimmed && !tooLong;

  const send = async () => {
    if (!trimmed || sending || disabled || tooLong) return;
    const finalBody = applySelectedMentions(body, selectedRef.current).trim();
    setSending(true);
    try {
      await onSend(finalBody);
      // The box stays editable during the send; text typed meanwhile was
      // never sent, so only the snapshot that went out is cleared.
      if ((textareaRef.current?.value ?? body) === body) {
        update("");
        draftStore.clear(channelId);
        selectedRef.current = [];
        setMentionQuery(null);
      }
    } catch {
      // The caller reports the failure; the text stays so nothing is lost.
    } finally {
      setSending(false);
    }
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // An Enter that commits an IME composition belongs to the IME. Safari
    // reports it only through keyCode 229, and fires compositionend before
    // keydown, so all three signals are checked.
    const composing =
      composingRef.current ||
      e.nativeEvent.isComposing ||
      e.keyCode === 229;
    if (composing) return;

    if (dropdownOpen) {
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
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
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

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={cn(
          "relative flex items-end gap-1 rounded-md border border-input-border bg-background p-1 transition-[color,box-shadow]",
          "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
          disabled && "opacity-60",
        )}
      >
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
          rows={1}
          placeholder={placeholder}
          aria-label={placeholder}
          aria-invalid={tooLong || undefined}
          aria-describedby={disabled ? `${channelId}-composer-reason` : undefined}
          // 16px below `md` so iOS does not zoom the page on focus.
          className="caret-primary placeholder:text-muted-foreground min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-base outline-none disabled:cursor-not-allowed md:text-sm"
        />
        {/* Syrup only once there is something to send: a channel and its
            open thread each mount a composer, and two idle primary buttons
            side by side break the One Accent Rule. */}
        <Button
          type="button"
          size="icon"
          variant={canSend ? "default" : "ghost"}
          aria-label="Send message"
          onClick={() => void send()}
          disabled={!canSend}
          className="size-8 shrink-0 pointer-coarse:size-11"
        >
          <IconSend />
        </Button>
        {dropdownOpen && (
          <ul
            role="listbox"
            aria-label="Mention suggestions"
            className="absolute bottom-full left-0 z-50 mb-1 max-h-48 w-56 overflow-auto rounded-md border bg-popover p-1 shadow-md"
          >
            {filteredMembers.map((m, i) => (
              <li key={m.userId}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === safeIndex}
                  // onMouseDown keeps the textarea focused through the insert.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectMember(m);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm pointer-coarse:min-h-11",
                    i === safeIndex ? "bg-accent" : "hover:bg-accent",
                  )}
                >
                  <AuthorAvatar author={m} size="md" />
                  <span className="truncate">{m.username}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {(disabled || tooLong || footer) && (
        <div className="flex min-h-5 items-center justify-between gap-2 text-xs text-muted-foreground">
          {disabled ? (
            <span id={`${channelId}-composer-reason`}>{disabledReason}</span>
          ) : tooLong ? (
            <span className="text-destructive">
              {body.length - CHAT_BODY_MAX} characters over the{" "}
              {CHAT_BODY_MAX.toLocaleString()} limit
            </span>
          ) : (
            <span />
          )}
          {footer}
        </div>
      )}
    </div>
  );
}
