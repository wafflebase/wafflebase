# Entropy Detection Lane — Lessons

## knip Configuration

- knip auto-discovers Vite and NestJS entry points via built-in plugins, but
  explicit `entry` arrays are safer for ensuring full dependency graph coverage.
- The `scripts/` directory must be ignored because standalone scripts are not
  reachable from workspace entry points.
- CSS-only dependencies (`tailwindcss`, `tw-animate-css`) loaded via
  `@import` are invisible to knip and need `ignoreDependencies`.
- Shell scripts referenced in npm scripts need `ignoreBinaries`.

## Doc-Staleness Detection

- Design docs used package-relative paths (`src/model/calculator.ts`) but the
  staleness checker resolves from repo root. All 37 references were converted
  to repo-root-relative paths (`packages/sheet/src/model/calculator.ts`).
  Going forward, design docs should use repo-root-relative paths.
- Markdown link targets with anchor fragments (`README.md#section`) must be
  stripped before extension validation and filesystem checks.
- Fenced code blocks must be skipped to avoid false positives from example
  config snippets.

## Dead Code Found

- 4 scaffolded shadcn/ui components were never imported (breadcrumb, drawer,
  sonner, toggle-group). Lesson: don't scaffold components until they're
  needed.
- 1 mock file (`packages/sheet/src/model/mock.ts`) was never imported.

## Design

- The `enabled !== false` pattern (default-on) is better than truthy checking
  for detectors that should run by default. Explicitly setting `false` is the
  opt-out mechanism.
- A single script with inline detector functions is the right granularity for
  2 detectors. Refactor to plugin architecture if detector count exceeds 3.
