// @ts-check
/**
 * verify-consumer.mjs — the plugin against a FOREIGN project.
 *
 * THE CLAIM THIS GATE EXISTS TO CHECK. `design-editor-local-plugin.md` §8 records the
 * plugin host as having landed "with no automated gate", and names a fixture-project
 * integration lane as the thing that "would prove the pivot's central claim (that the
 * plugin works in a foreign project)". Every other suite checks a piece: the unit tests
 * run modules in isolation, and `design-sandbox`'s `verify-tokens.mjs` drives the full
 * chain but against WAFFLEBASE — the one project whose layout the prototype was written
 * around, with a bespoke `TokenAdapter` we also wrote. Neither can fail the way this can.
 *
 * `fixtures/consumer/` is that foreign project: its own directory layout (`app/`, not
 * `packages/frontend/src/`), its own stylesheet, its own scene manifest, no
 * `@wafflebase/*` dependency, and NO adapter of its own — it uses the default
 * `cssVariables()`, which is the population §4 says is the common case. Its whole
 * configuration is the plugin call plus one `resolve.alias` it would have written
 * anyway.
 *
 * NOTHING IS WRITTEN unless `--write` is passed. Every mutation check uses `dryRun`.
 * `--write` adds one real `/commit` followed by `/undo` and asserts the tree came back
 * byte-identical — opt-in because the fixture is a tracked directory.
 *
 * OUT OF `verify:fast` / `verify:self` by default, on the same grounds as
 * `verify-tokens.mjs`: it boots a dev server. Run it by hand, or in a lane that can
 * afford it:
 *
 *   pnpm --filter @wafflebase/design-editor verify:consumer
 *   pnpm --filter @wafflebase/design-editor verify:consumer --write
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const PROJECT = path.join(PKG, 'fixtures/consumer');
const PORT = Number(process.env.PORT ?? 5201);
const BASE = `http://127.0.0.1:${PORT}/__design-editor/api`;
const WRITE = process.argv.includes('--write');

const STYLESHEET = 'app/styles/theme.css';
const COMPONENT = 'app/components/badge.tsx';
const ROUTE = 'app/pages/dashboard.tsx';

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
 * Signal the dev server's whole process GROUP.
 *
 * `pnpm exec vite` is a wrapper that spawns vite as its own child, so killing the
 * returned pid leaves the server holding the port — and a survivor from an earlier run
 * then answers `/health` while the run under test never starts, making every check below
 * report on a process nobody is looking at.
 *
 * @param {import('node:child_process').ChildProcess} child
 */
function shutdown(child) {
  try {
    if (child.pid != null) process.kill(-child.pid, 'SIGTERM');
    else child.kill('SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      /* nothing left to kill */
    }
  }
}

/**
 * Boot vite in the fixture project and wait for the bridge to answer.
 *
 * `--root` and `--config` are passed EXPLICITLY, and spawning with `cwd: PROJECT` is
 * not enough on its own: `pnpm exec` resolves the project directory and runs from the
 * nearest package root, so vite's root became `packages/design-editor`, it found no
 * config there, and every plugin silently went unloaded — a dev server that starts
 * cleanly, serves the fixture, and answers 404 to the entire bridge. `verify-tokens.mjs`
 * gets away with the bare `cwd:` form only because its package root and its Vite root
 * are the same directory.
 */
async function boot() {
  const child = spawn(
    'pnpm',
    // Root is POSITIONAL for `vite dev` — `--root` is a build-only flag and the CLI
    // rejects it outright.
    ['exec', 'vite', PROJECT, '--config', path.join(PROJECT, 'vite.config.ts'), '--port', String(PORT), '--strictPort'],
    {
      cwd: PROJECT,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    },
  );
  let log = '';
  child.stdout?.on('data', (c) => (log += c.toString()));
  child.stderr?.on('data', (c) => (log += c.toString()));

  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode != null) throw new Error(`dev server exited early:\n${log}`);
    try {
      const r = await api('/health');
      if (r.status === 200 && r.body.ok) return child;
    } catch {
      /* not listening yet */
    }
    if (Date.now() > deadline) {
      shutdown(child);
      throw new Error(`dev server never answered /health:\n${log}`);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
}

/**
 * The virtual scenes module, as the shell would import it.
 *
 * There is no `/scenes` endpoint — the manifest reaches the browser as a generated
 * module, so fetching it through Vite is the only way to check that the consumer's
 * own `scenes.config.json` was found, parsed and rendered.
 */
async function scenesModule() {
  const res = await fetch(`http://127.0.0.1:${PORT}/@id/__x00__virtual:wb-scenes`);
  return res.ok ? res.text() : '';
}

