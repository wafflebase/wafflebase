#!/usr/bin/env node
// Assert every engine package's published type entry actually resolves.
//
// The engine packages emit declarations with `tsc -p tsconfig.build.json`
// into the same `dist/` that vite's `emptyOutDir` wipes at the start of each
// build. Two builds of one package racing (a `git push` running
// `verify:self` while `pnpm build` is going, say) can leave `dist/` with an
// entry `.d.ts` whose relative re-exports point at files that are no longer
// there.
//
// Nothing else catches that: every consumer tsconfig sets
// `skipLibCheck: true`, so a dangling declaration graph silently degrades to
// `any` and `slides`/`backend`/`cli` still typecheck green. `npm-publish.yml`
// does not run `typecheck` at all.
//
// So: walk each declared `types` entry, follow every relative specifier
// transitively, and fail on the first one that does not resolve.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const ALL_PACKAGES = ['core', 'docs', 'sheets', 'slides', 'notes', 'board'];

// Named packages are REQUIRED: a missing `dist/` is a failure. With no
// arguments every package is checked, but one that was never built is
// skipped rather than failed — `verify:self` and `npm-publish.yml` each
// build only the subset they need, and their own build lanes are what fail
// loudly when a build breaks.
const requested = process.argv.slice(2);
const PACKAGES = requested.length > 0 ? requested : ALL_PACKAGES;
const REQUIRE_BUILT = requested.length > 0;

const unknown = PACKAGES.filter((p) => !ALL_PACKAGES.includes(p));
if (unknown.length > 0) {
  console.error(`Unknown package(s): ${unknown.join(', ')}`);
  console.error(`Known: ${ALL_PACKAGES.join(', ')}`);
  process.exit(1);
}

// `import ... from 'x'`, `export ... from 'x'`, `import('x')`, `export * from
// 'x'`, and `import X = require('x')`.
const SPECIFIER_RE = /(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g;

// `/// <reference path="x" />`. tsc does not emit these for the current
// sources (0 across 517 emitted declarations), but a missed edge here is
// silent under-reporting, which is the exact failure this script exists to
// prevent — so cover the form rather than the current output.
const REFERENCE_PATH_RE = /\/\/\/\s*<reference\s+path\s*=\s*['"]([^'"]+)['"]/g;

/** Every `types` path a consumer can land on, keyed by where it came from. */
function declaredTypeEntries(pkgDir) {
  const manifest = JSON.parse(readFileSync(`${pkgDir}/package.json`, 'utf8'));
  const entries = [];
  if (manifest.types) entries.push([`types`, manifest.types]);

  const walkExports = (node, path) => {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'types' && typeof value === 'string') {
        entries.push([`exports${path}.types`, value]);
      } else {
        walkExports(value, `${path}.${key}`);
      }
    }
  };
  walkExports(manifest.exports, '');

  return entries;
}

/** Resolve a relative specifier the way TypeScript would, for `.d.ts` only. */
function resolveDeclaration(fromFile, specifier) {
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [
    base.endsWith('.d.ts') ? base : null,
    base.endsWith('.js') ? base.replace(/\.js$/, '.d.ts') : null,
    `${base}.d.ts`,
    `${base}/index.d.ts`,
  ].filter(Boolean);
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

const failures = [];

for (const pkg of PACKAGES) {
  const pkgDir = `packages/${pkg}`;

  if (!existsSync(`${pkgDir}/dist`)) {
    if (REQUIRE_BUILT) {
      failures.push(`${pkg}: dist/ does not exist — the package was not built`);
    } else {
      console.log(`  skip  ${pkg} (no dist/ — not built)`);
    }
    continue;
  }

  const entries = declaredTypeEntries(pkgDir);

  if (entries.length === 0) {
    failures.push(`${pkg}: package.json declares no type entry at all`);
    continue;
  }

  for (const [field, relativePath] of entries) {
    const entryFile = resolve(pkgDir, relativePath);
    if (!existsSync(entryFile)) {
      failures.push(`${pkg} ${field}: ${relativePath} does not exist`);
      continue;
    }

    // Walk the declaration graph reachable from this entry.
    const seen = new Set([entryFile]);
    const queue = [entryFile];
    while (queue.length > 0) {
      const file = queue.pop();
      const source = readFileSync(file, 'utf8');
      const edges = [
        ...source.matchAll(SPECIFIER_RE),
        ...source.matchAll(REFERENCE_PATH_RE),
      ];
      for (const match of edges) {
        const specifier = match[1];
        if (!specifier.startsWith('.')) continue; // bare import: consumer's problem
        const resolved = resolveDeclaration(file, specifier);
        if (!resolved) {
          const from = file.replace(`${process.cwd()}/`, '');
          failures.push(
            `${pkg} ${field}: "${specifier}" in ${from} does not resolve — ` +
              `dist is missing declarations (rebuild the package)`,
          );
          continue;
        }
        if (!seen.has(resolved)) {
          seen.add(resolved);
          queue.push(resolved);
        }
      }
    }

    console.log(`  ok  ${pkg} ${field} → ${relativePath} (${seen.size} files)`);
  }
}

if (failures.length > 0) {
  console.error('\nBroken type entries:\n');
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  console.error('');
  process.exit(1);
}

console.log('\nAll engine type entries resolve.');
