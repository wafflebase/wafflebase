// `pnpm design` — open the design editor from nothing.
//
// The audience is someone who is not a wafflebase developer: they have a clone
// and a browser, and they should not have to learn `pnpm --filter`, which package
// hosts the editor, or that the shell is a separate build. One command, and the
// same command for someone whose environment is already warm — every step below
// is skipped when it is already done, so a second run goes straight to the server.
//
// It is also runnable as `node scripts/design.mjs`, which is the entry point for a
// person who does not yet have pnpm: this file prepares it. That is why it takes
// no dependency of its own and speaks only Node built-ins.
//
// WHY THIS CAN EXIST AT ALL. The design sandbox is the one part of wafflebase that
// runs standalone — its scenes are served against `http://scene.invalid` behind a
// fetch guard, so there is no backend, no database, no Yorkie and no
// `docker compose`. Every other `pnpm dev` in this repo needs infrastructure.
//
// Usage:
//   pnpm design                 # or: node scripts/design.mjs
//   pnpm design -- --no-open    # do not launch a browser
//   pnpm design -- --port 5200
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SANDBOX = path.join(ROOT, 'packages', 'design-sandbox');
const EDITOR = path.join(ROOT, 'packages', 'design-editor');
/**
 * BOTH built artefacts, because both are loaded and both come out of `src/`.
 *
 * `dist/shell` is the chrome the mount point serves. `dist/plugin` is what NODE loads:
 * since #966 the package's `exports["."]` names `dist/plugin/index.js`, and
 * `packages/design-sandbox/vite.config.ts` imports the package by name. Watching only
 * `src/shell` meant an edit under `src/plugin/**` ran against a stale compiled plugin.
 */
const EDITOR_DIST = [
  path.join(EDITOR, 'dist', 'shell', 'index.html'),
  path.join(EDITOR, 'dist', 'plugin', 'index.js'),
];
const EDITOR_SRC = path.join(EDITOR, 'src');
const BASE = '/__design-editor';
/**
 * Where the detected URL is left for `design-pr.mjs`.
 *
 * Vite takes the next free port when its default is busy — measured landing on
 * `:5175` here — so 5173 is a guess about somebody else's server. Recording the
 * real one is what stops `pnpm design-pr` failing to reach the editor and quietly
 * widening its commit to the whole working tree. Under `node_modules/.cache/`,
 * beside the editor's backups, so it is never a file in anyone's repository.
 */
const SERVER_FILE = path.join(ROOT, 'node_modules', '.cache', 'wafflebase-design-editor', 'server.json');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : argv[i + 1];
};

const say = (s) => process.stdout.write(`${s}\n`);
const step = (s) => say(`\x1b[2m›\x1b[0m ${s}`);
const ok = (s) => say(`\x1b[32m✓\x1b[0m ${s}`);

/** Stop with an instruction, never a stack trace — the reader may not write code. */
function stop(problem, instruction) {
  say(`\n\x1b[31m✗\x1b[0m ${problem}\n`);
  say(`  ${instruction}\n`);
  process.exit(1);
}

// --- 0. Node -----------------------------------------------------------------
//
// The floor, and the one thing this script cannot install for you: it is already
// running inside it.
const wanted = Number((readFileSync(path.join(ROOT, '.nvmrc'), 'utf8').trim().match(/\d+/) ?? ['22'])[0]);
const have = Number(process.versions.node.split('.')[0]);
if (have < wanted) {
  stop(
    `Node ${wanted} or newer is required — this is Node ${process.versions.node}.`,
    `Install it from https://nodejs.org (the LTS download), then run this again.`,
  );
}

