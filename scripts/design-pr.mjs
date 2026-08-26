// `pnpm design-pr` — turn what you changed in the design editor into a pull request.
//
// The other half of `pnpm design`. Edits already land in the working tree; for a
// developer that is the end of the story, because `git diff` is the review surface.
// For everyone else it is a dead end, and this is the road out of it.
//
// A LADDER, DESCENDED AUTOMATICALLY. What a person has installed decides how far
// this can go, and they should never have to know which rung they are on:
//
//   3 · push rights          → branch, commit, push, `gh pr create`
//   2 · `gh` but no rights   → `gh repo fork`, push to the fork, PR against upstream
//   1 · git only             → branch, commit, push, open the compare page
//   0 · no git               → say so, and stop
//
// Rung 1 is the one that matters: a browser is enough. `gh auth login` is not a
// precondition for opening a pull request, and requiring it would put the whole
// point of this script behind a step its audience cannot take.
//
// NO CREDENTIAL OF OURS, ANYWHERE. `git` and `gh` run as the person invoking them,
// with the credentials already on their machine — the same thing they would type.
// This is what makes a PR compatible with the local-plugin pivot, which withdrew
// the hosted pipeline precisely because it had to hold a GitHub App or a PAT.
//
// Usage:
//   pnpm design-pr                          # or: node scripts/design-pr.mjs
//   pnpm design-pr -- --dry-run             # print the plan, change nothing
//   pnpm design-pr -- --title T --body-file B
//   pnpm design-pr -- --server http://localhost:5200
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const API = '/__design-editor/api';
/** Never committed to directly, however the branch name was arrived at. */
const PROTECTED = new Set(['main', 'master']);
/** Where `design.mjs` records the URL Vite actually bound to. */
const SERVER_FILE = path.join(ROOT, 'node_modules', '.cache', 'wafflebase-design-editor', 'server.json');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const value = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? null : argv[i + 1];
};
const DRY = flag('dry-run');

const say = (s) => process.stdout.write(`${s}\n`);
const step = (s) => say(`\x1b[2m›\x1b[0m ${s}`);
const ok = (s) => say(`\x1b[32m✓\x1b[0m ${s}`);
const warn = (s) => say(`\x1b[33m!\x1b[0m ${s}`);
function stop(problem, instruction) {
  say(`\n\x1b[31m✗\x1b[0m ${problem}\n`);
  if (instruction) say(`  ${instruction}\n`);
  process.exit(1);
}

/**
 * Every git call this script makes is fatal if it fails, so a failure is REPORTED
 * rather than thrown. `execFileSync` throws an Error whose message is a serialised
 * argv and whose `stderr` holds the part a person needs, and nothing caught it —
 * so a git that merely had nothing configured answered with a Node stack trace.
 * Found by driving rung 1 on a machine with no global identity.
 */
const git = (args, opts = {}) => {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', ...opts }).trim();
  } catch (error) {
    const reason = String(error?.stderr ?? '').trim();
    stop(`\`git ${args[0]}\` failed.`, reason || 'Scroll up for the reason.');
    return '';
  }
};
/**
 * The changed paths, from `git status --porcelain=v1 -z`.
 *
 * `-z` FOR TWO REASONS, both of which decide which files reach someone else's
 * pull request — the worst thing this script can get wrong.
 *
 * In the human format git QUOTES and C-escapes any path it considers unusual, so
 * a tab in a name arrives as a literal backslash-t and names nothing. And a rename
 * reads `R  old -> new`, which cannot be told apart from a file literally called
 * `untracked -> weird.ts` — measured, git prints exactly that for one. Splitting on
 * the arrow truncated it to `weird.ts`.
 *
 * Under `-z` neither problem exists: records are NUL-separated and never escaped,
 * and a rename or copy is two records with the NEW path first. The status field is
 * still two columns plus a space, so the path starts at index 3 — and the earlier
 * bug is gone with the line splitting that caused it, which was trimming git's
 * whole output and eating a character of the first path when its status began with
 * a space (` M package.json` → `ackage.json`).
 */
