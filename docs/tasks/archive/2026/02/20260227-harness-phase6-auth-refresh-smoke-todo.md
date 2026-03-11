# TODO

- [x] Define phase-6 scope for auth refresh smoke coverage
- [x] Extract auth refresh single-flight logic into a pure helper
- [x] Add tests for concurrent refresh sharing and reset behavior
- [x] Run frontend and self verification commands
- [x] Update `tasks/README.md` table of contents with this task

## Review

- Extracted auth refresh single-flight behavior into
  `src/api/single-flight.ts`, and migrated `auth.ts` to use it for
  `refreshSession` without changing user-facing auth behavior.
- Added deterministic smoke tests in `single-flight.test.ts` for:
  - coalescing concurrent calls into one in-flight execution
  - resetting after a resolved execution
  - resetting after a rejected execution
- This directly guards against refresh-storm regressions in concurrent `401`
  scenarios.
- Verification:
  - `pnpm frontend test` passed (14 tests)
  - `pnpm verify:self` passed
