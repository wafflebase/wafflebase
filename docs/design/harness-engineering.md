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

As of 2026-03-11, phases 1 through 20, 22, and 23 are completed, and the
agent-oriented pipeline (Phases 24–27) has since shipped: the autonomous
contribution loop, the local Spec→PR front door, Tier-1 autonomous issue
hunting, and the panel feedback corpus all live in the `.github/workflows/`
`agent-*` workflows (e.g. `.github/workflows/agent-review-panel.yml`) and under
`scripts/agent/` (e.g. `scripts/agent/review-panel.mjs`, `scripts/agent/hunt.mjs`,
`scripts/agent/harvest.mjs`). Browser
visual and interaction lanes are integrated into `verify:self` with graceful
Chromium skip. Docker-based browser testing ensures consistent font rendering
across macOS and CI (Ubuntu). Structured JSON lane reports are generated per
lane and as a summary. Dependency freshness (vulnerability + outdated package
detection) is integrated into `verify:entropy`. PR verification evidence is
automated via CI artifact upload and auto-comment on PRs. Remaining work
is the rest of Phase 21's agent observability stack (structured backend
logging, per-branch observability context) and autonomous issue-filing
(Phase 26 Tier 2).

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
- Screenshots are compared with a perceptual per-pixel threshold plus a small
  mismatched-pixel budget (`pixelmatch`), not byte-exact PNG equality — Chromium
  antialiasing is not bit-reproducible across CI runs, so an exact check flakes
  on a handful of sub-pixel-jitter pixels. Tunable via
  `VISUAL_PIXELMATCH_THRESHOLD` / `VISUAL_MAX_DIFF_RATIO` /
  `VISUAL_MAX_DIFF_PIXELS_FLOOR`; a `*.diff.png` is emitted on real mismatches.
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

**Branch-integrity gate.** `verify:self` records `HEAD` before the lanes and
re-reads it after each one. A lane that moves `HEAD`, or leaves it unreadable,
fails **even if it exited 0** — a lane can corrupt the repository and still
report success. The lane report carries `status: "fail"` with a non-zero
`exitCode` even when the lane's own exit code was 0, so no consumer is handed a
report that reads as both failed and successful.

The gate detects *net* movement of `HEAD` only. A lane that commits and resets
back, rewrites another ref, or mutates the index or stash is **not** covered;
the narrow guarantee is stated deliberately, because overclaiming invites
trusting a green run. It exists because a test fixture escaping its temp
directory replaced a working branch's tip three times, and one of those states
reached a public PR as a diff appearing to delete every file in the repo.

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

## Completed Phases (1-20, 22, 23)

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
| D | Agent-oriented contracts | Information Accessibility | In progress | Lane reports + PR auto-evidence (Phases 19-20); failure-summary digest delivered (`scripts/agent/summarize-ci.mjs`); autonomous contribution loop shipped (Phases 24-27); remaining: Phase 21 structured logging/observability context + autonomous issue-filing |
| E | Entropy cleanup loop | Entropy Management | Completed | Dead-code + doc-staleness + dependency freshness delivered |

## Agent-Oriented Phases (21, 24-27)

Phases 24–27 (autonomous contribution loop, local Spec→PR, Tier-1 issue hunting,
panel feedback corpus) have shipped; each phase body below states what is live
versus the narrower items still deferred. Phase 21 (agent observability) is
partially delivered — the agent-queryable failure summary landed; structured
backend logging and per-branch observability context remain.

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
- **Command dispatch** — the `@claude` mention is a command surface parsed by the
  shared `scripts/agent/command.mjs` (flexible/containment matching: a comment
  triggers a verb when it contains `@claude <verb>` anywhere, case-insensitive,
  first-occurrence wins). Each workflow runs a cheap `route` job that calls the
  parser and gates on the resulting verb, so the mention maps deterministically
  and the workflows never double-fire on each other. Verbs:
  - `@claude fix` (issue) → Kickoff (below). A bare `@claude` on an issue gets a
    help reply.
  - `@claude summarize` (PR) → `.github/workflows/agent-summarize.yml`: a
    READ-ONLY, no-checkout summary comment ("what does this PR do / good to go?").
    PR author OR maintainer, throttled to one per head SHA.
  - `@claude review` (PR) → `.github/workflows/agent-review-on-demand.yml`: runs
    the same lens panel (below) but ADVISORY — aggregates the findings into ONE PR
    comment, records NO check runs and drives no promote/fix, so it never touches
    the merge gate. Works on any PR incl. forks (read-only). PR author OR
    maintainer, throttled per head SHA.
  - `@claude loop` (PR) → `.github/workflows/agent-loop.yml`: MAINTAINER-ONLY;
    labels the PR `agent:managed` and re-runs CI to opt it into the full
    review→fix→promote machinery. Same-repo branches only (the fixer can't push to
    a fork → fork PRs get a note pointing at `@claude review`).
  - `@claude` + anything else (PR) → the review-reply arm (below). Note this arm
    acts ONLY on `agent/`-authored PRs; ordinary and `agent:managed` PRs are left
    to humans (it never pushes to a branch it did not author).
- **Kickoff** — `.github/workflows/agent-implement.yml`: a trusted-author
  `@claude fix` mention on an issue (or manual dispatch) runs Claude Code headless,
  which follows the standard task workflow and opens a **draft** PR from an
  `agent/<issue#>-<slug>` branch. Structured spec via
  `.github/ISSUE_TEMPLATE/agent-task.yml`.
- **Develop-review loop (CI)** — `.github/workflows/agent-iterate-ci.yml`: on CI
  failure for an agent-managed branch (an `agent/` branch, or a human PR labelled
  `agent:managed` via `@claude loop`), `scripts/agent/summarize-ci.mjs` (Phase 21)
  feeds the diagnosis back to the agent, which pushes a fix. A bounded attempts counter
  pages a human instead of looping forever.
- **Develop-review loop (review)** — `.github/workflows/agent-review-reply.yml`:
  a generic `@claude` mention (no command verb) in a PR/review thread has the
  agent address the finding (or push back with reasoning) in-thread. Restricted to
  `agent/`-authored PRs (the `is_agent` gate) — ordinary and `agent:managed` PRs
  are left to humans, since the arm only acts on branches it authored.
