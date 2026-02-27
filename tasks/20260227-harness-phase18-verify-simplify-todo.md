# TODO

- [x] Define scope for verify command simplification without lane contract breakage
- [x] Add aggregate visual verify commands at frontend/root script layers
- [x] Remove redundant Playwright dependency install guidance from docs/help text
- [x] Run simplified verify commands and capture outcomes
- [x] Document review and lessons
- [x] Update `tasks/README.md` table of contents with this task

## Review

- Added aggregate visual verification commands:
  - Frontend package:
    - `pnpm frontend test:visual:all`
    - `pnpm frontend test:visual:all:update`
  - Root package:
    - `pnpm verify:frontend:visual:all`
- Kept existing lane commands unchanged for compatibility:
  - `verify:frontend:visual`
  - `verify:frontend:visual:browser`
- Simplified Playwright prerequisite guidance:
  - Removed `pnpm --filter @wafflebase/frontend add -D playwright` from docs
    and verifier help output because Playwright is already a frontend
    devDependency installed via `pnpm install`.
  - Kept one-time browser provisioning guidance:
    `pnpm --filter @wafflebase/frontend exec playwright install chromium`.
- Updated docs:
  - `README.md`
  - `packages/frontend/README.md`
  - `CLAUDE.md`
  - `design/harness-engineering.md`
- Follow-up refinement:
  - Shortened root `README.md` verify explanation into a compact quick-guide
    bullet list (command-first format).
- Verification:
  - `pnpm verify:frontend:visual:all` (pass)
  - `pnpm frontend lint` (pass)
