/**
 * Electing one tab per document, before the SDK ever tries.
 *
 * Design: `docs/design/offline-local-persistence.md` § Multi-tab.
 *
 * With a store configured the SDK takes its own Web Lock on
 * `apiKey/clientKey/docKey` and the second tab's `attach` **throws**. A document
 * open in two tabs is ordinary use here — presence renders it as two peers — so
 * failing it is not acceptable.
 *
 * Nor is it enough to skip the store in the second tab. Two tabs are safe today
 * only because the client key is random per session, giving each its own actor.
 * A stable key makes both share one actor, and then a shared checkpoint mints
 * colliding `clientSeq` values while actor-keyed pull dedup filters each tab's
 * changes out of the other — silent edit loss. **The second tab needs a
 * different key, not merely a disabled store.**
 *
 * So the app queues up first: whoever takes `wb-durable:{userId}:{docKey}` gets
 * the stable key (and, from W4, the store); everybody else keeps today's random
 * key and non-durable behavior. First-tab-wins costs the second tab its
 * durability but never shows it a broken screen.
 */

/** The lock manager this module uses. Injectable so tests need no browser. */
export interface DurableLock {
  /**
   * Takes `name` without waiting. Resolves with a release function when the
   * caller now holds it, or `undefined` when somebody else does.
   */
  request(name: string): Promise<(() => void) | undefined>;
}

/** A held election. Releasing lets a later tab become the durable one. */
export interface DurableSession {
  release(): void;
}

let injected: DurableLock | undefined;

/** Replaces the lock manager. Test-only; pass `undefined` to restore. */
export function setDurableLockForTest(lock: DurableLock | undefined): void {
  injected = lock;
}

/**
 * Whether this runtime can guarantee a single durable tab.
 *
 * `navigator.locks` is absent on insecure origins and in older browsers. We
 * decline durability there rather than proceeding without the guard: the SDK's
 * own lock also no-ops without the API, so nothing would stop a second tab, and
 * a stable actor with no guard is exactly the silent-edit-loss case this module
 * exists to prevent. Fail closed — the cost is the feature being unavailable,
 * not a document being corrupted.
 */
export function supportsDurableSession(): boolean {
  if (injected) {
    return true;
  }
  return (
    typeof navigator !== "undefined" &&
    !!navigator.locks &&
    typeof navigator.locks.request === "function"
  );
}

/** The app-owned lock name. Deliberately unlike the SDK's own `a/b/c` shape. */
export function durableLockName(userId: string, docKey: string): string {
  return `wb-durable:${userId}:${docKey}`;
}

/**
 * The Yorkie client key a durable tab uses.
 *
 * Scoped to the document rather than to the user, so each document gets its own
 * server-side client row and one tab's detach cannot disturb another tab
 * holding a different document.
 */
export function durableClientKey(userId: string, docKey: string): string {
  return `wb:${userId}:${docKey}`;
}

/** The Web Locks API, shaped as a {@link DurableLock}. */
function webLocks(): DurableLock {
  return {
    request(name) {
      return new Promise<(() => void) | undefined>((resolve, reject) => {
        // A Web Lock is held for as long as the callback's promise is pending,
        // so the callback parks on a promise resolved by `release`.
        let releaseHeld: (() => void) | undefined;
        navigator
          .locks!.request(name, { ifAvailable: true }, (lock) => {
            if (!lock) {
              // Held by another tab: fail fast, which is the whole point.
              resolve(undefined);
              return;
            }
            return new Promise<void>((resolveHeld) => {
              releaseHeld = resolveHeld;
              resolve(() => releaseHeld?.());
            });
          })
          .catch(reject);
      });
    },
  };
}

