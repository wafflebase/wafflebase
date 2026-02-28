# Phase 19: Harness Report Artifacts — Lessons

## Decisions

- Runner script approach chosen over per-script `--report` flags to avoid
  modifying every verify script. Individual scripts remain unchanged.
- First-failure-stop preserved (matches current `&&` behavior). Unrun lanes
  recorded as `"status": "skip"` in summary.
- stdout/stderr tee'd to console and captured for failure summary extraction.
- CI artifact publishing deferred to future phase.

## Observations

- `spawn` with stdio "pipe" + manual `process.stdout.write` provides both
  real-time console streaming and output capture for failure summary
  extraction. `execSync` with "inherit" can't capture, and "pipe" without
  manual tee delays all output until command completion.
- Colon in lane names (e.g. `verify:fast`) works fine in JSON filenames on
  macOS and Linux, though Windows would need sanitization.
- Report schema kept intentionally minimal: status, durationMs, exitCode,
  failureSummary. Avoids parsing overhead while providing enough for agent
  triage. Can be extended per-script later (Approach C) if needed.
- The runner replaces ~130 characters of `&&` chain with a structured script
  that preserves identical execution order and first-failure-stop semantics.
