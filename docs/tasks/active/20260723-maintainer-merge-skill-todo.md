# Maintainer Merge skill

Add a project skill that documents the maintainer squash-merge flow for
(fork / agent-pipeline) PRs: resolve conflicts, wait for the real required
checks, fold combined effort into the squash message, and merge past
branch protection as the repo owner.

## Motivation

Merging PR #522 (a fork agent-pipeline PR, `agent/pr-effort-metrics`, touching
`.github/workflows/*`) surfaced several non-obvious steps that cost real time:

- `gh pr merge` refuses workflow-file changes without the `workflow` token scope.
- The commit-msg hook (`subject ≤ 70`) silently rejects the ~71-char
  auto-generated merge subject, leaving the resolution staged but uncommitted.
- Branch-protection `BLOCKED` almost always means the required *review*, not a
  failing check; the required contexts are `verify-self/browser/integration`,
  not the "CI" run.
- The combined effort is aggregated data in the PR's
  `<!-- agent-metrics-summary -->` comment (rendered by `scripts/agent/metrics.mjs`)
  — it must be copied, never fabricated, and omitted when absent. The renderer
  emits effort only (time/turns/tokens/sessions); `costUsd` is summed in
  `aggregate()` but never printed, so the copied block carries no dollar cost.

## Plan

- [x] Draft the skill as a personal skill and validate the flow end-to-end on #522.
- [x] Promote to a repo skill at `.claude/skills/maintainer-merge/SKILL.md`.
- [x] Encode the hard-won pitfalls (workflow scope, 70-char merge-subject hook,
      CI-vs-required-checks, effort-from-comments, fork push, concurrent-session
      recovery).
- [x] `pnpm verify:fast` green.
- [x] Open PR from `add-maintainer-merge-skill` (#529).

## Review

Opened as #529. `verify:self` green (244.7s); Codecov clean. CodeRabbit raised
three doc-accuracy findings, all addressed:

1. **effort/cost mismatch (Major)** — `renderSummary()` in
   `scripts/agent/metrics.mjs` emits effort only (Agents/Scope/Attempt/Sessions/
   Total-time/Turns/Tokens); `costUsd` is summed in `aggregate()` but never
   printed. Reworded the skill, lessons, and this todo from "effort/cost" to
   "effort" and noted cost is aggregated-but-unrendered.
2. **merge-subject length (Major)** — the example subject embedded `<branch>`,
   which could exceed the 70-char hook the skill itself warns about. Switched to
   a length-bounded `Merge main into PR #<N> (resolve conflict)`. Kept
   `origin/main` (wafflebase PRs always target `main`; a generic
   `origin/<base>` adds no value here).
3. **task record (Minor)** — checked off the completed plan items and wrote this
   Review section before merge.
