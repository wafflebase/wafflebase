import type { QueryClient } from "@tanstack/react-query";
import { chatKeys, type PendingSend } from "./chat-cache";

/**
 * The reader's unanswered sends per channel, mirrored to `sessionStorage` so
 * a failed message outlives a reload the way the draft it replaced did: the
 * composer clears on send, so this is the only copy of the text until the
 * server has it.
 *
 * A send still marked pending when it is read back had its request cut off
 * by the reload; whether the server took it is unknown, so it comes back
 * failed. If the server did take it, `withPending` hides it once the
 * server's row is loaded, so Retry is never offered for a message that
 * arrived.
 *
 * Storage can be missing or throw (a private window, blocked site data);
 * every access is guarded, and the sends then live in memory only.
 */
const KEY_PREFIX = "wafflebase:chat-pending:";

const key = (channelId: string) => `${KEY_PREFIX}${channelId}`;

export const pendingStore = {
  load(channelId: string): PendingSend[] {
    try {
      const raw = window.sessionStorage.getItem(key(channelId));
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

  save(channelId: string, sends: PendingSend[]): void {
    try {
      if (sends.length) {
        window.sessionStorage.setItem(key(channelId), JSON.stringify(sends));
      } else {
        window.sessionStorage.removeItem(key(channelId));
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
  const next = update(
    queryClient.getQueryData<PendingSend[]>(chatKeys.pending(channelId)) ??
      pendingStore.load(channelId),
  );
  queryClient.setQueryData<PendingSend[]>(chatKeys.pending(channelId), next);
  pendingStore.save(channelId, next);
}
