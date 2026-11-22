export type ChatShortcut =
  | "prev"
  | "next"
  | "prev-unread"
  | "next-unread"
  | "switcher";

/**
 * The Chat page's own keys, Slack's bindings:
 *
 * - Alt+↑ / Alt+↓ — previous / next channel in sidebar order
 * - Alt+Shift+↑ / Alt+Shift+↓ — previous / next channel with unread
 * - Mod+K — the channel switcher
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
  return null;
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
