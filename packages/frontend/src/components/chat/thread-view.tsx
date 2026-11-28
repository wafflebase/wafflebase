import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { fetchMe } from "@/api/auth";
import { fetchMessage, fetchMessages } from "@/api/chat";
import { userFacingError } from "@/api/http-error";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { chatKeys, withPending } from "./chat-cache";
import { Composer } from "./composer";
import { groupMessages, lastOwnMessage } from "./group-messages";
import { MessageGroupView } from "./message-item";
import { useArrivalAnnouncement } from "./use-arrival-announcement";
import { useFlashMessage } from "./use-flash-message";
import {
  useChannels,
  useJoinChannel,
  usePendingMessages,
  useSendMessage,
  useThreadMessages,
} from "./use-chat";
import { useRovingMessages } from "./use-roving-messages";
import { useMentionableMembers } from "./use-mentionable-members";

/** Within this of the end still counts as reading the newest reply. */
const BOTTOM_SLACK_PX = 48;

interface ThreadViewProps {
  workspaceId: string;
  channelId: string;
  rootId: string;
  /** A reply to scroll to and highlight (a deep link). */
  highlightMessageId?: string | null;
}

/**
 * A thread: its root, the replies under it, and a reply box that can also
 * send the reply to the channel. A deleted root still anchors its replies
 * and reads as deleted. Like the channel log it is one tab stop with a
 * separate polite region for arriving replies, and its sends are optimistic.
 */