/**
 * Elections this tab holds or is in the middle of taking, by lock name.
 *
 * A Web Lock is per *origin*, not per caller, so a second request for a name
 * this tab already holds is refused exactly like another tab's would be — and
 * that is not hypothetical. React StrictMode mounts every effect twice, and
 * both requests are enqueued before either is processed: the first is granted,
 * the second sees the name held and resolves `undefined`, and the first one's
 * release is several microtasks behind. Nothing retries, because the effect's
 * dependencies did not change. The tab ends up reporting itself non-durable
 * forever, with the lock free — the feature simply never works in development.
 *
 * So the election is shared within the tab and reference-counted. Two callers
 * for one document get one lock and one actor, which is what we want anyway:
 * same tab, same session, no divergence. The name is released when the last of
 * them lets go.
 */
const elections = new Map<
  string,
  { holders: number; handle: Promise<(() => void) | undefined> }
>();

/**
 * Tries to become the durable tab for one document.
 *
 * Resolves with a {@link DurableSession} when this tab won, and `undefined`
 * when it did not — including when the runtime cannot guarantee the election at
 * all. The caller treats `undefined` as "stay on today's behavior".
 */
export async function acquireDurableSession(
  userId: string,
  docKey: string,
): Promise<DurableSession | undefined> {
  if (!supportsDurableSession()) {
    return undefined;
  }

  const name = durableLockName(userId, docKey);
  const existing = elections.get(name);
  const entry = existing ?? {
    holders: 0,
    handle: (injected ?? webLocks())
      .request(name)
      // Fail closed, for the same reason an unsupported runtime does: a lock
      // manager that errored has told us nothing about who holds what.
      .catch(() => undefined),
  };
  entry.holders += 1;
  elections.set(name, entry);

  const releaseLock = await entry.handle;
  if (!releaseLock) {
    // Nobody here holds it, so this caller was never a holder.
    entry.holders -= 1;
    if (entry.holders <= 0) {
      elections.delete(name);
    }
    return undefined;
  }

  // Released at most once *per caller*. The caller releases from an effect
  // cleanup, which React can run more than once, and a second release would
  // drop the count below what is actually held — freeing a name a later tab
  // may have taken, and handing two tabs the same stable actor.
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      const current = elections.get(name);
      if (!current) return;
      current.holders -= 1;
      if (current.holders <= 0) {
        elections.delete(name);
        releaseLock();
      }
    },
  };
}

/** Forgets every election this tab is tracking. Test-only. */
export function resetElectionsForTest(): void {
  elections.clear();
}

/**
 * Whether any tab currently holds the election for `docKey`.
 *
 * This is what lets the store refuse to evict or collect a document somebody
 * has open. The store cannot answer it alone: its own record of "open" is
 * per-instance memory, while the ordering eviction reads is a shared database,
 * so two tabs on different documents each see the other's document as idle.
 * The election is already global — `navigator.locks.query()` reports held locks
 * across every tab of the origin — so the answer exists, it just has to be
 * asked for.
 *
 * Answers `true` when it cannot tell. Refusing to evict costs a failed write
 * the caller already handles; evicting a document somebody is editing costs
 * their edits.
 */
export async function isOpenInAnyTab(key: string): Promise<boolean> {
  if (!supportsDurableSession() || typeof navigator === "undefined") {
    return true;
  }
  try {
    const state = await navigator.locks!.query();
    // The store keys its entries the way the SDK does —
    // `apiKey/clientKey/docKey` — while a lock name ends in the bare document
    // key. Comparing the two verbatim can never match, which silently turned
    // this guard off everywhere it mattered: every sweep and every eviction saw
    // every other tab's open document as idle.
    const suffix = `:${documentKeyOf(key)}`;
    return (state.held ?? []).some(
      (lock) =>
        typeof lock.name === "string" &&
        lock.name.startsWith("wb-durable:") &&
        lock.name.endsWith(suffix),
    );
  } catch {
    return true;
  }
}

/**
 * The document key inside an SDK store key.
 *
 * Store keys are `apiKey/clientKey/docKey`; a bare document key has no `/` and
 * comes back unchanged, so this is safe to apply to either.
 */
export function documentKeyOf(key: string): string {
  const parts = key.split("/");
  return parts[parts.length - 1] || key;
}
