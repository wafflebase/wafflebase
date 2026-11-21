import type { ChannelSummary } from "@/api/chat";

/**
 * The channel list's two sections. Archived channels are left out, and so are
 * public channels the caller has not joined: those are found through "Browse
 * channels" in the new-channel dialog rather than crowding the list.
 */
export function groupChannels(channels: ChannelSummary[]): {
  channels: ChannelSummary[];
  directMessages: ChannelSummary[];
} {
  const live = channels.filter((c) => !c.archived);
  return {
    channels: live
      .filter((c) => c.kind !== "dm" && c.isMember)
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")),
    directMessages: live
      .filter((c) => c.kind === "dm")
      // ISO timestamps sort lexically; a DM with no message yet goes last.
      .sort((a, b) =>
        (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""),
      ),
  };
}

/**
 * What to call a channel: its name, or for a DM the other members'
 * usernames. A DM whose only member is the caller is labelled by them.
 */
export function channelLabel(channel: ChannelSummary, me: number): string {
  if (channel.kind !== "dm") return channel.name ?? "";
  const others = channel.members.filter((m) => m.id !== me);
  const shown = others.length > 0 ? others : channel.members;
  return shown.map((m) => m.username).join(", ");
}
