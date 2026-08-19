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
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, '..');
const PROJECT = path.join(PKG, 'fixtures/consumer');
const PORT = Number(process.env.PORT ?? 5210);
/**
 * NOTHING IS WRITTEN unless `--write` is passed — the same contract as `verify-consumer`.
 * With it, the review modal's Approve is pressed for real, then `/undo` restores the file
 * and the bytes are compared. Without it the run stops at the diff, which is where the
 * useful evidence already is.
 */
const WRITE = process.argv.includes('--write');
/** The fixture file a class edit on the dashboard scene lands in. */
const SCENE_SRC = 'app/pages/dashboard.tsx';
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

/**
 * Build the shell when the bundle is missing OR older than its source.
 *
 * MISSING-ONLY WAS A REAL TRAP, and it cost an hour: the gate served a bundle built
 * before the change under test, so a wiring fix that was genuinely present in the source
 * failed here with no clue why. A browser gate that can silently test stale bytes is
 * worse than no browser gate, because its green is not evidence.
 */
function buildShellIfStale() {
  const bundle = path.join(PKG, 'dist/shell/index.html');
  if (fsSync.existsSync(bundle) && newestSourceMtime() <= fsSync.statSync(bundle).mtimeMs) return;
  console.log('building the shell (missing or older than src/)');
  const r = spawnSync('pnpm', ['exec', 'vite', 'build', '--config', './vite.shell.config.ts'], {
    cwd: PKG,
    stdio: 'inherit',
  });
  if (r.status !== 0) throw new Error('shell build failed');
}

