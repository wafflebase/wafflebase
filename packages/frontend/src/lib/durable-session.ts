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
 * **Salted with a random secret, and that is not decoration.** Yorkie
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
 * The salt is minted **per document**, not once per account, and that is the
 * half that survives the key itself leaking. A client key is not a secret the
 * way a token is: Yorkie receives it on `ActivateClient`, stores it on the
 * client row, and an operator reads it in a log or an admin listing. With one
 * secret shared by every document, any single leaked key handed the reader the
 * salt — and with it every *other* key that account will ever use, including
 * documents they have no other visibility into. A per-document salt makes a
 * leaked key a capability for that one client row and nothing more, which is
 * the same exposure the SDK's own random per-session key already has.
 *
 * The user and the document stay in the key — they keep the per-document
 * scoping above and make a server-side client list readable — and the salt is
 * what makes the whole thing unguessable.
 */
export function durableClientKey(userId: string, docKey: string): string {
  return `wb:${deviceSecret(userId, docKey)}:${userId}:${docKey}`;
}

/**
 * Where this device's client-key salts live, one per account *per document*.
 *
 * `localStorage` rather than memory, because the key's whole purpose is to be
 * the *same* one after a reload: the SDK's store is scoped
 * `apiKey/clientKey/docKey`, so a key that changes per session resumes nothing.
 * Clearing site data mints a new one and orphans whatever was written under the
 * old, which the thirty-day sweep collects — the same outcome as clearing the
 * database itself, and the direction that costs storage rather than safety.
 *
 * **What this does and does not defend.** It defends the workspace peer, who
 * holds `userId` and `docKey` and nothing else: without the salt they can
 * derive another member's client key and tear it down. It does **not** defend
 * against somebody sitting at this browser profile — `localStorage` is
 * origin-scoped, so whoever can run script on the origin (the next person to
 * sign in, with devtools) reads every entry here whatever it is keyed by. An
 * earlier reading of this claimed per-account keying covered that case; it
 * cannot, and no client-side store can. What bounds *that* exposure is the two
 * rules below, not the shape of the key.
 *
 * So the entries are spent, and they expire:
 *
 * - {@link forgetDeviceSecret} drops every entry for an account, and the erase
 *   calls it — a deliberate sign-out leaves the next user of this device
 *   nothing to read.
 * - Anything untouched for {@link SECRET_MAX_AGE_MS} is swept on the next mint,
 *   whoever it belongs to. That is what covers the sign-out that never
 *   happened: a session the server expired, or a browser simply closed, leaves
 *   entries nothing else would ever remove. The age is the store's own
 *   thirty days, so an entry dies on the same schedule as the document it
 *   names — the bound this comment used to assert without any code behind it.
 */
const DEVICE_SECRET_PREFIX = "wafflebase-durable-device";

/** How long an untouched salt is kept, matching the store's own sweep. */
const SECRET_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How stale an entry may get before an open rewrites its timestamp.
 *
 * A read per document mount would otherwise write on every navigation for no
 * benefit: the only question the timestamp answers is "has this device used
 * this document in the last thirty days".
 */
const SECRET_TOUCH_MS = 24 * 60 * 60 * 1000;

/** The `localStorage` key holding one account's salt for one document. */
function deviceSecretKey(userId: string, docKey: string): string {
  return `${DEVICE_SECRET_PREFIX}:${userId}:${docKey}`;
}

/** What an account's entries all start with, for the erase and the sweep. */
function deviceSecretPrefixFor(userId: string): string {
  return `${DEVICE_SECRET_PREFIX}:${userId}:`;
}

/** The stored shape: the salt, and when it was last used. */
interface StoredSecret {
  s: string;
  t: number;
}

/**
 * Reads a stored entry, or `undefined` for anything that is not one.
 *
 * "Anything that is not one" deliberately includes the bare string earlier
 * builds wrote under `…:{userId}`: it is an account-wide salt this version no
 * longer uses, and treating it as unreadable is what gets it swept.
 */
function parseSecret(raw: string | null): StoredSecret | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const { s, t } = parsed as { s?: unknown; t?: unknown };
      if (typeof s === "string" && s.length > 0 && typeof t === "number") {
        return { s, t: Number.isFinite(t) ? t : 0 };
      }
    }
  } catch {
    // Not our shape. Left to the sweep.
  }
  return undefined;
}

