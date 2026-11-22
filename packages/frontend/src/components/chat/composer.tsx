import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { IconSend } from "@tabler/icons-react";

import { CHAT_BODY_MAX } from "@/api/chat";
import { Button } from "@/components/ui/button";
import type { MentionMember } from "@/components/comments/components/CommentComposer";
import { isCoarsePointer } from "@/hooks/use-coarse-pointer";
import { cn } from "@/lib/utils";
import { draftStore } from "./draft-store";
import { useMentionAutocomplete } from "./use-mention-autocomplete";

const MAX_TEXTAREA_HEIGHT_PX = 200;

interface ComposerProps {
  /** Keys the draft; a thread passes its own key so drafts stay apart. */
  channelId: string;
  /**
   * Sends the body. It should resolve rather than throw: the box has already
   * cleared, and a failed send is the caller's to show and retry.
   */
  onSend: (body: string) => void | Promise<void>;
  members?: MentionMember[];
  placeholder?: string;
  /** Set when the channel cannot take messages; shown in place of sending. */
  disabledReason?: string;
  /** Controls under the box, such as "Also send to channel". */
  footer?: ReactNode;
  autoFocus?: boolean;
  /**
   * ↑ in an empty box, as in Slack: the caller opens the reader's last
   * message for editing. Not called while composing or picking a mention.
   */
  onArrowUpWhenEmpty?: () => void;
}

/**
 * The chat message box. Enter sends and Shift+Enter breaks the line, as every
 * chat app does; an Enter that confirms an IME composition (Korean, Japanese,
 * Chinese input) is the IME's and never sends. `@` opens the member
 * autocomplete, and picked mentions are tokenized on send exactly as the
 * comment composer does. The draft is kept per channel in `sessionStorage`.
 *
 * Sending is optimistic: the box clears at once, and the text (with its
 * mentions and draft) comes back only if the send throws. The caller reports
 * the failure.
 */
export function Composer({
  channelId,
  onSend,
  members,
  placeholder = "Message",
  disabledReason,
  footer,
  autoFocus = false,
  onArrowUpWhenEmpty,
}: ComposerProps) {
  const [body, setBody] = useState(() => draftStore.get(channelId));
  const [sending, setSending] = useState(false);
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // The channel this composer shows now, read by a send that resolves after
  // the reader moved on.

  const update = (value: string) => {
    setBody(value);
    draftStore.set(channelId, value);
  };

  const disabled = !!disabledReason;
  const trimmed = body.trim();
  const tooLong = body.length > CHAT_BODY_MAX;

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
      return;
    }
    if (
      e.key === "ArrowUp" &&
      onArrowUpWhenEmpty &&
      !e.shiftKey &&
      !e.altKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      e.currentTarget.value === ""
    ) {
      e.preventDefault();
      onArrowUpWhenEmpty();
    }
  };

  const mention = useMentionAutocomplete({
    textareaRef,
    onChange: update,
    members,
    onKeyDown: handleKey,
  });

  // A different channel is a different draft.
  const [draftKey, setDraftKey] = useState(channelId);
  if (draftKey !== channelId) {
    setDraftKey(channelId);
    setBody(draftStore.get(channelId));
    mention.reset();
  }

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

  const canSend = !disabled && !sending && !!trimmed && !tooLong;

  // The box clears at once: the caller shows the message as pending and
  // owns failure (the row offers Retry), so `onSend` never hands the text
  // back. `sending` still holds a second Enter until the first is queued,
  // which keeps messages in order.
  const send = async () => {
    if (!trimmed || sending || disabled || tooLong) return;
    const finalBody = mention.applyMentions(body).trim();
    setSending(true);
    update("");
    mention.reset();
    try {
      await onSend(finalBody);
    } finally {
      setSending(false);
    }
  };

  // Shift+Enter is invisible until explained; a touch keyboard has its own
  // return key, so the hint is for fine pointers only.
  const showHint = focused && !!trimmed && !disabled && !tooLong;
  const hasFooterContent = disabled || tooLong || !!footer;

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
          {...mention.inputProps}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
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
        {mention.listbox}
      </div>
      {/* The row is always there on a fine pointer, so the hint appearing
          never pushes the conversation up. */}
      <div
        className={cn(
          "flex min-h-5 items-center justify-between gap-2 text-xs text-muted-foreground",
          !hasFooterContent && "pointer-coarse:hidden",
        )}
      >
        {disabled ? (
          <span id={`${channelId}-composer-reason`}>{disabledReason}</span>
        ) : tooLong ? (
          <span className="text-destructive">
            {body.length - CHAT_BODY_MAX} characters over the{" "}
            {CHAT_BODY_MAX.toLocaleString()} limit
          </span>
        ) : (
          <span
            className={cn("pointer-coarse:hidden", !showHint && "invisible")}
          >
            Enter to send · Shift+Enter for new line
          </span>
        )}
        {footer}
      </div>
    </div>
  );
}
