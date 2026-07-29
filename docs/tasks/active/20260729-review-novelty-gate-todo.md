# Novelty gate: route findings by whether this change caused them

Answer *"did this PR introduce it?"* with git instead of asking the verifier a
question it structurally cannot answer, and replace the verifier's keep/drop
binary with lanes so a demoted finding is still reported.

## The problem, from #578

The panel raised ~40 findings on a PR whose contract was "behaviour-preserving
extraction". The disposition comment sorted them into three buckets; the largest
was **valid but pre-existing** — every `classifyResult` finding, on code the PR
moved *verbatim* out of `review-panel.mjs` into a new `ask.mjs`.

The verifier confirmed them all, correctly by its own rule. #573 deliberately
stopped handing it the diff (a verifier reading the same diff as the lens
inherits the lens's misreadings), so its cwd is the branch checkout and nothing
else. From there a moved line and a new line are byte-identical. The
`pre-existing` refutation ground is *file*-scoped — "lives in a file this change
did not touch" — and a relocated function lives in a file the PR created, so the
ground correctly does not apply.

Two questions were fused into one gate: *is this defect real?* (the verifier
answers this well) and *did this PR cause it?* (it cannot answer this at all).

## What this PR does

- [x] `scripts/agent/citation.mjs` — `CITATION` + `parseCitation`, extracted so
      the three callers that need "what counts as a location" share one answer.
      A leaf module because `review-panel.mjs` imports `novelty.mjs`, so the
      reverse would be a cycle.
- [x] `scripts/agent/novelty.mjs` — `originFrom` (the pure decision table),
      `noveltyOf` (the git probes), `findingLocation`, `isProbeableLine`, and a
      `--findings/--base-sha` dry-run entry point.
- [x] `review-panel.mjs` — `LANES`, `routeFinding`, `annotateFindings`,
      `gatingFindings`, `laneCounts`; `line` added to the `FINDING` schema;
      `applyVerifications` re-expressed through `annotateFindings` so there is
      one routing rule rather than two that could drift.
- [x] `severity.mjs` — a "Pre-existing — not introduced by this change" section,
      with the base location that makes each demotion auditable. The module stays
      lane-unaware; the caller decides what was demoted.
- [x] Both panel workflows — merge-base computed and passed as `--base-sha`;
      `lane`/`line` persisted into check `output.text`; **the fixer checklist
      filters to `lane === 'blocking'`**.
- [x] Tests: `novelty.test.mjs` (17), `citation.test.mjs` (6), plus lane routing
      in `review-panel.test.mjs`. 190 agent tests green.

Stacked on #581 (`agent/incremental-review`), which introduced the `--base-sha`
flag this reuses. Rebase onto `main` once that lands.

## Why git and not a better prompt

`git blame -w -C -C -C` follows a line back through moves and copies to the
commit that *wrote* it. On #578's `resets?\b` regex, plain blame reports the PR
commit — the illusion the verifier was working from — while move-aware blame
reports a commit that predates the base. A second, independent probe greps the
line's text against the base tree; it needs only the base tree object, so it
still answers where blame cannot (shallow clone).

Deterministic, ~20ms, zero tokens, and not subject to the correlated-error
problem that no amount of extra reviewers fixes.

## The one rule

**Every uncertain path yields `unknown`, and `unknown` keeps the finding
blocking** — identical to today's behaviour. Demotion requires a probe to have
*affirmatively* placed the code before the base; no combination of missing,
null, or failed evidence can produce a demoting origin (pinned by an exhaustive
test over the null/false/undefined cross-product). So this gate can only remove
a false blocker. There is no path by which it loses a real one.

The corollary is that being wrong in the safe direction is cheap and being wrong
in the unsafe direction is not, which is why the content probe refuses
non-distinctive lines: `}` and `});` occur in any tree, and probing them would
demote every finding that touched one. `isProbeableLine` requires length plus
two identifier runs.

## Verified against the real PR

Replayed #578's findings through the dry run, in a worktree at the exact commit
the panel reviewed (`8e87d453f`, base `08c7885f9`):

```
relocated   ask.mjs:105  resets?\b matches ECONNRESET       already at 08c7885f9:review-panel.mjs:436
relocated   ask.mjs:105  'rate limit' contradicts docblock  already at 08c7885f9:review-panel.mjs:436
relocated   ask.mjs:100  structured_output before is_error  already at 08c7885f9:review-panel.mjs:431
introduced  ask.mjs:76   deny-list is exact-string          (the correct critical headline)
introduced  ask.mjs:35   FORBIDDEN_TOOLS wrong for 0.3.217
```

All three "valid but pre-existing" findings demote, each citing the base location
that was assembled by hand in the disposition comment. Both genuinely-new
findings stay blocking. No false demotions.

## A cost note, deliberately not optimised

Verification runs BEFORE routing, so a `backlog` finding still costs a verifier
session every round — and because the fixer never sees it, it never gets fixed
and so returns in the prior-findings list on every subsequent round.

Routing first and skipping the verifier for demoted findings would save that, and
was rejected: it would put unverified findings in the "Pre-existing" section,
where a hallucinated one would read as a confirmed bug in `main`. The section is
only worth having if everything in it has been checked. Revisit if the `lanes`
counters show the repeat cost is material.

## Deliberately not in this PR

The other three buckets from #578 need different mechanisms, each its own diff:

- **Absence claims** ("no CI workflow runs these tests"). Refuting *"there is no
  X"* needs an exhaustive search while confirming it needs one hit, so
  bias-to-keep is backwards for them. Needs a `claimType` field, an `unresolved`
  verdict, and a larger turn budget for that branch only.
- **Wrong mechanism, true kernel.** A binary confirmed/refuted verdict has
  nowhere to put "the concern is real but the stated cause is wrong", so such a
  finding rides through at full severity. Needs a `confirmed-corrected` verdict
  that may only downgrade.
- **Duplicates.** `dedupeFindings` keys on `file + lowercased summary`, and the
  verifier runs per-finding in isolation, so the same bug in different words
  survives twice. Needs a clustering pass that sees the whole surviving set.

A reproduction gate (execute a repro rather than argue about one) is the
strongest remaining option and is deferred until `lanes` data shows how much
residue the cheap gates leave. If built, the model must return repro *source* in
a schema field for trusted code to run — `PERMITTED_TOOLS` stays
`["Read","Grep","Glob"]`.
