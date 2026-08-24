/**
 * `designEditor(options)` — the plugin's whole configuration surface.
 *
 * THE POINT OF THIS FILE is that the prototype had no configuration surface at
 * all. It was a Vite *config* for one app, so every path it needed was a
 * module-level `const` resolved from `__dirname`: `REPO_ROOT`, and 49 further
 * sites resolving against it (`design-editor-local-plugin.md` §6). A module-level
 * constant cannot be configured, and it cannot be two different values in two
 * dev servers — so the generalization is not "rename `REPO_ROOT` to
 * `options.root`", it is moving that value out of module scope entirely and
 * threading it through as state owned by one `designEditor()` call.
 *
 * Everything downstream therefore takes a `ResolvedOptions` rather than reading
 * a global, and the module-level path constants are gone by construction: there
 * is nowhere left to put one.
 */

import path from 'node:path';

/**
 * The token pipeline, as the plugin sees it.
 *
 * DECLARED IN 8a, TYPED AND IMPLEMENTED IN 8b. The interface now lives in
 * `src/tokens/adapter.ts` with real payload types in place of the `unknown`s this file
 * carried, and is re-exported here so `designEditor({ tokens })` keeps naming its option's
 * type from one place. `src/tokens/` deliberately imports nothing from `src/plugin/`, so
 * an adapter — including wafflebase's own in 8c — is written against the contract rather
 * than against the bridge's request shape.
 *
 * With `tokens` still absent, every token intent and token endpoint is refused with a
 * note, unchanged from 8a: §3 makes that the permanent behaviour for any project outside
 * the support matrix, where "the token panels degrade to empty rather than writing
 * garbage".
 */
import type { TokenAdapter } from '../tokens/adapter.ts';
export type { TokenAdapter };
import { resolveAliases, type AliasEntry, type ViteAliasEntry } from './aliases.ts';

export interface DesignEditorOptions {
  /**
   * The write boundary. Nothing outside it is readable or writable, and every
   * repo-relative path in the protocol resolves against it.
   *
   * Defaults to Vite's own resolved `config.root` rather than `process.cwd()`:
   * the plugin's file paths must mean the same thing as the host's module ids, and
   * `config.root` is what Vite resolves those against. A consumer whose sources
   * sit above the Vite root (a monorepo serving `apps/web` but editing
   * `packages/ui`) passes it explicitly — that is exactly the case the prototype's
   * `path.resolve(__dirname, "../..")` hardcoded for itself.
   */
  root?: string;
  /** Scene manifest — which routes are editable. Resolved against `root`. */
  scenes?: string;
  /** Providers module wrapping every mounted scene. Resolved against `root`. */
  providers?: string;
  /**
   * A module default-exporting `Record<componentName, PreviewRecipe>` — how to mount
   * ONE component so it is worth looking at.
   *
   * The generic answer is `<Component {...generatedProps}>{name}</Component>`, and for a
   * styled primitive it is the right one. For everything else it is not, and measurably:
   * of the 25 `components/ui/*` modules wafflebase declares, most export PARTS of a
   * composite — `DropdownMenuItem` outside a menu throws, `SelectValue` outside a select
   * throws, a `Slider` with no width is a 0px line — so the pane filled up with cells
   * reading "needs app context this preview does not mount". That is accurate and
   * useless: the fix is a menu with three dummy items, not a better error.
   *
   * The knowledge is the CONSUMER's, which is why this is an option and not a table in
   * the plugin: "a Slider wants 260px" and "our menus carry an icon and a shortcut" are
   * facts about their design system. Absent, every component falls back to the generic
   * mount, so the option is additive.
   */
  previews?: string;
  /**
   * A module default-exporting `(sceneConfig) => FixtureTable` — the URL-keyed responses
   * the frame answers `fetch` with.
   *
   * SEPARATE FROM `providers` because of ORDERING, not taste. The guard has to be
   * installed before any scene module is imported: real API modules read their base URL
   * at module scope and real pages fire queries on mount, so a guard installed after the
   * import has already lost the race — and an escaped request reaches the consumer's
   * actual backend from a frame whose whole premise is that it does not. `providers` is
   * loaded lazily with the scene, so it cannot carry this.
   *
   * The manifest's `fixtures` / `mocks` / `shell` fields are the ARGUMENT; resolving a
   * name like `"documents/list"` to data is the consumer's job, because the data is
   * theirs. Absent, the frame mocks nothing and every request misses loudly.
   */
  fixtures?: string;
  /**
   * Trees that are resolved and served but never re-queried per frame side.
   *
   * Generalises the prototype's `ENGINE_SRC_ROOTS`, which named wafflebase's four
   * engine packages. It is a PERFORMANCE boundary, not an alias list: a subtree
   * with no JSX and no scene entry cannot be the target of a layout intent, so
   * frame-qualifying it doubles every mount of a scene that imports it for content
   * that is byte-identical between the two sides. Any consumer with a large
   * non-JSX subtree wants this; only the four wafflebase paths were ours.
   */
  opaqueRoots?: string[];
  /** The token pipeline. Omitted ⇒ token editing is refused, see `TokenAdapter`. */
  tokens?: TokenAdapter;
}

/** Options with every path made absolute and every optional decided. */
export interface ResolvedOptions {
  root: string;
  scenes: string | null;
  providers: string | null;
  previews: string | null;
  fixtures: string | null;
  opaqueRoots: string[];
  tokens: TokenAdapter | null;
  /**
   * The consumer's import aliases, wire-safe and root-relative.
   *
   * NOT a user option — derived from Vite's own resolved `resolve.alias`, so it
   * cannot drift from the config that actually resolves the consumer's modules.
   * It sits on `ResolvedOptions` because that is this file's whole contract: every
   * module downstream reads resolved state from here rather than from a global.
   */
  aliases: AliasEntry[];
}

/**
 * Absolute-ise one configured path against `root`.
 *
 * An absolute value is taken as given — a consumer may legitimately keep a shared
 * manifest outside the project — while a relative one is resolved against `root`
 * rather than `process.cwd()`, because the dev server's cwd is wherever the
 * developer typed `npm run dev` and is not a property of the project.
 */
const absolutise = (root: string, p: string | undefined): string | null =>
  p == null ? null : path.isAbsolute(p) ? path.normalize(p) : path.resolve(root, p);

/**
 * Resolve user options against Vite's resolved root.
 *
 * `viteRoot` is passed rather than read, because it is only known in
 * `configResolved` — which is also the reason this is a function and not an
 * object literal built at plugin-construction time.
 */
export function resolveOptions(
  options: DesignEditorOptions | undefined,
  viteRoot: string,
  viteAlias: readonly ViteAliasEntry[] = [],
): ResolvedOptions {
  const root = path.resolve(options?.root ?? viteRoot);
  return {
    root,
    scenes: absolutise(root, options?.scenes),
    providers: absolutise(root, options?.providers),
    previews: absolutise(root, options?.previews),
    fixtures: absolutise(root, options?.fixtures),
    // Normalised and absolute so `isOpaque` can compare prefixes without
    // re-resolving per module id — this is consulted on every module load.
    opaqueRoots: (options?.opaqueRoots ?? []).map((r) =>
      path.isAbsolute(r) ? path.normalize(r) : path.resolve(root, r),
    ),
    tokens: options?.tokens ?? null,
    // Resolved against `root`, not `viteRoot`: a monorepo consumer editing a
    // sibling package passes `root` explicitly, and an alias outside it is
    // unreachable to the write boundary anyway.
    aliases: resolveAliases(viteAlias, root),
  };
}
