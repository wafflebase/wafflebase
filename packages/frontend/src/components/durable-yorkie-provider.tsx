import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { YorkieProvider, useDocument, useYorkie } from '@yorkie-js/react';
import { isOpenInAnyTab } from '@/lib/durable-session';
import { getOfflinePersistenceEnabled } from '@/lib/offline-persistence-preference';
import { isOfflineWritePermitted } from '@/lib/offline-erase';
import {
  DurabilityLapseScope,
  DurableDocumentScope,
  useDurableDocumentContext,
  type DurabilityLapse,
} from '@/lib/durable-document-context';
import { WafflebaseDocStore } from '@/lib/wafflebase-doc-store';

/**
 * The Yorkie client a durable document runs on.
 *
 * Design: `docs/design/offline-local-persistence.md` § Client identity.
 *
 * On the persisting path the client moves from one per session to **one per
 * document**, because the store is keyed `apiKey/clientKey/docKey` and the key
 * has to be both stable across reloads and distinct per document: stable so a
 * reload finds its own entry, per-document so one tab's detach cannot disturb
 * another tab holding a different one.
 *
 * Everything that decides *whether* to mount this lives in
 * `useDurableDocument`; by the time this renders, the election is already won.
 */

/**
 * `YorkieProvider` with the client key it can actually be given.
 *
 * `YorkieProviderProps` is `ClientOptions`, whose key is spelled `key` — which
 * React reserves and strips before props are formed. The provider therefore
 * grew a `clientKey` alias (yorkie-js-sdk#1357); this cast is what lets the
 * call site name it while the repo is still pinned to a version whose types
 * predate it. `supportsClientKey()` is what keeps that honest: nothing mounts
 * this component until the pin is new enough to honour the prop.
 */
type DurableProviderProps = React.ComponentProps<typeof YorkieProvider> & {
  clientKey?: string;
  store?: WafflebaseDocStore;
};
const KeyedYorkieProvider = YorkieProvider as React.FC<
  PropsWithChildren<DurableProviderProps>
>;

export interface DurableYorkieProviderProps {
  /** The stable per-document client key, `wb:{deviceSecret}:{userId}:{docKey}`. */
  clientKey: string;
  /** Whose entries these are, for logout's sake. */
  userId: string;
  rpcAddr: string;
  apiKey: string;
  metadata?: Record<string, string>;
  authTokenInjector?: React.ComponentProps<
    typeof YorkieProvider
  >['authTokenInjector'];
  /**
   * Called when the SDK refuses the attach because *its* single-active-session
   * lock is held elsewhere — the race the app election is meant to win first.
   * The caller gives up the election so another tab can take it.
   */
  onLockRefused?: () => void;
}

/**
 * Mounts a client that persists, and hands its store back to the caller.
 *
 * The store is created once per client key. Re-creating it on every render
 * would hand the SDK a new object mid-session, and re-creating it per document
 * would give each one its own `touched` set — which is how eviction ends up
 * deleting a document another view is actively persisting.
 */
