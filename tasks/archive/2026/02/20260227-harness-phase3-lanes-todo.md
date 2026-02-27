# TODO

- [x] Define phase-3 scope for self-contained and integration verification
- [x] Add root scripts for `verify:self` and `verify:integration`
- [x] Keep backward-compatible `verify:full` behavior with composed lanes
- [x] Split CI workflow into separate self-contained and integration jobs
- [x] Update PR template and docs for the new verification contract
- [x] Run verification commands and capture outcomes
- [x] Update `tasks/README.md` table of contents with this task

## Review

- Added root verification split:
  - `verify:self`: architecture + lint/tests + frontend/backend/sheet builds
  - `verify:integration`: Prisma migrate deploy + backend e2e
  - `verify:full`: compatibility alias (`verify:self && verify:integration`)
- Split CI into two jobs:
  - `verify-self` (no DB service required)
  - `verify-integration` (Postgres service + DB-related env vars), running
    after `verify-self`
- Updated PR template verification section to request evidence for
  `verify:self` and `verify:integration` with explicit skip reason handling.
- Updated command docs in `README.md` and `CLAUDE.md`.
- Verification:
  - `pnpm verify:self` passed
  - `pnpm verify:integration` failed locally at
    `pnpm --filter @wafflebase/backend exec prisma migrate deploy` because
    PostgreSQL on `localhost:5432` was unavailable in this environment
