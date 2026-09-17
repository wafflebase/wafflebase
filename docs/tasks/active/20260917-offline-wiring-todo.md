# Offline Persistence Wiring (W3–W5)

**Created**: 2026-09-17

The rest of offline local persistence: electing a durable tab, the client that
carries the stable key, the chip that reports it, erasing on opt-out, and
handing back work that could not be reconciled.

Design: [`docs/design/offline-local-persistence.md`](../../design/offline-local-persistence.md).
Storage layer: [`20260917-wafflebase-doc-store-todo.md`](20260917-wafflebase-doc-store-todo.md).

## The blocker found at the start, and what it changed

The design has the durable path mount a nested `YorkieProvider` with
`key = wb:{userId}:{docKey}`. **That is not expressible.** `YorkieProviderProps`
is `ClientOptions`, whose client key is spelled `key` — and React reserves that
name, stripping it at element creation as a JSX attribute and through a spread
alike. Proven rather than assumed:

```
render(<Probe key="wb:u1:note-7" apiKey="pk" rpcAddr="http://x" />);
render(<Probe {...{ key: "wb:u1:note-7", apiKey: "pk" }} />);
// PROPS SEEN: [{"apiKey":"pk","rpcAddr":"http://x"}, {"apiKey":"pk"}]
```

So a provider-mounted client could never be given an explicit key at all, and
without one the store is keyed by a random per-session client key and resumes
nothing. The design's own "Trap" note anticipated a *remount* problem and missed
this one.

Fixed upstream: **yorkie-js-sdk#1357** adds a `clientKey` prop mapped onto
`ClientOptions.key`, omits `key` from the props type so the collision is visible
where props are written, and rebuilds the client when the key changes (memoizing
on `apiKey`/`rpcAddr` alone kept document A's client — and store scope — for
document B).

**Consequence for this plan:** the provider nesting is built and gated instead
of deferred. `vite.config.ts` injects the `@yorkie-js/react` pin as a build
constant and `yorkie-capabilities.ts` compares it, so the durable path engages
only from 0.7.23 — bumping the dependency is the whole switch, and until then
the feature is dark rather than absent.

## Task 1: electing one tab per document — done

**Files:** `lib/durable-session.ts`, `lib/durable-session.test.ts`

- [x] **1.1** `durableLockName` / `durableClientKey`, deliberately unlike the
      SDK's own `apiKey/clientKey/docKey` lock name so the two cannot collide
- [x] **1.2** `acquireDurableSession` — fail-fast, release-once (an effect
      cleanup runs twice in StrictMode, and a second release would free a name
      a *later* tab has taken)
- [x] **1.3** Fail closed without the Web Locks API. The SDK's own guard no-ops
      there, so nothing would stop a second tab, and a stable actor with no
      guard is the silent-edit-loss case. The cost is the feature being
      unavailable on insecure origins; the alternative is corrupted documents.
- [x] **1.4** `isOpenInAnyTab` over `navigator.locks.query()`, which is what
      lets the store refuse to evict or collect a document another tab holds.
      Answers "open" when it cannot tell.
- [x] **1.5** 13 tests

## Task 2: the policy that decides — done

**Files:** `lib/use-durable-document.ts`, `lib/use-durable-document.test.tsx`

Every arm is a refusal, because the durable path is *worse* than the
non-durable one when its precondition is missing, not merely unavailable.

- [x] **2.1** Off unless the preference is on, a user is signed in, the key is
      not `pdf-` prefixed, and this tab won the election
- [x] **2.2** No lock taken while the preference is off — holding the name
      without using it denies durability to a tab that could have had it
- [x] **2.3** Released on unmount, on navigation to another document, and when
      the preference is switched off mid-session
- [x] **2.4** `settled`, so a consumer does not mount a non-durable client on
      the first render and tear it down a moment later
- [x] **2.5** 10 tests; PDF exclusion, lock release and the not-while-disabled
      rule each verified by reverting them

## Task 3: the chip — done

**Files:** `components/sync-status/sync-state.ts`, `sync-status-chip.tsx`,
`tests/components/sync-status/sync-state.test.ts`

- [x] **3.1** `saved-locally` replaces `not-saved` exactly when the pending work
      is on disk — the entire user-facing value of the feature, and the only row
      that changes
- [x] **3.2** Covers a rejected push while connected, not only disconnection:
      that work is exactly as unsent, and exactly as safe
- [x] **3.3** `durable` defaults false, so every caller that passes nothing is
      unchanged
