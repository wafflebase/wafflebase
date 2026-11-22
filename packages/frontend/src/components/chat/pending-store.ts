import type { QueryClient } from "@tanstack/react-query";
import type { User } from "@/types/users";
import { chatKeys, type PendingSend } from "./chat-cache";

/**
 * The reader's unanswered sends per channel, mirrored to `sessionStorage` so
 * a failed message outlives a reload the way the draft it replaced did: the
 * composer clears on send, so this is the only copy of the text until the
 * server has it.
 *
 * A send still marked pending when it is read back had its request cut off
 * by the reload; whether the server took it is unknown, so it comes back
 * failed: Retry may post it twice if the server had taken it, which is the
 * lesser harm next to hiding a message that never arrived.
 *
 * Keyed by the signed-in user as well as the channel, so a sign-out and a
 * different sign-in in the same tab never sees — or re-sends — the previous
 * user's text. Signed out (no user known) nothing is stored.
 *
 * Storage can be missing or throw (a private window, blocked site data);
 * every access is guarded, and the sends then live in memory only.
 */
const KEY_PREFIX = "wafflebase:chat-pending:";

const key = (userId: number, channelId: string) =>
  `${KEY_PREFIX}${userId}:${channelId}`;

export const pendingStore = {
  load(userId: number | undefined, channelId: string): PendingSend[] {
    if (userId === undefined) return [];
    try {
      const raw = window.sessionStorage.getItem(key(userId, channelId));
      if (!raw) return [];
      const sends = JSON.parse(raw) as PendingSend[];
      if (!Array.isArray(sends)) return [];
      return sends.map((p) =>
        p.state === "pending"
          ? {
              ...p,
              state: "failed",
              message: { ...p.message, localState: "failed" },
            }
          : p,
      );
    } catch {
      return [];
    }
  },

  save(
    userId: number | undefined,
    channelId: string,
    sends: PendingSend[],
  ): void {
    if (userId === undefined) return;
    try {
      if (sends.length) {
        window.sessionStorage.setItem(
          key(userId, channelId),
          JSON.stringify(sends),
        );
      } else {
        window.sessionStorage.removeItem(key(userId, channelId));
      }
    } catch {
      // Storage unavailable; the sends live only as long as the tab.
    }
  },
};

/** Change a channel's unanswered sends, in the query cache and in storage. */
export function updatePending(
  queryClient: QueryClient,
  channelId: string,
  update: (sends: PendingSend[]) => PendingSend[],
): void {
  const userId = queryClient.getQueryData<User>(["me"])?.id;
  const next = update(
    queryClient.getQueryData<PendingSend[]>(chatKeys.pending(channelId)) ??
      pendingStore.load(userId, channelId),
  );
  queryClient.setQueryData<PendingSend[]>(chatKeys.pending(channelId), next);
  pendingStore.save(userId, channelId, next);
}
