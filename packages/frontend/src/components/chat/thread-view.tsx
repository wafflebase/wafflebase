import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { fetchMe } from "@/api/auth";
import { fetchMessage, fetchMessages } from "@/api/chat";
import { userFacingError } from "@/api/http-error";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useWorkspaceMembers } from "@/components/comments/use-workspace-members";
import { chatKeys } from "./chat-cache";
import { Composer } from "./composer";
import { groupMessages } from "./group-messages";
import { MessageGroupView } from "./message-item";
import { useFlashMessage } from "./use-flash-message";
import { useChannels, usePostMessage, useThreadMessages } from "./use-chat";

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
 * and reads as deleted.
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
  const members = useWorkspaceMembers(workspaceId);
  const thread = useThreadMessages(workspaceId, channelId, rootId);
  const post = usePostMessage(workspaceId, channelId);
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
  const groups = useMemo(() => groupMessages(replies), [replies]);

  const present =
    !!highlightMessageId && replies.some((m) => m.id === highlightMessageId);
  const flashing = useFlashMessage(highlightMessageId, present);

  const scrollRef = useRef<HTMLDivElement>(null);
  const lastReply = replies.at(-1)?.id;
  useEffect(() => {
    const el = scrollRef.current;
    if (el && !highlightMessageId) el.scrollTop = el.scrollHeight;
  }, [lastReply, highlightMessageId]);

  const send = async (body: string) => {
    try {
      await post.mutateAsync({ body, threadRootId: rootId, alsoInChannel });
      setAlsoInChannel(false);
    } catch (err) {
      toast.error(userFacingError(err, "Couldn't send your reply. Try again."));
      throw err;
    }
  };

  const checkboxId = `also-in-channel-${rootId}`;
  const canPost = channel
    ? !(channel.kind === "public" && !channel.isMember)
    : true;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3"
        role="log"
        aria-label="Thread"
      >
        {root ? (
          <ol className="border-b pb-2">
            <MessageGroupView
              group={{ author: root.author, first: root, rest: [] }}
              workspaceId={workspaceId}
              me={meId}
            />
          </ol>
        ) : null}
        {thread.isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">Loading replies…</p>
        ) : thread.error ? (
          <p className="p-4 text-sm text-muted-foreground">
            {userFacingError(thread.error, "Couldn't load this thread.")}
          </p>
        ) : replies.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No replies yet.</p>
        ) : (
          <>
            <p className="mx-4 mt-3 text-xs font-medium text-muted-foreground">
              {replies.length === 1 ? "1 reply" : `${replies.length} replies`}
            </p>
            <ol className="flex flex-col">
              {groups.map((g) => (
                <MessageGroupView
                  key={g.first.id}
                  group={g}
                  workspaceId={workspaceId}
                  me={meId}
                  highlightId={flashing}
                />
              ))}
            </ol>
          </>
        )}
      </div>
      {canPost && (
        <div className="border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Composer
            channelId={`${channelId}:thread:${rootId}`}
            onSend={send}
            members={members}
            placeholder="Reply…"
            autoFocus
            disabledReason={
              channel?.archived
                ? "This channel is archived. You can read it, but not post."
                : undefined
            }
            footer={
              <div className="flex items-center gap-2 pointer-coarse:min-h-11">
                <Checkbox
                  id={checkboxId}
                  checked={alsoInChannel}
                  onCheckedChange={(v) => setAlsoInChannel(v === true)}
                />
                <Label
                  htmlFor={checkboxId}
                  className="text-xs font-normal text-muted-foreground"
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
