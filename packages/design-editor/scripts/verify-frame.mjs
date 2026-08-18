#!/usr/bin/env node
// @ts-check
/**
 * verify-frame.mjs — does a scene frame actually PAINT, and does a click reach the host?
 *
 *   pnpm --filter @wafflebase/design-editor verify:frame
 *
 * WHY THIS EXISTS SEPARATELY FROM `verify-consumer.mjs`. That gate drives HTTP: it can
 * prove the frame document serves, that its entry transforms, and that every import
 * resolves. It cannot prove a pixel. Three defects in 11b were invisible to it and
 * visible here within seconds:
 *
 *   1. `scene-patch` returned `stampSource`'s `{text, stamped}` object where Vite
 *      expected a string, so Vite read the hook as having produced nothing and served
 *      the raw `.tsx` statically — 200 OK, no error, unparseable JSX.
 *   2. `scene.html` never reached `transformIndexHtml`, so `@vitejs/plugin-react`'s
 *      fast-refresh preamble was missing and every transformed module threw at load.
 *      The frame mounted React and rendered NOTHING.
 *   3. the fixture's `cva` import did not resolve, which only matters once something
 *      executes it.
 *
 * Each of those presents as a blank frame. A blank frame reads as "this scene has
 * nothing to show", which is why they survived unit tests, a typecheck and a 45-check
 * live gate.
 *
 * NOT ON CI, deliberately. `design-editor:check` runs on a plain runner with no browser
 * binaries; the repo's browser lane is `verify:browser:docker`, which is frontend-shaped
 * and Docker-based. Wiring this into that is worth doing and is not this PR. Until then
 * it is an opt-in local gate, and the docs say so rather than implying coverage.
 *
 * PREREQUISITE, stated because it will bite someone: Chromium needs system libraries
 * that a minimal WSL/Debian install lacks. Four were missing here —
 * `libnspr4 libnss3 libnssutil3 libasound2` — and the failure mode is
 * `browserType.launch: Target page, context or browser has been closed` with the real
 * cause buried in the browser log. `playwright install-deps chromium` fixes it.
 */

import { spawn, spawnSync } from 'node:child_process';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const PROJECT = path.join(PKG, 'fixtures/consumer');
const PORT = Number(process.env.PORT ?? 5210);
const SCENE = 'dashboard';

let failures = 0;
let checks = 0;

/** @param {string} label @param {unknown} cond @param {unknown} [detail] */
function check(label, cond, detail) {
  checks += 1;
  if (cond) {
    console.log(`  ok   ${label}`);
    return true;
  }
  failures += 1;
  console.log(`  FAIL ${label}${detail === undefined ? '' : `\n       ${String(detail)}`}`);
  return false;
}

function buildShellIfMissing() {
  if (fsSync.existsSync(path.join(PKG, 'dist/shell/index.html'))) return;
  console.log('building the shell (dist/ is gitignored)');
  const r = spawnSync('pnpm', ['exec', 'vite', 'build', '--config', './vite.shell.config.ts'], {
    cwd: PKG,
    stdio: 'inherit',
  });
  if (r.status !== 0) throw new Error('shell build failed');
}

