import { useEffect, useMemo, type PropsWithChildren } from "react";
import { YorkieProvider, useYorkie } from "@yorkie-js/react";
import { isOpenInAnyTab } from "@/lib/durable-session";
import { WafflebaseDocStore } from "@/lib/wafflebase-doc-store";

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
  /** The stable per-document client key, `wb:{userId}:{docKey}`. */
  clientKey: string;
  /** Whose entries these are, for logout's sake. */
  userId: string;
  rpcAddr: string;
  apiKey: string;
  metadata?: Record<string, string>;
  authTokenInjector?: React.ComponentProps<
    typeof YorkieProvider
  >["authTokenInjector"];
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
  const store = useMemo(
    () =>
      new WafflebaseDocStore({
        userId,
        // Without this the store knows only what this instance has touched,
        // while the ordering eviction reads is a shared database — so one
        // tab's eviction deletes another tab's open document and every append
        // after that silently goes nowhere.
        isOpenElsewhere: isOpenInAnyTab,
      }),
    [userId],
  );

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
        {children}
      </LockRefusalWatch>
    </KeyedYorkieProvider>
  );
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
const ERR_DOCUMENT_OPEN_ELSEWHERE = "ErrDocumentOpenElsewhere";

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
