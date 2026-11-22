import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { IconArchive, IconArrowDown } from '@tabler/icons-react';
import { toast } from 'sonner';

import { fetchMe } from '@/api/auth';
import { userFacingError } from '@/api/http-error';
import { Button } from '@/components/ui/button';
import { useWorkspaceMembers } from '@/components/comments/use-workspace-members';
import { useChatConnection } from './chat-connection';
import { Composer } from './composer';
import { groupMessages, type MessageGroup } from './group-messages';
import { MessageGroupView } from './message-item';
import {
  countNewSince,
  findUnreadDivider,
  type UnreadRange,
} from './unread-marker';
import { useFlashMessage } from './use-flash-message';
import {
  useChannelMessages,
  useChannels,
  useJoinChannel,
  useMarkRead,
  usePostMessage,
} from './use-chat';
import { setOpenChatChannel } from './use-chat-stream';

/** Within this many pixels of the end counts as "at the bottom". */
const BOTTOM_SLACK_PX = 48;
/** How far back a deep link may page to find its message. */
const MAX_DEEP_LINK_PAGES = 10;
/** Room left above the divider when the view opens at it. */
const DIVIDER_MARGIN_PX = 8;

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

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
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric',
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
 *
 * Opening a channel with unread messages draws a "New messages" divider
 * above the first of them and opens there when it is out of view. Scrolled
 * away from the end, a "Jump to latest" pill counts what arrived since.
 */
