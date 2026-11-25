/**
 * The channel a user last opened in a workspace, kept in `localStorage`.
 * The Chat page returns to it when opened bare, and an editor's chat panel
 * falls back to it when nothing more specific says which channel to show.
 * A convenience only: storage can be missing or throw, and every access is
 * guarded.
 */
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