/** Every `localStorage` key this module owns. */
function storedSecretKeys(): Array<string> {
  const keys: Array<string> = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(DEVICE_SECRET_PREFIX)) {
      keys.push(key);
    }
  }
  return keys;
}

/**
 * Drops entries nothing has used for {@link SECRET_MAX_AGE_MS}, and entries in
 * a shape this version does not write.
 *
 * Across every account, like the store's own sweep and for the same reason: the
 * account that never signs back in on a shared device is precisely the one
 * whose entries no erase will ever reach. Age is the whole policy, applied
 * identically to everyone, so nothing goes here that its owner's own next
 * session would have kept — a device in daily use rewrites its timestamps.
 */
function sweepStaleSecrets(now: number): void {
  try {
    for (const key of storedSecretKeys()) {
      const entry = parseSecret(localStorage.getItem(key));
      if (!entry || now - entry.t >= SECRET_MAX_AGE_MS) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // Storage refused. Nothing stored means nothing to sweep.
  }
}

/** This session's salts, for a browser that will not hold them. */
const volatileSecrets = new Map<string, string>();

/**
 * How the in-memory map is keyed: account first, so the erase can drop one
 * account's slots by prefix without touching another's. The separator is one a
 * user id and a document key cannot contain.
 */
function volatileSlot(userId: string, docKey: string): string {
  return `${userId}\u0000${docKey}`;
}

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
 * A stable random id for one account's copy of one document, minted once.
 *
 * Opaque and content-free: it is never sent anywhere except inside the client
 * key it salts, and it exists purely so that key cannot be *derived* by a
 * workspace peer who knows who you are and what you are editing.
 *
 * Touched on read, which is what keeps the sweep above honest in both
 * directions: a document this device actually opens never expires out from
 * under its own stored entry, and one it stops opening is gone in thirty days.
 */
function deviceSecret(userId: string, docKey: string): string {
  const key = deviceSecretKey(userId, docKey);
  const now = Date.now();
  try {
    const stored = parseSecret(localStorage.getItem(key));
    if (stored && now - stored.t < SECRET_MAX_AGE_MS) {
      if (now - stored.t >= SECRET_TOUCH_MS) {
        localStorage.setItem(key, JSON.stringify({ s: stored.s, t: now }));
      }
      return stored.s;
    }
    // On the way to minting, and only then: the sweep costs a full scan of the
    // origin's keys, and the mint is already the rare path.
    sweepStaleSecrets(now);
    const minted = randomSecret();
    localStorage.setItem(key, JSON.stringify({ s: minted, t: now }));
    return minted;
  } catch {
    // Storage refused (private mode, blocked third-party storage). A key that
    // does not survive a reload costs this device its resume; a guessable one
    // would cost every device its client row — so an unguessable
    // session-scoped secret is the right way to fail here.
    const slot = volatileSlot(userId, docKey);
    let secret = volatileSecrets.get(slot);
    if (!secret) {
      secret = randomSecret();
      volatileSecrets.set(slot, secret);
    }
    return secret;
  }
}

/**
 * Drops every salt this device holds for one account, so nothing left here can
 * be tied back to it — and so their next sign-in mints fresh ones.
 *
 * Called by the erase (`offline-erase.ts`), which is the moment this account's
 * stored documents go: keeping the salts that named them would leave the one
 * ingredient a later user of the machine cannot otherwise obtain.
 *
 * It is the *deliberate* half of the bound. A sign-out that never happens — an
 * expired session, a closed browser — is covered by {@link sweepStaleSecrets}
 * instead, which is why that one reaches across accounts.
 */
export function forgetDeviceSecret(userId: string): void {
  const slot = volatileSlot(userId, "");
  for (const key of [...volatileSecrets.keys()]) {
    if (key.startsWith(slot)) {
      volatileSecrets.delete(key);
    }
  }
  try {
    const prefix = deviceSecretPrefixFor(userId);
    // The account-wide entry earlier builds wrote goes too: it is this
    // account's, it is the shape the salt no longer takes, and leaving it
    // behind would be the erase missing the very thing it is here to spend.
    const legacy = `${DEVICE_SECRET_PREFIX}:${userId}`;
    for (const key of storedSecretKeys()) {
      if (key === legacy || key.startsWith(prefix)) {
        localStorage.removeItem(key);
      }
    }
    // And anybody's that has aged out, since this is a moment we are already
    // paying for the scan.
    sweepStaleSecrets(Date.now());
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