export function Conversation({
  workspaceId,
  channelId,
  onOpenThread,
  highlightMessageId,
  placeholder,
}: ConversationProps) {
  const { data: me, isPending: mePending } = useQuery({
    queryKey: ['me'],
    queryFn: fetchMe,
  });
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

  // What was unread when the channel opened, taken the first time the
  // summary is there — reading moves the read position in the cache, so it
  // is captured before it can. The divider derives from it, so it stays put
  // while the channel is open and resets with the remount a channel switch
  // brings. Null for a non-member, who has nothing unread.
  const [unreadAtOpen, setUnreadAtOpen] = useState<
    UnreadRange | null | undefined
  >(undefined);
  if (unreadAtOpen === undefined && channel) {
    setUnreadAtOpen(
      channel.isMember && channel.lastReadSeq !== null
        ? { readSeq: channel.lastReadSeq, lastSeq: channel.lastSeq }
        : null,
    );
  }
  const anyUnreadAtOpen =
    !!unreadAtOpen && unreadAtOpen.lastSeq > unreadAtOpen.readSeq;
  const newestSeq = messages.at(-1)?.seq;
  // Which messages are the reader's own decides where the divider goes, so
  // none is drawn until that is known.
  const dividerId = useMemo(
    () =>
      anyUnreadAtOpen && unreadAtOpen && me
        ? findUnreadDivider(messages, unreadAtOpen, me.id)
        : null,
    [messages, unreadAtOpen, anyUnreadAtOpen, me],
  );

  // The newest message the reader has been at the bottom for; what arrived
  // after it is what the "Jump to latest" pill counts.
  const [seenSeq, setSeenSeq] = useState(0);
  useEffect(() => {
    if (atBottomRef.current && newestSeq !== undefined) setSeenSeq(newestSeq);
  }, [atBottom, newestSeq]);
  const newCount = atBottom ? 0 : countNewSince(messages, seenSeq, meId);

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

  // Open at the divider when the bottom leaves it out of view, once. The
  // reader is then away from the end, which keeps the read position where it
  // is until they scroll down, and the pill counts everything below it.
  const openedAtDivider = useRef(false);
  const dividerRef = useRef<HTMLLIElement>(null);
  useLayoutEffect(() => {
    if (!dividerId || openedAtDivider.current) return;
    openedAtDivider.current = true;
    if (highlightMessageId) return;
    const el = scrollRef.current;
    const divider = dividerRef.current;
    if (!el || !divider) return;
    const offset =
      divider.getBoundingClientRect().top - el.getBoundingClientRect().top;
    if (offset >= 0) return;
    el.scrollTop = Math.max(0, el.scrollTop + offset - DIVIDER_MARGIN_PX);
    atBottomRef.current = false;
    setAtBottom(false);
    const first = messages.find((m) => m.id === dividerId);
    if (first) setSeenSeq(first.seq - 1);
  }, [dividerId, highlightMessageId, messages]);

  const rootRef = useRef<HTMLDivElement>(null);
  const jumpToLatest = useCallback((e: MouseEvent<HTMLButtonElement>) => {
    const el = scrollRef.current;
    if (!el) return;
    const behavior = prefersReducedMotion() ? 'auto' : 'smooth';
    if (typeof el.scrollTo === 'function') {
      el.scrollTo({ top: el.scrollHeight, behavior });
    } else {
      el.scrollTop = el.scrollHeight;
    }
    // The pill goes away at the bottom; a keyboard user lands in the
    // composer rather than on the page body. Focus cannot tell the two apart
    // (Chrome focuses a button on mousedown), but a keyboard-made click has
    // detail 0 — and focusing the textarea on a tap would raise the keyboard.
    if (e.detail === 0) {
      rootRef.current?.querySelector<HTMLElement>('textarea')?.focus({
        preventScroll: true,
      });
    }
  }, []);

  const handleLoadOlder = useCallback(async () => {
    const el = scrollRef.current;
    if (el)
      prependAnchor.current = { height: el.scrollHeight, top: el.scrollTop };
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
  }, [
    highlightMessageId,
    present,
    isLoading,
    loadingOlder,
    hasOlder,
    loadOlder,
  ]);
  const flashing = useFlashMessage(highlightMessageId, present);

  // Read up to the newest message whenever it is in view and the tab is —
  // not while the view opened at the divider (the ref, because that happens
  // in this same commit), nor while who the reader is is still loading with
  // something unread, since the divider cannot be placed before then.
  useEffect(() => {
    if (!atBottom || newestSeq === undefined || !channel?.isMember) return;
    if (anyUnreadAtOpen && mePending) return;
    const tryMark = () => {
      if (!atBottomRef.current) return;
      if (document.visibilityState === 'visible') markRead(newestSeq);
    };
    tryMark();
    document.addEventListener('visibilitychange', tryMark);
    return () => document.removeEventListener('visibilitychange', tryMark);
  }, [
    atBottom,
    newestSeq,
    channel?.isMember,
    markRead,
    anyUnreadAtOpen,
    mePending,
  ]);

  const groups = useMemo(
    () => groupMessages(messages, dividerId),
    [messages, dividerId],
  );

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

  // An archived channel cannot be joined, so a non-member gets the archived
  // read-only composer rather than a Join the server would refuse.
  const readOnlyPreview =
    channel?.kind === 'public' && !channel.isMember && !channel.archived;

  const showJump = !atBottom && messages.length > 0 && !isLoading && !error;
  const newLabel = `${newCount} new ${newCount === 1 ? 'message' : 'messages'}`;

  return (
    <div ref={rootRef} className="flex min-h-0 flex-1 flex-col">
      {channel?.archived && (
        <p
          role="status"
          className="flex shrink-0 items-center gap-2 border-b bg-muted px-4 py-2 text-sm text-muted-foreground"
        >
          <IconArchive className="size-4 shrink-0" aria-hidden />
          This channel is archived. Its history stays readable; nobody can post
          in it.
        </p>
      )}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
          aria-label="Messages"
          role="log"
        >
          {isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">
              Loading messages…
            </p>
          ) : error ? (
            <p className="p-6 text-sm text-muted-foreground">
              {userFacingError(
                error,
                "Couldn't load messages. Reload to try again.",
              )}
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
                    {loadingOlder ? 'Loading…' : 'Load older messages'}
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
                    {g.first.id === dividerId && (
                      <li
                        ref={dividerRef}
                        role="separator"
                        aria-label="New messages"
                        className="mx-4 mt-3 flex items-center gap-3 text-xs font-medium text-primary"
                      >
                        <span className="h-px flex-1 bg-primary" />
                        New messages
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
        {showJump && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-4">
            <Button
              variant="outline"
              size="sm"
              onClick={jumpToLatest}
              className="pointer-events-auto shadow-md pointer-coarse:min-h-11 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1"
            >
              <IconArrowDown aria-hidden />
              {newCount > 0 ? newLabel : 'Jump to latest'}
            </Button>
          </div>
        )}
        <span aria-live="polite" className="sr-only">
          {showJump && newCount > 0 ? newLabel : ''}
        </span>
      </div>
      <div className="border-t px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <ConnectionNotice />
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
                ? 'This channel is archived. You can read it, but not post.'
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

/**
 * Says so when messages are not arriving live. Sending still works over
 * plain HTTP either way, so this informs rather than blocks.
 */
function ConnectionNotice() {
  const connection = useChatConnection();
  if (connection !== 'reconnecting' && connection !== 'stopped') return null;
  return (
    <p
      role="status"
      className="mb-2 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground"
    >
      {connection === 'reconnecting' ? (
        'Reconnecting… New messages will appear once the connection is back.'
      ) : (
        <>
          Live updates stopped. New messages won't appear until you reload.
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-sm font-medium text-foreground underline underline-offset-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            Reload
          </button>
        </>
      )}
    </p>
  );
}
