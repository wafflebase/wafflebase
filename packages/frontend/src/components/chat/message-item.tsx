import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import {
  IconCopy,
  IconDots,
  IconLink,
  IconMessageReply,
  IconPencil,
  IconTrash,
} from "@tabler/icons-react";
import { toast } from "sonner";

import type { ChatMessageDto } from "@/api/chat";
import { CHAT_BODY_MAX } from "@/api/chat";
import { userFacingError } from "@/api/http-error";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { avatarInitials } from "@/components/avatar-size";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { MentionMember } from "@/components/comments/components/CommentComposer";
import {
  mentionBodyToPlainText,
  parseMentionBody,
} from "@/components/comments/mentions";
import { useCoarsePointer } from "@/hooks/use-coarse-pointer";
import { cn } from "@/lib/utils";
import type { ChatLine } from "./chat-cache";
import { formatShortTime, formatTime } from "./format-time";
import type { MessageGroup } from "./group-messages";
import { MessageBody } from "./message-body";
import { mentionsUser, messageLink } from "./message-links";
import { useDeleteMessage, useEditMessage } from "./use-chat";
import { useLongPress } from "./use-long-press";
import { useMentionAutocomplete } from "./use-mention-autocomplete";
import { ROW_ATTR } from "./use-roving-messages";

const UNKNOWN_AUTHOR = "Deleted user";

async function copyToClipboard(text: string, done: string, failed: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(done);
  } catch {
    toast.error(failed);
  }
}

function ChatAvatar({ author }: { author: ChatMessageDto["author"] }) {
  const name = author?.username ?? "?";
  return (
    <Avatar className="size-8 shrink-0">
      {author?.photo && <AvatarImage src={author.photo} alt="" />}
      <AvatarFallback className="text-xs">{avatarInitials(name)}</AvatarFallback>
    </Avatar>
  );
}

/** What a log hands every line it draws; the parts a thread lacks are optional. */
export interface LineHost {
  workspaceId: string;
  me: number;
  /** Who the edit box can mention. */
  members?: MentionMember[];
  highlightId?: string | null;
  /** The roving tab stop: the one row (and its controls) Tab reaches. */
  activeId?: string | null;
  /** The message open for editing; the log owns it so ↑ can open one. */
  editingId?: string | null;
  onEdit?: (id: string) => void;
  onEditDone?: (id: string) => void;
  /** Omitted inside a thread, where a reply cannot start another thread. */
  onOpenThread?: (rootId: string) => void;
  onRetry?: (clientId: string) => void;
  onDiscard?: (clientId: string) => void;
}

interface GroupProps extends LineHost {
  group: MessageGroup;
}

/** One author's run of messages: avatar and name once, then each line. */
export function MessageGroupView({ group, ...host }: GroupProps) {
  const lines = [group.first, ...group.rest];
  return (
    <li className="flex flex-col">
      {lines.map((m, i) => (
        <MessageLine
          key={m.id}
          message={m}
          showHeader={i === 0}
          author={group.author}
          host={host}
        />
      ))}
    </li>
  );
}

interface LineProps {
  message: ChatLine;
  showHeader: boolean;
  author: ChatMessageDto["author"];
  host: LineHost;
}

