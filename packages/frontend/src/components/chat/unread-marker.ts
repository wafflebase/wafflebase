import type { ChatMessageDto } from '@/api/chat';

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

/** What was unread when the channel opened: the `seq` range after `readSeq` up to `lastSeq`. */
export interface UnreadRange {
  readSeq: number;
  lastSeq: number;
}

/**
 * The id of the message the "New messages" divider sits above: the first
 * eligible message in the range that was unread at open. Messages that
 * arrive later are past `lastSeq` and never move it, and it is right on any
 * partial load — a loaded message in the range is unread whether or not the
 * rest of the log has arrived. Null when nothing loaded is.
 */
export function findUnreadDivider(
  messages: ChatMessageDto[],
  range: UnreadRange,
  me: number,
): string | null {
  for (const m of messages) {
    if (m.seq <= range.readSeq) continue;
    if (m.seq > range.lastSeq) break;
    if (countsAsUnread(m, me)) return m.id;
  }
  return null;
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
