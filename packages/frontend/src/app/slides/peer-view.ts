import { getPeerCursorColor } from "@wafflebase/sheets";
import type { PeerView } from "@wafflebase/slides";
import type { SlidesPresence } from "@/types/users";

type RawPeer = { clientID: string; presence: SlidesPresence };

/**
 * Map raw Yorkie peer presences (from `store.getPeers()`) into the
 * presentation-agnostic `PeerView[]` the slides editor overlay paints.
 *
 * - Drops peers with no `activeSlideId` — they aren't on any slide yet,
 *   so there's nothing to draw and the editor would filter them anyway.
 * - Assigns each peer a stable colour from its client id (shared with
 *   the docs peer cursors and the document avatar stack).
 * - `getPeers()` already excludes the local client (`getOthersPresences`),
 *   so no self-filtering is needed here.
 */
export function mapPresenceToPeerView(
  peers: readonly RawPeer[],
  theme: "light" | "dark",
): PeerView[] {
  const views: PeerView[] = [];
  for (const { clientID, presence } of peers) {
    if (!presence || !presence.activeSlideId) continue;
    views.push({
      clientID,
      color: getPeerCursorColor(theme, clientID),
      label: presence.username || "Anonymous",
      activeSlideId: presence.activeSlideId,
      selectedElementIds: presence.selectedElementIds,
      activeFrames: presence.activeFrames,
      draggingGuide: presence.draggingGuide
        ? {
            axis: presence.draggingGuide.axis,
            position: presence.draggingGuide.position,
          }
        : undefined,
      selectedTableCells: presence.selectedTableCells,
    });
  }
  return views;
}
