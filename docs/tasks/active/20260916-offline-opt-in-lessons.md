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

_Appended as the work proceeds._
