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
 * Minimum gap between two title refetches triggered by peers. `titleRev` is a
 * peer-written value, so a collaborator rewriting it in a loop must cost each
 * other browser at most one `GET /documents/:id` per window, not one per
 * presence event.
 */
export const TITLE_REFETCH_COOLDOWN_MS = 2000;

/**
 * Only has to differ from the previous value. Not `crypto.randomUUID`, which
 * is missing outside secure contexts (a plain-http self-host).
 */
function nextTitleRev(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Rename the document and keep its title live across collaborators.
 *
 * The title lives in Postgres, not in the CRDT, so a rename reaches nobody
 * else on its own. After `PATCH /documents/:id` succeeds, the renamer writes a
 * fresh `titleRev` into its presence; every peer that sees a `titleRev` it has
 * not recorded for that client refetches the document row. Postgres stays the
 * single source of truth — presence carries only "it changed", and is
 * ephemeral, so nothing lands in snapshots, revisions, or copies.
 *
 * "Not recorded" deliberately includes the presences present at attach and
 * those delivered by `watched`: a rename announced while this client was
 * attaching or its watch stream was reconnecting arrives exactly that way. A
 * freshly attached peer carries no `titleRev`, so the common join is free.
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
  // header is editable before that. The handler reads the document through
  // this ref — a handler created before attach must still see it when its
  // PATCH resolves — and a rename with no document yet is announced as soon
  // as one arrives.
  const docRef = useRef<typeof doc>(undefined);
  const pendingAnnounce = useRef(false);

  const refetchTitle = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["document", documentId] });
    queryClient.invalidateQueries({ queryKey: ["documents"] });
  }, [documentId, queryClient]);

  const announce = useCallback(() => {
    const current = docRef.current;
    if (!current) {
      pendingAnnounce.current = true;
      return;
    }
    pendingAnnounce.current = false;
    // Telling peers is best-effort: the rename itself already succeeded, and
    // a failed presence write must not surface as a failed rename.
    try {
      current.update((_, presence) => {
        presence.set({ titleRev: nextTitleRev() });
      });
    } catch (err) {
      console.warn("[title-sync] could not announce rename:", err);
    }
  }, []);

  useEffect(() => {
    if (!doc) return;
    docRef.current = doc;
    if (pendingAnnounce.current) announce();

    let lastRefetch = 0;
    let trailing: ReturnType<typeof setTimeout> | undefined;
    const scheduleRefetch = () => {
      if (trailing) return;
      const wait = lastRefetch + TITLE_REFETCH_COOLDOWN_MS - Date.now();
      const run = () => {
        trailing = undefined;
        lastRefetch = Date.now();
        refetchTitle();
      };
      if (wait <= 0) run();
      else trailing = setTimeout(run, wait);
    };

    const seen = new Map<string, string>();
    const observe = (clientID: string, rev: string | undefined) => {
      if (rev === undefined || seen.get(clientID) === rev) return;
      seen.set(clientID, rev);
      scheduleRefetch();
    };

    for (const { clientID, presence } of doc.getOthersPresences()) {
      observe(clientID, presence?.titleRev);
    }
    const unsubscribe = doc.subscribe("others", (event) => {
      if (event.type !== "watched" && event.type !== "presence-changed") {
        return;
      }
      observe(event.value.clientID, event.value.presence?.titleRev);
    });
    return () => {
      unsubscribe();
      if (trailing) clearTimeout(trailing);
      docRef.current = undefined;
    };
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
