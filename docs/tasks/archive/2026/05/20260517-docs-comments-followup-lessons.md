# Docs Comments Follow-up — Lessons

Captured while clearing the integration-test gate (todo items #17, #21).

## The node entry is a separate public surface — keep it in sync

`@wafflebase/docs` ships two entries: the browser entry (`src/index.ts`)
and a DOM-free node entry (`src/node.ts`, exposed via the package
`exports` `node` condition). Anything imported by a module that runs
under Node — here `YorkieDocStore`, exercised by the docs-comments
`.integration.ts` suite — must be re-exported from **both**. The block
edit helpers (`applyDeleteText`, `applyInsertText`, …) were only in
`index.ts`, so every `.integration.ts` file (they share one gate) failed
at module load with "does not provide an export named 'applyDeleteText'".

**Apply:** When a frontend module that a node-resolved test imports adds
an `@wafflebase/docs` symbol, check whether `src/node.ts` re-exports it.
Safe to add only if the source module is DOM-free — `block-helpers.ts`
imports nothing but `model/types.js`, so it qualified. Rebuild the
package (`pnpm --filter @wafflebase/docs build`) before re-running tests;
the frontend resolves the built `dist/node.js`, not source.

## Integration tests catch CRDT bugs unit tests structurally can't

The concurrent-add scenario failed (`expected 2, actual 1`) because
`root.comments` was lazily created on first write
(`if (!root.comments) root.comments = {}`). Two replicas creating the
container concurrently is a same-key object assignment, which Yorkie
resolves by LWW — one container wins, the loser's whole map (and its
thread) is dropped. `MemCommentStore` unit tests use plain JS objects
with no replica divergence, so they can never surface this; only a
two-replica live-Yorkie test can.

**Apply:** Any Yorkie object-typed container (a JSON map keyed by id)
must be created **once at document bootstrap** (`initialDocsRoot`,
alongside the `content` Tree), not lazily on first write. Lazy creation
is only safe for a never-concurrent first write.

**Confirmed identical bug in sheets and fixed in the same branch.**
`yorkie-worksheet-comments.ts:4` had the same lazy `ensureComments`
guard, and `createWorksheet()` seeded every other map container
(`merges`, `charts`, `images`) but not `comments`. The existing
`comments-concurrency.test.ts` scenario 1 — which had never actually run
against Yorkie because it is gated on `YORKIE_RPC_ADDR` and lives under
the unit-test glob — reproduced the exact failure (3/4 pass). Adding
`comments: {}` to `createWorksheet()` fixed it; no test-helper change
needed because the sheets two-user helper already attaches with
`initialRoot: initialSpreadsheetDocument()`, routing through the real
factory.

**Watch-out:** a yorkie-gated test placed under `tests/**/*.test.ts`
(not `*.integration.ts`) silently SKIPs in `verify:fast`/CI unit lanes,
so it can rot. The sheets concurrency test had been green-by-skip the
whole time. Prefer the `.integration.ts` suffix for anything requiring a
live server so it runs in the integration lane.

## Make the test bootstrap mirror production, not a shortcut

The two-user helper bootstraps a doc by hand (attach + `setDocument`),
bypassing `initialDocsRoot()`. To validate the real convergence path the
helper had to seed `comments: {}` before client B attaches — exactly
what production now does. A fix that only touched the helper would pass
the test for the wrong reason; a fix that only touched
`initialDocsRoot()` wouldn't be exercised by the helper. Both move
together.

**Apply:** When a test helper hand-rolls document creation, keep its
bootstrap in lockstep with the production `initialRoot`. Diverging gives
false confidence in either direction.

## The frontend `.integration.ts` lane is NOT in CI — it rots silently

`verify:integration` (and the CI `verify-integration` job) only runs
`pnpm backend test:e2e`. The frontend `tests/**/*.integration.ts` files
run only via the manual `pnpm frontend test:integration` with
`YORKIE_RPC_ADDR` set. With no automated signal, they accumulated rot:
the docs node-entry gate, a stale cross-sheet helper path + stale
`addRangeStyle` API, brittle slides comparisons, and several real
convergence bugs — all invisible until run by hand.

