import type { ShortcutItem } from "@/components/shortcuts-help-dialog";

export type ChatShortcut =
  | "prev"
  | "next"
  | "prev-unread"
  | "next-unread"
  | "switcher"
  | "help";

/**
 * The Chat page's own keys, Slack's bindings:
 *
 * - Alt+↑ / Alt+↓ — previous / next channel in sidebar order
 * - Alt+Shift+↑ / Alt+Shift+↓ — previous / next channel with unread
 * - Mod+K — the channel switcher
 * - Mod+/ — the shortcut sheet
 *
 * Alt+arrows are taken even from the composer: there they would only jump
 * the caret to a paragraph edge, which Home/End and Mod+arrows also do.
 * Nothing else in the app binds Mod+K outside an editor (the board's link
 * shortcut lives on another route), so the page can own it outright. An
 * event something else already handled, or one inside an IME composition,
 * is left alone.
 */
export function chatShortcut(e: KeyboardEvent): ChatShortcut | null {
  if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return null;
  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    if (e.key === "ArrowUp") return e.shiftKey ? "prev-unread" : "prev";
    if (e.key === "ArrowDown") return e.shiftKey ? "next-unread" : "next";
    return null;
  }
  // `code`, not `key`: a non-Latin layout types something else for K.
  if (
    (e.metaKey || e.ctrlKey) &&
    !e.altKey &&
    !e.shiftKey &&
    (e.code === "KeyK" || e.key.toLowerCase() === "k")
  ) {
    return "switcher";
  }
  if (
    (e.metaKey || e.ctrlKey) &&
    !e.altKey &&
    !e.shiftKey &&
    (e.code === "Slash" || e.key === "/")
  ) {
    return "help";
  }
  return null;
}

export const CHAT_SHORTCUT_CATEGORIES = [
  "Channels",
  "Composer",
  "Messages",
  "Help",
] as const;

/**
 * The Chat page's shortcut sheet (Mod+/): the page's own keys above, the
 * composer's, and the message log's roving keys (`useRovingMessages`).
 */
export const CHAT_SHORTCUTS: ReadonlyArray<ShortcutItem> = [
  { category: "Channels", keys: ["Mod+K"], description: "Jump to a channel or person" },
  { category: "Channels", keys: ["Alt+↑", "Alt+↓"], description: "Previous / next channel" },
  { category: "Channels", keys: ["Alt+Shift+↑", "Alt+Shift+↓"], description: "Previous / next unread channel" },

  { category: "Composer", keys: ["Enter"], description: "Send" },
  { category: "Composer", keys: ["Shift+Enter"], description: "New line" },
  { category: "Composer", keys: ["@"], description: "Mention someone" },
  { category: "Composer", keys: ["↑"], description: "Edit your last message (in an empty box)" },

  { category: "Messages", keys: ["↑", "↓"], description: "Previous / next message" },
  { category: "Messages", keys: ["Home", "End"], description: "First / last message" },
  { category: "Messages", keys: ["Enter"], description: "Open the message's thread" },
  { category: "Messages", keys: ["Esc"], description: "Back to the composer; close a thread" },

  { category: "Help", keys: ["Mod+/"], description: "Show keyboard shortcuts" },
];

/** "Mod+Shift+K" as the platform writes it: "⌘⇧K" or "Ctrl+Shift+K". */
export function formatChatCombo(combo: string, isMac: boolean): string {
  return combo
    .split("+")
    .map((part) => {
      if (part === "Mod") return isMac ? "⌘" : "Ctrl";
      if (part === "Shift") return isMac ? "⇧" : "Shift";
      if (part === "Alt") return isMac ? "⌥" : "Alt";
      return part;
    })
    .join(isMac ? "" : "+");
}

/**
 * Whether a modal surface (dialog, alert, menu, sheet) is open, in which case
 * the page's channel keys must not move the conversation out from under it.
 * Radix unmounts closed content, so presence in the DOM is the signal.
 */
export function modalSurfaceOpen(doc: Document = document): boolean {
  return !!doc.querySelector(
    '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
  );
}
