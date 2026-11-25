import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconHash,
  IconLock,
  IconUser,
  IconUsers,
  IconX,
} from "@tabler/icons-react";

import { fetchMe } from "@/api/auth";
import type { ChannelSummary } from "@/api/chat";
import { fetchWorkspaces, type Workspace } from "@/api/workspaces";
import { channelLabel } from "@/app/chat/group-channels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SIDE_PANEL_CLASS } from "@/components/side-panel-layout";
import { cn } from "@/lib/utils";
import { channelCount } from "./chat-cache";
import {
  panelChannels,
  pickPanelChannel,
  useDocumentSharedChannelId,
} from "./chat-panel-channel";
import { useChatPanelState } from "./chat-panel-context";
import { Conversation } from "./conversation";
import { readLastChannel, writeLastChannel } from "./last-channel";
import { ThreadView } from "./thread-view";
import { useChannels } from "./use-chat";

function ChannelIcon({ channel }: { channel: ChannelSummary }) {
  const className = "size-4 shrink-0 text-muted-foreground";
  if (channel.kind === "private") return <IconLock aria-hidden className={className} />;
  if (channel.kind === "dm") {
    const Icon = channel.members.length > 2 ? IconUsers : IconUser;
    return <Icon aria-hidden className={className} />;
  }
  return <IconHash aria-hidden className={className} />;
}

/**
 * The editor's chat panel: one channel's conversation and composer in the
 * right-hand slot, with a switcher over the user's channels and a link to
 * the Chat page for everything else (channel list, search, files). The
 * conversation is the Chat page's own `Conversation`, so the two surfaces
 * share messages, drafts and the read position — reading here marks the
 * channel read there.
 *
 * A thread opens in place of the conversation, with a way back. Docked on
 * desktop, a bottom sheet on a phone (`SIDE_PANEL_CLASS`). Must render inside
 * a `ChatPanelProvider`; the page withholds it during a revision preview.
 */