- **Review panel** — `.github/workflows/agent-review-panel.yml`: on green CI for a
  base-repo agent-managed PR (an `agent/` branch or an `agent:managed`-labelled PR;
  fork-originated `workflow_run` events are rejected),
  ONE orchestrator process (`scripts/agent/review-panel.mjs`, Claude Agent SDK)
  spawns a FRESH read-only subagent per **lens** — `correctness`, `security`,
  `design-fit`, `test-adequacy`, `blast-radius` (declared data-drivenly in
  `scripts/agent/lenses/lenses.json` + one rubric `.md` each). The reviewed
  artifact is the branch diff against `main`, minus ANTLR generated *tooling*
  artifacts (`packages/sheets/antlr/*.interp|.tokens` — nothing loads them at
  runtime, so no lens can act on them). The generated `.ts` files stay IN the
  diff even though they are the larger half: they are executable code, and
  excluding them would leave every lens blind to a hand-edit that
  `packages/sheets/antlr/Formula.g4` does not justify, whose only compensating
  control (`scripts/hooks/guard-generated-files.sh`) is bypassable out-of-band.
  Re-excluding them requires a regen-and-diff lane first. The changed-FILE list
  is left unfiltered because it drives `lensApplies` → the required-check set, so
  a list that shrank mid-PR could un-require a lens that failed an earlier round. Each subagent has
  read-only tools only (Read/Grep/Glob; no branch-code execution), runs with
  `settingSources: []` (so the untrusted branch's `.claude` hooks/settings are
  never loaded — the workflow also strips `.claude/` and installs the SDK in a
  separate UNPRIVILEGED `deps` job so no install runs with the secrets), and
  returns findings (schema-requested, then locally shape-validated + fail-safe
  severity-normalized) classified `critical`/`major`/`minor`/`nit`, each with a
  separate `confidence` of `high`/`medium`/`low`. The two axes are deliberately
  independent: **`severity` is impact if the finding is real, `confidence` is how
  sure the lens is**, and the rubrics tell lenses never to downgrade severity to
  express doubt. Before this split the only channel for doubt WAS severity — the
  rubrics closed with *"when unsure, downgrade"* — which is the documented
  anti-pattern where a model investigates just as thoroughly and then declines to
  report, and is why the panel recorded zero `critical` findings in its first
  nineteen PRs. The rubrics are now **coverage-first**: report everything,
  including uncertain findings, and let the verifier filter. **Gating is
  unchanged and reads `severity` only** (`BLOCKING = {critical, major}`) — gating
  on confidence would rebuild the same clamp inside the trusted script. The
  confidence distribution is reported per PR so the axis can be seen to be in
  use; it is not shown to the fix agent, which must address every blocking
  finding regardless of how sure the lens was. A per-finding
  **verifier** subagent then tries to refute each blocking finding. It is
  deliberately **not given the diff**: the lens that raised the finding reasoned
  from that diff, so a verifier reading the same diff inherits its misreadings
  and confirms them — the correlated-error failure of naive review panels. It
  instead re-establishes the facts from the repository itself (Read/Grep/Glob
  against the branch checkout, capped at 8 turns), is told to distrust the
  finding's quoted evidence, and receives only the cumulative changed-FILE list
  so it can tell new code from pre-existing. Dropping is **grounded, not
  asserted** (`isDroppingVerdict`): the verdict must be an explicit `refuted`, at
  high confidence, naming one of `not-present | already-guarded | out-of-scope |
  pre-existing`, AND citing at least one location that is *shaped* like one
  (`file.ext:line`) — a bare non-empty string would let `"looks fine"` pass as
  evidence, which is the same unevidenced assertion in a citation's costume.
  Anything less — including a bare high-confidence refute, which used to be
  enough — keeps the finding (fails toward blocking, so the false-positive lever
  can't swallow a real bug). `pre-existing` additionally requires the changed-file
  list to be **authoritative**: complete, untruncated, and free of malformed
  entries, since a path absent for any of those reasons would otherwise read as
  "the PR didn't touch it". That is enforced in the trusted script, not only in
  the prompt — a prompt instruction the script does not check is not a rule. The
  metrics comment reports
  `refutedHighConfidence` and `dropped` separately; the gap between them is the
  count of confident refutations the gate declined to act on.
  It also reports **`errored`**, and that one is read FIRST because a non-zero
  value invalidates every number after it. A blocking finding whose verdict is
  `null` means the verifier session THREW; the orchestrator catches it and keeps
  the finding, which is the right default and a silent one. On #592 the panel hit
  `429 You've hit your session limit`, which is deliberately non-retryable, so
  every verifier call after that point threw and every verdict was discarded —
  output indistinguishable from a verifier that examined all 40 findings and
  confirmed each. A verifier outage makes the panel MORE blocking, not less (kept
  findings still gate), so this is a trust signal rather than a safety one: the
  check body now says *"the verifier did not run on N of M findings"* above the
  findings, because it changes how all of them should be read. The verifier is
  also given NO changed-file list and has no provenance ground: whether the change
  introduced the code is answered from git by the novelty gate, and deleting a
  finding because its location is old code is the action #583 established is
  wrong. Age demotes to a reported, non-gating lane; it never deletes. Dropping
  the block also bounds the verifier prompt's uncached tail to the finding itself
  — the list sat AFTER the finding, so it was re-billed on every verification.
  Both panel workflows now keep the panel's lens-stats artifact, and the on-demand
  review carries a one-line verifier/novelty tally in its comment; previously
  that path recorded nothing at all, which is why none of this was measurable.
  Findings carry a **`claimType`**, because the two shapes are verified in
  opposite directions. A `presence` claim ("this code is wrong") is refuted by
  looking it up where the finding says it is. An `absence` claim ("no test covers
  this", "no validation on this input") is refuted by FINDING ONE
  COUNTEREXAMPLE — a search whose failure is indistinguishable from the thing
  genuinely not existing. Running the presence procedure on an absence claim is
  why a false *"no CI workflow runs these tests"* survived #578: the
  counterexample was real and three hops away (`.github/workflows/ci.yml` →
  `pnpm verify:self` → `scripts/verify-self.mjs` → the `agent:tests` lane) and the
  verifier ran out of turns,
  so bias-to-keep confirmed it. Absence claims now get a counterexample-hunting
  prompt, the `searchedFor` list the lens recorded (so it searches where the lens
  did *not*), a `counterexample` refutation ground, and a larger turn ceiling
  (`VERIFIER_MAX_TURNS`, 20 vs 8). A third verdict, **`unresolved`**, exists so
  "I searched and could not disprove this" stops being reported as "confirmed" —
  it does **not** demote: `isDroppingVerdict` still requires an explicit
  `refuted`, so an unsettled finding gates exactly as a confirmed one does. That
  is deliberate. Absence claims are the entire output of test-adequacy and much
  of security and design-fit, so routing unsettleable ones off the gate would
  repeat the mistake the novelty gate had to correct. The finding is marked
  *"verifier could not settle this"* in the summary and counted in
  `verifier.absenceRaised`/`absenceRefuted`/`unresolved`, so a high `unresolved`
  against a low `absenceRefuted` is visible as absence claims riding through
  unchecked rather than being silently discounted.
  A **clustering** pass (`clusterFindings`) collapses RESTATEMENTS of one defect
  **before the verifier runs**, so each distinct defect is verified once rather
  than once per wording. `dedupeFindings` only catches byte-identical summaries, so
  #578 reported the same defect three times over — two wordings of one missing
  file, the deny-list bug as both a `critical` and a `major`, the deny-list-shape
  concern twice — and the verifier could not help, since it judges one finding at a
  time in isolation and re-runs a full session (and `git blame`) for each copy:
  the #578 shape would have paid for four redundant verifier sessions. Collapsing
  first removes that waste. The similarity metric is **not** re-derived:
  `findingSimilarity` in `scripts/agent/rounds.mjs` already owns it for the
  non-convergence detector, calibrated against real panel output with the overlap
  coefficient chosen over Jaccard for exactly this restatement pattern. It
  separated all four of #578's real duplicate pairs from all four of its real
  distinct pairs, with the distinct ones scoring 0.000 — so this needs **no model
  call**. Merging is not deletion, which is what makes that safe: every collapsed
  wording rides along in `mergedFrom` and is rendered (and reaches the fixer), the
  survivor takes the cluster's highest severity so a `critical` is never masked by
  a `major` restatement, it gates if any member gated, and `unsettled` propagates.
  The only thing removed is count inflation, reported as `clusters.collapsed`. The
  stated limitation: two wordings sharing no vocabulary score 0 and stay separate,
  which leaves the count inflated — the status quo, and the conservative direction.
  Running clustering *before* the verifier (it began *after* it, in #591) means
  the merge now decides what the verifier sees, so a wrong merge could let a
  representative's refutation drop a genuinely distinct wording that merged in and
  was never checked on its own. `resolveClusterVerdict` closes that: a
  representative refutation is honoured only when every folded BLOCKING wording is
  ALSO confidently refuted — otherwise the cluster is kept, carrying the surviving
  verdict. That re-verification runs only on the rare dropping verdict of a
  multi-member cluster, so the common confirmed path still pays for exactly one
  verifier session per cluster. Two further bounds: the threshold is conservative
  (the #578 distinct pairs scored 0.000, so they stay separate) and `mergeCluster`
  elects the strongest wording as representative (gating, then highest severity,
  then evidence-bearing), so the verifier judges the form most likely to gate and
  every folded wording is still rendered.
  A finding can now be clustered twice (fresh pass pre-verify, then again when a
  fresh survivor restates a carried-forward prior finding), so `mergeCluster`
  flattens the wordings each pass folded rather than overwriting them.
  A **novelty gate** (`scripts/agent/novelty.mjs`) then answers a question the
  verifier structurally cannot: *did this change PUT this line here, carrying
  code that already existed?* The verifier's independence means it never sees the
  base, so from inside the branch checkout a line a refactor MOVED and a line the
  change WROTE are identical, and the `pre-existing` ground is file-scoped so a
  function relocated into a new file legitimately fails it. #578 demonstrated the
  cost: a PR that lifted `classifyResult` verbatim into a new file had every
  pre-existing bug in it re-reported as introduced-here, confirmed by the
  verifier, and handed to the fixer.
  The question is deliberately NARROWER than "is this code old". Code age is not
  causation: a new guard bypassed by an untouched call site, a new caller
  reaching an old unguarded path, a test that stopped covering a branch — those
  defects live entirely in pre-base lines, and the blast-radius lens exists to
  find them (its rubric orders it to cite the bypassing site, "not the diff line
  that introduced the guard"; correctness and security carry the same out-of-diff
  mandate). Demoting on line age alone would route that whole class off the gate.
  So provenance takes **two** blames, and both must answer: plain `git blame`
  says which commit put the line at this offset, and `git blame -w -C -C -C` says
  which commit originally wrote that content. A line the change did not add is
  `pre-existing` and is **never** demoted. Only a line the change ADDED whose
  content predates the base is `relocated`, and that alone demotes. A whole-line
  `git grep` against the base tree is a fallback for the second question only
  when move-aware blame cannot answer (shallow clone) — never an override of it.
  All probes run in the trusted script via async `execFile` (array args, no
  shell, timeout); no capability is granted to a model. Every git invocation is
  built by `scripts/agent/git-env.mjs`, because **`cwd` and `-C` do not decide which repository
  git operates on — the environment does, and it wins.** git exports its location
  variables into every hook it runs, and `pre-push` runs `verify:self`, which
  reaches this module; unscoped, a probe under a hook answers about whatever
  `GIT_DIR` names. `repoScopedEnv` (reads) strips every location and behaviour
  variable and caps discovery at the repo's parent, so a non-repo path fails
  loudly instead of answering about an ancestor. `fixtureGitEnv` (writes, tests
  only) additionally pins `GIT_DIR`/`GIT_WORK_TREE`; pinning `GIT_DIR` alone is
  insufficient, because an inherited `GIT_INDEX_FILE` still makes `git add`
  rewrite another repository's index and leaves it corrupt. The result routes each
  blocking finding to a **lane** (`routeFinding`): `blocking` gates as before,
  `backlog` is reported with the base location that proves the code already
  existed but does not gate, is **filtered out of the fixer's checklist**, and is
  **not persisted** into the check's machine-readable findings (so it cannot
  reach the carry-forward or the non-convergence detector either); `discarded`
  remains reachable only through the unchanged `isDroppingVerdict`. Every
  uncertain path — no `--base-sha`, a shallow clone, a git failure, a finding
  with no `file:line`, a citation naming a different file — yields `unknown`,
  which keeps the finding blocking. There is deliberately no file-level fallback:
  demoting because a `file` string is absent from the changed-file list is a
  string comparison, not a git answer. Carried-forward prior findings are not
  routed at all, since their `line` was recorded against a tree the fixer has
  since rewritten. `--base-sha` is the merge-base computed by the workflow and
  passed in, never guessed: it is the same endpoint the reviewed diff uses, so
  "what changed" and "what counts as already-there" cannot diverge.
  `lensStats.lanes` reports `blocking`/`backlog`/`unknownOrigin` and
  `scripts/agent/metrics.mjs` renders it; read `unknownOrigin` first, since a zero `backlog`
  beside a high `unknownOrigin` means the gate ran blind rather than that nothing
  was relocated.
  **Token attribution.** Every SDK call is stamped with `{ lens, role }`
  (`role` ∈ `detection` | `verifier`) as `scripts/agent/ask.mjs` pushes its result
  to the shared execution log, so `scripts/agent/metrics.mjs`'s
  `attributionBreakdown` can split the panel's spend per lens and by
  detection-vs-verifier instead of one anonymous total — the effort summary renders
  it as a cost · weighted-tokens table. This is what makes "which
  lens, and is it the verifier?" answerable from the ledger rather than by guessing;
  it is measurement only and gates nothing.
  **Prompt caching (shared core).** The diff dominates the panel's prompt input and
  every session re-sent it, so the lens prompt is split in two: a cacheable
  `systemPrompt` prefix carrying the framing, the scope note and the diff, before
  `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`, and the lens's own identity + rubric after it in
  the user prompt. `createWarmupGate` then runs one session per DISTINCT prefix
  alone (the `~1.25×` cache write) and fans the rest out concurrently (`~0.1×` reads).
  Grouping is keyed on the prefix *bytes*, not on the lens, which is what lets two
  lenses handed the same slice share one warm-up; a prefix only one session will use
  is sent uncached, since a write nothing re-reads is a `~25%` loss.
  Byte-identity is the whole mechanism, and once every lens dropped to `samples: 1`
  (#607, #610) a lens could no longer share a prefix with itself — leaving cross-lens
  sharing as the only caching left, and excluding exactly the lenses with the biggest
  slices (`security` reads two classes more than the others; `design-fit` appended
  the issue spec, making its prefix unique on every PR). So the cacheable prefix is
  now the **shared core** — the file classes every code-reviewing lens has in common
  (`cacheCoreClasses`, derived from the manifest: `code`, `code-adjacent`, `policy`)
  — while each lens's remaining in-scope hunks and the issue spec ride uncached in
  the user prompt, where they already cost full price and, no other session sending
  those same bytes as a leading prefix, could never be shared anyway (another lens
  may read some of the same hunks — `docs` reads the prose part of `security`'s
  remainder — but as a different byte string, which caching cannot match). `splitLensDiff` guarantees `core + extra` is exactly
  that lens's own slice, so **no lens sees a hunk outside its scope**: file-class
  routing is unchanged, only the packaging is. A lens that does not read every core
  class (`docs`, prose-only) keeps its own slice and shares with nobody, as before.
  On a mixed PR at the shipped one-sample manifest this takes the projected
  prompt-input saving from `~23%` to `~50%` (five lenses on one warm-up instead of
  three); `scripts/agent/cache-report.mjs` renders the projection offline from the
  real prompt builders. Note the API matches a cacheable prefix as a *leading byte
  run* and the SDK exposes a single boundary, so nesting shorter slices inside longer
  ones would need multiple cache breakpoints and does not work here — sharing
  requires byte-*identity*, which is why the core is a common prefix rather than an
  ordering. The
  **trusted orchestrator** (run from a `main` checkout, via the shared
  `scripts/agent/severity.mjs` rule) computes each lens's conclusion — the
  subagents only classify — and the job records one unforgeable
  **`agent-review-<lens>` check run** per lens (the author agent lacks
  `checks:write`). On all-pass it invokes the ready gate; on any failure it feeds
  the combined findings to the author in a bounded fix loop (pages after
  `MAX_REVIEW_ROUNDS`, or earlier on **non-convergence** — see below). The
  `design-fit` lens additionally reads the originating
  issue (via `Fixes #N`) for spec-conformance — but ONLY when that issue is
  labelled `agent:candidate` AND authored by a non-Bot account (otherwise the
  author agent, which holds `issues:write`, could hand itself an arbitrary spec);
  any other referenced issue is not ingested. Issue and diff text — and the
  working tree the lenses Grep — are all untrusted data, and an LLM reviewer can
  still be swayed by prompt injection; see the risk register below for the
  mitigation stack. The human merge gate is the backstop. Same model across lenses
  for now; a per-lens `model` field makes diversity a one-field change.
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
       Every blocking lens runs at `samples: 1`. A second opus detection sample
       was the panel's single largest cost — detection dominated one L-size PR's
       ~$14 panel (#605, surfaced by the per-lens token attribution above) — so the
       second sample was dropped across the board to keep a panel runnable within
       one session limit. The recall the union bought is given up: a defect a
       single sample non-deterministically misses is no longer recovered by a
       second one. For the code-quality lenses the verifier, the tests, and CI
       still backstop a miss; for `security` there is **no** such backstop — a
       planted instruction or a pasted secret missed on the one sample is missed —
       so this is the sharpest edge of the trade, accepted for cost. `samples` is a
       per-lens field, so raising `security` (or any lens) back to 2 is a one-field
       change the moment the attribution table or a missed finding says it is worth
       the spend.
    2. **Cross-round re-check.** Each round persists its blocking findings in the
       per-lens check run's `output.text`; the next round reads the latest prior
       `agent-review-<lens>` findings (`scripts/agent/prior-findings.mjs` →
       `--prior-findings`, the same script on both panel paths) and re-verifies each
       against the *current repository* with the same biased-to-keep refute pass.
       A prior finding survives unless it is *resolved* on grounded evidence — so
       it can't vanish just because a later fresh pass missed it (only because it
       was actually fixed, cited). Unresolved priors merge (deduped) into the
       round's findings.

       **Infra errors are excluded from carry-forward.** A lens that hit an
       API/quota outage (e.g. a 429 session limit) never reviewed; it writes a
       synthetic `{ infra: true }` "Review could not run …" record only to fail
       closed. That record is *not* a code finding — carrying it into the next
       round would make the panel re-check "the review could not run" as a
       blocker, and the biased-to-keep verifier cannot refute it on grounded
       evidence (there is no code claim to disprove), so it would persist across
       every subsequent round. Two guards prevent it: the panel workflow persists
       an empty `output.text` for any lens whose `panelEntry` carries `infraError`,
       and `scripts/agent/prior-findings.mjs` drops any carried record flagged
       `infra` on read (so the guarantee holds on both panel paths regardless of
       producer). The lens still fails closed via its check `conclusion`; only the
       bogus re-check input is suppressed.

    3. **Out-of-diff review.** The two measures above both re-read the *same
       artifact*, so neither finds a defect the diff does not contain. A Major
       correctness bug shipped through review on exactly that shape: a new
       read-only guard on the docs editor, with `EditorAPI.paste()` reaching the
       same mutation without it. The correctness and security lenses passed the
       diff twice; the bypassing line was never in it.

       The **`blast-radius`** lens exists for that class and nothing else. Its
       method is the lane: for every changed guard, signature, or contract, Grep
       the repository for every *other* reference and check whether it still
       holds — bypassed guards, unupdated callers, stale consumers of a changed
       export, removed exports still referenced, violated invariants. Line-level
       logic inside the diff is explicitly deferred to correctness, auth design
       to security, so it does not become a fifth general reviewer doubling the
       noise. Scoped `packages/**` + `scripts/**` (out-of-diff impact is a
       property of code) and blocking from day one.

       `scripts/agent/lenses/correctness.md` and
       `scripts/agent/lenses/security.md` additionally carry a **call-site
       mandate** for guards in their own lane: enumerate the other call sites of
       what a new guard protects and cite any bypass by `file:line`. The overlap
       with `blast-radius` is deliberate — an added-but-bypassable gate reads as
       covered, which is worse than no gate.

    All three lower false-negative odds; none makes the panel safe to
    self-promote — the human review gate stays the backstop.

  - **Incremental review (scope narrowing, `scripts/agent/review-state.mjs` +
    `scripts/agent/review-scope.mjs`).** Live in the autonomous panel; the
    on-demand path never narrows.

    The reviewed artifact was `git diff origin/main...HEAD`, recomputed every
    round, so an 8-round PR reads round-1 code eight times. Both endpoints of
    `...` also move: a human `git merge main` changed the artifact with no
    semantic change to the branch and flipped a lens verdict.

    Each lens's **`external_id`** carries what it last reviewed —
    `{"v":1,"reviewed":…,"base":…,"since":…,"mode":…}`. Every candidate location
    sits behind the same `checks:write` boundary (the author agent cannot forge
    any of them), so the choice was about failure modes: `output.text` is
    disqualified because the panel trims it to fit a 60k limit by *dropping
    findings* — it is designed to lose data, and a field that decides whether code
    gets reviewed must not live in a lossy channel.

    **The write rule is a function, not a convention.** `panelEntry` in
    `scripts/agent/review-panel.mjs` attaches the pointer only when a lens produced
    a real verdict (`valid` and not skipped), so a crashed, quota-failed, skipped or
    inapplicable lens stamps nothing and the next round finds a state gap for it.
    Coverage is *proven by the presence of a pointer* rather than asserted
    alongside it, which is why `resolveReviewMode` needs no separate "did this lens
    actually review?" input. It is a function because the first version was a rule
    the three call sites were trusted to follow, guarded by a test that scanned the
    source for which one carried the field — and that test passed when the pointer
    was also attached elsewhere by a separate assignment.

    **Who decides what, and where.** The panel orchestrator resolves neither the
    mode nor the diff: `scripts/agent/review-scope.mjs` reads the pointers (checks
    API) and measures the range (git), `resolveReviewMode` decides purely, and the
    workflow step that *rewrites the diff* is the same step that emits the
    `--review-mode` flag — so the two cannot disagree about what the panel is
    looking at. Their fail directions differ deliberately: the scope step only
    computes, so it tolerates failure and costs a full review; the narrowing step
    mutates the reviewed artifact, so any failure there fails the job. A narrowed
    diff with no flag is the one outcome this design must not produce, and
    `scripts/agent/review-panel.mjs` cannot detect it — it receives a file, not a range.

    `latestLensRuns` filters check runs on `app.slug === "github-actions"`. That
    narrows the writer to a workflow **in this repository**, not to the panel
    specifically — the slug identifies the App, and any workflow here that
    declared `checks: write` would share it. Today only the panel does, and no
    author-controlled workflow can gain it, because a branch cannot edit
    `.github/workflows/**`. That is the boundary; the slug filter rests on it
    rather than replacing it.

    `resolveReviewMode` is fully pure (every git fact injected) and **fails to
    `full` on any doubt**, reporting which: `no-prior-state`, `lens-state-gap`,
    `lens-state-divergence`, `no-new-commits`, `git-facts-unavailable`,
    `force-push-or-rewrite`, `merge-in-range`, `periodic-rebaseline`,
    `delta-too-large`, `invalid-input`, or `ok`. Correctness hazards are checked
    before policy caps so the reported reason names a real problem when one
    exists. Reviewing code twice costs tokens; reviewing it zero times ships a
    bug — there is no case where "probably fine" resolves to `incremental`.

    **The recall regression is real, not hypothetical.** Carry-forward re-checks
    findings already *raised*; it cannot surface a defect whose root cause is
    round-1 code that only became reachable via round-3 code. Three mitigations,
    all mandatory before any round narrows: a **scope note** (`renderScopeNote`)
    telling the lens it still owns defects the delta newly exposes in earlier code,
    that the full working tree is its cwd, and that the changed-file list is
    cumulative; a **forced full round** every 3 rounds plus on any of the hazards
    above; and wider diff context (`-U15`) on narrowed rounds. The honest saving is
    therefore **~2x, not ~8x**.

    **A pointer means the lens LOOKED, not merely that it reported.** Per-lens diff
    slicing (#582) lets a lens produce a valid verdict having run zero detection
    samples: `lensReviewPlan` returns an empty slice when the PR contains files it
    reads but none changed in this round's delta, and the round then rests on the
    prior-finding re-check alone. Such a lens does **not** stamp — `panelEntry`
    requires `ranDetection`, derived from the samples that actually returned.

    Letting it stamp would make `scopeClasses`/`classifyFile` **retroactive**:
    widening a lens's scope later would apply only to commits after the pointer,
    where today it self-heals because every round re-reads the whole diff. Not
    stamping costs one forced-full round; stamping costs a permanent, invisible
    hole. If those forced rounds prove expensive, the cheaper form is a digest of
    the lens's scope config inside the state, so changing the config invalidates
    the pointer — the mechanism `REVIEW_STATE_VERSION` already provides for shape
    changes.

    `--changed-files` stays **cumulative** in every mode. Fed the delta instead,
    `lensApplies` could mark a narrow-glob lens inapplicable in round N, the
    workflow would drop it from `required_checks`, and a lens that FAILED in round
    2 would silently stop being required in round 3 — promoting with an unresolved
    blocker. Unreachable today; the constraint exists so it stays that way.

    CLI defaults to `full`, so all three callers behave byte-identically until the
    workflow opts in — `buildLensPrompt` is exported so a test renders both prompts
    and compares bytes, rather than asserting inertness by reading the source. Two
    inconsistent invocations throw instead of reviewing: incremental with no usable
    `--since-sha`, and `--since-sha` without the mode flag (the shape a lost
    workflow input takes). The on-demand path must never narrow: it records no
    check runs, so it can never write a pointer back.

    `scripts/agent/prior-findings.mjs` replaces the inline `github-script` that
    reads the previous round's findings, with the same behaviour under test. Two
    GitHub API contracts are load-bearing and are easy to get wrong: the
    `commits/{sha}/check-runs` **list response omits or truncates `output.text`**,
    so each selected run is re-fetched by id (a truncated payload fails
    `JSON.parse`, which would silently carry zero findings), and that endpoint is
    object-wrapped, so `--paginate` needs `--slurp` or the concatenated pages are
    invalid JSON. Every `catch` is per-commit or per-lens: prior findings can only
    re-raise a blocker, never clear one, so the fail direction here is "carry fewer
    findings", the opposite of the rest of the pipeline.

    **API/quota error classification.** The Agent SDK reports API failures as a
    `result` message with `subtype:"success"` but `is_error:true` (+ `api_error_status`,
    e.g. a 429 "You've hit your session limit"), so "success" alone is not proof the
    model ran. `classifyResult` distinguishes a real verdict from an *API error* (and
    a transient API error from a *session/usage-limit*, which resets on a fixed
    schedule) from a genuine *no-output*. Transient API errors get a bounded
    `withRetry` (exp backoff); a session-limit fails fast (retry can't clear it). When
    EVERY blocking lens fails on an API error the panel marks an `infraError`: it still
    fails closed (never promotes), but the fix job pages with the *real* reason
    ("Claude API/quota error — re-run after reset"), **skips the fixer** (nothing to
    fix) and does **not** count it toward `MAX_REVIEW_ROUNDS`. This keeps a credential
    outage from masquerading as a code review finding (the #547/#548 test failures).
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

- **Convergence detection (early exit from the fix loop).** `MAX_REVIEW_ROUNDS`
  is a blunt backstop — PR #521 burned all five rounds re-litigating overlapping
  findings before anyone was paged. It is now **3**, down from the 5 that PR #521
  exhausted: `detectStalledRounds` needs `minRepeats + 1` = 3 rounds of evidence
  before it can report a stall, so no earlier non-convergence page is possible,
  and rounds 4-5 were a PR paying a full panel round each (~$12) on the way to a
  page that was already inevitable. Note this bounds the **fixer**, not panel
  spend: the guard runs in the `fix` job, so a paged PR still re-reviews on every
  CI-green push. `scripts/agent/rounds.mjs`'s
  `detectStalledRounds` (wired into
  `scripts/agent/review-round-guard.mjs`, checked BEFORE the round cap so the
  more specific reason wins) pages as soon as two consecutive round pairs both
  (a) fail to reduce the blocking-finding count and (b) exceed a similarity
  threshold against the previous round's findings.
  **Overlap alone is deliberately NOT the trigger**: the cross-round re-check
  above re-merges unresolved priors by design, so a healthy PR shows high
  overlap every round — only overlap *without* a falling count distinguishes a
  stall. Similarity is the overlap coefficient over tokenised summaries, gated
  on lens + file, calibrated at 0.3 against real rephrasings from PR #564
  (same-defect 0.39-0.71, different-defect ≤0.08). It **fails toward not
  paging**: malformed, unreadable, or infra/quota rounds break the run rather
  than manufacture a page, since `MAX_REVIEW_ROUNDS` still backstops and a
  spurious page is the costlier error. Tuned via `STALL_REPEATS` /
  `STALL_SIMILARITY`.

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
  diff (and, for design-fit, the issue) — **and the untrusted working tree**. They
  run with `cwd` set to the branch checkout and `Read`/`Grep`/`Glob` allow-listed,
  and several rubrics now direct them into the repository (`blast-radius` *requires*
  it), so a planted comment, fixture string, or doc is reached by instruction
  rather than by chance. Injected text can sway severity classification or ask for
  an empty verdict.

  Mitigations, weakest to strongest. **Prompt framing:** every rubric and the
  shared `LENS_CLOSING_INSTRUCTION` frame the diff *and the working tree* as DATA
  and make steering text a reportable finding — necessary, not sufficient.
  **Structural:** tools are read-only (no `Bash`/`Write`/network),
  `settingSources: []` blocks branch-supplied `.claude` hooks, the trusted script
  rather than the subagent computes the gate, and each lens runs `samples` times
  with the findings unioned. **Backstop:** the human merge gate; the
  `agent-review-<lens>` checks must never be sole merge authority.

  Residual risk worth naming: an injected "report nothing" produces an empty
  findings array, which no trusted-code check can distinguish from a genuinely
  clean review. The per-finding verifier does not help here — it only removes
  findings, so it cannot recover one that was never raised.
- **"No human keystroke" is aspirational, phased.** The done-criterion below
  describes no human *authoring* keystroke. In early phases the `agent`
  environment SHOULD keep required reviewers (a human approves each secret-bearing
  run) — that deliberately inserts a keystroke and is worth it. Fully
  approval-free autonomy is a later phase, only once the (now unforgeable) loop
  bounds are trusted in practice.

Done criteria: A maintainer's `@claude fix` on a well-specified issue yields a green,
independently-reviewed, disclosed draft PR marked ready-for-review with no human
*authoring* keystroke between the mention and the review request — and no path for
the agent to reach `main`.

### Phase 25: Local Spec→PR front half

A second front door to the same back half, run on the developer's machine via the
Claude Code CLI instead of an `@claude` issue comment. `.claude/commands/spec-to-pr.md`
(slash command) drives spec → human gate → task → branch → implement → local review →
`verify:self` → draft PR; `scripts/agent/spec-to-pr.mjs handoff` is the deterministic
last mile. The key insight: the back half (`.github/workflows/agent-iterate-ci.yml` +
`.github/workflows/agent-review-panel.yml`) is triggered purely by CI `workflow_run` on same-repo
`agent/*` branches — it is **not** coupled to issues — so a locally-produced
`agent/*` draft PR is picked up identically to an issue-originated one. Nothing in
the back half changes; only this local front half is new.

- **Byte-identical artifact** to the cloud front half: branch `agent/<slug>` off
  `main` pushed to the base repo; draft PR with base `main`; every commit carries
  the `Assisted-by: Claude Code (autonomous)` trailer (enforced locally by
  `scripts/hooks/require-ai-disclosure.sh` once `WAFFLEBASE_AGENT_AUTONOMOUS=true` is exported);
  a PR body that satisfies the ready-gate disclosure check. The draft PR's
  `pull_request:[main]` event runs CI (a bare branch push does not — push is
  filtered to `main`), which is the same trigger the cloud front half relies on.
- **Single source of truth for the disclosure gate:** `scripts/agent/disclosure.mjs`
  exports `disclosesAiAuthorship`, imported by BOTH `scripts/agent/mark-ready.mjs`
  (the gate) and `scripts/agent/spec-to-pr.mjs` (the local self-check) — so the
  local body can never drift from the gate it must pass.
- **Runner split:** local machine for spec→…→draft-PR (verify runs locally, a
  deliberate divergence from the cloud front half, which defers to CI); existing
  GitHub Actions for the CI-fix loop → review panel → ready.
- **Local review is a convenience, not authority:** `spec-to-pr.mjs review` runs the
  same lenses over the working diff, but needs `CLAUDE_CODE_OAUTH_TOKEN` and degrades
  to a warn-and-skip when it is absent. The authoritative panel is still the cloud
  one on green CI.
- **Single-writer / branch ownership (the key risk):** the local session owns the
  branch only until the draft PR is created; after that the cloud loops push
  follow-up commits to it. The rebase-on-`main` happens BEFORE handoff (so the
  first push can't conflict), the helper prints a loud "branch is now cloud-owned"
  notice, and the playbook ends the session immediately. Pushing again races the
  cloud fixer and a force-push would break the loops' append-only counters. This is
  behavioral, not mechanical — the one residual risk to respect.
- **Access tier:** because the back half requires `head_repository == base repo`,
  this front door works only for a developer with **push rights to the base repo**
  (fork pushes are rejected) — the same tier that can arm the pipeline.

### Phase 26: Autonomous Issue Hunting

**Principle:** Capability-First Debugging + Entropy Management — the pipeline so
far *consumes* issues; this produces them, by driving the product and observing it
fail.

Goal: an agent explores the `wafflebase` CLI, finds real defects, verifies them,
and emits a report. Tier 1 (shipped) is local and **files nothing** — precision is
measured before any maintainer attention is spent. Filing is a later phase.

**Why this is a separate subsystem and not a fifth review lens.** The cost
asymmetry *inverts*. The review panel FAILS CLOSED: uncertainty keeps a finding,
because a false positive costs one fix round while a false negative merges a bug.
Issue hunting must FAIL QUIET: uncertainty DROPS the candidate, because a false
positive costs a maintainer's attention and pollutes the tracker, while a false
negative costs nothing — the defect stays undiscovered exactly as it is today and
the next run looks again. Getting this backwards produces the documented curl
outcome (~20% of submissions AI slop, zero genuine vulnerabilities in six years of
monitoring, bug bounty discontinued 2026-02-01).

That inversion makes every review-panel helper actively unsafe here, and
`scripts/agent/hunt-gate.mjs` documents each rejection in its header:
`normalizeSeverity` maps unknown → `major` (reportable → invents a report);
`coerceFindings` turns junk into a synthetic blocking finding; `dedupeFindings`
escalates severity on collision; `unionSamples` needs only one lucky sample; and
`applyVerifications` treats a null verdict as KEEP. All five are replaced with the
failure direction flipped. Polarity-neutral helpers ARE shared — `globToRegExp`,
`classifyResult`, `withRetry`, `CITATION`, and `KNOWN` from `scripts/agent/severity.mjs` (the
severity vocabulary is shared; only the coercion rule differs).

Components:

- **The hunter never gets `Bash`.** `scripts/agent/ask.mjs` refuses it outright, so
  the model emits a probe PLAN — `argv` arrays plus a predicted observation — and
  `scripts/agent/hunt-probe.mjs` executes it via `spawnSync` with no shell. Three
  consequences: no shell string is ever built from model output; the clean room is
  enforceable because trusted code owns env/cwd/timeouts; and **replay is exact**,
  because re-running the same argv IS the replay, so the "repro doesn't match what
  the agent did" failure class cannot occur. `renderReproSh` renders shell for
  humans only and is quote-tested against `; rm -rf /`, `$(id)`, backticks,
  newlines and embedded quotes.
- **Charters carry their own oracle.** "Look for bugs" produces slop;
  "behavior contradicts this cited documented promise" produces evidence.
  Data-driven in `scripts/agent/charters/charters.json` + one `.md` rubric each,
  mirroring `lenses/`. Tier 1 ships `contract` and `crash`, both
  `needsBackend: false` — no docker lifecycle, the single largest source of flake.
- **Clean room.** `buildProbeEnv` **replaces** the environment rather than
  extending it. Spreading `process.env` would let the developer's real
  `~/.wafflebase/session.json` and default workspace leak in, so the clean room
  would be a lie and a mutating probe could act on real documents.
  `TZ`/`LANG`/`LC_ALL`/`NO_COLOR` are pinned for determinism.
- **Replay is the anti-slop gate.** The whole probe sequence re-runs 3× in fresh
  scratches and must agree with itself AND match the claim. Timestamps, generated
  ids and map ordering are the top source of phantom repros; this kills them
  before any model is asked to verify anything.
- **Agreement is OVERLAP, not identity.** Two independent samples describe the same
  defect with overlapping-but-not-identical evidence in arbitrary order, so no hash
  of any identity matches them (see the lessons file — three successive
  identity schemes each returned zero agreements on live data). `sameDefect` tests
  whether the in-scope code-location sets share a `file:line`. Line-level
  deliberately: `packages/cli/src/output/formatter.ts` genuinely holds two distinct defects, and file-level
  matching would collapse them. Same shape of judgement `scripts/agent/rounds.mjs` already makes
  for stall detection.
- **The gate.** `isFilingVerdict` is the ONLY place "report it" is decided, in four
  stages — two owned by trusted code (replay reproduced + deterministic; charter
  conformance) and two checking model output (unanimous high-confidence confirms on
  a named `confirmationGround` with `duplicateOf` unset; enough in-scope
  `file:line` citations). Every branch returns false; there is exactly one path to
  `true`. **A null verdict DROPS**, the inverse of `applyVerifications` — the most
  heavily commented line in the file, because a reviewer skimming for symmetry with
  the panel reads it as a bug.
- **Duplicate suppression, two corpora** (`scripts/agent/hunt-corpus.mjs`). Issues
  are handed over whole — 56 issues with bodies, ~37 KB — so no embeddings and no
  similarity threshold. Deferrals need a DETERMINISTIC digest because
  `docs/design/**` is ~375K tokens: plain section-slicing and grep, scoped to the
  charter's `docsScope`, with no model in the loop. A model summarising the
  deferrals would be one more place for a hallucination to enter the one input
  whose job is to prevent hallucinated findings.
- **Novelty ledger** (`scripts/agent/hunt-fingerprint.mjs`). Exploration is
  unbounded, unlike review. Entries are keyed on the defect, carry
  `LEDGER_KEY_VERSION`, and expire once the code in scope changes so the ledger
  cannot blind the hunter to a regression. Two rules learned live: a corrupt ledger
  is FATAL rather than empty (treating corruption as "nothing seen" re-reports the
  exact noise the ledger exists to suppress), and a candidate the panel never
  JUDGED — a verifier that errored or hit a run limit — is never recorded, or an
  infrastructure blip becomes a permanent blind spot.
- **Local front door** — `.claude/commands/hunt.md` + `node scripts/agent/hunt.mjs
  <preflight|run|report>`. `preflight` returns before the SDK is imported, so it
  reports what is missing without `npm ci`.

Reportable severities are `critical`/`major` only; the rubrics tell the model not
to emit `minor`/`nit` at all, since the gate drops them and emitting them spends
budget for nothing.

**Measured, not estimated** — each run writes a hunt-execution.json artifact shaped
like the review panel's own execution log, so `scripts/agent/metrics.mjs` can sum
tokens and cost over it: one `contract` run at
`samples: 3`, `verifiers: 2` costs **~$6.20** and ~12 minutes, dominated by 3.1M
cache-read tokens billed at 0.1×. Two verified defects (#585 and #586) were filed
from it.

Residual risks:

- **A real finding can die to one dissenting verifier.** Unanimity is the precision
  mechanism, and it cost recall: the same `docs import --replace --dry-run` defect
  was reported in one run and refuted in the next. Hand-verification sided with the
  report. Precision is bought with recall here, deliberately, but the trade is real.
- **Secret leakage is the highest-severity risk.** A `--verbose` probe can echo
  `Authorization: Bearer …`, and the eventual destination is a public repo.
  `redactSecrets` is applied at both the report and the artifact-dump boundaries
  and is unit-tested; it must stay that way before filing is enabled.
- **CLI coverage is a slice.** The CLI does not reach Canvas rendering, CRDT
  collaboration, or frontend interaction — where most currently-open bugs live
  (#494, #343, #333). A Playwright-driven UI hunter reusing the existing
  `verify:frontend:interaction` + Docker Chromium lanes is the natural next surface.

Done criteria for Tier 1 (met): a local run reports at least one defect that a
human independently confirms, with **zero** reports a human judges wrong, and the
funnel explains every dropped candidate.

Not yet built: the rolling GitHub-issue report, autonomous filing behind
`HUNT_FILING_ENABLED` with a mechanical accept-rate kill switch, and the formula
differential oracle. (The `round-trip`/`state` backend charters and the
`WAFFLEBASE_HUNT_WORKSPACE` safety rail shipped — see the backend-tier section
below.)

**The explorer EXECUTES.** The first cut could not: its grant was Read/Grep/Glob and
its prompt said *"you never run commands yourself"*, so it read the source,
predicted a contradiction, and a trusted runner tested the prediction afterwards.
That removed the only reason to target a CLI — a CLI's unique value is being an
executable interface — and made surprise impossible, which is the product.

The propose/execute split survives where it earns its keep. It is correct for
**reporting** (exact replay, no shell injection) and wrong for **exploration**
(blindness is the problem). So exploration now runs through one in-process MCP tool
(`scripts/agent/hunt-tool.mjs`): `argv` arrays only, no shell, `assertSafeArgv` plus
the CLI's own `schema` safety annotations, an environment `buildProbeEnv`
**replaces**, and an enforced probe budget. Verifiers keep the read-only grant —
handing them execution would let a verifier confirm a finding with evidence of its
own making.

Evidence is **cited, not authored**. Every tool call is journalled, and a candidate
names `probeRefs`/`failingRef` — indices into that journal. A model therefore cannot
describe a reproduction it never performed, which a model-authored `probes` array
allowed; `resolveProbeRefs` converts the indices back into the shape the gate,
replay and report already speak, and drops any candidate whose references do not
resolve. The repro is a transcript rather than a claim.

Two grounds exist only because the explorer can now act: `self-inconsistent` (two
paths disagree about the same data) and `schema-annotation-false` (a command
violates its own declared safety level). Both are checkable from a transcript, which
is what stops them collapsing into *"this surprised me"* — the ground deliberately
absent, because it is the slop generator that ended curl's bug bounty.

**Backend tier, and the refusal that gates it.** `round-trip` (metamorphic
identities: import→export, batch ≡ N×set, `--pages` partitions, `--dry-run` mutates
nothing) and `state` (create→delete→list, rename twice, delete twice) are
`needsBackend: true` and `mutating: true`. Their oracles are self-evidencing — a
broken relation needs no written promise — so they set `requiresDocCitation: false`
while still demanding a code citation, or a finding would be unactionable.

Two preconditions run before a token is spent, and they fail differently on purpose.
A missing stack (`checkStack`, `GET /health`, 2s) SKIPS the charter, mirroring the
review panel's treatment of its own missing preconditions. A refused workspace also
skips, but is a configuration error rather than an environmental one. Neither is
silent: the report renders **Charters that did NOT run** immediately after the
funnel, because "found nothing" and "never executed" are otherwise the same zero and
only one of them means the code is fine.

`scripts/agent/hunt-workspace.mjs` is the whole guarantee. `WAFFLEBASE_HUNT_WORKSPACE`
must be set explicitly — there is no default and no inference from the developer's
config, because a workspace a mutating run may destroy has to be something a human
typed. It is refused if it is an obviously-real name, if it equals
`WAFFLEBASE_WORKSPACE`, if it appears anywhere in the resolved config.yaml or
session.json, or if either file exists but cannot be read. Absence of proof is
refusal, since a deleted document does not come back from a reflog. The collision
check is a deliberately crude substring scan honouring `WAFFLEBASE_CONFIG` /
`WAFFLEBASE_SESSION` overrides: parsing YAML would mean a new dependency or a
hand-rolled parser whose bugs are silent, and a missed collision is unrecoverable
while a false one costs one renamed variable.

Asking the CLI for its resolved workspace would be more authoritative and does not
work: `status` ignores `--format json` and prints prose. That is ground-truth defect
\#9 — the one command that would answer the question is one of the things this
hunter exists to find.

Every seeded document is named `hunt-<runId>-<n>`, and `hunt.mjs cleanup --run <id>`
deletes by that exact prefix and nothing else, printing every decision including what
it left alone. `--run` is mandatory so there is no "delete everything that looks like
a fixture" mode to reach by accident, and the run id is in the prefix so concurrent
runs cannot delete each other's fixtures. Docker lifecycle is NOT reimplemented —
`scripts/verify-integration-docker.mjs` owns it, and `preflight` reports what is missing.
### Phase 27: Panel Feedback Corpus

**Principle:** Entropy Management — the panel has been tuned repeatedly with no
record of whether any change helped.

Everything else in the pipeline measures effort
(`scripts/agent/metrics.mjs`), self-agreement (`compareSampleAgreement`), or
process (`scripts/agent/rounds.mjs`). Nothing records **outcomes**. So each of
the panel's tuning decisions — severity thresholds, `samples: 2`, file-class
routing, the novelty gate, unanimity in the verifier — was argued from intuition
and two or three remembered incidents. `scripts/agent/misses.jsonl` is the ledger that
makes those arguments settleable.

**Record shape.** Strict JSONL, one object per line, stable field order (no comment
lines — an unreadable line makes `--append` refuse, so the format cannot document
itself):

```text
schema, id, label, source, pr, handoffAt, evidence{commitSha,commentId,url},
files[], fileClasses[], lens, severity, origin, summary,
panelSaw{reviewedSha,conclusion,blockingFindings}, verifiedBy, notes
```

`label` is `miss` **or** `false-positive`, and both live in one corpus deliberately:
a change that cuts misses by raising more findings must pay for it in false
positives, and a corpus holding only one of the two would score that change as pure
progress. `fileClasses` and `origin` were added to the original plan shape once #582
(file-class routing) and #583 (novelty origins) shipped — they turn "we missed four
bugs" into a sliceable claim about *which* population the panel is weak on.

**`verifiedBy: ""` is the load-bearing field.** `scripts/agent/harvest.mjs`
proposes candidates from two independent signatures; a human confirms. Nothing
may consume a record
until someone has put their name there, and the harvester cannot set it even by
accident (`toMissRecord` defaults it and neither harvest path passes it). An
auto-harvested, auto-trusted corpus is a corpus of noise, and harvester noise is
*systematic* — it follows whatever the matcher over-fires on — so it would move the
panel somewhere specific and wrong rather than nowhere.

**Two signatures**, both from data GitHub already keeps:

1. **Human commits after handoff.** `scripts/agent/mark-ready.mjs` posts
   `HANDOFF_MARKER` when the panel approves. A human editing *reviewable code*
   after that instant is the shape of a missed defect. The marker constant moved
   into `scripts/agent/disclosure.mjs` because it is now a contract between two
   modules, and `scripts/agent/mark-ready.mjs` runs its CLI at import time so
   nothing can import a constant from it.
2. **CodeRabbit findings the panel did not raise**, at blocking severity only —
   this corpus measures the *gate*, and a minor maintainability note is not a gate
   failure.

**Two lists that must not be one.** `interestingFiles` restricts candidates to the
`code` / `code-adjacent` classes via `classifyFile`, so the harvester's notion of
reviewable code cannot drift from the panel's own routing table. `policy` is
excluded even though `.github/**` and `scripts/agent/lenses/*.md` land there: a
human editing those is changing the **reviewer**, which is a different event from
the reviewer missing a bug, and mixing the two populations corrupts the one number
this corpus produces.

**Never feed `misses.jsonl` to a lens.** Not as few-shot examples, not as "past
misses to watch for". Three independent reasons, any one sufficient: it biases
lenses toward historical bug shapes when the next defect is by definition new; it
re-grows the prompt incremental review exists to shrink; and it is a verbatim
archive of **attacker-influenceable text** (CodeRabbit bodies, contributor commit
messages). If it ever must reach a model it goes in fenced as DATA, exactly like
the diff.

**Fail directions, opposite by design.** Every read path degrades to fewer
candidates and never throws — a GitHub hiccup costs this run's proposals, not the
corpus. The single write path (`--append`) refuses on any doubt: one unparseable
line means we do not know every id already in the file, so appending could
duplicate a curated record, and a duplicate double-counts in every later tally,
silently and permanently. `dedupeById` keeps the **first** occurrence for the same
reason — existing records are passed ahead of fresh candidates so a re-harvest can
never blank a human's `verifiedBy`.

Seeded with #548's two documented misses: the CodeRabbit `EditorAPI.paste()`
read-only bypass (Major, `correctness`, all four lenses green on that sha), and the
`test-adequacy` flip — `success` at `ab952c9`, `failure` with one major at
`ffeb1d2`, where the only diff between the two commits is +16 lines in
`docs/design/sharing.md`. No test or source file changed, so a lens found a real
defect on one run of byte-identical content and missed it on another. That single
record is the strongest evidence yet against dropping to `samples: 1`.

Done criteria: the plan's panel-quality bar (0 proven false negatives across the
corpus, `critical` demonstrably in use, ≤ 2 rounds to converge) becomes
*measurable*. Not yet built: a `harvest --report` roll-up, scheduled harvesting,
and the paired shadow-mode comparison Phase 9's merge-eligibility line feeds.

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
