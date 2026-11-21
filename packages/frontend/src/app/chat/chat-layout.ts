export type ChatPane = "list" | "conversation" | "thread";

/**
 * Which panes the Chat page shows. On desktop the channel list and the
 * conversation sit side by side, with a thread column when one is open. On a
 * phone there is room for one, and the deepest open level wins, so the back
 * button steps up one level at a time. A thread without a channel cannot be
 * shown and is ignored.
 */
export function chatLayout({
  isMobile,
  channelId,
  threadId,
}: {
  isMobile: boolean;
  channelId: string | null;
  threadId: string | null;
}): { show: ChatPane[] } {
  const hasThread = !!channelId && !!threadId;
  if (isMobile) {
    if (hasThread) return { show: ["thread"] };
    if (channelId) return { show: ["conversation"] };
    return { show: ["list"] };
  }
  return {
    show: hasThread
      ? ["list", "conversation", "thread"]
      : ["list", "conversation"],
  };
}
