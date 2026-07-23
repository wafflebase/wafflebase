# Maintainer Merge skill

Add a project skill that documents the maintainer squash-merge flow for
(fork / agent-pipeline) PRs: resolve conflicts, wait for the real required
checks, fold combined effort/cost into the squash message, and merge past
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
- The combined effort/cost is aggregated data in the PR's
  `<!-- agent-metrics-summary -->` comment (rendered by `scripts/agent/metrics.mjs`)
  — it must be copied, never fabricated, and omitted when absent.

## Plan

- [x] Draft the skill as a personal skill and validate the flow end-to-end on #522.
- [x] Promote to a repo skill at `.claude/skills/maintainer-merge/SKILL.md`.
- [x] Encode the hard-won pitfalls (workflow scope, 70-char merge-subject hook,
      CI-vs-required-checks, effort-from-comments, fork push, concurrent-session
      recovery).
- [ ] `pnpm verify:fast` green.
- [ ] Open PR from `add-maintainer-merge-skill`.

## Review

(to fill after PR)
