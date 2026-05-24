# Frontend Vitest Migration — Lessons

Design: [cross-package-source-resolution.md](../../design/cross-package-source-resolution.md)

## Vitest reuses the package's existing Vite config — source resolution comes free

- **Pattern:** Frontend's `vite.config.ts` already aliased
  `@wafflebase/{sheets,docs,slides}` → `../*/src/index.ts` for the dev
  server. Importing `defineConfig` from `vitest/config` and adding a `test`
  field makes Vitest reuse those aliases + the React plugin + the antlr
  `assert`-shim + jsdom.
- **Why:** The bespoke `resolve-hooks.mjs` reimplemented (worse) what the
  bundler config already did. The three runtime blockers that defeated
  `--experimental-strip-types` (parameter properties, directory imports,
  antlr CJS interop) are all handled by Vite's esbuild pipeline.
- **How to apply:** Before building custom test-resolution machinery, check
  whether the package's bundler already resolves what you need and whether
  the test runner can reuse that config.

## node:test → Vitest is mostly mechanical; codemod it, but validate by running

- **Pattern:** `describe`/`it`/`test`/`beforeEach` map 1:1; `assert.*` →
  `expect` is a fixed table; `mock.fn`→`vi.fn`, `mock.calls[i].arguments[j]`
  →`[i][j]`. A jscodeshift transform handled ~1,100 sites across 42 files.
- **Why:** The codemod had two gaps that only a real run surfaced:
  (1) it added `vi` to imports but didn't rewrite `mock.fn` call sites
  → `ReferenceError: mock is not defined` (31 failures);
  (2) recast dropped the file's leading comment when removing the first
  import → a top-of-file `/* eslint-disable @typescript-eslint/no-explicit-any */`
  vanished, failing lint in one file.
- **How to apply:** Treat a codemod as a draft. Run the full suite **and**
  the linter after applying; fix the transform at the root (re-run from a
  clean revert) rather than hand-patching outputs. Preserve leading comments
  explicitly when removing the first statement.

## `.tsx` components load under jsdom+react — the old stubs were unnecessary

- **Pattern:** `resolve-hooks.mjs` stubbed `.tsx` files because strip-types
  can't parse JSX and to avoid loading real components. Under Vitest
  (jsdom + `@vitejs/plugin-react`), a test transitively importing renderer/
  icon components (`chart-registry.test.ts`) loads them for real and passes.
- **How to apply:** Validate the riskiest dimension first in the pilot (here:
  a test that pulls real JSX). It de-risked deleting the entire stub block.

## Parity ≠ identical counts across runners

- **Pattern:** node:test reported 439 tests / 399 pass / 40 skip; Vitest
  reports 443 / 399 / 44. The **pass count is the parity signal** (exact);
  the skip/total delta is a counting convention (Vitest counts each `it`
  inside a skipped block; node:test counts the block).
- **How to apply:** Compare pass counts and the set of files collected
  (38 run + 4 skipped = 42 = all), not raw totals, when changing runners.

## Scope discipline with directory-wide codemods

- **Pattern:** Passing the `tests/` directory to jscodeshift also rewrote
  `.integration.ts` (a separate `tsx --test` lane). Used
  `--ignore-pattern="**/*.integration.ts"` and reverted the strays.
- **How to apply:** Constrain codemod globs to exactly the target lane;
  verify `git status` shows only intended files after a bulk transform.
