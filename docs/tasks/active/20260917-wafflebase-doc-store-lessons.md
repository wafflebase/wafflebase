# WafflebaseDocStore — Lessons (W2)

**Created**: 2026-09-17

## Carried in

**Tests that assert a proxy pass while the thing they protect breaks.** Five
review passes on the SDK half found thirteen critical defects with the unit
suite green, and a fourteenth was found after merge. Two causes recurred: a
test that re-stated production logic instead of calling it, and persistence
tests that mutated with an absolute `set` — which the last log entry
reconstructs whether or not the base survived, hiding a permanent data-loss bug
through two passes. Compare whole documents, and use at least one relative
operation.

**A test can pass on the state it was meant to prove gone.** W1's mirror test
did exactly that, and only reverting the fix exposed it — the wrong test
failed. Any fix reported as done here needs a test verified to fail without it.

**Off by default bounds who is affected, not who can see it.** W1 shipped a
toggle that promised behavior nothing delivered. For W2 the equivalent trap is
subtler: this store is not user-visible at all, so the risk is not a false
promise but a false sense of coverage — a store that passes its own tests and
has never been driven by a real SDK client. W3/W4 are where that gets tested,
and nothing here should claim otherwise.

**Check the plan against the design's rollout table, not against memory of the
conversation.** W1 scoped in work the design had assigned to PR 4, and nobody
noticed until a reviewer asked.

## From implementation

**The contract suite is not importable, which invalidates a W1 lesson.** W1's
lessons said to run the SDK's `testDocStoreContract` against our store. It is
not in the published package — `files: ["dist", "README.md"]`, and the suite
lives under `test/`. Verified against the tarball rather than the SDK source
tree, which is the check that matters: what the SDK repo *contains* and what it
*ships* are different questions, and a plan built on the first one silently
assumes a workspace link this repo does not have. The replacement is to run the
copied suite against the published `MemoryDocStore` as well, so drift in our
copy fails against upstream's own implementation.

**The design described a migration for data that does not exist.** It assumed a
deployment already passing `ClientOptions.store`; wafflebase never has. Writing
the `onupgradeneeded` relocation anyway would have produced recovery code
testable only against a fixture invented to justify it. Before implementing a
migration, confirm there is something in the wild to migrate.

_Appended as the work proceeds._
