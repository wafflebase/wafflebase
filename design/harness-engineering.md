---
title: harness-engineering
target-version: 0.1.0
---

# Harness Engineering

## Summary

This document defines the end-to-end harness engineering plan for Wafflebase:
verification lanes, quality gates, local/CI reproducibility, and rollout
status by phase.

As of 2026-02-27, phases 1 through 16 are completed.
Phase 17 hardening work has started with initial follow-up tasks.

## Goals

- Keep verification deterministic and reproducible between local and CI.
- Fail fast on signal-quality regressions (lint noise, oversized bundles).
- Make integration validation executable with one local command.
- Keep harness policy configurable and reviewable in versioned files.

## Non-Goals

- Replace the CI provider or pipeline framework.
- Add broad test sharding/optimization before reliability goals are met.
- Introduce path-based selective execution ahead of baseline stability.

## Current State

### Lane Contract

- `pnpm verify:architecture`: frontend/backend import boundary checks
- `pnpm verify:fast`: lint + unit tests
- `pnpm verify:self`: `verify:fast` + frontend/backend/sheet builds + frontend
  chunk/visual gates
- `pnpm verify:frontend:chunks`: frontend built JS chunk size/count gate
- `pnpm verify:frontend:visual`: deterministic frontend markup baseline gate
  (SSR HTML snapshot)
- `pnpm verify:frontend:visual:browser`: browser-rendered visual screenshot
  baseline gate (Playwright/Chromium)
- `pnpm verify:integration`: Prisma migrate deploy + backend e2e (DB-backed)
- `pnpm verify:integration:local`: skip integration when DB is unreachable
- `pnpm verify:integration:docker`: one-command postgres up + integration + stop
- `pnpm verify:full`: `verify:self && verify:integration`

### CI Contract

- `verify-self` job runs first.
- `verify-integration` runs after `verify-self` and provisions PostgreSQL.
- PR template requires verification evidence for self/integration lanes.

## Phase Status (Completed)

| Phase | Scope | Status |
|---|---|---|
| 1 | Root verification lanes + PR evidence baseline | Completed |
| 2 | Frontend/backend architecture boundary lint lanes | Completed |
| 3 | Self-contained vs integration lane split in CI | Completed |
| 4 | Frontend migration smoke tests (self-contained) | Completed |
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

Detailed task records are tracked in `tasks/20260227-harness-phase*-{todo,lessons}.md`.

## Top-Level Plan Status (A-E)

| ID | Goal | Current status | Evidence | Next focus |
|---|---|---|---|---|
| A | Fail on breakage by default | Mostly complete | `verify:architecture`, zero-warning lint, chunk/visual gates, smoke tests | Add integration determinism guardrails to reduce flaky pass/fail drift |
| B | Two-lane verification split for speed + merge safety | Completed | `verify:self` + `verify:integration` split in scripts and CI | Keep lane contracts stable while improving integration determinism |
| C | Frontend regression harness automation | Phase-1 complete | Phase-16 adds deterministic `/harness/visual` markup baseline and browser screenshot command | Promote browser lane into default self-verification once Playwright provisioning is standardized |
| D | Distributed contracts for agent execution | In progress | Root verification scripts, PR evidence contract, per-phase todo/lessons records | Add machine-readable lane reports and shared contract templates |
| E | Anti-slop cleanup loop | In progress | Lint warning cleanup + strict gate, build chunk cleanup, lessons tracking | Automate report-based triage loop and enforce fix-or-fail follow-through |

## Remaining Work (Recommended)

### Immediate Next Work (From Current Gaps)

- Standardize Playwright dependency + Chromium provisioning (local + CI), then
  compose `verify:frontend:visual:browser` into `verify:self`.
- Add an interruption smoke test path for `verify:integration:docker` to keep
  signal-handler cleanup behavior regression-resistant.

### Phase 17: Integration Determinism Hardening

Goal:
- Reduce flake by standardizing DB state and nondeterministic dependencies.

Deliverables:
- Shared integration test seed/reset helpers.
- Time/random dependency isolation helpers (or fixed test clocks/seeds).
- Interrupt-safe cleanup for `verify:integration:docker` via `finally` path and
  signal handlers.
- Repeat-run stability check (same commit, repeated integration execution).

Done criteria:
- Consecutive integration runs on same commit are stable.

### Phase 18: Harness Report Artifacts

Goal:
- Make lane outputs machine-readable for faster triage and automation.

Deliverables:
- JSON summaries per lane (status, duration, key failures).
- CI artifact publishing for lane reports.
- Standardized failure summary emitted to logs.

Done criteria:
- CI failures can be diagnosed from structured report + concise log summary.

### Phase 19: PR Evidence Trust Automation

Goal:
- Reduce manual verification evidence drift in PRs.

Deliverables:
- PR checks linked to lane results (self/integration) as source of truth.
- Evidence section can reference generated reports instead of manual paste.

Done criteria:
- Required verification evidence is automatically trustworthy.

## Harness Policy

Frontend chunk gate defaults are managed in `harness.config.json`:

```json
{
  "frontend": {
    "chunkBudgets": {
      "maxChunkKb": 500,
      "maxChunkCount": 60
    }
  }
}
```

Environment overrides remain available:
- `FRONTEND_CHUNK_LIMIT_KB`
- `FRONTEND_CHUNK_COUNT_LIMIT`

## Definition of Harness v1 Completion

Harness v1 is considered complete when all are true:

1. Integration lane is reproducible locally without manual orchestration.
2. CI failures are diagnosable in under 5 minutes from logs/reports.
3. PR required verification evidence is automatically trustworthy.