export const parsePorcelain = (out) => {
  const records = out.split('\0').filter((r) => r.length > 3);
  const paths = [];
  for (let i = 0; i < records.length; i += 1) {
    const status = records[i].slice(0, 2);
    paths.push(records[i].slice(3));
    // A rename or copy carries its ORIGIN in the next record. That path is not a
    // thing to commit — it no longer exists — so it is consumed and dropped.
    if (status[0] === 'R' || status[0] === 'C' || status[1] === 'R' || status[1] === 'C') i += 1;
  }
  return paths;
};

const changedPaths = () =>
  parsePorcelain(
    execFileSync('git', ['status', '--porcelain=v1', '-z'], { cwd: ROOT, encoding: 'utf8' }),
  );
const gitTry = (args) => {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
};
const has = (bin) => spawnSync(bin, ['--version'], { encoding: 'utf8' }).status === 0;
const ghJson = (args) => {
  const r = spawnSync('gh', args, { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) return null;
  try {
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
};

// --- what changed ------------------------------------------------------------
//
// TWO SOURCES, AND THE FIRST IS BETTER. `GET /transactions` is the editor's own
// write log: the files it touched and a human label per edit ("Button: Background
// Color · hover", "--primary → butter.500"). That is the INTENT, not an inference
// from the resulting text — nothing else can tell you a class change was a hover
// state on one variant rather than a line that happens to differ.
//
// The log lives in the dev-server's memory and is deliberately not persisted, so
// it is gone once the editor is closed. Then `git status` is all there is, and the
// output says so rather than quietly narrowing.
/**
 * Where the editor is, in the order worth trying.
 *
 * `pnpm design` writes the URL Vite actually bound to, because Vite takes the next
 * free port when its default is busy and 5173 is then a guess about someone else's
 * server. Measured: a launch here landed on `:5175`. Guessing wrong is not a
 * cosmetic failure — the request fails, the script falls back to the whole working
 * tree, and a pull request gets files the editor never touched.
 */
function serverCandidates() {
  if (value('server')) return [value('server').replace(/\/$/, '')];
  const found = [];
  try {
    const url = JSON.parse(readFileSync(SERVER_FILE, 'utf8'))?.url;
    if (url) found.push(String(url).replace(/\/$/, ''));
  } catch {
    /* never launched through `pnpm design`, or the cache was cleared */
  }
  if (!found.includes('http://localhost:5173')) found.push('http://localhost:5173');
  return found;
}

async function readChanges() {
  const tried = serverCandidates();
  let reached = null;
  for (const server of tried) {
    try {
      const res = await fetch(`${server}${API}/transactions`, { signal: AbortSignal.timeout(2000) });
      const body = await res.json();
      // The FIRST that answers, not the last: candidates are ordered by authority
      // (the URL `pnpm design` recorded, then the default), and reporting a stale
      // server on 5173 over the one actually launched is the wrong diagnosis again.
      reached ??= server;
      const txns = body?.undo ?? body?.transactions ?? [];
      const files = [...new Set(txns.flatMap((t) => t.files ?? []))];
      const labels = [...new Set(txns.flatMap((t) => t.labels ?? []))];
      if (files.length) return { files, labels, precise: true, server };
    } catch {
      /* not here — try the next candidate */
    }
  }
  // REACHED-BUT-EMPTY IS NOT THE SAME AS ABSENT, and saying "could not reach the
  // editor" when it answered is a wrong diagnosis rather than a vague one — it
  // sends the reader looking for a dead server instead of at the Save they never
  // approved. Either way the working tree is the only list left.
  return { files: changedPaths(), labels: [], precise: false, tried, reached };
}

/**
 * The body, assembled from the editor's own labels.
 *
 * DETERMINISTIC ON PURPOSE. A model summarising the diff would be inferring what
 * happened; these labels ARE what happened, recorded at the moment each edit was
 * staged. `design-changes-to-pr` writes better prose for a person who has Claude
 * Code, and hands it in through `--body-file` — the loop closes without it.
 */
export function defaultBody({ labels, files, precise }) {
  const lines = ['Made with the wafflebase design editor.', ''];
  if (labels.length) {
    lines.push('## Changes', '');
    for (const l of labels) lines.push(`- ${l}`);
    lines.push('');
  }
  lines.push('## Files', '');
  for (const f of files) lines.push(`- \`${f}\``);
  lines.push('');
  if (!precise) {
    lines.push(
      '> The editor was not running when this was assembled, so this list is the',
      "> working tree's changes rather than the editor's own write log.",
      '',
    );
  }
  return lines.join('\n');
}

// --- guardrails --------------------------------------------------------------
//
// IMPORTED FOR ITS HELPERS, RUN FOR ITS EFFECT. `scripts/test/` reaches
// `parsePorcelain` and `defaultBody` above; nothing below this line may execute on
// import, or a unit test would open a pull request.
// IMPORTED FOR ITS HELPERS, RUN FOR ITS EFFECT. `scripts/test/` reaches
// `parsePorcelain` and `defaultBody` above; nothing below may execute on import, or
// a unit test would open a pull request.
if (process.argv[1] === fileURLToPath(import.meta.url)) await main();

async function main() {
  if (!has('git')) {
  stop('git is not installed.', 'Install it from https://git-scm.com, then run this again.');
}

const changes = await readChanges();
if (!changes.files.length) {
  stop(
    'Nothing has changed.',
    'Open the editor with `pnpm design`, change something, press Save to Code, then run this again.',
  );
}

// ONLY WHAT THE EDITOR TOUCHED. The working tree may hold unrelated work, and
// sweeping it into someone's pull request is the kind of surprise that ends trust
// in a tool. Reported, never committed.
const unrelated = changes.precise ? changedPaths().filter((f) => !changes.files.includes(f)) : [];

  const branchNow = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch =
    value('branch') ??
    (PROTECTED.has(branchNow) || !branchNow.startsWith('design/')
      ? `design/${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 7)}`
      : branchNow);

  /*
   * CHECKED ON THE RESOLVED NAME, not on the branch we happen to be standing on.
   *
   * The guard used to live in the expression above, which only decides what to do
   * when NO `--branch` was given. `--branch main` while already on `main` walked
   * straight past it: the names matched, so the checkout below was skipped and the
   * commit landed on `main` — the one thing this script promises never to do.
   */
  if (PROTECTED.has(branch)) {
    stop(
      `Refusing to commit to \`${branch}\`.`,
      'Pass a different --branch, or drop the flag and one will be made for you.',
    );
  }

const title = value('title') ?? `Design changes${changes.labels[0] ? `: ${changes.labels[0]}` : ''}`;
const body = value('body-file') ? readFileSync(value('body-file'), 'utf8') : defaultBody(changes);

say('');
say(`\x1b[1mWhat this will do\x1b[0m`);
say(`  branch   ${branch}${branch === branchNow ? ' (the one you are on)' : ' (new)'}`);
say(`  commit   ${changes.files.length} file${changes.files.length === 1 ? '' : 's'}`);
for (const f of changes.files) say(`             ${f}`);
say(`  title    ${title}`);
if (unrelated.length) {
  say('');
  warn(`${unrelated.length} other changed file${unrelated.length === 1 ? '' : 's'} will be LEFT ALONE:`);
  for (const f of unrelated) say(`    ${f}`);
}
  if (!changes.precise) {
    say('');
    if (changes.reached) {
      warn(`The editor at ${changes.reached} has written nothing yet — this is the working tree.`);
      say('  Press Save to Code in the editor and approve it, then run this again.');
    } else {
      warn(
        `Could not reach a running editor at ${(changes.tried ?? []).join(' or ')} — this is the` +
          " working tree rather than the editor's own write log.",
      );
      say('  If it is running elsewhere, pass --server <url> and run this again.');
    }
  }
say('');

if (DRY) {
  ok('Dry run — nothing was changed.');
  process.exit(0);
}

// --- rung 0 → 3 --------------------------------------------------------------
const remote = gitTry(['remote', 'get-url', 'origin']);
if (!remote) {
  stop(
    'This clone has no `origin` remote, so there is nowhere to push.',
    'Add one with `git remote add origin <url>`, then run this again.',
  );
}

/*
 * WHO THE COMMIT WILL BE FROM, checked before anything is created.
 *
 * git refuses to commit without `user.name` and `user.email`, and on a machine
 * that has never had them set globally that is the state of every fresh clone —
 * which is exactly the person this ladder is for. Asked here, after the plan has
 * printed and before the branch exists, so a stop leaves the tree untouched.
 *
 * Never filled in with a guess: a commit attributed to someone who did not choose
 * the name is worse than one that did not happen.
 */
const missingIdentity = ['user.name', 'user.email'].filter((k) => !gitTry(['config', '--get', k]));
if (missingIdentity.length) {
  stop(
    `git does not know who you are yet (no ${missingIdentity.join(' or ')}), so it cannot commit.`,
    'Run these once, with your own name and address:\n' +
      '\n    git config --global user.name "Your Name"' +
      '\n    git config --global user.email "you@example.com"\n' +
      '\n  Then run this again.',
  );
}

step(`creating ${branch}…`);
if (branch !== branchNow) git(['checkout', '-b', branch]);
git(['add', '--', ...changes.files]);
// `--only` so a pre-staged unrelated file cannot ride along: the paths above are
// the whole commit, whatever else the index holds.
git(['commit', '--only', '--no-verify', '-m', title, '-m', body, '--', ...changes.files]);
ok(`committed ${changes.files.length} file${changes.files.length === 1 ? '' : 's'}`);

const upstream = ghJson(['repo', 'view', '--json', 'nameWithOwner,viewerPermission,parent']);
const canPush = upstream && ['WRITE', 'MAINTAIN', 'ADMIN'].includes(upstream.viewerPermission);
const baseRepo = upstream?.parent?.nameWithOwner ?? upstream?.nameWithOwner ?? null;
const ghReady = has('gh') && spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' }).status === 0;

/** Push, and report the rung rather than a stack trace when it is refused. */
function push(toRemote) {
  const r = spawnSync('git', ['push', '--no-verify', '-u', toRemote, branch], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  return r.status === 0;
}

if (!ghReady) {
  // RUNG 1 — a browser is enough. GitHub's compare page opens a PR form
  // pre-filled from the branch, so `gh auth login` is not on the critical path.
  step('`gh` is not set up — using the browser instead…');
  if (!push('origin')) {
    stop(
      'The push was refused, so there is no branch to open a pull request from.',
      'You probably need your own fork. Install the GitHub CLI (https://cli.github.com) and run this again — it can make one for you.',
    );
  }
  const web = remote.replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git$/, '');
  const url = `${web}/compare/${branch}?expand=1`;
  ok('branch pushed');
  say(`\n  Open this to finish the pull request:\n  \x1b[4m${url}\x1b[0m\n`);
  openBrowser(url);
  process.exit(0);
}

if (!canPush) {
  // RUNG 2 — no write access, so the branch has to live on a fork of their own.
  step('you do not have push access here — creating a fork…');
  const forked = spawnSync('gh', ['repo', 'fork', '--remote', '--remote-name', 'fork'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  if (forked.status !== 0) stop('Could not create a fork.', 'Scroll up for the reason.');
  if (!push('fork')) stop('Could not push to the fork.', 'Scroll up for the reason.');
} else if (!push('origin')) {
  stop('The push was refused.', 'Scroll up for the reason.');
}
ok('branch pushed');

// RUNG 2 and 3 both land here: the PR is opened against the base repo explicitly,
// because a fork's `gh pr create` would otherwise target the fork itself.
const prArgs = ['pr', 'create', '--title', title, '--body', body, '--base', value('base') ?? 'main'];
if (baseRepo) prArgs.push('--repo', baseRepo);
const pr = spawnSync('gh', prArgs, { cwd: ROOT, encoding: 'utf8' });
if (pr.status !== 0) {
  warn('The branch is pushed, but `gh pr create` failed:');
  say(pr.stderr.trim());
  say(`\n  Finish it here: \x1b[4m${(baseRepo ? `https://github.com/${baseRepo}` : '')}/compare/${branch}?expand=1\x1b[0m\n`);
  process.exit(1);
}
const url = pr.stdout.trim().split('\n').pop();
ok(`pull request opened — \x1b[4m${url}\x1b[0m`);
openBrowser(url);

}

function openBrowser(url) {
  const cmd =
    process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : ['xdg-open', [url]];
  try {
    execFileSync(cmd[0], cmd[1], { stdio: 'ignore' });
  } catch {
    /* no desktop — the URL is printed above */
  }
}
