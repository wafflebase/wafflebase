import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { fetchDocument } from '@/api/documents';
import { getDocumentPath } from '@/app/documents/document-list-utils';
import { isOpenInAnyTab } from '@/lib/durable-session';
import { listRecoverableWork } from '@/lib/offline-copy';
import {
  describeArchivedDocument,
  recoverOfflineCopy,
} from '@/lib/offline-copy-recovery';
import {
  rememberOfflineUser,
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
 * | Every session | collect entries untouched for thirty days |
 * | Work the SDK could not reconcile | offer it back as a document |
 *
 * Mounted once by `PrivateRoute`, which is the only place that has both an
 * identity and a lifetime longer than a single document. It renders nothing.
 */
export function OfflineRuntime({ userId }: { userId: string }) {
  const navigate = useNavigate();

  useEffect(() => {
    // Logout has no identity of its own by the time it runs, so it is told one
    // here while there still is one.
    rememberOfflineUser(userId);

    const store = new WafflebaseDocStore({
      userId,
      // The same guard the durable client uses. Collection is not eviction,
      // but it deletes for the same reasons and would do the same damage:
      // purging a document another tab has open makes every later append for
      // it vanish while that tab's chip still reports it saved.
      isOpenElsewhere: isOpenInAnyTab,
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
        // The thirty-day sweep. Once per session rather than on a timer: the
        // entries it collects are by definition weeks old, so nothing is
        // gained by asking again an hour later, and a timer would keep a
        // database handle open for the life of the tab.
        await store.collectStale();
      } catch (err) {
        console.warn('[offline] could not collect stale documents:', err);
      }

      if (cancelled) return;

      try {
        // A getter, not the value: this loop awaits the network between
        // items, and a boolean copied in at call time would still read
        // `false` long after the component unmounted.
        await offerRecoverableWork(store, () => cancelled, navigate);
      } catch (err) {
        console.warn('[offline] could not list recoverable work:', err);
      }
    })();

    return () => {
      cancelled = true;
      stopWatching();
      rememberOfflineUser(undefined);
      store.close();
    };
  }, [userId, navigate]);

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
  navigate: ReturnType<typeof useNavigate>,
): Promise<void> {
  const work = await listRecoverableWork(store);
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
    let title = 'Untitled';
    try {
      title = (await fetchDocument(described.id)).title || title;
    } catch {
      // Keep the fallback.
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
          })
            .then((outcome) => {
              if (!outcome.documentId) {
                toast.error('Could not recover those changes', {
                  description:
                    outcome.refused === 'empty'
                      ? 'There was nothing left to recover.'
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
