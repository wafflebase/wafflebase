import type {
  ChannelSummary,
  ChatMessageDto,
  StreamMessageEvent,
} from "@/api/chat";

/**
 * React Query keys for chat. Every list a stream event can touch hangs off
 * one of these, so the stream hook and the views agree on where state lives.
 */
export const chatKeys = {
  all: ["chat"] as const,
  /** Prefix of every workspace's channel list, for a blanket invalidate. */
  allChannels: ["chat", "channels"] as const,
  channels: (workspaceId: string) => ["chat", "channels", workspaceId] as const,
  messages: (channelId: string) => ["chat", "messages", channelId] as const,
  thread: (rootId: string) => ["chat", "thread", rootId] as const,
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
 *   unread. The mention count is not guessed — the event carries no body —
 *   and is refreshed by the next channel-list fetch;
 * - a reply invalidates its thread.
 */
export function applyChatEvent(
  state: ChatEventState,
  e: StreamMessageEvent,
): ChatEventOutcome {
  const isOpen = state.openChannelId === e.channelId;
  const isReply = e.threadRootId !== null;
  const countsAsUnread = !isOpen && !isReply && e.authorId !== state.me;

  const channels = countsAsUnread
    ? state.channels.map((c) =>
        c.id === e.channelId ? { ...c, unreadCount: c.unreadCount + 1 } : c,
      )
    : state.channels;

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
): ChannelSummary[] {
  return channels.map((c) =>
    c.id === channelId ? { ...c, unreadCount: 0, mentionCount: 0 } : c,
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

/** Parse a `message` frame, or null for anything that is not one. */
export function parseStreamMessage(raw: string): StreamMessageEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { workspaceId, channelId, seq, threadRootId, authorId } =
    parsed as Record<string, unknown>;
  if (typeof workspaceId !== "string" || typeof channelId !== "string") {
    return null;
  }
  if (!Number.isSafeInteger(seq)) return null;
  if (threadRootId !== null && typeof threadRootId !== "string") return null;
  if (authorId !== null && !Number.isSafeInteger(authorId)) return null;
  return {
    workspaceId,
    channelId,
    seq: seq as number,
    threadRootId,
    authorId: authorId as number | null,
  };
}

/**
 * The sidebar's Chat badge: unread across the channels the caller follows.
 * Public channels they have not joined and archived ones do not count — they
 * are not in the channel list either.
 */
export function totalUnread(channels: ChannelSummary[]): number {
  return channels.reduce(
    (sum, c) => (c.isMember && !c.archived ? sum + c.unreadCount : sum),
    0,
  );
}
