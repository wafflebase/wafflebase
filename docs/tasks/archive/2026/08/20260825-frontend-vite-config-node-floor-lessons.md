# Lessons — frontend vite config Node floor

## A bare specifier in a Vite config is loaded by Node, not by esbuild

Vite bundles `vite.config.ts` with esbuild but leaves **bare specifiers
external** — it resolves the id to an absolute path and hands the loading to
Node. So a config that imports `@wafflebase/debug-report/plugin`, a package
whose `exports` point at raw TypeScript, makes Node read a `.ts` file.

Node can only do that from **22.18**, where type stripping became the default.
Below it, `ERR_UNKNOWN_FILE_EXTENSION` — and because the failure is in loading
the config, *every* frontend entry point dies at once: `pnpm dev`, the test run
(no `vitest.config.ts` here, so vitest loads `vite.config.ts`), the build, and
`git push` through the pre-push hook.

The fix is to import by **relative path with the `.ts` extension**, which puts
the file back inside the graph esbuild inlines.

This is the same mechanism as the first defect in the design-editor packaging
work (#966): a Vite plugin is loaded by Node, so anything it can reach must be
something Node can read. Two different symptoms, one rule.

## A floating Node version tests only the ceiling

`ci.yml` pins `node-version: 22.x`, which `setup-node` resolves to the newest 22
— v22.23.2 on the run that merged the regression. `.nvmrc` says `22`, also
floating. The root `package.json` has no `engines` field. **Nothing stated the
floor and nothing tested below it**, so a change that raised the minimum by four
patch releases inside an active LTS line was invisible to every gate.

## Make a modern Node stand in for an old one

The regression guard does not need an old Node installed. It loads the config
through vite's own `loadConfigFromFile` under
`node --no-experimental-strip-types`, which turns off exactly the capability the
floor is about.

Verified in both directions before being trusted: it fails with
`ERR_UNKNOWN_FILE_EXTENSION` against the bare specifier and passes against the
relative one, on the same interpreter. A guard that has only been seen to pass
has not been seen to work.

## A package that exports TypeScript constrains everyone who imports it

`@wafflebase/debug-report` shipping `"./plugin": "./src/plugin/index.ts"` is
fine for the browser, which reaches it through Vite. It is a trap for any
consumer whose loader is Node — and a Vite *config* is such a consumer, which is
not obvious from either side of the import.

`packages/design-sandbox` has the same bare-specifier import and is unaffected
only because it has its own `vitest.config.ts`, so its vite config is loaded
only when `vite` itself runs. That is a coincidence of layout, not a design.
