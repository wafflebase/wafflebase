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

- `CLAUDE_CODE_OAUTH_TOKEN` secret (scoped to a protected `agent` Environment) —
  the auth the SDK panel and every `claude-code-action` step consume. Confirm it
  authenticates with the one-press **Agent SDK Auth Smoke Test** workflow
  (`workflow_dispatch`) before arming; see the pre-arm runbook below.
- Branch protection on `main`: **require ≥1 human approving review** + CI green +
  dismiss-stale-approvals; agent token non-admin. (CODEOWNERS is scoped to the
  pipeline's own files, so it gates changes to the harness itself; the repo-wide
  agent-PR gate is the required approving review, not CODEOWNERS.) You may also
  require the per-lens `agent-review-correctness` / `-security` / `-design-fit` /
  `-test-adequacy` status checks (necessary), but they must **never** be
  sufficient-for-merge on their own: a human approving review stays required and
  non-bypassable, because an LLM reviewer can be swayed by prompt-injected diff
  text. The review checks are a pre-human triage signal, not merge authority.
- **Provide a GitHub App for git auth.** The pushing workflows mint an
  installation token via `actions/create-github-app-token` and pass it to
  `actions/checkout` (`token:`) and to `claude-code-action` (`github_token:`), so
  the agent's commits re-trigger CI — commits pushed with the default
  `GITHUB_TOKEN` do NOT, which would stall the iterate/review loops. Add repo
  secrets `AGENT_APP_ID` and `AGENT_APP_PRIVATE_KEY` (from the Claude GitHub App
  or a dedicated app installed on the repo with Contents/PRs/Issues read+write,
  **plus Administration: read** so the kickoff branch-protection preflight can run).
- **Create the labels** used by the pipeline so they are queryable and the label
  ops don't no-op: `agent:candidate`, `agent:iterating`, `agent:needs-human-review`.
- Approve the new workflows (first-run approval for Actions).
- **Set repo variable `AGENT_PIPELINE_ENABLED=true`** to arm the pipeline. Every
  agent workflow job is gated on it, so the whole feature stays inert until a
  maintainer flips it — even if the secrets/App are already configured.

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

## Security review (second pass) — addressed

- **Blocker — forgeable verdict**: the review job computed the verdict from the
  UNTRUSTED branch checkout, so the author agent could edit
  `read-review-verdict.mjs` / pre-bake `verdict.json` / add a `postinstall` to
  force `success`. Fixed: the review job runs NO `pnpm install`, the reviewer has
  no branch-code-exec tools and reviews statically, a stale `.agent-review` is
  cleared first, and the verdict is computed by `read-review-verdict.mjs` checked
  out fresh from `main` (`.trusted/`) after the reviewer runs. Residual: LLM
  prompt-injection can still sway the reviewer's findings — human merge is the
  backstop.
- **Major — workflow_run privilege escalation**: both `workflow_run` jobs now
  reject fork-originated events (`head_repository.full_name == github.repository`);
  the review job additionally executes no branch code while holding secrets.
- **Major — inconsistent auth on review-reply**: added the same
  `getCollaboratorPermissionLevel` write-access check as `agent-implement`.
- **Minor — policy/dormancy**: every job is gated on `vars.AGENT_PIPELINE_ENABLED`,
  so the pipeline is inert until a maintainer explicitly arms it; the
  Copilot-vs-Claude coexistence question is flagged in the PR for the team.

## Security review (third pass) — addressed

- **Minor — self-attestable CI gate**: `mark-ready.mjs` gate #1 parsed the
  `<!-- harness-verification -->` PR comment, which the author agent could post
  itself (issues:write). Fixed: it now reads the authoritative "CI" workflow-run
  conclusion for the head SHA via the Actions API (the author cannot forge a CI
  run); added `actions: read` to the promote job. Now all three gates are
  evidence a separate actor produced.
- **Minor — LLM-reviewer injection residual**: documented that the
  `agent-review-<lens>` checks must never be configured sufficient-for-merge;
  a human approving review (branch protection) stays required and non-bypassable (design doc + the
  branch-protection prerequisite above).
