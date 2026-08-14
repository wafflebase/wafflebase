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
  opaqueRoots: string[];
  tokens: TokenAdapter | null;
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
): ResolvedOptions {
  const root = path.resolve(options?.root ?? viteRoot);
  return {
    root,
    scenes: absolutise(root, options?.scenes),
    providers: absolutise(root, options?.providers),
    // Normalised and absolute so `isOpaque` can compare prefixes without
    // re-resolving per module id — this is consulted on every module load.
    opaqueRoots: (options?.opaqueRoots ?? []).map((r) =>
      path.isAbsolute(r) ? path.normalize(r) : path.resolve(root, r),
    ),
    tokens: options?.tokens ?? null,
  };
}