export function ThreadView({
  workspaceId,
  channelId,
  rootId,
  highlightMessageId,
}: ThreadViewProps) {
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const meId = me?.id ?? -1;
  const { data: channels } = useChannels(workspaceId);
  const channel = channels?.find((c) => c.id === channelId);
  const members = useMentionableMembers(workspaceId, channel);
  const thread = useThreadMessages(workspaceId, channelId, rootId);
  const pending = usePendingMessages(channelId, rootId);
  const sender = useSendMessage(workspaceId, channelId);
  const join = useJoinChannel(workspaceId);
  const [alsoInChannel, setAlsoInChannel] = useState(false);

  // The root normally sits in the channel's cache (observed here, never
  // fetched — the conversation owns that query) or in a thread page that
  // carries it. A deep link into an old thread has neither, so it is looked
  // up on its own.
  const { data: channelMessages } = useQuery({
    queryKey: chatKeys.messages(channelId),
    queryFn: () => fetchMessages(workspaceId, channelId),
    enabled: false,
  });
  const cachedRoot =
    thread.data?.find((m) => m.id === rootId) ??
    channelMessages?.find((m) => m.id === rootId);
  const { data: fetchedRoot } = useQuery({
    queryKey: ["chat", "message", rootId],
    queryFn: () => fetchMessage(workspaceId, rootId),
    enabled: !cachedRoot && !thread.isLoading,
    retry: false,
  });
  const root = cachedRoot ?? fetchedRoot ?? null;
  const replies = useMemo(
    () => (thread.data ?? []).filter((m) => m.id !== rootId),
    [thread.data, rootId],
  );
  const display = useMemo(
    () => withPending(replies, pending),
    [replies, pending],
  );
  const groups = useMemo(() => groupMessages(display), [display]);
  // Until the thread is read back to its root, the root's own count is the
  // only one that covers the replies not loaded yet.
  const replyCount =
    thread.hasOlder && root
      ? Math.max(root.replyCount, replies.length)
      : replies.length;
  const loadOlder = () =>
    thread
      .loadOlder()
      .catch((err: unknown) =>
        toast.error(userFacingError(err, "Couldn't load earlier replies.")),
      );

  const present =
    !!highlightMessageId && replies.some((m) => m.id === highlightMessageId);
  const flashing = useFlashMessage(highlightMessageId, present);

  // A thread opens at its root, as Slack's does: the root is the context
  // every reply answers. A deep link instead scrolls its reply into view
  // (`useFlashMessage`). After that, a new reply is followed only by a
  // reader already at the end, or by the one who just sent it.
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(false);
  const opened = useRef(false);
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK_PX;
  }, []);
  const lastReply = display.at(-1)?.id;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || thread.isLoading) return;
    if (!opened.current) {
      opened.current = true;
      if (!highlightMessageId) el.scrollTop = 0;
    } else if (atBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
    onScroll();
  }, [lastReply, thread.isLoading, highlightMessageId, onScroll]);

  // Optimistic, as in the channel: the reply is drawn at once (and followed
  // to the end), and a failure stays on its row with Retry rather than
  // being thrown back at the composer.
  const reportSendError = useCallback(
    (err: unknown) =>
      toast.error(userFacingError(err, "Couldn't send your reply.")),
    [],
  );
  const send = (body: string) => {
    atBottomRef.current = true;
    sender
      .send({ body, threadRootId: rootId, alsoInChannel })
      .catch(reportSendError);
    setAlsoInChannel(false);
  };
  const retrySend = useCallback(
    (clientId: string) => {
      atBottomRef.current = true;
      sender.retry(clientId)?.catch(reportSendError);
    },
    [sender, reportSendError],
  );

  const composerRef = useRef<HTMLDivElement>(null);
  const focusComposer = useCallback(() => {
    composerRef.current
      ?.querySelector<HTMLElement>("textarea")
      ?.focus({ preventScroll: true });
  }, []);

  // The root is a row too, first in the order. No Escape handler: Esc in
  // a thread belongs to the page, which closes the thread.
  const ids = useMemo(
    () => [...(root ? [root.id] : []), ...display.map((m) => m.id)],
    [root, display],
  );
  const roving = useRovingMessages(scrollRef, ids);

  const [editingId, setEditingId] = useState<string | null>(null);
  const editFromComposer = useRef(false);
  const startEdit = useCallback((id: string) => {
    editFromComposer.current = false;
    setEditingId(id);
  }, []);
  const endEdit = useCallback(
    (id: string) => {
      setEditingId(null);
      if (editFromComposer.current) focusComposer();
      else roving.focusRow(id);
      editFromComposer.current = false;
    },
    [focusComposer, roving],
  );
  const editLast = useCallback(() => {
    const last = lastOwnMessage(replies, meId);
    if (!last) return;
    editFromComposer.current = true;
    setEditingId(last.id);
  }, [replies, meId]);

  const arrival = useArrivalAnnouncement(replies, meId, !thread.isLoading && !!me);
  const host = {
    workspaceId,
    me: meId,
    members,
    activeId: roving.activeId,
    editingId,
    onEdit: startEdit,
    onEditDone: endEdit,
    onRetry: retrySend,
    onDiscard: sender.discard,
  };

  const refreshFailed = !!thread.error && !!thread.data?.length;
  const checkboxId = `also-in-channel-${rootId}`;
  // An archived channel gets the composer anyway, disabled with its reason,
  // so a non-member previewing one is told why there is no reply box.
  const canPost = channel
    ? channel.archived || !(channel.kind === "public" && !channel.isMember)
    : true;
  // A public channel's thread is readable before joining; say why there is
  // no reply box, and offer the join — not on an archived channel, which the
  // server refuses to join.
  const joinToReply =
    channel?.kind === "public" && !channel.isMember && !channel.archived;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        onKeyDown={roving.onKeyDown}
        onFocus={roving.onFocus}
        // Not a region of its own: the column around it is the Thread
        // landmark, and a second one by the same name only doubles it.
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3"
      >
        {root ? (
          // `pt-1` keeps the root's hover toolbar, which rides up over the
          // row's top edge, inside the scroller instead of clipped by it.
          <ol className="border-b pt-1 pb-2">
            <MessageGroupView
              group={{ author: root.author, first: root, rest: [] }}
              {...host}
            />
          </ol>
        ) : null}
        {thread.isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">Loading replies…</p>
        ) : thread.error && !thread.data?.length ? (
          <div className="flex flex-col items-start gap-3 p-4">
            <p role="alert" className="text-sm text-muted-foreground">
              {userFacingError(thread.error, "Couldn't load this thread.")}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void thread.retry()}
            >
              Retry
            </Button>
          </div>
        ) : display.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No replies yet.</p>
        ) : (
          <>
            <p className="mx-4 mt-3 text-xs font-medium text-muted-foreground">
              {replyCount === 1 ? "1 reply" : `${replyCount} replies`}
            </p>
            {thread.hasOlder && (
              // Below the root and above the replies it reads in, so the
              // reader's place does not move when they arrive.
              <div className="mx-4 mt-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="pointer-coarse:min-h-11"
                  onClick={() => void loadOlder()}
                  disabled={thread.loadingOlder}
                >
                  {thread.loadingOlder ? "Loading…" : "Show earlier replies"}
                </Button>
              </div>
            )}
            <ol className="flex flex-col">
              {groups.map((g) => (
                <MessageGroupView
                  key={g.first.id}
                  group={g}
                  {...host}
                  highlightId={flashing}
                />
              ))}
            </ol>
          </>
        )}
        {refreshFailed && (
          // A failed refetch keeps the replies React Query already holds;
          // replacing them with the error state would throw away the
          // reader's place for a background read they never asked for.
          <div className="mx-4 mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <span>Couldn't refresh replies.</span>
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs pointer-coarse:min-h-11"
              onClick={() => void thread.retry()}
            >
              Retry
            </Button>
          </div>
        )}
      </div>
      <span aria-live="polite" className="sr-only">
        {arrival}
      </span>
      {joinToReply && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <p className="text-sm text-muted-foreground">
            Join #{channel.name} to reply.
          </p>
          {/* Outline: the conversation beside it offers the same join as
              its primary action. */}
          <Button
            variant="outline"
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
      )}
      {canPost && (
        <div
          ref={composerRef}
          className="border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        >
          <Composer
            channelId={`${channelId}:thread:${rootId}`}
            userId={me?.id}
            onSend={send}
            onArrowUpWhenEmpty={editLast}
            members={members}
            placeholder="Reply…"
            autoFocus
            disabledReason={
              channel?.archived
                ? "This channel is archived. You can read it, but not post."
                : undefined
            }
            footer={
              <div className="flex min-w-0 items-center gap-2 pointer-coarse:min-h-11">
                <Checkbox
                  id={checkboxId}
                  checked={alsoInChannel}
                  onCheckedChange={(v) => setAlsoInChannel(v === true)}
                />
                {/* One line: a long channel name truncates instead of
                    folding the label under itself. */}
                <Label
                  htmlFor={checkboxId}
                  className="block min-w-0 truncate text-xs leading-5 font-normal text-muted-foreground"
                >
                  {channel?.kind === "dm"
                    ? "Also send to the conversation"
                    : `Also send to ${channel?.name ? `#${channel.name}` : "the channel"}`}
                </Label>
              </div>
            }
          />
        </div>
      )}
    </div>
  );
}
