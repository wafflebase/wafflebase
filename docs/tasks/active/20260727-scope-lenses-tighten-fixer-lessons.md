# Lessons — Reduce agent token consumption (#563)

## Context

Autonomous PRs consume a lot of tokens; PR #547 recorded ~17.8M across 8
sessions. Three independent, behavior-preserving reductions.

## Notes

- The `lensApplies()` / `globToRegExp()` machinery and the per-lens
  `applicable: false` handling already existed — Deliverable 1 is a pure data
  change in `lenses.json`, so the only risk is picking globs that would leave
  the required-check set empty. `correctness` stays `["**"]` to guarantee at
  least one always-applicable blocking lens.
- The panel already persists each blocking finding's `file`/`summary`/
  `evidence` as JSON in the per-lens check `output.text`; the fix prompt just
  needed to be fed a per-file checklist built from it.

## Follow-ups (out of scope here, per issue)

- Drop `samples` 2→1 on stable lenses (#1).
- Model-tier lenses to a cheaper first pass (#3).
- Incremental re-review of only changed files (#4).
- Report `total_cost_usd` instead of raw tokens (#10).