function MessageLine({ message, showHeader, author, host }: LineProps) {
  const { workspaceId, me, onOpenThread } = host;
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // A log that owns the edit (so ↑ in its composer can open one) passes
  // `onEdit`; a line on its own keeps the state itself.
  const managed = host.onEdit !== undefined;
  const [editingHere, setEditingHere] = useState(false);
  const editing = managed ? host.editingId === message.id : editingHere;
  const mode = editing
    ? "edit"
    : confirmingDelete
      ? "confirm-delete"
      : "view";
  const setMode = (next: "view" | "edit" | "confirm-delete") => {
    setConfirmingDelete(next === "confirm-delete");
    if (!managed) setEditingHere(next === "edit");
    else if (next === "edit") host.onEdit?.(message.id);
    else if (editing) host.onEditDone?.(message.id);
  };
  const remove = useDeleteMessage(workspaceId);
  const local = message.localState;
  const mine = !!message.author && message.author.id === me;
  const canAct = mine && !message.deleted && !local;
  const canReply =
    !!onOpenThread && !message.threadRootId && !message.deleted && !local;
  const hasActions = !message.deleted && !local;
  const mentionsMe = !message.deleted && mentionsUser(message.body, me);
  // The roving tab stop: only the active row, and the controls inside it,
  // are in the tab order. A host without one (a lone line) keeps them all.
  const active = host.activeId === undefined || host.activeId === message.id;
  const tabIndex = active ? undefined : -1;
  // A finger has no hover, so a touch screen gets no hover toolbar: the
  // actions open as a sheet, from a press-and-hold on the message the way
  // Slack and Google Chat do it, or from a "⋯" that a tap on the message
  // shows — the tap is to a finger what hovering is to a mouse, and nobody
  // has to know about the hold.
  const coarse = useCoarsePointer();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [byGesture, setByGesture] = useState(false);
  const touchActions = coarse && mode === "view" && hasActions;
  const longPress = useLongPress(() => {
    setByGesture(true);
    setSheetOpen(true);
  }, touchActions);
  const authorName = author?.username ?? UNKNOWN_AUTHOR;
  // A tap on the message itself, not on a link or button in it, selects the
  // row: focus lands on it and its "⋯" shows (`focus-within`).
  const selectOnTap = (e: MouseEvent<HTMLDivElement>) => {
    const hit = (e.target as Element).closest(
      "a, button, input, textarea, label, [role='button']",
    );
    if (hit && e.currentTarget.contains(hit)) return;
    e.currentTarget.focus({ preventScroll: true });
  };

  return (
    <div
      id={`chat-message-${message.id}`}
      data-message-id={message.id}
      {...{ [ROW_ATTR]: message.id }}
      tabIndex={
        host.activeId === undefined
          ? touchActions
            ? -1
            : undefined
          : active
            ? 0
            : -1
      }
      aria-busy={local === "pending" || undefined}
      {...longPress}
      onClick={touchActions ? selectOnTap : undefined}
      className={cn(
        "group/message relative flex gap-3 px-4 py-1 outline-none hover:bg-muted/60",
        "focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50",
        "motion-safe:transition-colors motion-safe:duration-700",
        mentionsMe && "bg-selected/40 hover:bg-selected/50",
        highlighted(host, message) && "bg-selected hover:bg-selected",
        showHeader && "mt-2 pt-2",
        // The hold is ours, not the browser's text-selection callout.
        touchActions &&
          "select-none [-webkit-touch-callout:none] focus-within:bg-muted/60",
        sheetOpen && "bg-muted/60",
      )}
    >
      <div className="w-8 shrink-0">
        {showHeader ? (
          <ChatAvatar author={author} />
        ) : (
          // Read to a screen reader from the prefix below, not from here:
          // this one is only there on hover. Always laid out, only hidden, and
          // on the message's own 20px line: shown as an inline box it took
          // this div's inherited 24px line instead, so hovering a run of
          // continuation lines grew each row by 4px and the list jumped.
          <time
            aria-hidden
            dateTime={message.createdAt}
            title={formatTime(message.createdAt)}
            className="invisible block whitespace-nowrap text-xs leading-5 text-muted-foreground tabular-nums group-hover/message:visible group-focus-within/message:visible"
          >
            {formatShortTime(message.createdAt)}
          </time>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {showHeader ? (
          <div className="flex items-baseline gap-2">
            <span className="truncate text-sm font-semibold text-foreground">
              {authorName}
            </span>
            {author?.kind === "bot" && (
              <Badge variant="outline" className="self-center">
                Bot
              </Badge>
            )}
            <time
              dateTime={message.createdAt}
              className="text-xs text-muted-foreground tabular-nums"
            >
              {formatTime(message.createdAt)}
            </time>
          </div>
        ) : (
          // A continuation line shows neither name nor (until hover) time;
          // a screen reader landing on it still hears whose and when.
          <span className="sr-only">
            {`${authorName}, ${formatTime(message.createdAt)}: `}
          </span>
        )}
        {message.threadRootId && message.alsoInChannel && onOpenThread && (
          <button
            type="button"
            tabIndex={tabIndex}
            onClick={() => onOpenThread(message.threadRootId!)}
            className="rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            Replied to a thread
          </button>
        )}
        {mode === "edit" ? (
          <EditBox
            message={message}
            workspaceId={workspaceId}
            members={host.members}
            onDone={() => setMode("view")}
          />
        ) : message.deleted ? (
          <p className="text-sm italic text-muted-foreground">
            This message was deleted
          </p>
        ) : (
          <div
            className={cn(
              "flex flex-wrap items-baseline gap-x-1",
              local === "pending" && "opacity-60",
            )}
          >
            <MessageBody
              body={message.body}
              me={me}
              tabbable={active}
              refs={message.refs}
              channelId={message.channelId}
            />
            {message.editedAt && (
              <span className="text-xs text-muted-foreground">(edited)</span>
            )}
            {local === "pending" && <span className="sr-only">Sending…</span>}
          </div>
        )}
        {local === "failed" && message.clientId && (
          <div
            role="group"
            aria-label="Message not sent"
            className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs"
          >
            <span className="font-medium text-destructive">Not sent</span>
            {message.failure?.reason && (
              <span className="text-muted-foreground">
                {message.failure.reason}
              </span>
            )}
            <span aria-hidden className="text-muted-foreground">
              ·
            </span>
            {/* A refusal the server will repeat (a 400/404/409) offers no Retry. */}
            {message.failure?.retryable !== false && (
              <>
                <button
                  type="button"
                  tabIndex={tabIndex}
                  onClick={() => host.onRetry?.(message.clientId!)}
                  className="rounded-sm font-medium text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:min-h-11"
                >
                  Retry
                </button>
                <span aria-hidden className="text-muted-foreground">
                  ·
                </span>
              </>
            )}
            <button
              type="button"
              tabIndex={tabIndex}
              onClick={() => host.onDiscard?.(message.clientId!)}
              className="rounded-sm text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:min-h-11"
            >
              Discard
            </button>
          </div>
        )}
        {mode === "confirm-delete" && (
          <div
            role="group"
            aria-label="Confirm delete"
            className="mt-1 flex flex-wrap items-center gap-2 text-sm"
          >
            <span className="text-muted-foreground">Delete this message?</span>
            <Button
              size="sm"
              variant="destructive"
              disabled={remove.isPending}
              onClick={() =>
                remove.mutate(message, {
                  onSuccess: () => setMode("view"),
                  onError: (err) =>
                    toast.error(
                      userFacingError(
                        err,
                        "Couldn't delete the message. Try again.",
                      ),
                    ),
                })
              }
            >
              Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode("view")}>
              Cancel
            </Button>
          </div>
        )}
        {message.replyCount > 0 && onOpenThread && !message.threadRootId && (
          <button
            type="button"
            tabIndex={tabIndex}
            // Where closing the thread hands focus back to.
            data-thread-link
            onClick={() => onOpenThread(message.id)}
            className="mt-1 inline-flex items-center gap-1 rounded-sm text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 pointer-coarse:min-h-11"
          >
            <span className="font-medium text-foreground underline-offset-2 hover:underline">
              {message.replyCount === 1
                ? "1 reply"
                : `${message.replyCount} replies`}
            </span>
            {message.lastReplyAt && (
              <span className="text-muted-foreground">
                · last {formatTime(message.lastReplyAt)}
              </span>
            )}
          </button>
        )}
      </div>
      {touchActions && (
        <TouchActions
          message={message}
          workspaceId={workspaceId}
          tabIndex={tabIndex}
          open={sheetOpen}
          byGesture={byGesture}
          onOpenChange={(open) => {
            setSheetOpen(open);
            if (!open) setByGesture(false);
          }}
          onReply={canReply ? () => onOpenThread!(message.id) : undefined}
          onEdit={canAct ? () => setMode("edit") : undefined}
          onDelete={canAct ? () => setMode("confirm-delete") : undefined}
        />
      )}
      {!coarse && mode === "view" && hasActions && (
        <div
          className={cn(
            "absolute top-0 right-3 -translate-y-1/3 flex items-center rounded-md border bg-background",
            "opacity-0 group-hover/message:opacity-100 group-focus-visible/message:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100",
          )}
        >
          {canReply && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              tabIndex={tabIndex}
              aria-label="Reply in thread"
              title="Reply in thread"
              onClick={() => onOpenThread!(message.id)}
            >
              <IconMessageReply />
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                tabIndex={tabIndex}
                aria-label="More actions"
                title="More actions"
              >
                <IconDots />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() =>
                  void copyToClipboard(
                    mentionBodyToPlainText(message.body),
                    "Message copied",
                    "Couldn't copy the message. Select it and copy instead.",
                  )
                }
              >
                <IconCopy />
                Copy text
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  void copyToClipboard(
                    messageLink(workspaceId, message),
                    "Link copied",
                    "Couldn't copy the link.",
                  )
                }
              >
                <IconLink />
                Copy link to message
              </DropdownMenuItem>
              {canAct && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setMode("edit")}>
                    <IconPencil />
                    Edit message
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() => setMode("confirm-delete")}
                  >
                    <IconTrash />
                    Delete message
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}

function highlighted(host: LineHost, message: ChatLine): boolean {
  return !!host.highlightId && host.highlightId === message.id;
}

interface TouchActionsProps {
  message: ChatMessageDto;
  workspaceId: string;
  /** -1 off the roving tab stop. */
  tabIndex?: number;
  open: boolean;
  /** Opened by a hold, not by the trigger: no item should look selected. */
  byGesture: boolean;
  onOpenChange: (open: boolean) => void;
  onReply?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

const SHEET_ITEM =
  "flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm outline-none hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 [&_svg]:size-5 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";

/**
 * A message's actions on a touch screen: a bottom sheet opened by a
 * press-and-hold, or by a "⋯" trigger that shows while the row holds focus
 * — after a tap on it, or a keyboard landing there. Hidden, it stays in the
 * accessibility tree, so a screen reader reaches it without a gesture.
 */
function TouchActions({
  message,
  workspaceId,
  tabIndex,
  open,
  byGesture,
  onOpenChange,
  onReply,
  onEdit,
  onDelete,
}: TouchActionsProps) {
  // Edit focuses its textarea and Reply navigates; the sheet must not hand
  // focus back to its trigger over either.
  const chose = useRef(false);
  const pick = (action: () => void) => () => {
    chose.current = true;
    onOpenChange(false);
    action();
  };
  const copy = () =>
    copyToClipboard(
      mentionBodyToPlainText(message.body),
      "Message copied",
      "Couldn't copy the message. Select it and copy instead.",
    );
  const copyLink = () =>
    copyToClipboard(
      messageLink(workspaceId, message),
      "Link copied",
      "Couldn't copy the link.",
    );
  const preview = mentionBodyToPlainText(message.body);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <button
          type="button"
          tabIndex={tabIndex}
          aria-label="Message actions"
          data-touch-actions-trigger
          className={cn(
            "absolute top-0 right-3 inline-flex size-11 -translate-y-1/4 items-center justify-center",
            "rounded-md border bg-background text-muted-foreground shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
            // Shown on the selected row only; invisible, it takes no taps.
            "pointer-events-none opacity-0 group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100 data-[state=open]:opacity-100",
          )}
        >
          <IconDots aria-hidden className="size-5" />
        </button>
      </SheetTrigger>
      <SheetContent
        side="bottom"
        className="gap-0 rounded-t-xl px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] outline-none"
        onOpenAutoFocus={(e) => {
          if (!byGesture) return;
          e.preventDefault();
          (e.currentTarget as HTMLElement).focus();
        }}
        onCloseAutoFocus={(e) => {
          if (chose.current) e.preventDefault();
          chose.current = false;
        }}
      >
        <div className="min-h-11 py-3 pr-12 pl-3">
          <SheetTitle className="text-sm">Message actions</SheetTitle>
          <SheetDescription className="line-clamp-2 break-words">
            {preview}
          </SheetDescription>
        </div>
        <div className="flex flex-col">
          {onReply && (
            <button type="button" className={SHEET_ITEM} onClick={pick(onReply)}>
              <IconMessageReply />
              Reply in thread
            </button>
          )}
          <button type="button" className={SHEET_ITEM} onClick={pick(copy)}>
            <IconCopy />
            Copy text
          </button>
          <button type="button" className={SHEET_ITEM} onClick={pick(copyLink)}>
            <IconLink />
            Copy link to message
          </button>
          {onEdit && (
            <button type="button" className={SHEET_ITEM} onClick={pick(onEdit)}>
              <IconPencil />
              Edit message
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              className={cn(SHEET_ITEM, "text-destructive [&_svg]:text-destructive")}
              onClick={pick(onDelete)}
            >
              <IconTrash />
              Delete message
            </button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Seed the mention map from the stored tokens so a save keeps them. */
function mentionsOf(body: string) {
  return parseMentionBody(body).flatMap((s) =>
    s.type === "mention" ? [{ userId: s.userId, username: s.username }] : [],
  );
}

function EditBox({
  message,
  workspaceId,
  members,
  onDone,
}: {
  message: ChatMessageDto;
  workspaceId: string;
  members?: MentionMember[];
  onDone: () => void;
}) {
  const [text, setText] = useState(() => mentionBodyToPlainText(message.body));
  const edit = useEditMessage(workspaceId);
  const ref = useRef<HTMLTextAreaElement>(null);
  const trimmed = text.trim();

  useEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }, []);

  const save = () => {
    if (!trimmed || tooLong || edit.isPending) return;
    const body = mention.applyMentions(text).trim();
    if (body === message.body) {
      onDone();
      return;
    }
    edit.mutate(
      { messageId: message.id, body },
      {
        onSuccess: onDone,
        onError: (err) =>
          toast.error(
            userFacingError(err, "Couldn't save your edit. Try again."),
          ),
      },
    );
  };

  // IME keystrokes and keys the mention list takes never reach this.
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onDone();
    }
  };

  const mention = useMentionAutocomplete({
    textareaRef: ref,
    onChange: setText,
    members,
    onKeyDown,
    initialMentions: mentionsOf(message.body),
  });
  // Measured as sent: picked mentions expand into their tokens.
  const tooLong = mention.applyMentions(text).trim().length > CHAT_BODY_MAX;

  return (
    <div className="mt-1 flex flex-col gap-2">
      <div className="relative">
        <Textarea
          ref={ref}
          value={text}
          aria-label="Edit message"
          // The Chat page's channel keys stand down while this is open.
          data-chat-edit=""
          aria-invalid={tooLong || undefined}
          className="min-h-16 resize-none"
          {...mention.inputProps}
        />
        {mention.listbox}
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={save}
          disabled={!trimmed || tooLong || edit.isPending}
        >
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <span className="text-xs text-muted-foreground">
          Enter to save · Esc to cancel
        </span>
      </div>
    </div>
  );
}
