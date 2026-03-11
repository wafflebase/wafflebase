# Phase 22: Dependency Freshness Detection — Lessons

## Decisions

- Integrated into `verify:entropy` rather than a separate command, since
  dependency freshness is a form of entropy management alongside dead-code
  and doc-staleness detection.
- `failOnCritical: false` for now because all 4 critical vulnerabilities
  are in transitive dependencies of build/test tooling (vite-plugin-node-
  polyfills, supertest) — not in production code.
- Report-only for non-critical: low/moderate/high vulnerabilities and
  outdated counts are surfaced but do not fail the gate.

## Observations

- `pnpm audit` and `pnpm outdated` both exit with non-zero codes when
  issues are found. The `spawnAsync` wrapper already handles this correctly
  by resolving (not rejecting) with the error object.
- `pnpm outdated --recursive --json` returns a flat object keyed by package
  name. Package count is simply `Object.keys(report).length`.
- Adding `pnpm audit + outdated` increased `verify:entropy` from ~3.5s to
  ~10s. The two commands could be parallelized in the future if needed.
- 75 outdated packages and 60 vulnerabilities (15 low, 16 moderate, 25
  high, 4 critical) in the current state. Most outdated packages are patch
  or minor updates for Radix UI, NestJS, and type definitions.
