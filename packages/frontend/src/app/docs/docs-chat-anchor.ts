import { getBlockText, type EditorAPI } from "@wafflebase/docs";

import type { DocAnchor } from "@/components/chat/document-link";
import { docChatAnchor } from "@/components/chat/send-to-chat";

import { extractAnchorContext } from "./comments/docs-anchor";

/** What "Send to chat" reads off a live docs editor. */
export type DocsSendSource = Pick<
  EditorAPI,
  "getActiveSelection" | "getDoc" | "positionAtClientPoint"
>;

/**
 * The anchor "Send to chat" sends from a docs editor: the first block of the
 * selection plus an excerpt of it (chat.md: a text range is reduced to its
 * first block). With only a caret, the block right-clicked at `point` and its
 * own text. Null when the point is on no block, and the link goes out
 * document-level.
 */
export function docsSendToChatAnchor(
  editor: DocsSendSource,
  point: { x: number; y: number },
): DocAnchor | null {
  const sel = editor.getActiveSelection();
  if (sel) {
    const ctx = extractAnchorContext(editor.getDoc().document, sel);
    return docChatAnchor(ctx.blockId, ctx.quotedText);
  }
  const pos = editor.positionAtClientPoint(point.x, point.y);
  const block = pos ? editor.getDoc().findBlock(pos.blockId) : undefined;
  return pos && block ? docChatAnchor(pos.blockId, getBlockText(block)) : null;
}
