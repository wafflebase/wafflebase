# Offline Persistence Opt-In — Lessons (W1)

**Created**: 2026-09-16

Carried in from the design work and from the SDK half of this feature
(yorkie-js-sdk#1354), so the parts that were expensive to learn there are not
re-learned here.

## From the design phase

**The preference is per device because an account-level one defeats it.** The
whole reason for asking is that the user may be on a machine whose disk should
not keep their documents. A setting that syncs would re-enable itself exactly
there. If someone later proposes moving it to the `User` row for convenience,
this is the argument against.

**Turning it off must erase.** A toggle that leaves the content behind is not
the control it presents itself as.

**`localStorage` refusing a write is not an edge case to ignore.** Safari
private mode throws on both `getItem` and `setItem`, and `getOfflinePersistence`
is a `useSyncExternalStore` snapshot — so it runs during render, and a throw
blanks whatever tree is reading it. `date-format-preference.ts` already solved
this; copy its shape rather than a simpler one.

## From the SDK half, which apply to every wafflebase PR here

**Tests that assert a proxy pass while the thing they protect breaks.** Five
review passes on the SDK found thirteen critical defects, all with the unit
suite green. Two causes recurred: a test that re-stated production logic
instead of calling it, and persistence tests that mutated with an absolute
`set` — which the last log entry reconstructs whether or not the base survived,
hiding a permanent data-loss bug through two passes. When W2 tests the store,
compare whole documents and use at least one relative operation.

**Two copies of a contract diverge.** The SDK shipped `MemoryDocStore` and an
IndexedDB reference with hand-duplicated test suites; they disagreed on two
rules before anyone noticed, and the fixture apps were told to copy had the
bug. W2 should run `testDocStoreContract` from the SDK against
`WafflebaseDocStore` rather than writing its own.

**Verify a claimed fix by reverting it.** One SDK commit message described a
fix that a silent string replacement had never applied. Anything reported as
done here should have a test that fails without it.

## From implementation

**A test can pass on the stale state it was supposed to prove was gone.** The
first version of "stops preferring the mirror once a write succeeds" wrote
`false` after a failed write of `true`, then read back `true` and asserted it —
which the *bug* also satisfies, because a mirror left holding `true` answers the
same. Reverting the fix proved it: a different test failed, not that one. The
mirror and storage always agree immediately after a successful write, so the
divergence only shows once storage moves on its own — the test has to simulate
another tab changing the key. **A persistence test whose fixture never diverges
from what the bug would produce is asserting nothing.**

**Module-level state makes a test suite order-dependent.** The session mirror
survives between tests, so one case's leftover decided the next case's answer —
which is why the revert check failed the wrong test. `vi.resetModules()` plus a
per-test dynamic import fixes it, and the payoff is that a failure names the
property it actually broke.

**Follow the repo's test placement, not the plan's.** The todo said
`lib/__tests__/`; `lib/` colocates (`thumbnail-capture.test.ts`). `app/` does
use `__tests__/`, so the two files here land in different shapes on purpose.

**The task plan silently contradicted the design it cites.** W1 scoped in the
Settings section; the design doc's own rollout table had always assigned "the
Settings + chip opt-in" to PR 4. Nobody noticed until a reviewer asked why a
toggle promises behavior that does not exist — and the answer was in the
document the task links at the top. When a task doc lists scope, check it
against the design's rollout table rather than against memory of the
conversation that produced it.

**Off by default bounds who is affected, not who can see it.** That is the
substance of the same mistake. "It ships off, so it is dark" was the reasoning
for landing the toggle early; but the control still renders, and its copy makes
two promises — edits are kept, turning it off deletes them — that nothing keeps
until the store is wired. A control that ships before its behavior is not a
dark launch. Carry this into W4: the store, the section, and the erase land
together or not at all.

**The pre-commit hook runs the whole `verify:fast` lane.** It takes several
minutes, so a commit needs a long timeout — a 2-minute one kills the hook
mid-run and leaves the change staged but uncommitted with no obvious reason.
