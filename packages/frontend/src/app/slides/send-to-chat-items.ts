import type { ContextMenuItem, SlidesEditor } from "@wafflebase/slides";

import type { SlidesAnchor } from "@/components/chat/document-link";
import { slidesChatAnchor } from "@/components/chat/send-to-chat";

/**
 * The "Send to chat" entry the slides editor's canvas and element menus end
 * with (through `hostCanvasMenuItems` / `hostElementMenuItems`), anchored at
 * the current slide and labelled by its position in the deck. Empty when
 * there is nothing to send to, so the menu is unchanged for a share-link
 * viewer and during a revision preview.
 */
export function sendToChatMenuItems(
  editor: Pick<SlidesEditor, "getCurrentSlideId"> | null,
  slideIds: () => readonly string[],
  send: ((anchor: SlidesAnchor | null) => void) | null,
): ContextMenuItem[] {
  if (!editor || !send) return [];
  return [
    { label: "---", run: () => undefined },
    {
      label: "Send to chat",
      run: () => {
        // Not one of the deck's slides (a layout being edited): the link
        // goes out document-level.
        const id = editor.getCurrentSlideId();
        const index = id ? slideIds().indexOf(id) : -1;
        send(id && index >= 0 ? slidesChatAnchor(id, index) : null);
      },
    },
  ];
}
