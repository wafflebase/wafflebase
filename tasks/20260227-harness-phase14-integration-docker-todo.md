# TODO

- [x] Define phase-14 scope for local integration reproducibility
- [x] Add deterministic integration runner with explicit DB e2e enablement
- [x] Add docker-backed integration wrapper command for local one-command runs
- [x] Update command docs for new integration workflow
- [x] Run verification commands and capture outcomes
- [x] Document phase-14 review and lessons
- [x] Update `tasks/README.md` table of contents with this task

## Review

- Added `scripts/verify-integration.mjs` and rewired
  `pnpm verify:integration` to always enforce DB-backed e2e execution by
  setting `RUN_DB_INTEGRATION_TESTS=true` and stable defaults for
  `DATABASE_URL` and `DATASOURCE_ENCRYPTION_KEY`.
- Added `scripts/verify-integration-docker.mjs` plus
  `pnpm verify:integration:docker`:
  - starts postgres via `docker compose up -d postgres` when needed
  - waits for DB reachability
  - runs `pnpm verify:integration`
  - stops postgres again when it was started by the script
- Updated command docs in `README.md`, `CLAUDE.md`, and
  `packages/backend/README.md`.
- Updated skip guidance in `verify-integration-local.mjs` to point to
  `pnpm verify:integration:docker`.
- Verification:
  - `node --check scripts/verify-integration.mjs` (pass)
  - `node --check scripts/verify-integration-docker.mjs` (pass)
  - `node --check scripts/verify-integration-local.mjs` (pass)
  - `pnpm verify:integration` (expected fail without local DB at
    `prisma migrate deploy`)
  - `pnpm verify:integration:docker` (pass; migrations + backend e2e)
  - `pnpm verify:integration:local` (pass; skips when DB is down)
