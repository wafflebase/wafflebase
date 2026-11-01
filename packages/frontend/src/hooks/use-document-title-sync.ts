import { useCallback, useEffect } from "react";
import { createDocumentSelector } from "@yorkie-js/react";
import { useQueryClient } from "@tanstack/react-query";

/**
 * The one presence field this hook owns. Every editor's presence type stays
 * untouched: the field is optional, written only here, and read only here.
 */
type TitleSyncPresence = { titleRev?: string };

/**
 * Selector form, not a bare `useDocument()`: the layouts that call this must
 * not re-render on every keystroke and peer cursor move (see
 * `app/__tests__/detail-layout-subscriptions.test.ts`). The `doc` handle's
 * identity never changes, so this re-renders on nothing.
 */
const useTitleSyncDoc = createDocumentSelector<unknown, TitleSyncPresence>();

/**
 * Keep the document title live across collaborators.
 *
 * The title lives in Postgres, not in the CRDT, so a rename reaches nobody
 * else on its own. The renamer calls the returned `announce` after its
 * `PATCH /documents/:id` succeeds, which writes a fresh `titleRev` into its
 * presence; every peer that sees a client's `titleRev` change refetches the
 * document row. Postgres stays the single source of truth — presence carries
 * only "it changed", and is ephemeral, so nothing lands in snapshots,
 * revisions, or copies.
 *
 * A peer that joins carries whatever `titleRev` it last wrote; that is not
 * news to anyone who already fetched the row, so `watched` only records it.
 */
export function useDocumentTitleSync(documentId: string): () => void {
  const doc = useTitleSyncDoc((s) => s.doc);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!doc) return;
    const seen = new Map<string, string | undefined>();
    for (const { clientID, presence } of doc.getOthersPresences()) {
      seen.set(clientID, presence?.titleRev);
    }
    return doc.subscribe("others", (event) => {
      if (event.type !== "watched" && event.type !== "presence-changed") {
        return;
      }
      const { clientID, presence } = event.value;
      const rev = presence?.titleRev;
      const prev = seen.get(clientID);
      seen.set(clientID, rev);
      if (event.type === "watched" || rev === undefined || rev === prev) {
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["document", documentId] });
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    });
  }, [doc, documentId, queryClient]);

  return useCallback(() => {
    doc?.update((_, presence) => {
      presence.set({ titleRev: crypto.randomUUID() });
    });
  }, [doc]);
}
