# Yorkie 0.7.20 bump

Move `@yorkie-js/sdk` and `@yorkie-js/react` from 0.7.19 to 0.7.20 across
the four pins that carry them (backend, notes, and frontend twice — sdk and
react). Scope is the bump alone: nothing in this task adopts the
offline-persistence API the release introduces.

## Why

0.7.20 (2026-09-09) carries two SDK changes and one server change:

| Where | Change |
| --- | --- |
| SDK #1338 | Offline local persistence — `ClientOptions.store` (`DocStore` + `MemoryDocStore`), `Document.toBytes()`/`fromBytes()`, a `LocalChangesDropped` event, a Web Locks single-active-session guard, and `deactivateOnUnload` auto-defaulting to `false` when `store` is set |
| SDK #1337 | Attaching the same document key twice on one client now throws `ErrAlreadyAttached` **synchronously**, instead of failing in a way that could kill the whole client session |
| server | Server-side offline-resumable attach (stable actor, resume, epoch); watch subscriptions keyed by the client's stable actor; a project-stats HLL rollup fix |

**#1337 is the reason to bump now.** `main.tsx` mounts the app in
`StrictMode` and every document route mounts a `DocumentProvider` whose
cleanup detaches asynchronously, so an unmount immediately followed by a
remount leaves a window where the same docKey is attached twice on the one
provider-level client. The old failure mode for that took the client down
with it — every other attached document included. The new one is a
catchable, non-fatal rejection.

**#1338 changes nothing here.** Persistence is opt-in via `ClientOptions.store`
and we pass no `store`, so non-store clients keep today's behavior. Adopting
it is a separate, larger task — it needs a stable `clientKey` (we pass none,
so the SDK generates a random one per client and nothing would ever resume),
and stabilizing that key activates the single-active-session guard, which
fails the second tab's attach on a document already open in another tab. That
is a product decision, not a dependency bump. See the review section below.

The server change needs no action from us: `docker-compose.yaml` and CI both
run `yorkieteam/yorkie:latest`.

## Plan

- [x] Bump `@yorkie-js/sdk` 0.7.19 → 0.7.20 in `packages/backend`,
      `packages/frontend`, `packages/notes`
- [x] Bump `@yorkie-js/react` 0.7.19 → 0.7.20 in `packages/frontend`
- [x] `pnpm install`; confirm the lockfile resolves a single SDK version
      (`@yorkie-js/react` bundles its own SDK copy — the realm-split trap in
      `packages/frontend/src/types/notes-document.ts` — so the two must move
      together)
- [x] Grep for stale `0.7.19` prose that the bump makes wrong. Do **not**
      rewrite the historical notes: `0.7.19` is load-bearing in
      `docs/design/revision-history.md` and the history adapters as the
      version that *fixed* `YSON.parse`, and those sentences stay true.
- [x] `pnpm verify:fast`
- [x] `pnpm verify:self`
- [x] Yorkie-attached integration suites against a live server
      (`RUN_DB_INTEGRATION_TESTS=true RUN_YORKIE_INTEGRATION_TESTS=true`)
- [x] Smoke the two properties that matter, against a live 0.7.20 server —
      done headlessly rather than by clicking, see Verification below
- [x] Self review over the branch diff
- [x] PR — #1055

## Added after the browser smoke: the #1004 "Anonymous" fix

The browser pass found that [#1004](https://github.com/wafflebase/wafflebase/issues/1004)
still reproduces on 0.7.20 — one bounce of documents-list → note → back → note
strands the header on a single `AN` / "Anonymous (You)" avatar. Instrumenting
the live client showed the chain #1004 documents is **not** what fires: the
client stays active, the document is `attached`, both attaches succeed, and
there are no console errors.

The real cause, reduced against a live server:

```
same client, re-attach immediately   1st=[4 keys]  2nd=[EMPTY]   <-- Anonymous
same client, re-attach after 1.5s    1st=[4 keys]  2nd=[EMPTY]   <-- Anonymous
DIFFERENT client (= page reload)     1st=[4 keys]  2nd=[username,email,…]  OK
```

`client.attach(doc, { initialPresence })` applies the presence locally *before*
the attach RPC (`doc.update((_, p) => p.set(opts.initialPresence || {}))`), and
reconciling the response leaves that actor's entry `{}` — the actor id is
reused across attach/detach, so unlike a first attach there is an entry to
clobber. **Measured identically on 0.7.19 and 0.7.20**, so it is pre-existing
and unrelated to the bump; a reload appears to fix it only because it mints a
new client.

Fixed in this PR at the two layers that do not need upstream:

- **`CollabDocumentProvider`** (`src/components/collab-document-provider.tsx`) —
  wraps `DocumentProvider` and, once attached, re-asserts only the
  `initialPresence` keys that are **missing**. Restricting it to absent keys is
  what makes it safe alongside `SlidesView`'s `broadcast()` and `BoardView`'s
  selection listener, both of which document the assumption that identity
  fields "are seeded once by `initialPresence` and stay intact". A healthy
  attach performs no CRDT write at all. Adopted at all 9 provider call sites,
  so a new document type inherits it instead of having to remember it.
- **`user-presence.tsx`** — stop substituting `"Anonymous"` for an empty
  username. That substitution also made the existing `username.length > 0`
  filter dead code. Genuinely anonymous share-link visitors are unaffected:
  `shared-document.tsx:975` puts the literal string in their presence.

The upstream fix (apply `initialPresence` after reconciling the attach
response) and #1004's original orphan (the binding's `client.has(docKey)`
cleanup guard, unchanged in 0.7.20) both remain open; posted to the issue.

