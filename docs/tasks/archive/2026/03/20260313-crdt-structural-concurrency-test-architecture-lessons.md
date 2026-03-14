# CRDT Structural Concurrency Test Architecture — Lessons

## Separate Breadth From Fidelity

- For collaboration bugs, do not force one test layer to do everything. Use a
  broad fast matrix for semantics and a narrow high-fidelity layer for the real
  CRDT path.

## Match Local Idioms

- When borrowing Go's table-driven ideas, translate the pattern, not the syntax.
  In this repo, typed case arrays plus `for ... of` generated `it(...)` blocks
  fit better than introducing unfamiliar test helpers.

## Put Helpers Next To The Layer They Exercise

- A generic "two-user" helper should live beside the system it simulates. Sheet
  semantics belong under `packages/sheet/test/helpers`; Yorkie collaboration
  belongs under `packages/frontend/tests/helpers`.

## Do Not Fake The Yorkie Server With Document Packs

- `Document.createChangePack()` and `applyChangePack()` are not enough to model
  a real server fan-out path. They can make two replicas look divergent even
  when the actual Yorkie service converges them correctly. Use real `Client`
  instances for Yorkie verification.

## Gate Service-Backed Tests Explicitly

- If a test needs Docker-backed Yorkie, make that dependency explicit with an
  env gate such as `YORKIE_RPC_ADDR` so the default unit lane stays green and
  local intent is obvious.

## Keep A Separate Red Repro Lane

- When you need failing tests for an unfixed collaboration bug, put them behind
  an explicit opt-in env gate such as `YORKIE_RUN_KNOWN_FAILURES=1` instead of
  making the normal verification lane permanently red.

## Isolate Runtime-Specific Failures

- If one case fails before the concurrency assertion stage because of a separate
  runtime problem, isolate it as pending instead of letting it obscure the rest
  of the matrix.
