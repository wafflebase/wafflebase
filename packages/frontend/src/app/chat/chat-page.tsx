import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  IconArchive,
  IconArchiveOff,
  IconChevronLeft,
  IconDots,
  IconHash,
  IconLock,
  IconPencil,
  IconTextCaption,
  IconUserPlus,
  IconLogout,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";

import { fetchMe } from "@/api/auth";
import { fetchMessage, type ChannelSummary } from "@/api/chat";
import { userFacingError } from "@/api/http-error";
import { fetchWorkspaces, type Workspace } from "@/api/workspaces";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { ShortcutsHelpDialog } from "@/components/shortcuts-help-dialog";
import { chatBadgeCount } from "@/components/chat/chat-cache";
import { Conversation } from "@/components/chat/conversation";
import { ThreadView } from "@/components/chat/thread-view";
import {
  useChannels,
  useJoinChannel,
  useLeaveChannel,
  useUpdateChannel,
} from "@/components/chat/use-chat";
import { MOBILE_BREAKPOINT, useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { ChannelList } from "./channel-list";
import {
  ChannelSettingsDialog,
  type ChannelSettingsMode,
} from "./channel-settings-dialog";
import { ChannelSwitcher } from "./channel-switcher";
import {
  channelMenu,
  chatLayout,
  chatTitle,
  landingChannelId,
} from "./chat-layout";
import {
  CHAT_SHORTCUT_CATEGORIES,
  CHAT_SHORTCUTS,
  chatShortcut,
  formatChatCombo,
  modalSurfaceOpen,
} from "./chat-shortcuts";
import { adjacentChannelId, channelLabel } from "./group-channels";
import { LeaveChannelDialog } from "./leave-channel-dialog";
import { NewChannelDialog, type ChannelDialogTab } from "./new-channel-dialog";
import {
  ChannelMembersButton,
  ChannelMembersDialog,
} from "./channel-members-dialog";
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

function forgetLastChannel(workspaceId: string, channelId: string): void {
  try {
    if (readLastChannel(workspaceId) === channelId) {
      window.localStorage.removeItem(LAST_CHANNEL_KEY(workspaceId));
    }
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
  const [newChannelTab, setNewChannelTab] =
    useState<ChannelDialogTab>("create");
  const openChannelDialog = (tab: ChannelDialogTab) => {
    setNewChannelTab(tab);
    setNewChannelOpen(true);
  };
  const [newDmOpen, setNewDmOpen] = useState(false);
  const [addPeopleOpen, setAddPeopleOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [settingsMode, setSettingsMode] = useState<ChannelSettingsMode | null>(
    null,
  );

  // Remember the open channel, and on desktop return to it when the page is
  // opened bare — a phone opens on the list, which is its top level.
  useEffect(() => {
    if (workspaceId && channelId) writeLastChannel(workspaceId, channelId);
  }, [workspaceId, channelId]);

  // The members dialog belongs to one channel; back/forward must not carry
  // it, open, to the next one.
  useEffect(() => setMembersOpen(false), [channelId]);
  useEffect(() => {
    // `useIsMobile` reads false until its own effect runs, and the channel
    // list is often cached already, so ask the viewport directly.
    const phone = isMobile || window.innerWidth < MOBILE_BREAKPOINT;
    if (phone || channelId || !workspaceId || !channelsQuery.data) return;
    const target = landingChannelId(
      channelsQuery.data,
      readLastChannel(workspaceId),
    );
    if (target) navigate(hrefFor(target), { replace: true });
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

  // Closing a thread from the keyboard hands focus back to where it came
  // from — the root message's "N replies" link, else the channel composer —
  // instead of dropping it on <body> as the thread column unmounts.
  const conversationRef = useRef<HTMLElement>(null);
  const restoreFocusTo = useRef<string | null>(null);
  useEffect(() => {
    const rootId = restoreFocusTo.current;
    if (threadId || !rootId) return;
    restoreFocusTo.current = null;
    const pane = conversationRef.current;
    if (!pane) return;
    const root = pane.querySelector<HTMLElement>(
      `[data-message-id="${rootId}"]`,
    );
    const repliesLink = root?.querySelector<HTMLElement>("[data-thread-link]");
    (repliesLink ?? pane.querySelector<HTMLElement>("textarea"))?.focus();
  }, [threadId]);

  // Esc closes the thread from anywhere inside its column — but not when a
  // menu, sheet or the mention list took the key first (they mark it
  // handled), nor from a portalled layer that only bubbles here through
  // React.
  const onThreadKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    if (e.nativeEvent.isComposing) return;
    if (!e.currentTarget.contains(e.target as Node)) return;
    e.preventDefault();
    restoreFocusTo.current = threadId;
    closeThread();
  };

  const leave = useLeaveChannel(workspaceId ?? "");
  const join = useJoinChannel(workspaceId ?? "");
  // The private channel whose leaving waits on a confirmation.
  const [confirmLeave, setConfirmLeave] = useState<ChannelSummary | null>(
    null,
  );
  const rejoin = (c: ChannelSummary) =>
    join.mutate(c.id, {
      onSuccess: () => navigate(hrefFor(c.id)),
      onError: (err) =>
        toast.error(userFacingError(err, `Couldn't rejoin #${c.name}.`)),
    });
  const leaveChannel = (c: ChannelSummary) =>
    leave.mutate(c.id, {
      onSuccess: () => {
        setConfirmLeave(null);
        // A public channel is a Join away, so leaving it is undoable; a
        // private one was confirmed first.
        if (c.kind === "public") {
          toast.success(`Left #${c.name}`, {
            action: { label: "Undo", onClick: () => rejoin(c) },
          });
        } else {
          toast.success(`Left #${c.name}`);
        }
        // Otherwise the bare page would send you straight back.
        if (workspaceId) forgetLastChannel(workspaceId, c.id);
        navigate(base);
      },
      onError: (err) =>
        toast.error(userFacingError(err, "Couldn't leave the channel.")),
    });
  const requestLeave = (c: ChannelSummary) =>
    c.kind === "private" ? setConfirmLeave(c) : leaveChannel(c);

  // Alt+↑/↓ walk the list, Alt+Shift+↑/↓ the unread part of it, Mod+K opens
  // the switcher, Mod+/ the shortcut sheet. Read through a ref so the
  // listener is bound once.
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const keysRef = useRef({ channels, channelId, hrefFor, navigate });
  keysRef.current = { channels, channelId, hrefFor, navigate };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = chatShortcut(e);
      if (!action) return;
      // Moving channel would unmount an open message edit and lose it.
      if (document.querySelector("[data-chat-edit]")) return;
      const { channels, channelId, hrefFor, navigate } = keysRef.current;
      if (action === "switcher") {
        // A second Mod+K closes it, as in Slack; any other dialog keeps it shut.
        e.preventDefault();
        setSwitcherOpen((open) => (open ? false : !modalSurfaceOpen()));
        return;
      }
      if (action === "help") {
        e.preventDefault();
        setHelpOpen((open) => (open ? false : !modalSurfaceOpen()));
        return;
      }
      if (modalSurfaceOpen()) return;
      const unreadOnly = action === "prev-unread" || action === "next-unread";
      const step = action === "prev" || action === "prev-unread" ? -1 : 1;
      e.preventDefault();
      const target = adjacentChannelId(channels, channelId, step, unreadOnly);
      if (target) navigate(hrefFor(target));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const update = useUpdateChannel(workspaceId ?? "");
  const unarchive = (c: ChannelSummary) =>
    update.mutate(
      { channelId: c.id, archived: false },
      {
        onSuccess: () => toast.success(`Unarchived #${c.name}`),
        onError: (err) =>
          toast.error(userFacingError(err, "Couldn't unarchive the channel.")),
      },
    );

  const { show } = chatLayout({ isMobile, channelId, threadId });
  const unknownChannel =
    !!channelId && !!channelsQuery.data && !channel;
  const label = channel ? channelLabel(channel, meId) : "";

  // The tab says where you are and how much needs you. The page owns the
  // title on its routes (Layout's ROUTE_TITLES leaves them alone), and the
  // next route's title replaces it on the way out.
  const badge = chatBadgeCount(channels);
  useEffect(() => {
    document.title = chatTitle(channel, label, badge);
  }, [channel, label, badge]);

  if (!workspaceId) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        {workspaces ? "This workspace isn't available." : "Loading…"}
      </p>
    );
  }

  const menu = channelMenu(channel);
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
            workspaceId={workspaceId}
            channels={channels}
            isLoading={channelsQuery.isLoading}
            isError={channelsQuery.isError && !channelsQuery.data}
            onRetry={() => void channelsQuery.refetch()}
            activeChannelId={channelId}
            me={meId}
            hrefFor={hrefFor}
            onNewChannel={() => openChannelDialog("create")}
            onBrowse={() => openChannelDialog("browse")}
            onNewMessage={() => setNewDmOpen(true)}
            onJumpTo={() => setSwitcherOpen(true)}
            onShowShortcuts={() => setHelpOpen(true)}
          />
        </aside>
      )}

      {show.includes("conversation") && (
        <section
          ref={conversationRef}
          aria-label={label ? `Conversation: ${label}` : "Conversation"}
          className="flex min-h-0 min-w-0 flex-1 flex-col"
        >
          {!channelId ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-sm font-medium text-foreground">
                Pick a channel, or start a conversation
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => openChannelDialog("browse")}
                >
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
                {!channel ? (
                  // The list has not answered yet: hold the name's place
                  // rather than show a header with no name in it.
                  <>
                    <Skeleton aria-hidden className="h-4 w-32" />
                    <span className="sr-only">Loading channel…</span>
                  </>
                ) : channel.kind === "private" ? (
                  <IconLock className="size-4 shrink-0 text-muted-foreground" />
                ) : channel.kind === "public" ? (
                  <IconHash className="size-4 shrink-0 text-muted-foreground" />
                ) : null}
                {/* An h2: the site header's "Chat" is the page's one h1. */}
                {channel?.topic ? (
                  // Name over topic on a phone, side by side on desktop. The
                  // topic truncates either way, so it opens in full on a tap.
                  <div className="flex min-w-0 flex-col md:flex-row md:items-center md:gap-2">
                    <h2 className="truncate text-sm font-semibold">{label}</h2>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          aria-label={`Topic: ${channel.topic}`}
                          className="min-w-0 truncate rounded-sm text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 md:border-l md:pl-2 md:text-sm"
                        >
                          {channel.topic}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="start"
                        className="w-80 max-w-[calc(100vw-2rem)] text-sm break-words"
                      >
                        <p className="pb-1 text-xs font-medium text-muted-foreground">
                          Topic
                        </p>
                        <p>{channel.topic}</p>
                      </PopoverContent>
                    </Popover>
                  </div>
                ) : channel ? (
                  <h2 className="truncate text-sm font-semibold">{label}</h2>
                ) : null}
                {channel?.archived && (
                  <Badge variant="secondary" className="font-normal">
                    Archived
                  </Badge>
                )}
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  {channel && channel.kind !== "dm" && (
                    <ChannelMembersButton
                      workspaceId={workspaceId}
                      channelId={channel.id}
                      onClick={() => setMembersOpen(true)}
                    />
                  )}
                  {menu.any && channel && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 pointer-coarse:size-11"
                          aria-label="Channel actions"
                        >
                          <IconDots />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {menu.edit && (
                          <>
                            <DropdownMenuItem
                              onSelect={() => setSettingsMode("rename")}
                            >
                              <IconPencil />
                              Rename channel…
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => setSettingsMode("topic")}
                            >
                              <IconTextCaption />
                              Edit topic…
                            </DropdownMenuItem>
                          </>
                        )}
                        {menu.addPeople && (
                          <DropdownMenuItem onSelect={() => setAddPeopleOpen(true)}>
                            <IconUserPlus />
                            Add people
                          </DropdownMenuItem>
                        )}
                        {menu.archive &&
                          (channel.archived ? (
                            <DropdownMenuItem
                              onSelect={() => unarchive(channel)}
                              disabled={update.isPending}
                            >
                              <IconArchiveOff />
                              Unarchive channel
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onSelect={() => setSettingsMode("archive")}
                            >
                              <IconArchive />
                              Archive channel…
                            </DropdownMenuItem>
                          ))}
                        {menu.leave && (
                          <>
                            {(menu.edit || menu.addPeople || menu.archive) && (
                              <DropdownMenuSeparator />
                            )}
                            <DropdownMenuItem
                              onSelect={() => requestLeave(channel)}
                            >
                              <IconLogout />
                              {channel.kind === "private"
                                ? "Leave channel…"
                                : "Leave channel"}
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </header>
              <Conversation
                key={channelId}
                workspaceId={workspaceId}
                channelId={channelId}
                onOpenThread={openThread}
                highlightMessageId={conversationHighlight}
                // Until the channel is known the composer says only
                // "Message", never "Message #" with no name after it.
                placeholder={
                  !channel
                    ? undefined
                    : channel.kind === "dm"
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
          onKeyDown={onThreadKeyDown}
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
            {/* On a phone the thread replaces the conversation, so it says
                where it is; beside the conversation that is already shown. */}
            {isMobile && label && (
              <span className="truncate text-sm text-muted-foreground">
                {channel?.kind === "dm" ? label : `#${label}`}
              </span>
            )}
            {!isMobile && (
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto size-8 pointer-coarse:size-11"
                aria-label="Close thread"
                onClick={() => {
                  restoreFocusTo.current = threadId;
                  closeThread();
                }}
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
        tab={newChannelTab}
        onTabChange={setNewChannelTab}
        onOpenChange={setNewChannelOpen}
        onOpened={(id) => navigate(hrefFor(id))}
      />
      <ChannelSwitcher
        open={switcherOpen}
        onOpenChange={setSwitcherOpen}
        channels={channels}
        me={meId}
        onPick={(id) => navigate(hrefFor(id))}
      />
      <ShortcutsHelpDialog
        open={helpOpen}
        onOpenChange={setHelpOpen}
        title="Chat keyboard shortcuts"
        shortcuts={CHAT_SHORTCUTS}
        categoryOrder={CHAT_SHORTCUT_CATEGORIES}
        formatCombo={formatChatCombo}
      />
      <LeaveChannelDialog
        channel={confirmLeave}
        pending={leave.isPending}
        onConfirm={() => confirmLeave && leaveChannel(confirmLeave)}
        onCancel={() => setConfirmLeave(null)}
      />
      <NewDmDialog
        workspaceId={workspaceId}
        open={newDmOpen}
        onOpenChange={setNewDmOpen}
        onOpened={(id) => navigate(hrefFor(id))}
      />
      {channel && channel.canManage && (
        <ChannelSettingsDialog
          workspaceId={workspaceId}
          channel={channel}
          mode={settingsMode}
          onClose={() => setSettingsMode(null)}
        />
      )}
      {channel && channel.kind !== "dm" && (
        <ChannelMembersDialog
          workspaceId={workspaceId}
          channel={channel}
          meId={meId}
          open={membersOpen}
          onOpenChange={setMembersOpen}
          onAddPeople={() => setAddPeopleOpen(true)}
        />
      )}
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