## Not in scope

- **Offline persistence.** `docs/design/sync-status.md` names it a Non-Goal
  on the premise that "the Yorkie JS SDK persists nothing locally". 0.7.20
  makes that premise false, so the doc's Non-Goal needs rewriting — but
  behind a design pass, not this bump.
- **The open upstream revision-history asks.** `CreateRevision` is still
  called with `attributes: null`, so registering it on the auth webhook
  still denies everyone (`docs/design/revision-history.md` §6 ask 1). Asks 2
  (revision author) and 3 (retention/delete RPC) and the
  `ListRevisionsByAdmin` panic under API-Key auth are likewise untouched by
  0.7.20.

## Review

**One thing was not free: the bundle.** `verify:fast` is green on the bump
alone, but `verify:self` failed the frontend chunk gate — `vendor-yorkie` is
782.51 kB against its 780 kB targeted cap. Measured before/after on this tree
(build `main`'s deps, then the branch's), 767.43 kB → **782.51 kB, +15.08 kB**,
which is 0.7.20's offline-persistence layer: the `DocStore`/`MemoryDocStore`
backend, `toBytes()`/`fromBytes()` envelope serialization, the Web Locks guard,
and the `LocalChangesDropped` path. We pay for it without using it — the SDK
ships one bundle and the code is not separable behind the `store` option.
Cap raised 780 → 800 kB with that measurement recorded in
`harness.config.json`, following the convention the neighbouring entries set:
a targeted cap slightly above the measured size, rather than loosening the
global per-chunk budget for unrelated chunks.

**Doc corrections the bump forced.** `sync-status.md` asserted "the Yorkie JS
SDK persists nothing locally" in the present tense, twice (its Summary and the
`docs/design/README.md` index line), as the justification for adopting only
Google Docs' warning half. 0.7.20 makes the bare claim false. Both now say the
SDK persists nothing *unless asked to* and that we do not ask — which keeps the
design's conclusion intact for the right reason — and the Non-Goal spells out
the two things adoption actually costs (a stable `clientKey`, and the second
tab). The historical `0.7.19` references in `revision-history.md` and the
history snapshot adapters were deliberately left alone: they record which
version fixed `YSON.parse`, and that stays true.

### Verification

| Gate | Result |
| --- | --- |
| `pnpm verify:fast` | pass (exit 0) |
| `pnpm verify:self` | pass after the chunk-cap fix; failed before it on `verify:frontend:chunks` |
| Backend e2e incl. Yorkie-attached suites (`RUN_DB_INTEGRATION_TESTS=true RUN_YORKIE_INTEGRATION_TESTS=true`) | 17 suites, 109 passed / 19 skipped — `revision-history`, `docs-tree-attached`, `docs-cli-roundtrip` all pass |
| Yorkie server | pulled `yorkieteam/yorkie:latest` to 0.7.20 first, so the attached suites ran client 0.7.20 against server 0.7.20 |

The 19 skips are the pre-existing gated cases (notably
`revision-history.e2e-spec.ts`'s `refuses a read-only client`, which needs the
`yorkie` admin CLI on `PATH`), not anything this bump disabled.

**The UI smoke was done headlessly, and why.** `pnpm dev` came up, but every
document route is behind GitHub OAuth and completing that sign-in is not
something the agent doing this work can do. Rather than skip the check, the
two properties the click-through was for were asserted directly against two
real 0.7.20 clients and the live 0.7.20 server (throwaway script, not
committed — it asserts behavior of a dependency, which is upstream's suite to
own, not a fixture for ours):

| Property | Result |
| --- | --- |
| The sync-status chip's actual condition — `lastEditSeq <= checkpoint.getClientSeq()`, read the same way `use-sync-status.ts` reads it, off `local-change`'s `event.value.clientSeq` | pass — editSeq 3, checkpoint 1 → 3 |
| Presence both ways across two clients (0.7.20 keys watch subscriptions by the client's stable actor, which is what peer avatars ride on) | pass — each client saw the other |
| Remote content propagation A → B | pass |
| #1337 itself: a second attach of the same key on one client | pass — rejects with "…is already attached", and `clientA.isActive()` is still true afterwards, which is the whole point of the fix |

That last row is worth stating plainly: the reason for this bump is now
verified against the real server rather than taken from the release notes.

An interactive pass over the chip's *rendering* (the four visual states, the
toast, the `beforeunload` prompt) is still unverified here and would need a
signed-in browser. Nothing in this bump touches that component's code, and its
input signal is asserted above.
