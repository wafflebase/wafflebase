/**
 * Do WAFFLEBASE's own pages render in the editor, and does a click reach their source?
 *
 * The sibling of `@wafflebase/design-editor`'s `verify-frame.mjs`, and the complement of
 * it: that one proves the frame works on a project that is not wafflebase (a 6-file
 * fixture with no providers and no engines), this one proves it works on the project that
 * is — six real pages, the real `app/Layout`, react-query, MemoryRouter, and an engine
 * graph of ~6,000 modules.
 *
 * NOT ON CI, for the same reason `verify:frame` is not: it needs Chromium and a dev
 * server, and the first cold load of a scene here takes over a minute on a WSL2/drvfs
 * mount. Run it when changing anything under `src/scenes/`, the manifest, or the Vite
 * config's alias / optimizeDeps / define blocks — every one of those has already broken a
 * scene silently once.
 *
 * WHAT EACH FAILURE LOOKED LIKE, so a regression is recognisable:
 *   - a missing engine alias      → 500 on a transitive import, reported as a mount error
 *                                   naming `providers.tsx` rather than the real file
 *   - no `optimizeDeps.include`   → "Invalid hook call", then a frame that paints nothing
 *   - no `define` globals         → `process is not defined`
 *   - deferred scenes             → `no scene "<id>" in the scene manifest`
 * All four are silent in every other lane.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PORT ?? 5299);
/** Generous: the cold graph is ~6,000 modules on a drvfs mount. */
const PAINT_TIMEOUT_MS = Number(process.env.PAINT_TIMEOUT_MS ?? 300_000);
/** The monorepo root — the write boundary the plugin is configured with. */
const ROOT = path.resolve(HERE, '../..');
/**
 * NOTHING IS WRITTEN unless `--write` is passed, the same contract as `verify-consumer` and
 * `verify-frame`. With it, one class edit is approved into `packages/frontend/src/**` and then
 * undone through the bridge, with the bytes compared back. That file is product source, so the
 * restore is asserted rather than assumed.
 */
const WRITE = process.argv.includes('--write');

let checks = 0;
let failures = 0;
function check(label, ok, detail) {
  checks++;
  if (ok) {
    console.log(`  ok   ${label}${detail === undefined ? '' : ` — ${detail}`}`);
    return true;
  }
  failures++;
  console.log(`  FAIL ${label}${detail === undefined ? '' : `\n       ${detail}`}`);
  return false;
}

function shutdown(child) {
  try {
    if (child?.pid) process.kill(-child.pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
}

/**
 * `@wafflebase/design-editor` IS BUILT OUTPUT, on both halves.
 *
 * The shell is a prebuilt bundle; without it `/` serves nothing. And since #966 the
 * plugin is built too — `exports["."]` names `dist/plugin/index.js`, which is what
 * `packages/design-sandbox/vite.config.ts` reaches when it does
 * `import { designEditor, BASE } from '@wafflebase/design-editor'`. Rebuilding only the
 * shell meant `boot()` below died on `Cannot find module` in a clean checkout, and ran
 * every scene against stale plugin bytes in a dirty one.
 *
 * `verify:scenes` is not on CI (it needs Chromium), so `design-editor:build` guarantees
 * it nothing — the build has to happen here or not at all. Same mtime comparison
 * `buildCoreIfStale` uses, and for the same reason: rebuilding only when an artefact is
 * MISSING serves stale bytes forever.
 */
function buildDesignEditorIfStale() {
  const pkg = path.resolve(HERE, '../design-editor');
  let newest = 0;
  const walk = (dir) => {
    for (const e of fsSync.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else newest = Math.max(newest, fsSync.statSync(full).mtimeMs);
    }
  };
  walk(path.join(pkg, 'src'));
  // A change to either build config invalidates the output it governs.
  for (const config of ['vite.shell.config.ts', 'tsconfig.build.json']) {
    newest = Math.max(newest, fsSync.statSync(path.join(pkg, config)).mtimeMs);
  }
  const outdated = ['dist/shell/index.html', 'dist/plugin/index.js'].filter((rel) => {
    const artefact = path.join(pkg, rel);
    return !fsSync.existsSync(artefact) || fsSync.statSync(artefact).mtimeMs < newest;
  });
  if (outdated.length === 0) return Promise.resolve();
  console.log(`building @wafflebase/design-editor (${outdated.join(', ')} missing or older than its src/)`);
  // The package's own `build` — shell AND plugin — so the two can never drift apart here.
  const r = spawn('pnpm', ['run', 'build'], { cwd: pkg, stdio: 'inherit' });
  return new Promise((resolve, reject) => {
    r.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('design-editor build failed'))));
  });
}

