# TODO

- [x] Define phase-8 scope for datasource API error-handling consistency
- [x] Apply shared HTTP error helper to datasource API methods
- [x] Run frontend and self verification commands
- [x] Document review and lessons for phase-8
- [x] Update `tasks/README.md` table of contents with this task

## Review

- Applied shared `assertOk()` helper from `http-error.ts` across all
  datasource API methods in `datasources.ts`, replacing duplicated
  `if (!res.ok) throw ...` patterns.
- `executeDataSourceQuery()` now uses the same centralized parsing path as the
  rest of the frontend API modules, preserving fallback message behavior.
- No additional helper changes were required because phase-7 tests already
  cover JSON/text/fallback extraction and status override handling.
- Verification:
  - `pnpm frontend test` passed (20 tests)
  - `pnpm verify:self` passed
