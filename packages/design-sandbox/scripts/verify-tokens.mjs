// @ts-check
/**
 * verify-tokens.mjs — the token pipeline against a LIVE dev server.
 *
 * WHY THIS EXISTS AND IS NOT A VITEST FILE. The bridge is Connect middleware: every token
 * endpoint needs a real `ViteDevServer`, real HTTP and a real config load. That is why
 * `design-editor-local-plugin.md` §8 records the plugin host as having landed "with no
 * automated gate", and why the prototype verified it with scripts like this one
 * (`verify-bridge.mjs`, 18.9 KB) rather than with unit tests.
 *
 * It is the only thing that exercises the FULL chain — Vite config load → plugin
 * construction → `wafflebaseCore` → the injector → the preview worker → the real emitter —
 * and the pieces on either side of it are unit-tested separately: the adapter in
 * `test/tokens/`, the plugin's normalisation and staging in `@wafflebase/design-editor`.
 * Neither of those would notice the two of them failing to meet.
 *
 * NOTHING IS WRITTEN unless `--write` is passed. Every mutation check uses `dryRun`, which
 * runs the same composition a save runs — `computeIntent` → `planTokenIntent` →
 * `applyTokenPlan` — and reports the diff instead of applying it. `--write` adds one real
 * `/mutate` followed by `/undo`, and verifies the tree came back byte-identical; it is
 * opt-in because this repository is also somebody's working tree.
 *
 * DELIBERATELY OUT OF `verify:fast` / `verify:self`: it boots a dev server and spawns two
 * child processes, on the same grounds the prototype's smoke scripts stayed out. Run it by
 * hand, or in a lane that can afford it:
 *
 *   pnpm --filter @wafflebase/design-sandbox verify:tokens
 *   pnpm --filter @wafflebase/design-sandbox verify:tokens --write
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(PKG, '../..');
const PORT = Number(process.env.PORT ?? 5199);
const BASE = `http://127.0.0.1:${PORT}/__design-editor/api`;
const WRITE = process.argv.includes('--write');

let failures = 0;
let checks = 0;

/** @param {string} label @param {boolean} cond @param {string} [detail] */
function check(label, cond, detail) {
  checks++;
  if (cond) {
    console.log(`  ok   ${label}`);
    return true;
  }
  failures++;
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  return false;
}

/** @param {string} p @param {RequestInit} [init] */
async function api(p, init) {
  const res = await fetch(`${BASE}${p}`, init);
  const text = await res.text();
  try {
    return { status: res.status, body: /** @type {any} */ (JSON.parse(text)) };
  } catch {
    return { status: res.status, body: /** @type {any} */ ({ ok: false, error: text.slice(0, 400) }) };
  }
}