/** A shell URL, which is NOT under `/api` — `BASE` cannot be reused for these. */
const shell = (p) => fetch(`http://127.0.0.1:${PORT}/__design-editor${p}`);

/**
 * Build the shell if it is not there.
 *
 * `dist` is gitignored, so a clean checkout has no shell at all and every check
 * below would fail on a missing file rather than on a wrong one. Building here
 * rather than trusting the caller to remember is what makes this gate's verdict mean
 * something on CI — and the build is on the `design-editor:check` lane besides, so a
 * broken build fails before this script is reached.
 */
function buildShellIfMissing() {
  if (fsSync.existsSync(path.join(PKG, 'dist/shell/index.html'))) return;
  console.log('building the shell (dist/ is gitignored)');
  const r = spawnSync('pnpm', ['exec', 'vite', 'build', '--config', './vite.shell.config.ts'], {
    cwd: PKG,
    stdio: 'inherit',
  });
  if (r.status !== 0) throw new Error('shell build failed');
}

async function main() {
  buildShellIfMissing();
  console.log(`booting vite in ${path.relative(PKG, PROJECT)} on :${PORT}`);
  const child = await boot();
  try {
    console.log('\n/health');
    const health = (await api('/health')).body;
    // No `root` option is set, so this is Vite's own resolved root — the default a
    // consumer gets by writing nothing.
    check('root defaults to the project', health.root === PROJECT, health.root);
    check('a token adapter is configured', health.tokens === 'configured', String(health.tokens));
    check('the scene manifest resolved', typeof health.scenes === 'string', String(health.scenes));
    check('no providers module is required', health.providers === null, String(health.providers));
    check(
      "reports the consumer's own alias, root-relative",
      JSON.stringify(health.aliases) === JSON.stringify([{ find: '@', replacement: 'app' }]),
      JSON.stringify(health.aliases),
    );

    console.log('\nGET /tokens — through the DEFAULT adapter');
    const tokens = (await api('/tokens')).body;
    if (!check('answers ok', tokens.ok === true, tokens.error)) {
      throw new Error(`GET /tokens failed: ${tokens.error}`);
    }
    check(
      'names the one stylesheet, and nothing else',
      tokens.sources?.length === 1 && tokens.sources[0] === STYLESHEET,
      JSON.stringify(tokens.sources),
    );
    check(
      'reads the :root block',
      tokens.vars?.light?.['--primary'] === 'oklch(0.55 0.21 264)',
      tokens.vars?.light?.['--primary'],
    );
    check(
      'reads .dark as an OVERRIDE, not a full set',
      tokens.vars?.dark?.['--primary'] === 'oklch(0.72 0.16 264)' &&
        tokens.vars?.dark?.['--radius'] === undefined,
      JSON.stringify({ primary: tokens.vars?.dark?.['--primary'], radius: tokens.vars?.dark?.['--radius'] }),
    );
    check(
      'lists the @theme inline aliases',
      (tokens.utilities ?? []).includes('--color-primary'),
      JSON.stringify((tokens.utilities ?? []).slice(0, 4)),
    );
    check(
      'points every family at that one file',
      (tokens.families ?? []).length > 0 &&
        (tokens.families ?? []).every((/** @type {any} */ f) => f.file === STYLESHEET),
      JSON.stringify((tokens.families ?? []).map((/** @type {any} */ f) => f.file)),
    );
    // A stylesheet pipeline has no source layer: the declaration IS the value, so there
    // is nothing for `bindings` to add. Absent is the correct answer, not a gap.
    check('reports no source bindings, which it has none of', tokens.bindings === undefined);

    console.log('\nPOST /preview-tokens');
    const preview = (
      await post('/preview-tokens', {
        intents: [{ kind: 'token-value', family: 'semantic', path: ['primary'], tokenValue: '#00FF00' }],
      })
    ).body;
    if (check('answers ok', preview.ok === true, preview.error)) {
      check('moves the patched property', preview.light?.['--primary'] === '#00FF00', preview.light?.['--primary']);
      check(
        'returns the on-disk map to diff against',
        preview.base?.light?.['--primary'] === 'oklch(0.55 0.21 264)',
        preview.base?.light?.['--primary'],
      );
      check(
        'leaves the dark block alone',
        preview.dark?.['--primary'] === 'oklch(0.72 0.16 264)',
        preview.dark?.['--primary'],
      );
    }

    console.log('\nPOST /mutate (dryRun) — token value, add and remove');
    const valueDry = (
      await post('/mutate', {
        kind: 'token-value',
        family: 'semantic',
        constName: 'dark',
        path: ['ring'],
        tokenValue: 'oklch(0.6 0 0)',
        dryRun: true,
      })
    ).body;
    if (check('a value edit answers ok', valueDry.ok === true, valueDry.error)) {
      check('touches only the stylesheet', valueDry.files?.length === 1 && valueDry.files[0] === STYLESHEET, JSON.stringify(valueDry.files));
      check('edits the .dark block, not :root', (valueDry.diff ?? '').includes('oklch(0.6 0 0)'));
    }

    const addDry = (
      await post('/mutate', {
        kind: 'member-add',
        family: 'semantic',
        camelKey: 'brandAccent',
        tokenValue: 'oklch(0.7 0.1 250)',
        dryRun: true,
      })
    ).body;
    if (check('a token add answers ok', addDry.ok === true, addDry.error)) {
      // One file, three edits inside it — the base block, the dark block and the alias.
      // That is the shape `TokenWrite[]` exists for, and it collapses to one file here.
      check('declares the property', (addDry.diff ?? '').includes('--brand-accent'));
      check('aliases it so a utility exists', (addDry.diff ?? '').includes('--color-brand-accent'));
    }

    console.log('\nPOST /mutate (dryRun) — class rewrite in the consumer’s own CVA');
    const classDry = (
      await post('/mutate', {
        kind: 'class-rewrite',
        file: COMPONENT,
        cvaName: 'badgeVariants',
        axis: 'variant',
        value: 'secondary',
        replacements: [{ from: 'bg-secondary', to: 'bg-primary' }],
        dryRun: true,
      })
    ).body;
    if (check('answers ok', classDry.ok === true, classDry.error)) {
      check('rewrites inside the named variant only', (classDry.diff ?? '').includes('bg-primary text-secondary-foreground'), classDry.diff?.slice(0, 200));
    }

    console.log('\nPOST /candidates — runtime-composed classes');
    const cand = (await post('/candidates', { classes: ['bg-primary/70', 'rounded-lg'] })).body;
    if (check('answers ok', cand.ok === true, cand.error)) {
      check('accepts both', (cand.added ?? []).length + (cand.total ?? 0) > 0, JSON.stringify(cand));
      check('rejects nothing legitimate', (cand.rejected ?? []).length === 0, JSON.stringify(cand.rejected));
    }

    console.log('\nvirtual:wb-scenes — the consumer’s own manifest, rendered');
    const scenesSrc = await scenesModule();
    if (check('the virtual module is served', scenesSrc.length > 0)) {
      check('carries the one declared scene', scenesSrc.includes('"dashboard"'), scenesSrc.slice(0, 160));
      check('kept its `app/` path, not a wafflebase one', scenesSrc.includes(ROUTE), scenesSrc.slice(0, 160));
      // Generated, never called: no browser mounts it here, which is why this project
      // needs no React installed to satisfy the gate.
      check('generates a loader for it', scenesSrc.includes('import('), scenesSrc.slice(0, 200));
    }

    console.log('\nthe shell — prebuilt documents and assets, served by the plugin');
    const index = await shell('/');
    if (check('the mount point serves the chrome document', index.status === 200, String(index.status))) {
      const html = await index.text();
      check('it mounts the shell root', html.includes('id="wb-root"'));
      // The asset URLs are BASE-prefixed by the build. Emitted at the default `/`
      // they would resolve against the consumer's dev server instead, and their app
      // would answer — a 404 if they are lucky, their own asset if they are not.
      const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
      check(
        'every asset URL is under the plugin mount',
        assets.length > 0 && assets.every((a) => a.startsWith('/__design-editor/')),
        assets.join(' '),
      );
      // Fetched, not just parsed out of the HTML: a hashed filename that does not
      // resolve is the failure mode a stale build produces.
      const fetched = await Promise.all(
        assets.map(async (a) => `${a} ${(await fetch(`http://127.0.0.1:${PORT}${a}`)).status}`),
      );
      check('and each one is served', fetched.every((f) => f.endsWith(' 200')), fetched.join(' '));
      // §6: the chrome must not inherit the theme it exists to judge.
      const css = await (await fetch(`http://127.0.0.1:${PORT}${assets.find((a) => a.endsWith('.css'))}`)).text();
      check('the shell stylesheet is self-contained', !css.includes(STYLESHEET) && !css.includes('fonts.googleapis'), css.slice(0, 120));
    }

    const scene = await shell('/scene');
    if (check('the frame document serves', scene.status === 200, String(scene.status))) {
      const html = await scene.text();
      // The token must be gone: a document that shipped it would load
      // `__WB_SCENE_ENTRY__` as a relative URL and 404 inside the frame, which reads
      // as a scene that renders nothing.
      check('the entry placeholder was substituted', !html.includes('__WB_SCENE_ENTRY__'));
      const src = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]).pop();
      check('the entry is a real file path, not a virtual module', !!src && src.startsWith('/@fs/'), String(src));
      // The decisive one. A virtual module 500s here (plugin-react does not transform
      // it); this asserts the consumer's own server both serves the entry AND
      // resolves what it imports.
      const entry = await fetch(`http://127.0.0.1:${PORT}${src}`);
      if (check('the CONSUMER’s server serves the entry', entry.status === 200, String(entry.status))) {
        const js = await entry.text();
        check('transformed, with its imports rewritten', js.includes('/@fs/') && js.includes('installFetchGuard'), js.slice(0, 120));
        const dep = [...js.matchAll(/from "([^"]+)"/g)].map((m) => m[1])[0];
        const depRes = await fetch(`http://127.0.0.1:${PORT}${dep}`);
        check('and what it imports resolves too', depRes.status === 200, `${dep} ${depRes.status}`);
      }
    }

    console.log('\nPOST /mutate — refusals reach the client as reasons');
    const outside = (
      await post('/mutate', {
        kind: 'token-value',
        family: 'semantic',
        path: ['nothingHere'],
        tokenValue: '#fff',
        dryRun: true,
      })
    ).body;
    check('an unknown token is refused', outside.ok === false || outside.located === false, JSON.stringify(outside).slice(0, 200));
    check('and says why', typeof (outside.error ?? outside.notes?.[0]) === 'string', JSON.stringify(outside).slice(0, 200));

    const escape = (
      await post('/mutate', {
        kind: 'class-rewrite',
        file: '../../../../etc/passwd',
        cvaName: 'x',
        replacements: [],
        dryRun: true,
      })
    ).body;
    // The write boundary is `options.root`, which here defaults to the Vite root — so a
    // foreign project gets the guard without configuring one.
    check('a path outside the project is refused', escape.ok === false || escape.located === false, JSON.stringify(escape).slice(0, 160));

    if (WRITE) {
      console.log('\nPOST /commit + /undo — a real write, then back');
      const before = await fs.readFile(path.join(PROJECT, STYLESHEET), 'utf8');
      const wrote = (
        await post('/commit', {
          intents: [
            { kind: 'token-value', family: 'semantic', path: ['primary'], tokenValue: 'oklch(0.5 0.2 30)' },
            { kind: 'member-add', family: 'radius', camelKey: 'pill', tokenValue: '9999px' },
          ],
        })
      ).body;
      const wroteOk = check('the batch answers ok', wrote.ok === true, wrote.error);
      if (wroteOk) {
        const after = await fs.readFile(path.join(PROJECT, STYLESHEET), 'utf8');
        check('the stylesheet actually changed', after !== before);
        check('both edits landed in one file', wrote.files?.length === 1, JSON.stringify(wrote.files));
        // `cssVariables` has no `regenerate()`: the write IS the emission for a
        // stylesheet pipeline, and Vite's own CSS HMR publishes it. Absent, not false.
        check('no emitter was re-run, because there is none', wrote.regenerated === undefined, JSON.stringify(wrote.regenerated));
      }

      // Attempted whatever the write answered — the restore matters most when something
      // went wrong. `ok` is only REQUIRED when the write reported success: with nothing
      // to undo the bridge answers `409 nothing to undo`, and demanding it regardless
      // would turn a correctly-refused write into a second, invented failure.
      const undone = (await post('/undo', {})).body;
      if (wroteOk) check('undo answers ok', undone.ok === true, undone.error);
      else console.log(`       undo after a failed write: ${undone.error ?? 'ok'}`);

      const restored = await fs.readFile(path.join(PROJECT, STYLESHEET), 'utf8');
      check('the stylesheet is byte-identical again', restored === before);

      // `PathGuard.backup` writes `${file}.bak` next to the source, so a `--write` run
      // litters the fixture. The design doc's Risks section names that and prescribes a
      // cache directory instead; the mitigation is unimplemented, so this cleans up and
      // reports rather than pretending it did not happen.
      const bak = path.join(PROJECT, `${STYLESHEET}.bak`);
      let left = false;
      try {
        await fs.unlink(bak);
        console.log(`       removed ${STYLESHEET}.bak (see the Risks section)`);
      } catch {
        try {
          await fs.access(bak);
          left = true;
        } catch {
          /* never created, or already gone */
        }
      }
      check('no backup was left in the fixture', !left, `${STYLESHEET}.bak`);
    } else {
      console.log('\n(skipping the real write/undo cycle — pass --write to include it)');
    }
  } finally {
    shutdown(child);
  }

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`\nverify-consumer failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
