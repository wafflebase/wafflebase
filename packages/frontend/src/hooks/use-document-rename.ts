import { useCallback, useEffect, useRef } from "react";
import { createDocumentSelector } from "@yorkie-js/react";
import { useQueryClient } from "@tanstack/react-query";
import { renameDocument } from "@/api/documents";

/**
 * The two presence fields this module owns. Every editor's presence type stays
 * untouched: both are optional, written only here, and read only here.
 *
 * `titleRev` is the confirmation — "the rename landed, re-read the row".
 * `titleRevPending` is the heads-up written *before* the request goes out —
 * "I am renaming, and I may be detached before I can confirm it". A peer that
 * only ever sees the heads-up re-reads the row once the request has had time
 * to land; see {@link useDocumentRename}.
 */
type TitleSyncPresence = { titleRev?: string; titleRevPending?: string };

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
 *
 * It doubles as the delay a bare `titleRevPending` waits out before reading
 * the row: long enough for the renamer's `PATCH` to have landed (or failed),
 * and already the ceiling on how often peers may make us read it.
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
 * A rename committed on the way out — blurring the title input by clicking a
 * nav link — resolves after this hook, its layout, and the surrounding
 * `DocumentProvider` have unmounted, and the provider detaches on unmount. A
 * presence write on a detached document is a local change nothing will ever
 * sync, so the confirmation that scenario needs can never be sent. Hence the
 * heads-up: `titleRevPending` goes out *before* the request, while the
 * document is still attached, and a peer that never sees the matching
 * confirmation reads the row once `TITLE_REFETCH_COOLDOWN_MS` has passed.
 * It carries no title of its own — Postgres stays the source of truth, so a
 * rename that is refused leaves the peer reading back the title it had.
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

  // Telling peers is best-effort throughout: the rename itself is what the
  // caller is awaiting, and a failed presence write must not surface as a
  // failed rename.
  const writePresence = useCallback(
    (target: NonNullable<typeof doc>, patch: TitleSyncPresence): void => {
      // Presence reaches peers only while the document is attached. Once the
      // `DocumentProvider` unmounts it detaches, and writing then produces a
      // local change on a document nothing will ever sync — the same case
      // `PresenceIdentityRepair` (`components/collab-document-provider.tsx`)
      // checks for before its own presence write. Tests supply doc-like stubs,
      // hence the capability check beside it.
      if (
        typeof target.getStatus !== "function" ||
        typeof target.update !== "function" ||
        target.getStatus() !== "attached"
      ) {
        return;
      }
      try {
        target.update((_, presence) => presence.set(patch));
      } catch (err) {
        console.warn("[title-sync] could not announce rename:", err);
      }
    },
    [],
  );

  // `target` is the document the caller captured when it started its rename —
  // `docRef` is cleared on unmount, and a rename committed on the way out
  // resolves after that. The captured handle is usually detached by then, so
  // this confirmation is simply dropped; the heads-up written before the
  // request is what reaches peers in that case.
  const announce = useCallback(
    (target?: typeof doc) => {
      const current = target ?? docRef.current;
      if (!current) {
        pendingAnnounce.current = true;
        return;
      }
      pendingAnnounce.current = false;
      writePresence(current, { titleRev: nextTitleRev() });
    },
    [writePresence],
  );

  useEffect(() => {
    if (!doc) return;
    docRef.current = doc;
    if (pendingAnnounce.current) announce();

    let lastRefetch = 0;
    let trailing: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      trailing = undefined;
      lastRefetch = Date.now();
      refetchTitle();
    };
    const scheduleRefetch = (minDelay = 0) => {
      const wait = Math.max(
        minDelay,
        lastRefetch + TITLE_REFETCH_COOLDOWN_MS - Date.now(),
      );
      if (wait <= 0) {
        // A confirmed rename supersedes a verification pass still waiting on
        // the same renamer's heads-up, so it reads the row now rather than
        // leaving the new title hidden until that timer fires.
        if (trailing) clearTimeout(trailing);
        run();
        return;
      }
      if (trailing) return;
      trailing = setTimeout(run, wait);
    };

    const seen = new Map<string, string>();
    const changed = (key: string, rev: string | undefined) => {
      if (rev === undefined || seen.get(key) === rev) return false;
      seen.set(key, rev);
      return true;
    };
    const observe = (
      clientID: string,
      presence: TitleSyncPresence | undefined,
    ) => {
      // Both are recorded either way: a heads-up already superseded by its own
      // confirmation must not schedule a second read when the next event
      // re-delivers it.
      const confirmed = changed(`${clientID}:rev`, presence?.titleRev);
      const pending = changed(`${clientID}:pending`, presence?.titleRevPending);
      if (confirmed) scheduleRefetch();
      else if (pending) scheduleRefetch(TITLE_REFETCH_COOLDOWN_MS);
    };

    // The watch stream may have opened before this effect ran, so read what
    // it already delivered; later deliveries come through the subscription.
    for (const { clientID, presence } of doc.getOthersPresences()) {
      observe(clientID, presence);
    }
    // `presence`, not `others`: the online peers' presences arrive as one
    // `initialized` event once the watch stream opens — after attach, and
    // again after every reconnect — and `others` filters that event out.
    const myClientID = doc.getChangeID().getActorID();
    const unsubscribe = doc.subscribe("presence", (event) => {
      if (event.type === "initialized") {
        for (const { clientID, presence } of event.value) {
          if (clientID !== myClientID) observe(clientID, presence);
        }
      } else if (
        (event.type === "watched" || event.type === "presence-changed") &&
        event.value.clientID !== myClientID
      ) {
        observe(event.value.clientID, event.value.presence);
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
      // announcement on a cleared ref. Still `undefined` for a rename made
      // before attach — `announce` falls back to the ref, which is how that
      // one is flushed once the document arrives.
      const target = docRef.current;
      // The heads-up, sent while the document is certainly still attached.
      // The commit-then-navigate gesture detaches this client long before the
      // request resolves, and presence written after that reaches nobody —
      // without this, the peers of the one rename this feature exists for
      // would never be told. A spurious one (the request is refused) costs
      // each peer a single read of a row that did not change.
      if (target) writePresence(target, { titleRevPending: nextTitleRev() });
      await renameDocument(documentId, newTitle);
      refetchTitle();
      // The confirmation: peers that see it read the row at once instead of
      // waiting out the window above. Dropped when the document has already
      // detached, which is what the heads-up covers.
      announce(target);
    },
    [documentId, refetchTitle, announce, writePresence],
  );
}
