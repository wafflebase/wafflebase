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
      the two callers that need "what counts as a location" share one answer. A
      leaf module because `review-panel.mjs` imports `novelty.mjs`, so the
      reverse would be a cycle.
- [x] `scripts/agent/novelty.mjs` — `originFrom` (the pure decision table),
      `noveltyOf` (two blames + a whole-line content fallback, all async so they
      do not block the orchestrator's event loop), `findingLocation`,
      `isProbeableLine`, `DEMOTING_ORIGINS`, and a dry-run entry point.
- [x] `review-panel.mjs` — `LANES`, `routeFinding`, `annotateFindings`,
      `gatingFindings`, `keepUnrefuted`, `laneCounts`; `line` added to the
      `FINDING` schema; the `line`/`file` instruction added to the shared
      `LENS_CLOSING_INSTRUCTION` rather than copied into five rubrics;
      `dedupeFindings` made lane-aware; `lensStats.kept` counts gating findings
      only, so `metrics.mjs::detectFlips` still agrees with the check.
- [x] `severity.mjs` — a "Relocated code — not written by this change" section
      that prints only proof a probe actually established. The module stays
      lane-unaware; the caller decides what was demoted.
- [x] `metrics.mjs` — aggregates and renders the lane counters.
- [x] All three callers pass `--base-sha`: both panel workflows (via `env:`, not
      interpolated into a `run:` in a token-holding job) and `spec-to-pr.mjs`.
      Demoted findings are **not persisted** into check `output.text`, so the
      fixer, the carry-forward and the non-convergence detector all see only what
      gates.
- [x] Tests: `novelty.test.mjs` (25, including five against a REAL git repo built
      in the test), `citation.test.mjs` (6), demoted rendering in
      `severity.test.mjs`, lane routing in `review-panel.test.mjs`. 211 green.

Stacked on #581 (`agent/incremental-review`), which introduced the `--base-sha`
flag this reuses; rebased onto `main` after it merged.

## Why git and not a better prompt

Plain `git blame` says which commit put a line at its current offset. `git blame
-w -C -C -C` follows that line back through moves and copies to the commit that
originally *wrote* its content. On #578's `resets?\b` regex the two disagree —
plain blame names the PR commit (the illusion the verifier was working from),
move-aware blame names a commit that predates the base. That disagreement IS the
signal, and it is deterministic, ~20ms, and zero tokens.

## The scope mistake this design had to correct

The first version demoted any finding whose cited line predated the base. That
was wrong, and the review panel caught it: **code age is not causation.**

A new guard bypassed by an untouched call site, a new caller reaching an old
unguarded path, a test that stopped covering a branch — those defects live
entirely in pre-base lines. The blast-radius lens exists to find exactly them,
and its rubric orders it to cite "the bypassing or broken site, by `file:line`,
not the diff line that introduced the guard"; correctness and security carry the
same out-of-diff mandate. Demoting on line age would have routed that entire
class off the merge gate — the precise opposite of the goal, and a far worse
failure than the one being fixed.

So the question is narrower: **did this change PUT this line here, and was the
code it put here already in the tree?** A line the change did not add is
`pre-existing` and never demotes; whether it is a bug is what the lens was asked.
Only `relocated` — the change added the line, the content predates the base —
demotes. That is the #578 shape and nothing else.

## The one rule

**Every uncertain path yields `unknown`, and `unknown` keeps the finding
blocking** — identical to today's behaviour. Demotion needs an affirmative git
answer on BOTH questions; no combination of missing, null, or failed evidence can
produce a demoting origin, pinned by a test over the whole cross-product.

Corollaries, each of which was a real defect in the first draft:

- The content probe (`git grep` against the base tree) is a **fallback** for the
  second question when move-aware blame cannot answer at all, never an override
  of an affirmative "written here". And `git grep -F` is a *substring* match, so
  every hit is re-checked for whole-line equality — otherwise a new line whose
  text merely occurs inside some existing line would demote.
- Non-distinctive lines are refused (`isProbeableLine`): `}` occurs in any tree.
- A citation's line is used only when the citation names the **same file** as the
  finding. Evidence routinely cites a second location for contrast, and stapling
  a foreign line number onto this file invents a location that means nothing.
- There is **no file-level fallback**. Demoting because a `file` string is absent
  from the changed-file list is a string comparison, not a git answer; a `./`
  prefix or a differently-spelled path would drop a real blocker.
- **Carried-forward findings are not routed.** Their `line` was recorded against
  a tree the fixer has since rewritten, so re-probing that offset could
  affirmatively place a still-open blocker in unrelated old code.
- `gatingFindings` excludes only an explicit `backlog`, so a finding with no lane
  still gates. An allow-list phrasing would silently drop unrouted blockers.
- `dedupeFindings` puts lane above severity: a gating finding is never displaced
  by a demoted duplicate, which would otherwise turn the check green.

## Verified against the real PR

Two independent checks.

**Unit, against a real repository.** `novelty.test.mjs` builds a throwaway git
repo whose HEAD commit performs the #578 refactor — a function lifted verbatim
into a new file, plus one genuinely new line, plus an untouched file — and reads
the actual probe answers: `relocated` for the moved line, `introduced` for the
new one, and `pre-existing` (never demoted) for both the untouched file and an
untouched line inside a MODIFIED file. That last case is the blast-radius
regression test.

**End-to-end, against the real PR.** Replayed #578's findings through the dry run
in a worktree at the exact commit the panel reviewed (`8e87d453f`, base
`08c7885f9`) — see the PR description for the output.

## A cost note, deliberately not optimised

Verification runs BEFORE routing, so a `backlog` finding still costs a verifier
session every round. It is re-discovered fresh each round rather than carried
forward (demoted findings are not persisted into `output.text`), so the cost is
one verification per round per relocated finding.

Routing first and skipping the verifier for demoted findings would save that, and
was rejected: it would put unverified findings in the "Relocated code" section,
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
