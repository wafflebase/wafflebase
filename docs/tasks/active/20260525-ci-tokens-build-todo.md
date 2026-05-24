# Fix Docker Publish & GitHub Page Publish after @wafflebase/tokens

## Context

Commit `8b55bfb9` (#292) introduced the `@wafflebase/tokens` package. Its
`dist/` (JS + types + `tokens.css`) is **gitignored** and must be built before
any consumer (sheets/docs/slides/frontend) can resolve it.

CI lanes that pass all build tokens first:

- root `build` script — `pnpm tokens build && ...`
- `verify:fast` — `pnpm tokens build && ...`
- `verify-integration` CI job — explicit `pnpm tokens build` step

Two deploy paths were **not** updated and now fail on `main`:

1. **GitHub Page Publish** (`publish-ghpage.yml`) — runs `pnpm frontend build`
   without building tokens first → `Can't resolve '@wafflebase/tokens/tokens.css'`.
2. **Docker Publish** (`Dockerfile`) — never copies or builds the tokens
   package → `Cannot find module '@wafflebase/tokens'` when building sheets.

## Root cause

`@wafflebase/tokens` is a workspace dependency whose build output is gitignored.
Consumers bundle it (sheets externalizes only `assert`/`util`; docs/slides
externalize nothing), so at runtime tokens is inlined — only the **build** step
needs the tokens `dist/`. The two deploy workflows skipped the tokens build.

## Plan

- [x] Reproduce: confirm `pnpm tokens build` produces `dist/index.js` + `dist/tokens.css`
- [x] Confirm `pnpm frontend build` succeeds once tokens is built
- [x] Confirm backend does not import `@wafflebase/tokens` at runtime (stage 2 safe)
- [x] Fix `publish-ghpage.yml` — use `pnpm build:all` (builds tokens first; identical otherwise)
- [x] Fix `Dockerfile` builder stage — copy `packages/tokens` manifest + source, build tokens before sheets
- [x] Verify: `pnpm build:all` (Pages) and `docker build` (Docker Publish)
- [ ] Code review, open PR

## Review

- **Pages**: `pnpm build:all` completes; `packages/frontend/dist/docs/index.html`
  and `packages/frontend/dist/index.html` both present.
- **Docker**: full `docker build` succeeds — builder stage logs
  `wrote /app/packages/tokens/dist/tokens.css`, then sheets/docs/slides/backend
  build with no "Cannot find module" error; image exports.
- **Gate**: `pnpm verify:fast` green (no source changes; CI config + task doc only).
- Stage 2 (runtime) left untouched: tokens is bundled into sheets/docs `dist/`.

## Notes

- Docker runtime stage (stage 2) needs **no** change: tokens is bundled into
  sheets/docs `dist/`, and backend never imports tokens directly at runtime.
- `build:all` already exists for exactly the gh-pages sequence
  (`tokens build → frontend build → documentation build → copy docs`). Using it
  removes the drift that caused this bug.
