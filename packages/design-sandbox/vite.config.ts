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
 * WHAT WORKS TODAY: `pnpm dev` here serves the bridge and, since 11b, the shell UI at
 * `/__design-editor/`. The scene list, the outline over our own `packages/frontend`
 * files, and the token pipeline (`GET /tokens`, `POST /preview-tokens`, `/mutate`,
 * `/commit` — driven by `scripts/verify-tokens.mjs`) all work.
 *
 * WHAT DOES NOT: the frame. Every scene is still `deferred`, so its loader table is empty
 * and it reports `no scene "<id>" in the scene manifest`. Un-deferring needs the rows
 * above plus `providers.tsx` and `fixtures/**` — PR 11c, which changes only this package.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { designEditor, BASE } from '@wafflebase/design-editor';
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

/**
 * The app's libraries, resolved to THE APP'S COPY.
 *
 * `providers.tsx` imports `MemoryRouter` and `QueryClientProvider` directly, and it lives
 * in THIS package — so pnpm's isolated `node_modules` cannot resolve them; they are the
 * frontend's dependencies. Declaring them as our own would resolve and would be the WRONG
 * fix: we would get a second copy, and the day the versions drift the scene's
 * `useNavigate` and our `MemoryRouter` come from different module instances —
 * "useNavigate() may be used only in the context of a <Router>", from a tree that visibly
 * has one.
 *
 * Directory replacements, so subpath imports still resolve. `react` and `react-dom` are
 * NOT here: measured, pnpm already gives both packages the same physical `react@19.1.0`,
 * so declaring them is one copy already.
 */
const APP_LIBS = [
  'react-router-dom',
  '@tanstack/react-query',
  '@tanstack/react-table',
  'sonner',
  '@tabler/icons-react',
  // Canvas engines reach the SDK directly, and the shim constructs its `Document` from it.
  // One copy — the app's — for the same class-identity reason as the rest of this list.
  '@yorkie-js/sdk',
];

/**
 * The offline shim `@yorkie-js/react` is redirected to, and the escape specifier the shim
 * uses to reach the real package.
 *
 * A canvas scene's page imports `@yorkie-js/react` directly (`DocumentProvider`,
 * `useDocument`, `usePresences`) and that binding is what attaches a document to a live
 * server. Rather than fake a WebSocket, the whole module is redirected to a shim that
 * constructs a real but DETACHED `Document` — see `src/scenes/canvas/yorkie-offline.tsx`
 * for why that works and for the class-identity trap that rules out reimplementing it.
 *
 * The ESCAPE is aliased by this exact longer string, never by the bare specifier:
 * `vite:alias` runs before every user plugin, even one declared `enforce: 'pre'`, so
 * aliasing `@yorkie-js/react` would rewrite it to the real package before the plugin below
 * ever saw the string to redirect. Every canvas scene would then bind to the real,
 * network-backed provider — which renders without throwing and waits forever on an
 * `attach()` that never happens.
 */
const YORKIE_SHIM = path.resolve(HERE, 'src/scenes/canvas/yorkie-offline.tsx');
const YORKIE_REAL = '@yorkie-js/react/__wb-real';

/**
 * Send the bare `/` to the editor.
 *
 * This package's Vite root holds no `index.html`, so the root URL — the one Vite
 * prints on start (`http://localhost:5173/`) — dead-ends; the editor lives at
 * `BASE`. Redirecting makes the printed link land on the editor. A REAL consumer
 * would not want this (their `/` is their own app), which is why it lives in this
 * consumer config rather than in the generic plugin.
 */
function redirectRootToEditor(): Plugin {
  return {
    name: 'design-sandbox-redirect-root',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        if (url === '/' || url === '') {
          res.statusCode = 302;
          res.setHeader('Location', `${BASE}/`);
          res.end();
          return;
        }
        next();
      });
    },
  };
}

