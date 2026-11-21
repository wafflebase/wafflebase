import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { fetchMe } from "@/api/auth";
import { userFacingError } from "@/api/http-error";
import { Button } from "@/components/ui/button";
import { useWorkspaceMembers } from "@/components/comments/use-workspace-members";
import { Composer } from "./composer";
import { groupMessages, type MessageGroup } from "./group-messages";
import { MessageGroupView } from "./message-item";
import { useFlashMessage } from "./use-flash-message";
import {
  useChannelMessages,
  useChannels,
  useJoinChannel,
  useMarkRead,
  usePostMessage,
} from "./use-chat";
import { setOpenChatChannel } from "./use-chat-stream";

/** Within this many pixels of the end counts as "at the bottom". */
const BOTTOM_SLACK_PX = 48;
/** How far back a deep link may page to find its message. */
const MAX_DEEP_LINK_PAGES = 10;

interface ConversationProps {
  workspaceId: string;
  channelId: string;
  onOpenThread: (rootId: string) => void;
  /** A message to scroll to and highlight (a deep link). */
  highlightMessageId?: string | null;
  /** The composer's placeholder, e.g. "Message #general". */
  placeholder?: string;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

/**
 * A channel's message log and composer, with no page chrome — the Chat page
 * wraps it in its own header, and P2's editor panel is meant to reuse it.
 *
 * It sticks to the bottom as messages arrive only while the reader is
 * already there, so scrolling back through history is never yanked away, and
 * it advances the read position when the newest message is in view. Mount it
 * with `key={channelId}` so each channel starts at its own newest message.
 */
export function Conversation({
  workspaceId,
  channelId,
  onOpenThread,
  highlightMessageId,
  placeholder,
}: ConversationProps) {
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const meId = me?.id ?? -1;
  const { data: channels } = useChannels(workspaceId);
  const channel = channels?.find((c) => c.id === channelId);
  const members = useWorkspaceMembers(workspaceId);
  const { messages, isLoading, error, hasOlder, loadingOlder, loadOlder } =
    useChannelMessages(workspaceId, channelId);
  const post = usePostMessage(workspaceId, channelId);
  const join = useJoinChannel(workspaceId);
  const markRead = useMarkRead(workspaceId, channelId);

  useEffect(() => {
    setOpenChatChannel({ workspaceId, channelId });
    return () => setOpenChatChannel(null);
  }, [workspaceId, channelId]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const next =
      el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK_PX;
    atBottomRef.current = next;
    setAtBottom(next);
  }, []);

