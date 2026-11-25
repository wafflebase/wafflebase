import type { DocAnchor, SlidesAnchor } from "./document-link";

/*
 * Anchors for "Send to chat", built from an editor's live selection
 * (`docs/design/chat.md` § Document Cards and Anchors). Chat cannot work out
 * "Sheet1!C3:E7" or "Slide 4" on its own — it never opens the document — so
 * the sender fills `label`, and the card shows it. The limits are the ones
 * `decodeAnchor` and the server's `parseAnchor` hold an anchor to: one built
 * over them would be dropped as garbage on the way back. The sheet half,
 * which needs the sheets engine, is `app/spreadsheet/chat-anchor.ts`.
 */

export const MAX_LABEL = 80;
const MAX_EXCERPT = 200;

/** `text` with its whitespace runs collapsed, cut to `max` with an ellipsis. */
export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/**
 * A doc anchor: the first block of the selection plus up to 200 characters
 * of what was selected, shown on the card. A CRDT-stable text range is out
 * of scope for v1 (chat.md), so the excerpt is a snapshot, not a live range.
 */
export function docChatAnchor(blockId: string, text: string): DocAnchor {
  const excerpt = clip(text, MAX_EXCERPT);
  if (!excerpt) return { blockId };
  return { blockId, excerpt, label: clip(excerpt, MAX_LABEL) };
}

/** A slides anchor, labelled by the slide's 0-based `index` in the deck. */
export function slidesChatAnchor(slideId: string, index: number): SlidesAnchor {
  return { slideId, label: `Slide ${index + 1}` };
}
