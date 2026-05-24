# Source-First Typecheck Resolution — Lessons

Design: [cross-package-source-resolution.md](../../design/cross-package-source-resolution.md)

## `--experimental-strip-types` is not a transpiler — it cannot load workspace source

- **Pattern:** The frontend test runner
  (`node --experimental-strip-types --import ./tests/register-hooks.mjs`)
  resolves `@wafflebase/*` to built `dist/` on purpose. Flipping
  `resolve-hooks.mjs` to prefer source breaks ~23 test files on import.
- **Why:** strip-types only *removes* type syntax; it cannot emit code.
  Three things the bundled `dist/` hid surfaced at once:
  (1) directory imports (`export … from './import/pptx'` → Node ESM needs
  `/index`), (2) `antlr4ts` CJS named-export interop, (3) TS **parameter
  properties** (`constructor(private doc: Doc, …)` in
  `docs/src/view/find-replace.ts`) which require codegen.
- **How to apply:** Do not assume "source is loadable because a `src`
  fallback exists." Loading workspace source in the test runner needs a
  real transpiling loader (`tsx`/esbuild). Verify before scoping — a
  read-only grep for "no JSX/enum" is insufficient; parameter properties
  and directory imports also break strip-only mode.

## `customConditions`-to-source compiles the dependency under the *consumer's* tsconfig

- **Pattern:** Pointing an `exports` condition at `./src/index.ts` and
  enabling it via `customConditions` makes `tsc` pull the dependency's
  `.ts` source into the consumer's program — and type-check it with the
  **consumer's** `compilerOptions` (`lib`, strict flags), not the
  dependency's.
- **Why:** `slides typecheck → docs` works because both are browser/canvas
  packages (`lib: [DOM]`). `cli typecheck → slides` fails with
  `TS2304: Cannot find name 'Path2D'` because cli is Node (`lib: [ES2022]`,
  no DOM). `skipLibCheck` masks this for `dist/*.d.ts` but not for followed
  `.ts` source.
- **How to apply:** Only wire source edges between packages with a
  compatible environment. Cross-environment consumers (cli, backend) need
  TS **project references** (each project checks its own files with its own
  `lib`), not the shared-program `customConditions` trick. Validate each
  new edge with a real `typecheck` run; never assume.

## Prefer a dedicated condition name over the conventional `development`

- **Pattern:** Used `wafflebase-source`, not `development`.
- **Why:** `development` is also enabled by Vite's dev server, which would
  silently switch the frontend dev server to load workspace source — a
  side effect outside scope. A made-up name is matched by nothing except
  the explicit `customConditions` opt-in.
- **How to apply:** For surgical, opt-in resolution overrides, invent a
  condition name no standard tool enables; keep the full
  `node`/`types`/`import`/`require`/`default` set after it so every other
  resolver behaves exactly as before.

## `allowImportingTsExtensions` forces a split tsconfig for `tsc`-built packages

- **Pattern:** Resolving to a `.ts` target needs
  `allowImportingTsExtensions`, which requires `noEmit`. Packages whose
  `build` is Vite (`docs`/`slides`/`sheets`) have a `noEmit`,
  typecheck-only `tsconfig.json`, so the flag fits. A package whose `build`
  is `tsc` (`cli`) shares one emitting config → the flag can't go there.
- **How to apply:** For `tsc`-built consumers, add a `noEmit`
  `tsconfig.typecheck.json` that `extends` the base and is named by the
  `typecheck` script; leave `build` on the base config (dist resolution).

## Process: stop-and-replan paid off

- The CLAUDE.md "if it goes sideways, STOP and re-plan" rule turned a
  failing approved plan (runtime channel) into a clean, verified, 2-line
  shipped change (typecheck channel) plus two documented constraints —
  instead of a hacky push. Empirical spikes (probe + negative control)
  beat assumptions twice in this task.