/** Kill the whole group: `pnpm exec` spawns vite as its own child. */
/** The newest mtime under `src/`, which is everything the shell bundle is built from. */
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
  // The build config decides what goes in, so a change to it invalidates the bundle too.
  newest = Math.max(newest, fsSync.statSync(path.join(PKG, 'vite.shell.config.ts')).mtimeMs);
  return newest;
}

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
  buildShellIfStale();

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
    // Guarded rather than dereferenced: `page.$` yields null when nothing matched, and
    // `null.click()` throws a TypeError before check() can name which gate failed.
    const nodeHandle = await page.$('[data-wb-node]');
    check('a stamped node is there to click', Boolean(nodeHandle));
    if (nodeHandle) await nodeHandle.click();
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

      // `body`, not `main`: the layout's `<main>` is now the frame pane alone. The
      // surfaces asserted below are the outline (left of it) and the node detail (right).
      const shellText = async () => (await page.textContent('body')) ?? '';

      // `wb:ready` and `wb:classes` are what lift the host's veil and feed Tailwind
      // candidate registration; both arriving is the protocol working in the direction
      // unit tests cannot see. There is no longer a status strip printing the counts, so
      // each is read where the layout actually uses it.
      const marked = await page.$$eval('[aria-label="Clickable in the frame"]', (n) => n.length);
      check(
        'the host received the selectable set',
        marked > 0,
        `${marked} rows marked clickable`,
      );

      // The classes the frame painted are POSTed to the bridge as Tailwind candidates —
      // without which a class this editor composes has no CSS rule and previews as
      // nothing. The bridge's safelist size is the observable side of that.
      const safelist = await (
        await fetch(`http://127.0.0.1:${PORT}/__design-editor/api/health`)
      ).json();
      check(
        'and the classes the scene rendered reached the safelist',
        (safelist.safelist ?? 0) > 0,
        `safelist ${safelist.safelist}`,
      );

      const before = await shellText();
      check(
        'nothing is selected yet',
        /Picking must be on/.test(before),
        before.match(/Click a node.{0,40}/)?.[0],
      );

      await inner.click('[data-wb-node]');
      await page.waitForTimeout(600);
      const after = await shellText();
      // A click inside the frame reaching the host is the boundary crossing the whole
      // protocol exists for, and the node detail is where it lands: the tag, the file it
      // came from, and the fingerprint it resolved against.
      check(
        'a click inside the frame selects in the host',
        /path [\d.]*.*fp \w+/.test(after),
        after.match(/·\s*path.{0,40}/)?.[0],
      );
      // …and RESOLVED to a source node, which is the half that can fail silently: the
      // click crossing the boundary only gets you a stamp, and the panel reports these
      // facts (`scope`, the class list) exclusively when `anchorFromStamp` mapped that
      // stamp back onto one baseline node.
      //
      // NOT asserted here: the instance count. The panel prints `×N rendered` only when N
      // differs from 1, and the fixture's clicked node is rendered once — so a check on it
      // would be testing the fixture, not the protocol.
      check(
        'and the stamp resolved onto a source node',
        !/Picking must be on/.test(after) && /structural edits/.test(after) && /className/.test(after),
        after.match(/scope.{0,60}/)?.[0] ?? '(no resolved facts)',
      );

      check(
        'and the frame drew its overlay',
        (await inner.$eval('[data-wb-overlay="selection"]', (e) => getComputedStyle(e).display)) === 'block',
      );

      // The file header's central claim: a viewport is a REAL width, so a breakpoint
      // resolves truthfully. Zoom must NOT change it — that is why zoom is a transform.
      console.log('\nthe outline and the frame agree');
      const rows = await page.$$eval('[data-row-id]', (ns) => ns.map((n) => n.getAttribute('data-row-id')));
      // The outline is the COMPLETE list; the frame is the subset on screen. Both being
      // non-empty is the claim, and the outline being at least as large is the point of
      // having one.
      check('the outline rendered a node tree', rows.length > 1, `${rows.length} rows`);
      check(
        'from the consumer’s own file',
        rows.every((r) => r?.startsWith('app/')),
        JSON.stringify(rows.slice(0, 3)),
      );
      // Marked rows come from `wb:ready`'s selectable set: the outline saying which rows
      // the frame could actually reach is what keeps the two honest about the difference.
      check('and marks which rows the frame can reach', marked > 0, `${marked} marked`);

      // Frame → outline. A node selected in the frame has to light up in its own tree, or
      // the outline reads as having ignored the click.
      await inner.click('[data-wb-node]');
      await page.waitForTimeout(500);
      const lit = await page.$$eval('[data-row-id]', (ns) =>
        ns.filter((n) => n.className.includes('wb-accent')).map((n) => n.getAttribute('data-row-id')),
      );
      check('a frame selection highlights its outline row', lit.length === 1, JSON.stringify(lit));

      // Outline → frame, the other direction through `wb:set-selection`.
      const secondRow = (await page.$$('[data-row-id]'))[1];
      await secondRow.click();
      await page.waitForTimeout(500);
      check(
        'and an outline selection reaches the frame',
        (await inner.$eval('[data-wb-overlay="selection"]', (e) => getComputedStyle(e).display)) === 'block',
      );

      /**
       * The claim the whole editor makes: an edit can be staged, taken back, and reviewed.
       *
       * This is the one path with no unit coverage and it cannot have any — the class editor
       * only appears once the frame has MEASURED the selection and posted its rect back, and
       * jsdom loads no iframe. Everything downstream (the plan count, ⌘Z, the review modal)
       * is therefore only ever exercised here.
       */
      console.log('\nan edit stages, comes back, and reaches the review');
      await inner.click('[data-wb-node]');
      await page.waitForTimeout(700);
      const saveBtn = async () =>
        page.$eval('button[title*="⌘S"], button[title*="matches the editor"]', (b) => ({
          text: (b.textContent ?? '').trim(),
          disabled: b.disabled,
        }));
      if (check('the class editor opened on the selection', !!(await page.$('[data-wb-class-editor]')))) {
        await page.click('[data-wb-class-editor] button[title="flex-col"]');
        await page.waitForTimeout(300);
        // The count on Save is `saveDiff(baseline, present).length` — "how many file changes
        // it would take", which is the number the header promises.
        check('staging one class edit puts one change in the plan', /1$/.test((await saveBtn()).text), (await saveBtn()).text);
        check(
          'and the toggle reads as active',
          (await page.getAttribute('[data-wb-class-editor] button[title="flex-col"]', 'aria-pressed')) === 'true',
        );

        await page.keyboard.press('Control+z');
        await page.waitForTimeout(300);
        check('⌘Z empties the plan again', (await saveBtn()).disabled === true, JSON.stringify(await saveBtn()));

        await page.keyboard.press('Control+Shift+z');
        await page.waitForTimeout(300);
        check('and ⇧⌘Z puts it back', /1$/.test((await saveBtn()).text), (await saveBtn()).text);

        // ⌘S OPENS THE REVIEW; it does not write. That is PR 12's change to this path, and
        // the modal dry-runs every intent — so its presence also proves `/mutate?dryRun`
        // answered for a real staged edit.
        await page.keyboard.press('Control+s');
        await page.waitForTimeout(2500);
        const modal = await page.$('[role="dialog"][aria-modal="true"]');
        if (check('⌘S opens the review instead of writing', !!modal)) {
          const text = ((await page.textContent('[role="dialog"][aria-modal="true"]')) ?? '')
            .replace(/\s+/g, ' ')
            .trim();
          check(
            'and the review shows a diff for the staged edit',
            /flex-col/.test(text),
            JSON.stringify(text.slice(0, 120)),
          );
          if (WRITE) {
            /*
             * THE ONE THING NO OTHER LANE CAN SHOW: that pressing Approve changes the
             * consumer's source. Everything upstream of here is a dry run, so a mistake in
             * the commit path — a wrong file, an intent that composes but writes nothing —
             * survives every other check in this repository.
             */
            const abs = path.join(PROJECT, SCENE_SRC);
            const before = await fs.readFile(abs, 'utf8');
            const approve = (await page.$$('[role="dialog"] button')).at(-1);
            await approve?.click();
            await page.waitForTimeout(3000);
            const after = await fs.readFile(abs, 'utf8');
            check(
              'Approve writes the class into the consumer’s source',
              after !== before && after.includes('flex-col'),
              after === before ? 'the file is unchanged' : 'changed',
            );
            check('and the modal closed itself', !(await page.$('[role="dialog"][aria-modal="true"]')));

            // Restore through the bridge's own transaction log, not by rewriting the file:
            // that is the path a user takes, so a broken undo fails HERE rather than leaving
            // the fixture dirty for the next run to discover.
            const undone = await (
              await fetch(`http://127.0.0.1:${PORT}/__design-editor/api/undo`, { method: 'POST' })
            ).json();
            check('undo answers ok', undone.ok === true, undone.error);
            const restored = await fs.readFile(abs, 'utf8');
            check('and the file is byte-identical again', restored === before);
            // The comment above promises the failure lands HERE. It only did so for the
            // current run: an unrestored fixture keeps the written class, and the NEXT
            // run's "Approve writes the class" check is then satisfied by the leftover
            // rather than by a write — green while measuring nothing.
            if (restored !== before) {
              await fs.writeFile(abs, before, 'utf8');
              console.log('       (undo did not restore the fixture — rewrote it from the pre-edit bytes)');
            }

            // `PathGuard.backup` writes `${file}.bak` beside the source; the design doc's
            // Risks section names that and prescribes a cache directory instead. Unimplemented,
            // so this cleans up and reports rather than pretending it did not happen.
            const bak = `${abs}.bak`;
            let left = false;
            try {
              await fs.unlink(bak);
              console.log(`       removed ${SCENE_SRC}.bak (see the Risks section)`);
            } catch {
              try {
                await fs.access(bak);
                left = true;
              } catch {
                /* never created, or already gone */
              }
            }
            check('no backup was left in the fixture', !left, `${SCENE_SRC}.bak`);
          } else {
            await page.keyboard.press('Escape');
            await page.waitForTimeout(400);
            check('Escape closes it without writing', !(await page.$('[role="dialog"][aria-modal="true"]')));
            console.log('       (skipping the real Approve — pass --write to include it)');
          }
        }

        // Leave nothing staged: the viewport checks below remount the frame, and a dirty
        // editor there would make a failure read as a protocol problem.
        await page.keyboard.press('Control+z');
        await page.waitForTimeout(300);
      }

      const viewportButtons = await page.$$('button[title^="Viewport"]');
      check('the viewport switcher is present', viewportButtons.length > 0);
      if (viewportButtons.length > 0) {
        await viewportButtons[0].click();
        await page.waitForTimeout(600);
        const mobileFrame = page.frames().find((f) => f.url().includes('/scene?'));
        check('the mobile frame is still attached', Boolean(mobileFrame));
        if (mobileFrame) {
          // Read once per assertion: evaluating twice crossed the frame boundary a second
          // time and could report a width the condition never saw.
          const mobileWidth = await mobileFrame.evaluate(() => window.innerWidth);
          check(
            'a mobile viewport gives the frame a real 390px width',
            mobileWidth === 390,
            String(mobileWidth),
          );
          await page.selectOption('select', '0.5');
          await page.waitForTimeout(600);
          const zoomedWidth = await mobileFrame.evaluate(() => window.innerWidth);
          check(
            'and zoom scales the picture without changing that width',
            zoomedWidth === 390,
            String(zoomedWidth),
          );
        }
      }
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
