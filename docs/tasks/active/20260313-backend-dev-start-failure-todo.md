# Backend Dev Start Failure

Investigate and fix the backend startup failure reproduced by `pnpm dev`.

## Problem

Running the root dev command starts Vite successfully, but the backend exits
with:

`Error: Cannot find module '.../packages/backend/dist/main'`

## Tasks

- [x] Inspect the backend start scripts and Nest/TypeScript config
- [x] Reproduce the failure with backend-only start commands
- [x] Implement the minimal fix for the dev path
- [x] Verify `pnpm dev` / backend startup succeeds from a clean state
- [x] Record the root cause and tradeoffs

## Findings

### 1. Root dev uses the wrong backend script

The root `pnpm dev` script currently runs `pnpm backend start`, which maps to
`nest start`. That is a compiled-runtime path, not the watch-mode development
path.

### 2. The backend build cache is stale relative to `deleteOutDir`

`packages/backend/nest-cli.json` enables `deleteOutDir`, and the build config
inherits TypeScript incremental compilation. The `.tsbuildinfo` file lives
outside `dist`, so Nest/tsc considers the project up to date even after the
output directory has been deleted.

That leaves this broken sequence:

1. `dist/` is deleted
2. incremental cache says "up to date"
3. no JS is emitted
4. Nest tries to execute `dist/main`

### 3. Runtime imports from `@wafflebase/sheet` need explicit built entries

The structural concurrency work added backend runtime imports from
`@wafflebase/sheet` in the cells controller. While investigating the startup
path, the sheet package entry fields were still implicit/legacy for this
workspace layout. Aligning `main` / `exports` with the built `dist/` artifacts
removes that mismatch and keeps backend runtime resolution consistent with the
package build output.

## Review

### Implementation

- Updated the root dev script to use `pnpm backend start:dev` instead of the
  compiled-runtime `start` script.
- Moved the backend TypeScript build info file under `dist/` so `deleteOutDir`
  clears the incremental cache together with emitted JS.
- Added a `prestart:dev` hook in the backend to build `@wafflebase/sheet`
  before Nest watch mode starts.
- Pointed the sheet package runtime entry fields at built `dist` artifacts.

### Verification

- Reproduced the original `Cannot find module .../packages/backend/dist/main`
  failure with `pnpm --filter @wafflebase/backend start:dev` before the fix.
- Confirmed the incremental-cache diagnosis with
  `pnpm --filter @wafflebase/backend exec tsc --build tsconfig.build.json --verbose`
  and `tsc --build tsconfig.build.json --force --listEmittedFiles`.
- Re-ran `pnpm --filter @wafflebase/backend start:dev` after the fix and
  confirmed the backend advances past the missing `dist/main` failure.
- Ran `pnpm --filter @wafflebase/backend start` and confirmed the backend now
  boots past the old missing-`dist/main` point.
- Ran `pnpm --filter @wafflebase/backend test` and confirmed backend unit tests
  still pass (`9` suites, `71` tests).
- Re-ran `pnpm dev`; in this sandbox the remaining failures are environment
  restrictions:
  - Vite bind on `::1:5173` returned `EPERM`
  - Yorkie client connect to `127.0.0.1:8080` / `::1:8080` returned `EPERM`

### Outcome

- Repository misconfiguration fixed:
  - root dev no longer points at the wrong backend script
  - backend build no longer deletes `dist` and then skips re-emission
  - backend runtime can resolve `@wafflebase/sheet`
- Residual sandbox-only blockers remain for local socket bind/connect in this
  execution environment, but they are separate from the original module errors
