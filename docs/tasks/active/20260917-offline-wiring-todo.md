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
- [x] **3.5** Wire `durable` from the provider into `use-sync-status.ts`.
      Done in the review round: the durable client publishes
      `{ store, durable, reportLoss }` through `lib/durable-document-context.ts`,
      `useSyncStatus` reads `useDocumentDurability()` and passes it, and the
      chip suite now covers the state, its politeness, and the deliberate
      absence of a toast and an unload guard.

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
- [x] **5.3** Publish `durable` for the chip. The value latches to `false` on
      `LocalChangesDropped` and never back: it stands for the chip's promise,
      not the client's existence, and over-reporting durability is the one
      direction this must not fail in. Store *write* failures still do not
      lower it — they are not observable from the provider — which is recorded
      as a known limitation rather than claimed.
- [x] **5.5** The loss watch moved **inside** the `DocumentProvider`. It reads
      `useDocument()`, and wrapping the durable provider's children put it
      above the context it needs, where it could only ever see no document —
      so the latch was never set and every unreconcilable removal would have
      deleted the work instead of archiving it. The suite's `useDocument` mock
      was global, which is exactly what hid it; it is now scoped to its
      provider.
- [x] **5.6** Share links are excluded by a `NonDurableScope` wrapper at the
      route, not by the nesting. `shared-document.tsx` mounts its own
      `YorkieProvider` *above* `CollabDocumentProvider` rather than instead of
      it, so 5.4's "excluded structurally" was false for a **signed-in**
      visitor: they would have got a durable client carrying their personal
      Yorkie token instead of the share token the auth webhook validates.
- [x] **5.7** Identity is asked with `fetchMeOptional`, never `fetchMe`. This
      component renders on the public `/shared/:token` route, and `fetchMe`
      goes through `fetchWithAuth`, whose 401 arm logs out and hard-redirects
      to `/login` — so the first version bounced every anonymous share-link
      visitor off the document they had been sent.
- [ ] ~~**5.4** No route file changes~~ — the PDF exclusion does come from the
      docKey prefix, but the share-link half of this claim was wrong; see 5.6.

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

## Task 8: the wiring, added in the review round

Every module below had been written, tested, and left without a caller. The
review's finding was that the branch shipped the risky half of PR 4 — a store
attached to a live client — without the half that makes it usable or
trustworthy. These close that.

**Files:** `components/offline-runtime.tsx` (new), `PrivateRoute.tsx`,
`app/settings/page.tsx`, `api/auth.ts`, `api/documents.ts`,
`lib/offline-erase.ts`, `lib/offline-copy-recovery.ts`

- [x] **8.1** The Settings opt-in: an "Offline" section beside Appearance and
      Dates, with the per-device wording and "turning it off deletes what was
      stored"
- [x] **8.2** `OfflineRuntime`, mounted once by `PrivateRoute` — the only place
      with both an identity and a lifetime longer than one document. It
      installs `watchForOfflineDisable`, runs `collectStale()` once per
      session, and offers back anything archived
- [x] **8.3** Logout erases: `rememberOfflineUser` records the identity while
      there is one, and `logout()` spends it. Runs whatever the preference now
      says — the preference governs new writes, not content already on the disk
      of a device that may be shared
- [x] **8.4** A deleted document drops its local copy, in `deleteDocument` and
      `deleteDocuments` (the latter only for ids the server reports deleted).
      Archives are spared on purpose
- [x] **8.5** Recovery is *offered*, not performed: a toast per archive with a
      "Save a copy" action, then a link to the new document. Creating documents
      unasked on a page load would fill the list with copies nobody chose, and
      a declined offer survives to the next session because the archive is
      dropped only after the content is written
- [x] **8.6** `describeArchivedDocument` reads the type off the archived key
      rather than fetching it — "the document was deleted upstream" is one of
      the three paths that produce an archive, so the server is exactly what
      may no longer be able to answer
- [x] **8.7** Tests for the doc / slides / board / note rebuild paths, which
      had only ever been exercised for `sheet`

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

## What was written but not reachable — now wired

Recorded because the first draft of this branch shipped every module below
implemented, tested, and with **no production caller**. W1's review had set the
rule: *the store, the section and the erase land together, or none of them do.*
The version gate being closed made the branch internally consistent, but
opening it without the rest would have been exactly what that rule forbids.
Task 8 closes each row.

| | Now called from |
|---|---|
| `setOfflinePersistenceEnabled` | the Settings "Offline" switch |
| `watchForOfflineDisable` | `OfflineRuntime`, mounted by `PrivateRoute` |
| `collectStale` | `OfflineRuntime`, once per session |
| `dropAllForUser` | `logout()`, via `eraseOfflineDataOnLogout` |
| `purgeDocument` | `deleteDocument` / `deleteDocuments` |
| `listRecoverableWork` / `recoverOfflineCopy` | `OfflineRuntime`'s recovery offer |
| `durable` in `use-sync-status.ts` | `useDocumentDurability()` |

What is still unreachable, and deliberately: the durable client itself, behind
`supportsClientKey()`. The pin is `@yorkie-js/react@0.7.22` and the gate opens
at 0.7.23, so nothing writes to IndexedDB on this branch — the wiring above is
what makes the dependency bump the whole switch, rather than the bump plus five
more pieces nobody has reviewed.

> **Note on typechecking.** `pnpm --filter @wafflebase/frontend exec tsc
> --noEmit` checks **nothing**: the package's root `tsconfig.json` has
> `"files": []` with project references. Use `tsc -p tsconfig.app.json
> --noEmit` and filter — the frontend carries ~147 pre-existing errors, which
> is why `verify:fast` has no frontend typecheck lane.

## Task 9: the review round after the wiring

Six of seven open findings held up; one was already answered by the wiring.

- [x] **9.1** Eviction spares an entry whose log is non-empty. It deletes
      outright — no archive — so the entry it was happiest to take was
      somebody's unsent work. A non-empty log now counts as unsent, which
      over-counts (an acked log that has not compacted is spared too) and is
      the direction the feature has to be wrong in. With nothing free, the
      write is refused and reported undurable.
- [x] **9.2** The held decision is keyed `{userId}:{docKey}`, not `docKey`.
      Another tab can sign this one out and somebody else in; on the document
      alone, the new person got the previous person's client key and store
      scope.
- [x] **9.3** The capability gate refuses comparator ranges. `<0.8.0` and
      `<=0.7.23` both parsed past the sign and answered *yes* while resolving
      to anything — 0.7.22 included.
- [x] **9.4** `unsupported-type` no longer stands in for "the archive was
      empty". The reachable case was a sheet with no tabs, told it was a kind
      of document that cannot be recovered.
- [x] **9.5** The chip's offer says it applies to documents opened later. The
      decision is latched per open, so clicking never saves the edits the
      toast is standing next to — and the old wording said it did.
- [x] **9.6** The sweep no longer takes `navigate` as a dependency. Under a
      declarative router its identity changes per navigation, re-running the
      whole effect — new handle, sweep, archive listing, a title fetch each —
      behind a toast id that hid the repetition.
- [x] **9.7** Answered rather than changed: the W1 lessons rule ("the store,
      the section and the erase land together") is what Task 8 satisfied.
- [x] **9.8** Two pre-existing flakes in the durable suite, found while
      re-running it: a latch case that fired its event before the subscription
      effect had run (~1 in 5), and a liveness case whose `collectStale(0)`
      compared against an entry written in the same millisecond (~1 in 8).
      Neither said anything about the code it named.

## Review

_Filled in when the PR lands._
