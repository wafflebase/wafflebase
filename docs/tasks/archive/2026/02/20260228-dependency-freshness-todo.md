# Phase 22: Dependency Freshness Detection

## Goal

Add vulnerability and outdated package detection to `verify:entropy` for
automatic dependency freshness monitoring.

## Deliverables

- [x] `runDependencyFreshness()` added to `scripts/verify-entropy.mjs`
- [x] `pnpm audit --json` for vulnerability detection by severity
- [x] `pnpm outdated --recursive --json` for outdated package count
- [x] `harness.config.json` extended with `dependencyFreshness` settings
- [x] `failOnCritical` gate behavior (currently disabled due to transitive vulns)
- [x] `design/harness-engineering.md` Phase 22 completed
- [x] Local `pnpm verify:self` passes
- [x] Task files archived
