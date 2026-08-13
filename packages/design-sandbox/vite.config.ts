/**
 * Wafflebase's own instance of the design editor.
 *
 * This file is the whole point of the package split. `design-editor-local-plugin.md` §6
 * enumerates thirteen couplings the prototype's 2,538-line `vite.config.ts` had to the
 * wafflebase repository; 8a deleted them from the plugin, and the ones that are genuinely
 * ours land here — as a consumer's ordinary Vite config, which is exactly what a foreign
 * project would write. If the plugin needed anything from this file that were not
 * expressible as an option, the split would have failed.
 *
 * WHAT IS DELIBERATELY NOT HERE YET, so it does not read as forgotten.
 *
 * §6 assigns 8c a second group of rows: the `@` and `@wafflebase/*` aliases, the app-libs
 * aliases into `packages/frontend/node_modules`, `optimizeDeps.include`, the `define`
 * globals, the antlr4ts `util`/`assert` shims, and `yorkieOffline()`. Every one of them
 * justifies itself by a SCENE — "the DOM documents scene reaches the engines
 * transitively", "`providers.tsx` imports `MemoryRouter`", "`yorkie-offline.tsx` needs an
 * escape specifier" — and the scene runtime that mounts scenes is PRs 10-12. Every scene in
 * `scenes.config.json` is `deferred` for the same reason.
 *
 * `react()` and `tailwindcss()` are on that list too, for exactly the same reason: they
 * exist to process the consumer's own scene source and host stylesheet, and no scene source
 * is served yet.
 *
 * Porting all of it now would land config that no test and no dev server exercises, whose
 * comments assert things about files that do not exist. So it lands with the code that needs
 * it, where the reasoning can be checked rather than inherited. `opaqueRoots` is the one
 * exception below, and it says why.
 *
 * It would not have been free, either: keeping `react()` meant `@vitejs/plugin-react` as a
 * dependency, whose babel tree moves 39 lines of `pnpm-lock.yaml` that have nothing to do
 * with a token adapter.
 *
 * WHAT DOES WORK TODAY: `pnpm dev` here serves the bridge at `/__design-editor/api/*`, so
 * the token pipeline is reachable end to end — `GET /tokens`, `POST /preview-tokens`,
 * `/mutate`, `/commit`. `scripts/verify-tokens.mjs` drives exactly that. The shell UI at
 * `/__design-editor/` 404s until PRs 10-12 build it, which the plugin reports as a missing
 * `dist/shell` rather than a crash.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { designEditor } from '@wafflebase/design-editor';
import { wafflebaseCore } from './src/tokens/core-adapter';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * The repository root — the prototype's `REPO_ROOT`, and now just an argument.
 *
 * It was a module-level `const` with 50 use sites inside the plugin, which is the
 * coupling §6 heads its table with. Here it is one value a consumer computes for their own
 * layout: the editor's write boundary is the monorepo, because the scenes are in
 * `packages/frontend` while the tokens are in `packages/core`, and neither is the Vite root.
 * That divergence is precisely the case `options.root` exists for.
 */
const REPO_ROOT = path.resolve(HERE, '../..');

export default defineConfig({
  root: HERE,
  plugins: [
    designEditor({
      root: REPO_ROOT,
      scenes: path.join(HERE, 'scenes.config.json'),
      /**
       * Trees that are resolved and served but never re-queried per frame side.
       *
       * The one scene-related option that lands early, because it is not a matched pair
       * with any deferred file: the value is four paths and the behaviour is inert without
       * scenes. §6 uses it as its example of the shape the generalization aims for — the
       * OPTION is generic ("any consumer with a large non-JSX subtree wants this") and only
       * its value is wafflebase's. Keeping it here is what shows that, and the alternative
       * is a reader concluding the plugin still knows about our engines.
       *
       * It is a performance boundary, not an alias list: a subtree with no JSX and no scene
       * entry cannot be the target of a layout intent, so frame-qualifying it doubles every
       * mount of a scene that imports it — ~490 engine modules read twice, on a WSL2/drvfs
       * mount, for content byte-identical between "before" and "after".
       */
      opaqueRoots: [
        path.join(REPO_ROOT, 'packages/sheets/src'),
        path.join(REPO_ROOT, 'packages/docs/src'),
        path.join(REPO_ROOT, 'packages/slides/src'),
        path.join(REPO_ROOT, 'packages/notes/src'),
      ],
      /**
       * The four-file `@wafflebase/core` pipeline.
       *
       * The inversion §4 asks for, in one line: our token pipeline is now a plugin option
       * supplied by our own package, and `cssVariables` — the plain-CSS-custom-properties
       * case — is what a consumer gets by default. The plugin has no notion of either.
       */
      tokens: wafflebaseCore({ root: REPO_ROOT }),
    }),
  ],
});
