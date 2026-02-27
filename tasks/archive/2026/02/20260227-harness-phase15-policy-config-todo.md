# TODO

- [x] Define phase-15 scope for harness policy externalization
- [x] Add repository-level harness config for frontend chunk gate defaults
- [x] Update frontend chunk verifier to load config with env override support
- [x] Update command docs to describe config-driven policy management
- [x] Run verification commands and capture outcomes
- [x] Document phase-15 review and lessons
- [x] Update `tasks/README.md` table of contents with this task

## Review

- Added root `harness.config.json` to store frontend chunk gate defaults:
  - `frontend.chunkBudgets.maxChunkKb`
  - `frontend.chunkBudgets.maxChunkCount`
- Updated `scripts/verify-frontend-chunks.mjs` to read defaults from
  `harness.config.json` with validation, while keeping environment variable
  overrides (`FRONTEND_CHUNK_LIMIT_KB`, `FRONTEND_CHUNK_COUNT_LIMIT`).
- Updated docs in `README.md`, `CLAUDE.md`, and `packages/frontend/README.md`
  to document config-driven policy management.
- Verification:
  - `node --check scripts/verify-frontend-chunks.mjs` (pass)
  - `pnpm verify:frontend:chunks` (pass)
  - `FRONTEND_CHUNK_COUNT_LIMIT=1 pnpm verify:frontend:chunks`
    (expected fail path)
  - `pnpm verify:self` (pass)
