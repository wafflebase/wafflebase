import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createPathGuard } from '../../src/plugin/paths.ts';
import { resolveOptions } from '../../src/plugin/options.ts';

/**
 * THE WRITE BOUNDARY.
 *
 * `design-editor-local-plugin.md` §8 settles 8a's verification as the prototype's
 * live-server smoke scripts, ported unchanged — plugin behaviour is not
 * unit-testable, and pretending otherwise buys fixtures rather than confidence.
 * This file is the deliberate exception, for two reasons specific to it:
 *
 *   1. `resolveSafe` is the only thing between a page in a browser and the
 *      developer's file system, and THIS PR is what changes its root from a
 *      module-level constant to a caller-supplied value. A smoke script exercises
 *      the paths that work; nothing would exercise the refusals.
 *   2. The extension allowlist is WIDENED here (`.js`, `.jsx`), which is a
 *      behaviour change on the same boundary. An untested widening of a security
 *      check is the wrong kind of small diff.
 *
 * Everything else in `src/plugin/` is left to the smoke scripts, as agreed.
 */

const ROOT = path.resolve('/proj');
const guard = createPathGuard(ROOT);

describe('resolveSafe', () => {
  it('accepts a root-relative source path and returns it absolute', () => {
    expect(guard.resolveSafe('src/components/button.tsx')).toEqual({
      abs: path.join(ROOT, 'src/components/button.tsx'),
    });
  });

  it('refuses an absolute path OUTRIGHT rather than checking it', () => {
    // Refused even when it happens to sit inside the root, because the protocol
    // speaks root-relative paths: an absolute one is a client that misunderstood
    // the contract. Accepting them would make the escape check below the only
    // guard rather than the second of two.
    expect(guard.resolveSafe(path.join(ROOT, 'src/a.tsx'))).toEqual({
      error: '`file` must be root-relative',
    });
    expect(guard.resolveSafe('/etc/passwd')).toEqual({
      error: '`file` must be root-relative',
    });
  });

  it('refuses a traversal that escapes the root, however it is spelled', () => {
    for (const f of ['../outside.tsx', 'src/../../outside.tsx', 'a/b/../../../c.tsx']) {
      expect(guard.resolveSafe(f), f).toEqual({ error: 'path escapes the project root' });
    }
  });

  it('allows traversal that stays INSIDE the root', () => {
    // The check is on the resolved result, not on the presence of `..` — a client
    // composing a path from a node's own location legitimately produces one.
    expect(guard.resolveSafe('src/ui/../a.tsx')).toEqual({ abs: path.join(ROOT, 'src/a.tsx') });
  });

  it('refuses a forbidden directory whatever its case', () => {
    // macOS and Windows resolve `NODE_MODULES/react` to the real lowercase
    // directory, so a case-sensitive check waves the request through on exactly the
    // two platforms where the write still lands in `node_modules`.
    for (const f of ['NODE_MODULES/react/index.js', 'src/Node_Modules/x/a.tsx', '.GIT/config']) {
      expect(guard.resolveSafe(f), f).toMatchObject({
        error: expect.stringContaining('forbidden'),
      });
    }
  });

  it('refuses a forbidden directory at any depth', () => {
    for (const f of [
      'node_modules/react/index.js',
      'src/node_modules/x/a.tsx',
      '.git/config',
      'src/.git/hooks/a.ts',
      'dist/assets/a.css',
      'packages/ui/dist/a.tsx',
    ]) {
      expect(guard.resolveSafe(f), f).toMatchObject({ error: expect.stringContaining('forbidden') });
    }
  });

  it('checks forbidden segments RELATIVE to the root, not absolutely', () => {
    // A plugin being developed from inside a consumer's install has a root that
    // itself lives under `node_modules`. Testing the absolute path would refuse
    // every write in that tree — the tool would appear completely broken.
    const nested = createPathGuard(path.join(ROOT, 'node_modules/.cache/app'));
    expect(nested.resolveSafe('src/a.tsx')).toEqual({
      abs: path.join(ROOT, 'node_modules/.cache/app/src/a.tsx'),
    });
  });

  it('accepts .jsx and .js — the widening, and the reason for it', () => {
    // The prototype allowed `.json`, `.css`, `.ts`, `.tsx` only, which is complete
    // for wafflebase and refuses EVERY write in a JavaScript project: the frame
    // propagates `.js`/`.jsx`, the stamper stamps `.jsx`, and the write is then
    // rejected at the last step. The editor would locate the node, preview the
    // diff, and refuse to save.
    expect(guard.resolveSafe('src/App.jsx')).toEqual({ abs: path.join(ROOT, 'src/App.jsx') });
    expect(guard.resolveSafe('src/App.js')).toEqual({ abs: path.join(ROOT, 'src/App.js') });
  });

  it('still refuses .mjs, and everything with no JSX convention', () => {
    // `.mjs` is excluded ON PURPOSE despite the frame propagating it: no
    // component convention puts JSX there, and it is where this package's own
    // engine modules live.
    for (const f of ['src/a.mjs', 'README.md', 'deploy.sh', 'src/a.vue', 'noext']) {
      expect(guard.resolveSafe(f), f).toMatchObject({
        error: expect.stringContaining('may be written'),
      });
    }
  });

  it('refuses empty and non-string input before touching the filesystem', () => {
    expect(guard.resolveSafe('')).toEqual({ error: '`file` is required' });
    // The bridge hands this straight off a parsed JSON body, so the type is a
    // claim rather than a guarantee.
    expect(guard.resolveSafe(undefined as unknown as string)).toEqual({
      error: '`file` is required',
    });
    expect(guard.resolveSafe(42 as unknown as string)).toEqual({ error: '`file` is required' });
  });

  it('does not treat the root itself as a writable file', () => {
    expect(guard.resolveSafe('.')).toMatchObject({ error: expect.stringContaining('may be written') });
  });
});

