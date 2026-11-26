import type { ChannelSummary } from "@/api/chat";

const byName = (a: ChannelSummary, b: ChannelSummary) =>
  (a.name ?? "").localeCompare(b.name ?? "");

/**
 * The channel list's sections. Public channels the caller has not joined are
 * left out: those are found through "Browse channels" rather than crowding
 * the list. The one exception is the channel open right now (`activeId`), a
 * preview: it sits in its section, sorted by name, for as long as it is open,
 * so the list never loses track of where you are. Archived channels the
 * caller is in get a group of their own, which the list keeps collapsed — out
 * of the way, but still the place to find one again and unarchive it.
 */
export function groupChannels(
  channels: ChannelSummary[],
  activeId: string | null = null,
): {
  channels: ChannelSummary[];
  directMessages: ChannelSummary[];
  archived: ChannelSummary[];
} {
  const shown = (c: ChannelSummary) => c.isMember || c.id === activeId;
  const live = channels.filter((c) => !c.archived);
  return {
    channels: live
      .filter((c) => c.kind !== "dm" && shown(c))
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
      .filter((c) => c.archived && c.kind !== "dm" && shown(c))
      .sort(byName),
  };
}

/**
 * The order Alt+↑/↓ walks: Channels, then Direct messages, as the list shows
 * them. Archived channels are left out — nothing can be posted there, and the
 * section is usually collapsed.
 */
export function sidebarOrder(
  channels: ChannelSummary[],
  activeId: string | null,
): ChannelSummary[] {
  const { channels: rooms, directMessages } = groupChannels(channels, activeId);
  return [...rooms, ...directMessages];
}

/**
 * The channel `step` places from `activeId` in sidebar order, wrapping at
 * the ends; with `unreadOnly`, the nearest one with anything unread. From a
 * channel outside the order (an archived one), down starts at the top and up
 * at the bottom. Null when there is nowhere to go.
 */
export function adjacentChannelId(
  channels: ChannelSummary[],
  activeId: string | null,
  step: 1 | -1,
  unreadOnly = false,
): string | null {
  const order = sidebarOrder(channels, activeId);
  const n = order.length;
  if (n === 0) return null;
  const at = order.findIndex((c) => c.id === activeId);
  const start = at === -1 ? (step === 1 ? -1 : n) : at;
  for (let i = 1; i <= n; i++) {
    const c = order[(((start + step * i) % n) + n) % n];
    if (c.id === activeId) continue;
    if (!unreadOnly || (c.isMember && c.unreadCount > 0)) return c.id;
  }
  return null;
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

export interface SwitcherItem {
  channel: ChannelSummary;
  label: string;
  /** A public channel the caller has not joined; opening it previews it. */
  joinable: boolean;
}

/**
 * What the switcher offers, in the order it lists them: joined channels and
 * DMs in sidebar order, then the public channels the caller could join.
 * Archived channels are left out — a switcher is for going somewhere to talk.
 * A query keeps the items whose label contains it, those starting with it
 * first, and otherwise in the same order.
 */
export function switcherItems(
  channels: ChannelSummary[],
  me: number,
  query: string,
): SwitcherItem[] {
  const { channels: rooms, directMessages } = groupChannels(channels);
  const all: SwitcherItem[] = [
    ...rooms.map((c) => ({ channel: c, label: c.name ?? "", joinable: false })),
    ...directMessages.map((c) => ({
      channel: c,
      label: channelLabel(c, me),
      joinable: false,
    })),
    ...browsableChannels(channels).live.map((c) => ({
      channel: c,
      label: c.name ?? "",
      joinable: true,
    })),
  ];
  const q = query.trim().replace(/^#/, "").toLowerCase();
  if (!q) return all;
  const hits = all.filter((i) => i.label.toLowerCase().includes(q));
  const starts = (i: SwitcherItem) => (i.label.toLowerCase().startsWith(q) ? 0 : 1);
  // Array.prototype.sort is stable, so ties keep sidebar order.
  return hits.sort((a, b) => starts(a) - starts(b));
}

/**
 * What a channel row's badge or dot means, read after its name. The number
 * is the one the badge shows (`channelCount`): the mentions when there are
 * any, else a DM's unread.
 */
export function unreadDescription(channel: ChannelSummary): string | undefined {
  const plural = (n: number, word: string) => `${n} unread ${word}${n === 1 ? "" : "s"}`;
  if (channel.mentionCount > 0) return plural(channel.mentionCount, "mention");
  if (channel.unreadCount <= 0) return undefined;
  if (channel.kind === "dm") return plural(channel.unreadCount, "message");
  return "unread messages";
}
