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
import { spawn } from 'node:child_process';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PORT ?? 5299);
/** Generous: the cold graph is ~6,000 modules on a drvfs mount. */
const PAINT_TIMEOUT_MS = Number(process.env.PAINT_TIMEOUT_MS ?? 300_000);

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

/** The design-editor shell is a prebuilt bundle; without it `/` serves nothing. */
function buildShellIfStale() {
  const pkg = path.resolve(HERE, '../design-editor');
  const bundle = path.join(pkg, 'dist/shell/index.html');
  let newest = 0;
  const walk = (dir) => {
    for (const e of fsSync.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else newest = Math.max(newest, fsSync.statSync(full).mtimeMs);
    }
  };
  walk(path.join(pkg, 'src'));
  if (fsSync.existsSync(bundle) && newest <= fsSync.statSync(bundle).mtimeMs) return;
  console.log('building the design-editor shell (missing or older than its src/)');
  const r = spawn('pnpm', ['exec', 'vite', 'build', '--config', './vite.shell.config.ts'], {
    cwd: pkg,
    stdio: 'inherit',
  });
  return new Promise((resolve, reject) => {
    r.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('shell build failed'))));
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

async function main() {
  await buildShellIfStale();
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

    console.log('every live scene paints its real page');
    for (const s of live) {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      const misses = [];
      page.on('console', (m) => {
        if (/unmocked/i.test(m.text())) misses.push(m.text().slice(0, 70));
      });
      const settle = trackRequests(page);
      await page.goto(
        `http://127.0.0.1:${PORT}/__design-editor/scene?scene=${s.id}&frame=after&theme=light`,
        { waitUntil: 'commit', timeout: PAINT_TIMEOUT_MS },
      );
      const text = await waitForPaint(page);
      const stamped = text === null ? 0 : (await page.$$('[data-wb-node]')).length;
      // A mount error PAINTS, so "it rendered" is not the check — stamped nodes are.
      check(
        `${s.id} renders and is stampable`,
        stamped > 0 && !/mount error/i.test(text ?? ''),
        `${stamped} nodes · ${JSON.stringify((text ?? '(empty)').slice(0, 70))}`,
      );
      // An unmocked request is the failure the fixture table exists to prevent, and it is
      // reported rather than tolerated: a scene whose data 401s looks like a broken scene.
      // Only meaningful once the scene has stopped asking — see `trackRequests`.
      const quiet = await settle();
      check(`${s.id} settles its requests`, quiet, quiet ? 'network quiet' : 'still in flight');
      check(`${s.id} makes no unmocked request`, misses.length === 0, misses.slice(0, 2).join(' | '));
      await page.close();
    }

    console.log('\nthe fixtures reach the page, not just the shell');
    {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
      await page.goto(
        `http://127.0.0.1:${PORT}/__design-editor/scene?scene=documents&frame=after&theme=light`,
        { waitUntil: 'commit', timeout: PAINT_TIMEOUT_MS },
      );
      const text = (await waitForPaint(page)) ?? '';
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
