import { useEffect, useState } from "react";
import {
  acquireDurableSession,
  durableClientKey,
  type DurableSession,
} from "./durable-session";
import { useOfflinePersistenceEnabled } from "./offline-persistence-preference";

/**
 * Decides whether one open document is persisted locally, and holds the
 * election that makes it safe.
 *
 * Design: `docs/design/offline-local-persistence.md` § Client identity, §
 * Multi-tab.
 *
 * Every arm here is a refusal, and each exists because the durable path is
 * *worse* than the non-durable one when its precondition is missing — not
 * merely unavailable. Refusing costs this tab local durability; proceeding
 * anyway costs edits.
 */

/**
 * Documents excluded by their key.
 *
 * PDF comment documents ride the same provider seam but have no sync chip.
 * Durable without a way to report it breaks the invariant the chip depends on —
 * whatever is durable must be reportable — so they are excluded structurally
 * rather than by a prop threaded through every call site.
 */
function isExcluded(docKey: string): boolean {
  return docKey.startsWith("pdf-");
}

export interface DurableDocument {
  /** Whether this tab persists this document locally. */
  durable: boolean;
  /**
   * The Yorkie client key to mount with, or `undefined` to keep today's
   * behavior — a key minted randomly per session, which resumes nothing and is
   * exactly what makes two tabs safe.
   */
  clientKey?: string;
  /**
   * Whether the decision has been made. The election is asynchronous, so a
   * caller that mounted a client on the first render would mount the
   * non-durable one and then have to tear it down.
   */
  settled: boolean;
}

/**
 * `useDurableDocument` answers whether this tab should persist `docKey`, and
 * holds the app-owned election for as long as it should.
 */
export function useDurableDocument({
  docKey,
  userId,
}: {
  docKey: string;
  userId?: string;
}): DurableDocument {
  const enabled = useOfflinePersistenceEnabled();
  const [session, setSession] = useState<DurableSession | undefined>();
  const [settled, setSettled] = useState(false);

  const eligible = enabled && !!userId && !isExcluded(docKey);

  useEffect(() => {
    if (!eligible || !userId) {
      // Nothing to hold. Not taking the lock is load-bearing rather than an
      // optimization: holding the name without using it would deny durability
      // to a second tab that could have had it.
      setSession(undefined);
      setSettled(true);
      return;
    }

    let cancelled = false;
    let acquired: DurableSession | undefined;

    setSettled(false);
    acquireDurableSession(userId, docKey).then((handle) => {
      acquired = handle;
      if (cancelled) {
        // The view moved on while the election was in flight. Release, or the
        // name is held by a tab that is no longer showing the document.
        handle?.release();
        return;
      }
      setSession(handle);
      setSettled(true);
    });

    return () => {
      cancelled = true;
      acquired?.release();
      setSession(undefined);
    };
  }, [eligible, userId, docKey]);

  const durable = eligible && !!session;
  return {
    durable,
    clientKey: durable && userId ? durableClientKey(userId, docKey) : undefined,
    settled,
  };
}
