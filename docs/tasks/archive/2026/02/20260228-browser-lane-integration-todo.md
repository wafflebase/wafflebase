# Browser Lane Integration into verify:self

## Goal

Integrate Playwright browser visual and interaction regression lanes
into `verify:self` with graceful skip when Chromium is not available.
Also fix harness-engineering.md document consistency issues (Phase
numbering conflicts, stale summary).

## Deliverables

- [x] Wrapper script (`scripts/verify-browser-lanes.mjs`) that detects
      Chromium availability and either runs the browser lane or skips
      with a warning
- [x] `verify:self` composition updated to include browser lanes at end
- [x] harness-engineering.md updated: Phase numbering resolved, summary
      corrected, browser integration recorded as Phase 18a
- [x] Local `pnpm verify:self` passes with browser lanes included
- [x] CI `pnpm verify:self` passes with browser lanes gracefully skipped
