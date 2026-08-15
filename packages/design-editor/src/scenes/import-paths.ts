/**
 * An import specifier → the root-relative file it names.
 *
 * This is the outline's drill-in target resolver. It lives in its own module
 * because it is the one piece of the drill-in that is pure and therefore testable
 * without a dev server, and because getting it wrong is quiet: a mis-resolved path
 * produces an empty outline, which looks like "this component has no editable
 * nodes" rather than like a bug.
 *
 * `.tsx` IS ASSUMED, NOT PROBED. The client cannot stat the filesystem, and
 * drill-in only ever targets a component that RETURNS JSX — a `.tsx` by
 * definition. The cost of a wrong guess is one 404 from the metadata route, which
 * the caller surfaces by name; it can never produce a wrong anchor. The rejected
 * alternative was a `/resolve` endpoint: a round-trip per outline row, to answer a
 * question the alias table already answers.
 *
 * NOT COVERED: a directory import. `@/components` resolves to
 * `app/components.tsx`, not to the `app/components/index.tsx` a barrel import
 * actually names, and nothing here can tell the two apart without stat'ing. This
 * is the 404 the paragraph above accepts, so it degrades to an empty outline for
 * that row rather than to a wrong write — but it IS a gap, and closing it needs
 * either an index candidate the metadata route tries second or a `/resolve`
 * round-trip. A BARE alias root (`@` alone) is different and is handled: it names
 * a directory for certain, so it returns null instead of a plausible file.
 *
 * BARE SPECIFIERS RETURN NULL ON PURPOSE. `react`, `lucide-react` and the like
 * live in `node_modules`, which this tool must not write to. Offering a drill-in
 * there would be an invitation to edit a dependency, and the mutation bridge would
 * refuse the write anyway — better not to offer it.
 *
 * THE ALIASES ARE A PARAMETER, and that is the whole change from the prototype.
 * It hardcoded `const FRONTEND_SRC = 'packages/frontend/src'` and an `@/` prefix,
 * so a project whose alias is `~` or `#app` resolved nothing and every drill-in
 * row came back empty. They now arrive from `GET /health`, derived from the
 * consumer's own resolved Vite config — see `plugin/aliases.ts`.
 */

import type { AliasEntry } from '../plugin/aliases.ts';

export type { AliasEntry };

/**
 * POSIX `path.join`, for the two forms a first-party import can take.
 *
 * NULL WHEN THE WALK ESCAPES THE ROOT. `out.pop()` on an empty array is a no-op,
 * so `../../../shared/y` from `app/pages` silently collapsed to `shared/y` — a
 * root-relative path naming a file the import does not, and one a monorepo
 * sibling import can easily make exist. That is the one failure this module
 * claims it cannot produce: a drill-in landing on the wrong file makes every
 * staged edit anchor against, and write to, the wrong source.
 */
export function joinPosix(dir: string, rel: string): string | null {
  const out: string[] = dir ? dir.split('/') : [];
  for (const part of rel.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') {
      if (!out.length) return null;
      out.pop();
    } else out.push(part);
  }
  return out.join('/');
}

/**
 * An explicit extension is honoured — `@/types/users.ts` is a real specifier and
 * appending `.tsx` to it would resolve to nothing.
 */
const HAS_EXT = /\.[cm]?[jt]sx?$/;
const withExt = (p: string): string => (HAS_EXT.test(p) ? p : `${p}.tsx`);

/**
 * Does `module` use this alias?
 *
 * An alias matches either exactly (`@` for the specifier `@`) or as a path segment
 * prefix (`@/components/x`). The segment check is what stops `@scope/pkg` — a real
 * npm scoped package — from being read as the alias `@` plus `scope/pkg`, which
 * would have pointed a drill-in at a file inside the project that does not exist.
 */
const aliasMatch = (module: string, find: string): string | null => {
  if (module === find) return '';
  if (module.startsWith(`${find}/`)) return module.slice(find.length + 1);
  return null;
};

/**
 * Resolve one import specifier against the consumer's aliases.
 *
 * Aliases are tried LONGEST FIRST, mirroring how a resolver has to behave when one
 * alias prefixes another (`@` and `@ui` both matching `@ui/button`): the more
 * specific alias is the one the consumer meant, and trying `@` first would send the
 * drill-in to `<@-root>/ui/button` instead. Vite's own resolver is order-sensitive
 * on the configured array rather than length-sorted, so this is deliberately NOT a
 * faithful copy of it — a drill-in target is a read, and picking the more specific
 * of two candidates is the safer failure.
 */
export function resolveImport(
  fromFile: string,
  module: string,
  aliases: readonly AliasEntry[] = [],
): string | null {
  if (module.startsWith('./') || module.startsWith('../')) {
    const dir = fromFile.split('/').slice(0, -1).join('/');
    return fileAt(joinPosix(dir, module));
  }
  const sorted = [...aliases].sort((a, b) => b.find.length - a.find.length);
  for (const { find, replacement } of sorted) {
    const rest = aliasMatch(module, find);
    if (rest === null) continue;
    // A BARE ALIAS SPECIFIER NAMES THE REPLACEMENT ITSELF, which is a file only
    // when the alias points at one. `@` → `app` is a directory, and appending
    // `.tsx` reported it as `app.tsx`: a file that does not exist, so the outline
    // came back empty. An alias aimed straight at a file still resolves.
    if (rest === '') return HAS_EXT.test(replacement) ? replacement : null;
    return fileAt(joinPosix(replacement, rest));
  }
  return null;
}

/**
 * A joined path as the file it names, or null.
 *
 * Empty is null as well as underflow: `joinPosix('a', '../')` is `''`, and `''`
 * names the root directory rather than any file.
 */
const fileAt = (joined: string | null): string | null => (joined ? withExt(joined) : null);
