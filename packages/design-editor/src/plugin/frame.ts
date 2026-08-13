/**
 * `?wbFrame=<side>` — how one dev server serves two versions of the same file.
 *
 * The editor shows a before/after comparison, which means the same module must
 * resolve to DIFFERENT text in two iframes at once. Vite's module graph is keyed
 * by id, so the only way to hold two versions is to make them two ids: a real
 * file path plus a query.
 *
 * The query, specifically, and not a virtual module: `@vitejs/plugin-react` filters
 * on `id.split("?")[0]`, so a path-plus-query still reaches the React transform as
 * the `.tsx` file it is, while a `\0virtual:` id would not (engine §7.8).
 *
 * Nothing here reads a root, so it is all module-level. `createModuleClassifier`
 * is the one piece that needs one, and takes it.
 */

import path from 'node:path';
import type { FrameSide } from './protocol';

/**
 * Extensions the frame query may be attached to: JS/TS modules only.
 *
 * Not cosmetic. Appending an unknown query to a `.css` id or an asset routes it
 * away from the pipeline that knows how to handle it — the stylesheet arrives as
 * something Vite will not process, and the frame renders unstyled.
 */
export const FRAME_EXT: ReadonlySet<string> = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);

/** Extensions that can contain a JSX element, and are therefore worth stamping. */
export const JSX_EXT: ReadonlySet<string> = new Set(['.tsx', '.jsx']);

/** The frame side an id belongs to, or null for an unqualified id. */
export function frameOf(id: string | null | undefined): FrameSide | null {
  if (!id) return null;
  const q = id.indexOf('?');
  if (q < 0) return null;
  const v = new URLSearchParams(id.slice(q + 1)).get('wbFrame');
  return v === 'before' || v === 'after' ? v : null;
}

/**
 * Drop `wbFrame` from an id, keeping every other query part BYTE-IDENTICAL.
 *
 * The other params have to survive: Vite's `?import`, `?raw`, `?url`, `?worker`
 * and `?t=` cache-busting all ride on ids this passes through, and changing one
 * changes what the id MEANS rather than just which frame it belongs to.
 *
 * NOT `URLSearchParams`, which the prototype used and which is lossy for exactly
 * the params that matter here. Vite's flags are VALUELESS (`?import`, not
 * `?import=`), and a round-trip through `URLSearchParams` appends the `=`:
 *
 *   new URLSearchParams('import').toString()  →  'import='
 *
 * Vite tests those flags by pattern on the raw id, so the added byte silently
 * un-sets the flag — measured: `/(\?|&)import(&|$)/` matches `?import` and does
 * not match `?import=`. A stripped id would then be served down a different path
 * from the one the importer asked for.
 *
 * So split on `&` and filter, preserving each surviving part exactly as written.
 */
export function stripFrameQuery(id: string): string {
  const q = id.indexOf('?');
  if (q < 0) return id;
  const rest = id
    .slice(q + 1)
    .split('&')
    .filter((part) => part !== 'wbFrame' && !part.startsWith('wbFrame='))
    .join('&');
  return rest ? `${id.slice(0, q)}?${rest}` : id.slice(0, q);
}

/** Tag an id with a frame side, appending to any existing query. */
export function withFrameQuery(id: string, side: FrameSide): string {
  return id.includes('?') ? `${id}&wbFrame=${side}` : `${id}?wbFrame=${side}`;
}

/** The bare filesystem path of an id — no frame query, no other query. */
export const fileOf = (id: string): string => stripFrameQuery(id).split('?')[0];

export interface ModuleClassifier {
  /** Is this id the consumer's own source, and therefore patchable and stampable? */
  isFirstParty(id: string): boolean;
  /** Is it worth stamping — first-party AND a JSX extension? */
  isStampable(id: string): boolean;
}

/**
 * `isFirstParty` decides what the frame machinery may touch.
 *
 * Four exclusions, each for a different failure:
 *
 *   - **virtual ids** (`\0…`, `virtual:`) have no file behind them, so there is
 *     nothing to read, stamp, or patch.
 *   - **relative ids** are unresolved. Frame-qualifying one produces an id that
 *     resolves differently depending on its importer.
 *   - **`node_modules`** is not the consumer's source. Serving a dependency twice
 *     doubles it in the graph — and for a package with module-level state, the two
 *     copies are two instances of it.
 *   - **outside the root**, for the same reason `resolveSafe` refuses it: the root
 *     is the boundary of what this tool is allowed to know about.
 *
 * Opaque roots (`options.opaqueRoots`) are excluded too. They are inside the root
 * and are the consumer's source, but they hold no JSX and no scene entry, so
 * frame-qualifying them doubles every mount of a scene that imports them for
 * content identical on both sides.
 */
export function createModuleClassifier(
  root: string,
  isOpaque: (abs: string) => boolean = () => false,
): ModuleClassifier {
  const isFirstParty = (id: string): boolean => {
    if (id.startsWith('\0') || id.includes('virtual:')) return false;
    const file = fileOf(id);
    if (!path.isAbsolute(file)) return false;
    if (file.split(path.sep).includes('node_modules')) return false;
    const rel = path.relative(root, file);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
    if (isOpaque(file)) return false;
    return FRAME_EXT.has(path.extname(file));
  };

  return {
    isFirstParty,
    isStampable: (id: string) => isFirstParty(id) && JSX_EXT.has(path.extname(fileOf(id))),
  };
}
