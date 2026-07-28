# Independent verifier: judge from the repo, drop only on grounded evidence

Make the per-finding verifier in `scripts/agent/review-panel.mjs` an
**independent** check rather than a second read of the same diff, and require a
refutation to be *grounded* before it is allowed to drop a finding.

## Motivation

Two separate defects in the same function.

**1. The verifier was not independent.** `verifyFinding` received the same diff
as the lens that raised the finding. A lens that misreads a hunk hands that
misreading to a verifier reading the identical text, which confirms it. This is
the correlated-error failure mode adversarial-review work identifies as the core
weakness of naive multi-agent panels — and a different *model* would not fix it,
because the shared input is what makes the errors correlate. Independence
requires a different **evidence source**, not a different reader.

**2. Refuting cost nothing.** The old rule dropped a blocking finding on
`{verdict:"refuted", confidence:"high"}` — two enum fields. `reason` was in the
schema but nothing checked it, so the prompt's "only refute with a concrete
reason" was prose the trusted script never enforced. On the audited PRs the
refute pass killed 50–60% of surviving findings on exactly that shape.

The panel already has two precision stages (a conservatism clamp closing every
lens rubric, then this refute pass) and no recall stage. This PR tightens the
second precision stage; the rubric inversion that fixes the first is a later PR
in the same series.

## Scope

- [x] `verifyFinding` — **drop the `diff` parameter.** Takes `changedFiles`
      instead. The SDK call already runs with `cwd: repo` and `Read`/`Grep`/
      `Glob`, so the verifier locates the code itself, and the prompt tells it to
      distrust the finding's quoted evidence ("checking it IS the job").
- [x] `VERIFIER_SCHEMA` — add `refutationGround`
      (`not-present | already-guarded | out-of-scope | pre-existing | none`,
      **required**) and `groundedIn: string[]` (locations it actually read).
- [x] New pure export `isDroppingVerdict(v)` — the complete drop rule, checked by
      trusted code. `applyVerifications` now calls it.
- [x] New pure export `changedFileContext(changedFiles, max = 200)` — bounds the
      list and decides whether it is `authoritative`.
- [x] `askStructured` — optional `maxTurns` passthrough; verifier capped at 8.
- [x] `verifierTally` gains `dropped`, threaded through `metrics.mjs`
      aggregation and the PR summary comment.

## Why `pre-existing` is gated on an authoritative file list

`pre-existing` lets the verifier say "this defect is in code the PR did not
touch". That is only decidable from a **complete** changed-file list. Truncate
the list and an absent path reads as "untouched" when it was merely cut off —
the one way this list could fail OPEN and drop a real finding.

So `changedFileContext` reports `authoritative: false` for a missing, malformed,
**or truncated** list, and the prompt then withdraws `pre-existing` as a ground
outright. The cap exists because the list is re-sent with every verification
(one per blocking finding, per lens, per round); the safety property is that
hitting the cap costs recall of one *ground*, never a dropped finding.

This creates a **new dependency for the incremental-review PR**: that change must
keep `--changed-files` cumulative. It was already required (a shrinking list
could un-require a lens that failed an earlier round, via `lensApplies`); it now
has a second consumer with a different failure mode.

## Expect MORE rounds, not fewer

This PR is a recall/precision trade taken deliberately in the recall direction.
Strictly more verdicts now keep their finding, so more findings survive to the
gate, so more fix rounds. That is the intended effect — the verifier was
dropping findings on unevidenced assertions — but it lands on the cost axis.

The convergence detection already merged is the counterweight: a PR that starts
re-raising the same findings now pages a human at round 3 instead of burning to
`MAX_REVIEW_ROUNDS`.

## Verification

- `agent:tests` lane: 107 tests green (was 105; +`isDroppingVerdict`,
  +`changedFileContext`).
- `pnpm verify:self` green.
- The rendered verifier prompt was **executed** for four changed-file shapes
  (complete / exactly at cap / one over cap / junk-only) and inspected: the
  `pre-existing` bullet flips to the withdrawal wording at exactly the cap+1
  boundary, the listed block truncates to 200, and the header reports the true
  total rather than the listed count.
- `maxTurns: 8` confirmed to reach the SDK options object.

What none of that covers: **whether the verifier actually finds the code.** It
now depends on Grep/Glob succeeding in a checkout, which no unit test exercises.
The live signals to watch on the next few autonomous PRs are the
`refutedHighConfidence` vs `dropped` gap (how often a confident refutation
arrives ungrounded), round counts, and `Total-cost`.
