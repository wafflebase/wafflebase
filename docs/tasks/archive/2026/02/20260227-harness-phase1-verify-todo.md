# TODO

- [x] Define phase-1 harness scope for verification lanes and PR evidence
- [x] Add `verify:fast` and `verify:full` scripts at the monorepo root
- [x] Add missing package-level script support needed by verification lanes
- [x] Update CI workflow to execute verification lanes
- [x] Strengthen PR template with explicit verification evidence fields
- [x] Run verification commands and capture outcomes
- [x] Update `tasks/README.md` table of contents with this task

## Review

- Added root verification lanes:
  - `pnpm verify:fast`: frontend lint + frontend tests + backend unit tests +
    sheet tests
  - `pnpm verify:full`: frontend build + backend migrate deploy + backend e2e
    + backend build + sheet build
- Updated CI to run only the two root verification lanes, reducing duplicated
  command wiring in `.github/workflows/ci.yml`.
- Added backend `lint:check` script so non-mutating lint checks are available
  for follow-up enforcement without changing local files.
- Strengthened PR template to require explicit verification command evidence,
  plus risk and rollback notes.
- Updated docs to advertise the new lanes in `README.md` and `CLAUDE.md`.
- Verification:
  - `pnpm verify:fast` passed.
  - `pnpm verify:full` failed locally at `prisma migrate deploy` because
    PostgreSQL on `localhost:5432` was unavailable in this environment.
  - `pnpm backend build` passed.
  - `pnpm sheet build` passed.
- Follow-up correction:
  - Rewrote the commit body with 80-character wrapping and added a concrete
    wrap-check command to this task's lessons.
