import type {
  ChannelSummary,
  ChatMessageDto,
  StreamMessageEvent,
  StreamUpdateEvent,
} from '@/api/chat';

/**
 * React Query keys for chat. Every list a stream event can touch hangs off
 * one of these, so the stream hook and the views agree on where state lives.
 */
export const chatKeys = {
  all: ['chat'] as const,
  /** Prefix of every workspace's channel list, for a blanket invalidate. */
  allChannels: ['chat', 'channels'] as const,
  channels: (workspaceId: string) => ['chat', 'channels', workspaceId] as const,
  /** Prefix of every channel's message cache. */
  allMessages: ['chat', 'messages'] as const,
  messages: (channelId: string) => ['chat', 'messages', channelId] as const,
  /** Prefix of every thread's cache. */
  allThreads: ['chat', 'thread'] as const,
  thread: (rootId: string) => ['chat', 'thread', rootId] as const,
  members: (channelId: string) => ['chat', 'members', channelId] as const,
  /** The reader's own sends to a channel or its threads not yet answered. */
  pending: (channelId: string) => ['chat', 'pending', channelId] as const,
};

export interface ChatEventState {
  channels: ChannelSummary[];
  openChannelId: string | null;
  me: number;
}

export interface ChatEventOutcome {
  channels: ChannelSummary[];
  /** Fetch this channel's messages after `seq` (the event's predecessor). */
  fetchAfter: { channelId: string; seq: number } | null;
  /** A thread whose cached replies are now stale. */
  invalidateThread: string | null;
}

/**
 * What one `message` stream event means for the client. Pure, so the rules
 * are testable without a stream:
 *
 * - the open channel fetches what it is missing (a reply too, since it may
 *   have been also sent to the channel, and its root's reply count moved);
 * - another channel's top-level message from someone else is one more
 *   unread, and so is a reply also sent to the channel — the server's
 *   unread count includes those too. The mention count is not guessed — the event carries no body —
 *   and is refreshed by the next channel-list fetch;
 * - a reply invalidates its thread;
 * - every message moves its channel's `lastSeq`.
 */
export function applyChatEvent(
  state: ChatEventState,
  e: StreamMessageEvent,
): ChatEventOutcome {
  const isOpen = state.openChannelId === e.channelId;
  const inChannel = e.threadRootId === null || e.alsoInChannel;
  const countsAsUnread = !isOpen && inChannel && e.authorId !== state.me;

  // `lastSeq` moves for every message, the open channel's included: a channel
  // reopened later places its "New messages" divider up to it.
  const channels = state.channels.map((c) =>
    c.id === e.channelId
      ? {
          ...c,
          lastSeq: Math.max(c.lastSeq, e.seq),
          unreadCount: c.unreadCount + (countsAsUnread ? 1 : 0),
        }
      : c,
  );

  return {
    channels,
    fetchAfter: isOpen ? { channelId: e.channelId, seq: e.seq - 1 } : null,
    invalidateThread: e.threadRootId,
  };
}

/**
 * Merge a fetched page into the cached list: one copy per id (the incoming
 * one wins, so an edit or delete fetched later replaces the stale row), in
 * ascending `seq` order.
 */
export function mergeMessages(
  existing: ChatMessageDto[] | undefined,
  incoming: ChatMessageDto[],
): ChatMessageDto[] {
  const byId = new Map<string, ChatMessageDto>();
  for (const m of existing ?? []) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

/** Highest `seq` in a list, or null for an empty or missing one. */
export function lastSeqOf(
  messages: ChatMessageDto[] | undefined,
): number | null {
  if (!messages || messages.length === 0) return null;
  return messages.reduce((max, m) => (m.seq > max ? m.seq : max), -Infinity);
}

/** The list after the caller has read `channelId` to its end. */
export function markChannelRead(
  channels: ChannelSummary[],
  channelId: string,
  seq: number,
): ChannelSummary[] {
  return channels.map((c) =>
    c.id === channelId
      ? {
          ...c,
          unreadCount: 0,
          mentionCount: 0,
          // Never backwards, as on the server.
          lastReadSeq: Math.max(c.lastReadSeq ?? 0, seq),
        }
      : c,
  );
}

/** Replace one message in a cached list, if it is there. */
export function replaceMessage(
  messages: ChatMessageDto[] | undefined,
  next: ChatMessageDto,
): ChatMessageDto[] | undefined {
  if (!messages) return messages;
  return messages.map((m) => (m.id === next.id ? next : m));
}

/**
 * A cached message blanked the way the server deletes it: the row stays, so a
 * thread root keeps its replies reachable. Used when an `update` names a
 * message the caller can no longer fetch.
 */
export function markMessageDeleted(
  messages: ChatMessageDto[] | undefined,
  messageId: string,
): ChatMessageDto[] | undefined {
  if (!messages) return messages;
  return messages.map((m) =>
    m.id === messageId ? { ...m, body: '', deleted: true } : m,
  );
}

/** Parse an `update` frame, or null for anything that is not one. */
export function parseStreamUpdate(raw: string): StreamUpdateEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { workspaceId, channelId, messageId, threadRootId } = parsed as Record<
    string,
    unknown
  >;
  if (
    typeof workspaceId !== 'string' ||
    typeof channelId !== 'string' ||
    typeof messageId !== 'string'
  ) {
    return null;
  }
  if (threadRootId !== null && typeof threadRootId !== 'string') return null;
  return { workspaceId, channelId, messageId, threadRootId };
}

