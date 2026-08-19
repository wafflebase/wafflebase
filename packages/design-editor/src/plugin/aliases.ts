/**
 * The consumer's import aliases, as data the browser can use.
 *
 * WHY THE PLUGIN OWNS THIS. The outline's drill-in has to turn an import
 * specifier (`@/components/badge`) into the file it names, and that mapping is a
 * property of the consumer's Vite config. The prototype's client carried its own
 * copy — `const FRONTEND_SRC = 'packages/frontend/src'` plus a hardcoded `@/`
 * prefix in `import-paths.ts` — which is the same shape of coupling as the four
 * token paths §6 lists: a client-side duplicate of a fact only the server knows.
 * A foreign project whose alias is `~` or `#app` resolved nothing, and a
 * mis-resolved path produces an EMPTY outline, which reads as "this component has
 * no editable nodes" rather than as a bug.
 *
 * Reading Vite's own `config.resolve.alias` rather than adding a
 * `designEditor({ aliases })` option is deliberate: an option can drift from the
 * config that actually resolves the consumer's modules, and this cannot.
 */

import path from 'node:path';

/** One alias the client may resolve against. Both sides are wire-safe strings. */
export interface AliasEntry {
  /** The specifier prefix, e.g. `@` or `~lib`. */
  find: string;
  /** Root-relative directory it points at, e.g. `app`. */
  replacement: string;
}

/** The shape Vite resolves `resolve.alias` to, narrowed to what we read. */
export interface ViteAliasEntry {
  find: string | RegExp;
  replacement: string;
}

/**
 * Wire-safe aliases from Vite's resolved config.
 *
 * Three filters, each measured against a real resolved config rather than assumed:
 *
 *   - **RegExp finds are dropped.** A pattern cannot cross the wire, the same
 *     reason 8b encoded the token naming rules as prefixes instead of functions.
 *     In practice every one of them is Vite's own (`^/?@vite/client`,
 *     `^/?@vite/env`), which are runtime injections and never a drill-in target.
 *   - **Relative replacements are resolved against the root.** Vite does NOT
 *     normalise these: an alias configured as `'./app/components'` is still
 *     `'./app/components'` in the resolved config, while one given absolutely
 *     stays absolute. Handing the client both forms would make it guess.
 *   - **Anything outside the root is dropped.** Vite's internal aliases point into
 *     `node_modules` via `/@fs/…`, and a drill-in there would invite editing a
 *     dependency — which the write boundary refuses anyway, so offering it is
 *     worse than omitting it.
 *
 * An alias pointing AT the root is kept, as the empty replacement. `~` →
 * `resolve(__dirname)` is an ordinary config for a project whose Vite root is its
 * source dir, and dropping it put that project back where the prototype left every
 * foreign one: `health.aliases` empty, every `~/components/x` row resolving to
 * null, and an outline that reads as "no editable nodes" rather than as a bug. The
 * empty replacement composes correctly — `joinPosix('', 'components/x')` is
 * `'components/x'`, which `import-paths` pins.
 */
export function resolveAliases(alias: readonly ViteAliasEntry[], root: string): AliasEntry[] {
  const out: AliasEntry[] = [];
  for (const entry of alias) {
    if (typeof entry.find !== 'string' || !entry.find) continue;
    const abs = path.isAbsolute(entry.replacement)
      ? entry.replacement
      : path.resolve(root, entry.replacement);
    const rel = path.relative(root, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
    out.push({ find: entry.find, replacement: rel.split(path.sep).join('/') });
  }
  return out;
}