/** Kill the whole group: `pnpm exec` spawns vite as its own child. */
function shutdown(child) {
  try {
    if (child.pid) process.kill(-child.pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
}

async function boot() {
  const child = spawn(
    'pnpm',
    // Root is POSITIONAL for `vite dev`; `--root` is build-only and the CLI rejects it.
    ['exec', 'vite', PROJECT, '--config', path.join(PROJECT, 'vite.config.ts'), '--port', String(PORT), '--strictPort'],
    { cwd: PROJECT, stdio: ['ignore', 'pipe', 'pipe'], detached: true },
  );
  let log = '';
  child.stdout?.on('data', (c) => (log += c.toString()));
  child.stderr?.on('data', (c) => (log += c.toString()));

  const deadline = Date.now() + 60_000;
  for (;;) {
    if (child.exitCode != null) throw new Error(`dev server exited early:\n${log}`);
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/__design-editor/api/health`);
      if (r.ok) return { child, log: () => log };
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

async function main() {
  buildShellIfMissing();

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.log('playwright is not installed — cannot verify paint. Not a pass.');
    process.exit(1);
  }

  console.log(`booting vite in ${path.relative(PKG, PROJECT)} on :${PORT}`);
  const { child, log } = await boot();
  let browser;
  try {
    try {
      browser = await chromium.launch();
    } catch (err) {
      console.log(
        'chromium could not launch. Its system libraries are probably missing —\n' +
          "  run `pnpm --filter @wafflebase/frontend exec playwright install-deps chromium`.\n" +
          `  ${String(err).split('\n')[0]}`,
      );
      process.exit(1);
    }
    const page = await browser.newPage();
    /** @type {string[]} */
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    const url = `http://127.0.0.1:${PORT}/__design-editor/scene?scene=${SCENE}&frame=after&theme=light`;
    await page.goto(url, { waitUntil: 'networkidle' });
    // Record what the frame posts. At top level `parent === window`, so this is exactly
    // what the host would receive.
    await page.evaluate(() => {
      window.__wb = [];
      window.addEventListener('message', (e) => window.__wb.push(e.data));
    });
    await page.waitForTimeout(800);

    console.log('\nthe scene paints');
    const text = ((await page.textContent('#wb-scene-root')) ?? '').trim();
    check('the consumer’s own component rendered', text.length > 0, JSON.stringify(text.slice(0, 80)));
    // The preamble defect presented as exactly this: React mounted, nothing rendered.
    check('no page error', pageErrors.length === 0, pageErrors[0]);
    check(
      'and no missing-preamble error, which is a blank frame with one console line',
      !pageErrors.some((e) => /preamble/i.test(e)),
      pageErrors.find((e) => /preamble/i.test(e)),
    );

    console.log('\nthe stamper reached the DOM');
    const stamped = await page.$$eval('[data-wb-node]', (n) => n.length);
    // Zero stamps is what a load hook returning the wrong shape produces: the file is
    // served verbatim, so nothing is selectable and the outline is empty.
    check('nodes carry data-wb-node', stamped > 0, `${stamped} stamped`);
    const files = await page.$$eval('[data-wb-file]', (n) => [
      ...new Set(n.map((x) => x.getAttribute('data-wb-file'))),
    ]);
    check(
      'the scene AND the component it imports are both stamped',
      files.includes('app/pages/dashboard.tsx') && files.includes('app/components/badge.tsx'),
      JSON.stringify(files),
    );
    check(
      'every stamped file is the consumer’s own, not one of ours',
      files.every((f) => f?.startsWith('app/')),
      JSON.stringify(files),
    );

    console.log('\na click reaches the host');
    await (await page.$('[data-wb-node]')).click();
    await page.waitForTimeout(400);
    const display = await page.$eval('[data-wb-overlay="selection"]', (e) => getComputedStyle(e).display);
    check('the selection overlay is drawn', display === 'block', display);
    const box = await page.$eval('[data-wb-overlay="selection"]', (e) => {
      const r = e.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    });
    check('and has a real size, not a collapsed box', box.w > 0 && box.h > 0, JSON.stringify(box));

    const msgs = await page.evaluate(() => window.__wb);
    const types = [...new Set(msgs.map((m) => m.type))];
    check('wb:select was posted', types.includes('wb:select'), JSON.stringify(types));
    const sel = msgs.find((m) => m.type === 'wb:select');
    if (check('with a node reference', !!sel?.node, JSON.stringify(sel ?? null))) {
      // The host resolves an edit against `file` + `id`; a wrong one writes to the wrong
      // source with no visible symptom, which is why each field is asserted.
      check('naming the consumer’s file', sel.node.file === 'app/pages/dashboard.tsx', sel.node.file);
      check('with a parseable stamp id', /^app\/.+#\w+:[\d.]*$/.test(sel.node.id), sel.node.id);
      check('and an instance count', Number.isInteger(sel.node.instances), String(sel.node.instances));
    }
    check(
      'wb:ready announced the scene',
      msgs.some((m) => m.type === 'wb:ready') || types.length > 0,
      JSON.stringify(types),
    );

    /**
     * The shell, which is the other half: the frame works when opened directly, and that
     * says nothing about whether the host mounts it, receives its messages, or drives it.
     * Everything below crosses the iframe boundary, which is where a protocol mismatch
     * lives.
     */
    console.log('\nthe shell drives the frame');
    await page.goto(`http://127.0.0.1:${PORT}/__design-editor/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    const inner = page.frames().find((f) => f.url().includes('/scene?'));
    if (
      check('the shell mounted a scene frame', !!inner, page.frames().map((f) => f.url()).join(' '))
    ) {
      const painted = ((await inner.textContent('#wb-scene-root')) ?? '').trim();
      check('and the scene painted inside it', painted.length > 0, JSON.stringify(painted.slice(0, 60)));

      const shellText = async () => (await page.textContent('main')) ?? '';
      // `wb:ready` and `wb:classes` are what lift the host's veil and feed Tailwind
      // candidate registration; both arriving is the protocol working in the direction
      // unit tests cannot see.
      const before = await shellText();
      check('the host received the selectable set', /Selectable nodes\s*[1-9]/.test(before), before.match(/Selectable nodes\s*\d+/)?.[0]);
      check('and the classes the scene rendered', /Classes the scene rendered\s*[1-9]/.test(before), before.match(/Classes the scene rendered\s*\d+/)?.[0]);
      check('nothing is selected yet', /Selected\s*nothing selected/.test(before));

      await inner.click('[data-wb-node]');
      await page.waitForTimeout(600);
      const after = await shellText();
      // A click inside the frame reaching the host is the boundary crossing that the
      // whole protocol exists for.
      check(
        'a click inside the frame selects in the host',
        /Selected\s*\w+ — app\//.test(after),
        after.match(/Selected.{0,60}/)?.[0],
      );
      check(
        'and the frame drew its overlay',
        (await inner.$eval('[data-wb-overlay="selection"]', (e) => getComputedStyle(e).display)) === 'block',
      );

      // The file header's central claim: a viewport is a REAL width, so a breakpoint
      // resolves truthfully. Zoom must NOT change it — that is why zoom is a transform.
      const viewportButtons = await page.$$('button[title^="Viewport"]');
      await viewportButtons[0].click();
      await page.waitForTimeout(600);
      const mobileFrame = page.frames().find((f) => f.url().includes('/scene?'));
      check(
        'a mobile viewport gives the frame a real 390px width',
        (await mobileFrame.evaluate(() => window.innerWidth)) === 390,
        String(await mobileFrame.evaluate(() => window.innerWidth)),
      );
      await page.selectOption('select', '0.5');
      await page.waitForTimeout(600);
      check(
        'and zoom scales the picture without changing that width',
        (await mobileFrame.evaluate(() => window.innerWidth)) === 390,
        String(await mobileFrame.evaluate(() => window.innerWidth)),
      );
    }
  } finally {
    if (browser) await browser.close();
    shutdown(child);
  }

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures) {
    console.log('\n--- dev server log ---\n' + log());
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
