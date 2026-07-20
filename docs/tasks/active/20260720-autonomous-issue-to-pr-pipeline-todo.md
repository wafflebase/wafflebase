# Autonomous issue → ready-for-review PR pipeline

Add a thin orchestration layer that drives Claude Code (via
`anthropics/claude-code-action`) through the **existing** wafflebase workflow so
that a human posting an issue can get a ready-for-review PR without a human at the
keyboard. Final maintainer review, merge, release, and deploy stay human.

Design: `docs/design/harness-engineering.md` (new "Autonomous contribution loop"
section + Phase 21 completion).

## Principles

- Reuse, don't reinvent: CLAUDE.md/CONTRIBUTING.md are the process source of
  truth; prompts point at them rather than restating the workflow.
- Trust keys off CI-posted evidence (`<!-- harness-verification -->` comment +
  `.harness-reports/summary.json`), never the agent's self-report.
- The human approval gate is mechanical (branch protection), not prompt-based.
  The pipeline has no permission path to `main` and never merges.

## Tasks

- [x] `.github/ISSUE_TEMPLATE/agent-task.yml` — structured spec form.
- [x] `.github/workflows/agent-implement.yml` — kickoff (`@claude` mention,
      trusted-author gated, + `workflow_dispatch`).
- [x] `scripts/agent/summarize-ci.mjs` — Phase 21: lane reports → agent-readable
      failure digest (reads existing `.harness-reports/`).
- [x] `.github/workflows/agent-iterate-ci.yml` — react to CI failure on `agent/`
      branches via `workflow_run`, fix + push.
- [x] `.github/workflows/agent-review-reply.yml` — react to `@claude` review
      comments on `agent/` PRs.
- [x] `scripts/agent/mark-ready.mjs` — ready gate (CI green + independent-review
      check ✅ + disclosure) → `gh pr ready`.
- [x] `scripts/hooks/require-ai-disclosure.sh` — enforce AI-disclosure trailer on
      autonomous agent commits; register in `.claude/settings.json`.
- [x] Document the pipeline in `docs/design/harness-engineering.md`.

### Independent-reviewer MVP (added)

- [x] `scripts/agent/read-review-verdict.mjs` — normalize verdict.json → check-run
      conclusion. Severity scale `critical/major/minor/nit`; approves when only
      `minor`/`nit` remain; unknown severity → `major` (fail-safe); fails closed on
      missing/invalid verdict.
- [x] `.github/workflows/agent-independent-review.yml` — fresh read-only reviewer
      on green CI → `agent-independent-review` check run → promote on success, or
      bounded review-fix loop on changes-requested (replaces `agent-mark-ready.yml`,
      now removed; promotion is driven by reviewer approval, not CI success alone).
- [x] `scripts/agent/mark-ready.mjs` gate 2 now reads the check run (evidence-based)
      instead of the author's self-review comment.

## Rollout (see design doc)

Phase A manual dispatch → B CI iterate loop → C `@claude` kickoff → D review-reply
→ E broaden. Each phase validated end-to-end.

## Maintainer prerequisites (cannot self-provision)

- `ANTHROPIC_API_KEY` secret (scoped to a protected `agent` Environment).
- Branch protection on `main`: human approval + CODEOWNERS + CI green +
  dismiss-stale-approvals; agent token non-admin. Recommended: also require the
  `agent-independent-review` status check so the independent verdict is enforced
  at merge time too, not just at the ready gate.
- **Provide a GitHub App for git auth.** The pushing workflows mint an
  installation token via `actions/create-github-app-token` and pass it to
  `actions/checkout` (`token:`) and to `claude-code-action` (`github_token:`), so
  the agent's commits re-trigger CI — commits pushed with the default
  `GITHUB_TOKEN` do NOT, which would stall the iterate/review loops. Add repo
  secrets `AGENT_APP_ID` and `AGENT_APP_PRIVATE_KEY` (from the Claude GitHub App
  or a dedicated app installed on the repo with Contents/PRs/Issues read+write).
- **Create the labels** used by the pipeline so they are queryable and the label
  ops don't no-op: `agent:candidate`, `agent:iterating`, `agent:needs-human-review`.
- Approve the new workflows (first-run approval for Actions).

## Known limitations / robustness notes (from self-review)

- The AI-disclosure hook only inspects inline `-m/-am/--message` commits and is a
  belt-and-suspenders check; the authoritative disclosure gate is the PR-body
  check in `mark-ready.mjs`.
- The whole loop's progress depends on CI re-running on the agent's fix commits
  (see GitHub App note above). Validate this in Phase B.

## CodeRabbit review — addressed

- **Actor authorization**: `agent-implement.yml` now verifies the commenter has
  real repo write/maintain/admin (`getCollaboratorPermissionLevel`), not just
  `author_association`.
- **Reviewer failure no longer stalls**: independent-review's verdict/check-run
  steps use `always()` and the reviewer step is `continue-on-error`, so a reviewer
  crash fails closed → the fix job pages a human.
- **CI re-trigger**: all pushing workflows auth via a GitHub App token
  (`create-github-app-token` → checkout `token:` + action `github_token:`).
- **Pinned** `anthropics/claude-code-action` to the immutable v1 commit
  `af0559ee…` across all workflows.
- **Latest check-run** selected by `started_at` in the fix job (matches `mark-ready.mjs`).
- **Hook**: `printf` (not `echo`) for JSON piping; also matches `-am`.
- **Skipped — archive the task doc** (`pnpm tasks:archive`): premature. Per
  CONTRIBUTING, tasks are archived at merge time; this PR is still under review,
  so the todo/lessons stay in `active/` until merge.
