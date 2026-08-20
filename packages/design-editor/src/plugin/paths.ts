/**
 * The trust boundary between the browser and the file system.
 *
 * Every path in the bridge protocol arrives from a web page. `resolveSafe` is the
 * single place that turns one into an absolute path, or refuses it — so it is the
 * only thing standing between a dev-only plugin and "a page in your browser wrote
 * to `~/.ssh/config`". The prototype's version resolved against a module-level
 * `REPO_ROOT`; here the root is a parameter, which is the whole PR in miniature.
 *
 * `createPathGuard` returns closures over one root rather than exporting bare
 * functions, because two dev servers in one process (a monorepo running two Vite
 * instances) must not share a write boundary. There is no module-level root here
 * to accidentally reuse.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

/**
 * Extensions the editor may write.
 *
 * WIDENED FROM THE PROTOTYPE, which allowed `.json`, `.css`, `.ts`, `.tsx` only.
 * That set was complete for wafflebase, where every component is `.tsx` — and it
 * silently refuses **every write in a JavaScript project**: the frame machinery
 * propagates `.js`/`.jsx`, the stamper stamps `.jsx`, `parse()` reads any of them
 * as TSX, and then the write is rejected at the last step with "only .json, .css,
 * .ts, .tsx files may be written". A consumer would see the editor locate the
 * node, preview the diff, and refuse to save.
 *
 * `.mjs` is deliberately still excluded even though the frame propagates it: no
 * JSX convention puts components there, and it is where this package's own engine
 * modules live, so excluding it costs nothing and keeps the editor from writing
 * to its own implementation if a consumer ever vendors it.
 *
 * `.json` and `.css` are here for the token pipeline (8b), not for layout edits.
 */
const ALLOWED_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.css', '.json']);

/**
 * Directory names no path may contain.
 *
 * `node_modules` is the one that matters: a dependency's source is not the
 * consumer's to edit, and an edit there is silently destroyed by the next
 * install. `.git` would corrupt the repository the plugin relies on as its undo of
 * last resort, and `dist` is build output that the next build overwrites.
 */
const FORBIDDEN_SEGMENTS = new Set(['node_modules', '.git', 'dist']);

export interface PathGuard {
  root: string;
  /** Absolute path, or a reason it was refused. */
  resolveSafe(file: string): { abs: string } | { error: string };
  /** Root-relative, POSIX-separated — the form the protocol speaks. */
  relOf(abs: string): string;
  /** True when `abs` sits inside one of the configured opaque roots. */
  isOpaque(abs: string): boolean;
  /** Copy-on-first-write session backup. Returns the backup's path. */
  backup(abs: string): Promise<string>;
}

