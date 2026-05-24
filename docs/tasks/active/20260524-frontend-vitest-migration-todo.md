# Frontend Tests → Vitest (source-first runtime channel) — Todo

Design: [cross-package-source-resolution.md](../../design/cross-package-source-resolution.md)

## Problem

Frontend was the only package running tests on
`node --experimental-strip-types --import ./tests/register-hooks.mjs --test`,
with a bespoke loader resolving workspace deps to stale `dist/`. strip-types
can't transpile (TS parameter properties, dir imports, antlr CJS), so the
runtime test channel couldn't go source-first. `slides`/`docs`/`sheets`
already use Vitest. Migrating frontend kills the stale-`dist/` runtime
false-failure class and deletes the custom loader stack.

## Tasks

- [x] Phase 0 pilot: add `vitest`/`jsdom`/`@vitest/coverage-v8`; add `test`
      field to `vite.config.ts` (jsdom, reuse existing source aliases)
- [x] Pilot-migrate 4 risk-representative files (logic, mock+source, DOM/yorkie,
      transitive `.tsx`) → all pass; confirmed `.tsx` components load under
      jsdom (stubs droppable)
- [x] Write throwaway jscodeshift codemod (assert.*→expect, node:test→vitest,
      mock.fn→vi.fn, `.mock.calls[i].arguments[j]`→`[i][j]`, preserve leading
      comments)
- [x] Apply codemod to 42 `.test.ts` (exclude `.integration.ts`)
- [x] Fix codemod gaps found by running: mock rewrite + leading-comment
      (eslint-disable) preservation
- [x] Delete `resolve-hooks.mjs` + `register-hooks.mjs`; scripts → `vitest`
- [x] Parity: 399 passed / 0 failed (44 skipped vs baseline 40 — runner
      skip-counting convention; 399 pass is exact)
- [x] `pnpm frontend lint` clean; `pnpm verify:fast` exit 0
- [x] Spot-check: `slides/src`-only symbol visible to `pnpm frontend test`
      with no rebuild (was the failing case under dist-first)
- [ ] Self code-review the branch diff
- [ ] Open PR (Summary + Test plan)

## Review (results)

- **Runner swapped, not rewritten by hand:** a jscodeshift codemod did the
  ~1,100 `assert.*`→`expect` conversions + runner/mock imports across 42
  files; output verified clean (messages, `rejects` arrow-unwrap + `await`,
  regex matchers all preserved).
- **Custom infra deleted:** `resolve-hooks.mjs` (dist-first resolution +
  hand-written virtual stubs) and `register-hooks.mjs` are gone; Vitest
  reuses `vite.config.ts` aliases (already source-pointing) + react plugin +
  antlr shim + jsdom.
- **Config delta is tiny:** `vite.config.ts` gains a `test` field; scripts
  `test`→`vitest --run`, `test:watch`→`vitest`; devDeps added.
- **`.integration.ts` lane untouched** (separate `tsx --test` glob).
- **Verified:** 399/0 parity, lint clean, verify:fast exit 0, source
  resolution proven by probe.
