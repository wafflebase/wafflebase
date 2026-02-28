# Phase 19: Harness Report Artifacts

## Goal

Add structured JSON lane reports to `verify:self` for agent-first CI failure
diagnosis. Replace the `&&` chain in package.json with a runner script that
captures per-lane timing, status, and failure summaries.

## Decisions

- Consumer: Agent-first (machine-readable JSON for Claude/agent consumption)
- Report generation: Per-lane individual JSON in `.harness-reports/`
- Report content: Status + failure summary (not full stdout capture)
- Approach: Runner script (`scripts/verify-self.mjs`) — no individual
  verify script modifications needed

## Deliverables

- [x] `.gitignore` updated with `.harness-reports/`
- [x] `scripts/verify-self.mjs` runner script
- [x] `package.json` verify:self updated to use runner
- [x] Local `pnpm verify:self` passes with reports generated
- [x] `design/harness-engineering.md` Phase 19 marked complete
- [x] Task files archived
