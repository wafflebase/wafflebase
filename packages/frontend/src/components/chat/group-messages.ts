import type { ChatMessageDto } from "@/api/chat";
import type { ChatLine } from "./chat-cache";

/** Consecutive messages by one author this close together share a header. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

export interface MessageGroup {
  author: ChatMessageDto["author"];
  first: ChatLine;
  rest: ChatLine[];
}

/**
 * Collapse a run of messages into author groups, the way a chat log reads: one
 * name and time, then the lines under it. A run breaks on a new author, on a
 * gap over five minutes, and after a message carrying a reply-count row (the
 * row would otherwise sit between two lines of one group). Messages whose
 * author was deleted never merge — nothing says they were one person.
 *
 * `breakBefore` names a message that must open its own group — the one the
 * "New messages" divider sits above, which would otherwise land mid-group.
 */
export function groupMessages(
  msgs: ChatLine[],
  breakBefore?: string | null,
): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let current: MessageGroup | null = null;
  let previous: ChatLine | null = null;

  for (const m of msgs) {
    const joins =
      current !== null &&
      previous !== null &&
      m.id !== breakBefore &&
      m.author !== null &&
      previous.author !== null &&
      m.author.id === previous.author.id &&
      previous.replyCount === 0 &&
      Date.parse(m.createdAt) - Date.parse(previous.createdAt) <=
        GROUP_WINDOW_MS;

    if (joins) {
      current!.rest.push(m);
    } else {
      current = { author: m.author, first: m, rest: [] };
      groups.push(current);
    }
    previous = m;
  }
  return groups;
}

/** The reader's newest message that can still be edited. */
export function lastOwnMessage<T extends ChatMessageDto>(
  messages: T[],
  me: number,
): T | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.author?.id === me && !m.deleted) return m;
  }
  return undefined;
}