export function ChatPanel({
  workspaceId,
  documentId,
}: {
  workspaceId: string;
  documentId: string;
}) {
  const state = useChatPanelState();
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const meId = me?.id ?? -1;
  const { data: workspaces } = useQuery<Workspace[]>({
    queryKey: ["workspaces"],
    queryFn: fetchWorkspaces,
  });
  const slug = workspaces?.find((w) => w.id === workspaceId)?.slug ?? workspaceId;
  const channelsQuery = useChannels(workspaceId);
  const channels = channelsQuery.data;
  const sharedIn = useDocumentSharedChannelId(workspaceId, documentId);

  const requested = state?.channelId ?? null;
  // Waits for `sharedIn` as well as the list: picking a fallback first and
  // switching once it arrives would move the conversation under the user.
  const channelId = channels && sharedIn !== undefined
    ? pickPanelChannel({
        channels,
        requested,
        sharedIn,
        last: readLastChannel(workspaceId),
      })
    : null;
  const channel = channels?.find((c) => c.id === channelId);
  const label = channel ? channelLabel(channel, meId) : "";

  // A thread belongs to its channel; switching channel closes it.
  const [thread, setThread] = useState<{ channelId: string; rootId: string } | null>(
    null,
  );
  // Cleared, not just hidden: coming back to the channel shows its
  // conversation, not the thread left open in it.
  if (thread && thread.channelId !== channelId) setThread(null);
  const threadId = thread && thread.channelId === channelId ? thread.rootId : null;

  // A draft from `open({ draft })` without a channel goes to whichever one
  // the panel settles on.
  const pendingDraft = state?.pendingDraft ?? null;
  const takePendingDraft = state?.takePendingDraft;
  useEffect(() => {
    if (channelId && pendingDraft !== null) takePendingDraft?.(channelId);
  }, [channelId, pendingDraft, takePendingDraft]);

  const pick = (id: string) => {
    state?.selectChannel(id);
    writeLastChannel(workspaceId, id);
  };

  const chatHref = channelId
    ? `/w/${slug}/chat/${channelId}${threadId ? `?thread=${threadId}` : ""}`
    : `/w/${slug}/chat`;
  const listed = channels ? panelChannels(channels, channelId) : [];

  return (
    <aside
      className={cn(SIDE_PANEL_CLASS, "md:w-80")}
      aria-label={label ? `Chat: ${label}` : "Chat"}
    >
      <header className="flex items-center gap-1 border-b py-2 pr-2 pl-1">
        {threadId ? (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 pointer-coarse:size-11"
              aria-label="Back to conversation"
              onClick={() => setThread(null)}
            >
              <IconChevronLeft />
            </Button>
            <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
              Thread
              {label && (
                <span className="ml-2 font-normal text-muted-foreground">
                  {channel?.kind === "dm" ? label : `#${label}`}
                </span>
              )}
            </h2>
          </>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="h-8 min-w-0 flex-1 justify-start gap-1.5 px-2 pointer-coarse:h-11"
                aria-label={label ? `Channel: ${label}. Switch channel` : "Switch channel"}
                disabled={!channels || listed.length === 0}
              >
                {channel && <ChannelIcon channel={channel} />}
                <span className="truncate text-sm font-semibold">
                  {label || "Chat"}
                </span>
                <IconChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="max-h-80 w-64 overflow-y-auto"
            >
              {listed.map((c) => {
                const count = channelCount(c);
                return (
                  <DropdownMenuItem key={c.id} onSelect={() => pick(c.id)}>
                    <ChannelIcon channel={c} />
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate",
                        c.unreadCount > 0 && "font-semibold",
                      )}
                    >
                      {channelLabel(c, meId)}
                    </span>
                    {count > 0 ? (
                      <Badge className="h-5 min-w-5 px-1.5 text-2xs tabular-nums">
                        {count > 99 ? "99+" : count}
                      </Badge>
                    ) : c.unreadCount > 0 ? (
                      <span
                        aria-hidden
                        className="size-2 shrink-0 rounded-full bg-foreground"
                      />
                    ) : null}
                    {c.id === channelId && (
                      <IconCheck aria-label="Current channel" className="size-4 shrink-0" />
                    )}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Link
          to={chatHref}
          className="shrink-0 rounded-sm px-1.5 text-xs text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          Open in Chat
        </Link>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 pointer-coarse:size-11"
          aria-label="Close chat panel"
          onClick={() => state?.api.close()}
        >
          <IconX />
        </Button>
      </header>

      {!channels || sharedIn === undefined ? (
        channelsQuery.isError ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-sm text-muted-foreground">
              Couldn't load your channels.
            </p>
            <Button variant="outline" size="sm" onClick={() => void channelsQuery.refetch()}>
              Retry
            </Button>
          </div>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">Loading…</p>
        )
      ) : !channelId ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            You're not in any channels yet.
          </p>
          <Button variant="outline" size="sm" asChild>
            <Link to={`/w/${slug}/chat`}>Go to Chat</Link>
          </Button>
        </div>
      ) : threadId ? (
        // `ThreadView` is chrome-free; the landmark is its host's to draw.
        <section aria-label="Thread" className="flex min-h-0 flex-1 flex-col">
          <ThreadView
            key={threadId}
            workspaceId={workspaceId}
            channelId={channelId}
            rootId={threadId}
          />
        </section>
      ) : (
        <Conversation
          key={channelId}
          // Remounts the composer alone so a draft put in the store by
          // `open({ draft })` shows up.
          draftSeed={state?.draftSeed ?? 0}
          workspaceId={workspaceId}
          channelId={channelId}
          onOpenThread={(rootId) => setThread({ channelId, rootId })}
          placeholder={
            channel?.kind === "dm" ? `Message ${label}` : `Message #${label}`
          }
        />
      )}
    </aside>
  );
}
