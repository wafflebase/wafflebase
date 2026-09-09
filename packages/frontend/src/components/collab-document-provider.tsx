import { useEffect } from "react";
import { DocumentProvider, useDocument } from "@yorkie-js/react";
import type { Indexable } from "@yorkie-js/sdk";

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
      typeof doc.getStatus !== "function" ||
      typeof doc.getMyPresence !== "function" ||
      typeof doc.update !== "function"
    ) {
      return;
    }

    try {
      // A document that is not attached has no presence of its own to repair,
      // and `getMyPresence()` answers `{}` for it regardless — writing then
      // would fabricate an entry rather than restore one.
      if (doc.getStatus() !== "attached") return;

      const current = doc.getMyPresence() ?? {};
      const missing = Object.keys(initialPresence).filter(
        (key) => !(key in current),
      );
      if (missing.length === 0) return;

      const patch: Record<string, unknown> = {};
      for (const key of missing) {
        patch[key] = (initialPresence as Record<string, unknown>)[key];
      }
      doc.update((_root, presence) => presence.set(patch as Partial<P>));
    } catch (err) {
      console.warn("[presence] could not restore initialPresence:", err);
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
 */
export function CollabDocumentProvider<R, P extends Indexable = Indexable>({
  initialPresence,
  children,
  ...rest
}: Parameters<typeof DocumentProvider<R, P>>[0]) {
  return (
    <DocumentProvider<R, P> initialPresence={initialPresence} {...rest}>
      <PresenceIdentityRepair<P> initialPresence={initialPresence} />
      {children}
    </DocumentProvider>
  );
}
