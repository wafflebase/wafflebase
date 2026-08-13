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
import { resolveOptions, type DesignEditorOptions, type ResolvedOptions } from './options';
import { createPathGuard } from './paths';
import { createTracker } from './tracked';
import { createSafelist, isTailwindV4Entry } from './safelist';
import { createTransactionStore } from './transactions';
import { createModuleClassifier } from './frame';
import { readManifest, renderScenesModule, SCENES_RESOLVED_ID, SCENES_VIRTUAL_ID } from './scenes';
import { scenePatch } from './scene-patch';
import { shellServer, BASE } from './shell';
import { bridge } from './bridge';
import type { IntentContext, Injector } from './intents';
import type { FrameSide, MutateRequest } from './protocol';

export type { DesignEditorOptions, TokenAdapter } from './options';
export { BASE } from './shell';

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
 * `dist/shell` under the package root, which is what the build in PRs 10–12 emits.
 * §2's target layout draws `index.html` / `scene.html` at the package root; they are
 * kept under `dist/` instead so the served set is exactly the built artefacts and a
 * stray root-level HTML file cannot be served by accident.
 */
const SHELL_DIR = path.join(packageRoot(HERE), 'dist', 'shell');

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

  let stampPromise: Promise<{ stampSource: (t: string, f: string) => string }> | null = null;
  const loadStamper = () =>
    (stampPromise ??= import('../server/stamp.mjs') as unknown as Promise<{
      stampSource: (t: string, f: string) => string;
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
      resolved = resolveOptions(options, config.root);
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
      return renderScenesModule(o.root, readManifest(o.scenes), o.providers);
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
    shellServer({ distDir: SHELL_DIR }),
    bridge({
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
  loadStamper: () => Promise<{ stampSource: (t: string, f: string) => string }>,
): Plugin {
  return {
    name: 'wafflebase-design-editor:warm-stamper',
    apply: 'serve',
    buildStart() {
      void loadStamper().catch(() => {});
    },
  };
}
