/**
 * The resolve aliases wafflebase's own scenes need, in ONE place.
 *
 * `vite.config.ts` and `vitest.config.ts` are deliberately separate files — adopting the
 * former for tests would construct the plugin and its adapter child process per worker — so
 * anything both need has to be shared explicitly or it drifts. The seed tests import
 * `@yorkie-js/sdk` and `@wafflebase/sheets` exactly as the scenes do, and they must resolve
 * to the SAME copies or the test proves nothing about what runs.
 *
 * The tsconfig's `paths` mirrors this list, and the two are a matched pair: a `paths` entry
 * without an alias typechecks and then fails at runtime, and an alias without a `paths` entry
 * runs and then fails to typecheck.
 */
import path from 'node:path';

/**
 * The app's libraries, resolved to THE APP'S COPY.
 *
 * Declaring these as our own dependencies would resolve and would be the WRONG fix: we would
 * get a second copy, and the day the versions drift the scene's `useNavigate` and our
 * `MemoryRouter` come from different module instances — "useNavigate() may be used only in
 * the context of a <Router>", from a tree that visibly has one. The same reasoning covers
 * `@yorkie-js/sdk`, whose CRDT classes are compared by identity.
 *
 * Directory replacements, so subpath imports still resolve. `react`/`react-dom` are NOT here:
 * measured, pnpm already points both packages at the same `react@19.1.0`.
 */
export const APP_LIBS = [
  'react-router-dom',
  '@tanstack/react-query',
  '@tanstack/react-table',
  'sonner',
  '@tabler/icons-react',
  '@yorkie-js/sdk',
];

/**
 * The escape specifier the offline shim uses to reach the REAL `@yorkie-js/react`.
 *
 * Aliased by this exact longer string, never by the bare specifier: `vite:alias` runs before
 * every user plugin, even one declared `enforce: 'pre'`, so aliasing `@yorkie-js/react` would
 * rewrite it to the real package before `yorkieOffline()` ever saw the string to redirect.
 * Every canvas scene would then bind to the real, network-backed provider — which renders
 * without throwing and waits forever on an `attach()` that never happens.
 */
export const YORKIE_REAL = '@yorkie-js/react/__wb-real';

/**
 * The engine packages, resolved to SOURCE, exactly as the frontend's own config does.
 *
 * Not speculative: the DOM documents scene reaches them through
 * `document-list.tsx → upload-queue.ts → apply-imported-content.ts`, which value-imports
 * `initialSpreadsheetDocument` from `@wafflebase/sheets`. Resolving through the exports map
 * instead fails in a fresh checkout — the engines publish from `dist/`, which nothing has
 * built — as a mount error on a scene whose page file mentions none of this.
 *
 * `@wafflebase/core` is deliberately absent: the frontend's `index.css` pulls tokens through
 * the exports map (`@wafflebase/core/tokens.css`), and a bare-package alias would rewrite
 * that subpath to `…/src/index.ts/tokens.css`.
 */
export const ENGINES = ['sheets', 'docs', 'notes', 'slides', 'board'];

/** Build the full alias map for a given repository root. */
export function sceneAliases(repoRoot: string): Record<string, string> {
  return {
    '@': path.resolve(repoRoot, 'packages/frontend/src'),
    ...Object.fromEntries(
      ENGINES.map((e) => [`@wafflebase/${e}`, path.resolve(repoRoot, `packages/${e}/src/index.ts`)]),
    ),
    ...Object.fromEntries(
      APP_LIBS.map((pkg) => [pkg, path.resolve(repoRoot, 'packages/frontend/node_modules', pkg)]),
    ),
    [YORKIE_REAL]: path.resolve(repoRoot, 'packages/frontend/node_modules/@yorkie-js/react'),
  };
}
