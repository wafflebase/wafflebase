# Review panel: a drained credential pool must be an infrastructure failure

## Problem

When every sample of a lens fails, the panel synthesises one record so the lens
fails closed. That record is either an **infrastructure** marker — the reviewer
never ran, so it must not be re-checked — or an ordinary blocking no-verdict. The
decision keyed on one failure kind:

```js
const apiErr = results.find((r) => r && r.kind === "api-error");
```

`poolExhaustedError` (`scripts/agent/ask.mjs`) throws `kind: "pool-exhausted"` when
the credential pool has no live slot left to fail over to. That is the *same*
outage as an `api-error` — a closed usage window, or a refused credential —
wearing a different kind only because failover ran first and ran out. So one
outage was classified two ways, decided by how many credentials the run happened
to have:

| credentials | kind | result |
|---|---|---|
| one | `api-error` | `infra: true` → dropped, correctly |
| several | `pool-exhausted` | no flag → carried into the next round |

An unflagged record defeats both branches of `prior-findings.mjs::isInfraRecord`:
it has no `infra: true`, and its summary begins *"Reviewer did not produce a valid
verdict"* rather than the legacy `INFRA_SENTINEL`. It therefore survives as a
blocking finding, is handed to the fix agent as a work item, and is sent to a
verifier which — biased to keep — cannot refute *"the review could not run"* on
grounded evidence. It can be neither fixed nor dropped, so it gates every
subsequent round until someone intervenes by hand.

Measured over 66 rounds on 16 pull requests: **23 of 536 gate-channel findings
(4.3%)**, on 5 PRs.

## Plan

1. `ask.mjs` — export `sessionNeverRan(err)`: `api-error` ∪ `pool-exhausted`. One
   predicate, so the panel and its tests cannot spell the list differently.
2. `ask.mjs` — `poolExhaustedError` carries `code`/`reason`/`detail` like every
   other failure. It was the one failure reaching a renderer with no
   closed-vocabulary string.
3. `redact.mjs` — add `POOL_EXHAUSTED` to `INFRA_CODES`; branch on the kind in
   `classifyInfraError` alongside the other own-kind branches.
4. `review-panel.mjs` — use the predicate; pass `err.kind` to both renderers
   instead of hard-coding `"api-error"`.
5. `review-panel.mjs` — extract `allSamplesFailedError` and `lensInfraReason`.
   Inline, the branch deciding infrastructure-or-not could only be exercised by a
   live panel round against a real API, which is why it misclassified a drained
   pool undetected. Same argument the file already makes for `lensFailureSummary`.
6. Tests: one per behaviour, each mutation-tested.

## Acceptance criteria

- [x] A drained pool is marked `infra: true` and dropped by `prior-findings.mjs`.
- [x] A genuine no-verdict (`limit`, `no-output` — the model ran) is **not**
      marked and **is** carried forward. This is the `#521` false negative and the
      reason the fix is narrow.
- [x] `isInfraRecord`'s legacy summary-prefix branch is unchanged, and pinned by a
      test that fails if it is widened.
- [x] Replaying the 5 affected PRs' stored records: 25 synthesised gate-channel
      records → 2, the two being the genuine turn ceilings.
- [x] Full `scripts/**` test lane 2636 → 2644, 0 failures. 11 mutations, 11 caught.

## Non-goals

- **Not a severity change.** The hard-coded `severity: "major"` stays: the record
  should stop *propagating*, not change severity, and moving it would put a
  severity-policy question inside an infrastructure fix. `severity.mjs`,
  `normalizeSeverity`, `BLOCKING` and the lens rubrics are untouched.
- **Not a consumer-side fix.** Widening `isInfraRecord` to match the second summary
  prefix would also have stopped the leak, and is rejected: `infra: true` is
  authoritative precisely because the producer sets it and `summary` is model
  output. Matching more prose hands a model a way to write a summary that gets its
  own finding silently dropped.
- `VERIFIER_FAILURE_KINDS` has the same three-kind blind spot (a `pool-exhausted`
  verifier failure tallies as `unknown`). It is a metrics bucket, not a gate, so it
  leaks nothing — same root cause, separate change.
- `agent-review-panel.yml`'s inlined copy of `normalizeSeverity`.
