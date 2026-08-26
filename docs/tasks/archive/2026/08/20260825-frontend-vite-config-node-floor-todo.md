# Frontend vite config must not require Node to parse TypeScript

`packages/frontend/vite.config.ts` imported `@wafflebase/debug-report/plugin`
as a **bare specifier** (#954). Vite's config bundler externalizes every bare
specifier — it resolves the id to an absolute path and marks it external — so
**Node**, not esbuild, loads that file. `@wafflebase/debug-report` exports raw
TypeScript (`"./plugin": "./src/plugin/index.ts"`), so Node was handed a `.ts`
file.

Node can only read TypeScript from **22.18**, where type stripping became the
default. Below that it throws `ERR_UNKNOWN_FILE_EXTENSION`, and because the
config fails to load, **every** frontend entry point dies:

- `pnpm dev`
- `pnpm --filter @wafflebase/frontend test` (no `vitest.config.ts` here, so
  vitest loads `vite.config.ts`)
- `frontend:build`
- `git push` — `.githooks/pre-push` is `exec pnpm verify:self`

Contributors on Node 22.14-22.17, inside the active 22 LTS line, could do none
of it, and the stack trace never mentions Node.

## Why nothing caught it

`ci.yml` pins `node-version: 22.x`, which `setup-node` resolves to the newest
22 — v22.23.2 on the #954 merge_group run, where `frontend:test` passed in
136s. `.nvmrc` says `22`, floating, and the root `package.json` has no
`engines` field. Nothing states the floor and nothing tests below it.

`packages/design-sandbox` has the same bare-specifier import of
`@wafflebase/design-editor` and is unaffected in tests, because it has its own
`vitest.config.ts` — so its vite config is only loaded when running `vite`
itself. That dependency is pre-existing and deliberate: see the comment in
`packages/design-sandbox/scripts/verify-tokens.mjs`, which records that Node's
type stripping is what loads it and that `--configLoader runner` was tried and
rejected with measurements. This task does not touch that; it keeps the **main
app** off the floor.

## Plan

- [x] Import the plugin by relative path so esbuild inlines it instead of
      handing it to Node. `tsconfig.node.json` already includes
      `vite.config.ts` with `allowImportingTsExtensions: true`, so the `.ts`
      specifier is the established convention, not a new exception.
- [x] Regression guard: `tests/vite-config-node-floor.test.ts` loads the
      config through `vite`'s own `loadConfigFromFile` under
      `node --no-experimental-strip-types`, which makes a modern Node stand in
      for an old one. Verified both directions — it fails with
      `ERR_UNKNOWN_FILE_EXTENSION` on the bare specifier and passes on the
      relative one, on v22.23.2.
- [x] Confirm on the real floor: Node v22.14.0 runs the full frontend suite
      (183 files / 1602 tests) and `vite build` (16.02s). Both were impossible
      before.
- [x] `pnpm verify:fast` green.
- [x] Commit, push, open the PR — merged as #959 (`47a9b0ab5`).

## Non-goals

- **Declaring an `engines.node` floor.** That was the other candidate fix. It
  documents the requirement instead of removing it, and drops part of an
  active LTS line as a side effect of an internal refactor. Removing the
  requirement is strictly better where it is this cheap.
- **Changing how `@wafflebase/debug-report` publishes.** Exporting source with
  no `dist` is deliberate (`docs/design/debug-report.md`), and the other three
  subpaths are aliased in `vite.config.ts` so Vite transforms them. `/plugin`
  was the only one Node loaded directly.
- **`packages/design-sandbox`.** Its dependency is documented and dev-only.

## Follow-up worth considering

CI cannot catch a floor raise while it tests only the newest 22. Either pin
`node-version` to the oldest supported version, or add it as a second matrix
entry. Not done here — it is a CI policy decision, not part of this fix.

## Review

_(to be filled after the PR lands)_