  // Keep the reader's place when older messages are prepended: the content
  // above grows, so shift by exactly the height it grew.
  const prependAnchor = useRef<{ height: number; top: number } | null>(null);
  const firstId = messages[0]?.id;
  const lastId = messages.at(-1)?.id;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const anchor = prependAnchor.current;
    if (anchor) {
      el.scrollTop = anchor.top + (el.scrollHeight - anchor.height);
      prependAnchor.current = null;
      return;
    }
    if (atBottomRef.current && !highlightMessageId) {
      el.scrollTop = el.scrollHeight;
    }
  }, [firstId, lastId, highlightMessageId]);

  const handleLoadOlder = useCallback(async () => {
    const el = scrollRef.current;
    if (el) prependAnchor.current = { height: el.scrollHeight, top: el.scrollTop };
    try {
      // Nothing prepended means no layout run will consume the anchor, and a
      // stale one would hold the next arriving message off the bottom.
      if (!(await loadOlder())) prependAnchor.current = null;
    } catch (err) {
      prependAnchor.current = null;
      toast.error(userFacingError(err, "Couldn't load older messages."));
    }
  }, [loadOlder]);

  // A deep link to an older message pages back until it is loaded.
  const present =
    !!highlightMessageId && messages.some((m) => m.id === highlightMessageId);
  const pagedFor = useRef(0);
  useEffect(() => {
    pagedFor.current = 0;
  }, [highlightMessageId]);
  useEffect(() => {
    if (!highlightMessageId || present || isLoading || loadingOlder) return;
    if (!hasOlder || pagedFor.current >= MAX_DEEP_LINK_PAGES) return;
    pagedFor.current += 1;
    void loadOlder().catch(() => {});
  }, [highlightMessageId, present, isLoading, loadingOlder, hasOlder, loadOlder]);
  const flashing = useFlashMessage(highlightMessageId, present);

  // Read up to the newest message whenever it is in view and the tab is.
  const newestSeq = messages.at(-1)?.seq;
  useEffect(() => {
    if (!atBottom || newestSeq === undefined || !channel?.isMember) return;
    const tryMark = () => {
      if (document.visibilityState === "visible") markRead(newestSeq);
    };
    tryMark();
    document.addEventListener("visibilitychange", tryMark);
    return () => document.removeEventListener("visibilitychange", tryMark);
  }, [atBottom, newestSeq, channel?.isMember, markRead]);

  const groups = useMemo(() => groupMessages(messages), [messages]);

  const send = async (body: string) => {
    try {
      await post.mutateAsync({ body });
      atBottomRef.current = true;
      setAtBottom(true);
    } catch (err) {
      toast.error(
        userFacingError(err, "Couldn't send your message. Try again."),
      );
      throw err;
    }
  };

  const readOnlyPreview = channel?.kind === "public" && !channel.isMember;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        aria-label="Messages"
        role="log"
      >
        {isLoading ? (
          <p className="p-6 text-sm text-muted-foreground">Loading messages…</p>
        ) : error ? (
          <p className="p-6 text-sm text-muted-foreground">
            {userFacingError(error, "Couldn't load messages. Reload to try again.")}
          </p>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center">
            <p className="text-sm font-medium text-foreground">
              No messages yet
            </p>
            <p className="text-sm text-muted-foreground">
              Say hello to start the conversation.
            </p>
          </div>
        ) : (
          <div className="pb-3">
            {hasOlder && (
              <div className="flex justify-center py-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleLoadOlder()}
                  disabled={loadingOlder}
                >
                  {loadingOlder ? "Loading…" : "Load older messages"}
                </Button>
              </div>
            )}
            <ol className="flex flex-col">
              {groups.map((g, i) => (
                <Fragment key={g.first.id}>
                  {startsNewDay(groups, i) && (
                    <li
                      role="separator"
                      className="mx-4 mt-4 flex items-center gap-3 text-xs font-medium text-muted-foreground"
                    >
                      <span className="h-px flex-1 bg-border" />
                      {dayLabel(g.first.createdAt)}
                      <span className="h-px flex-1 bg-border" />
                    </li>
                  )}
                  <MessageGroupView
                    group={g}
                    workspaceId={workspaceId}
                    me={meId}
                    highlightId={flashing}
                    onOpenThread={onOpenThread}
                  />
                </Fragment>
              ))}
            </ol>
          </div>
        )}
      </div>
      <div className="border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {readOnlyPreview ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              You're previewing #{channel.name}. Join to send messages.
            </p>
            <Button
              onClick={() =>
                join.mutate(channelId, {
                  onError: (err) =>
                    toast.error(
                      userFacingError(err, "Couldn't join the channel."),
                    ),
                })
              }
              disabled={join.isPending}
            >
              Join channel
            </Button>
          </div>
        ) : (
          <Composer
            channelId={channelId}
            onSend={send}
            members={members}
            placeholder={placeholder}
            autoFocus
            disabledReason={
              channel?.archived
                ? "This channel is archived. You can read it, but not post."
                : undefined
            }
          />
        )}
      </div>
    </div>
  );
}

function startsNewDay(groups: MessageGroup[], i: number): boolean {
  if (i === 0) return true;
  const prev = new Date(groups[i - 1].first.createdAt).toDateString();
  return prev !== new Date(groups[i].first.createdAt).toDateString();
}