// --- 1. pnpm -----------------------------------------------------------------
//
// Prepared through corepack, which ships with Node, so the version pinned in
// `packageManager` is the one that runs. A person invoking us through `pnpm design`
// already has it and this is a no-op check.
function pnpmBin() {
  const probe = spawnSync('pnpm', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' });
  if (probe.status === 0) return 'pnpm';
  step('preparing pnpm (via corepack)…');
  const enable = spawnSync('corepack', ['enable'], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (enable.status !== 0) {
    stop(
      'pnpm is not installed and corepack could not enable it.',
      'Run `npm install -g pnpm`, then run this again.',
    );
  }
  return 'pnpm';
}
const PNPM = pnpmBin();

// --- 2. dependencies ---------------------------------------------------------
//
// Presence, not freshness: a lockfile check would reinstall on every unrelated
// dependency change in the monorepo, and this command is not a build gate. If the
// server later fails on a missing module, `pnpm install` is the fix and the error
// says so.
if (!existsSync(path.join(SANDBOX, 'node_modules')) || !existsSync(path.join(ROOT, 'node_modules'))) {
  step('installing dependencies — this takes a few minutes the first time…');
  const r = spawnSync(PNPM, ['install'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) stop('Dependency install failed.', 'Scroll up for the reason, then run this again.');
  ok('dependencies installed');
} else {
  ok('dependencies present');
}

// --- 3. the editor build -----------------------------------------------------
//
// A PREBUILT BUNDLE, and the third of the stale-artifact traps this project keeps
// hitting: the shell is served from `dist/` and the plugin is LOADED from `dist/`,
// so editing either one's source changes nothing until it is rebuilt. Rebuilt only
// when a source file is newer than an artefact, because the build is ~20s and most
// runs do not need it. Compared against the whole of `src/`: the two artefacts are
// built from overlapping subtrees, and `pnpm … build` produces both anyway, so
// narrowing the watch per artefact would only reintroduce the trap it just left.
function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    const t = entry.isDirectory() ? newestMtime(p) : statSync(p).mtimeMs;
    if (t > newest) newest = t;
  }
  return newest;
}
const newestSrc = newestMtime(EDITOR_SRC);
const distStale = EDITOR_DIST.some((f) => !existsSync(f) || newestSrc > statSync(f).mtimeMs);
if (distStale) {
  step('building the editor (shell + plugin)…');
  const r = spawnSync(PNPM, ['--filter', '@wafflebase/design-editor', 'build'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) stop('The editor failed to build.', 'Scroll up for the reason, then run this again.');
  ok('editor built');
} else {
  ok('editor build up to date');
}

// --- 4. @wafflebase/core's build output ---------------------------------------
//
// The fourth stale-artifact trap, and the only one that had nobody watching it. The
// scenes reach `@wafflebase/core` through its exports map, which points at `dist/` —
// and `dist/` is gitignored with no `prepare` script, so a FRESH CLONE has none of
// it. `packages/frontend/src/index.css` imports `@wafflebase/core/tokens.css` on its
// third line, and the sandbox deliberately does not alias the package, so there is no
// source fallback: every scene fails to resolve it, and `loadFailureKind` reports
// anything that is not a transform/parse error as a MOUNT failure. What the person
// sees is "mount error" on a clean clone, which reads as a broken editor rather than
// as a build that never ran.
//
// This is also why "123 s from a clone to a working editor" was optimistic: that
// measurement stopped at `/metadata`, which answers perfectly well without core.
const CORE_SRC = path.join(ROOT, 'packages', 'core', 'src');
const CORE_DIST = path.join(ROOT, 'packages', 'core', 'dist', 'tokens.css');
const coreStale = !existsSync(CORE_DIST) || newestMtime(CORE_SRC) > statSync(CORE_DIST).mtimeMs;
if (coreStale) {
  step('building @wafflebase/core…');
  const r = spawnSync(PNPM, ['--filter', '@wafflebase/core', 'build'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) stop('@wafflebase/core failed to build.', 'Scroll up for the reason, then run this again.');
  ok('@wafflebase/core built');
} else {
  ok('@wafflebase/core up to date');
}

// --- 5. the server -----------------------------------------------------------
//
// Vite's own printed URL is the source of truth for the port: `--port` is a
// preference, and Vite silently takes the next free one when it is busy. Guessing
// would open a browser at a server that is not ours — or at nothing.
const args = ['exec', 'vite'];
if (value('port')) args.push('--port', value('port'));
/**
 * A MISSING DEPENDENCY IS RECOVERABLE, and step 2 cannot see it coming.
 *
 * That step tests for the PRESENCE of `node_modules`, deliberately — see its own
 * comment. The cost of that choice is this case: check out a branch that added a
 * workspace dependency and the tree is present but incomplete, so Vite fails to load
 * the consumer config and the person is left holding an `ERR_MODULE_NOT_FOUND` stack
 * trace that names a package they have never heard of. Measured on the commit that
 * made `packages/design-sandbox/vite.config.ts` import `@wafflebase/debug-report`:
 * step 2 printed "dependencies present" and the server died anyway.
 *
 * So install once and start again, rather than telling them to. Gated three ways,
 * because a retry that fires on the wrong failure is worse than no retry: only when
 * the process EXITED non-zero, only when it never reached a URL (a module that goes
 * missing under an already-serving editor is a different problem, and reinstalling
 * would not fix it), and only once.
 */
const MISSING_DEP = /ERR_MODULE_NOT_FOUND|Cannot find package|Cannot find module/;

/**
 * The signature is matched against the previous chunk's TAIL as well as the chunk.
 *
 * A pipe splits wherever it likes, so `Cannot find package` can arrive in two writes
 * — and then a per-chunk test leaves `sawMissingDep` false, the retry never fires,
 * and the person is back to reading the stack trace this exists to spare them. Per
 * stream, because stdout and stderr interleave and a tail from one says nothing about
 * the other. 200 characters against a 20-character longest signature is slack, not a
 * measurement.
 */
const CARRY = 200;
let carry = { out: '', err: '' };
const scanFor = (stream, text) => {
  if (MISSING_DEP.test(carry[stream] + text)) sawMissingDep = true;
  carry[stream] = text.slice(-CARRY);
};

let server;
let opened = false;
let retried = false;
let sawMissingDep = false;

const onChunk = (buf) => {
  const text = buf.toString();
  process.stdout.write(text);
  scanFor('out', text);
  if (opened) return;
  const url = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/?/)?.[0];
  if (!url) return;
  opened = true;
  const editor = `${url.replace(/\/$/, '')}${BASE}/`;
  try {
    mkdirSync(path.dirname(SERVER_FILE), { recursive: true });
    writeFileSync(SERVER_FILE, JSON.stringify({ url: url.replace(/\/$/, ''), pid: process.pid }));
  } catch {
    /* `design-pr` falls back to 5173 and says which URLs it tried */
  }
  say('');
  ok(`the design editor is at \x1b[4m${editor}\x1b[0m`);
  say('  Pick a component on the left, change it, then `pnpm design-pr` to open a pull request.');
  say('  Nothing leaves this machine until you do.\n');
  if (!flag('no-open')) openBrowser(editor);
};
function start() {
  step('starting the editor…');
  server = spawn(PNPM, args, { cwd: SANDBOX, shell: process.platform === 'win32' });
  server.stdout.on('data', onChunk);
  // Vite reports a config-load failure on stderr, which is where the recoverable
  // case shows up — so this stream is read for the signature too, not just relayed.
  server.stderr.on('data', (b) => {
    const text = b.toString();
    process.stderr.write(text);
    scanFor('err', text);
  });
  server.on('exit', (code) => {
    if (code && !opened && sawMissingDep && !retried) {
      retried = true;
      sawMissingDep = false;
      carry = { out: '', err: '' };
      say('');
      step('a dependency is missing — installing, then starting again…');
      const r = spawnSync(PNPM, ['install'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
      if (r.status !== 0) {
        stop('Dependency install failed.', 'Scroll up for the reason, then run this again.');
      }
      ok('dependencies installed');
      start();
      return;
    }
    process.exit(code ?? 0);
  });
}
start();

/** Best effort, and deliberately silent on failure — the URL is printed above. */
function openBrowser(url) {
  const cmd =
    process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : ['xdg-open', [url]];
  try {
    execFileSync(cmd[0], cmd[1], { stdio: 'ignore' });
  } catch {
    /* headless, WSL without an opener, or no desktop — the printed URL is the fallback */
  }
}

// The URL outlives nothing: a stale one would send `design-pr` at a dead port and
// make it report the wrong reason for falling back.
const forgetServer = () => {
  try {
    rmSync(SERVER_FILE, { force: true });
  } catch {
    /* nothing depends on this succeeding */
  }
};
process.on('exit', forgetServer);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    forgetServer();
    server.kill(sig);
    process.exit(0);
  });
}