**Apply:** After touching anything these tests cover, run
`docker compose up -d` then `YORKIE_RPC_ADDR=http://localhost:8080 pnpm
--filter @wafflebase/frontend test:integration`.

**Fixed in this branch:** the lane is now wired into CI —
`verify-integration.mjs` runs `frontend test:integration` whenever
`YORKIE_RPC_ADDR` is set (the CI `verify-integration` job exports it and
starts Yorkie), and the job builds `@wafflebase/sheets` alongside
docs/slides since the lane resolves those to `dist/`. Two gotchas:
(1) keep the spawn behind a `YORKIE_RPC_ADDR` check so local backend-only
`verify:integration` doesn't need the built dists; (2) skip — don't
delete — known-failing tests (`it(..., { skip: REASON }, …)`) so a real,
diagnosed bug stays visible instead of blocking the newly-green lane.

## Node-entry drift is a recurring, multi-package trap

Both `@wafflebase/docs` and `@wafflebase/slides` ship a DOM-free
`node.ts` separate from the browser `index.ts`. Frontend stores
(`YorkieDocStore`, `YorkieSlidesStore`) import value symbols that exist
in `index.ts` but were never added to `node.ts`; under Node resolution
the import fails at module load (`does not provide an export named …`).
Slides was missing ~17 (group-transform math, layout helpers,
`migrateDocument`, `seedPlaceholderBlocks`, `DEFAULT_MASTER`, connector
geometry).

**Apply:** When a Node-resolved consumer imports a new symbol from a
package that has a `./node` entry, add it to `node.ts` too — but only
after confirming the source module is DOM-free (check its transitive
imports for `document.`/`window.`/`canvas`/`getContext`). Folder
location lies: `view/canvas/connector-frame.ts` is pure geometry and
node-safe despite the path.

## Comparing CRDT snapshots by `JSON.stringify` is order-brittle

`assert.deepEqual(JSON.stringify(a), JSON.stringify(b))` fails on
*converged* peers because Yorkie moves an object key to the end of its
insertion order when its value is updated, so two replicas with
identical values serialize to different strings. The slides group tests
failed purely on key order (values matched exactly).

**Apply:** Compare the parsed objects, not their JSON strings —
`assert.deepEqual(a, b)` is key-order-insensitive. Round-trip through
`JSON.parse(JSON.stringify(x))` first if the values are CRDT proxies.

## Reordering a Yorkie array by remove + re-insert loses concurrent edits

Slides `moveSlide`/`moveSlides` reorder by `rebuildSlide()` (a deep-copy
snapshot) then `splice` out + `splice` in. A concurrent peer editing a
child of the moved slide loses the edit: the original element's CRDT
nodes are deleted and replaced by a pre-edit snapshot, so the remote
update merges onto tombstones. Same class as "split a paragraph by
copying its text" — structural moves must preserve node identity.

**Apply:** Reorder Yorkie array elements in place with the SDK move
primitives (`moveAfterByIndex(prevIndex, targetIndex)`,
`moveAfter`/`moveBefore`/`moveFront` by `TimeTicket`). The proxy exposes
these inside `doc.update`. Never splice-out-and-reinsert a rebuilt copy
when concurrent child edits are possible. `slides.md` §"Key semantics"
already *mandated* `Yorkie.Array.move`; the impl had silently drifted to
rebuild+splice — so the fix restored design conformance, it didn't
invent a new approach. `moveAfterByIndex(prevIndex, targetIndex)` throws
on `prevIndex < 0`, so the move-to-front case needs `moveFront(id)`; map
the desired final index to MemStore's remove-then-insert math
(`clamped > from` → `moveAfterByIndex(clamped, from)`; `0 < clamped <
from` → `moveAfterByIndex(clamped - 1, from)`; `clamped === 0` →
`moveFront`). The same rebuild-on-move pattern still lurks in slides
element reorder — fix when a test demands it.
