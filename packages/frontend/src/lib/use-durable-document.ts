import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  acquireDurableSession,
  durableClientKey,
  type DurableSession,
} from "./durable-session";
import { useOfflinePersistenceEnabled } from "./offline-persistence-preference";
import { supportsClientKey } from "./yorkie-capabilities";

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

/**
 * Whether persisting is permitted at all in this part of the tree.
 *
 * Share links are excluded, and the exclusion has to be positional rather than
 * key-derived: a share-link view of `sheet-7` has the same document key as its
 * owner's, and only the route knows the difference. The design called this
 * "structural" on the belief that share routes mount their own provider
 * *instead of* `CollabDocumentProvider` — they do not, they mount one *above*
 * it, so a signed-in visitor on somebody's share link would otherwise get the
 * durable branch: their own `wb:…:{userId}:{docKey}` client, re-authenticated
 * with their personal Yorkie token rather than the share token whose role and
 * expiry the auth webhook validates, writing the shared document's content to
 * their disk where it outlives the link's revocation.
 *
 * Defaults to permitted, so every owned editor is unchanged and only the
 * routes that opt out have to say so.
 */
const DurabilityPermitted = createContext(true);

/**
 * Marks a subtree as never durable — one wrapper per route, above whatever it
 * mounts, rather than a prop each of a route's five document types must
 * remember to pass.
 */
export function NonDurableScope({ children }: { children: ReactNode }) {
  return createElement(DurabilityPermitted.Provider, { value: false }, children);
}

/**
 * Whether persisting is permitted here at all.
 *
 * Exported for the one caller that has to know *before* it decides whether to
 * wait for anything: a share-link visitor must never be held on a blank frame
 * for an identity that could not make their document durable anyway.
 */
export function useDurabilityPermitted(): boolean {
  return useContext(DurabilityPermitted);
}

export interface DurableDocument {
  /** Whether this tab persists this document locally. */
  durable: boolean;
  /**
   * Gives up the election and stays non-durable for this document.
   *
   * For the race the app lock cannot settle on its own: the app elects a tab
   * and *then* the SDK's own lock refuses the attach anyway
   * (`ErrDocumentOpenElsewhere`). Without a way out, that tab sits in an
   * attach failure while holding the name — so it is not durable and nobody
   * else can be either, which is strictly worse than losing the election.
   */
  standDown(): void;
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
  const enabled = useOfflinePersistenceEnabled(userId);
  const permitted = useContext(DurabilityPermitted);
  // `supportsClientKey` is first because it is the one term that cannot change
  // at runtime: on a build whose provider cannot carry a client key, the store
  // would fill with entries no reload can use while the chip promised a
  // durability that does not survive one.
  const eligibleNow =
    supportsClientKey() &&
    permitted &&
    enabled &&
    !!userId &&
    !isExcluded(docKey);

  /**
   * Eligibility, decided once per open document and then held — in **both**
   * directions.
   *
   * `enabled` is a preference another tab can flip while this one sits on an
   * open editor, and the consumer's own decision is deliberately latched for
   * the life of the open document — unmounting the `DocumentProvider` under a
   * document with unsent edits is the loss this whole feature exists to
   * prevent.
   *
   * Letting it *fall* released the Web Lock *underneath* a still-mounted
   * durable client: the tab kept writing through a stable client key with the
   * election gone, so a second tab could win the same name, take the same key,
   * and share one actor — the silent edit loss the election is the guard
   * against.
   *
   * Letting it *rise* is the mirror of that, and no safer. The consumer has
   * already latched non-durable for this open document, so the election a rise
   * acquires is one nothing ever uses: the name is held — denying durability to
   * every other tab — for a client that is never mounted. And the rise moves
   * `subject`, which un-settles the hook; a consumer that renders nothing until
   * `settled` then tears the whole editor down and rebuilds it, discarding
   * exactly the change queue at risk.
   *
   * So the preference governs the documents opened *after* it, here as well as
   * at the call site, and the erase that accompanies switching it off is what
   * takes the stored content away.
   *
   * Keyed on the identity as well as the document, because another tab can sign
   * this one out and somebody else in, and the new person must inherit none of
   * the previous one's election.
   */
  const identity = `${userId ?? ""}\u0000${docKey}`;
  const latched = useRef<{ identity: string; eligible: boolean } | null>(null);
  if (latched.current?.identity !== identity) {
    latched.current = { identity, eligible: eligibleNow };
  }
  const eligible = latched.current.eligible;

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

  // Two different questions, and conflating them put back the very bug the
  // subject pairing exists to prevent.
  //
  // *Answered* is only ever about this subject. An ineligible document has
  // nothing to wait for, so the caller may render immediately — but the
  // decision in state can still be the previous subject's, and reading
  // `durable` from it would report the old election under the new document's
  // key. That is how a `pdf-` document, the one exclusion the design calls
  // structural, was handed a durable client with the store attached.
  const answered = decision?.subject === subject;
  const durable = answered && !!decision?.session;

  const standDown = useCallback(() => {
    setDecision((current) => {
      if (!current?.session) {
        return current;
      }
      current.session.release();
      // Settled, and settled as *not* durable: the caller asked to stop, so
      // leaving it unsettled would have them mount nothing at all.
      return { subject: current.subject };
    });
  }, []);

  return {
    durable,
    clientKey: durable && userId ? durableClientKey(userId, docKey) : undefined,
    // Settled without waiting when there was nothing to wait for: making every
    // editor wait on an effect would put a blank frame in front of a feature
    // that is switched off, which is every document today. It says only that
    // the caller may proceed — never that this tab holds anything.
    settled: !eligible || answered,
    standDown,
  };
}
