import type { ChannelSummary } from "@/api/chat";

/**
 * Whether the caller may remove other people from a channel. The server's
 * rule: whoever may rename or archive it (`canManage`), except in the
 * default channel, which everyone in the workspace belongs to.
 */
export function canRemoveMembers(channel: ChannelSummary): boolean {
  return channel.kind !== "dm" && channel.canManage && !channel.isDefault;
}
