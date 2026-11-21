import { useCallback, useEffect, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  IconChevronLeft,
  IconDots,
  IconHash,
  IconLock,
  IconUserPlus,
  IconLogout,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";

import { fetchMe } from "@/api/auth";
import { fetchMessage, type ChannelSummary } from "@/api/chat";
import { userFacingError } from "@/api/http-error";
import { fetchWorkspaces, type Workspace } from "@/api/workspaces";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Conversation } from "@/components/chat/conversation";
import { ThreadView } from "@/components/chat/thread-view";
import { useChannels, useLeaveChannel } from "@/components/chat/use-chat";
import { MOBILE_BREAKPOINT, useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { ChannelList } from "./channel-list";
import { chatLayout } from "./chat-layout";
import { channelLabel } from "./group-channels";
import { NewChannelDialog } from "./new-channel-dialog";
import { AddPeopleDialog, NewDmDialog } from "./new-dm-dialog";

const LAST_CHANNEL_KEY = (workspaceId: string) =>
  `wafflebase:chat-last:${workspaceId}`;

function readLastChannel(workspaceId: string): string | null {
  try {
    return window.localStorage.getItem(LAST_CHANNEL_KEY(workspaceId));
  } catch {
    return null;
  }
}

function writeLastChannel(workspaceId: string, channelId: string): void {
  try {
    window.localStorage.setItem(LAST_CHANNEL_KEY(workspaceId), channelId);
  } catch {
    // A convenience only.
  }
}

/**
 * `/w/:workspaceId/chat/:channelId?` — channel list, conversation and, with
 * `?thread=<rootId>`, a thread column. `?message=<id>` (a bell deep link)
 * scrolls to that message and opens its thread when it is a reply. On a phone
 * the page shows one level at a time; see `chatLayout`.
 */
export default function ChatPage() {
  const { workspaceId: workspaceParam = "", channelId = null } = useParams<{
    workspaceId: string;
    channelId?: string;
  }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const threadId = searchParams.get("thread");
  const messageId = searchParams.get("message");
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const { data: workspaces } = useQuery<Workspace[]>({
    queryKey: ["workspaces"],
    queryFn: fetchWorkspaces,
  });
  const workspace = workspaces?.find(
    (w) => w.slug === workspaceParam || w.id === workspaceParam,
  );
  const workspaceId = workspace?.id;
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const meId = me?.id ?? -1;
  const channelsQuery = useChannels(workspaceId);
  const channels = channelsQuery.data ?? [];
  const channel = channelId ? channels.find((c) => c.id === channelId) : undefined;

  const base = `/w/${workspaceParam}/chat`;
  const hrefFor = useCallback((id: string) => `${base}/${id}`, [base]);

  const [newChannelOpen, setNewChannelOpen] = useState(false);
  const [newDmOpen, setNewDmOpen] = useState(false);
  const [addPeopleOpen, setAddPeopleOpen] = useState(false);

  // Remember the open channel, and on desktop return to it when the page is
  // opened bare — a phone opens on the list, which is its top level.
  useEffect(() => {
    if (workspaceId && channelId) writeLastChannel(workspaceId, channelId);
  }, [workspaceId, channelId]);
  useEffect(() => {
    // `useIsMobile` reads false until its own effect runs, and the channel
    // list is often cached already, so ask the viewport directly.
    const phone = isMobile || window.innerWidth < MOBILE_BREAKPOINT;
    if (phone || channelId || !workspaceId || !channelsQuery.data) return;
    const last = readLastChannel(workspaceId);
    if (last && channelsQuery.data.some((c) => c.id === last && !c.archived)) {
      navigate(hrefFor(last), { replace: true });
    }
  }, [isMobile, channelId, workspaceId, channelsQuery.data, navigate, hrefFor]);

  // A deep link to a thread reply opens that thread. Only the message itself
  // says whether it is one.
  const { data: linked } = useQuery({
    queryKey: ["chat", "message", messageId],
    queryFn: () => fetchMessage(workspaceId!, messageId!),
    enabled: !!workspaceId && !!messageId && !threadId,
    retry: false,
  });
  useEffect(() => {
    if (!linked || threadId || !messageId) return;
    if (linked.threadRootId && !linked.alsoInChannel) {
      const next = new URLSearchParams(searchParams);
      next.set("thread", linked.threadRootId);
      setSearchParams(next, { replace: true });
    }
  }, [linked, threadId, messageId, searchParams, setSearchParams]);

  const openThread = (rootId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("thread", rootId);
    next.delete("message");
    setSearchParams(next);
  };
  const closeThread = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("thread");
    next.delete("message");
    setSearchParams(next);
  };

  const leave = useLeaveChannel(workspaceId ?? "");
  const leaveChannel = (c: ChannelSummary) =>
    leave.mutate(c.id, {
      onSuccess: () => {
        toast.success(`Left #${c.name}`);
        navigate(base);
      },
      onError: (err) =>
        toast.error(userFacingError(err, "Couldn't leave the channel.")),
    });

  const { show } = chatLayout({ isMobile, channelId, threadId });
  const unknownChannel =
    !!channelId && !!channelsQuery.data && !channel;

  if (!workspaceId) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        {workspaces ? "This workspace isn't available." : "Loading…"}
      </p>
    );
  }

  const label = channel ? channelLabel(channel, meId) : "";
  // With a thread open the linked message is a reply in it, which the
  // channel's log does not hold.
  const threadHighlight = threadId ? messageId : null;
  const conversationHighlight = threadId ? null : messageId;

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden border-t">
      {show.includes("list") && (
        <aside
          className={cn(
            "flex min-h-0 flex-col",
            isMobile ? "flex-1" : "w-[260px] shrink-0 border-r",
          )}
        >
          <ChannelList
            channels={channels}
            isLoading={channelsQuery.isLoading}
            activeChannelId={channelId}
            me={meId}
            hrefFor={hrefFor}
            onNewChannel={() => setNewChannelOpen(true)}
            onNewMessage={() => setNewDmOpen(true)}
          />
        </aside>
      )}

      {show.includes("conversation") && (
        <section
          aria-label={label ? `Conversation: ${label}` : "Conversation"}
          className="flex min-h-0 min-w-0 flex-1 flex-col"
        >
          {!channelId ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-sm font-medium text-foreground">
                Pick a channel, or start a conversation
              </p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setNewChannelOpen(true)}>
                  Browse channels
                </Button>
                <Button variant="outline" onClick={() => setNewDmOpen(true)}>
                  New message
                </Button>
              </div>
            </div>
          ) : unknownChannel ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-sm font-medium text-foreground">
                This channel doesn't exist, or you don't have access to it.
              </p>
              <Button variant="outline" asChild>
                <Link to={base}>Back to chat</Link>
              </Button>
            </div>
          ) : (
            <>
              <header className="flex h-12 shrink-0 items-center gap-2 border-b px-2 md:px-4">
                {isMobile && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Back to channels"
                    onClick={() => navigate(base)}
                  >
                    <IconChevronLeft />
                  </Button>
                )}
                {channel?.kind === "private" ? (
                  <IconLock className="size-4 shrink-0 text-muted-foreground" />
                ) : channel?.kind === "public" ? (
                  <IconHash className="size-4 shrink-0 text-muted-foreground" />
                ) : null}
                <h1 className="truncate text-sm font-semibold">{label}</h1>
                {channel?.topic && (
                  <p className="hidden min-w-0 truncate border-l pl-2 text-sm text-muted-foreground md:block">
                    {channel.topic}
                  </p>
                )}
                {channel?.archived && (
                  <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    Archived
                  </span>
                )}
                {channel && channel.kind !== "dm" && channel.isMember && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="ml-auto size-8"
                        aria-label="Channel actions"
                      >
                        <IconDots />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {!channel.archived && (
                        <DropdownMenuItem onSelect={() => setAddPeopleOpen(true)}>
                          <IconUserPlus />
                          Add people
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onSelect={() => leaveChannel(channel)}>
                        <IconLogout />
                        Leave channel
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </header>
              <Conversation
                key={channelId}
                workspaceId={workspaceId}
                channelId={channelId}
                onOpenThread={openThread}
                highlightMessageId={conversationHighlight}
                placeholder={
                  channel?.kind === "dm"
                    ? `Message ${label}`
                    : `Message #${label}`
                }
              />
            </>
          )}
        </section>
      )}

      {show.includes("thread") && channelId && threadId && (
        <section
          aria-label="Thread"
          className={cn(
            "flex min-h-0 flex-col",
            isMobile ? "min-w-0 flex-1" : "w-[360px] shrink-0 border-l",
          )}
        >
          <header className="flex h-12 shrink-0 items-center gap-2 border-b px-2 md:px-4">
            {isMobile && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Back to conversation"
                onClick={closeThread}
              >
                <IconChevronLeft />
              </Button>
            )}
            <h2 className="text-sm font-semibold">Thread</h2>
            {label && (
              <span className="truncate text-sm text-muted-foreground">
                {channel?.kind === "dm" ? label : `#${label}`}
              </span>
            )}
            {!isMobile && (
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto size-8"
                aria-label="Close thread"
                onClick={closeThread}
              >
                <IconX />
              </Button>
            )}
          </header>
          <ThreadView
            key={threadId}
            workspaceId={workspaceId}
            channelId={channelId}
            rootId={threadId}
            highlightMessageId={threadHighlight}
          />
        </section>
      )}

      <NewChannelDialog
        workspaceId={workspaceId}
        channels={channels}
        open={newChannelOpen}
        onOpenChange={setNewChannelOpen}
        onOpened={(id) => navigate(hrefFor(id))}
      />
      <NewDmDialog
        workspaceId={workspaceId}
        open={newDmOpen}
        onOpenChange={setNewDmOpen}
        onOpened={(id) => navigate(hrefFor(id))}
      />
      {channel && channel.kind !== "dm" && (
        <AddPeopleDialog
          workspaceId={workspaceId}
          channelId={channel.id}
          channelName={channel.name ?? ""}
          open={addPeopleOpen}
          onOpenChange={setAddPeopleOpen}
        />
      )}
    </div>
  );
}
