---
title: harness-engineering
target-version: 0.1.0
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

As of 2026-02-28, phases 1 through 19 are completed. Browser visual and
interaction lanes are integrated into `verify:self` with graceful Chromium
skip. Structured JSON lane reports are generated per lane and as a summary.
Remaining phases focus on evidence automation and observability.

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
  deeper sources of truth in `design/`, `packages/*/README.md`.
- Design documents live in `design/` and are cross-linked from the root.
- Task history is tracked in `tasks/` with paired todo/lessons files.
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
- SSR markup baselines for deterministic HTML snapshot comparison.
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
  (`tasks/archive/*/lessons.md`) capturing what went wrong and what harness
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

## Lane Contract

### Self-Contained Lanes (no external services)

| Command | Purpose |
|---|---|
| `pnpm verify:architecture` | Frontend/backend import boundary checks |
| `pnpm verify:fast` | Architecture + lint + unit tests |
| `pnpm verify:frontend:chunks` | Built JS chunk size/count gate |
| `pnpm verify:frontend:visual` | SSR HTML markup baseline gate |
| `pnpm verify:frontend:visual:browser` | Playwright screenshot baseline (desktop+mobile) |
| `pnpm verify:frontend:visual:all` | Both visual gates combined |
| `pnpm verify:frontend:interaction:browser` | Browser interaction regression (cell input, formula, scroll) |
| `pnpm verify:entropy` | Dead-code (knip) + doc-staleness entropy gate |
| `pnpm verify:self` | Runner: `verify:fast` + builds + chunk/visual/interaction + entropy + browser; generates `.harness-reports/` JSON |

### Integration Lanes (require database)

| Command | Purpose |
|---|---|
| `pnpm verify:integration` | Prisma migrate + backend e2e |
| `pnpm verify:integration:local` | Skip integration when DB is unreachable |
| `pnpm verify:integration:docker` | One-command: postgres up + integration + stop |
| `pnpm verify:integration:repeat` | Repeat-run stability check (default 3 runs) |

### Composite Lanes

| Command | Purpose |
|---|---|
| `pnpm verify:full` | `verify:self` + `verify:integration` |

### CI Contract

- `verify-self` job runs first (no external services).
- `verify-integration` job depends on `verify-self` and provisions PostgreSQL.
- PR template requires verification evidence for both lanes.

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

## Completed Phases (1-19)

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

Phase 17 delivered:
- Shared integration test helpers (`packages/backend/test/helpers/integration-helpers.ts`):
  clearDatabase, createUserFactory, describeDb, parseDatabaseUrl, env defaults.
- Timestamp nondeterminism eliminated via `jest.useFakeTimers()` in controller
  contract tests.
- Postgres version pinned to 16 in `docker-compose.yaml` (matches CI).
- Repeat-run stability script: `pnpm verify:integration:repeat`.

Detailed task records:
- `tasks/active/` for in-progress work
- `tasks/archive/2026/02/` for completed phase history

## Top-Level Plan Status

| ID | Goal | Principle | Status | Next |
|---|---|---|---|---|
| A | Fail on breakage by default | Mechanical Enforcement | Completed | Maintain zero-warning, zero-drift baseline |
| B | Two-lane verification split | Mechanical Enforcement | Completed | Stable; improve integration determinism |
| C | Frontend regression harness | Visual Feedback | Completed | Browser lanes in verify:self; Playwright CI provisioning deferred |
| D | Agent-oriented contracts | Information Accessibility | In progress | Structured lane reports delivered (Phase 19); agent observability next (Phase 21) |
| E | Entropy cleanup loop | Entropy Management | In progress | Dead-code + doc-staleness delivered; dependency freshness next |

## Remaining Work

### Phase 20: PR Evidence Trust Automation

**Principle:** Mechanical Enforcement — replace manual verification evidence
with automated trust.

Goal: Eliminate manual verification evidence drift in PRs.

Deliverables:
- PR checks linked to lane results (self/integration) as source of truth.
- Evidence section references generated reports instead of manual paste.

Done criteria: Required verification evidence is automatically trustworthy.

### Phase 21: Agent Observability Stack

**Principle:** Visual Feedback + Capability-First Debugging — give agents
direct access to runtime signals.

Goal: Enable agents to self-diagnose failures using structured telemetry.

Deliverables:
- Structured logging format for backend services (JSON, correlation IDs).
- Per-branch or per-PR observability context (log grouping by change).
- Agent-queryable failure summaries from lane report artifacts.

Done criteria: An agent can diagnose a CI failure from report artifacts
without human interpretation.

### Phase 22: Dependency Freshness Detection

**Principle:** Entropy Management — automate the detection of codebase decay.

Goal: Surface outdated or vulnerable dependencies automatically.

Deliverables:
- Dependency freshness report (outdated/vulnerable packages).

Done criteria: Dependency freshness signals surfaced automatically in CI or
periodic reports.

Note: Dead-code and doc-staleness gates were delivered in Phase 18 as `pnpm
verify:entropy`.

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
    "docStaleness": { "enabled": true, "designDir": "design" }
  }
}
```

Frontend chunk environment overrides:
- `FRONTEND_CHUNK_LIMIT_KB`
- `FRONTEND_CHUNK_COUNT_LIMIT`

Entropy detectors default to enabled; set `"enabled": false` to disable
individually for debugging.

## Definition of Harness v1 Completion

Harness v1 is complete when all are true:

1. Integration lane is reproducible locally without manual orchestration.
   **Status: Done** (`verify:integration:docker`).
2. CI failures are diagnosable in under 5 minutes from logs/reports.
   **Status: Done** (structured JSON reports per lane + summary via
   `scripts/verify-self.mjs` runner — Phase 19).
3. PR required verification evidence is automatically trustworthy.
   **Status: Not started** — Phase 20.

## References

- [OpenAI: Harness engineering — leveraging Codex in an agent-first world](https://openai.com/index/harness-engineering/)
- [Martin Fowler: Harness Engineering](https://martinfowler.com/articles/exploring-gen-ai/harness-engineering.html)
- [Mitchell Hashimoto: Harness, not AGENTS.md](https://mitchellh.com/writing/agents-harness-not-agents-md)
