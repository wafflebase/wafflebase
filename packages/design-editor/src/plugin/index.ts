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

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
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

  /**
   * THE SAFELIST IS A REAL FILE ON DISK, and it took three wrong answers to get here.
   *
   * The editor composes class names at runtime, so Tailwind has never seen them and
   * emits no rule; `@source inline(...)` is how you tell it about one. The question is
   * only how to get that directive into the consumer's stylesheet, and the obvious
   * answers all fail for the same measured reason:
   *
   *   1. Appending it in `transform` — `@tailwindcss/vite` registers every one of its
   *      plugins `enforce: 'pre'`, so a consumer writing `tailwindcss()` above
   *      `designEditor()` (the natural order) had the stylesheet compiled first. The
   *      directive landed in generated CSS, where it means nothing.
   *   2. Appending it in `load` — wins that race, and still does nothing after the first
   *      request. Tailwind builds its compiler from the entry ONCE per dev server and
   *      thereafter only re-SCANS source files for candidates; a changed CSS input is
   *      noticed through the watcher, not through the transform. Measured: `load` ran
   *      with the directive appended and the served bytes did not move.
   *   3. Invalidating the module by hand — same outcome, for the same reason, whether by
   *      `reloadModule`, `invalidateModule`, or a synthetic `watcher.emit('change')`.
   *      What Tailwind reacts to is a file whose mtime changed.
   *
   * So the directive lives in a file the plugin OWNS and rewrites, and the consumer's
   * entry gets one injected `@import` of it — present at the first compile, so Tailwind
   * registers it as a dependency and watches it. Writing it then produces exactly the
   * event the pipeline already handles correctly: measured, a real edit to the entry
   * reaches the frame in under three seconds.
   *
   * OUTSIDE THE CONSUMER'S TREE, in the OS temp directory. Vite's default watcher
   * ignores `**\/node_modules/**` and the cache dir, which rules out the tidy-looking
   * places; a dot-file in the project root would work and would put a generated artifact
   * in someone else's repository. The path is derived from the root, so two projects
   * served at once do not share one.
   */
  const safelistFile = path.join(
    os.tmpdir(),
    // Keyed off the write boundary the consumer configured, which is the one identity
    // available before `configResolved` — two projects served at once must not share it.
    `wb-design-editor-${createHash('sha256')
      .update(String(options?.root ?? process.cwd()))
      .digest('hex')
      .slice(0, 12)}`,
    'safelist.css',
  );

  /** The Tailwind entry files the `@import` was injected into. */
  const safelistHosts = new Set<string>();

  /** Write the directive out. Returns false when the bytes are already right. */
  const writeSafelist = (): boolean => {
    const body = safelist.directive();
    try {
      if (fs.existsSync(safelistFile) && fs.readFileSync(safelistFile, 'utf8') === body) return false;
      fs.mkdirSync(path.dirname(safelistFile), { recursive: true });
      fs.writeFileSync(safelistFile, body, 'utf8');
      return true;
    } catch {
      // A safelist that cannot be written costs runtime-composed classes their rules; it
      // must not cost the consumer their dev server.
      return false;
    }
  };

  const core: Plugin = {
    name: 'wafflebase-design-editor',
    apply: 'serve',

    /**
     * The frame entry's own dependencies, declared to Vite's optimizer.
     *
     * MEASURED ON A REAL INSTALL, and invisible in a workspace. `scene-entry.tsx` is
     * served by absolute path (`/@fs/…` into the consumer's `node_modules`), so it sits
     * outside the graph Vite scans to discover dependencies — and an undiscovered CJS
     * dependency is served raw. `react/jsx-dev-runtime` survived that because the React
     * plugin injects it everywhere and Vite auto-includes it; `react-dom/client` did
     * not, so the frame died on
     * `does not provide an export named 'createRoot'` while the shell around it worked.
     *
     * The plugin knows what its own entry imports and the consumer does not, so this
     * belongs here rather than in their config — one fewer line of the onboarding cliff
     * §5 is about. Vite merges `include`, so a consumer listing the same package again
     * costs nothing.
     */
    config() {
      return { optimizeDeps: { include: ['react', 'react-dom/client'] } };
    },

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
      return renderScenesModule(o.root, readManifest(o.scenes), o.providers, o.fixtures, o.previews);
    },

  };

  /**
   * Append the safelist directive to the consumer's Tailwind v4 entry stylesheet.
   *
   * A SEPARATE PLUGIN, AND A `load` HOOK RATHER THAN A `transform`. Both are the same
   * finding: `@tailwindcss/vite` registers all three of its plugins `enforce: "pre"`,
   * so within the pre group the order is the consumer's plugin array — and a consumer
   * who writes `tailwindcss()` above `designEditor()` (the natural order, and ours) had
   * Tailwind compile the stylesheet BEFORE this ran. The directive was then appended to
   * generated CSS, where it means nothing, and the entry check no longer matched either,
   * because the `@import "tailwindcss"` it looks for had already been consumed.
   *
   * `load` has no such race. Every `load` hook runs before every `transform` hook for a
   * module, and Tailwind's plugins define no `load`, so this cannot be pre-empted by
   * plugin order at all. The cost is reading the file ourselves, which is what Vite's
   * own fallback loader would have done a moment later.
   *
   * Detection is still by CONTENT, so a v3 or plain-CSS project never receives a v4
   * directive its pipeline cannot parse — the no-op §6 requires, reached automatically
   * rather than by a config flag.
   */
  const safelistCss: Plugin = {
    name: 'wafflebase-design-editor:safelist-css',
    enforce: 'pre',
    load(id) {
      const [file, query = ''] = id.split('?');
      if (!file.endsWith('.css')) return null;
      // `?raw` / `?url` / `?inline` ask for the file as DATA. Claiming those would hand
      // back a doctored string as the consumer's own asset.
      if (/(^|&)(raw|url|inline)(&|=|$)/.test(query)) return null;
      let code: string;
      try {
        code = fs.readFileSync(file, 'utf8');
      } catch {
        return null;
      }
      if (!isTailwindV4Entry(code)) return null;
      safelistHosts.add(file);
      writeSafelist();
      /*
       * PREPENDED, and RELATIVE to the importing file.
       *
       * Prepended because CSS requires every `@import` to precede other rules, and this
       * file's own first line is one. Relative because Tailwind resolves an `@import`
       * against the importer, and an absolute path would be read as project-relative by
       * some resolvers — the specifier has to be unambiguous from where it is written.
       */
      const rel = path.relative(path.dirname(file), safelistFile).split(path.sep).join('/');
      return `@import ${JSON.stringify(rel.startsWith('.') ? rel : `./${rel}`)};\n${code}`;
    },
  };

  /**
   * Rewrite the safelist file so Tailwind rebuilds and the frame repaints.
   *
   * The write is the whole mechanism — see `safelistFile` for the three things that
   * looked like they should work instead. `watcher.add` is idempotent and needed because
   * the file is outside the project, so nothing was watching it; the explicit `change`
   * is a belt-and-braces for platforms where a fresh `add` misses its own first write
   * (WSL2 over drvfs, measured, does).
   */
  const onSafelistChange = (server: ViteDevServer) => {
    if (!writeSafelist()) return;
    server.watcher.add(safelistFile);
    server.watcher.emit('change', safelistFile);
  };

  return [
    // FIRST, so its `load` claims a Tailwind entry before `scene-patch` — which loads
    // every frame-qualified first-party module — reads the same file without the
    // directive.
    safelistCss,
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