async function boot() {
  const child = spawn(
    'pnpm',
    ['exec', 'vite', HERE, '--config', path.join(HERE, 'vite.config.ts'), '--port', String(PORT), '--strictPort'],
    { cwd: HERE, stdio: ['ignore', 'pipe', 'pipe'], detached: true },
  );
  let log = '';
  child.stdout?.on('data', (c) => (log += c.toString()));
  child.stderr?.on('data', (c) => (log += c.toString()));
  const deadline = Date.now() + 90_000;
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

/** Poll `#wb-scene-root` rather than waiting on a load event: the graph is huge. */
async function waitForPaint(page) {
  const deadline = Date.now() + PAINT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const html = (await page.innerHTML('#wb-scene-root').catch(() => '')) ?? '';
    if (html.length > 0) return ((await page.textContent('#wb-scene-root')) ?? '').replace(/\s+/g, ' ').trim();
    await page.waitForTimeout(2000);
  }
  return null;
}

/**
 * Requests keep starting AFTER the first paint — React Query fires on mount and resolves
 * later — so `waitForPaint` returning is not "this scene has finished asking for data".
 * Without this, the `misses` array below was inspected, and the page closed, before an
 * unmocked request had a chance to be logged: the check could pass by being early.
 *
 * Attach BEFORE `goto`, or the mount-time requests are never counted.
 */
function trackRequests(page) {
  let inflight = 0;
  let last = Date.now();
  const touch = () => {
    last = Date.now();
  };
  page.on('request', () => {
    inflight += 1;
    touch();
  });
  page.on('requestfinished', () => {
    inflight -= 1;
    touch();
  });
  page.on('requestfailed', () => {
    inflight -= 1;
    touch();
  });
  return async function settle(quietMs = 800) {
    const deadline = Date.now() + PAINT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (inflight <= 0 && Date.now() - last >= quietMs) return true;
      await page.waitForTimeout(100);
    }
    return false;
  };
}

/**
 * SETTLED, not first paint — and the difference produced a false report once.
 *
 * The app shell paints before the engine inside it mounts, so reading at the first non-empty
 * `innerHTML` catches a canvas scene mid-load and shows its title placeholder ("Loading…").
 * I recorded four canvas scenes as stuck on that; they render fine. This waits for the text to
 * stop changing instead.
 */
