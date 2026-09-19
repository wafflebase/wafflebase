import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DocumentProvider, useDocument } from '@yorkie-js/react';
import type { Indexable } from '@yorkie-js/sdk';
import type { User } from '@/types/users';
import { fetchMeOptional, fetchYorkieToken } from '@/api/auth';
import {
  useDurabilityPermitted,
  useDurableDocument,
} from '@/lib/use-durable-document';
import { useOfflinePersistenceEnabled } from '@/lib/offline-persistence-preference';
import { supportsClientKey } from '@/lib/yorkie-capabilities';
import {
  DurableLossWatch,
  DurableYorkieProvider,
} from '@/components/durable-yorkie-provider';
import {
  DurabilityLapseScope,
  type DurabilityLapse,
} from '@/lib/durable-document-context';

/**
 * `DocumentProvider` with `initialPresence` made reliable.
 *
 * ## The defect this exists for
 *
 * `client.attach(doc, { initialPresence })` does not keep its promise when the
 * SAME client re-attaches a document key it has already attached in this
 * session. Measured against a live server, identically on `@yorkie-js/sdk`
 * 0.7.19 and 0.7.20:
 *
 * ```
 * same client, re-attach immediately   1st=[4 keys]  2nd=[EMPTY]
 * same client, re-attach after 1.5s    1st=[4 keys]  2nd=[EMPTY]
 * DIFFERENT client (= page reload)     1st=[4 keys]  2nd=[username,email,...]  OK
 * ```
 *
 * The SDK applies the presence locally *before* the attach RPC
 * (`doc.update((_, p) => p.set(opts.initialPresence || {}))`) and the response
 * reconciliation then leaves that actor's entry as `{}` — the actor id is
 * reused across attach/detach, so unlike the first attach there is an existing
 * entry to clobber. No error is raised: the client stays active, the document
 * reports `attached`, and `getMyPresence()` is silently empty.
 *
 * Nothing about that is specific to fast navigation. A plain
 * `attach -> detach -> attach` is enough, which is why simply opening a
 * document, going back to the list and opening it again was enough to strand
 * the header on a single "Anonymous" avatar until a reload (a reload works
 * only because it mints a new client). See issue #1004.
 *
 * ## What this does
 *
 * After the document is attached, it re-asserts the keys of `initialPresence`
 * that are **missing** from the live presence — nothing else. That restores
 * exactly the contract attach was supposed to honour:
 *
 *   after `attach(doc, { initialPresence })`, `getMyPresence()` contains it.
 *
 * Restricting the write to absent keys is what makes this safe to run after
 * the editors have started broadcasting. `SlidesView`'s `broadcast()` and
 * `BoardView`'s selection listener both document the assumption that identity
 * fields "are seeded once by `initialPresence` and stay intact" while they
 * write only their own fields — this keeps that assumption true instead of
 * letting a repair overwrite the selection they just published. When no key is
 * missing, no CRDT write happens at all.
 *
 * Remove this once the SDK applies `initialPresence` after reconciling the
 * attach response; the wrapper can then collapse back to `DocumentProvider`
 * with no other call-site change.
 */
