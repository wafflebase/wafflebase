# Lessons — Omit generated ANTLR output from the reviewed diff

## Half of this PR was superseded while it was being written

The PR was scoped as "measurement foundation + cheap cost win": split
`cache_read_input_tokens` out of the metrics ledger so a token total means
something, *plus* the diff exclusion. The metrics half was written, tested, and
green — and then PR #565 ("Report cost and weighted tokens in the agent-effort
summary") turned out to have merged about an hour earlier, doing the same job
better:

- It renders `total_cost_usd`, which was **already recorded** on every ledger
  record and simply never displayed. Cost is strictly better than any
  hand-rolled weighting: the model prices cache reads at ~0.1× *and* prices each
  model correctly, which a token ratio cannot.
- It adds `weightedTokensFor` (cache read 0.1×, cache write 1.25×) as the
  headline token figure.

The `cachedTokens` + `formatCacheShare` work was reverted. It would have added a
competing field to the same schema-free ledger for a diagnostic percentage that
cost already expresses. Two things to carry forward: **re-check `origin/main`
immediately before starting each PR in a multi-PR plan** — this plan was written
against a `main` that moved twice within the day (#562, #565) — and when a
metric you want is derivable from a field already being recorded, render the
field before inventing a new one.

Silver lining: PR 7 (incremental review) now has a *better* yardstick than
planned. Its cost claim should be judged against #565's `Total-cost`, not
against raw or cache-adjusted tokens.

## The exclusion looked worthless until it was measured

The instinct was to exclude lockfiles — the classic diff-bloat candidate.
Measuring inverted that: lockfiles are 0% of *every* agent PR diff to date, and
the only PR with real generated bloat was #521, at 48%. #521 is also the single
PR that exhausted `MAX_REVIEW_ROUNDS` without converging. So the honest framing
is not "diffs are big" but "the one historically-failing category is half
generated output" — a much better reason to ship, and one that only appeared
after measuring instead of assuming.

Excluding lockfiles would have been actively wrong: it trades a real
supply-chain signal for a measured saving of zero.

## Two corrections that came from checking rather than pattern-matching

- **`Formula.g4` must be kept.** A first pass matched on the directory name and
  would have excluded the hand-written grammar along with its generated output.
  The grammar is 1.1 KB of the 36.7 KB and is the only place a semantic bug in
  that directory is visible.
- **The repo had already drawn this exact line.**
  `scripts/hooks/guard-generated-files.sh` blocks `PreToolUse(Edit|Write)` under
  `packages/sheets/antlr/` with an explicit `.g4` carve-out. The pathspec here
  mirrors it. Worth checking for an existing mechanically-enforced boundary
  before designing a new one — the justification writes itself, and consistency
  is free.

## The planned prefix-caching optimization rested on a wrong premise

Also scoped in and dropped: "put the diff first and the rubric last so the 8
lens calls in a round share a cache prefix."

Caching keys on an exact prefix rendered `tools → system → messages`, and
`runLens` gives every lens a *different* `systemPrompt`
(`You are the ${lens.title} reviewer…`) — so the calls already diverge at the
system block and reordering the user message changes nothing. Making it work
needs the system prompt unified across lenses **and** a serialized warm-up,
because a cache entry is only readable once the first response starts streaming
and both fan-outs (`Promise.all` over lenses, `Promise.all` over samples) fire
concurrently. The most tractable version is narrower: the two samples of one
lens are byte-identical requests firing in parallel, so serializing just those
would let the second read the first's cache, at the cost of doubling per-lens
latency. Left for a PR that can measure it against #565's cost line.

## Documenting a risk is not mitigating it

The first revision excluded the generated `.ts` files, and this very file said:

> a hand-edit to `FormulaLexer.ts` that does not match `Formula.g4` would be
> caught by nothing

The security lens then raised exactly that as a blocking `major`. Writing the
risk down had made it feel handled; it wasn't. The lens was right, the finding
was accepted, and the `.ts` exclusion was reverted — the executable half of the
generated output stays reviewable.

Two things worth keeping from how that went:

- **The lens earned its keep on a PR about the lens system.** It was correct,
  in-lane, correctly severity-rated (`major`, not `critical`, because
  exploitability depends on merge automation not visible in the diff), and it
  explicitly credited the parts of the change that were security-positive
  (`set -euo pipefail`, the fail-closed empty-diff fallback, keeping lockfiles
  and `changed.txt` unfiltered). That is what a useful review looks like.
- **The right response to a valid finding is to close the gap, not to restore the
  thing that was wasteful.** Reverting the whole exclusion would have put 35 KB
  of unreviewable state tables back in front of four lenses for a control that
  detects nothing in practice. Narrowing to the non-executable artifacts kept 22%
  of the saving with no security tradeoff, and the full saving stays available
  behind a mechanical check.

## There is no drift check on the generated output

Nothing in `package.json`, `scripts/verify-*.mjs`, or `harness.config.json`
regenerates the parser and compares it against the committed files. Excluding
those files from review therefore removes no guard that existed — the "review"
of those 35.6 KB was theater either way. But it does leave a real (pre-existing)
gap: a hand-edit to `FormulaLexer.ts` that does not match `Formula.g4` is caught
by nothing except the edit-time hook, which an out-of-band editor bypasses. A
regen-and-diff lane would close it cheaply.