describe('backup', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wb-backup-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('captures the SESSION-pristine bytes, not the previous edit', () => {
    // One backup per file per session is the contract: the `.bak` holds the file as
    // it was before the editor first touched it, however many edits followed.
    // Overwriting it on every write would make it track the previous edit instead —
    // which the undo stack already does, better. The distinction only shows up on the
    // second write, which is why one is not enough to test it.
    const g = createPathGuard(dir);
    const abs = path.join(dir, 'a.tsx');
    writeFileSync(abs, 'ORIGINAL', 'utf8');

    return (async () => {
      const bak = await g.backup(abs);
      writeFileSync(abs, 'FIRST EDIT', 'utf8');
      await g.backup(abs);
      writeFileSync(abs, 'SECOND EDIT', 'utf8');
      await g.backup(abs);

      expect(readFileSync(bak, 'utf8')).toBe('ORIGINAL');
      expect(bak).toBe(`${abs}.bak`);
    })();
  });
});

describe('isOpaque', () => {
  const g = createPathGuard(ROOT, [path.join(ROOT, 'packages/sheets/src')]);

  it('matches the root itself and anything beneath it', () => {
    expect(g.isOpaque(path.join(ROOT, 'packages/sheets/src'))).toBe(true);
    expect(g.isOpaque(path.join(ROOT, 'packages/sheets/src/deep/a.ts'))).toBe(true);
  });

  it('matches on a path BOUNDARY, not a bare string prefix', () => {
    // `…/srcfoo` shares the prefix `…/src` without being inside it. A bare
    // `startsWith` would mark a sibling directory opaque, and its modules would
    // silently stop being frame-qualified — an edit there would then read the
    // wrong side's content.
    expect(g.isOpaque(path.join(ROOT, 'packages/sheets/srcfoo/a.ts'))).toBe(false);
    expect(g.isOpaque(path.join(ROOT, 'packages/docs/src/a.ts'))).toBe(false);
  });

  it('is false for every path when no opaque roots are configured', () => {
    expect(createPathGuard(ROOT).isOpaque(path.join(ROOT, 'anything/a.ts'))).toBe(false);
  });
});

describe('relOf', () => {
  it('returns a root-relative path', () => {
    expect(guard.relOf(path.join(ROOT, 'src/a.tsx'))).toBe('src/a.tsx');
  });

  // NOT COVERED HERE: the `split(path.sep).join('/')` normalisation only does
  // anything on Windows, where `path.sep` is `\`. On this suite's platform it is
  // an identity, so these tests cannot tell it from a bare `path.relative`.
});

describe('resolveOptions', () => {
  it('defaults the root to Vite own resolved root', () => {
    // Not `process.cwd()`: the dev server's cwd is wherever the developer typed
    // `npm run dev`, which is not a property of the project. `config.root` is what
    // Vite resolves module ids against, and the plugin's paths must agree with it.
    expect(resolveOptions(undefined, '/vite-root').root).toBe(path.resolve('/vite-root'));
  });

  it('lets an explicit root win, for sources above the Vite root', () => {
    // The monorepo case: serving `apps/web` while editing `packages/ui`. This is
    // exactly what the prototype's `path.resolve(__dirname, "../..")` hardcoded.
    expect(resolveOptions({ root: '/repo' }, '/repo/apps/web').root).toBe(path.resolve('/repo'));
  });

  it('resolves relative paths against the root, not the cwd', () => {
    const o = resolveOptions({ scenes: './design/scenes.json' }, '/vite-root');
    expect(o.scenes).toBe(path.resolve('/vite-root', 'design/scenes.json'));
  });

  it('keeps an absolute configured path as given', () => {
    // A shared manifest may legitimately live outside the project.
    const o = resolveOptions({ providers: '/shared/providers.tsx' }, '/vite-root');
    expect(o.providers).toBe(path.resolve('/shared/providers.tsx'));
  });

  it('absolutises every opaque root so isOpaque can compare prefixes directly', () => {
    const o = resolveOptions({ opaqueRoots: ['packages/sheets/src', '/abs/tree'] }, '/repo');
    expect(o.opaqueRoots).toEqual([
      path.resolve('/repo/packages/sheets/src'),
      path.resolve('/abs/tree'),
    ]);
  });

  it('leaves the token adapter null, which is what refuses token edits', () => {
    // The steady state for any project outside the support matrix (§3), not a
    // placeholder for 8b.
    expect(resolveOptions(undefined, '/r').tokens).toBeNull();
    expect(resolveOptions({}, '/r').scenes).toBeNull();
    expect(resolveOptions({}, '/r').providers).toBeNull();
    expect(resolveOptions({}, '/r').opaqueRoots).toEqual([]);
  });
});
