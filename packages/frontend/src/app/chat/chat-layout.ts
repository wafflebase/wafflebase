import type { ChannelSummary } from "@/api/chat";

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

/**
 * Which channel actions to offer. Everyone is always in the default channel,
 * so it has no Add people, Leave or Archive; it can still be renamed.
 */
export function channelMenu(channel: ChannelSummary | undefined) {
  const room = !!channel && channel.kind !== "dm";
  const live = room && !channel.archived;
  const edit = live && channel.canManage;
  const addPeople = live && channel.isMember && !channel.isDefault;
  const archive = room && channel.canManage && !channel.isDefault;
  const leave = room && channel.isMember && !channel.isDefault;
  return { edit, addPeople, archive, leave, any: edit || addPeople || archive || leave };
}

/**
 * The browser tab's title on the Chat page: "(3) #q4-planning · Chat —
 * Wafflebase". The count is the sidebar Chat badge's (`chatBadgeCount`:
 * mentions plus unread DMs — what Slack badges, and what Gmail-style "(n)"
 * titles count), so the tab and the badge never disagree, and a merely busy
 * channel no more lights up the tab than it lights up the badge.
 */
export function chatTitle(
  channel: ChannelSummary | undefined,
  label: string,
  count: number,
): string {
  const where = channel
    ? `${channel.kind === "dm" ? label : `#${label}`} · Chat`
    : "Chat";
  return `${count > 0 ? `(${count > 99 ? "99+" : count}) ` : ""}${where} — Wafflebase`;
}
