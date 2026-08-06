# Lessons — GitHub Pages asset pruning

Task: [20260807-gh-pages-asset-pruning-todo.md](./20260807-gh-pages-asset-pruning-todo.md)

## A clean status page is a timestamp, not a fact

The root cause was attributed to site growth partly because
`githubstatus.com/api/v2/incidents.json` showed nothing for the failure
window. The Pages "Deployment Lag" incident was published later that day.

Providers post incidents well after users feel them. A clean status check can
lower confidence in a platform hypothesis; it can never eliminate one. When a
platform hypothesis is still live, say so in the writeup instead of closing
it, and re-check the status page before publishing a conclusion — not only
when first investigating.

## Chase the arithmetic that does not work

The evidence looked airtight: deploy time climbed monotonically 9s → 48s →
110s → 258s → 578s → timeout, and the site grew monotonically over the same
window. Two monotonic series, same direction, same hours.

But between 06:56 and 08:46 the file count moved 1787 → 1799 (+0.7%) while
deploy time moved 9s → 258s (+2800%). That mismatch was written down in the
Problem section as a caveat — and then reasoned past ("a Pages-side threshold
likely compounds it") rather than pursued.

The caveat was the answer. When a correlation holds but the magnitudes are
off by orders of magnitude, the mismatch is the finding, not a footnote to
the finding. Treat "my explanation is directionally right but quantitatively
absurd" as a stop condition, not a hedge.

## Correlated timelines do not separate causes

The prune shipped and the next deploy took 9s instead of timing out. That
reads as proof — except the incident had been mitigated ~7 hours earlier. Two
changes, one observation, no way to attribute.

If a fix lands during an active platform incident, the post-fix measurement
cannot confirm the fix. Report what is separable (site 98.3 MB → 18.2 MB, an
independent measurement) and state plainly what is not (the 9s).

## Execute the fix, do not read it

Running the extracted workflow steps instead of eyeballing them caught two
defects that review had not:

- The reviewer's suggested patch `cd`s into `packages/frontend/dist` while
  keeping a `dist`-relative redirect path, so the output file cannot be
  opened. Applying a suggestion verbatim would have broken the step.
- My own fix echoed `::error::` inside the subshell whose stdout *is* the
  manifest, writing the annotation into the manifest file (83 bytes) instead
  of the Actions log.

Neither is visible by reading. Both took one command to surface. For shell in
CI especially — where redirects, subshells, and `pipefail` interact — extract
the step and run it against a real fixture.

## Set-based deletion needs a matching guard

Switching from "delete what expired manifests name" to "delete everything
outside the keep-set" is what made the unreachable backlog collectable. It
also converts a malformed manifest from a no-op into site erasure.

When widening a delete's blast radius, add the guard in the same change, and
put it at both ends — the producer (assert the inputs) and the consumer
(assert the manifest describes every tree it is about to prune against). The
consumer-side guard is what protects against a manifest produced by a version
of the workflow you are not looking at.

## Verify what actually merged

PR #702 merged with only the first commit; the review fix, written after the
push, silently stayed local. `main` ran the widened delete without the guard
that made it safe.

After a merge, diff local `HEAD` against `origin/main` rather than assuming
the branch went in whole — especially when commits were added during review.
