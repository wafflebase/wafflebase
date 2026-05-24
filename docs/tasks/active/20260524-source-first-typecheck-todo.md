# Source-First Typecheck Resolution — Todo

Design: [cross-package-source-resolution.md](../../design/cross-package-source-resolution.md)

## Problem

Cross-package typecheck resolves workspace deps via built `dist/*.d.ts`
(gitignored, not rebuilt by `verify:fast`), so editing a package's `src`
(e.g. adding an export) produces `TS2353` / "missing export" false
failures until a rebuild. Single most frequent process pain in the
lessons corpus (~18 tasks). #287 only fixed the from-scratch `pnpm build`
ordering, not the inner loop.

## Scope (this PR)

Typecheck channel only, proven edge: `slides typecheck` → `@wafflebase/docs`
source. Runtime test channel and cross-environment consumers (cli/backend)
are deferred — both hit hard constraints (see lessons).

## Tasks

- [x] Investigate resolution channels (runtime `resolve-hooks.mjs` vs `tsc`)
- [x] Attempt runtime source-first → **blocked** by `--experimental-strip-types`
      (dir imports, antlr CJS interop, TS parameter properties); reverted
- [x] Add `wafflebase-source` exports condition to `packages/docs/package.json` (`.` root)
- [x] Add `customConditions: ["wafflebase-source"]` to `packages/slides/tsconfig.json`
- [x] Spike cli too → **blocked** by Node-vs-DOM `lib` mismatch (`Path2D`); reverted to dist
- [x] Narrow scope to slides→docs (proven clean); remove unused conditions/configs
- [x] Verify: `pnpm slides typecheck` green; positive probe (symbol in src only) green;
      negative control (condition removed) fails as expected
- [x] Verify: full `pnpm verify:fast` exit 0
- [x] Write/update design doc with implemented mechanism + validated constraints
- [ ] Self code-review the branch diff
- [ ] Open PR (Summary + Test plan)

## Review (results)

- **Code change is 2 lines:** `docs/package.json` exports gains a
  `wafflebase-source` → `./src/index.ts` entry (first, before dist
  conditions); `slides/tsconfig.json` gains `customConditions:
  ["wafflebase-source"]`.
- **Verified source resolution** with a positive probe (symbol present
  only in `docs/src`, absent from `docs/dist`, consumed by slides →
  `slides typecheck` green without rebuilding docs) and a negative control
  (remove the condition → `tsc` exit 2, correctly back on stale dist).
- **`pnpm verify:fast` exit 0.** `slides build` (Vite) and `pnpm build`
  unaffected; the custom condition is inert to every resolver that doesn't
  opt in.
- **Deliberately narrow:** cli/backend and the runtime test channel are
  documented follow-ups with the reasons they were excluded.
