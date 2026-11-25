import { createContext, useContext } from "react";

import { draftStore } from "./draft-store";

export interface ChatPanelOpenOptions {
  /** The channel to show; without one the panel picks (see `ChatPanel`). */
  channelId?: string;
  /** Text to put in that channel's composer, after any draft already there. */
  draft?: string;
}

/** What an editor surface — a context menu's "Send to chat" — may ask of the panel. */
export interface ChatPanelApi {
  open(opts?: ChatPanelOpenOptions): void;
  close(): void;
  isOpen: boolean;
}

export interface ChatPanelState {
  api: ChatPanelApi;
  /**
   * The channel asked for — a `?chat=` link, `open({ channelId })`, or the
   * panel's own switcher. Null lets the panel choose.
   */
  channelId: string | null;
  selectChannel: (channelId: string) => void;
  /** A draft from `open({ draft })` without a channel, until one is chosen. */
  pendingDraft: string | null;
  /** Seeds the pending draft into `channelId`'s composer. */
  takePendingDraft: (channelId: string) => void;
  /**
   * Bumped whenever a draft is seeded, so the panel remounts its composer:
   * the composer reads the draft store when it mounts, not on every render.
   */
  draftSeed: number;
}

export const ChatPanelContext = createContext<ChatPanelState | null>(null);

const INERT: ChatPanelApi = {
  open: () => {},
  close: () => {},
  isOpen: false,
};

/**
 * Adds `text` to `channelId`'s composer draft. Appended on its own line
 * rather than replacing, so a half-written message is never lost to a
 * "Send to chat".
 */
export function seedChatDraft(
  userId: number,
  channelId: string,
  text: string,
): void {
  const existing = draftStore.get(userId, channelId);
  draftStore.set(
    userId,
    channelId,
    existing.trim() ? `${existing}\n${text}` : text,
  );
}

/**
 * Open, close or ask about the editor's chat panel. Outside an editor (a
 * share-link viewer, a test) there is no panel, and this is inert.
 */
export function useChatPanel(): ChatPanelApi {
  return useContext(ChatPanelContext)?.api ?? INERT;
}

/** The panel's own view of the state; null outside a `ChatPanelProvider`. */
export function useChatPanelState(): ChatPanelState | null {
  return useContext(ChatPanelContext);
}
