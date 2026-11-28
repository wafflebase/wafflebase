import { timeAgo } from "../webhooks/webhook-copy";

export const BOTS_SECTION_ID = "bots";

/** The server's rule for a bot name (lowercase, starts alphanumeric, 2–32). */
export const BOT_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,31}$/;

/** A host counts as listening when it polled for work this recently. */
const LISTENING_WINDOW_MS = 60_000;

/** How often the Connect dialog re-reads the bot until a host shows up. */
export const CONNECT_POLL_MS = 5_000;

export type HostState = "none" | "listening" | "offline";

/**
 * The bot's host status as words: never polled, polled within the last
 * minute, or polled once and gone quiet since.
 */
export function hostStatus(
  lastSeenAt: string | null,
  now: number = Date.now(),
): { state: HostState; text: string } {
  if (!lastSeenAt) return { state: "none", text: "Not connected" };
  if (now - new Date(lastSeenAt).getTime() < LISTENING_WINDOW_MS) {
    return { state: "listening", text: "Listening" };
  }
  return {
    state: "offline",
    text: `Offline · last seen ${timeAgo(lastSeenAt, now)}`,
  };
}
