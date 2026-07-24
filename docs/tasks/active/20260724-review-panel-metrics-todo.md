# Review panel metrics ledger

Instrument `review-panel.mjs`'s currently-discarded signals (its own SDK
cost, per-sample finding agreement, verifier confirm/refute outcomes) into
the existing `metrics.mjs` ledger (PR #522), rendered as a separate
"Review panel" section in the per-PR summary comment.

## Motivation

`review-panel.mjs` runs entirely outside `claude-code-action`, so its own
SDK calls (up to 8 lens samples + N verifier calls per round) never produce
a `claude-execution-output.json` and never enter the metrics ledger — a PR
that stalls for 6 rounds of review-panel churn looks identical, cost-wise,
to one that never ran the panel. Per-sample agreement and verifier
confirm/refute counts are computed and thrown away in the same file.

## Design decisions

- Panel cost: `review-panel.mjs` accumulates every internal SDK `result`
  message into `sessionLog`, writes it to `.agent-review/review-execution.json`
  (shape-compatible with `claude-execution-output.json`); a new
  `sumExecutions()` in `metrics.mjs` sums (not last-wins) across every
  result message, invoked via `metrics.mjs record --kind review`.
- Per-lens/round sample-agreement + verifier tallies write to a sibling
  `.agent-review/review-lens-stats.json`, attached to the same ledger record
  via `--lens-stats`.
- Rendered summary keeps code-fix agent (`implement`/`ci-fix`/`review-fix`)
  and review-panel (`review`) numbers in separate sections — conflating them
  would blur "cost of fixing code" vs "cost of reviewing it" (review-fix and
  review are easy to conflate by name already).
- One `Total-tokens:` line under the heading combining both, since that's
  the one number most people want at a glance.
- Cumulative (summed across rounds), not "final round only" — a finding
  that persists across 3 rounds is raised/verified 3 times; this mirrors
  how `aggregate()` already sums Sessions/Turns/Tokens across every
  session, not just the last.
- Artifact hand-off: `review-panel` job's permissions deliberately exclude
  `issues:write`/`pull-requests:write` (its SDK cwd is the untrusted branch
  checkout) — so the two new files are uploaded as a build artifact and the
  `promote`/`fix` jobs (which already hold write scope) download it and call
  `metrics.mjs record --kind review`, not the review-panel job itself.

## Plan

- [ ] `review-panel.mjs`: thread a `sessionLog` accumulator through
      `askStructured`/`runLens`/`verifyFinding`; add `compareSampleAgreement`,
      `severityCounts`, `verifierTally` pure helpers; collect per-lens/round
      stats in `main()`; write `review-execution.json` + `review-lens-stats.json`.
- [ ] `metrics.mjs`: add `sumExecutions`, `aggregatePanelStats`; extend
      `cmdRecord` for `--kind review` (+ `--lens-stats`); split
      `renderSummary` into code-fix + review-panel sections + one
      `Total-tokens:` line; extend `cmdSummarize` to split ledger records
      by kind before aggregating.
- [ ] `agent-review-panel.yml`: upload the two files as a `review-panel`
      job artifact; download + `metrics.mjs record --kind review` from
      `promote` and `fix` jobs.
- [ ] Extend `review-panel.test.mjs` + `metrics.test.mjs` for all new pure
      functions; `node --test *.test.mjs` green.
- [ ] `pnpm verify:fast` green per commit.
- [ ] Self-review pass over the diff.
- [ ] Open PR against `wafflebase/wafflebase:main`.
