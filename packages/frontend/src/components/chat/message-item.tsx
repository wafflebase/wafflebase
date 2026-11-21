import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  IconDots,
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
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import {
  mentionBodyToPlainText,
  parseMentionBody,
  applySelectedMentions,
} from "@/components/comments/mentions";
import { cn } from "@/lib/utils";
import { formatTime } from "./format-time";
import type { MessageGroup } from "./group-messages";
import { MessageBody } from "./message-body";
import { useDeleteMessage, useEditMessage } from "./use-chat";

const UNKNOWN_AUTHOR = "Deleted user";

function ChatAvatar({ author }: { author: ChatMessageDto["author"] }) {
  const name = author?.username ?? "?";
  return (
    <Avatar className="size-8 shrink-0">
      {author?.photo && <AvatarImage src={author.photo} alt="" />}
      <AvatarFallback className="text-xs">{avatarInitials(name)}</AvatarFallback>
    </Avatar>
  );
}

interface GroupProps {
  group: MessageGroup;
  workspaceId: string;
  me: number;
  highlightId?: string | null;
  /** Omitted inside a thread, where a reply cannot start another thread. */
  onOpenThread?: (rootId: string) => void;
}

/** One author's run of messages: avatar and name once, then each line. */
export function MessageGroupView({
  group,
  workspaceId,
  me,
  highlightId,
  onOpenThread,
}: GroupProps) {
  const lines = [group.first, ...group.rest];
  return (
    <li className="flex flex-col">
      {lines.map((m, i) => (
        <MessageLine
          key={m.id}
          message={m}
          showHeader={i === 0}
          author={group.author}
          workspaceId={workspaceId}
          mine={!!m.author && m.author.id === me}
          highlighted={highlightId === m.id}
          onOpenThread={onOpenThread}
        />
      ))}
    </li>
  );
}

interface LineProps {
  message: ChatMessageDto;
  showHeader: boolean;
  author: ChatMessageDto["author"];
  workspaceId: string;
  mine: boolean;
  highlighted: boolean;
  onOpenThread?: (rootId: string) => void;
}

function MessageLine({
  message,
  showHeader,
  author,
  workspaceId,
  mine,
  highlighted,
  onOpenThread,
}: LineProps) {
  const [mode, setMode] = useState<"view" | "edit" | "confirm-delete">("view");
  const remove = useDeleteMessage(workspaceId);
  const canAct = mine && !message.deleted;
  const canReply = !!onOpenThread && !message.threadRootId && !message.deleted;

  return (
    <div
      id={`chat-message-${message.id}`}
      data-message-id={message.id}
      className={cn(
        "group/message relative flex gap-3 px-4 py-1 hover:bg-muted/60",
        "motion-safe:transition-colors motion-safe:duration-700",
        highlighted && "bg-selected hover:bg-selected",
        showHeader && "mt-2 pt-2",
      )}
    >
      <div className="w-8 shrink-0">
        {showHeader ? (
          <ChatAvatar author={author} />
        ) : (
          <time
            dateTime={message.createdAt}
            className="hidden pt-0.5 text-2xs text-muted-foreground tabular-nums group-hover/message:inline"
          >
            {formatTime(message.createdAt)}
          </time>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {showHeader && (
          <div className="flex items-baseline gap-2">
            <span className="truncate text-sm font-semibold text-foreground">
              {author?.username ?? UNKNOWN_AUTHOR}
            </span>
            <time
              dateTime={message.createdAt}
              className="text-xs text-muted-foreground tabular-nums"
            >
              {formatTime(message.createdAt)}
            </time>
          </div>
        )}
        {message.threadRootId && message.alsoInChannel && onOpenThread && (
          <button
            type="button"
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
            onDone={() => setMode("view")}
          />
        ) : message.deleted ? (
          <p className="text-sm italic text-muted-foreground">
            This message was deleted
          </p>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-1">
            <MessageBody body={message.body} />
            {message.editedAt && (
              <span className="text-xs text-muted-foreground">(edited)</span>
            )}
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
      {mode === "view" && (canReply || canAct) && (
        <div
          className={cn(
            "absolute top-0 right-3 -translate-y-1/3 flex items-center rounded-md border bg-background",
            "opacity-0 group-hover/message:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100",
            "pointer-coarse:opacity-100",
          )}
        >
          {canReply && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="Reply in thread"
              title="Reply in thread"
              onClick={() => onOpenThread!(message.id)}
            >
              <IconMessageReply />
            </Button>
          )}
          {canAct && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label="More actions"
                >
                  <IconDots />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
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
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}
    </div>
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
  onDone,
}: {
  message: ChatMessageDto;
  workspaceId: string;
  onDone: () => void;
}) {
  const [text, setText] = useState(() => mentionBodyToPlainText(message.body));
  const edit = useEditMessage(workspaceId);
  const ref = useRef<HTMLTextAreaElement>(null);
  const trimmed = text.trim();
  const tooLong = text.length > CHAT_BODY_MAX;

  useEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }, []);

  const save = () => {
    if (!trimmed || tooLong || edit.isPending) return;
    const body = applySelectedMentions(text, mentionsOf(message.body)).trim();
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

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onDone();
    }
  };

  return (
    <div className="mt-1 flex flex-col gap-2">
      <Textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        aria-label="Edit message"
        aria-invalid={tooLong || undefined}
        className="min-h-16 resize-none"
      />
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
