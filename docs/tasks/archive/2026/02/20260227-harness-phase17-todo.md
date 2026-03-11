# TODO

- [x] Create shared integration test helpers module (`test/helpers/integration-helpers.ts`)
- [x] Refactor `database.e2e-spec.ts` to use shared helpers
- [x] Refactor `authenticated-http.e2e-spec.ts` to use shared helpers
- [x] Fix timestamp nondeterminism in `http.e2e-spec.ts` with fake timers
- [x] Pin postgres to v16 in `docker-compose.yaml`
- [x] Create repeat-run stability script (`verify-integration-repeat.mjs`)
- [x] Update `design/harness-engineering.md` Phase 17 status
- [x] Run `verify:fast` + `verify:integration:docker` to validate

## Review

Phase 17 integration determinism hardening is complete:

- **Shared helpers**: Extracted `clearDatabase`, `createUserFactory`, `describeDb`,
  `parseDatabaseUrl`, and env defaults into `test/helpers/integration-helpers.ts`.
  Both DB-backed e2e test files now import from the shared module.
- **Timestamp fix**: The share-link expiration test in `http.e2e-spec.ts` now uses
  `jest.useFakeTimers()` with a fixed system time, eliminating the ±1000ms
  wall-clock tolerance window.
- **Postgres pinned**: `docker-compose.yaml` now uses `postgres:16` matching CI.
- **Repeat-run script**: `pnpm verify:integration:repeat` runs integration N times
  (configurable via `REPEAT_COUNT`) and reports stability.
- All verification passes: `verify:fast` (566 tests), `verify:integration:docker`
  (15 e2e tests across 3 suites).