- [ ] **3.4** A typed reason for the tooltip wording. `DurabilityLapse` was
      written and then **removed** — nothing consumed it, and shipping a type
      no caller reads is the same dead weight as shipping dead code. It returns
      with the tooltip that needs it.
- [ ] **3.5** Wire `durable` from the provider into `use-sync-status.ts`.
      **Not done**, and it is the gap that matters most: that file still calls
      `deriveSyncState` without `durable`, so `saved-locally` — "the entire
      user-facing value of this feature", in the design's own words — cannot be
      reached from the app.

## Task 4: keeping the toggle's promise — done

**Files:** `lib/offline-erase.ts`, `lib/offline-erase.test.ts`

W1 shipped the words "turning this off deletes them" with nothing behind them,
because nothing was stored yet. They become a promise the moment the store is
wired.

- [x] **4.1** Scoped to the user, archives included, another account on the
      same device untouched
- [x] **4.2** Fires on the disabling edge only
- [x] **4.3** Reads store and user at fire time, not at setup — the watcher
      outlives a sign-out
- [x] **4.4** A failed erase leaves the preference off and logs
- [x] **4.5** 9 tests; the edge rule and the late-read rule verified by
      reverting them

## Task 5: the provider — done, behind a version gate

**Files:** `components/collab-document-provider.tsx`

- [x] **5.1** Nest a `YorkieProvider` when `durable`, with
      `clientKey={durableClientKey(...)}` and the store; render children
      unchanged otherwise, so declining the opt-in costs nobody an extra
      `ActivateClient`
- [x] **5.2** Construct `WafflebaseDocStore` with `isOpenInAnyTab` so eviction
      and collection can see other tabs
- [ ] **5.3** Publish `durable` for the chip, including a `PersistDisabled`
      latch and store write failures
- [x] **5.4** No route file changes: the PDF exclusion comes from the docKey
      prefix the provider already receives, and `shared-document.tsx` mounts
      its own provider so it is excluded structurally

## Task 6: handing the work back — partly done

**Files:** `lib/offline-copy.ts`, `lib/offline-copy.test.ts`

- [x] **6.1** `rehydrateArchive` — snapshot plus replayed log. Replaying is the
      point: the snapshot alone is the document as it stood *before* the unsent
      work, so replaying nothing hands back what was not lost.
- [x] **6.2** Idempotent `(offline copy)` title; document id rather than store
      key in the listing
- [x] **6.3** A corrupt archive answers `undefined` rather than throwing, so it
      costs one document and not the listing of every other
- [x] **6.4** 10 tests; log replay, title idempotence and the corruption guard
      each verified by reverting them
- [x] **6.5** Create the document and write the rehydrated root into it —
      needs a live client, so it belongs with Task 5

## Task 7: the documents — done

- [x] **7.1** `sync-status.md`: offline persistence and the toggle are no longer
      Non-Goals; the fifth chip state, and why "this tab is the only copy" is
      still exactly right for every document without the opt-in

## Verification

- [x] `pnpm verify:fast` green
- [x] The new modules typecheck under `tsconfig.app.json`
- [x] `pnpm verify:self` green (pre-push), all 32 lanes
- [ ] Manual smoke — needs the dependency bump, since nothing durable mounts
      until the gate opens

## What is written but not reachable

Recorded because a reader would otherwise assume the feature ships working.
Every module below is implemented and tested, and **has no production caller**:

| | |
|---|---|
| `setOfflinePersistenceEnabled` | the Settings section is still W1 Task 2 |
| `watchForOfflineDisable` | so "turning this off deletes them" is unimplemented |
| `collectStale` / `dropAllForUser` / `purge` | no sweep, no logout erase, no delete/access-loss cleanup |
| `listRecoverableWork` / `recoverOfflineCopy` | archives are never offered back |
| `durable` in `use-sync-status.ts` | so the chip cannot reach `saved-locally` |

W1's review set the rule this must satisfy before it is user-visible: *the
store, the section and the erase land together, or none of them do.* With the
version gate closed nothing writes either, so the branch is consistent — but
opening the gate without the rest would be exactly what that rule forbids.

> **Note on typechecking.** `pnpm --filter @wafflebase/frontend exec tsc
> --noEmit` checks **nothing**: the package's root `tsconfig.json` has
> `"files": []` with project references. Use `tsc -p tsconfig.app.json
> --noEmit` and filter — the frontend carries ~147 pre-existing errors, which
> is why `verify:fast` has no frontend typecheck lane.

## Review

_Filled in when the PR lands._
