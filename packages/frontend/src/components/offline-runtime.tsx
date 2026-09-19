import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { fetchDocument, fetchDocuments } from '@/api/documents';
import { HttpError } from '@/api/http-error';
import { getDocumentPath } from '@/app/documents/document-list-utils';
import { isOpenInAnyTab } from '@/lib/durable-session';
import { listRecoverableWork } from '@/lib/offline-copy';
import {
  purgeRevokedOfflineDocuments,
  rememberOfflineUser,
  retryPendingOfflineErase,
  watchForOfflineDisable,
} from '@/lib/offline-erase';
import { WafflebaseDocStore } from '@/lib/wafflebase-doc-store';

/**
 * The offline feature's housekeeping, for as long as somebody is signed in.
 *
 * Design: `docs/design/offline-local-persistence.md` § Storage, § Turning it
 * on, § Losing work anyway.
 *
 * Everything here is a promise the rest of the feature makes and cannot keep
 * on its own, because each one happens when no editor is mounted:
 *
 * | Trigger | What runs |
 * |---|---|
 * | The toggle switched off | erase this user's entries and archives |
 * | A sign-out whose erase failed | finish it, whoever is signed in now |
 * | Every session | collect entries untouched for thirty days |
 * | Every session | drop copies of documents the server no longer lists |
 * | Work the SDK could not reconcile | offer it back as a document |
 *
 * The last row depends on the one above it: an archive is only ever offered
 * back once this session has established what the user may still read.
 *
 * Mounted once by `PrivateRoute`, which is the only place that has both an
 * identity and a lifetime longer than a single document. It renders nothing.
 *
 * `PrivateRoute` is imported eagerly by `App.tsx` while every route under it is
 * `lazy()`, so this module is in the authenticated shell's first chunk and
 * whatever it imports statically comes with it. The recovery half —
 * `offline-copy-recovery`, and through it the docs, slides, board and sheets
 * engines it writes documents with — is therefore reached by `import()` at the
 * moment an archive actually exists, which is rare and never during a first
 * paint. Importing it at the top defeats the route splitting the app is built
 * around, for code that runs on almost no session.
 */
export function OfflineRuntime({ userId }: { userId: string }) {
  const navigate = useNavigate();
  // Held in a ref, and deliberately out of the effect's dependencies below.
  //
  // The app mounts a declarative `<BrowserRouter>`, where `useNavigate()` does
  // not keep a stable identity across location changes. As a dependency it
  // would re-run this whole effect on every in-app navigation that leaves
  // `PrivateRoute` mounted — a new database handle, the thirty-day sweep
  // again, the archive listing again, and a title fetch per archive — for an
  // identity that has not changed. The toast id dedupes what the user sees,
  // which is exactly why the repetition would go unnoticed.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    // Logout has no identity of its own by the time it runs, so it is told one
    // here while there still is one.
    rememberOfflineUser(userId);

    // The guard the durable client uses, asked the way an *erasing* caller has
    // to ask it. Collection is not eviction: it deletes for the same reasons
    // and would do the same damage to an open document, so a held lock still
    // spares the entry — but a browser that cannot answer the question must
    // not thereby switch the sweep off, and another account's open document on
    // a shared device must not defer this account's cleanup. Scoped to this
    // user, and "unknown" reads as not-open.
    const openElsewhere = (docKey: string) =>
      isOpenInAnyTab(docKey, { userId, whenUnknown: false });

    const store = new WafflebaseDocStore({
      userId,
      isOpenElsewhere: openElsewhere,
    });

    // Reads store and user at fire time, never captures them — the watcher
    // outlives a sign-out, and erasing whoever happened to be signed in when
    // it was installed would be the harm it exists to prevent.
    const stopWatching = watchForOfflineDisable(
      () => store,
      () => userId,
    );

    let cancelled = false;

    void (async () => {
      try {
        // Before anything else, and before this session writes anything of its
        // own: an erase a previous sign-out could not finish is somebody else's
        // documents still on this disk, and that account may never come back to
        // this device to try again.
        await retryPendingOfflineErase();
      } catch (err) {
        console.warn('[offline] could not finish an owed erase:', err);
      }

      if (cancelled) return;

      try {
        // The thirty-day sweep. Once per session rather than on a timer: the
        // entries it collects are by definition weeks old, so nothing is
        // gained by asking again an hour later, and a timer would keep a
        // database handle open for the life of the tab.
        await store.collectStale();
      } catch (err) {
        console.warn('[offline] could not collect stale documents:', err);
      }

      if (cancelled) return;

      // Whether this session established what the user may still read. The
      // recovery offer below depends on the answer, so it is tracked rather
      // than assumed — see the comment above `offerRecoverableWork`'s call.
      let reconciled = false;

      try {
        // Access somebody *else* ended reaches this device no other way. Every
        // other purge runs on the device of whoever made the request, so a
        // member removed from a workspace keeps full local copies of its
        // documents until their own app asks what it may still read. This is
        // that question.
        //
        // The listing is awaited here rather than inside the purge, so a failed
        // or partial answer throws before anything is deleted — a purge that
        // keeps "everything the server listed" must never run on a list the
        // server did not give.
        //
        // Stamped *before* the request, because the listing answers for the
        // moment it was asked: a document another tab of this user creates or
        // opens while it is in flight is missing from it for no reason at all,
        // and this database is shared with those tabs. Entries touched since
        // then, and any document a client has open right now, are left alone —
        // deleting one is the same silent-append loss eviction is careful to
        // avoid, with no quota failure needed to cause it.
        const listedAt = Date.now();
        const accessible = await fetchDocuments();
        if (cancelled) return;
        await purgeRevokedOfflineDocuments(
          accessible.map((doc) => doc.id),
          { listedAt, isOpenElsewhere: openElsewhere },
        );
        reconciled = true;
      } catch (err) {
        console.warn('[offline] could not reconcile local copies:', err);
      }

      if (cancelled) return;

      // **Only once access has been reconciled.** Recovery does not hand work
      // back to an editor; it materializes an archive — a full snapshot of a
      // document — as a *new server-side document owned by whoever is signed
      // in*. The reconcile above is the only thing on this device that knows an
      // archive belongs to a workspace the user has since been removed from:
      // every other purge runs on the device of whoever made the request, and
      // the removed member's own machine is reached by none of them. Offering
      // anyway when it failed is how content the user may no longer read gets
      // copied back into their own workspace with their name on it.
      //
      // Declining costs nothing but a delay: the archive is left in place and
      // the offer is made again next session, which is already the contract for
      // a declined offer.
      if (!reconciled) {
        console.warn(
          '[offline] skipping recovery: access could not be reconciled',
        );
        return;
      }

      try {
        // A getter, not the value: this loop awaits the network between
        // items, and a boolean copied in at call time would still read
        // `false` long after the component unmounted.
        await offerRecoverableWork(store, () => cancelled, (to: string) =>
          navigateRef.current(to),
        );
      } catch (err) {
        console.warn('[offline] could not list recoverable work:', err);
      }
    })();

    return () => {
      cancelled = true;
      stopWatching();
      // The identity is deliberately *not* forgotten here. This component
      // unmounts whenever the authenticated shell does — navigating to a share
      // link, to a public page, to Settings on a route tree of its own — and
      // signing out from any of those must still erase this device's stored
      // documents. `logout()` is what spends and clears it.
      store.close();
    };
  }, [userId]);

  return null;
}

