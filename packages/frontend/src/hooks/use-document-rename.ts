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
 * "Not recorded" deliberately includes the presences delivered by
 * `initialized` and `watched`: a rename announced while this client was
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

  // `target` is the document the caller captured when it started its rename.
  // A rename committed on the way out (blurring the title input by clicking a
  // nav link) resolves after this hook has unmounted, and by then `docRef` has
  // been cleared and `pendingAnnounce` belongs to a dead instance that will
  // never flush it — which is exactly the stale peer title this feature
  // exists to fix. Announcing on the captured handle instead keeps that write
  // on the document the rename was made against.
  const announce = useCallback((target?: typeof doc) => {
    const current = target ?? docRef.current;
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

    // The watch stream may have opened before this effect ran, so read what
    // it already delivered; later deliveries come through the subscription.
    for (const { clientID, presence } of doc.getOthersPresences()) {
      observe(clientID, presence?.titleRev);
    }
    // `presence`, not `others`: the online peers' presences arrive as one
    // `initialized` event once the watch stream opens — after attach, and
    // again after every reconnect — and `others` filters that event out.
    const myClientID = doc.getChangeID().getActorID();
    const unsubscribe = doc.subscribe("presence", (event) => {
      if (event.type === "initialized") {
        for (const { clientID, presence } of event.value) {
          if (clientID !== myClientID) observe(clientID, presence?.titleRev);
        }
      } else if (
        (event.type === "watched" || event.type === "presence-changed") &&
        event.value.clientID !== myClientID
      ) {
        observe(event.value.clientID, event.value.presence?.titleRev);
      }
    });
    return () => {
      unsubscribe();
      if (trailing) clearTimeout(trailing);
      docRef.current = undefined;
    };
  }, [doc, announce, refetchTitle]);

  return useCallback(
    async (newTitle: string) => {
      // Captured before the await, so an unmount in between cannot strand the
      // announcement. Still `undefined` for a rename made before attach —
      // `announce` falls back to the ref, which is how that one is flushed
      // once the document arrives.
      const target = docRef.current;
      await renameDocument(documentId, newTitle);
      refetchTitle();
      announce(target);
    },
    [documentId, refetchTitle, announce],
  );
}
