# WafflebaseDocStore (W2)

**Created**: 2026-09-17

The IndexedDB `DocStore` the offline feature writes through. Second of five
wafflebase PRs, and like W1 it changes no behavior: the store is a pure
addition that nothing constructs yet.

Design: [`docs/design/offline-local-persistence.md`](../../design/offline-local-persistence.md)
§ Storage: `WafflebaseDocStore`.

## What the SDK gives us, checked rather than assumed

`@yorkie-js/sdk@0.7.22` is on `main` as of #1071. Three facts about it shape
this plan, and all three were verified against the **published tarball**, not
the SDK's source tree:

| | |
|---|---|
| `DocStore`, `StoredDoc`, `StoredChange`, `MemoryDocStore` | exported — `MemoryDocStore` is a real class we can instantiate in tests |
| `testDocStoreContract` | **not published.** `files: ["dist", "README.md"]`, and the contract suite lives under `test/` |
| An IndexedDB reference implementation | **not published either** — it exists upstream as a fixture, so this store is written here, not extended from there |

The second one matters, because W1's lessons said to run the SDK's contract
suite rather than write our own and it turns out we cannot import it. See
"How the contract gets tested" below for what replaces that.

## There is no migration

The design's migration paragraph assumes a store entry already exists — "a
store entry written by the current SDK is a `toBytes()` envelope". That
describes a deployment that already passes `ClientOptions.store`. **This one
never has**: no `store:` reaches any `YorkieProvider` or `new Client(...)` in
`packages/frontend/src`, and `sync-status.md` says so outright. Nothing has
ever written to IndexedDB from wafflebase.

So the `onupgradeneeded` relocation the design describes would be dead code
against data that does not exist, and dead code in a recovery path is worse
than none — it is untestable against anything real. **We open at version 1 and
create the object stores.** Versioning still ships from the first release for
the reason the design gives (a deploy revert must find nothing rather than
something corrupt), it just has nothing to convert.

## Scope

In:

- [x] `lib/wafflebase-doc-store.ts` — `DocStore` over IndexedDB, gzip-compressed
- [x] Cleanup: `dropAllForUser`, `dropDocument`, `collectStale`, quota eviction
- [x] `remove()` archives before deleting, so W5 can return the work
- [x] The contract suite, run against both this store and `MemoryDocStore`
- [x] `fake-indexeddb` as a devDependency — jsdom has no IndexedDB

Out:

- Constructing it, or passing it to any client — W3/W4. Nothing imports this
  module at the end of this PR except its own test.
- The Settings toggle (W4, see the W1 task doc), the chip, offline-copy
  recovery (W5)

## How the contract gets tested

The W1 lessons said: run the SDK's `testDocStoreContract` against our store
rather than hand-writing a suite, because the SDK shipped two implementations
with duplicated suites and they disagreed on two rules before anyone noticed.
The suite is not published, so that is not directly possible. Copying it here
reproduces exactly the drift it warns about — two copies of one contract, and
ours silently aging.

What closes that loop instead: **run the copied suite against
`MemoryDocStore` too**, in the same file, from the same `@yorkie-js/sdk`
version this repo depends on.

```ts
describe.each([
  ["MemoryDocStore", () => new MemoryDocStore()],
  ["WafflebaseDocStore", () => new WafflebaseDocStore(...)],
])("DocStore contract: %s", (_name, factory) => { /* shared cases */ });
```

A copy that drifts from the upstream contract now fails against the upstream
implementation, in CI, on the next SDK bump — which is the signal the SDK
itself was missing. It is not as good as importing the real suite; it is a
detector rather than a single source. The real fix is upstream: a
`@yorkie-js/sdk/testing` subpath export. Worth opening once this lands, and
noted here so it is a deferred decision rather than a forgotten one.

## Task 1: the contract suite and a store that fails it

**Files:** created as
`packages/frontend/src/lib/doc-store-contract.ts` (**not** `-contract.test.ts`
as planned: the cases are a parameterized `testDocStoreContract()` two suites
call, and a `*.test.ts` file with no `describe` of its own at import time is a
failure in this runner), plus
`packages/frontend/src/lib/wafflebase-doc-store.test.ts` which invokes it, and
`packages/frontend/src/lib/wafflebase-doc-store.ts`

- [x] **1.1** Add `fake-indexeddb` to `packages/frontend` devDependencies and
      import `fake-indexeddb/auto` from the test file. jsdom provides no
      IndexedDB at all, so without it every case errors rather than fails.
- [x] **1.2** Write the contract cases, transcribed from the SDK's
      `test/unit/client/doc_store_contract.ts` at the 0.7.22 tag, with a header
      naming that path and tag. The rules it asserts:

  - `load` on an unknown key resolves `undefined`
  - `saveSnapshot` drops the change log **and** the meta header
  - `appendChange` upserts by `clientSeq` — appending the same `clientSeq`
    twice leaves one entry, the later one
  - `appendChange` on a key with no snapshot is a silent success (the SDK
    repairs it on the next edit; a throw here would break that path)
  - `saveMeta` replaces the header and **never** trims the log
  - `remove` makes `load` resolve `undefined`
  - changes come back ordered by `clientSeq`, whatever order they went in

- [x] **1.3** Run both parameterizations. `MemoryDocStore` passes (it is the
      reference); `WafflebaseDocStore` fails on import — the module does not
      exist. That asymmetry is the point: it proves the suite is a real
      contract and not a restatement of whatever we are about to write.
