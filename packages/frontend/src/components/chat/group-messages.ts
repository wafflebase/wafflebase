import type { ChatMessageDto } from "@/api/chat";

/** Consecutive messages by one author this close together share a header. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

export interface MessageGroup {
  author: ChatMessageDto["author"];
  first: ChatMessageDto;
  rest: ChatMessageDto[];
}

/**
 * Collapse a run of messages into author groups, the way a chat log reads: one
 * name and time, then the lines under it. A run breaks on a new author, on a
 * gap over five minutes, and after a message carrying a reply-count row (the
 * row would otherwise sit between two lines of one group). Messages whose
 * author was deleted never merge — nothing says they were one person.
 */
export function groupMessages(msgs: ChatMessageDto[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let current: MessageGroup | null = null;
  let previous: ChatMessageDto | null = null;

  for (const m of msgs) {
    const joins =
      current !== null &&
      previous !== null &&
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
