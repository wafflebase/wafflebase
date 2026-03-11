# TODO

- [x] Define phase-7 scope for frontend API error mapping smoke coverage
- [x] Add pure HTTP error helper with status override and fallback behavior
- [x] Apply helper to `documents` and `share-links` API modules
- [x] Add deterministic tests for JSON/text/error fallback parsing
- [x] Run frontend and self verification commands
- [x] Update `tasks/README.md` table of contents with this task

## Review

- Added `src/api/http-error.ts` with:
  - `readResponseErrorMessage(response)` for JSON/text best-effort extraction
  - `assertOk(response, fallback, { statusMessages })` for consistent error
    throwing with status overrides (for example, 410 share-link expiry)
- Applied helper in `documents.ts` and `share-links.ts` to replace repeated
  `if (!response.ok) throw ...` blocks with centralized handling.
- Preserved existing UX behavior in document deletion:
  - success toast on `ok`
  - failure toast + thrown error with parsed/override/fallback message
- Added helper tests in `http-error.test.ts` covering:
  - JSON `message` extraction
  - JSON message array joining
  - text fallback
  - status override precedence
  - empty-body fallback
  - non-throwing `ok` path
- Verification:
  - `pnpm frontend test` passed (20 tests)
  - `pnpm verify:self` passed