function PresenceIdentityRepair<P extends Indexable>({
  initialPresence,
}: {
  initialPresence?: P;
}) {
  const { doc } = useDocument<unknown, P>();

  useEffect(() => {
    if (!doc || !initialPresence) return;
    // This is an opportunistic repair of a cosmetic field, mounted in the
    // provider of every collaborative document — so it must not be capable of
    // breaking one. `useDocument()` also yields doc-like stubs (several tests
    // supply only the members they need), and a throw from a passive effect
    // unmounts the tree: a missing avatar is a blemish, a blank editor is an
    // outage. Hence the capability check and the swallow.
    if (
      typeof doc.getStatus !== 'function' ||
      typeof doc.getMyPresence !== 'function' ||
      typeof doc.update !== 'function'
    ) {
      return;
    }

    try {
      // A document that is not attached has no presence of its own to repair,
      // and `getMyPresence()` answers `{}` for it regardless — writing then
      // would fabricate an entry rather than restore one.
      if (doc.getStatus() !== 'attached') return;

      const current = doc.getMyPresence() ?? {};
      const missing = Object.keys(initialPresence).filter(
        (key) =>
          !(key in current) &&
          // An `undefined` value is not stored by the SDK, so such a key is
          // absent even after a perfectly healthy attach — `DocsDetail` passes
          // `activeCursorPos: undefined`. Without this the repair would write
          // it back on every single mount, which is both pointless traffic and
          // a contradiction of the no-op-when-healthy property above.
          (initialPresence as Record<string, unknown>)[key] !== undefined,
      );
      if (missing.length === 0) return;

      const patch: Record<string, unknown> = {};
      for (const key of missing) {
        patch[key] = (initialPresence as Record<string, unknown>)[key];
      }
      doc.update((_root, presence) => presence.set(patch as Partial<P>));
    } catch (err) {
      console.warn('[presence] could not restore initialPresence:', err);
    }
    // `initialPresence` is a fresh object literal at every call site, so it is
    // deliberately not a dependency — it would re-run this on every render of
    // the parent. The document identity is what decides whether a repair is
    // owed, and the body is a no-op once the keys are present.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  return null;
}

/**
 * Use this in place of `@yorkie-js/react`'s `DocumentProvider` for any
 * document that carries user identity in its presence. It renders the real
 * provider and mounts {@link PresenceIdentityRepair} inside it, so the repair
 * cannot be forgotten when a new document type is added.
 *
 * ## Offline persistence
 *
 * This is also where a document becomes durable, because it is already the one
 * seam every editor passes through — all five detail routes and
 * `files/pdf-collab.tsx` render it. When the opt-in applies and this tab won
 * the election, it nests its own `YorkieProvider`: a client keyed
 * `wb:{deviceSecret}:{userId}:{docKey}`, with the IndexedDB store attached.
 *
 * Otherwise it renders exactly what it always did, on the ambient
 * session-wide client. That is what keeps the opt-in free for everyone who
 * declines it — no second `ActivateClient`, no new identity, no behavior to
 * regress. Design: `docs/design/offline-local-persistence.md`.
 *
 * The PDF exclusion is derived from the `docKey` prefix this component already
 * receives. Share links need one line at their route instead: they mount their
 * own `YorkieProvider` *above* this component rather than instead of it, so
 * they are not excluded by the nesting the way the design first claimed —
 * `shared-document.tsx` wraps itself in `NonDurableScope`, and the reasoning
 * is recorded there.
 *
 * One cost worth naming: deciding this needs to know who is signed in, so this
 * component now requires a `QueryClientProvider` above it. The app mounts one
 * at its root, but a test that renders an editor in isolation has to supply
 * one — three existing suites needed it when this landed.
 *
 * It asks with `fetchMeOptional`, never `fetchMe`. This renders on the public
 * `/shared/:token` route, where there is usually nobody signed in, and
 * `fetchMe` goes through `fetchWithAuth` — whose 401 arm logs the session out
 * and hard-redirects to `/login`. Asking the mandatory question here would
 * therefore bounce every anonymous share-link visitor off the document they
 * were sent. `["me", "optional"]` is the key the share route already reads
 * under, so on that route this costs no extra request.
 *
 * On a *private* route it is a different query from the `["me"]` one
 * `PrivateRoute` has already resolved, so it starts out pending — and a
 * pending identity reads as "not eligible", which is a wrong answer, not a
 * missing one: the document would attach on the ambient client and then be
 * torn down and re-attached on the durable one. So the resolved `["me"]` entry
 * seeds this query's initial data, and where nothing seeds it the render is
 * held until the question is answered — but only when persisting is possible
 * at all, so an anonymous visitor waits for nothing.
 */
export function CollabDocumentProvider<R, P extends Indexable = Indexable>({
  initialPresence,
  children,
  ...rest
}: Parameters<typeof DocumentProvider<R, P>>[0]) {
  const queryClient = useQueryClient();
  const { data: me, isPending: identityPending } = useQuery({
    queryKey: ['me', 'optional'],
    queryFn: fetchMeOptional,
    retry: false,
    // The same user, under the key the authenticated shell resolved it as.
    // Absent on a public route, where this simply falls back to asking.
    initialData: () => queryClient.getQueryData<User>(['me']),
  });
  /**
   * The last identity this query actually resolved to somebody.
   *
   * `fetchMeOptional` answers `null` for a session the server no longer
   * accepts, and React Query refetches on window focus — so a cookie that
   * expires while an editor sits open turns `me` from a user into `null` under
   * a mounted durable client. Read live, that is a teardown: the subject moves
   * to `anon:`, the decision below is discarded, and the `DurableYorkieProvider`
   * is swapped for the ambient branch at the same position — which unmounts the
   * `DocumentProvider` and the whole editor under it, discarding the in-memory
   * Yorkie change queue. An expired session is *precisely* when that queue holds
   * work the server has not taken, so the feature would cause the loss it exists
   * to prevent, on an event the user neither chose nor can see.
   *
   * So a resolved identity is remembered and a `null` changes nothing. Somebody
   * *else* signing in is a different fact and still re-decides: that arrives as
   * a new user object, not as an absence.
   */
  const lastKnown = useRef<User | undefined>(undefined);
  if (me) {
    lastKnown.current = me;
  }
  const person = me ?? lastKnown.current;
  const docKey = (rest as { docKey: string }).docKey;
  const offlineEnabled = useOfflinePersistenceEnabled();
  const permitted = useDurabilityPermitted();
  // Every term here is synchronous, so the answer is known on the first render.
  // It exists only to decide whether the identity is worth waiting for: with
  // the opt-in declined — which is every document today — nothing about this
  // component's timing changes.
  const mayPersist = supportsClientKey() && offlineEnabled && permitted;
  const identified = !mayPersist || !identityPending;

  const { durable, clientKey, settled, standDown } = useDurableDocument({
    docKey,
    userId: person?.id === undefined ? undefined : String(person.id),
  });

  /**
   * The election, answered once per document and then held.
   *
   * The two branches below are different element types at the same position,
   * so switching between them unmounts the `DocumentProvider` and the entire
   * editor subtree under it — discarding the Yorkie change queue, which on a
   * document with unsent edits is the loss this whole feature exists to
   * prevent. `durable` is derived from the preference, which a person can flip
   * in another tab while an editor sits here with work in it.
   *
   * So the decision is made when the document mounts and applies until it is
   * closed; flipping the preference takes effect on the documents opened
   * after it. The one thing that may still demote is `standDown`, and it is
   * the opposite case: the SDK refused the attach, so there is nothing
   * attached to lose and re-mounting on the ambient client is the repair.
   *
   * Held per *open*, and an open is a document **and** the person who has it:
   * another tab can sign this one out and somebody else in, and React Query
   * refetches the identity on focus without unmounting this route. Keyed on
   * the document alone, the decision would keep the previous person's client
   * key — writing the new person's edits under the previous person's Yorkie
   * actor and into their store scope, which is the cross-account leak every
   * other part of this feature is scoped to avoid. So the identity is part of
   * the subject, and changing it re-decides.
   */
  const subject = `${person?.id ?? 'anon'}:${docKey}`;
  const held = useRef<{
    subject: string;
    durable: boolean;
    clientKey?: string;
  }>(null);
  const [stoodDown, setStoodDown] = useState<string | null>(null);
  const giveUp = useCallback(() => {
    setStoodDown(subject);
    standDown();
  }, [subject, standDown]);

  const ready = settled && identified;
  if (ready && held.current?.subject !== subject) {
    held.current = { subject, durable, clientKey };
    // A stand-down belongs to the subject it was made for, and is discarded
    // with it. Latched forever, it outlives its own reason: the hook re-runs
    // its election for the new subject and can win it, so this component would
    // *hold the lock* — denying durability to every other tab — while refusing
    // to mount the client the lock was taken for. That is the exact state
    // standing down exists to escape, made permanent. React allows this
    // render-phase update because it is this component's own state, and the
    // condition is false on the immediate re-render it schedules.
    if (stoodDown !== null) {
      setStoodDown(null);
    }
  }
  const decided =
    held.current?.subject === subject && stoodDown !== subject
      ? held.current
      : undefined;

  // Why this document is *not* on disk, for the chip's tooltip to name. The
  // durable client publishes its own reasons over the top of this one; these
  // are the ones only the call site knows.
  //
  // A build that cannot carry a client key publishes **no** reason at all, and
  // that is the difference between a dark launch and a regression. Until the
  // dependency is bumped `supportsClientKey()` is false on every render of
  // every document (`packages/frontend/package.json` pins `@yorkie-js/react`
  // below `MinClientKeyVersion`), so a lapse here would reach every user's
  // `Not saved` tooltip — telling them "this browser cannot save documents
  // locally", which is both a sentence about a feature they were never offered
  // and a dependency pin of ours reported as a fault of their browser. No
  // lapse means the tooltip reads exactly as it did before this feature
  // existed, which is what "nothing changes for anyone until they opt in"
  // requires.
  const lapse: DurabilityLapse | undefined =
    decided?.durable || !supportsClientKey()
      ? undefined
      : !permitted
        ? "not-permitted"
        : !offlineEnabled
          ? "not-enabled"
          : "another-tab";

  const inner = (
    <DocumentProvider<R, P> initialPresence={initialPresence} {...rest}>
      <PresenceIdentityRepair<P> initialPresence={initialPresence} />
      {/* Inside the `DocumentProvider`, because it reads `useDocument()`. It
          is a no-op unless a durable client is mounted above, which is what
          lets it be rendered unconditionally from here — the one place that
          is inside both providers. */}
      <DurableLossWatch />
      {children}
    </DocumentProvider>
  );

  // Nothing is attached until the election *and* the identity have answered —
  // for a subject that has not been decided yet.
  //
  // Rendering the ambient client first and swapping would attach the document
  // twice on every durable open — and worse, an edit made in that window would
  // live in a client React is about to unmount, which offline is exactly where
  // it would be lost. The window is short, but "short" is not a property this
  // feature is allowed to rely on.
  //
  // The second half of the condition is what keeps this a *pre*-decision gate
  // rather than a standing one. Every term of `ready` can un-settle under an
  // already-decided document — enabling the preference mid-open moves the
  // hook's subject, and `identityPending` re-enters on a refetch — and
  // returning `null` then unmounts the `DocumentProvider` and the whole editor
  // under it, discarding the in-memory change queue. That is the loss this
  // feature exists to prevent, caused by switching the feature on.
  //
  // It costs no blank frame in the common case: a document that cannot persist
  // waits for neither, so this is already false on the first render whenever
  // the feature is off — which is every document today.
  if (!ready && held.current?.subject !== subject) {
    return null;
  }

  // `person`, never the live `me` — see `lastKnown` above. A refetch that
  // answers `null` must not be able to swap this branch for the other one under
  // a mounted client.
  //
  // The lapse scope wraps **both** branches, from out here rather than from
  // inside `inner`. `DurableYorkieProvider` publishes its own lapse — the
  // dropped log, the too-large snapshot, the full origin, the refused write —
  // and the design has it win by being nested deeper. Mounted inside `inner`,
  // this scope was the deeper one: it sat *below* the durable provider's and
  // overwrote every one of those reasons with the `undefined` a durable
  // document computes here, so none of them could ever reach the chip. The
  // nesting is the whole mechanism, so it is the nesting that has to be right.
  return (
    <DurabilityLapseScope lapse={lapse}>
      {!decided?.durable || !decided.clientKey || !person ? (
        inner
      ) : (
        <DurableYorkieProvider
          clientKey={decided.clientKey}
          userId={String(person.id)}
          rpcAddr={import.meta.env.VITE_YORKIE_RPC_ADDR}
          apiKey={import.meta.env.VITE_YORKIE_PUBLIC_KEY}
          metadata={{
            userID: encodeURIComponent(person.username || 'anonymous-user'),
          }}
          authTokenInjector={fetchYorkieToken}
          // The app elects a tab before the SDK's own lock is reached, so this
          // should not fire. It is the backstop for the race where the two
          // disagree: holding the election while the attach is refused leaves
          // this tab non-durable *and* every other tab refused, which is
          // strictly worse than having lost the election in the first place.
          onLockRefused={giveUp}
        >
          {inner}
        </DurableYorkieProvider>
      )}
    </DurabilityLapseScope>
  );
}