function yorkieOffline(): Plugin {
  return {
    name: 'design-sandbox-yorkie-offline',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (source === '@yorkie-js/react') return YORKIE_SHIM;
      if (source === YORKIE_REAL) {
        // `skipSelf`, or this hook answers its own question forever.
        return this.resolve(YORKIE_REAL, importer, { ...options, skipSelf: true });
      }
      return null;
    },
  };
}

/**
 * A DELIBERATELY UNRESOLVABLE API origin.
 *
 * Every scene request is rewritten onto this host, so nothing can reach a real backend
 * from inside the frame, and the fetch guard keys its table on the pathname alone —
 * `http://scene.invalid/api/documents?x=1` → `/api/documents?x=1`. The guard's own
 * `keyOf` is written against exactly this shape.
 */
const SCENE_API_ORIGIN = 'http://scene.invalid/api';

/** The version the frontend's own `define` block injects; scene source may read it. */
function rootVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export default defineConfig({
  root: HERE,
  /**
   * Mirrors `packages/frontend/vite.config.ts`. Scene source IS real app source: it reaches
   * `process.env` shims and `__APP_VERSION__`, and an undefined global is a hard failure
   * rather than a degraded render — measured as a `process is not defined` mount error on
   * the login scene.
   */
  define: {
    'process.env': {},
    __APP_VERSION__: JSON.stringify(rootVersion()),
    'import.meta.env.VITE_BACKEND_API_URL': JSON.stringify(SCENE_API_ORIGIN),
  },
  resolve: {
    /**
     * ONE REACT, and this boundary needs saying so explicitly.
     *
     * 11b measured that the design-editor ↔ consumer boundary needs no `dedupe`: Vite's
     * optimizer pre-bundles `react` once from the project root and both sides import that
     * chunk. That finding does NOT transfer here. The Vite root is `packages/design-sandbox`
     * while the scene source is `packages/frontend/src`, so a frontend component's bare
     * `react` resolves through `packages/frontend/node_modules` — a different specifier
     * path from ours, even though pnpm points both at the same `react@19.1.0`. Measured
     * without this: "Invalid hook call … mismatching versions of React and the renderer",
     * then `Cannot read properties of null (reading 'useState')`, and a frame that renders
     * nothing.
     */
    dedupe: ['react', 'react-dom'],
    alias: {
      /*
       * Frontend components import each other as `@/…`, and the frontend is private with
       * no exports map, so `@` resolves to its source directly. The plugin READS this
       * rather than being told about it — the same alias seam the fixture consumer uses.
       */
      '@': path.resolve(REPO_ROOT, 'packages/frontend/src'),
      /*
       * The engine packages, resolved to SOURCE, exactly as the frontend's own config
       * does. Not speculative for canvas scenes: the DOM documents scene reaches them
       * through `document-list.tsx → upload-queue.ts → apply-imported-content.ts`, which
       * value-imports `initialSpreadsheetDocument` from `@wafflebase/sheets`. Resolving
       * through the exports map instead fails in a fresh checkout — the engines publish
       * from `dist/`, which nothing has built — as a mount error on a scene whose page
       * file mentions none of this.
       *
       * `@wafflebase/core` is deliberately NOT aliased: the frontend's `index.css` pulls
       * tokens through the exports map (`@wafflebase/core/tokens.css`), and a
       * bare-package alias would rewrite that subpath to `…/src/index.ts/tokens.css`.
       */
      '@wafflebase/sheets': path.resolve(REPO_ROOT, 'packages/sheets/src/index.ts'),
      '@wafflebase/docs': path.resolve(REPO_ROOT, 'packages/docs/src/index.ts'),
      '@wafflebase/notes': path.resolve(REPO_ROOT, 'packages/notes/src/index.ts'),
      '@wafflebase/slides': path.resolve(REPO_ROOT, 'packages/slides/src/index.ts'),
      /*
       * `board` was NOT in the prototype's alias list — the package did not exist yet. It
       * is reached the same transitive way as the rest (`apply-imported-content.ts`
       * value-imports it), so without this the login scene 500s on
       * "Failed to resolve entry for package @wafflebase/board" and the frame reports a
       * mount error naming `providers.tsx` instead. Any engine package the frontend
       * value-imports has to be here; the current set is sheets/docs/slides/notes/board.
       */
      '@wafflebase/board': path.resolve(REPO_ROOT, 'packages/board/src/index.ts'),
      ...Object.fromEntries(
        APP_LIBS.map((pkg) => [pkg, path.resolve(REPO_ROOT, 'packages/frontend/node_modules', pkg)]),
      ),
      // The escape only. See `YORKIE_REAL` above for why the bare specifier is not here.
      [YORKIE_REAL]: path.resolve(REPO_ROOT, 'packages/frontend/node_modules/@yorkie-js/react'),
    },
  },
  /**
   * Declared up front, not discovered.
   *
   * Scene subtrees pull in dependencies this package never imports itself. Left to
   * discovery, Vite optimizes each one as it is first requested and serves it under a
   * fresh `?v=` hash — so a single frame load ends up mixing optimizer generations, and
   * the React instance one generation hands the frontend's components is not the one
   * `scene-entry` mounted with. Measured symptom: "Invalid hook call … mismatching
   * versions of React and the renderer", then `Cannot read properties of null (reading
   * 'useState')`, and a frame that paints nothing. `resolve.dedupe` alone does not fix it,
   * because the problem is generations rather than copies.
   *
   * The same list also prevents the milder failure it was originally written for: a
   * mid-session "new dependencies optimized, reloading", which reloads the frame and
   * throws away the selection.
   *
   * `@yorkie-js/react` deliberately stays OFF this list. `include` resolves a bare
   * specifier by plain node resolution, which does not consult a plugin's `resolveId` —
   * so listing it would pre-bundle the real, network-backed package and defeat the offline
   * shim that PR 12 adds for the canvas scenes.
   */
  optimizeDeps: {
    /**
     * NOT pre-bundled, and this one is measured.
     *
     * `@tabler/icons-react` is a barrel over ~5,000 single-icon modules, and 65 frontend
     * files import from it by name. Pre-bundled, esbuild emits a chunk PER ICON and the
     * browser fetches every one: the documents scene's first load made 11,794 requests to
     * `/.vite/deps/chunk-*.js` out of 12,503 total, and took 103 s on a WSL2/drvfs mount.
     * Excluded, that becomes 33 chunks and 61 s, with a byte-identical render.
     *
     * The deeper cause is the barrel import itself and it is NOT ours to fix — changing 65
     * frontend files to deep icon paths is an app-wide refactor with nothing to do with the
     * design editor. This is the part that belongs here.
     */
    exclude: ['@tabler/icons-react'],
    include: [
      '@tanstack/react-query',
      '@tanstack/react-table',
      'react-router-dom',
      'sonner',
      'lucide-react',
    ],
  },
  plugins: [
    /*
     * The consumer's own transform. The frame renders THEIR components, so their
     * `plugin-react` is the one that has to run — see the fixture consumer's config for
     * the same reasoning on a project that is not wafflebase.
     */
    // BEFORE `react()`: the redirect has to win before the transform sees the specifier.
    yorkieOffline(),
    react(),
    designEditor({
      root: REPO_ROOT,
      scenes: path.join(HERE, 'scenes.config.json'),
      providers: path.join(HERE, 'src/scenes/providers.tsx'),
      fixtures: path.join(HERE, 'src/scenes/fixtures/index.ts'),
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
    // A dev-only convenience, and order-independent: it only touches `/`, which is
    // disjoint from every other plugin's paths, so it sits last rather than muddling
    // the react()/yorkieOffline ordering note above.
    redirectRootToEditor(),
  ],
});
