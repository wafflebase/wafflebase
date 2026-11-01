import { useCallback, useEffect, useRef } from "react";
import { createDocumentSelector } from "@yorkie-js/react";
import { useQueryClient } from "@tanstack/react-query";
import { renameDocument } from "@/api/documents";

/**
 * The one presence field this module owns. Every editor's presence type stays
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
 * Rename the document and keep its title live across collaborators.
 *
 * The title lives in Postgres, not in the CRDT, so a rename reaches nobody
 * else on its own. After `PATCH /documents/:id` succeeds, the renamer writes a
 * fresh `titleRev` into its presence; every peer that sees a client's
 * `titleRev` change refetches the document row. Postgres stays the single
 * source of truth — presence carries only "it changed", and is ephemeral, so
 * nothing lands in snapshots, revisions, or copies.
 *
 * A peer that joins carries whatever `titleRev` it last wrote; that is not
 * news to anyone who already fetched the row, so `watched` only records it.
 *
 * Returns the `onRename` handler for `SiteHeader`. Must be called inside the
 * document's `DocumentProvider`.
 */
export function useDocumentRename(
  documentId: string,
): (newTitle: string) => Promise<void> {
  const doc = useTitleSyncDoc((s) => s.doc);
  const queryClient = useQueryClient();
  // `@yorkie-js/react` publishes `doc` only once attach has finished, and the
  // header is editable before that. A rename in that window is announced as
  // soon as the document arrives rather than dropped.
  const pendingAnnounce = useRef(false);

  const refetchTitle = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["document", documentId] });
    queryClient.invalidateQueries({ queryKey: ["documents"] });
  }, [documentId, queryClient]);

  const announce = useCallback(() => {
    if (!doc) {
      pendingAnnounce.current = true;
      return;
    }
    pendingAnnounce.current = false;
    // Telling peers is best-effort: the rename itself already succeeded, and
    // a failed presence write must not surface as a failed rename.
    try {
      doc.update((_, presence) => {
        presence.set({ titleRev: crypto.randomUUID() });
      });
    } catch (err) {
      console.warn("[title-sync] could not announce rename:", err);
    }
  }, [doc]);

  useEffect(() => {
    if (!doc) return;
    if (pendingAnnounce.current) announce();
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
      refetchTitle();
    });
  }, [doc, announce, refetchTitle]);

  return useCallback(
    async (newTitle: string) => {
      await renameDocument(documentId, newTitle);
      refetchTitle();
      announce();
    },
    [documentId, refetchTitle, announce],
  );
}