export function DurableYorkieProvider({
  clientKey,
  userId,
  rpcAddr,
  apiKey,
  metadata,
  authTokenInjector,
  onLockRefused,
  children,
}: PropsWithChildren<DurableYorkieProviderProps>) {
  // Latched, not toggled back. Once the SDK has reported that it dropped local
  // work, the entry the chip would be promising has been removed — and it is
  // the chip's promise, not the client's existence, that this boolean stands
  // for. Over-reporting durability is the one direction this feature must not
  // fail in.
  const [lost, setLost] = useState(false);
  const reportLoss = useCallback(() => setLost(true), []);

  /**
   * The second of the design's three conjuncts.
   *
   * The SDK stops persisting a document whose snapshot is too large or too slow
   * to write and says so with a `PersistDisabled` event; editing carries on
   * regardless. Nothing else observes that — the store simply stops being
   * called — so without this the chip would keep reading `Saved to this device`
   * for a document the SDK has quietly stopped saving, which is the one lie
   * this feature must not tell. Latched, like the other two: what was not
   * written is not on disk, and a later success does not put it there.
   */
  const [persistDisabled, setPersistDisabled] = useState(false);
  const reportPersistDisabled = useCallback(
    () => setPersistDisabled(true),
    [],
  );

  /**
   * The store's own half of the same promise.
   *
   * `durable` is the conjunction of three facts, and the SDK's events are only
   * two of them: a store whose writes are *failing* — IndexedDB refused
   * in private browsing, an origin still full after eviction freed what it
   * could — reports nothing at all, because the SDK swallows store errors. The
   * chip would then read `saved-locally` for work that is on no disk anywhere,
   * which is the one lie this feature cannot tell.
   *
   * Latched for the same reason the loss is: a write that failed is work not on
   * disk, and a later write succeeding does not put it there.
   *
   * (The third fact — that this tab won the app lock — is structural: this
   * component is mounted only by a decision the election answered, and
   * `useDurableDocument` holds that election for the life of the open document
   * rather than releasing it under a still-mounted client.)
   */
  /**
   * The promise withdrawn because it cannot be checked.
   *
   * `durable` is only worth anything if a lapse can be *reported*, and the two
   * events above are the only channel for that. An SDK that refuses the
   * subscription — it throws on an event name it does not know — leaves this
   * client unable to ever tell the user the guarantee failed, which the design
   * names as worse than not making it: "durable-but-unreportable is worse than
   * uniformly non-durable". So it is not made.
   */
  const [unreportable, setUnreportable] = useState(false);
  const reportUnreportable = useCallback(() => setUnreportable(true), []);

  const [writesFailing, setWritesFailing] = useState(false);
  const [outOfSpace, setOutOfSpace] = useState(false);
  const store = useMemo(
    () =>
      new WafflebaseDocStore({
        userId,
        // Without this the store knows only what this instance has touched,
        // while the ordering eviction reads is a shared database — so one
        // tab's eviction deletes another tab's open document and every append
        // after that silently goes nowhere.
        //
        // Scoped to this account, and left at its "assume open when it cannot
        // tell" default: this is the eviction caller, where refusing to delete
        // costs a failed write the store already handles.
        isOpenElsewhere: (docKey) => isOpenInAnyTab(docKey, { userId }),
        onWriteFailure: (err) => {
          // Quota is the one failure the design gives its own wording, because
          // it is the one the user can act on.
          if (
            err instanceof DOMException &&
            err.name === 'QuotaExceededError'
          ) {
            setOutOfSpace(true);
          }
          setWritesFailing(true);
        },
        // Two separate facts, and neither one implies the other.
        //
        // The *preference*: switching it off erases the disk but deliberately
        // leaves this client mounted — re-deciding durability would unmount
        // the editor and take the queue at risk with it. Without this the next
        // write puts the open document straight back on the disk the user just
        // asked to clear, and nothing runs again to remove it.
        //
        // The *sign-out*: the erase logout performs marks the keys it deleted,
        // so this client's next append throws — and the SDK repairs a failed
        // append by writing a fresh snapshot, which restores the whole document
        // to the disk the sign-out was supposed to clear. The preference is
        // still on at that moment, so it cannot be the guard.
        isPersistenceEnabled: () =>
          getOfflinePersistenceEnabled() && isOfflineWritePermitted(userId),
      }),
    [userId],
  );

  const value = useMemo(
    () => ({
      store,
      durable: !lost && !writesFailing && !persistDisabled && !unreportable,
      reportLoss,
      reportPersistDisabled,
      reportUnreportable,
    }),
    [
      store,
      lost,
      writesFailing,
      persistDisabled,
      unreportable,
      reportLoss,
      reportPersistDisabled,
      reportUnreportable,
    ],
  );

  // What the chip's tooltip says when the promise lapsed under a client that
  // *was* mounted. Nested inside the call site's own scope, so this wins where
  // it has an answer and falls back to `undefined` — no lapse — where it does
  // not.
  const lapse: DurabilityLapse | undefined = lost
    ? 'dropped'
    : persistDisabled
      ? 'too-large'
      : outOfSpace
        ? 'out-of-space'
        : writesFailing
          ? 'write-failed'
          : unreportable
            ? 'unreportable'
            : undefined;

  return (
    <KeyedYorkieProvider
      rpcAddr={rpcAddr}
      apiKey={apiKey}
      metadata={metadata}
      authTokenInjector={authTokenInjector}
      clientKey={clientKey}
      store={store}
    >
      <LockRefusalWatch onLockRefused={onLockRefused}>
        <DurableDocumentScope value={value}>
          <DurabilityLapseScope lapse={lapse}>{children}</DurabilityLapseScope>
        </DurableDocumentScope>
      </LockRefusalWatch>
    </KeyedYorkieProvider>
  );
}

/**
 * Tells the store which removals are losing work.
 *
 * The SDK removes a document's entry on an ordinary detach as well as on the
 * three paths where it gave up on reconciling local work, and `remove` cannot
 * tell them apart from its arguments. `LocalChangesDropped` is the difference,
 * and it is emitted synchronously *before* the removal on every one of those
 * paths — so latching from here is always in time.
 *
 * Without it, closing a document would archive a full copy of it, every time,
 * forever: an unbounded pile on the user's disk, and an archive that means
 * "everything you have ever closed" instead of "work that could not be saved".
 *
 * **Mounted by `CollabDocumentProvider` inside the `DocumentProvider`**, not
 * here. This reads `useDocument()`, and the durable provider's children *are*
 * the `DocumentProvider` — so wrapping them from out here put the hook above
 * the context it needs, where it can only ever answer with no document and the
 * latch can never be set. The store comes through context instead, which is
 * what lets the component sit where its hook works; outside a durable client
 * there is no context and this is a no-op, which is why the call site can
 * render it unconditionally.
 */
