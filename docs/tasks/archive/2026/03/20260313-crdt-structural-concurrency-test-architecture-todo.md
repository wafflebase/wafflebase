# CRDT Structural Concurrency Test Architecture

Review how to encode the two-user structural-edit problem space as generated
tests, borrowing the useful parts of Go's table-driven test style while fitting
this repository's existing TypeScript test layout.

## Context

The concurrency problem space is broad enough that hand-writing individual
tests will not scale. We need:

- a data-defined case table
- a reusable two-user driver
- a clear separation between fast semantic coverage and slower real-collab
  verification

## Tasks

- [x] Inspect existing test layers for `packages/sheet`, `packages/frontend`,
      and Yorkie-related code
- [x] Compare Go table-driven test ideas against current local test idioms
- [x] Propose where the case table should live
- [x] Propose where the two-user driver should live
- [x] Propose where fast/generated tests should live
- [x] Propose where a smaller real-Yorkie verification slice should live
- [x] Implement the typed concurrency case table and serial semantic driver
- [x] Add a generated `packages/sheet` matrix test over the case table
- [x] Add a real Yorkie two-user helper backed by manual sync clients
- [x] Add a targeted frontend Yorkie verification slice
- [x] Verify the default lane stays green without a running Yorkie service
- [x] Verify the Yorkie-backed slice against a local `:8080` service

## Findings

### 1. The repository already favors data-first test helpers

`packages/sheet` uses compact helper-driven tests today. Examples:

- `packages/sheet/test/store/store.test.ts` uses a reusable `runTests(...)`
  helper over a store factory
- `packages/sheet/test/sheet/*` keeps most tests close to the `Sheet` API and
  uses explicit imperative setup

That means a Go-style table of named cases maps cleanly onto the current
Vitest style.

### 2. The best Go ideas translate directly

From Go's table-driven testing guidance, the useful parts here are:

- define cases as data, not copy-pasted test bodies
- give every case a stable name
- run the same execution logic for each case
- keep failure output tied to the case name and inputs

In this repo, the TypeScript equivalent should be:

- a typed `cases` array
- `for (const tc of cases) { it(tc.name, async () => ... ) }`

This fits better than introducing a new `it.each(...)` style that the repo does
not currently use.

### 3. `packages/sheet` is the right place for the large generated matrix

The broad problem-space matrix should live in `packages/sheet/test/` because:

- it is the fastest test lane in the repo
- it already owns the spreadsheet behavior model
- it avoids UI and browser noise
- the matrix logic is fundamentally about spreadsheet semantics

Recommended files:

- `packages/sheet/test/helpers/concurrency-case-table.ts`
- `packages/sheet/test/helpers/concurrency-driver.ts`
- `packages/sheet/test/sheet/concurrency-matrix.test.ts`

### 4. But `packages/sheet` alone is not enough for the real bug

The current user report is specifically about CRDT-backed concurrent editing,
not just local spreadsheet semantics. `MemStore` cannot prove Yorkie merge
behavior.

So the test architecture should be layered:

1. **Fast semantic/generated matrix** in `packages/sheet/test/`
2. **Smaller Yorkie-backed contract/integration slice** in `packages/frontend`
   or a dedicated integration lane

### 5. The two-user abstraction should exist in two forms

#### A. Fast semantic driver

Location:

- `packages/sheet/test/helpers/concurrency-driver.ts`

Responsibility:

- create two logical "users"
- apply operation A and operation B in controlled orders/interleavings
- collect final sheet snapshot
- compare against expected semantic outcomes

This driver should not pretend to be Yorkie. It is a spec driver for expected
spreadsheet meaning.

#### B. Real collaboration driver

Location:

- `packages/frontend/tests/helpers/two-user-yorkie.ts`

Responsibility:

- create two collaborators against the same document
- expose operations like `setData`, `insertRows`, `deleteColumns`, `merge`,
  `applyStyle`
- sync and capture final document state

This is where actual two-user editing belongs, because `YorkieStore` lives in
`packages/frontend` and the CRDT-specific failure modes originate there.

### 6. Recommended placement by test intent

#### Fast generated matrix

Recommended location:

- `packages/sheet/test/sheet/concurrency-matrix.test.ts`

Why:

- cheap to run
- easy to generate from the case table
- ideal for broad problem-space coverage

#### Yorkie-backed targeted cases

Recommended location:

- `packages/frontend/tests/app/spreadsheet/yorkie-concurrency.test.ts`

Why:

- closest to `YorkieStore`
- already has a Node-based test runner for app-level logic
- can share frontend-specific helpers and types

#### Optional browser two-page smoke tests

Recommended later location:

- `packages/frontend` interaction/browser lane as a very small P0-only slice

Why:

- highest fidelity
- slowest and most brittle
- should verify only a handful of critical scenarios, not the full matrix

## Recommended Shape

### Case table

Each case should be declarative:

- `name`
- `userA`
- `userB`
- `seed`
- `expectedSemanticOutcome`
- `expectedCurrentBehavior` or `knownRisk`
- `tags`

