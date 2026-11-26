/**
 * The channel a user last opened in a workspace, kept in `localStorage`.
 * The Chat page returns to it when opened bare, and an editor's chat panel
 * falls back to it when nothing more specific says which channel to show.
 * A convenience only: storage can be missing or throw, and every access is
 * guarded.
 *
 * Also the rule for landing on it, which the Chat page and the panel share.
 */
import type { ChannelSummary } from "@/api/chat";

const LAST_CHANNEL_KEY = (workspaceId: string) =>
  `wafflebase:chat-last:${workspaceId}`;

export function readLastChannel(workspaceId: string): string | null {
  try {
    return window.localStorage.getItem(LAST_CHANNEL_KEY(workspaceId));
  } catch {
    return null;
  }
}

export function writeLastChannel(workspaceId: string, channelId: string): void {
  try {
    window.localStorage.setItem(LAST_CHANNEL_KEY(workspaceId), channelId);
  } catch {
    // A convenience only.
  }
}

export function forgetLastChannel(workspaceId: string, channelId: string): void {
  try {
    if (readLastChannel(workspaceId) === channelId) {
      window.localStorage.removeItem(LAST_CHANNEL_KEY(workspaceId));
    }
  } catch {
    // A convenience only.
  }
}

/**
 * A channel the user can talk in: one they belong to, not archived.
 * Membership matters because a public channel stays in the list after you
 * leave it, and returning there would undo the leave.
 */
export function canTalkIn(channel: ChannelSummary): boolean {
  return channel.isMember && !channel.archived;
}

/**
 * Where to land without a more specific target: the last channel, while the
 * caller can still talk in it, else the workspace's default channel. A bare
 * `/chat` on desktop lands here; the editor's chat panel falls back to it.
 */
export function landingChannelId(
  channels: ChannelSummary[],
  last: string | null,
): string | null {
  if (last && channels.some((c) => c.id === last && canTalkIn(c))) return last;
  return channels.find((c) => c.isDefault && canTalkIn(c))?.id ?? null;
}