export function DurableLossWatch() {
  const durable = useDurableDocumentContext();
  const { doc } = useDocument();

  useEffect(() => {
    if (!durable || !doc) return;
    // `useDocument()` also yields doc-like stubs — several suites supply only
    // the members they need — and this is mounted in the provider of every
    // collaborative document, so it must not be able to break one.
    if (typeof doc.subscribe !== 'function' || typeof doc.getKey !== 'function')
      return;
    // Both subscriptions are guarded, because `subscribe` does not merely
    // ignore an event name it does not know — it *throws*
    // (`YorkieError(ErrInvalidArgument, 'Unsupported event type')`), and these
    // two names are newer than versions this app can be pinned to. A throw out
    // of a passive effect propagates through render and takes the whole editor
    // subtree with it, which is the same failure the doc-like-stub guard above
    // exists to avoid.
    //
    // Caught is not the same as shrugged off, though, and the earlier claim
    // that a failed subscription "costs the chip its certainty, never the
    // document" was wrong twice over. It costs the chip nothing unless
    // something lowers `durable`, and it costs the *document*: this handler is
    // the only caller of `expectLoss`, and `WafflebaseDocStore.remove()`
    // archives a removal only when that latch is set — so a swallowed failure
    // silently turns the loss path from "archive the work" into "delete it".
    // Each failure is therefore answered below rather than only logged.
    const unsubscribers: Array<() => void> = [];
    const watch = (subscribe: () => (() => void) | undefined): boolean => {
      try {
        const unsubscribe = subscribe();
        if (typeof unsubscribe === 'function') {
          unsubscribers.push(unsubscribe);
        }
        return true;
      } catch (err) {
        console.warn('[offline] could not watch a durability event:', err);
        return false;
      }
    };

    const watchingLoss = watch(() =>
      doc.subscribe('local-changes-dropped', () => {
        durable.store.expectLoss(doc.getKey());
        durable.reportLoss();
      }),
    );
    if (!watchingLoss) {
      // Two consequences, and both are needed.
      //
      // The latch, so a removal on this document archives instead of deleting.
      // Without the event there is no way to tell an ordinary detach from a
      // drop, and the two directions are not symmetric: over-archiving costs
      // disk that the thirty-day sweep reclaims, under-archiving costs work
      // that nothing can give back. It is set here rather than guessed at
      // inside `remove()` so the conservative reading stays confined to the one
      // document whose SDK could not be asked.
      try {
        durable.store.expectLoss?.(doc.getKey());
      } catch (err) {
        console.warn('[offline] could not latch an unobservable loss:', err);
      }
      // And the withdrawal, because a guarantee nothing can report a lapse of
      // is one the user cannot check — the design's rule is to under-promise.
      durable.reportUnreportable();
    }
    // The other event this component exists to catch, and the one the design
    // names as `durable`'s second conjunct: the SDK gives up on a document
    // whose snapshot is too large or too slow to write, and carries on letting
    // the user edit it. Nothing is archived — nothing was lost, it simply
    // stopped being saved — so this latches durability off without telling the
    // store to expect a loss.
    const watchingPersist = watch(() =>
      doc.subscribe('persist-disabled', () => {
        durable.reportPersistDisabled();
      }),
    );
    if (!watchingPersist) {
      // Nothing to latch — this event never means work was lost — but the same
      // rule applies: a conjunct that can never be lowered is not one the chip
      // may keep asserting.
      durable.reportUnreportable();
    }
    return () => {
      for (const unsubscribe of unsubscribers) {
        try {
          unsubscribe();
        } catch (err) {
          // Same reasoning, on the way out: an unsubscribe that throws during
          // teardown would propagate out of the effect cleanup.
          console.warn('[offline] could not stop watching a document:', err);
        }
      }
    };
  }, [doc, durable]);

  return null;
}

/**
 * The SDK's code for "another session already holds this document".
 *
 * Compared as a string because the published types export neither the `Code`
 * enum nor `isErrorCode`, though the runtime carries both — so this is the one
 * way to read it without reaching into internals. `YorkieError` puts the code
 * on the error itself, which is what makes matching on it better than matching
 * on message text.
 */
const ERR_DOCUMENT_OPEN_ELSEWHERE = 'ErrDocumentOpenElsewhere';

/**
 * Notices an attach the SDK refused for its own lock.
 *
 * Anything else is left alone: a failed attach for another reason is not a
 * reason to give up an election that is doing its job.
 */
function LockRefusalWatch({
  onLockRefused,
  children,
}: PropsWithChildren<{ onLockRefused?: () => void }>) {
  const { error } = useYorkie();

  useEffect(() => {
    if (!error || !onLockRefused) return;
    const code = (error as { code?: string }).code;
    if (code !== ERR_DOCUMENT_OPEN_ELSEWHERE) return;
    onLockRefused();
  }, [error, onLockRefused]);

  return <>{children}</>;
}
