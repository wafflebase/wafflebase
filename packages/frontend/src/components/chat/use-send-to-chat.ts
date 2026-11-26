import { useCallback } from "react";

import { useChatPanel, useChatPanelAvailable } from "./chat-panel-context";
import { buildDocumentUrl, type ChatDocumentAnchor } from "./document-link";

/**
 * "Send to chat" for an editor (`docs/design/chat.md` § User Journeys 3):
 * opens the editor's chat panel with a link to this document — anchored at
 * `anchor` when given — waiting in the composer, so the user picks the
 * channel in the panel's switcher, adds a word and sends. The server turns
 * the link into a card.
 *
 * Null where there is nothing to send to — no document id, no panel (a
 * share-link viewer), or the panel withheld (a revision preview) — so a menu
 * hides the item instead of offering one that does nothing.
 */
export function useSendToChat(
  type: string,
  documentId: string | undefined,
): ((anchor: ChatDocumentAnchor | null) => void) | null {
  const available = useChatPanelAvailable();
  const panel = useChatPanel();
  const open = panel.open;
  const send = useCallback(
    (anchor: ChatDocumentAnchor | null) => {
      if (!documentId) return;
      open({ draft: buildDocumentUrl({ id: documentId, type }, { at: anchor }) });
    },
    [documentId, type, open],
  );
  return available && documentId ? send : null;
}
