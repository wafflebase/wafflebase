// @ts-check
/**
 * build-if-stale.mjs — build the package's two artefacts when either is missing OR
 * older than the source it came from. Shared by every gate in this package that boots
 * something which reads `dist/`.
 *
 * WHY IT IS SHARED RATHER THAN COPIED. It was copied, and the copy diverged in exactly
 * the way a copy does: `verify-consumer.mjs` learned to build BOTH artefacts when #966
 * moved `exports["."]` from source to `dist/plugin/index.js`, and `verify-frame.mjs`
 * kept rebuilding only the shell — while booting the same fixture project, whose
 * `vite.config.ts` imports this package BY NAME. One helper is what stops the next
 * consumer from being left behind again.
 *
 * BOTH ARTEFACTS, not just the shell. `dist/shell` is what the mount point serves;
 * `dist/plugin/index.js` is what a `@wafflebase/design-editor` import resolves to.
 * Rebuilding only the shell left a clean checkout failing on `Cannot find module` —
 * which reads as a broken fixture rather than as a missing build — and a dirty one
 * running every check against plugin bytes older than the change under test.
 *
 * MISSING-ONLY SERVED STALE BYTES, twice. It cost an hour in `verify:frame`, and in
 * `verify-consumer.mjs` it meant stylesheet checks passing against a bundle built
 * before the change under test — including, on the run that added them, a fix they were
 * written to prove. A gate that can pass on stale bytes is worse than no gate, because
 * its green is not evidence.
 *
 * NOTHING IN CI RUNS THESE SCRIPTS — they boot a dev server, so they are out of
 * `verify:fast` / `verify:self` and out of the lane graph. `design-editor:build`
 * therefore guarantees them nothing; the caller is a person, and "remember to build
 * first" is not a contract a gate can rest its verdict on.
 */

import { spawnSync } from 'node:child_process';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Everything the two artefacts are built from. */
const ARTEFACTS = ['dist/shell/index.html', 'dist/plugin/index.js'];

/** The newest mtime under `src/`, plus the two build configs — a change to either
 *  decides what goes in, so it invalidates the output as surely as a source edit. */
function newestSourceMtime() {
  let newest = 0;
  const walk = (dir) => {
    for (const e of fsSync.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else newest = Math.max(newest, fsSync.statSync(full).mtimeMs);
    }
  };
  walk(path.join(PKG, 'src'));
  for (const config of ['vite.shell.config.ts', 'tsconfig.build.json']) {
    newest = Math.max(newest, fsSync.statSync(path.join(PKG, config)).mtimeMs);
  }
  return newest;
}

/**
 * Build the shell and the plugin when either is stale. No-op when both are current.
 *
 * @param {(msg: string) => void} [log]
 */
export function buildDesignEditorIfStale(log = console.log) {
  const newest = newestSourceMtime();
  const outdated = ARTEFACTS.filter((rel) => {
    const artefact = path.join(PKG, rel);
    return !fsSync.existsSync(artefact) || fsSync.statSync(artefact).mtimeMs < newest;
  });
  if (outdated.length === 0) return;
  log(`building the shell and the plugin (${outdated.join(', ')} missing or older than src/)`);
  // The package's own `build`, so the two halves can never drift apart here.
  const r = spawnSync('pnpm', ['run', 'build'], { cwd: PKG, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('design-editor build failed');
}
