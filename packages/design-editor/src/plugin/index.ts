/**
 * `designEditor(options)` — the single entry point, and the whole public surface.
 *
 * Returns an ARRAY of plugins rather than one. Vite supports that natively, and the
 * pieces have genuinely different hooks and different `enforce` values: the scene
 * patch must run `pre` (before `@vitejs/plugin-react`), the safelist transform must
 * run on the host's CSS, and the bridge and shell are middleware only. Collapsing
 * them into one object would mean one `enforce` for all of it.
 *
 * What this deliberately does NOT do, and the prototype did: add `react()` or
 * `tailwindcss()`, register a `resolve.alias`, set `define` globals, or list
 * `optimizeDeps.include`. Those are the host's config, and a plugin that overwrote
 * them would silently change how the consumer's own app builds.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin, ViteDevServer } from 'vite';
import { resolveOptions, type DesignEditorOptions, type ResolvedOptions } from './options.ts';
import { createPathGuard } from './paths.ts';
import { createTracker } from './tracked.ts';
import { createSafelist, isTailwindV4Entry } from './safelist.ts';
import { createTransactionStore } from './transactions.ts';
import { createModuleClassifier } from './frame.ts';
import { readManifest, renderScenesModule, SCENES_RESOLVED_ID, SCENES_VIRTUAL_ID } from './scenes.ts';
import { scenePatch } from './scene-patch.ts';
import { shellServer, BASE } from './shell.ts';
import { bridge } from './bridge.ts';
import type { IntentContext, Injector } from './intents.ts';
import type { FrameSide, MutateRequest } from './protocol.ts';

export type { DesignEditorOptions, TokenAdapter } from './options.ts';
export { BASE } from './shell.ts';

/**
 * The default `TokenAdapter`, exported from the same package as the plugin.
 *
 * §5's config example imports `{ designEditor, cssVariables }` together, and that is the
 * point: a consumer whose tokens are plain CSS custom properties should not have to write
 * an adapter to get the common case. Wafflebase's own four-file pipeline is the complex
 * one and ships separately in `design-sandbox` (8c), which is the inversion §4 asks for —
 * our pipeline stops being the assumption.
 */
export { cssVariables } from '../tokens/css-variables.ts';
export type { CssVariablesOptions } from '../tokens/css-variables.ts';
export type {
  TokenBinding,
  TokenBindings,
  TokenEdit,
  TokenEmitResult,
  TokenFamily,
  TokenFamilyMeta,
  TokenRef,
  TokenRegenResult,
  TokenTree,
  TokenVars,
  TokenWrite,
  TokenWriteResult,
} from '../tokens/adapter.ts';
export { camelToKebab, normaliseSource } from '../tokens/adapter.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * The package's own root, found by walking up to its `package.json`.
 *
 * Not a fixed `../..` from this module: that hard-codes how deeply the file sits,
 * which is one thing when running from `src/plugin/` and another once the package is
 * emitted to `dist/`. Walking up is stable under both, and under a consumer's
 * `node_modules/@wafflebase/design-editor/` layout.
 */
function packageRoot(from: string): string {
  let dir = from;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const up = path.dirname(dir);
    // Reached the filesystem root without finding one. Returning `from` keeps the
    // failure local — the shell 404s with its "was the package built?" message —
    // rather than throwing during config resolution and taking the dev server down.
    if (up === dir) return from;
    dir = up;
  }
}

/**
 * Where the prebuilt shell lives.
 *
 * `dist/shell` under the package root, which is what `vite.shell.config.ts` emits.
 * §2's target layout draws `index.html` / `scene.html` at the package root; they are
 * kept under `dist/` instead so the served set is exactly the built artefacts and a
 * stray root-level HTML file cannot be served by accident.
 */
const SHELL_DIR = path.join(packageRoot(HERE), 'dist', 'shell');

/**
 * The scene frame's entry, as a URL the CONSUMER's dev server resolves.
 *
 * `/@fs/<abs>` rather than a bare specifier or a virtual module. Measured against
 * Vite 6.4.3 + @vitejs/plugin-react 4.3.4: a virtual module is NOT transformed even
 * with a `.tsx` id — its JSX reaches `vite:import-analysis` verbatim and the frame
 * 500s on its own entry — while a real `.tsx` under `node_modules` is. So it has to
 * be a real path, and it is computed here at serve time because a prebuilt document
 * cannot know where the consumer's package manager put us.
 *
 * From SOURCE, not from `dist`: this file has to stay untransformed for the
 * consumer's `plugin-react` to be the one transforming it, which is the whole reason
 * it is excluded from the shell bundle.
 *
 * POSIX separators unconditionally — this is a URL, and a Windows `\` in it would
 * be a path segment escape rather than a separator.
 */
const SCENE_ENTRY_URL = `/@fs/${path
  .join(packageRoot(HERE), 'src', 'scenes', 'scene-entry.tsx')
  .split(path.sep)
  .join('/')
  .replace(/^\/+/, '')}`;