export function createPathGuard(root: string, opaqueRoots: string[] = []): PathGuard {
  const relOf = (abs: string) => path.relative(root, abs).split(path.sep).join('/');

  return {
    root,
    relOf,

    /**
     * Four refusals, in the order that makes each one meaningful:
     *
     *   1. an absolute input is refused OUTRIGHT rather than checked. The
     *      protocol speaks root-relative paths, so an absolute one is a client
     *      that has misunderstood the contract — and accepting it would mean the
     *      escape check below is the only guard, rather than the second of two.
     *   2. the resolved path must stay under `root`. `path.relative` is the test
     *      because it is the only one that survives `..`, symlink-free or not:
     *      a leading `..` or an absolute result both mean "escaped".
     *   3. no forbidden segment anywhere in the path — checked on the RELATIVE
     *      path, so a root that itself lives under `node_modules` (a plugin being
     *      developed inside a consumer's install) does not refuse everything.
     *   4. the extension must be writable.
     *
     * NOT CHECKED: symlinks. A symlink inside `root` pointing outside it defeats
     * the escape test, because this resolves lexically and never calls
     * `fs.realpath`. That is unchanged from the prototype and is a real hole for a
     * hostile tree — but the threat model here is a developer's own project on
     * their own machine, and `realpath` on every request would cost a syscall per
     * path on the hot metadata path. Stated rather than implied.
     */
    resolveSafe(file: string): { abs: string } | { error: string } {
      if (!file || typeof file !== 'string') return { error: '`file` is required' };
      if (path.isAbsolute(file)) return { error: '`file` must be root-relative' };

      const abs = path.resolve(root, file);
      const rel = path.relative(root, abs);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        return { error: 'path escapes the project root' };
      }
      // Lowercased before comparison, because macOS and Windows resolve
      // `NODE_MODULES/react/index.js` to the real lowercase directory. A
      // case-sensitive check waves the request through on exactly the two
      // platforms where the path still lands inside `node_modules`.
      const segments = rel.split(path.sep).map((s) => s.toLowerCase());
      if (segments.some((s) => FORBIDDEN_SEGMENTS.has(s))) {
        return { error: `writes into ${[...FORBIDDEN_SEGMENTS].join('/')} are forbidden` };
      }
      if (!ALLOWED_EXT.has(path.extname(abs))) {
        return { error: `only ${[...ALLOWED_EXT].join(', ')} files may be written` };
      }
      return { abs };
    },

    /**
     * Prefix match on a path boundary, never a bare `startsWith`: `/a/srcfoo`
     * must not read as inside `/a/src`. Equality counts as inside.
     */
    isOpaque(abs: string): boolean {
      return opaqueRoots.some((r) => abs === r || abs.startsWith(r + path.sep));
    },

    /**
     * The coarse, session-pristine escape hatch, distinct from the transaction
     * log: the `.bak` is written ONCE per file per session (`existsSync` guard),
     * so it holds the file as it was before the editor first touched it, however
     * many edits followed. Overwriting it on every write would make it track the
     * previous edit instead — which the undo stack already does, better.
     *
     * UNDER `node_modules/.cache/`, NOT beside the source. It used to land
     * `foo.tsx.bak` next to the consumer's file, where our `.gitignore` cannot
     * reach it — a tool that writes stray files into someone else's repository
     * and leaves them for `git status` to find. The relative path is mirrored
     * under the cache directory so two files with the same basename cannot
     * collide.
     *
     * Nothing reads this back: restore runs through the transaction log, and this
     * is the copy a human reaches for when that is not enough. That is also why
     * moving it was safe — the earlier note here claimed the restore path
     * depended on it, and no code ever did.
     *
     * `resolveSafe` forbids writes into `node_modules` because a dependency's
     * source is not the consumer's to edit. This is the deliberate exception: it
     * is OUR cache, keyed under our own name, and never a file the editor edits.
     */
    async backup(abs: string): Promise<string> {
      /*
       * VALIDATED HERE, not trusted from the caller. Every current caller passes a
       * `resolveSafe` result, but this is a public method of the guard and an outside-root
       * path does not stay outside: `relOf` yields `../outside/x.tsx`, which `path.join`
       * normalises away, so the backup lands at `.cache/outside/x.tsx.bak` — inside the
       * cache, mapped to nothing, and colliding with any other tree that has that shape.
       */
      const rel = relOf(abs);
      if (rel.startsWith('../') || path.isAbsolute(rel)) {
        throw new Error(`refusing to back up a path outside the project root: ${abs}`);
      }

      const bak = path.join(root, 'node_modules', '.cache', 'wafflebase-design-editor', `${rel}.bak`);
      await fsp.mkdir(path.dirname(bak), { recursive: true });
      /*
       * EXCLUSIVE, because `existsSync` then `copyFile` is a window, and what fits through it
       * is the one thing this function promises. Two writes to the same file racing here both
       * saw no backup; the second then copied a file the first had ALREADY edited, replacing
       * the session-pristine snapshot with a mid-session one. `EEXIST` is the success case —
       * it means the pristine copy is already there.
       */
      try {
        await fsp.copyFile(abs, bak, fs.constants.COPYFILE_EXCL);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      }
      return bak;
    },
  };
}
