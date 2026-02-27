# TODO

- [x] Define phase-12 scope for frontend chunk budget enforcement
- [x] Add local script to verify built frontend chunk sizes against budget
- [x] Integrate chunk verification into self-contained verification lane
- [x] Run verification commands to confirm gate behavior
- [x] Document phase-12 review and lessons
- [x] Update `tasks/README.md` table of contents with this task

## Review

- Added `scripts/verify-frontend-chunks.mjs` to enforce a local JS chunk size
  budget from built frontend artifacts in `packages/frontend/dist/assets`.
- Added `verify:frontend:chunks` script at monorepo root and wired it into
  `verify:self` after `pnpm frontend build`.
- Updated root and frontend README command sections to document the new gate.
- Verification:
  - `pnpm verify:self` (pass; includes `verify:frontend:chunks`)
  - `pnpm verify:frontend:chunks` (pass; largest chunk `465.73 kB`)
