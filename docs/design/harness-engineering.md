---
title: harness-engineering
target-version: 0.2.0
---

# Harness Engineering

## Summary

This document defines the harness engineering strategy for Wafflebase:
verification lanes, architectural constraints, quality gates, agent-oriented
feedback loops, and local/CI reproducibility.

The term "harness engineering" describes the practice of building tooling and
constraints that keep AI agents — and human engineers — producing reliable,
maintainable software. Where context engineering asks *what should the agent
see*, harness engineering asks *what should the system prevent, measure, and
correct*.

As of 2026-03-11, phases 1 through 20, 22, and 23 are completed. Browser
visual and interaction lanes are integrated into `verify:self` with graceful
Chromium skip. Docker-based browser testing ensures consistent font rendering
across macOS and CI (Ubuntu). Structured JSON lane reports are generated per
lane and as a summary. Dependency freshness (vulnerability + outdated package
detection) is integrated into `verify:entropy`. PR verification evidence is
automated via CI artifact upload and auto-comment on PRs. Remaining work
focuses on agent observability.

## Principles

These five principles, adapted from
[OpenAI's harness engineering practice](https://openai.com/index/harness-engineering/),
guide how we design and evolve the Wafflebase harness.

### 1. Information Accessibility — "A Map, Not a Manual"

What agents can't see doesn't exist. Keep institutional knowledge in the
repository as structured, queryable artifacts — not in external docs or tribal
knowledge.

**How we apply this:**
- `CLAUDE.md` at repo root serves as a concise map (~100 lines) pointing to
  deeper sources of truth in `docs/design/`, `packages/*/README.md`.
- Design documents live in `docs/design/` and are cross-linked from the root.
- Task history is tracked in `docs/tasks/` with paired todo/lessons files.
- Harness policy is externalized to `harness.config.json` (versioned,
  reviewable).

### 2. Mechanical Enforcement — "Constraints Over Documentation"

Text-based guidelines drift. Enforce architectural rules programmatically so
that violation is technically impossible, not merely discouraged.

**How we apply this:**
- Frontend architecture boundaries enforced via ESLint
  (`packages/frontend/eslint.arch.config.js`): API, hooks, components, UI, and
  types layers cannot import across boundaries.
- Backend architecture boundaries enforced via ESLint
  (`packages/backend/eslint.arch.config.mjs`): controller, database, auth,
  user, and document modules are isolated.
- Zero-warning lint gate: no warning suppression, warnings are build failures.
- Frontend chunk budgets enforced mechanically
  (`scripts/verify-frontend-chunks.mjs`), not by code review.
- ANTLR generated files are `@ts-nocheck` by convention — regeneration is the
  only valid edit path.

### 3. Visual Feedback — "Give the Agent Eyes"

Agents need observable, verifiable feedback — not just pass/fail. Visual
baselines, interaction replays, and deterministic screenshots let agents (and
humans) see what changed.

**How we apply this:**
- Browser screenshot baselines via Playwright (desktop + mobile profiles).
- Interaction regression tests replay cell input, formula evaluation, and
  scroll behavior in a real browser.
- Canvas-based rendering makes visual regression testing essential — DOM
  diffing alone is insufficient.

### 4. Capability-First Debugging

When the harness fails or agents struggle, ask "what capability is missing in
the environment?" rather than "why is the agent broken?" Treat agent failure
as a signal to improve the harness.

**How we apply this:**
- Each completed phase has a paired lessons file
  (`docs/tasks/archive/*/lessons.md`) capturing what went wrong and what harness
  improvement fixed it.
- Flaky tests are treated as harness bugs (missing determinism), not test bugs.
- New verification lanes are added when a class of regression goes undetected.

### 5. Entropy Management — "Garbage Collection for Codebases"

Codebases accumulate entropy: dead code, inconsistent patterns, documentation
decay. The harness must include cleanup loops that detect and reduce entropy
systematically.

**How we apply this:**
- Lint warning cleanup phases (9-10) established a zero-warning baseline.
- Build chunk cleanup (phase 11) removed dead manual chunk splits.
- Task lessons files capture recurring patterns for future prevention.
- Architecture lint prevents new boundary violations from accumulating.

## Goals

- Keep verification deterministic and reproducible between local and CI.
- Fail fast on signal-quality regressions (lint noise, oversized bundles,
  visual drift).
- Make integration validation executable with one local command.
- Keep harness policy configurable and reviewable in versioned files.
- Enforce architectural boundaries mechanically, not by code review.
- Provide observable feedback loops for both human and agent workflows.

## Non-Goals

- Replace the CI provider or pipeline framework.
- Add broad test sharding/optimization before reliability goals are met.
- Introduce path-based selective execution ahead of baseline stability.
- Build custom LLM-based linters before deterministic rules are exhausted.

## Local Git Hooks

Git hooks provide local defense layers in addition to CI. All hooks live in
`.githooks/` and are activated automatically via `core.hooksPath` (set by the
`postinstall` script — no manual setup required).

### Pre-Commit Hook

Runs `pnpm verify:fast` before every commit.

- **Scope:** architecture + lint + typecheck + unit tests (~11 s).
- **Out of scope:** builds, visual regression, entropy — these are caught by
  the pre-push hook.
- **Bypass:** `git commit --no-verify` skips the hook for emergencies.

### Pre-Push Hook

Runs `pnpm verify:self` before every push.

- **Scope:** everything in `verify:fast` plus sheet/frontend/backend/cli
  builds, frontend chunk budget gate, and entropy checks (dead code, doc
  staleness, dependency freshness).
- **Out of scope:** browser and integration tests — these require Docker
  Chromium / PostgreSQL and are covered by `verify:ci` in CI.
- **Purpose:** catches build failures, broken doc refs, and dead code before
  they reach the remote — issues that are too slow for per-commit but should
  not land on a shared branch.
- **Bypass:** `git push --no-verify` skips the hook for emergencies.

## Claude Code Hooks

Claude Code hooks extend mechanical enforcement to the agent level. Where
the git pre-commit hook catches violations at commit time, Claude Code hooks
catch them at edit time — before the agent writes invalid code.

Hooks are registered in `.claude/settings.json` (team-shared, git-tracked).
Hook scripts live in `scripts/hooks/`.

| Hook | Event | Purpose |
|---|---|---|
| `scripts/hooks/guard-generated-files.sh` | PreToolUse(Edit\|Write) | Blocks editing ANTLR-generated files in `packages/sheets/antlr/` (`.g4` allowed) |
| `scripts/hooks/check-arch-boundary.sh` | PostToolUse(Write) | Runs arch lint after new files in frontend/backend (informational) |

### Adding New Hooks

1. Create a script in `scripts/hooks/` that reads JSON from stdin.
2. Parse `tool_input.file_path` from the input.
3. Exit 0 to allow, exit 2 to block (STDERR is fed to Claude as context).
4. Register in `.claude/settings.json` under the appropriate event.

## Lane Contract

### Self-Contained Lanes (no external services)

| Command | Purpose |
|---|---|
| `pnpm verify:architecture` | Frontend/backend import boundary checks |
| `pnpm verify:fast` | Architecture + lint + unit tests |
| `pnpm verify:frontend:chunks` | Built JS chunk size/count gate |
| `pnpm verify:frontend:visual` | Playwright screenshot baseline (desktop+mobile) |
| `pnpm verify:frontend:interaction` | Browser interaction regression (cell input, formula, scroll) |
| `pnpm verify:browser:docker` | Browser visual+interaction via Docker (CI-consistent) |
| `pnpm verify:entropy` | Dead-code (knip) + doc-staleness entropy gate |
| `pnpm verify:self` | Runner: `verify:fast` + builds + chunk budgets + entropy; generates `.harness-reports/` JSON |

### Integration Lanes (require database)

| Command | Purpose |
|---|---|
| `pnpm verify:integration` | Prisma migrate + backend e2e |
| `pnpm verify:integration:local` | Skip integration when DB is unreachable |
| `pnpm verify:integration:docker` | One-command: postgres up + integration + stop |
| `pnpm verify:integration:repeat` | Repeat-run stability check (default 3 runs) |

### CI Lanes (require Docker Chromium + database)

| Command | Purpose |
|---|---|
| `pnpm verify:ci` | Runner: browser visual/interaction + integration; generates CI summary report |

### Composite Lanes

| Command | Purpose |
|---|---|
| `pnpm verify:full` | `verify:self` + `verify:ci` |

### CI Contract

- `verify-self` job runs first (no external services).
- `verify-browser` job depends on `verify-self` and runs browser visual +
  interaction tests inside a Docker container for font-rendering consistency.
- `verify-integration` job depends on `verify-self` and provisions PostgreSQL.
- Harness reports (`.harness-reports/`) are uploaded as CI artifacts (14-day
  retention).
- On PRs, CI automatically posts a verification summary comment with per-lane
  results for both `verify:self` and `verify:integration`.

## Dependency Layering

Architectural boundaries enforce a directed dependency flow. Violations are
caught by lint, not code review.

### Frontend

```
types/lib → api → hooks → components/ui → app (pages)
```

- `types/lib`: no imports from other layers
- `api`: cannot import `app`, `components`, `hooks`
- `hooks`: cannot import `app`
- `components/ui`: cannot import `app`, `api`

### Backend

```
database → auth/user/document → controllers/modules
```

- `database`: cannot import auth, user, document, datasource, share-link
- `auth`: cannot import document, datasource, share-link
- `user`: cannot import auth, document, datasource, share-link

## Completed Phases (1-20, 22)

| Phase | Scope | Status |
|---|---|---|
| 1 | Root verification lanes + PR evidence baseline | Completed |
| 2 | Frontend/backend architecture boundary lint | Completed |
| 3 | Self-contained vs integration lane split in CI | Completed |
| 4 | Frontend migration smoke tests | Completed |
| 5 | Local integration reachability wrapper | Completed |
| 6 | Auth refresh single-flight smoke coverage | Completed |
| 7 | Shared frontend API HTTP error helper + tests | Completed |
| 8 | Datasource API error handling alignment | Completed |
| 9 | Frontend lint warning cleanup | Completed |
| 10 | Zero-warning frontend lint gate | Completed |
| 11 | Frontend build chunk signal cleanup (manualChunks) | Completed |
| 12 | Frontend chunk size budget gate | Completed |
| 13 | Frontend chunk count guardrail | Completed |
| 14 | Deterministic integration runner + docker local path | Completed |
| 15 | Chunk-gate policy externalized to config | Completed |
| 16 | Deterministic frontend visual regression harness | Completed |
| 17f | Browser visual lane + interaction tests + interrupt-safe cleanup | Completed |
| 17 | Integration determinism hardening | Completed |
| 18 | Entropy detection automation (dead-code + doc-staleness) | Completed |
| 18a | Browser lanes integrated into verify:self (graceful Chromium skip) | Completed |
| 19 | Harness report artifacts (per-lane JSON + summary via verify-self runner) | Completed |
| 20 | PR evidence trust automation (CI artifact + auto-comment) | Completed |
| 22 | Dependency freshness detection (vulnerability + outdated in verify:entropy) | Completed |
| 23 | Docker-based browser test environment for CI-consistent rendering | Completed |

Phase 23 delivered:
- `Dockerfile.playwright` using Playwright official image (Chromium + fonts
  included). Version tag matches `packages/frontend/package.json`.
- `scripts/run-browser-tests-docker.sh` wrapper with modes: `visual`,
  `visual:update`, `interaction`, `all`. Validates Playwright version match,
  runs with host UID/GID to preserve file ownership.
- `scripts/verify-browser-lanes.mjs` skips Chromium existence check when
  `WAFFLEBASE_DOCKER_BROWSER=true` (Docker image bundles Chromium).
- `packages/frontend/scripts/verify-visual-browser.mjs` warns when updating
  baselines outside Docker.
- CI `verify-browser` job builds Docker image and runs browser lanes in
  container. Uploads `*.actual.png` artifacts on failure.

Phase 17 delivered:
- Shared integration test helpers (`packages/backend/test/helpers/integration-helpers.ts`):
  clearDatabase, createUserFactory, describeDb, parseDatabaseUrl, env defaults.
- Timestamp nondeterminism eliminated via `jest.useFakeTimers()` in controller
  contract tests.
- Postgres version pinned to 16 in `docker-compose.yaml` (matches CI).
- Repeat-run stability script: `pnpm verify:integration:repeat`.

Detailed task records:
- `docs/tasks/active/` for in-progress work
- `docs/tasks/archive/2026/02/` for completed phase history

## Top-Level Plan Status

| ID | Goal | Principle | Status | Next |
|---|---|---|---|---|
| A | Fail on breakage by default | Mechanical Enforcement | Completed | Maintain zero-warning, zero-drift baseline |
| B | Two-lane verification split | Mechanical Enforcement | Completed | Stable; improve integration determinism |
| C | Frontend regression harness | Visual Feedback | Completed | Browser lanes in verify:self; Docker-based CI provisioning delivered (Phase 23) |
| D | Agent-oriented contracts | Information Accessibility | In progress | Lane reports + PR auto-evidence (Phases 19-20); failure-summary digest delivered (`scripts/agent/summarize-ci.mjs`); autonomous contribution loop (Phase 24) |
| E | Entropy cleanup loop | Entropy Management | Completed | Dead-code + doc-staleness + dependency freshness delivered |

## Remaining Work

### Phase 21: Agent Observability Stack

**Principle:** Visual Feedback + Capability-First Debugging — give agents
direct access to runtime signals.

Goal: Enable agents to self-diagnose failures using structured telemetry.

Deliverables:
- Structured logging format for backend services (JSON, correlation IDs).
- Per-branch or per-PR observability context (log grouping by change).
- Agent-queryable failure summaries from lane report artifacts.
  **Delivered** by `scripts/agent/summarize-ci.mjs`, which reads the
  `.harness-reports/` reports (the summary + per-lane files that `verify:self`
  already emits) and prints a ranked root-cause digest (failing lane + its
  failure summary, downstream skips noted). Consumed by the autonomous
  contribution loop below.

Done criteria: An agent can diagnose a CI failure from report artifacts
without human interpretation.

### Phase 24: Autonomous Contribution Loop

**Principle:** Mechanical Enforcement + Capability-First Debugging — drive the
existing human workflow autonomously while keeping every gate a human already
relied on.

Goal: When a human posts an issue, an agent plans, implements, self-reviews, and
iterates on CI/review feedback until the PR is ready for a **final human review**
before merge. Maintainer review, merge, release, and deploy remain human.

This is a thin orchestration layer over the existing harness — it reuses
CLAUDE.md/CONTRIBUTING.md as the process source of truth, the `verify:*` lanes,
the `.claude/settings.json` hooks, and the CI `<!-- harness-verification -->`
evidence comment. It adds no parallel process; it triggers Claude Code
(`anthropics/claude-code-action`) and enforces one human review gate.

Components:
- **Kickoff** — `.github/workflows/agent-implement.yml`: a trusted-author
  `@claude` mention on an issue (or manual dispatch) runs Claude Code headless,
  which follows the standard task workflow and opens a **draft** PR from an
  `agent/<issue#>-<slug>` branch. Structured spec via
  `.github/ISSUE_TEMPLATE/agent-task.yml`.
- **Develop-review loop (CI)** — `.github/workflows/agent-iterate-ci.yml`: on CI
  failure for an `agent/` branch, `scripts/agent/summarize-ci.mjs` (Phase 21)
  feeds the diagnosis back to the agent, which pushes a fix. A bounded attempts counter
  pages a human instead of looping forever.
- **Develop-review loop (review)** — `.github/workflows/agent-review-reply.yml`:
  a `@claude` mention in a PR/review thread has the agent address the finding (or
  push back with reasoning) in-thread.
- **Review panel** — `.github/workflows/agent-review-panel.yml`: on green CI for a
  base-repo `agent/` branch (fork-originated `workflow_run` events are rejected),
  ONE orchestrator process (`scripts/agent/review-panel.mjs`, Claude Agent SDK)
  spawns a FRESH read-only subagent per **lens** — `correctness`, `security`,
  `design-fit`, `test-adequacy` (declared data-drivenly in
  `scripts/agent/lenses/lenses.json` + one rubric `.md` each). Each subagent has
  read-only tools only (Read/Grep/Glob; no branch-code execution), runs with
  `settingSources: []` (so the untrusted branch's `.claude` hooks/settings are
  never loaded — the workflow also strips `.claude/` and installs the SDK in a
  separate UNPRIVILEGED `deps` job so no install runs with the secrets), and
  returns findings (schema-requested, then locally shape-validated + fail-safe
  severity-normalized) classified `critical`/`major`/`minor`/`nit`. A per-finding
  **verifier** subagent then tries to refute each blocking finding and drops it
  ONLY on a high-confidence explicit refute — any uncertainty keeps the finding
  (fails toward blocking, so the false-positive lever can't swallow a real bug). The
  **trusted orchestrator** (run from a `main` checkout, via the shared
  `scripts/agent/severity.mjs` rule) computes each lens's conclusion — the
  subagents only classify — and the job records one unforgeable
  **`agent-review-<lens>` check run** per lens (the author agent lacks
  `checks:write`). On all-pass it invokes the ready gate; on any failure it feeds
  the combined findings to the author in a bounded fix loop (pages after
  `MAX_REVIEW_ROUNDS`). The `design-fit` lens additionally reads the originating
  issue (via `Fixes #N`) for spec-conformance — but ONLY when that issue is
  labelled `agent:candidate` AND authored by a non-Bot account (otherwise the
  author agent, which holds `issues:write`, could hand itself an arbitrary spec);
  any other referenced issue is not ingested. Issue/diff text is untrusted data,
  and an LLM reviewer can still be swayed by prompt injection — the human merge
  gate is the backstop. Same model across lenses for now; a per-lens `model`
  field makes diversity a one-field change.
  - **False-negative hardening (the verifier only fights false *positives* — it
    drops findings, it can't add a missed one).** Two measures raise recall so a
    real issue isn't silently missed, motivated by a live case where the
    correctness lens flagged a regression, then reviewed the *same unchanged code*
    clean on a re-run:
    1. **Sampling + union.** Each lens runs `samples` times (per-lens field in
       `scripts/agent/lenses/lenses.json`, default 2) and the findings are UNIONed — any sample's
       finding enters the gate. The union goes through the same conservative
       `coerceFindings`/`dedupeFindings` (identical file+summary collapse to the
       highest severity; distinct bugs never merge), and the verifier refute pass
       is the precision counterweight. No LLM/semantic merge — that could
       over-merge two distinct bugs into one, reintroducing the miss.
    2. **Cross-round re-check.** Each round persists its blocking findings in the
       per-lens check run's `output.text`; the next round reads the latest prior
       `agent-review-<lens>` findings (`--prior-findings`) and re-verifies each
       against the *current* diff with the same biased-to-keep refute pass. A
       prior finding survives unless it is confidently *resolved* — so it can't
       vanish just because a later fresh pass missed it (only because it was
       actually fixed). Unresolved priors merge (deduped) into the round's findings.

    Both lower false-negative odds; neither makes the panel safe to self-promote —
    the human review gate stays the backstop.
- **Ready gate** — `scripts/agent/mark-ready.mjs`, invoked by the review-panel
  workflow on all-pass: promotes draft → ready only when the **"CI" workflow run**
  for the head SHA concluded `success` (read via the Actions API, not the
  author-writable verification comment), **every** required `agent-review-<lens>`
  check concluded `success` (`--require-checks`), and AI authorship is disclosed.
  Gates 1 and 2 are unforgeable — evidence a separate actor produced. Gate 3
  (disclosure) is a required self-attestation (belt-and-suspenders with the
  commit-trailer hook). The gate only flips draft → ready; it has no merge
  authority. The `agent-review-<lens>` checks must **never** be configured as
  sufficient-for-merge on their own — a **required human approving review**
  (branch protection: ≥1 approval + dismiss-stale) stays the non-bypassable merge
  gate (the backstop for LLM-reviewer prompt injection). CODEOWNERS is scoped to
  the pipeline's *own* files, so it additionally requires an owner's review for
  changes to the harness itself, but the repo-wide agent-PR gate is the
  branch-protection approval, not CODEOWNERS.
- **Agent state (advisory single-value label)** — `scripts/agent/set-state.mjs`
  keeps **exactly one** `agent:<state>` label on the PR at a time
  (`implementing → awaiting-ci → reviewing → fixing → ready | blocked`), replacing
  the old additive `agent:iterating` / `agent:needs-human-review` labels (which
  could co-exist, and where `needs-human-review` ambiguously meant both "promoted"
  and "gave up"). `computeLabelSet` replaces the whole label set (atomic PUT),
  stripping every lifecycle *and* legacy label while preserving non-agent labels
  and the issue-side `agent:candidate` provenance. States are set inline by the
  trusted steps that already run — `reviewing` (review-panel), `fixing` (fix /
  iterate-ci), `ready` (mark-ready on promotion), `blocked` (every paging path);
  `implementing` is set by the kickoff agent and `awaiting-ci` is derived-only.
  **The label is a projection, never a gate** — no `if:` reads it (gates stay on
  check runs / CI conclusion / job results / the paged-comment latch). `set-state
  reconcile` re-derives the state from those unforgeable signals and overwrites
  drift; it runs on the stalled path and can be invoked manually.
- **Provenance** — `scripts/hooks/require-ai-disclosure.sh` (PreToolUse Bash,
  gated on `WAFFLEBASE_AGENT_AUTONOMOUS`) enforces an
  `Assisted-by: Claude Code (autonomous)` commit trailer on autonomous runs.

Human gate (mechanical, not prompt-based): branch protection on `main` requires a
human approving review + CI green + dismiss-stale-approvals; the `agent-implement`
kickoff also fails closed unless that protection is present. The agent token is
non-admin; the pipeline never calls `gh pr merge`. "You sign off on every line"
moves to the approving human reviewer.

### Threat model & residual risks (read before arming)

- **Not fully "dormant" on merge.** The workflows are inert until
  `vars.AGENT_PIPELINE_ENABLED=true`, but three things take effect on merge:
  `.github/CODEOWNERS` (scoped to the pipeline's own files, not repo-wide), the
  `.github/ISSUE_TEMPLATE/agent-task.yml` issue template (appears in the chooser),
  and the `scripts/hooks/require-ai-disclosure.sh` hook registration (a no-op
  unless `WAFFLEBASE_AGENT_AUTONOMOUS=true`). So this PR is a governance change,
  not a zero-effect one.
- **The high-value asset is the secrets, not the draft flag.** The verdict/ready
  architecture makes the *draft→ready* decision unforgeable, but that flag has no
  merge power (a human CODEOWNER must still approve). The real asset is
  the Claude auth secret (`ANTHROPIC_API_KEY`, or `CLAUDE_CODE_OAUTH_TOKEN` for
  a `claude setup-token` subscription token) + the write-capable App token, held by the code-executing
  agent jobs (`agent-implement`, `agent-iterate-ci`, the review `fix` job) which
  run `pnpm install` (branch `postinstall`) and an unrestricted-`Bash` agent on
  the branch. An adversarially prompt-injected author agent could exfiltrate
  them there. This is inherent to running an autonomous coding agent with an API
  key; it is NOT defended by the review gate. Mitigations: the protected `agent`
  environment (optional per-run human approval), the enablement switch, fork-
  origin rejection, and treating the Claude auth secret as least-privilege and
  rotatable. Adopters must accept this risk consciously.
- **The agent-state label is forgeable and advisory.** The author agent holds
  `issues:write`, so it can set any `agent:<state>` (e.g. a fake `agent:ready`).
  This is acceptable because **nothing gates on the label** — it is a human-facing
  projection only — and `set-state reconcile` re-derives the true state from the
  unforgeable signals (CI conclusion, lens check runs, draft flag, paged latch) and
  overwrites drift. Never wire a workflow `if:` to read `agent:<state>`.
- **LLM-reviewer prompt injection.** The panel's lens subagents read an untrusted
  diff (and, for design-fit, the issue), so injected text can sway their severity
  classification; the per-finding verifier reduces but doesn't eliminate this. The
  human merge gate is the backstop; the `agent-review-<lens>` checks must never be
  sole merge authority.
- **"No human keystroke" is aspirational, phased.** The done-criterion below
  describes no human *authoring* keystroke. In early phases the `agent`
  environment SHOULD keep required reviewers (a human approves each secret-bearing
  run) — that deliberately inserts a keystroke and is worth it. Fully
  approval-free autonomy is a later phase, only once the (now unforgeable) loop
  bounds are trusted in practice.

Done criteria: A maintainer's `@claude` on a well-specified issue yields a green,
independently-reviewed, disclosed draft PR marked ready-for-review with no human
*authoring* keystroke between the mention and the review request — and no path for
the agent to reach `main`.

## Harness Policy

Harness policy is managed in `harness.config.json`:

```json
{
  "frontend": {
    "chunkBudgets": {
      "maxChunkKb": 500,
      "maxChunkCount": 60
    }
  },
  "entropy": {
    "deadCode": { "enabled": true },
    "docStaleness": { "enabled": true, "designDir": "docs/design" },
    "dependencyFreshness": { "enabled": true, "failOnCritical": true }
  }
}
```

Frontend chunk environment overrides:
- `FRONTEND_CHUNK_LIMIT_KB`
- `FRONTEND_CHUNK_COUNT_LIMIT`

Entropy detectors default to enabled; set `"enabled": false` to disable
individually for debugging. Dependency freshness `failOnCritical` fails the
gate when critical vulnerabilities are found.

## Definition of Harness v1 Completion

Harness v1 is complete when all are true:

1. Integration lane is reproducible locally without manual orchestration.
   **Status: Done** (`verify:integration:docker`).
2. CI failures are diagnosable in under 5 minutes from logs/reports.
   **Status: Done** (structured JSON reports per lane + summary via
   `scripts/verify-self.mjs` runner — Phase 19).
3. PR required verification evidence is automatically trustworthy.
   **Status: Done** (CI artifact upload + auto-comment on PRs — Phase 20).

## References

- [OpenAI: Harness engineering — leveraging Codex in an agent-first world](https://openai.com/index/harness-engineering/)
- [Martin Fowler: Harness Engineering](https://martinfowler.com/articles/exploring-gen-ai/harness-engineering.html)