/**
 * Tells the user what could not be saved, and offers it back as a document.
 *
 * Offered rather than created. Recovery makes a real document in the user's
 * workspace, and doing that unasked on a page load would fill a list with
 * copies nobody chose; the design's requirement is that the work is *returned*,
 * which an offer with the archive still in place satisfies — a declined offer
 * is made again next session rather than discarded.
 */
async function offerRecoverableWork(
  store: WafflebaseDocStore,
  cancelled: () => boolean,
  navigate: (to: string) => void,
): Promise<void> {
  const work = await listRecoverableWork(store);
  if (work.length === 0) return;

  // Loaded here and nowhere earlier. Rebuilding an archived document needs the
  // engine that wrote it, so this module pulls in docs, slides, board and
  // sheets — a cost that must not be paid by every signed-in page load for a
  // path almost no session takes. See the note on the component above.
  const { describeArchivedDocument, recoverOfflineCopy } = await import(
    '@/lib/offline-copy-recovery'
  );

  for (const item of work) {
    if (cancelled()) return;
    const described = describeArchivedDocument(item.docKey);
    // A key whose type cannot be read is left archived rather than guessed at.
    // Guessing would write the user's content into the wrong engine's shape,
    // which does not throw — it produces a plausible document that is not what
    // they wrote.
    if (!described) continue;

    // The title is a nicety and the server may legitimately no longer have it:
    // "the document was deleted upstream" is one of the three paths that
    // produce an archive in the first place.
    //
    // The workspace is not a nicety — a document cannot be created without one
    // — but it comes from the same answer, and is missing in the same case.
    // Recovery falls back to the user's first workspace when it is, which is
    // why **only a `404` may reach that fallback**. A `403` is the opposite
    // fact: the document is still there and this user may no longer read it,
    // so falling back would materialize a workspace's content as a new
    // document in a workspace the user owns, with their name on it — the same
    // harm the reconcile gate above exists to prevent, arriving through the
    // error handler instead. Anything else (a network failure, a 5xx, a 401)
    // establishes neither, and an archive left in place is offered again next
    // session, so an unclear answer costs a delay and nothing more.
    let title = 'Untitled';
    let workspaceId: string | undefined;
    try {
      const source = await fetchDocument(described.id);
      title = source.title || title;
      workspaceId = source.workspaceId;
    } catch (err) {
      if (!(err instanceof HttpError) || err.status !== 404) {
        console.warn(
          '[offline] leaving work archived: could not confirm the document is gone',
        );
        continue;
      }
      // Deleted upstream. Keep the fallbacks.
    }

    toast.warning('Some changes could not be saved', {
      id: `offline-recovery-${item.id}`,
      duration: Infinity,
      description: `Edits to "${title}" could not be reconciled with the server. They are still on this device.`,
      action: {
        label: 'Save a copy',
        onClick: () => {
          void recoverOfflineCopy(store, item, {
            title,
            type: described.type,
            workspaceId,
          })
            .then((outcome) => {
              if (!outcome.documentId) {
                toast.error('Could not recover those changes', {
                  description:
                    outcome.refused === 'empty'
                      ? 'There was nothing left to recover.'
                      : outcome.refused === 'unsupported-type'
                        ? 'This kind of document cannot be recovered as a copy.'
                        : 'The stored copy could not be read.',
                });
                return;
              }
              toast.success(`Recovered as "${outcome.title}"`, {
                description: outcome.complete
                  ? undefined
                  : 'Part of the stored work could not be replayed, so the copy may be incomplete.',
                action: {
                  label: 'Open',
                  onClick: () =>
                    navigate(
                      getDocumentPath({
                        id: outcome.documentId!,
                        type: described.type,
                      }),
                    ),
                },
              });
            })
            .catch((err) => {
              console.warn('[offline] recovery failed:', err);
              toast.error('Could not recover those changes');
            });
        },
      },
    });
  }
}
