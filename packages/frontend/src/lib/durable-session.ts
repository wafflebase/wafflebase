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

  const lock = injected ?? webLocks();
  let release: (() => void) | undefined;
  try {
    release = await lock.request(durableLockName(userId, docKey));
  } catch {
    // Fail closed, for the same reason an unsupported runtime does: a lock
    // manager that errored has told us nothing about who holds what.
    return undefined;
  }

  if (!release) {
    return undefined;
  }

  // Released at most once. The caller releases from an effect cleanup, which
  // React can run more than once in StrictMode, and a second release would free
  // a name a *later* tab has since taken — handing two tabs the same stable
  // actor, which is the failure this module exists to prevent.
  let released = false;
  const held = release;
  return {
    release() {
      if (released) return;
      released = true;
      held();
    },
  };
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
export async function isOpenInAnyTab(docKey: string): Promise<boolean> {
  if (!supportsDurableSession() || typeof navigator === "undefined") {
    return true;
  }
  try {
    const state = await navigator.locks!.query();
    const suffix = `:${docKey}`;
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
