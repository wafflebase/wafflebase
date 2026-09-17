import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DocumentProvider, useDocument } from '@yorkie-js/react';
import type { Indexable } from '@yorkie-js/sdk';
import { fetchMe, fetchYorkieToken } from '@/api/auth';
import { useDurableDocument } from '@/lib/use-durable-document';
import { DurableYorkieProvider } from '@/components/durable-yorkie-provider';

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
 * `wb:{userId}:{docKey}`, with the IndexedDB store attached.
 *
 * Otherwise it renders exactly what it always did, on the ambient
 * session-wide client. That is what keeps the opt-in free for everyone who
 * declines it — no second `ActivateClient`, no new identity, no behavior to
 * regress. Design: `docs/design/offline-local-persistence.md`.
 *
 * No route file changes, and none are wanted: the PDF exclusion is derived
 * from the `docKey` prefix this component already receives, and
 * `shared-document.tsx` mounts its own provider, so anonymous share links are
 * excluded structurally rather than by a condition somebody has to remember.
 *
 * One cost worth naming: deciding this needs to know who is signed in, so this
 * component now requires a `QueryClientProvider` above it. The app mounts one
 * at its root, but a test that renders an editor in isolation has to supply
 * one — three existing suites needed it when this landed.
 */
export function CollabDocumentProvider<R, P extends Indexable = Indexable>({
  initialPresence,
  children,
  ...rest
}: Parameters<typeof DocumentProvider<R, P>>[0]) {
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: fetchMe,
    retry: false,
  });
  const docKey = (rest as { docKey: string }).docKey;
  const { durable, clientKey, settled, standDown } = useDurableDocument({
    docKey,
    userId: me?.id === undefined ? undefined : String(me.id),
  });

  const inner = (
    <DocumentProvider<R, P> initialPresence={initialPresence} {...rest}>
      <PresenceIdentityRepair<P> initialPresence={initialPresence} />
      {children}
    </DocumentProvider>
  );

  // Nothing is attached until the election has answered.
  //
  // Rendering the ambient client first and swapping would attach the document
  // twice on every durable open — and worse, an edit made in that window would
  // live in a client React is about to unmount, which offline is exactly where
  // it would be lost. The window is short, but "short" is not a property this
  // feature is allowed to rely on.
  //
  // It costs no blank frame in the common case: a document that is not
  // eligible answers synchronously, so `settled` is already true on the first
  // render whenever the feature is off — which is every document today.
  if (!settled) {
    return null;
  }

  if (!durable || !clientKey || !me) {
    return inner;
  }

  return (
    <DurableYorkieProvider
      clientKey={clientKey}
      userId={String(me.id)}
      rpcAddr={import.meta.env.VITE_YORKIE_RPC_ADDR}
      apiKey={import.meta.env.VITE_YORKIE_PUBLIC_KEY}
      metadata={{
        userID: encodeURIComponent(me.username || 'anonymous-user'),
      }}
      authTokenInjector={fetchYorkieToken}
      // The app elects a tab before the SDK's own lock is reached, so this
      // should not fire. It is the backstop for the race where the two
      // disagree: holding the election while the attach is refused leaves this
      // tab non-durable *and* every other tab refused, which is strictly worse
      // than having lost the election in the first place.
      onLockRefused={standDown}
    >
      {inner}
    </DurableYorkieProvider>
  );
}
