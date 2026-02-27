# TODO

- [x] Define phase-16 scope for frontend visual regression automation
- [x] Add deterministic visual harness route/page without auth or backend deps
- [x] Add dependency-free visual baseline regression check via Vite SSR
- [x] Wire visual regression checks into root verification lanes
- [x] Update command docs for visual regression workflow
- [x] Run verification commands and capture outcomes
- [x] Document phase-16 review and lessons
- [x] Update `tasks/README.md` table of contents with this task

## Review

- Added deterministic harness UI at `packages/frontend/src/app/harness/visual/page.tsx`
  and routed `/harness/visual` from `packages/frontend/src/App.tsx`.
- Added `packages/frontend/scripts/verify-visual.mjs`:
  - Renders the harness page with Vite SSR + `react-dom/server`
  - Compares normalized markup against a committed baseline file
  - Supports baseline refresh via `UPDATE_VISUAL_BASELINE=true`
  - Writes `.actual` output and hash summary on mismatch
- Added committed baseline snapshot at
  `packages/frontend/src/visual-tests/baselines/harness-visual.html`.
- Added visual commands:
  - Frontend: `pnpm frontend test:visual`, `pnpm frontend test:visual:update`
  - Root: `pnpm verify:frontend:visual`
  - Root self lane now includes `pnpm verify:frontend:visual`
- Updated docs in `README.md`, `packages/frontend/README.md`, and `CLAUDE.md`
  for visual regression workflow and command discovery.
- Verification:
  - `pnpm frontend test:visual:update` (pass)
  - `pnpm frontend test:visual` (pass)
  - `pnpm verify:frontend:visual` (pass)
  - `pnpm verify:self` (pass)
