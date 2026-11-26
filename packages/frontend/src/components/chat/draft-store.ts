/**
 * Per-channel composer drafts, kept in `sessionStorage` so a half-written
 * message survives navigating away and back within the tab.
 *
 * Keyed by the signed-in user as well as the channel, as pending sends are
 * (`pending-store.ts`), so a sign-out and a different sign-in in the same
 * tab never finds the previous user's half-written text in the box. Signed
 * out (no user known) nothing is stored. A draft saved before drafts were
 * keyed by user names nobody, so it is never adopted; `dropLegacy` discards
 * it. `get` only reads, so a composer may call it while rendering.
 *
 * Storage can be missing or throw (a private window, blocked site data), so
 * every access is guarded: a draft is a convenience, and losing one must never
 * break the composer.
 */
const KEY_PREFIX = "wafflebase:chat-draft:";

const key = (userId: number, channelId: string) =>
  `${KEY_PREFIX}${userId}:${channelId}`;

/** The pre-user key format; read only to delete it. */
const legacyKey = (channelId: string) => `${KEY_PREFIX}${channelId}`;

export const draftStore = {
  get(userId: number | undefined, channelId: string): string {
    if (userId === undefined) return "";
    try {
      return window.sessionStorage.getItem(key(userId, channelId)) ?? "";
    } catch {
      return "";
    }
  },

  /** Deletes the channel's draft from before drafts were keyed by user. */
  dropLegacy(channelId: string): void {
    try {
      window.sessionStorage.removeItem(legacyKey(channelId));
    } catch {
      // As below.
    }
  },

  set(userId: number | undefined, channelId: string, text: string): void {
    if (userId === undefined) return;
    try {
      if (text) window.sessionStorage.setItem(key(userId, channelId), text);
      else window.sessionStorage.removeItem(key(userId, channelId));
    } catch {
      // Storage unavailable; the draft lives only as long as the composer.
    }
  },

  clear(userId: number | undefined, channelId: string): void {
    if (userId === undefined) return;
    try {
      window.sessionStorage.removeItem(key(userId, channelId));
    } catch {
      // As above.
    }
  },
};
