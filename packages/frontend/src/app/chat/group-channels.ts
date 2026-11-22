import type { ChannelSummary } from "@/api/chat";

const byName = (a: ChannelSummary, b: ChannelSummary) =>
  (a.name ?? "").localeCompare(b.name ?? "");

/**
 * The channel list's sections. Public channels the caller has not joined are
 * left out: those are found through "Browse channels" in the new-channel
 * dialog rather than crowding the list. Archived channels the caller is in
 * get a group of their own, which the list keeps collapsed — out of the way,
 * but still the place to find one again and unarchive it.
 */
export function groupChannels(channels: ChannelSummary[]): {
  channels: ChannelSummary[];
  directMessages: ChannelSummary[];
  archived: ChannelSummary[];
} {
  const live = channels.filter((c) => !c.archived);
  return {
    channels: live
      .filter((c) => c.kind !== "dm" && c.isMember)
      .sort(byName),
    directMessages: live
      .filter((c) => c.kind === "dm")
      // ISO timestamps sort lexically; a DM with no message yet goes last.
      .sort((a, b) =>
        (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""),
      ),
    // A DM cannot be archived; the kind check only keeps one that somehow
    // is from surfacing as a nameless row.
    archived: channels
      .filter((c) => c.archived && c.kind !== "dm" && c.isMember)
      .sort(byName),
  };
}

/**
 * The public channels "Browse channels" offers: the live ones the caller has
 * not joined, and apart from them the archived ones, which can be read but
 * not joined or posted in.
 */
export function browsableChannels(channels: ChannelSummary[]): {
  live: ChannelSummary[];
  archived: ChannelSummary[];
} {
  const open = channels.filter((c) => c.kind === "public" && !c.isMember);
  return {
    live: open.filter((c) => !c.archived).sort(byName),
    archived: open.filter((c) => c.archived).sort(byName),
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