- **Escalation (owner decision)**: adopting a standing write-capable autonomous
  contributor, accepting the disclosed injection residual, and the
  Copilot-vs-Claude coexistence question are maintainer calls — not code defects.
  The pipeline stays dormant (`AGENT_PIPELINE_ENABLED` unset) until they decide.

## Security review (fourth pass) — addressed

- **Forgeable attempt counters**: both loop bounds moved off deletable PR-comment
  counters (the agent holds issues:write) to append-only signals it cannot edit —
  iterate-ci counts failed CI runs (Actions history, +`actions: read`); the review
  loop counts failed `agent-review-<lens>` check runs across the PR commits
  (check runs need checks:write, which the author lacks).
- **Silent-stall crash**: `read-review-verdict.mjs` guarded against
  null/array/primitive verdicts (`JSON.parse("null")` used to throw before the
  fail-closed path); added a `stalled` job that pages a human if the review job
  dies for any other reason.
- **Branch-protection now verified**: `agent-implement` fails closed at kickoff
  unless `main` requires a human review (needs App `Administration: read`).
- **CODEOWNERS de-scoped**: removed the repo-wide `* @owner` rule (it would
  re-route all PR reviews on merge); it now owns only the pipeline's own files.
  The agent-PR human gate rests on branch protection's required approval.
- **Bot self-trigger guard**: `agent-review-reply` ignores comments from Bot
  accounts (the agent's own `@claude`-bearing replies can't re-trigger it).
- **Branch creation** in the kickoff prompt made explicit (`git checkout -b` from
  `main`), not left to "already checked out" ambiguity.
- **Honest framing corrected** (docs + PR): gate 3 (disclosure) is a required
  self-attestation, not separate-actor evidence; the real asset is the
  secrets in the code-executing jobs (inherent risk, documented with mitigations),
  not the draft flag; "no human keystroke" clarified as no *authoring* keystroke.
- **Non-issue — HARNESS_EOF heredoc**: the kickoff prompt content is no longer
  agent-influenced (quoted heredoc + numeric-only substitution; the agent reads
  the issue itself), so the fixed delimiter can't collide with injected text.

## Review panel — one orchestrator, four subagents (replaces the single reviewer)

- [x] `scripts/agent/severity.mjs` — shared block-iff-critical/major rule, imported
      by both `read-review-verdict.mjs` and the orchestrator (one source of truth).
- [x] `scripts/agent/lenses/lenses.json` + `{correctness,security,design-fit,
      test-adequacy}.md` rubrics (block-on-concrete, stay-in-lane, treat-as-data).
- [x] `scripts/agent/review-panel.mjs` — Agent SDK orchestrator: parallel per-lens
      subagents (read-only), per-finding verifier refute pass (drops only on explicit
      refuted; keeps on uncertainty), synthesize+dedup, trusted per-lens verdicts.
      + `scripts/agent/package.json` (SDK dep — pin/verify version + add a lockfile).
- [x] `.github/workflows/agent-independent-review.yml` → `agent-review-panel.yml`:
      single `review-panel` job (trusted-main orchestrator, per-lens
      `agent-review-<lens>` check runs, fail-closed) + generalized promote/fix/stalled.
- [x] `scripts/agent/mark-ready.mjs` — `--require-checks` (all named lens checks must
      pass); default = the 4 lens checks.

### Panel-specific maintainer notes
- The `review-panel` job needs `issues: read` (design-fit reads the issue) and
  installs the Agent SDK (`scripts/agent/package.json`); pin the SDK version and
  commit a lockfile for reproducibility.
- **SDK verified + pinned:** the Agent SDK options (`outputFormat: json_schema`,
  result `structured_output`, `permissionMode: dontAsk`, `settingSources: []`) and the
  `CLAUDE_CODE_OAUTH_TOKEN` auth path were confirmed against `@anthropic-ai/claude-agent-sdk`
  **0.3.217**, which is now pinned exactly + lockfiled (deps job uses `npm ci`).

