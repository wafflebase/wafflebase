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
  /** The signed-in user, who owns the draft; none stores no draft. */
  userId?: number;
  /** Sends the body; must not reject (see the component's note). */
  onSend: (body: string) => void | Promise<void>;
  members?: MentionMember[];
  placeholder?: string;
  /** Set when the channel cannot take messages; shown in place of sending. */
  disabledReason?: string;
  /**
   * The channel is not known yet: the box is inert, says nothing, and takes
   * `autoFocus` only once this clears.
   */
  waiting?: boolean;
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
 * Sending is optimistic: the box clears at once and the caller shows the
 * message as pending. `onSend` must not reject — a failed send is the
 * caller's to show and retry on its row, so the text never comes back here.
 */
export function Composer({
  channelId,
  userId,
  onSend,
  members,
  placeholder = "Message",
  disabledReason,
  waiting = false,
  footer,
  autoFocus = false,
  onArrowUpWhenEmpty,
}: ComposerProps) {
  const [body, setBody] = useState(() => draftStore.get(userId, channelId));
  const [sending, setSending] = useState(false);
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const update = (value: string) => setBody(value);

  const disabled = !!disabledReason || waiting;
  const trimmed = body.trim();

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

  // What is sent, and what the server measures: a picked `@name` grows into
  // its `@[name](id)` token, so the limit is checked after that expansion.
  const finalBody = mention.applyMentions(body).trim();
  const tooLong = finalBody.length > CHAT_BODY_MAX;

  // A different channel, or a different signed-in user, is a different
  // draft. The user is often still loading on the first render, though: text
  // typed in that window is the user's own, so it is kept and saved as their
  // draft rather than replaced by whatever was stored.
  const [draftFor, setDraftFor] = useState({ userId, channelId });
  // Bumped when the box takes another draft; the mentions picked for the
  // old one are dropped once that render commits.
  const [draftSwaps, setDraftSwaps] = useState(0);
  if (draftFor.userId !== userId || draftFor.channelId !== channelId) {
    const resolved =
      draftFor.userId === undefined && draftFor.channelId === channelId;
    setDraftFor({ userId, channelId });
    if (!resolved || !body) {
      setBody(draftStore.get(userId, channelId));
      setDraftSwaps((n) => n + 1);
    }
  }
  // Not while rendering: the picked mentions live in a ref, which a render
  // React throws away would not roll back, leaving the kept draft's `@name`s
  // to go out as plain text.
  const resetMentions = mention.reset;
  useEffect(() => {
    if (draftSwaps > 0) resetMentions();
  }, [draftSwaps, resetMentions]);

  // The box is saved as the draft of whoever and wherever it now belongs to,
  // after the render commits: rendering only reads storage, since React may
  // render and then discard (StrictMode, an interrupted concurrent render).
  useEffect(() => {
    draftStore.set(userId, channelId, body);
  }, [userId, channelId, body]);
  useEffect(() => draftStore.dropLegacy(channelId), [channelId]);

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
  // back. Order across quick sends is kept where the posts are made
  // (`useSendMessage` queues them per channel), not here.
  const send = async () => {
    if (!trimmed || sending || disabled || tooLong) return;
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
  const hasFooterContent = !!disabledReason || tooLong || !!footer;

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className={cn(
          "relative flex items-end gap-1 rounded-md border border-input-border bg-background p-1 transition-[color,box-shadow]",
          "focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
          disabledReason && "opacity-60",
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
          aria-describedby={
            disabledReason ? `${channelId}-composer-reason` : undefined
          }
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
        {disabledReason ? (
          <span id={`${channelId}-composer-reason`}>{disabledReason}</span>
        ) : tooLong ? (
          <span className="text-destructive">
            {finalBody.length - CHAT_BODY_MAX} characters over the{" "}
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
