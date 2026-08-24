/**
 * The bridge between the session singleton and React.
 *
 * The session deliberately keeps no framework state (a report lost to a remount
 * is lost for good, since the thing it described has already scrolled away), so
 * something has to subscribe. `useSyncExternalStore` is exactly that something,
 * and using it rather than a `useState` mirror means the overlay and the panel
 * can never disagree about how many items exist.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  createBrowserStore,
  debugSession,
  type CaptureStore,
  type DebugItem,
  type DebugSession,
} from "@wafflebase/debug-report";

export type SessionView = {
  session: DebugSession;
  store: CaptureStore;
  items: readonly DebugItem[];
  mode: ReturnType<DebugSession["mode"]>;
  /**
   * False when anything this session needs to survive a reload was refused —
   * IndexedDB for the images, or `localStorage` for the metadata. Both matter:
   * a browser that blocks site data loses the SENTENCES, which is worse.
   */
  persistent: boolean;
  /** Items whose stored pixels were gone when this session was rehydrated. */
  droppedCaptures: string[];
};

/**
 * One store per page, created lazily.
 *
 * Module scope rather than a hook-local ref: the store owns a database
 * connection and an eviction budget, and two of them would evict against each
 * other's ledger.
 */
let shared: { store: CaptureStore; persistent: boolean } | undefined;

function sharedStore(): { store: CaptureStore; persistent: boolean } {
  if (!shared) shared = createBrowserStore();
  return shared;
}

/** The id this session persists under. Stable for the life of the page. */
const sessionId = `wb-${Date.now().toString(36)}`;

/**
 * Whether this page has already read what was persisted.
 *
 * MODULE SCOPE, NOT A REF, and StrictMode is why. A ref set on the first effect
 * run makes the second run skip the load — while the first run's cleanup has
 * already flipped its `cancelled` flag, so the only `load()` in flight discards
 * its own result. Since this overlay is DEV-only, StrictMode's
 * mount/unmount/remount is the *only* environment it runs in: the bug was not an
 * edge case, it was every session. Module scope survives the remount, so the
 * second run does the work and the first run's cancellation costs nothing.
 */
let rehydrating: Promise<void> | undefined;

export function useDebugSession(session: DebugSession = debugSession): SessionView {
  const { store, persistent: blobsPersist } = sharedStore();
  const [metaPersists, setMetaPersists] = useState(true);

  const items = useSyncExternalStore(
    useCallback((cb) => session.subscribe(cb), [session]),
    useCallback(() => session.items(), [session]),
  );
  const mode = useSyncExternalStore(
    useCallback((cb) => session.subscribe(cb), [session]),
    useCallback(() => session.mode(), [session]),
  );

  // Rehydrate once per page. A reload in the middle of collecting is common —
  // the app being reported on is the one misbehaving — so the batch has to
  // survive it.
  //
  // NOTHING HERE CALLS `setState`. The result arrives in a microtask, which is
  // outside any React commit — updating state from there is the "not configured
  // to support act(...)" warning in tests and a needless extra render in the
  // app. Instead the restored items go through `session.replaceAll`, whose
  // subscription already re-renders every consumer, and the drop list is read
  // during that render.
  useEffect(() => {
    // `.catch` BEFORE anything awaits this, and it must not rethrow. `load()`
    // reads persisted metadata, so malformed JSON rejects it — and then
    // `rehydrated` stayed false, every later save took the `rehydrating?.then`
    // path against a rejected promise, and each one became an unhandled
    // rejection while nothing was ever written again. A failed read means "there
    // is nothing to restore", which is a normal answer, so the session proceeds
    // empty and saves resume.
    rehydrating ??= store
      .load()
      .then((restored) => {
        rehydrated = true;
        if (!restored) return;
        if (restored.droppedCaptures.length > 0) {
          droppedOnLoad = restored.droppedCaptures;
        }
        // Only adopt the restored list when nothing has been collected since the
        // page loaded, so a rehydrate that lands late cannot swallow a report
        // made in the meantime. The trade-off is that a session which already
        // had items shows the drop warning on its next change rather than at
        // once.
        if (session.count() === 0 && restored.items.length > 0) {
          session.replaceAll(restored.items);
        }
      })
      .catch(() => {
        rehydrated = true;
      });
  }, [session, store]);

  // Persist on every change — INCLUDING the change to nothing.
  //
  // Guarding on a non-empty list would mean deleting the last item never writes,
  // so the next load restores what the reporter deleted. The guard that is
  // actually needed is "has the initial read finished", which is what `loaded`
  // is: before that, writing would clobber the metadata being read.
  useEffect(() => {
    // The read has to have finished, or this would write over the metadata being
    // restored. Checked at call time rather than held in state so the rehydrate
    // never has to trigger a render of its own.
    if (rehydrated) {
      setMetaPersists(store.save(sessionId, items).persisted);
      return;
    }
    // A change that beats the read — a report collected within milliseconds of
    // the page loading — is saved once the read finishes. Without this the
    // effect would simply have skipped, and nothing re-runs it until the NEXT
    // change, so that report would exist only in memory. The persistence flag
    // is deliberately not updated from here: this resolves in a microtask,
    // outside any React commit, and it corrects itself on the next change.
    let live = true;
    void rehydrating?.then(() => {
      if (live) store.save(sessionId, items);
    });
    return () => {
      live = false;
    };
  }, [items, store]);

  return {
    session,
    store,
    items,
    mode,
    persistent: blobsPersist && metaPersists,
    droppedCaptures: droppedOnLoad,
  };
}

/** Whether the initial read has finished. Gates the first write. */
let rehydrated = false;

/**
 * Items whose stored pixels were already gone when this page rehydrated.
 *
 * Module scope for the same reason as `rehydrating`: under StrictMode the run
 * that learns about them is not always the run that is still mounted.
 */
let droppedOnLoad: string[] = [];

/** Test seam: forget that this page ever rehydrated. */
export function __resetRehydrateForTests(): void {
  rehydrating = undefined;
  rehydrated = false;
  droppedOnLoad = [];
  shared = undefined;
}
