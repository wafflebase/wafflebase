// Tests for the frontend chunk gate's eager-entry budget.
//
// Runs against a planted `dist` under the OS temp directory, created per test
// and removed after; nothing reads the repository's real build output.

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  eagerScriptPaths,
  measureEagerScripts,
} from '../verify-frontend-chunks.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// The shape Vite writes, including the tags the gate must NOT count: an
// inline classic script, a third-party async script, and a stylesheet.
const HTML = `<!DOCTYPE html>
<html><head>
  <script type="text/javascript">(function(){})()</script>
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-1"></script>
  <script type="module" crossorigin src="/assets/index-AAA.js"></script>
  <link rel="modulepreload" crossorigin href="/assets/vendor-react-BBB.js">
  <link rel="modulepreload" crossorigin href="/assets/vendor-app-CCC.js">
  <link rel="modulepreload" crossorigin href="/assets/vendor-react-BBB.js">
  <link rel="modulepreload" href="//cdn.example.com/x.js">
  <link rel="stylesheet" crossorigin href="/assets/index-DDD.css">
</head><body><div id="root"></div></body></html>`;

async function withDist(files, body) {
  const dir = mkdtempSync(path.join(tmpdir(), 'wb-chunks-'));
  try {
    mkdirSync(path.join(dir, 'assets'));
    for (const [rel, content] of Object.entries(files)) {
      writeFileSync(path.join(dir, rel), content);
    }
    return await body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('eagerScriptPaths: the entry module plus each modulepreload, once', () => {
  assert.deepEqual(eagerScriptPaths(HTML), [
    'assets/index-AAA.js',
    'assets/vendor-react-BBB.js',
    'assets/vendor-app-CCC.js',
  ]);
});

test('eagerScriptPaths: an inline module script has nothing to count', () => {
  assert.deepEqual(
    eagerScriptPaths('<script type="module">import("/x.js")</script>'),
    [],
  );
});

test('measureEagerScripts: sums the referenced files in kB', async () => {
  await withDist(
    {
      'index.html': HTML,
      'assets/index-AAA.js': 'x'.repeat(1000),
      'assets/vendor-react-BBB.js': 'x'.repeat(2500),
      'assets/vendor-app-CCC.js': 'x'.repeat(500),
      // Present on disk but lazy: must not count.
      'assets/slides-editor-engine-EEE.js': 'x'.repeat(700_000),
      'assets/index-DDD.css': 'x'.repeat(9000),
    },
    async (dir) => {
      const { scripts, totalKb } = await measureEagerScripts(dir);
      assert.equal(scripts.length, 3);
      assert.equal(totalKb, 4);
    },
  );
});

test('measureEagerScripts: a preloaded engine chunk is what the budget catches', async () => {
  const html = HTML.replace(
    '<link rel="stylesheet"',
    '<link rel="modulepreload" crossorigin href="/assets/slides-editor-engine-EEE.js">\n  <link rel="stylesheet"',
  );
  await withDist(
    {
      'index.html': html,
      'assets/index-AAA.js': 'x'.repeat(1000),
      'assets/vendor-react-BBB.js': 'x'.repeat(2500),
      'assets/vendor-app-CCC.js': 'x'.repeat(500),
      'assets/slides-editor-engine-EEE.js': 'x'.repeat(700_000),
    },
    async (dir) => {
      const { totalKb } = await measureEagerScripts(dir);
      assert.equal(totalKb, 704);
    },
  );
});

test('measureEagerScripts: a missing referenced file rejects', async () => {
  await withDist({ 'index.html': HTML }, async (dir) => {
    await assert.rejects(measureEagerScripts(dir));
  });
});

test('harness.config.json configures a positive eager budget', () => {
  const config = JSON.parse(
    readFileSync(path.join(repoRoot, 'harness.config.json'), 'utf8'),
  );
  const limit = config.frontend.chunkBudgets.maxEagerKb;
  assert.equal(typeof limit, 'number');
  assert.ok(limit > 0);
  assert.equal(typeof config.frontend.chunkBudgets.maxEagerKbReason, 'string');
});
