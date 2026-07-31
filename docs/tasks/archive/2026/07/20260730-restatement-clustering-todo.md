# Restatement clustering: collapse wordings of one defect

Stop the panel reporting one defect three times. `dedupeFindings` only catches
byte-identical summaries; this collapses *restatements*.

## The problem, from #578

The disposition comment's third bucket: **"Three findings were double-reported
(the `hunt-probe.mjs` nit, the exact-string critical, the deny-list-shape major),
which inflates the counts."**

Each pair describes one defect in different words, so each gets a different
`file + lowercased summary` key and both survive. The verifier cannot help: it
judges one finding at a time in isolation, so it structurally cannot notice it is
confirming the same bug twice — and it bills for each copy.

## No model call, and why

The plan for this step called for one `askStructured` call per lens to cluster.
That turned out to be unnecessary: **the metric already exists and is already
calibrated.**

`findingSimilarity` in `scripts/agent/rounds.mjs` was built for the
non-convergence detector, gated on same lens + same file, using the overlap
(containment) coefficient — chosen over Jaccard precisely because "the panel
restates one defect at different levels of detail, and Jaccard penalises the
extra specifics in the longer wording". Its threshold was calibrated against real
panel output (PR #564's design-fit lens emitting four wordings of one defect).

Measured against #578's real data — the three double-reports its disposition
called out, plus the `CITATION` pair, versus four genuinely distinct findings from
the same lens and file:

| | score range |
|---|---|
| same defect, different wording | 0.308 – 0.933 |
| distinct defects, same lens+file | 0.000 |

The distinct pairs score exactly 0 because `MIN_SHARED_TOKENS = 3` zeroes them
out, so the real gate is "share at least 3 meaningful tokens AND overlap ≥ 0.3".
Clean separation on real data, deterministic, and free.

A second hand-tuned copy of the metric would have been the drift that
`REFUTATION_GROUNDS` (derived from its schema) and `CITATION` (extracted to a leaf
module) both exist to avoid. `DEFAULT_SIMILARITY` is imported, not redefined.

## Merging is not deletion

This is what makes clustering safe to do without a model in the loop, and it is
the same principle the novelty gate landed on after #583's review:

- every collapsed wording rides along in `mergedFrom`, is rendered in the check
  body, and reaches the fix agent — so a wrong merge is visible and the fixer
  still reads both descriptions;
- the survivor takes the cluster's **highest** severity, so #578's `critical`
  restated as a `major` cannot be masked;
- the survivor **gates** if any member gated (the rule `dedupeFindings` already
  has), so merging can never turn a check green;
- `unsettled` propagates, so doubt recorded on any wording survives;
- a lane is never invented on a finding that had none.

The only thing removed is the count inflation.

Single-linkage, not compare-to-representative: four wordings collapse to one only
if a new wording can join on matching ANY member. Membership is decided before a
representative is chosen, and the representative is picked by a total order
(gating, severity, has-evidence, longer summary, lexicographic), so the result
does not depend on input order — asserted both directions in the tests.

## Stated limitation

Two wordings of one defect that share no vocabulary score 0 and stay separate.
That leaves the count inflated, which is the status quo — the conservative
direction. A model pass would catch those; it is not worth a paid call per lens
per round for the residue, and `clusters.collapsed` will show whether it is.

## A bug this surfaced in the merged absence-claims change

Rendering the output rather than trusting the unit tests caught it:
`normalizeFindings` rebuilt every finding as exactly
`{severity,file,summary,evidence}`, dropping everything the orchestrator
annotates after the lens produced it. `renderSummaryMd` renders from
`classify()`'s output, so **the "verifier could not settle this" marker shipped in
#587 never appeared in a single check body** — the field was gone before the
renderer looked for it. `normalizeFindings` now coerces `severity` and preserves
the rest, with a regression test for the field set and an end-to-end one for the
rendered body.

## What to watch

`clusters.collapsed` in the metrics comment. A persistently high number means the
lenses are re-describing the same defects rather than that the PR has that many
problems — which is a rubric signal, not a clustering one.

## Deliberately not in this PR

The last #578 bucket: **wrong mechanism, true kernel.** A binary
confirmed/refuted verdict has nowhere to put "the concern is real but the stated
cause is wrong", so such a finding rides through at full severity (#578's
"Bash/Write stay available" was overstated but had a true core). Needs a
`confirmed-corrected` verdict that may only downgrade.
