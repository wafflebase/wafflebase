import type { ChatMessageDto } from "@/api/chat";

/**
 * Whether a message in the channel log is one the server's unread count
 * includes: top-level or also sent to the channel, not deleted, and written
 * by somebody other than the reader (a deleted account counts as somebody
 * else). Mirrors the `summaries` query in `chat-channel.service.ts`.
 */
export function countsAsUnread(m: ChatMessageDto, me: number): boolean {
  if (m.threadRootId !== null && !m.alsoInChannel) return false;
  if (m.deleted) return false;
  return m.author?.id !== me;
}

/**
 * What the reader had unread when the channel opened: the summary's count,
 * and the newest `seq` loaded at that moment. The count covers exactly the
 * newest `count` eligible messages up to `boundarySeq`, so later arrivals —
 * which the count never included — cannot shift the divider.
 */
export interface UnreadSnapshot {
  count: number;
  boundarySeq: number;
}

/**
 * The id of the message the "New messages" divider sits above: the oldest of
 * the `count` newest eligible messages at or below the boundary. While fewer
 * than that are loaded it sits at the oldest loaded one, and moves up as
 * "Load older" brings the rest in. Null when nothing was unread.
 *
 * The client has the count, not the read position: the channel summary
 * carries `unreadCount` only, which is why the divider is counted back from
 * the tail rather than placed after a `lastReadSeq`.
 */
export function findUnreadDivider(
  messages: ChatMessageDto[],
  snapshot: UnreadSnapshot,
  me: number,
): string | null {
  if (snapshot.count <= 0) return null;
  let seen = 0;
  let oldest: string | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.seq > snapshot.boundarySeq || !countsAsUnread(m, me)) continue;
    oldest = m.id;
    if (++seen >= snapshot.count) break;
  }
  return oldest;
}

/** Eligible messages newer than `seenSeq` — the "N new messages" count. */
export function countNewSince(
  messages: ChatMessageDto[],
  seenSeq: number,
  me: number,
): number {
  let n = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.seq <= seenSeq) break;
    if (countsAsUnread(m, me)) n++;
  }
  return n;
}
