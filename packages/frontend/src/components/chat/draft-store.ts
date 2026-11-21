/**
 * Per-channel composer drafts, kept in `sessionStorage` so a half-written
 * message survives navigating away and back within the tab.
 *
 * Storage can be missing or throw (a private window, blocked site data), so
 * every access is guarded: a draft is a convenience, and losing one must never
 * break the composer.
 */
const KEY_PREFIX = "wafflebase:chat-draft:";

const key = (channelId: string) => `${KEY_PREFIX}${channelId}`;

export const draftStore = {
  get(channelId: string): string {
    try {
      return window.sessionStorage.getItem(key(channelId)) ?? "";
    } catch {
      return "";
    }
  },

  set(channelId: string, text: string): void {
    try {
      if (text) window.sessionStorage.setItem(key(channelId), text);
      else window.sessionStorage.removeItem(key(channelId));
    } catch {
      // Storage unavailable; the draft lives only as long as the composer.
    }
  },

  clear(channelId: string): void {
    try {
      window.sessionStorage.removeItem(key(channelId));
    } catch {
      // As above.
    }
  },
};
