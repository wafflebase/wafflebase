# CI Export Failure Investigation

Investigate and fix the GitHub Actions failure caused by invalid runtime ESM
exports from the `@wafflebase/sheet` barrel.

## Tasks

- [x] Inspect the failing CI job and identify the broken export path
- [x] Patch the sheet barrel so type-only symbols are not emitted as runtime
  exports
- [x] Verify the failing lane locally and record the result

## Review

### What Changed

- Inspected GitHub Actions job `67042180505` from run `23078098805` and
  traced the failure to `packages/sheet/src/index.ts`.
- Split the sheet barrel into runtime exports and a dedicated `export type`
  block so Node ESM no longer tries to emit type-only symbols as runtime
  bindings.
- Recorded the CI export failure task in the active task index.

### Results

- The failing frontend test lane now loads `@wafflebase/sheet` without the
  runtime `SyntaxError: Export 'AggregateFunction' is not defined in module`.
- The issue was broader than one symbol; the same barrel also exposed other
  type-only bindings as runtime exports, which are now all type-exported.

### Verification

- `gh run view 23078098805 --job 67042180505 --log-failed`
- `pnpm frontend test`
- `pnpm verify:fast`
