# Concurrency Move Tests — Lessons

## Lesson 1: Move operations always produce order-dependent serial results
All 11 new test cases turned out to be characterization cases (aThenB ≠ bThenA).
This makes sense: move = splice + reinsert, so serial ordering always matters.
The real question is whether Yorkie's CRDT converges, which requires live Yorkie tests.

## Lesson 2: Trace through serial execution before writing expected values
Initial expected values for 6 out of 11 cases were wrong. Always dump actual
results from the serial intent oracle first, then set expectations.

## Lesson 3: Formula rewriting interacts with moves in non-obvious ways
`moveFormula` remaps references based on the move's src/dst/count. When combined
with a concurrent value edit at the original position, the formula's references
point to the moved position, not the edited position. This is correct for serial
execution but may cause surprising results in concurrent CRDT resolution.
