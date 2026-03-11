# TODO

- [x] Define phase-5 scope for local integration verification ergonomics
- [x] Add a local wrapper that checks DB reachability before integration tests
- [x] Expose local wrapper in root scripts and command docs
- [x] Run wrapper command and confirm skip/run behavior
- [x] Update `tasks/README.md` table of contents with this task

## Review

- Added `scripts/verify-integration-local.mjs`:
  - parses `DATABASE_URL` (fallback `localhost:5432`)
  - checks TCP reachability with timeout
  - skips with actionable guidance when DB is unavailable
  - runs `pnpm verify:integration` when DB is reachable
- Added root script:
  - `pnpm verify:integration:local`
- Updated command docs in `README.md` and `CLAUDE.md` to include the local
  wrapper and clarify its skip behavior.
- Verification:
  - `pnpm verify:integration:local` passed and correctly skipped in a local
    environment without PostgreSQL.
