# Fix `pnpm build` dependency ordering

## Problem

`pnpm build` fails with exit code 1. `slides` and `backend` builds fail with
TS2305 / TS2353 / TS2339 errors about missing exports from `@wafflebase/docs`
(`detectUnit`, `getGridConfig`, `drawTicks`, `RulerUnit`, `GridConfig`,
`TickDensity`) and `@wafflebase/slides` (`Guide`, `guides`).

## Root cause

Cross-package type resolution uses each package's built `dist/*.d.ts`, not its
source. The `dist/` folders are gitignored and were stale (predating commit
#285 which added the ruler + guides symbols). The `build` script:

1. **Never builds `@wafflebase/docs`** — it is absent from the concurrent list,
   yet slides/frontend/backend/cli all depend on it.
2. Builds packages **concurrently with no dependency ordering**, so consumers
   read stale/half-written dist of their dependencies.

Dependency graph:

```
docs    (leaf)
sheets  (leaf)
slides   -> docs
frontend -> docs, sheets, slides
backend  -> docs, sheets, slides
cli      -> docs, slides
```

Correct topological order: `(docs, sheets) -> slides -> (frontend, backend, cli)`.

## Plan

- [x] Rewrite root `build` script to build in topological order
- [x] Verify from clean dist: `rm -rf packages/*/dist && pnpm build` passes
- [x] Run `pnpm verify:fast`
- [x] Commit on `fix/build-dependency-order`

## Review

New `build` script:

```
concurrently "pnpm --filter @wafflebase/docs build" "pnpm sheets build" \
  && pnpm slides build \
  && concurrently "pnpm frontend build" "pnpm backend build" "pnpm cli build"
```

- Tier 0 (leaves, parallel): docs, sheets
- Tier 1: slides (needs docs dist)
- Tier 2 (parallel): frontend, backend, cli (need docs/sheets/slides dist)

Verification:

- `rm -rf packages/*/dist && pnpm build` -> exit 0 (clean state, was exit 1 before)
- `pnpm verify:fast` -> exit 0 (792 tests pass)

