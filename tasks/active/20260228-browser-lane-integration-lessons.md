# Browser Lane Integration — Lessons

## Decisions

- Chose graceful skip in verify:self over separate CI job or separate
  local-only lane. Single verify:self command works everywhere — runs
  browser lanes when Chromium is present, skips with warning when not.
- Document consistency fix bundled with this task since it touches
  harness-engineering.md already.

## Observations

- Existing browser scripts already had `loadPlaywright()` with error
  handling for missing packages. The wrapper script adds a layer above
  that specifically checks Chromium availability and exits 0 (skip)
  rather than 1 (fail).
- `createRequire` anchored to the frontend package.json was necessary
  to resolve playwright from the correct node_modules location in the
  monorepo.
- Phase numbering in harness-engineering.md had drifted: "Phase 18" was
  used for both "Entropy detection" (completed) and "Harness Report
  Artifacts" (remaining). Renumbering remaining phases 19-22 resolved
  the conflict cleanly.
