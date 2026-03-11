# TODO

- [x] Define refresh-token auth design for current cookie-based JWT flow
- [x] Implement backend refresh-token issuance, refresh endpoint, and logout cleanup
- [x] Implement frontend 401 handling with one-time refresh + request retry
- [x] Update backend/frontend design docs for new auth lifecycle and env vars
- [x] Verify behavior with targeted tests
- [x] Update `tasks/README.md` table of contents with this task

## Review

- Added stateless access/refresh token issuance in backend auth service with
  configurable expiry/secret defaults:
  - access: `JWT_ACCESS_EXPIRES_IN` (default `1h`)
  - refresh: `JWT_REFRESH_EXPIRES_IN` (default `7d`)
  - refresh secret: `JWT_REFRESH_SECRET` (default `JWT_SECRET`)
- Added `POST /auth/refresh` endpoint that validates `wafflebase_refresh`,
  verifies user existence, rotates both cookies, and returns `401` on invalid
  refresh state. Logout now clears both cookies.
- Frontend `fetchWithAuth()` now handles `401` by attempting one refresh and
  retrying the original request once before redirecting to `/login`.
- Frontend `fetchMeOptional()` now also attempts refresh once before returning
  unauthenticated state, reducing false logout on access-token expiry.
- Updated docs:
  - backend API/auth/env docs (`packages/backend/README.md`, `design/backend.md`)
  - frontend auth-flow docs (`packages/frontend/README.md`, `design/frontend.md`)
- Verification:
  - `pnpm backend test` (pass)
  - `pnpm frontend test` (pass)
  - `pnpm backend build` (pass)
  - `pnpm frontend build` (pass)
- Follow-up:
  - Corrected commit-body newline formatting (`\n` literal -> real paragraphs)
    and added commit-message hygiene rules to lessons.
  - Corrected commit-body line wrapping (enforced <= 80 chars) and added
    an explicit wrap-check command to lessons.