export function designEditor(options?: DesignEditorOptions): Plugin[] {
  // Resolved in `configResolved`, because Vite's own root is not known before it.
  // Every module below reads it through this box rather than capturing a value, so
  // there is no window in which a stale root is in use.
  let resolved: ResolvedOptions | null = null;
  const need = (): ResolvedOptions => {
    if (!resolved) throw new Error('designEditor(): used before configResolved');
    return resolved;
  };

  let guard = createPathGuard(process.cwd());
  let tracker = createTracker((abs) => guard.relOf(abs));
  let classifier = createModuleClassifier(process.cwd());
  let transactions = createTransactionStore(guard, tracker);
  const safelist = createSafelist();
  const plans = new Map<FrameSide, MutateRequest[]>();

  /**
   * The engine modules are loaded LAZILY and only once.
   *
   * They are `.mjs` with no build step, so importing them eagerly would pull the
   * TypeScript-free AST layer into every consumer's config evaluation — including
   * `vite build`, where this plugin does nothing at all.
   */
  let injectorPromise: Promise<Injector> | null = null;
  const loadInjector = (): Promise<Injector> =>
    (injectorPromise ??= import('../server/inject.mjs') as unknown as Promise<Injector>);

  /** Lazily loaded: `extract.mjs` pulls in the TypeScript compiler. */
  let extractorPromise: Promise<never> | null = null;

  let stampPromise: Promise<{ stampSource: (t: string, f: string) => { text: string; stamped: string[] } }> | null = null;
  const loadStamper = () =>
    (stampPromise ??= import('../server/stamp.mjs') as unknown as Promise<{
      stampSource: (t: string, f: string) => { text: string; stamped: string[] };
    }>);

  const intentContext = async (): Promise<IntentContext> => ({
    guard,
    tracker,
    injector: await loadInjector(),
    tokens: need().tokens,
  });

  /** The host stylesheet ids the safelist directive was appended to. */
  const safelistHosts = new Set<string>();

  const core: Plugin = {
    name: 'wafflebase-design-editor',
    apply: 'serve',

    configResolved(config) {
      resolved = resolveOptions(options, config.root, config.resolve.alias);
      guard = createPathGuard(resolved.root, resolved.opaqueRoots);
      tracker = createTracker((abs) => guard.relOf(abs));
      classifier = createModuleClassifier(resolved.root, (abs) => guard.isOpaque(abs));
      transactions = createTransactionStore(guard, tracker);
      config.logger.info(
        `[design-editor] editing ${resolved.root} — open ${BASE}/` +
          (resolved.tokens ? '' : ' (no token adapter: token panels are read-only)'),
      );
    },

    resolveId(id) {
      return id === SCENES_VIRTUAL_ID ? SCENES_RESOLVED_ID : null;
    },

    load(id) {
      if (id !== SCENES_RESOLVED_ID) return null;
      const o = need();
      // Read on every load rather than cached, so editing the manifest and
      // refreshing is enough — the manifest is the consumer's authoring surface and
      // a restart-to-see-it loop is what makes §5's cliff worse.
      return renderScenesModule(o.root, readManifest(o.scenes), o.providers, o.fixtures);
    },

    /**
     * Append the safelist directive to the host's Tailwind v4 entry stylesheet.
     *
     * Detection is by content (`@import "tailwindcss"`), so a v3 or plain-CSS
     * project never receives a v4 directive its pipeline cannot parse — the no-op
     * §6 requires, reached automatically rather than by a config flag.
     */
    transform(code, id) {
      if (!id.split('?')[0].endsWith('.css')) return null;
      if (!isTailwindV4Entry(code)) return null;
      safelistHosts.add(id);
      const directive = safelist.directive();
      return directive ? `${code}\n${directive}` : null;
    },
  };

  /**
   * Invalidate the host stylesheet so Tailwind re-reads the directive.
   *
   * Without this the candidate registers and nothing recompiles, so the preview
   * still shows the class applied and nothing changing — the exact symptom the
   * safelist exists to fix.
   */
  const onSafelistChange = (server: ViteDevServer) => {
    for (const id of safelistHosts) {
      const mod = server.moduleGraph.getModuleById(id);
      if (mod) server.reloadModule(mod).catch(() => {});
    }
  };

  return [
    core,
    scenePatch({
      guard: () => guard,
      classifier: () => classifier,
      plans,
      intentContext,
      stampSource: async (text, file) => (await loadStamper()).stampSource(text, file),
      readFile: (abs) => tracker.read(abs),
    }),
    shellServer({ distDir: SHELL_DIR, sceneEntryUrl: SCENE_ENTRY_URL }),
    bridge({
      loadExtractor: () =>
        (extractorPromise ??= import('../server/extract.mjs') as unknown as Promise<never>),
      get options() {
        return need();
      },
      get guard() {
        return guard;
      },
      get tracker() {
        return tracker;
      },
      safelist,
      get transactions() {
        return transactions;
      },
      plans,
      intentContext,
      onSafelistChange,
    }),
    stamperBridge(loadStamper),
  ];
}

/**
 * The stamper is loaded lazily like the injector, but the scene patch needs it
 * synchronously inside `load()`. This tiny plugin warms it in `buildStart`, so the
 * first scene mount does not pay for the import mid-request.
 */
function stamperBridge(
  loadStamper: () => Promise<{ stampSource: (t: string, f: string) => { text: string; stamped: string[] } }>,
): Plugin {
  return {
    name: 'wafflebase-design-editor:warm-stamper',
    apply: 'serve',
    buildStart() {
      void loadStamper().catch(() => {});
    },
  };
}