async function waitForSettled(page) {
  const deadline = Date.now() + PAINT_TIMEOUT_MS;
  let last = '';
  let stable = 0;
  while (Date.now() < deadline) {
    const t = ((await page.textContent('#wb-scene-root').catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
    if (t && t === last) {
      stable += 1;
      if (stable >= 3) return t;
    } else {
      stable = 0;
    }
    last = t;
    await page.waitForTimeout(2000);
  }
  // NULL, not the last value seen. Returning it made "never settled" indistinguishable from
  // "settled", and both callers treat a string as a settled read — so a scene still churning
  // at the deadline would have been measured mid-change and could pass.
  return null;
}

/**
 * `@wafflebase/core` IS BUILT OUTPUT, and this gate loads it.
 *
 * Unlike `verify:frame` and `verify:consumer`, which run against `fixtures/consumer` — a
 * project that does not depend on core — the scenes mount wafflebase's own frontend, whose
 * `index.css` and modules resolve `@wafflebase/core/*` through the exports map to
 * `packages/core/dist`. Nothing here rebuilt it, so a `dist` older than `src` was served
 * silently: every scene failed with `does not provide an export named …`, which reads as a
 * broken scene rather than as a stale artefact. That cost an hour finding it once.
 *
 * Same mtime comparison `buildDesignEditorIfStale` above uses, and for the same reason —
 * a gate that rebuilds only when its artefact is MISSING serves stale bytes forever.
 */
function buildCoreIfStale() {
  const core = path.join(ROOT, 'packages/core');
  const dist = path.join(core, 'dist');
  const newest = (dir) => {
    let m = 0;
    for (const e of fsSync.readdirSync(dir, { withFileTypes: true, recursive: true })) {
      if (!e.isFile()) continue;
      m = Math.max(m, fsSync.statSync(path.join(e.parentPath ?? e.path, e.name)).mtimeMs);
    }
    return m;
  };
  if (fsSync.existsSync(dist) && newest(path.join(core, 'src')) <= newest(dist)) return;
  console.log('building @wafflebase/core (dist missing or older than src/)');
  const r = spawnSync('pnpm', ['--filter', '@wafflebase/core', 'build'], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('core build failed');
}

async function main() {
  await buildDesignEditorIfStale();
  buildCoreIfStale();
  const { child, log } = await boot();
  let browser;
  try {
    let chromium;
    try {
      ({ chromium } = await import('playwright'));
    } catch {
      throw new Error('playwright is not installed — `pnpm --filter @wafflebase/frontend exec playwright install chromium`');
    }
    try {
      browser = await chromium.launch();
    } catch (err) {
      throw new Error(
        'chromium could not launch. Its system libraries are probably missing —\n' +
          '  run `pnpm --filter @wafflebase/frontend exec playwright install-deps chromium`.\n' +
          `  original: ${err.message}`,
      );
    }

    const manifest = JSON.parse(fsSync.readFileSync(path.join(HERE, 'scenes.config.json'), 'utf8'));
    const live = manifest.scenes.filter((s) => !s.deferred);

    /*
     * WARM THE FIRST SCENE BEFORE ANY CHECK READS A CLOCK.
     *
     * Adding `tailwindcss()` made the first scene load pay for compiling the whole
     * utility set, and on a cold dev server that pushed the two heaviest scenes past
     * `waitForSettled` — a run reporting `0 nodes · "(empty)"` for pages that render
     * 126 and 166 nodes on the very next run. A gate that fails on the run that
     * happens to be first is worse than a slow one: it teaches you to re-run rather
     * than to read it.
     *
     * Discarded on purpose — nothing here is asserted. This exists so the timings the
     * loop measures are the scene's, not the compiler's.
     */
    {
      const warm = await browser.newPage();
      await warm
        .goto(
          `http://127.0.0.1:${PORT}/__design-editor/scene?scene=${live[0].id}&frame=after&theme=light`,
          { waitUntil: 'load', timeout: PAINT_TIMEOUT_MS * 2 },
        )
        .catch(() => {
          /* a warmup that fails is not a finding; the real check follows */
        });
      await warm.close();
    }

    console.log('every live scene paints its real page');
    for (const s of live) {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      /*
       * READ FROM THE CHANNEL THE GUARD ACTUALLY USES.
       *
       * This watched `page.on('console')` for the word "unmocked" — and the guard never
       * writes to the console. `installFetchGuard`'s miss path calls `onMiss`, which
       * `scene-entry` turns into `send({ type: 'wb:error', kind: 'fetch', … })`, and then
       * throws into the caller — where React Query swallows it. So the console stayed clean
       * and this check passed for every scene whether or not one had leaked.
       *
       * `window.parent` is the page itself when the scene document is opened directly, so
       * the frame's own `postMessage` lands here. Same capture `verify-frame.mjs` already
       * uses; installed before `goto` so nothing posted during mount is lost.
       */
      await page.addInitScript(() => {
        window.__wbMisses = [];
        window.__wbStreams = [];
        window.addEventListener('message', (e) => {
          const m = e.data;
          if (!m || m.type !== 'wb:error') return;
          if (m.kind === 'fetch') window.__wbMisses.push(m.url ?? m.message);
          if (m.kind === 'stream') window.__wbStreams.push(m.url ?? m.message);
        });
      });
      const settle = trackRequests(page);
      await page.goto(
        `http://127.0.0.1:${PORT}/__design-editor/scene?scene=${s.id}&frame=after&theme=light`,
        { waitUntil: 'commit', timeout: PAINT_TIMEOUT_MS },
      );
      const text = await waitForSettled(page);
      const stamped = text === null ? 0 : (await page.$$('[data-wb-node]')).length;
      // A mount error PAINTS, so "it rendered" is not the check — stamped nodes are.
      check(
        `${s.id} renders and is stampable`,
        // BOTH placeholder spellings. The canvas titles render ASCII `Loading...`, but the
        // shell's notification list renders the Unicode `Loading…`, and only the first was
        // rejected — so a shell stuck mid-load could pass with stamped nodes.
        stamped > 0 && !/mount error/i.test(text ?? '') && !/Loading(\.\.\.|…)/.test(text ?? ''),
        `${stamped} nodes · ${JSON.stringify((text ?? '(empty)').slice(0, 70))}`,
      );
      // The scene renders the CONSUMER's components, so it needs the CONSUMER's stylesheet.
      // Nothing supplied one until `providers.tsx` imported it, and an unstyled scene still
      // mounts, still stamps, and still passes every check above — it just looks like a
      // broken theme. Counting rules is crude on purpose: the failure was zero, not wrong.
      const css = await page.evaluate(() => {
        let rules = 0;
        let utilities = 0;
        // A UTILITY, not just a rule. Counting rules alone passed a frame carrying only
        // preflight and the token layer — 413 of them — while every Tailwind class on the
        // page generated nothing and `text-[28px]` computed to 16px. The class is on the
        // element either way, so nothing structural notices.
        const UTILITY = /^\.(flex|grid|hidden|absolute|relative|(text|bg|border|rounded|p|px|py|m|mx|my|gap|w|h)-)/;
        // RECURSIVE, because Tailwind v4 emits utilities inside `@layer utilities {…}`.
        // Walking only the top level counts the layer as one rule and reads no selector
        // off it, which reported "0 utilities" for a frame that was styling correctly.
        const walk = (list) => {
          for (const r of list) {
            rules++;
            if (r.selectorText?.split(',').some((sel) => UTILITY.test(sel.trim()))) utilities++;
            if (r.cssRules) walk(r.cssRules);
          }
        };
        for (const sh of document.styleSheets) {
          try {
            walk(sh.cssRules);
          } catch {
            /* cross-origin sheet: not ours to read, not ours to count */
          }
        }
        return { rules, utilities };
      });
      check(
        `${s.id} is styled`,
        css.rules > 50 && css.utilities > 20,
        `${css.rules} rules, ${css.utilities} utilities`,
      );
      // An unmocked request is the failure the fixture table exists to prevent, and it is
      // reported rather than tolerated: a scene whose data 401s looks like a broken scene.
      // Only meaningful once the scene has stopped asking — see `trackRequests`.
      const quiet = await settle();
      check(`${s.id} settles its requests`, quiet, quiet ? 'network quiet' : 'still in flight');
      const misses = [...new Set(await page.evaluate(() => window.__wbMisses ?? []))];
      check(`${s.id} makes no unmocked request`, misses.length === 0, misses.slice(0, 3).join(' | '));
      // Reported, never failed: a refused stream is the guard working. Printed so that a
      // scene which suddenly opens a NEW one is visible rather than silently absorbed.
      const streams = [...new Set(await page.evaluate(() => window.__wbStreams ?? []))];
      if (streams.length) console.log(`       (streams refused: ${streams.join(', ')})`);
      await page.close();
    }

    console.log('\nthe dep optimizer is not exploding');
    {
      /*
       * A CHUNK COUNT, not a stopwatch. Cold-load time on this machine ranges 55-158 s and
       * would make a flaky gate; the chunk count is stable and is the actual mechanism.
       *
       * Measured: with `@tabler/icons-react` pre-bundled, esbuild emits a chunk per icon and
       * the documents scene fetched 11,794 of them out of 12,503 responses (103 s). Excluded,
       * that is 33 chunks (61 s), same render. The ceiling is deliberately far above 33 and
       * far below 11,794 — it catches the explosion, not ordinary drift.
       */
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      let chunks = 0;
      page.on('response', (r) => {
        if (new URL(r.url()).pathname.includes('/.vite/deps/chunk-')) chunks++;
      });
      await page.goto(
        `http://127.0.0.1:${PORT}/__design-editor/scene?scene=documents&frame=after&theme=light`,
        { waitUntil: 'commit', timeout: PAINT_TIMEOUT_MS },
      );
      await waitForPaint(page);
      check('a scene load stays under 500 pre-bundled chunks', chunks < 500, `${chunks} chunks`);
      await page.close();
    }

    console.log('\nthe fixtures reach the page, not just the shell');
    {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      await page.goto(
        `http://127.0.0.1:${PORT}/__design-editor/scene?scene=documents&frame=after&theme=light`,
        { waitUntil: 'commit', timeout: PAINT_TIMEOUT_MS },
      );
      const text = (await waitForSettled(page)) ?? '';
      // `Acme Design` is the app shell's own fetch; `Q4 Revenue Model` is the scene's ref.
      // Only the second proves `fixtures: { query: "documents/list" }` was resolved.
      check('the app shell fetched its own data', text.includes('Acme Design'));
      check("the scene's own fixture ref resolved", text.includes('Q4 Revenue Model'));
      await page.close();
    }

    console.log('\na click in a wafflebase scene reaches wafflebase source');
    {
      const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
      await page.goto(`http://127.0.0.1:${PORT}/__design-editor/`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
      for (const b of await page.$$('aside button')) {
        if (((await b.textContent()) ?? '').includes('Documents')) {
          await b.click();
          break;
        }
      }
      let inner = null;
      const deadline = Date.now() + PAINT_TIMEOUT_MS;
      while (Date.now() < deadline) {
        inner = page.frames().find((f) => f.url().includes('scene=documents'));
        if (inner && ((await inner.innerHTML('#wb-scene-root').catch(() => '')) ?? '').length) break;
        await page.waitForTimeout(2000);
      }
      if (check('the host mounted a wafflebase scene', !!inner)) {
        const rows = await page.$$('[data-row-id]');
        check('the outline lists its nodes', rows.length > 2, `${rows.length} rows`);
        if (rows.length > 2) {
          await rows[2].click();
          await page.waitForTimeout(2000);
          const panel = (await page.textContent('aside:last-of-type')) ?? '';
          check(
            'an outline row resolves to a frontend source anchor',
            /packages\/frontend\/src\//.test(panel) && /fp \w+/.test(panel),
            (panel.match(/packages\/frontend\/src\/\S+/) ?? ['(none)'])[0],
          );

          /*
           * DRILL INTO A FILE THE MANIFEST NEVER DECLARED.
           *
           * The outline used to offer a drill-in only for the seven paths listed under
           * `components` in `scenes.config.json`, so every other component resolved and
           * was refused anyway — the button simply did not render. This asserts the
           * replacement end to end: the button exists, and clicking it fetches a tree
           * for a file nobody declared.
           *
           * Deliberately checks a file that is NOT in that list, so passing cannot be
           * explained by the old behaviour.
           */
          const drill = page.locator('button[title^="Open "]').first();
          if (check('the outline offers a drill-in', (await drill.count()) > 0)) {
            const target = (await drill.getAttribute('title'))?.replace(/^Open /, '') ?? '';
            const declared = JSON.parse(
              fsSync.readFileSync(path.join(HERE, 'scenes.config.json'), 'utf8'),
            ).components ?? [];
            check(
              'and it names a file the manifest never declared',
              !declared.includes(target),
              target,
            );
            await drill.click();
            const opened = await page
              .waitForFunction(
                (f) =>
                  [...document.querySelectorAll('[data-row-id]')].some((r) =>
                    (r.getAttribute('data-row-id') ?? '').startsWith(`${f}#`),
                  ),
                target,
                { timeout: PREVIEW_TIMEOUT_MS },
              )
              .then(() => true)
              .catch(() => false);
            check('and the drilled-into file gets a tree', opened, target);
          }
        }

        // DISPATCHED, not driven. The picker's overlay makes Playwright's actionability
        // check time out, and the picker listens on capture-phase `click` anyway. The
        // deepest visible node is chosen because clicking an outer container lands outside
        // it, which the frame correctly reads as a gutter click and reports as deselect.
        const target = await inner.evaluateHandle(() => {
          const vis = [...document.querySelectorAll('[data-wb-node]')]
            .map((el) => ({ el, r: el.getBoundingClientRect() }))
            .filter(({ r }) => r.width > 8 && r.height > 8 && r.top >= 0 && r.top < window.innerHeight - 20)
            .sort((a, b) => a.r.width * a.r.height - b.r.width * b.r.height);
          return vis[0] ?? null;
        });
        const el = (await target.getProperty('el')).asElement?.() ?? target.asElement();
        if (el) {
          await el.evaluate((n) => {
            const r = n.getBoundingClientRect();
            n.dispatchEvent(
              new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                clientX: Math.round(r.left + r.width / 2),
                clientY: Math.round(r.top + r.height / 2),
              }),
            );
          });
          await page.waitForTimeout(2500);
        }
        const after = (await page.textContent('aside:last-of-type')) ?? '';
        check(
          'a frame click resolves to a frontend source anchor',
          /packages\/frontend\/src\//.test(after) && !/Picking must be on/.test(after),
          (after.match(/packages\/frontend\/src\/\S+/) ?? ['(nothing selected)'])[0],
        );

        // THE CROSS-FILE CASE, asserted by name rather than by shape. `shell: "app"` mounts
        // the scene inside the real `app/Layout`, so the frame holds stamped nodes from a
        // file that is NOT the scene's own — and resolving those is the part most likely to
        // regress. A `/packages\/frontend\/src\//` match cannot see that regression: the
        // scene's own file matches it too.
        const SCENE_FILE = 'packages/frontend/src/app/workspaces/workspace-documents.tsx';
        const files = await inner.evaluate(() => [
          ...new Set(
            [...document.querySelectorAll('[data-wb-node][data-wb-file]')].map((el) =>
              el.getAttribute('data-wb-file'),
            ),
          ),
        ]);
        const foreign = files.filter((f) => f && f !== SCENE_FILE);
        check(
          'the frame holds nodes from a file other than the scene',
          foreign.length > 0,
          `${files.length} files · foreign: ${foreign.slice(0, 2).join(', ') || '(none)'}`,
        );
        if (foreign.length > 0) {
          const wanted = foreign[0];
          const picked = await inner.evaluateHandle((f) => {
            const els = [...document.querySelectorAll(`[data-wb-file="${f}"][data-wb-node]`)]
              .map((el) => ({ el, r: el.getBoundingClientRect() }))
              .filter(({ r }) => r.width > 8 && r.height > 8 && r.top >= 0 && r.top < window.innerHeight - 20)
              .sort((a, b) => a.r.width * a.r.height - b.r.width * b.r.height);
            return els[0]?.el ?? null;
          }, wanted);
          const fEl = picked.asElement();
          if (fEl) {
            await fEl.evaluate((n) => {
              const r = n.getBoundingClientRect();
              n.dispatchEvent(
                new MouseEvent('click', {
                  bubbles: true,
                  cancelable: true,
                  clientX: Math.round(r.left + r.width / 2),
                  clientY: Math.round(r.top + r.height / 2),
                }),
              );
            });
            await page.waitForTimeout(2500);
          }
          const cross = (await page.textContent('aside:last-of-type')) ?? '';
          check(
            'a node from another file resolves to THAT file',
            cross.includes(wanted),
            `${wanted} · panel: ${(cross.match(/packages\/frontend\/src\/\S+/) ?? ['(none)'])[0]}`,
          );
        }

        /**
         * A CLASS EDIT AGAINST WAFFLEBASE'S OWN SOURCE.
         *
         * `verify:frame` already covers staging → ⌘Z → review → write, but against the 6-file
         * fixture consumer. This is the same loop against a real page: the anchor resolves into
         * `packages/frontend/src/**`, and with `--write` the edit lands in a file the product
         * ships.
         *
         * THE NODE IS CHOSEN FOR BEING PAINTED AND HAVING CLASSES, and both halves were learned
         * the hard way. Measured on the documents scene after its data arrives: 90 of the 91
         * visible stamped nodes belong to `document-list.tsx` and the rest to the shell chrome —
         * the scene's OWN nodes are all in its loading branch and unmount when the query
         * resolves. So an outline row from the scene file resolves to an anchor and then reports
         * "Not currently visible", and a click on the deepest visible element lands in a file
         * the manifest did not declare. Declaring those files (see `components:` in the
         * manifest) is what makes anything on screen editable at all.
         */
        /*
         * Restricted to files `/metadata` ACTUALLY ANALYSED, which is what makes this
         * deterministic. The visible page is assembled from a dozen components; picking the
         * smallest visible element lands on whichever of them happens to be smallest —
         * measured, `folder-breadcrumb.tsx`, then `nav-user.tsx` — and an undeclared file
         * correctly has no anchor. The point of this check is the EDIT path, not rediscovering
         * that undeclared files are undeclared.
         */
        const analysed = await (
          await fetch(`http://127.0.0.1:${PORT}/__design-editor/api/metadata`)
        ).json();
        const declared = (analysed.metadata?.files ?? []).map((f) => f.file);
        const editable = await inner.evaluateHandle((files) => {
          const vis = [...document.querySelectorAll('[data-wb-node]')]
            .filter(
              (el) =>
                el instanceof HTMLElement &&
                String(el.className || '').trim() &&
                files.includes(el.getAttribute('data-wb-file') ?? ''),
            )
            .map((el) => ({ el, r: el.getBoundingClientRect() }))
            .filter(({ r }) => r.width > 24 && r.height > 16 && r.top >= 0 && r.top < window.innerHeight - 24)
            // Smallest first: an outer container's centre often sits over a child, which the
            // frame reads as a gutter click and reports as a deselect.
            .sort((a, b) => a.r.width * a.r.height - b.r.width * b.r.height);
          return vis[0]?.el ?? null;
        }, declared);
        const editTarget = editable.asElement();
        if (editTarget) {
          await editTarget.evaluate((n) => {
            const r = n.getBoundingClientRect();
            n.dispatchEvent(
              new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                clientX: Math.round(r.left + r.width / 2),
                clientY: Math.round(r.top + r.height / 2),
              }),
            );
          });
          await page.waitForTimeout(3000);
        }
        const detail = ((await page.textContent('aside:last-of-type')) ?? '').replace(/\s+/g, ' ');
        check(
          'the clicked node resolves to a declared frontend file',
          /packages\/frontend\/src\//.test(detail) && !/was not analysed/.test(detail),
          (detail.match(/packages\/frontend\/src\/\S+/) ?? ['(no anchor)'])[0],
        );

        const saveBtn = async () =>
          page.$eval('button[title*="⌘S"], button[title*="matches the editor"]', (b) => ({
            text: (b.textContent ?? '').trim(),
            disabled: b.disabled,
          }));

        if (check('the class editor opens on a wafflebase node', !!(await page.$('[data-wb-class-editor]')))) {
          await page.click('[data-wb-class-editor] button[title="flex-col"]');
          await page.waitForTimeout(400);
          check(
            'a class edit stages against a frontend file',
            /1$/.test((await saveBtn()).text),
            (await saveBtn()).text,
          );

          /*
           * THE STAGED EDIT MUST BE ON SCREEN BEFORE IT IS ON DISK.
           *
           * This is the check whose absence let live class preview go missing: `POST /plan`
           * and `scene-patch` both shipped, nothing called the route, and every check here
           * looked at the SAVE path — so the frame silently painted the committed state
           * while the editor said an edit was staged. Token edits were unaffected and
           * previewed live, which made the gap look like a scene quirk rather than a
           * missing call.
           *
           * Read off the frame's own DOM by node id rather than through the stale element
           * handle: publishing the plan reloads the module, so the node the click landed on
           * has been replaced by the time this runs.
           */
          const nodeId = await editTarget.evaluate((n) => n.getAttribute('data-wb-node'));
          await page.waitForTimeout(1200); // the plan publish → module reload round trip
          const staged = await inner.evaluate(
            (id) =>
              document.querySelector(`[data-wb-node="${id}"]`)?.className ?? '(node is gone)',
            nodeId,
          );
          check(
            'the staged class is on screen BEFORE any save',
            /\bflex-col\b/.test(String(staged)),
            String(staged).slice(0, 90),
          );

          await page.keyboard.press('Control+z');
          await page.waitForTimeout(400);
          check('⌘Z takes it back', (await saveBtn()).disabled === true, JSON.stringify(await saveBtn()));

          // The REVERT half of the union. An emptied plan names no files of its own, so a
          // frame that reloads only the new plan's files keeps the patch on screen forever.
          await page.waitForTimeout(1200);
          const reverted = await inner.evaluate(
            (id) =>
              document.querySelector(`[data-wb-node="${id}"]`)?.className ?? '(node is gone)',
            nodeId,
          );
          check(
            'and undoing it takes the class OFF the screen too',
            !/\bflex-col\b/.test(String(reverted)),
            String(reverted).slice(0, 90),
          );

          await page.keyboard.press('Control+Shift+z');
          await page.waitForTimeout(400);
          check('and ⇧⌘Z restages it', /1$/.test((await saveBtn()).text), (await saveBtn()).text);

          await page.keyboard.press('Control+s');
          await page.waitForTimeout(3000);
          if (check('⌘S opens the review', !!(await page.$('[role="dialog"][aria-modal="true"]')))) {
            const modal = ((await page.textContent('[role="dialog"][aria-modal="true"]')) ?? '')
              .replace(/\s+/g, ' ')
              .trim();
            check(
              'and the diff names the frontend file',
              /packages\/frontend\/src\//.test(modal) && /flex-col/.test(modal),
              JSON.stringify(modal.slice(0, 110)),
            );
            /*
             * The CARD, not just the diff list. Measured before this check existed: the header
             * said "1 file change staged", the diff list showed the change, and the card area
             * said "No changes to review" — the class editor stages `layoutEdits` and the card
             * builder knew only the token/class maps. A reviewer reading the card area would
             * have concluded there was nothing to approve.
             */
            check(
              'and the card area shows the change rather than an empty state',
              !/No changes to review/.test(modal),
              JSON.stringify(modal.slice(0, 130)),
            );

            if (WRITE) {
              /*
               * A REAL WRITE INTO `packages/frontend`. Restored through the bridge's own
               * transaction log, which is the path a user takes — so a broken undo fails here
               * rather than leaving product source edited for the next run to discover.
               */
              const rel = (modal.match(/packages\/frontend\/src\/[\w./-]+\.tsx/) ?? [])[0];
              if (check('the review names which file it will write', !!rel, rel)) {
                const abs = path.join(ROOT, rel);
                const before = await fs.readFile(abs, 'utf8');
                // Cleared before the write — see the same note in verify-frame.mjs: a leftover
                // cached backup makes `PathGuard.backup` skip, and the presence check below
                // would then pass on a file this run never created.
                const cached = path.join(ROOT, 'node_modules/.cache/wafflebase-design-editor', `${rel}.bak`);
                await fs.rm(cached, { force: true });
                try {
                  const approve = (await page.$$('[role="dialog"] button')).at(-1);
                  await approve?.click();
                  await page.waitForTimeout(4000);
                  const written = await fs.readFile(abs, 'utf8');
                  check(
                    'Approve writes the class into wafflebase’s own source',
                    written !== before && written.includes('flex-col'),
                    written === before ? 'unchanged' : 'changed',
                  );

                  const undone = await (
                    await fetch(`http://127.0.0.1:${PORT}/__design-editor/api/undo`, { method: 'POST' })
                  ).json();
                  check('undo answers ok', undone.ok === true, undone.error);
                  check(
                    'and the file is byte-identical again',
                    (await fs.readFile(abs, 'utf8')) === before,
                    'a difference here means product source was left edited',
                  );

                  /*
                   * OBSERVED BEFORE IT IS CLEANED UP. This read used to `unlink` first and set
                   * `left` only if the unlink FAILED — so the check passed exactly when a
                   * backup had been left, as long as deleting it worked. It asserted the
                   * cleanup, not the finding.
                   *
                   * `PathGuard.backup` writes `${file}.bak` beside the source; the design doc's
                   * Risks section names that and prescribes a cache directory instead.
                   */
                  let beside = false;
                  try {
                    await fs.access(`${abs}.bak`);
                    beside = true;
                  } catch {
                    /* correct: nothing beside the source */
                  }
                  check('no backup beside wafflebase’s source', !beside, `${rel}.bak`);

                  // The second half carries the content now: with backups under the cache
                  // directory, "nothing beside the source" is true even if the escape hatch
                  // stopped being written at all.
                  let inCache = false;
                  try {
                    await fs.access(cached);
                    inCache = true;
                  } catch {
                    /* never written */
                  }
                  check('and one WAS written into node_modules/.cache', inCache, cached);
                  try {
                    await fs.rm(cached, { force: true });
                  } catch (err) {
                    check('and the cached backup could be cleaned up', false, String(err));
                  }
                } finally {
                  /*
                   * PRODUCT SOURCE, not a fixture. A failed undo — or anything above throwing
                   * before it — used to end the run with `packages/frontend` still edited, and
                   * the next run's "Approve writes the class" check would then be satisfied by
                   * the leftover rather than by a write. The checks above still fail; this only
                   * makes sure the tree does not carry the failure forward.
                   */
                  const now = await fs.readFile(abs, 'utf8').catch(() => before);
                  if (now !== before) {
                    await fs.writeFile(abs, before, 'utf8');
                    console.log(`       restored ${rel} from the pre-edit bytes`);
                  }
                }
              }
            } else {
              await page.keyboard.press('Escape');
              await page.waitForTimeout(400);
              console.log('       (skipping the real Approve — pass --write to include it)');
            }
          }
        }
      }
      await page.close();
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
