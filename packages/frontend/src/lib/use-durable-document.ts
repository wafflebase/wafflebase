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
  const eligible = enabled && !!userId && !isExcluded(docKey);

  /**
   * What the decision below was made *for*.
   *
   * The state is always a render behind the props, so reporting `durable` from
   * the state alone answers the new document's question with the old
   * document's election — a fully-settled `clientKey` for a document nobody
   * elected this tab to hold. A consumer mounts a client on exactly that
   * signal, so the transient wrong answer is enough: two tabs, one stable key,
   * one shared actor, and each tab's changes filtered out of the other.
   *
   * Pairing the answer with its subject makes a mismatch unreportable rather
   * than merely unlikely.
   */
  const subject = `${eligible}\u0000${userId ?? ""}\u0000${docKey}`;
  const [decision, setDecision] = useState<{
    subject: string;
    session?: DurableSession;
  }>();

  useEffect(() => {
    if (!eligible || !userId) {
      // Nothing to hold. Not taking the lock is load-bearing rather than an
      // optimization: holding the name without using it would deny durability
      // to a second tab that could have had it.
      setDecision({ subject });
      return;
    }

    let cancelled = false;
    // The grant, not the handle: a cleanup that runs before the handle exists
    // — which React's double-invoked effects do — must still be able to
    // release what was granted a moment later.
    const pending = acquireDurableSession(userId, docKey);

    void pending.then((handle) => {
      if (cancelled) {
        // The view moved on while the election was in flight. Release, or the
        // name is held for a document this tab is no longer showing.
        handle?.release();
        return;
      }
      setDecision({ subject, session: handle });
    });

    return () => {
      cancelled = true;
      void pending.then((handle) => handle?.release());
    };
  }, [eligible, userId, docKey, subject]);

  // Both of these are false until the decision is about *this* subject, which
  // is what keeps `settled` honest across a navigation as well.
  const answered = decision?.subject === subject;
  const durable = answered && !!decision?.session;
  return {
    durable,
    clientKey: durable && userId ? durableClientKey(userId, docKey) : undefined,
    settled: answered,
  };
}
