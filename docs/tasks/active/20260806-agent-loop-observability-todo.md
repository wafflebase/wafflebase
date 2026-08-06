# Make the review→fix loop legible from the PR page (observability, phase 1)

## The problem

The pipeline computes everything a maintainer would ask — which round the loop
is on, why it continued or stopped, what a round cost — and then discards it:
the round guard's PROCEED decision writes only `$GITHUB_OUTPUT`, per-session
cost lives in hidden `<!-- agent-metric -->` comments, and the whole pipeline
wrote exactly one `$GITHUB_STEP_SUMMARY` line (the review-scope note). From the
PR page a continuing loop and a dead loop looked identical; only pages spoke.

## The change

- [x] **Sticky loop-status comment** (`scripts/agent/loop-status.mjs`, marker
      `<!-- agent-loop-status -->`): round table + fix-round budget + latest
      decision + effort totals. A projection, never a gate — re-derived in full
      from commits/check runs/paged latches on every update; author-checked
      upsert; ledger parsed from trusted-author comments only, numbers-only
      rendering (a fake metric record must not be able to launder a trusted
      marker into a bot-authored body). Update hooks in the panel workflow
      (panel / promote / guard decision / fix outcome / stalled), the CI arm,
      `@claude fix` and `@claude rerun`.
- [x] **Round-guard verdict surfacing** (`guard-verdict.mjs`, pure rendering):
      every guard path — including the previously silent PROCEED — emits a
      one-line `verdict` output and a job-summary block. Page detail is fenced
      inert (it embeds finding summaries derived from the untrusted diff).
- [x] **Job summaries**: `panel-job-summary.mjs` (per-lens verdict/verifier/
      cost table, fail-closed message when `panel.json` is missing),
      `session-job-summary.mjs` (turns/tokens/cost/outcome per Claude session),
      the CI-fix diagnosis teed into the run page, and SKIPPED/PAGED/PROCEED
      blocks from the CI arm's attempts guard.
- [x] **Round 2 (review-panel findings)**: `checks: read` for the CI arm and
      rerun; author-checked CI paged latch (was body-only — any account could
      stop the loop); both latches feed the paged projection; `Number(null)`
      budget-line bug fixed ("N of 0"); `ready` derived from agent/-branch
      promotion, not bare non-draft-ness; `--required-checks` so the displayed
      budget counts what the guard counts; upsert self-heals duplicate
      comments; check-run fetches capped at 40 commits; CI-arm scripts run from
      a pre-fixer snapshot; summary writes fail-safe and ordered after outputs.

## Deliberately not done

- Per-round cost attribution, check-run body enrichment (verifier/adjudication
  detail, author-reported skips), visible rebuttal bodies — phases 2–3 of the
  observability plan.
- Counting on-demand `@claude fix` rounds against `MAX_REVIEW_ROUNDS` (a loop
  behavior change, tracked separately in harness-engineering.md's "not yet
  built" list).