### Pre-arm notes (neither is a hard blocker for the panel)
Neither item below is required for the panel to *function* — the panel fails
closed on any problem (no verdict → no promotion → human paged). They're
de-risking, not gates.

**1. Live credential check — OPTIONAL pre-flight.** A secret can't be validated
statically, so the dedicated smoke-test workflow lets you confirm
`CLAUDE_CODE_OAUTH_TOKEN` authenticates in one click *before* arming, instead of
discovering it from a failed-closed first panel run:

```
Actions ▸ "Agent SDK Auth Smoke Test" ▸ Run workflow      # workflow_dispatch
```

It installs the SDK without the token in scope, then runs `auth-smoke.mjs` with
the token (same `agent` secret + SDK auth path as the panel), so green ⇒ the
panel authenticates. Skipping it is safe: a bad token in a real run just fails
closed (the lens posts a failure check; the PR is not promoted).

**2. Branch-protection required-check — CONFIRMED no-op.** This PR deletes the
only producer of the `agent-independent-review` check. That would matter only if
that name were a **required** status check on `main` (a dangling required check
freezes all PRs to main). **Confirmed by the maintainer (2026-07-22): it is NOT
a required check** — #501 landed only the day before and the pipeline is dormant,
so nothing was ever wired as required. Nothing to remove on merge. Making the new
`agent-review-<lens>` checks required later is OPTIONAL (they're triage; the
human approving review stays the real gate) — if you do, add them via
Settings ▸ Branches ▸ main ▸ Require status checks and keep "require ≥1
approving review" non-bypassable.

### To validate before trusting (same discipline as the single-reviewer backtest)
- Re-run the panel over the 12-PR FP corpus + 8-mutant TP corpus; confirm per-lens
  routing (authz/hmac/secret→security; offbyone/await/null→correctness;
  store-bypass→design-fit; vacuous-test→test-adequacy) AND that the verifier pass
  does not refute any of the 8 real bugs.

## Panel security review (PR #508) — addressed

- **Verifier inverted (blocker)**: the refute pass dropped findings on model
  uncertainty (it was told to "return refuted if unsure"). Now it refutes only
  with a concrete reason + `confidence:"high"`; any doubt → confirmed, and
  `applyVerifications` drops ONLY on refuted+high (null/low/malformed → keep).
  Covered by `review-panel.test.mjs`.
- **npm install in the secret-bearing job (blocker)**: moved to a separate
  UNPRIVILEGED `deps` job (no secrets/checks:write) that hands `node_modules` to
  the review job as an artifact. (Still pin an exact SDK version + commit a
  lockfile before arming.)
- **SDK cwd = untrusted branch (blocker)**: `settingSources: []` in the
  orchestrator so branch `.claude` hooks/settings are never loaded/executed; the
  workflow also strips `.claude/` before running. (`settingSources` confirmed in SDK 0.3.217.)
- **No tests (blocker)**: added committed `node:test` files —
  `severity.test.mjs`, `checks.test.mjs`, `review-panel.test.mjs` (7 tests;
  `cd scripts/agent && npm test`). The pure helpers + the verifier-drop matrix +
  `--require-checks` all-pass/missing logic are covered.
- **Prefix check-run match → injection (major)**: round-bound + findings-gather now
  match the EXACT lens check names AND `app.slug === 'github-actions'`; the fix
  prompt fences the findings as untrusted `<panel-findings>` data.
- **Author-chosen spec (major)**: design-fit ingests the `Fixes #N` issue only if it
  is labelled `agent:candidate` and authored by a non-Bot; else it runs without a
  spec. The ingested issue is logged.
- **Lens list triplicated / gating unused / appliesWhen unusable (major)**: the
  orchestrator writes the authoritative per-lens `panel.json` (incl. `skipped`
  + `applicable` + `blocking`); the workflow reads the trusted manifest + panel.json
  (single source), emits `required_checks`, honours `gating`, and posts non-applicable
  lenses as `neutral` (not a fail-closed failure).
- **Breaking change / migration (major)**: check name is now per-lens
  `agent-review-<lens>` (not `agent-independent-review`). Before merge, update the
  branch-protection required-check list in the same window (documented in the PR).
