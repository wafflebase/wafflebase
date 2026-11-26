import { useSyncExternalStore } from "react";

/**
 * The live stream's state, as the conversation footer reports it.
 * `connecting` is the quiet first attempt (and "no stream mounted");
 * `reconnecting` is the stream being reopened after a drop, by the browser
 * or by `useChatStream` once the browser gave up; `stopped` is the session
 * having ended, which only signing in again recovers from.
 */
export type ChatConnection = "connecting" | "live" | "reconnecting" | "stopped";

let state: ChatConnection = "connecting";
const listeners = new Set<() => void>();

export function getChatConnection(): ChatConnection {
  return state;
}

export function setChatConnection(next: ChatConnection): void {
  if (next === state) return;
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useChatConnection(): ChatConnection {
  return useSyncExternalStore(subscribe, getChatConnection, getChatConnection);
}