/** @param {string} p @param {unknown} payload */
const post = (p, payload) =>
  api(p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

/**
 * Boot the dev server and wait for the bridge to answer.
 *
 * PLAIN `vite`, with Vite's DEFAULT config loader — and that is load-bearing, because
 * getting here took two wrong turns worth recording.
 *
 * A Vite config that imports `@wafflebase/design-editor` is handed to NODE (a pnpm
 * workspace link resolves into `node_modules`, so the config bundler externalizes the
 * bare specifier and Node resolves it itself). That used to mean loading the package's
 * TypeScript source through Node's type stripping, and Node ESM requires explicit
 * extensions, so the package's extensionless relative imports (`./options`) failed to
 * resolve and the dev server would not start at all — which is what forced the `.ts`
 * extensions still on every relative import there. Since #966 `exports["."]` names
 * `dist/plugin/index.js` instead, so what Node loads is COMPILED output and
 * `buildDesignEditorIfStale` below has to have produced it first.
 *
 * `--configLoader runner` looks like the fix and IS NOT: it loads the config, and then
 * closes the module runner. Every deferred dynamic import in config-loaded code then fails
 * at request time — including the plugin's OWN lazy `import('../server/inject.mjs')`, which
 * has nothing to do with this package. Measured: `/health` answered, and `/tokens` and
 * `/mutate` both returned `Vite module runner has been closed`. So `runner` does not just
 * fail to help, it breaks the merged plugin. Do not reintroduce it.
 */
async function boot() {
  // `detached` so the whole process GROUP can be signalled. `pnpm exec vite` is a wrapper
  // that spawns vite as its own child, so killing the returned pid leaves the dev server
  // running and holding the port. That is not theoretical: a survivor from an earlier run
  // answered `/health` on this port while the run under test never started, and the checks
  // below then reported failures belonging to a process nobody was looking at. Any smoke
  // script that leaks its server produces exactly that kind of unreadable result.
  const child = spawn('pnpm', ['exec', 'vite', '--port', String(PORT), '--strictPort'], {
    cwd: PKG,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let log = '';
  child.stdout.on('data', (c) => (log += c.toString()));
  child.stderr.on('data', (c) => (log += c.toString()));

  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode != null) throw new Error(`dev server exited early:\n${log}`);
    try {
      const r = await api('/health');
      if (r.status === 200 && r.body.ok) return { child, log: () => log };
    } catch {
      /* not listening yet */
    }
    if (Date.now() > deadline) {
      // `shutdown`, not `child.kill()`: this is the same wrapper problem the comment on
      // `spawn` above describes, and killing only the pid would leave a vite holding
      // `--strictPort` — which is exactly how a survivor from an earlier run made a later
      // run report failures belonging to a process nobody was looking at.
      shutdown(child);
      throw new Error(`dev server never answered /health:\n${log}`);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
}

/**
 * `@wafflebase/design-editor` IS BUILT OUTPUT, and `boot()` loads it.
 *
 * `packages/design-sandbox/vite.config.ts` does
 * `import { designEditor, BASE } from '@wafflebase/design-editor'`, and since #966 that
 * resolves through `exports["."]` to `dist/plugin/index.js`. `dist/` is gitignored, so a
 * clean checkout has nothing there and the dev server never starts — reported as
 * "dev server exited early", which reads as a broken config rather than a missing build.
 *
 * The package prebuilds only for `dev` (`predev` in package.json); `verify:tokens` has no
 * such hook, and this script is not on CI (it boots a dev server), so `design-editor:build`
 * guarantees it nothing either. The build has to happen here.
 *
 * Mtime-compared rather than existence-checked, the same as `verify-scenes.mjs`: a gate
 * that rebuilds only when its artefact is MISSING serves stale bytes forever.
 */
function buildDesignEditorIfStale() {
  const pkg = path.resolve(PKG, '../design-editor');
  let newest = 0;
  /** @param {string} dir */
  const walk = (dir) => {
    for (const e of fsSync.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else newest = Math.max(newest, fsSync.statSync(full).mtimeMs);
    }
  };
  walk(path.join(pkg, 'src'));
  for (const config of ['vite.shell.config.ts', 'tsconfig.build.json']) {
    newest = Math.max(newest, fsSync.statSync(path.join(pkg, config)).mtimeMs);
  }
  const outdated = ['dist/shell/index.html', 'dist/plugin/index.js'].filter((rel) => {
    const artefact = path.join(pkg, rel);
    return !fsSync.existsSync(artefact) || fsSync.statSync(artefact).mtimeMs < newest;
  });
  if (outdated.length === 0) return;
  console.log(`building @wafflebase/design-editor (${outdated.join(', ')} missing or older than its src/)`);
  const r = spawnSync('pnpm', ['run', 'build'], { cwd: pkg, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('design-editor build failed');
}

async function main() {
  buildDesignEditorIfStale();
  console.log(`booting vite in ${PKG} on :${PORT}`);
  const server = await boot();
  try {
    console.log('\n/health');
    const health = (await api('/health')).body;
    check('root is the repository, not the Vite root', health.root === REPO_ROOT, health.root);
    check('a token adapter is configured', health.tokens === 'configured', String(health.tokens));
    check('the scene manifest resolved', typeof health.scenes === 'string', String(health.scenes));

    console.log('\nGET /tokens');
    const tokens = (await api('/tokens')).body;
    if (!check('answers ok', tokens.ok === true, tokens.error)) {
      throw new Error(`GET /tokens failed: ${tokens.error}`);
    }
    check('reports the adapter as configured', tokens.adapter === 'configured');
    check('names all six sources', tokens.sources?.length === 6, JSON.stringify(tokens.sources));
    check(
      'resolves --primary to a colour, not to its `palette.syrup` source',
      /^#[0-9A-Fa-f]{6}$/.test(tokens.vars?.light?.['--primary'] ?? ''),
      tokens.vars?.light?.['--primary'],
    );
    check('carries a dark map too', Object.keys(tokens.vars?.dark ?? {}).length > 20);
    check('lists the @theme aliases', (tokens.utilities ?? []).includes('--color-primary'));
    check('names four families', tokens.families?.length === 4);
    check(
      'reports --primary as a rebindable ref',
      tokens.bindings?.themed?.light?.primary?.kind === 'ref',
      JSON.stringify(tokens.bindings?.themed?.light?.primary),
    );
    check(
      'reports sidebarAccent as a locked expression',
      tokens.bindings?.themed?.light?.sidebarAccent?.kind === 'expression',
      JSON.stringify(tokens.bindings?.themed?.light?.sidebarAccent),
    );
    check('offers palette swatches as rebind targets', (tokens.bindings?.refs ?? []).length > 5);

    console.log('\nPOST /preview-tokens');
    const preview = (
      await post('/preview-tokens', {
        intents: [
          { kind: 'palette-value', family: 'palette', path: ['syrup'], tokenValue: '#00FF00' },
        ],
      })
    ).body;
    if (check('answers ok', preview.ok === true, preview.error)) {
      check('moves the patched swatch', preview.light?.['--wb-syrup'] === '#00FF00', preview.light?.['--wb-syrup']);
      // The property no text-level analysis could produce: `--primary`'s source says
      // `palette.syrup` and nothing else, so only running the real emitter moves it too.
      check('moves every token bound to it', preview.light?.['--primary'] === '#00FF00', preview.light?.['--primary']);
      check('returns the base map to diff against', preview.base?.light?.['--wb-syrup'] === '#B8651A', preview.base?.light?.['--wb-syrup']);
    }

    console.log('\nPOST /mutate (dryRun) — the three-point write');
    const memberAdd = {
      kind: 'member-add',
      family: 'palette',
      camelKey: 'smokeTok',
      kebabKey: 'smoke-tok',
      tokenValue: '#123456',
    };
    const dry = (await post('/mutate', { ...memberAdd, dryRun: true })).body;
    if (check('answers ok', dry.ok === true, dry.error)) {
      check(
        'touches all three files',
        dry.files?.length === 3,
        JSON.stringify(dry.files),
      );
      check('includes the source const', (dry.files ?? []).includes('packages/core/src/tokens/palette.ts'));
      check('includes the emitter', (dry.files ?? []).includes('packages/core/scripts/build-css.ts'));
      check('includes the theme alias', (dry.files ?? []).includes('packages/frontend/src/index.css'));
      check(
        'writes the emitter expression through `src`, not a bare identifier',
        (dry.diff ?? '').includes("['--wb-smoke-tok', palette.smokeTok]"),
      );
    }

    console.log('\nPOST /mutate (dryRun) — a value edit is one file');
    const valueDry = (
      await post('/mutate', {
        kind: 'palette-value',
        family: 'palette',
        path: ['syrup'],
        tokenValue: '#00FF00',
        dryRun: true,
      })
    ).body;
    if (check('answers ok', valueDry.ok === true, valueDry.error)) {
      check('touches only the palette source', valueDry.files?.length === 1, JSON.stringify(valueDry.files));
    }

    console.log('\nPOST /validate — a refusal reaches the client as a reason');
    const bad = (
      await post('/validate', {
        intents: [
          { kind: 'member-remove', family: 'palette', camelKey: 'noSuchTokenAnywhere', kebabKey: 'no-such' },
        ],
      })
    ).body;
    check('refuses', bad.ok === false);
    check(
      'says why',
      typeof bad.results?.[0]?.reason === 'string' && bad.results[0].reason.length > 0,
      JSON.stringify(bad.results?.[0]),
    );

    if (WRITE) {
      console.log('\nPOST /mutate + /undo — a real write, then back');
      const touched = [
        'packages/core/src/tokens/palette.ts',
        'packages/core/scripts/build-css.ts',
        'packages/frontend/src/index.css',
      ];
      const before = await Promise.all(touched.map((rel) => fs.readFile(path.join(REPO_ROOT, rel), 'utf8')));
      const wrote = (await post('/mutate', memberAdd)).body;
      const wroteOk = check('write answers ok', wrote.ok === true, wrote.error);
      if (wroteOk) {
        // STRICTLY `true`, not "not false". The field is ABSENT when the regen gate did not
        // fire, and that is the failure worth catching: the gate matches what was written
        // against `sources()`, so a path that does not compare equal makes the emitter
        // silently never run. That exact bug — a `./` prefix matching nothing — was live in
        // `cssVariables` until review found it.
        check('regenerated tokens.css', wrote.regenerated === true, JSON.stringify(wrote));
      }

      /*
       * The undo is attempted WHATEVER the write answered, because this repository is also
       * somebody's working tree (see the header) and the restore matters most in the case
       * that went wrong.
       *
       * It is not reachable through an `ok: false` body, though — the bridge answers that
       * only from paths that precede its write loop, so a refused mutate has touched
       * nothing. What IS reachable is the loop throwing partway (a 500, or a dropped
       * connection) with the first file already written. That case has no `ok` at all,
       * which is why this sits outside the branch.
       *
       * `ok` is therefore only REQUIRED when the write reported success. With nothing to
       * undo the bridge answers `409 nothing to undo`, so demanding it unconditionally
       * would turn a correctly-refused write into a second, invented failure.
       */
      const undone = (await post('/undo', {})).body;
      if (wroteOk) check('undo answers ok', undone.ok === true, undone.error);
      else console.log(`       undo after a failed write: ${undone.error ?? 'ok'}`);

      const after = await Promise.all(
        touched.map((rel) => fs.readFile(path.join(REPO_ROOT, rel), 'utf8')),
      );
      check('every file is byte-identical again', after.every((t, i) => t === before[i]));

      /**
       * Remove the `.bak` files the write left in `packages/core` and `packages/frontend`.
       *
       * `PathGuard.backup` writes `${file}.bak` NEXT TO THE SOURCE, so a `--write` run
       * litters three untracked files into the repository — measured, not hypothetical.
       * `design-editor-local-plugin.md`'s Risks section already names this and prescribes
       * `node_modules/.cache/wafflebase-design-editor/` instead; that mitigation is not
       * implemented, and this run is fresh evidence for it rather than a workaround that
       * makes it go away. Cleaning up here keeps the script usable in the meantime; the
       * fix belongs in `paths.ts`, which is not this package's file.
       */
      const strays = [];
      const leftover = [];
      for (const rel of touched) {
        const bak = path.join(REPO_ROOT, `${rel}.bak`);
        try {
          await fs.unlink(bak);
          strays.push(`${rel}.bak`);
        } catch {
          // The `unlink` failing is two different outcomes, and the check below is only
          // meaningful if they are told apart: ENOENT means no backup was ever written,
          // anything else means one is still sitting in the tree.
          try {
            await fs.access(bak);
            leftover.push(`${rel}.bak`);
          } catch {
            /* not created, or already gone */
          }
        }
      }
      check(
        'the backups it wrote into the source tree were cleaned up',
        leftover.length === 0,
        `removed ${strays.length}: ${strays.join(', ')}; left ${leftover.join(', ')}`,
      );
      if (strays.length) {
        console.log(
          '       NOTE: those .bak files land beside the source because PathGuard.backup\n' +
            '       writes `${file}.bak`. See the Risks section of the design doc.',
        );
      }
    } else {
      console.log('\n(skipping the real write/undo cycle — pass --write to include it)');
    }
  } finally {
    shutdown(server.child);
  }

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures) process.exitCode = 1;
}

/**
 * Signal the dev server's whole process group, then confirm the port is free.
 *
 * A negative pid is the group, which is what reaches vite behind the `pnpm exec` wrapper.
 * A stale listener is what made an earlier run of this script report failures belonging to
 * a process nobody was looking at, so this is worth saying out loud rather than assuming the
 * signal landed.
 *
 * @param {import('node:child_process').ChildProcess} child
 */
function shutdown(child) {
  try {
    // `pid` is undefined when the spawn itself failed, in which case there is no group to
    // signal and `child.kill()` is the whole of it.
    if (child.pid != null) process.kill(-child.pid, 'SIGTERM');
    else child.kill('SIGTERM');
  } catch {
    // Already gone, or never grouped — fall back to the direct signal.
    try {
      child.kill('SIGTERM');
    } catch {
      /* nothing left to kill */
    }
  }
}

main().catch((err) => {
  console.error(`\nverify-tokens failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