### Operation encoding

Use a discriminated union, for example:

- `set-data`
- `clear-data`
- `insert-rows`
- `delete-rows`
- `insert-columns`
- `delete-columns`
- `merge`
- `unmerge`
- `set-style`
- `set-filter`
- `hide-rows`
- `move-rows`

### Driver API

The semantic driver should look roughly like:

```ts
type ConcurrencyCase = {
  name: string;
  seed?: SeedStep[];
  userA: SheetOp;
  userB: SheetOp;
  expect: ExpectedOutcome;
};

function registerConcurrencyCases(cases: ConcurrencyCase[]) {
  for (const tc of cases) {
    it(tc.name, async () => {
      await runConcurrencyCase(tc);
    });
  }
}
```

This is the direct TypeScript analogue of Go's table-driven loop.

## Proposal

### Recommendation

Use a **two-tier design**:

1. Large generated semantic matrix in `packages/sheet/test/`
2. Small real-collaboration verification slice in
   `packages/frontend/tests/app/spreadsheet/`

### Why this is the right split

- putting everything in browser/e2e will be too slow
- putting everything in `packages/sheet` will miss the actual CRDT merge bug
- splitting the layers gives both breadth and realism

## Implementation

### Added files

- `packages/sheet/test/helpers/concurrency-case-table.ts`
- `packages/sheet/test/helpers/concurrency-driver.ts`
- `packages/sheet/test/sheet/concurrency-matrix.test.ts`
- `packages/frontend/tests/helpers/two-user-yorkie.ts`
- `packages/frontend/tests/app/spreadsheet/yorkie-concurrency.test.ts`

### Final test shape

#### Fast semantic matrix

- 13 typed cases currently live in the shared case table
- the `packages/sheet` driver runs both `A -> B` and `B -> A`
- the matrix test asserts each case still matches the serial intent oracle

#### Real Yorkie verification slice

- the frontend helper now uses real Yorkie `Client`s with `SyncMode.Manual`
- tests are skipped unless `YORKIE_RPC_ADDR` is set, so the default frontend
  unit lane does not depend on Docker
- with a live Yorkie service, the helper captures both collaborator snapshots,
  convergence, and whether the result matches either serial oracle

### Current Yorkie coverage split

#### Serial-intent cases that currently pass

- `value edit vs row insert above shifted target`
- `value edit vs row delete at target`
- `value edit vs column insert left of shifted target`
- `value edit vs column delete at target`

#### Characterization cases that currently expose structural issues

- `row insert vs row insert at same index`
- `row insert vs row delete at same index`
- `column insert vs column insert at same index`
- `column insert vs column delete at same index`
- `column delete vs column delete at same index`
- `row delete vs row delete at same index`
- `row insert vs row insert at adjacent indexes`
- `row delete vs row insert at adjacent indexes`

These cases converge between collaborators, but the converged state does
not match either serial intent oracle. They are kept as characterization tests
so the current structural merge behavior is executable and visible.

### Opt-in repro slice

- `packages/frontend/tests/app/spreadsheet/yorkie-concurrency-repro.test.ts`

This file intentionally asserts the desired contract (`matchesSerialOrder ===
true`) for the known failing structure-heavy cases. It is gated behind both:

- `YORKIE_RPC_ADDR`
- `YORKIE_RUN_KNOWN_FAILURES=1`

That gives us an explicit red lane for bug fixing without turning the default
test run red.

#### Deferred case

- `formula chain vs row insert above referenced cell`

This case currently throws inside the sheet distribution runtime during formula
shift handling before the Yorkie assertion phase starts, so it is marked
pending in the frontend slice instead of blocking the rest of the matrix.

## Review

### Can we generate the tests?

Yes. The case table maps cleanly to the current TypeScript/Vitest style and is
a strong fit for Go's table-driven idea.

### Where should "two users" live?

Primary recommendation:

- semantic "two users": `packages/sheet/test/helpers/concurrency-driver.ts`
- real Yorkie "two users": `packages/frontend/tests/helpers/two-user-yorkie.ts`

### What changed after implementation?

- the table-driven shape works well in this repo without introducing new test
  DSLs
- a fake `Document.createChangePack()/applyChangePack()` loop is not a valid
  Yorkie server substitute for two-user tests
- a real Yorkie client pair is good enough for a narrow verification slice as
  long as it is opt-in via environment and service availability

### Verification

- `pnpm --filter @wafflebase/sheet test concurrency-matrix.test.ts`
- `pnpm --filter @wafflebase/frontend test tests/app/spreadsheet/yorkie-concurrency.test.ts`
- `YORKIE_RPC_ADDR=http://localhost:8080 pnpm --filter @wafflebase/frontend test tests/app/spreadsheet/yorkie-concurrency.test.ts`
- `YORKIE_RPC_ADDR=http://localhost:8080 YORKIE_RUN_KNOWN_FAILURES=1 pnpm --filter @wafflebase/frontend test tests/app/spreadsheet/yorkie-concurrency-repro.test.ts`