- [x] **1.4** Implement `WafflebaseDocStore`:

  - One database, one entry per SDK-supplied scoped key
    (`apiKey/clientKey/docKey` — already identity-scoped, so a shared device
    cannot hand one account another's envelope)
  - Object stores: `snapshots` (snapshot bytes + `meta` + `updatedAt` +
    `userId`), `changes` (keyed `[docKey, clientSeq]` so the upsert is the
    natural `put` and ordering is the natural index)
  - gzip through `CompressionStream('gzip')` on the way in,
    `DecompressionStream` on the way out. A browser built-in, so no dependency,
    and the SDK stays out of it because `DocStore` takes opaque bytes.

- [x] **1.5** Run the suite. Both parameterizations pass.
- [x] **1.6** Verify the suite bites: break one rule in the implementation
      (make `saveSnapshot` keep the log) and confirm the matching case fails
      for `WafflebaseDocStore` and still passes for `MemoryDocStore`. Restore.
- [x] **1.7** `pnpm verify:fast`
- [x] **1.8** Commit: `Store offline documents in a compressed IndexedDB store`

## Task 2: cleanup, which is entirely ours

**Files:** `packages/frontend/src/lib/wafflebase-doc-store.ts`,
`packages/frontend/src/lib/wafflebase-doc-store.test.ts`

The SDK calls `remove` on its three unrecoverable paths **and on every ordinary
detach** — `detachDocument` calls `removeFromStore` unconditionally on its
success path, which was checked against the shipped bundle only after a review
asked. So a cleanly closed document cleans up after itself, the archive has to
be gated on a latched `LocalChangesDropped`, and everything that never detached
is still ours to collect.

| Trigger | Action |
|---------|--------|
| Logout | Drop every entry for that user |
| Document deleted, or workspace access lost | Drop that entry |
| Periodic | Drop entries untouched for 30 days (`updatedAt` beside the envelope) |
| `QuotaExceededError` | Evict oldest-first, retry once, then report undurable |

- [x] **2.1** Write the failing tests, one per row. The quota case is the one
      worth care: assert that a write which first throws `QuotaExceededError`
      and then succeeds leaves the *newest* entry stored and an older one gone
      — not merely that eviction was attempted.
- [x] **2.2** Run them. Expect failure.
- [x] **2.3** Implement. Eviction orders by `updatedAt`, and the retry happens
      once: a store that never accepts a write must report undurable rather
      than loop.
- [x] **2.4** Run. Expect pass.
- [x] **2.5** `pnpm verify:fast`
- [x] **2.6** Commit: `Collect offline entries the SDK will never collect`

## Task 3: archive on remove, so W5 has something to return

**Files:** `packages/frontend/src/lib/wafflebase-doc-store.ts`, its test

`remove()` is called on exactly the paths where the SDK has decided local work
cannot be reconciled. Deleting there is what loses the work W5 exists to give
back, so the archive has to be written by this PR even though nothing reads it
until W5.

- [x] **3.1** Write the failing test: after `remove(key)`, `load(key)` is
      `undefined` **and** the archived bytes are retrievable by a separate
      call, with the doc key and a timestamp.
- [x] **3.2** Run it. Expect failure.
- [x] **3.3** Implement: copy the snapshot (and log) into an `archives` store
      inside the same transaction as the delete, so a crash between them cannot
      lose the only copy.
- [x] **3.4** Run. Expect pass.
- [x] **3.5** Confirm archives are subject to the same 30-day collection as
      live entries — an unbounded archive store is a quota leak that looks
      like a feature.
- [x] **3.6** `pnpm verify:fast`
- [x] **3.7** Commit: `Archive an entry before removing it, for offline copies`

## Verification

- [x] `pnpm verify:fast` green, `pnpm verify:self` green (pre-push), CI green
- [ ] ~~Nothing imports `wafflebase-doc-store` outside its own tests~~ —
      true when this PR was written and **no longer true**: W3–W5 landed on the
      same branch, so the provider, the runtime and the erase paths all
      construct it. Kept rather than deleted because the claim is what the
      original scope promised, and a reader comparing the two should see that
      it moved rather than that it held
- [x] Every contract case passes against `MemoryDocStore` as well, from the
      `@yorkie-js/sdk` version in `package.json`
- [x] At least one test asserts on a whole round-tripped document rather than a
      field, and at least one uses a *relative* edit — W1's lessons file
      records why absolute `set`s hid a data-loss bug through two SDK review
      passes

## Review

Landed on the `w1/offline-opt-in` branch together with W3–W5 rather than as
its own PR, which is why every box above is checked while the branch was still
open. What the review round asked for, and what changed in this file's code:

- **Eviction was not scoped to the user.** `evictOldest` walked the `updatedAt`
  index over every header row in the origin database, so on a shared device one
  account's edit could free space by deleting another's unsent work. Now
  intersected with the `userId` index, keys on both sides so the scoping still
  materializes no snapshot.
- **`remove()` was not atomic, and spent its loss latch too early.** It issued
  the archive `put` and three deletes outside `atomically`, so a throw between
  them committed the deletes alone — destroying the only copy of work the SDK
  had already given up on — and it consumed `expectedLosses` *before* the
  commit, so a retried removal deleted outright. Both fixed; three cases in
  `wafflebase-doc-store-atomicity.test.ts` cover them.
- **`purgeDocument`** was added for the cleanup table's "document deleted or
  access lost" row, matching on the type-prefixed document key inside the SDK's
  scoped key. Archives are deliberately spared: "deleted upstream" is one of the
  three paths that produce an archive in the first place.
