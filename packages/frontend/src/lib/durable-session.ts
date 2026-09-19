import { documentKeyOf } from "./wafflebase-doc-store";

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
 *
 * **Salted with a per-device secret, and that is not decoration.** Yorkie
 * authorizes `ActivateClient` and `DeactivateClient` on token validity alone —
 * the auth webhook gates documents, not client rows — so a key anybody can
 * *derive* is one that anybody holding any valid token can activate or tear
 * down. Both of the obvious ingredients are public to a workspace peer:
 * `userId` is the sequential id every member list carries, and `docKey` is
 * `sheet-<documentId>` with the id sitting in the URL. A bare
 * `wb:{userId}:{docKey}` was therefore guessable by exactly the people best
 * placed to use it, who could take over or repeatedly deactivate another
 * member's per-document client and strand the durable session this feature
 * depends on.
 *
 * The user and the document stay in the key — they keep the per-document
 * scoping above and make a server-side client list readable — and the secret is
 * what makes the whole thing unguessable.
 */
export function durableClientKey(userId: string, docKey: string): string {
  return `wb:${deviceSecret(userId)}:${userId}:${docKey}`;
}

/**
 * Where this device's client-key secrets live, one per account.
 *
 * `localStorage` rather than memory, because the key's whole purpose is to be
 * the *same* one after a reload: the SDK's store is scoped
 * `apiKey/clientKey/docKey`, so a key that changes per session resumes nothing.
 * Clearing site data mints a new one and orphans whatever was written under the
 * old, which the thirty-day sweep collects — the same outcome as clearing the
 * database itself, and the direction that costs storage rather than safety.
 *
 * **Per account, not per browser profile**, and that is the whole point of the
 * salt. A single profile-wide secret is read by whoever is signed in *now*, and
 * a shared device — the case this feature exists for — is exactly where that
 * somebody is a different person: with one value, a signed-in user could
 * reconstruct every other account's `wb:{secret}:{userId}:{docKey}` from
 * ingredients (`userId`, `docKey`) a workspace peer already holds, and Yorkie
 * authorizes `ActivateClient`/`DeactivateClient` on token validity alone. One
 * secret per account removes the shared ingredient.
 *
 * And it is spent with that account's data: {@link forgetDeviceSecret} is
 * called by the erase, so a sign-out leaves the next user of this device
 * nothing to read. The residual — an account whose erase never ran leaves its
 * own entry behind — is bounded by the thirty-day sweep and by that erase's own
 * retry, and is strictly smaller than one value covering everybody.
 */
const DEVICE_SECRET_PREFIX = "wafflebase-durable-device";

/** The `localStorage` key holding `userId`'s secret. */
function deviceSecretKey(userId: string): string {
  return `${DEVICE_SECRET_PREFIX}:${userId}`;
}

/** This session's secrets, per account, for a browser that will not hold them. */
const volatileSecrets = new Map<string, string>();

function randomSecret(): string {
  const bytes = new Uint8Array(8);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    // Not reachable in a browser that can hold a durable session at all —
    // `navigator.locks` and `crypto` are both secure-context APIs — but a weak
    // secret is still strictly better than a derivable one.
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A stable random id for one account on this browser profile, minted once.
 *
 * Opaque and content-free: it names no document, it is never sent anywhere on
 * its own, and it exists purely so the client key above cannot be *derived* by
 * somebody who knows who you are and what you are editing — including the next
 * person to sign in on this machine.
 */
function deviceSecret(userId: string): string {
  const key = deviceSecretKey(userId);
  try {
    const stored = localStorage.getItem(key);
    if (stored) {
      return stored;
    }
    const minted = randomSecret();
    localStorage.setItem(key, minted);
    return minted;
  } catch {
    // Storage refused (private mode, blocked third-party storage). A key that
    // does not survive a reload costs this device its resume; a guessable one
    // would cost every device its client row — so an unguessable
    // session-scoped secret is the right way to fail here.
    let secret = volatileSecrets.get(userId);
    if (!secret) {
      secret = randomSecret();
      volatileSecrets.set(userId, secret);
    }
    return secret;
  }
}

/**
 * Drops one account's secret, so nothing left on this device can be tied back
 * to it — and so the next sign-in mints a fresh one.
 *
 * Called by the erase (`offline-erase.ts`), which is the moment this account's
 * stored documents go: keeping the salt that named them would leave the one
 * ingredient a later user of the machine cannot otherwise obtain.
 */
export function forgetDeviceSecret(userId: string): void {
  volatileSecrets.delete(userId);
  try {
    localStorage.removeItem(deviceSecretKey(userId));
  } catch {
    // Nothing stored to forget.
  }
}

/** Forgets every minted device secret. Test-only. */
export function resetDeviceSecretForTest(): void {
  volatileSecrets.clear();
  try {
    // Every account's, and the profile-wide key earlier builds wrote, so a
    // test (or a device) carrying the old shape starts from nothing.
    const stale: Array<string> = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(DEVICE_SECRET_PREFIX)) {
        stale.push(key);
      }
    }
    for (const key of stale) {
      localStorage.removeItem(key);
    }
  } catch {
    // Nothing stored to forget.
  }
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
 * Answers `whenUnknown` when it cannot tell, and that answer is the caller's to
 * choose because the two kinds of caller pay opposite costs.
 *
 * **Eviction and the frame it protects** default to `true`: refusing to delete
 * costs a failed write the caller already handles, while deleting a document
 * somebody is editing costs their edits.
 *
 * **Erasure** — the revocation reconcile, the thirty-day sweep — passes
 * `false`. There, refusing to delete means keeping document content the rule
 * says must go: a workspace the user was removed from, or an entry nothing has
 * touched in a month. And it is refusing on no evidence, since `true` here is
 * not "somebody has it open", it is "this browser has `LockManager.request`
 * but not `query`, or `query` threw". A runtime that cannot answer also cannot
 * hold a durable session — {@link supportsDurableSession} gates the whole
 * feature on the same API — so there is no live client to pull the entry out
 * from under.
 *
 * `userId` scopes the match to one account. A Web Lock is per origin, so
 * without it another account's open document on a shared device defers this
 * account's erase indefinitely.
 */
export async function isOpenInAnyTab(
  key: string,
  options: { userId?: string; whenUnknown?: boolean } = {},
): Promise<boolean> {
  const unknown = options.whenUnknown ?? true;
  if (
    !supportsDurableSession() ||
    typeof navigator === "undefined" ||
    typeof navigator.locks?.query !== "function"
  ) {
    return unknown;
  }
  try {
    const state = await navigator.locks.query();
    // The store keys its entries the way the SDK does —
    // `apiKey/clientKey/docKey` — while a lock name ends in the bare document
    // key. Comparing the two verbatim can never match, which silently turned
    // this guard off everywhere it mattered: every sweep and every eviction saw
    // every other tab's open document as idle.
    const suffix = `:${documentKeyOf(key)}`;
    const prefix =
      options.userId === undefined
        ? "wb-durable:"
        : `wb-durable:${options.userId}:`;
    return (state.held ?? []).some(
      (lock) =>
        typeof lock.name === "string" &&
        lock.name.startsWith(prefix) &&
        lock.name.endsWith(suffix),
    );
  } catch {
    return unknown;
  }
}