/** Parse a `message` frame, or null for anything that is not one. */
export function parseStreamMessage(raw: string): StreamMessageEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { workspaceId, channelId, seq, threadRootId, authorId, alsoInChannel } =
    parsed as Record<string, unknown>;
  if (typeof workspaceId !== 'string' || typeof channelId !== 'string') {
    return null;
  }
  if (!Number.isSafeInteger(seq)) return null;
  if (threadRootId !== null && typeof threadRootId !== 'string') return null;
  if (authorId !== null && !Number.isSafeInteger(authorId)) return null;
  if (typeof alsoInChannel !== 'boolean') return null;
  return {
    workspaceId,
    channelId,
    seq: seq as number,
    threadRootId,
    authorId: authorId as number | null,
    alsoInChannel,
  };
}

/**
 * The sidebar's Chat badge: what needs you — unread in a DM, mentions in a
 * channel. The same rule the channel list draws a count by, so the number
 * over Chat is the sum of the numbers in the list; a channel that is merely
 * busy shows a dot there and adds nothing here. Public channels the caller
 * has not joined and archived ones do not count.
 */
export function chatBadgeCount(channels: ChannelSummary[]): number {
  return channels.reduce(
    (sum, c) => (c.isMember && !c.archived ? sum + channelCount(c) : sum),
    0,
  );
}

/**
 * The number a channel row shows. A mention always counts; in a DM every
 * message is addressed to you, so all of its unread does; anything else is
 * a dot, not a number.
 */
export function channelCount(channel: ChannelSummary): number {
  if (channel.mentionCount > 0) return channel.mentionCount;
  return channel.kind === 'dm' ? channel.unreadCount : 0;
}

/**
 * A message as the log draws it: a server row, or one of the reader's own
 * sends that has not been answered yet. A local row carries a `clientId`, and
 * its `seq` is the newest the client knew of when it was sent — a floor for
 * the seq the server will give it, never a real one. Local rows live outside
 * the message caches, so nothing that pages or catches up by `seq` sees them.
 */
export type ChatLine = ChatMessageDto & {
  localState?: 'pending' | 'failed';
  clientId?: string;
};

/** What a send was asked to post, kept so a failed one can be retried. */
export interface PostInput {
  body: string;
  threadRootId?: string;
  alsoInChannel?: boolean;
}

/** One optimistic send, held under `chatKeys.pending(channelId)`. */
export interface PendingSend {
  clientId: string;
  input: PostInput;
  state: 'pending' | 'failed';
  /** The row drawn for it until the server's own replaces it. */
  message: ChatLine;
}

/**
 * The log with the reader's unanswered sends at its tail. A send is hidden
 * once the stream has brought in the server's copy, so it is never drawn
 * twice: the post's response, which retires it, can land after the event
 * that announced the same message — or never land at all, when the server
 * took the post and only the response was lost, which would otherwise leave
 * a "Not sent" row whose Retry posts it again. The server's copy is matched
 * by author and body among rows newer than the send, one server row per send.
 */
export function withPending(
  server: ChatMessageDto[],
  pending: ChatLine[],
): ChatLine[] {
  if (pending.length === 0) return server;
  const claimed = new Set<string>();
  const visible = pending.filter((p) => {
    const twin = server.find(
      (m) =>
        !claimed.has(m.id) &&
        m.author !== null &&
        m.author.id === p.author?.id &&
        m.body === p.body &&
        m.seq > p.seq,
    );
    if (!twin) return true;
    claimed.add(twin.id);
    return false;
  });
  return visible.length === 0 ? server : [...server, ...visible];
}
