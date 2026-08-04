// Prove the UI hunter's free oracles actually fire — and, just as importantly, that
// they DO NOT fire on the things they are scoped to ignore.
//
// WHY THIS EXISTS AS ITS OWN LANE. The oracles are the only part of the hunter that
// can report a defect without any model involvement, so an oracle that silently
// never fires makes the whole pipeline look clean while seeing nothing. That failure
// is invisible from the outside: a run with no findings and a run with a broken
// detector produce the same empty report.
//
// It also validates the baseline measurement taken before this was built: both
// existing browser lanes were reported clean of page errors, and "clean" only means
// something if the instrument is known to work.
//
// Faults are injected from the DRIVER, never from application code. There is no
// `?fault=` query parameter and no test-only branch in the harness route — the page
// under test is the page that ships, and Playwright supplies the damage.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

import { attachOracles, scanDomInvariants } from "./hunt-ui-oracles.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");

const HOST = "127.0.0.1";
const PORT = Number(process.env.HUNT_ORACLES_PORT || 4178);
const READY_SELECTOR = "[data-testid='hunt-harness-root'][data-hunt-harness-ready='true']";
const HOST_TESTID = "hunt-harness-host";

/** How long silence must hold before a negative control counts as quiet. */
const QUIET_WINDOW_MS = 250;
/** How long a positive control may take to fire before it counts as a miss. */
const FIRE_DEADLINE_MS = 5_000;

/**
 * Each case injects one fault and names the oracle that must notice.
 *
 * `expect: null` is a NEGATIVE control — the case creates something that superficially
 * resembles a fault and asserts the oracle stays quiet. Those matter as much as the
 * positives: a false positive costs a maintainer's attention, and the two scoping
 * rules below (backend requests, editor-host text) are the two places this hunter is
 * most likely to report its own environment as a bug.
 */
const CASES = [
  {
    name: "clean page fires nothing",
    expect: null,
    inject: async () => {},
  },
  {
    name: "pageerror on an uncaught exception",
    expect: { kind: "pageerror" },
    inject: async (page) => {
      await page.evaluate(() => {
        setTimeout(() => {
          throw new Error("injected uncaught error");
        }, 0);
      });
    },
  },
  {
    name: "console-error on console.error",
    expect: { kind: "console-error" },
    inject: async (page) => {
      await page.evaluate(() => console.error("injected console error"));
    },
  },
  {
    name: "network-fail on a failed app asset",
    expect: { kind: "network-fail" },
    inject: async (page) => {
      await page.route("**/injected-asset.js", (route) => route.abort("failed"));
      await page.evaluate(() => fetch("/injected-asset.js").catch(() => {}));
    },
  },
  {
    // The scoping rule that keeps Tier 1 usable: there is no backend by
    // construction, so a failed API call is the environment, not a defect.
    name: "network-fail STAYS QUIET for an absent backend",
    expect: null,
    inject: async (page) => {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await page.route("**/auth/**", (route) => route.abort("failed"));
      await page.evaluate(() => fetch("/auth/me/doc-styles").catch(() => {}));
    },
  },
  {
    name: "dom-invariant on a duplicate element id",
    expect: { kind: "dom-invariant", rule: "duplicate-id" },
    inject: async (page) => {
      await page.evaluate(() => {
        for (const _ of [0, 1]) {
          const el = document.createElement("div");
          el.id = "injected-duplicate";
          document.body.appendChild(el);
        }
      });
    },
  },
  {
    name: "dom-invariant on a dangling aria reference",
    expect: { kind: "dom-invariant", rule: "dangling-aria-labelledby" },
    inject: async (page) => {
      await page.evaluate(() => {
        const el = document.createElement("div");
        el.setAttribute("aria-labelledby", "injected-missing-label");
        document.body.appendChild(el);
      });
    },
  },
  {
    name: "dom-invariant on placeholder text in the chrome",
    expect: { kind: "dom-invariant", rule: "placeholder-text" },
    inject: async (page) => {
      await page.evaluate(() => {
        const el = document.createElement("div");
        el.textContent = "Saved by undefined";
        document.body.appendChild(el);
      });
    },
  },
  {
    // Separate from the "undefined" case above, and not redundant with it: the
    // original regex wrapped one \b(...)\b around the whole alternation, which
    // matched "undefined" and "NaN" fine but required a word character immediately
    // outside the brackets of "[object Object]" — so the most common React
    // stringification bug of all was the one alternative that never fired. A test
    // that only injects "undefined" passes either way and proves nothing about it.
    name: "dom-invariant on a bare [object Object]",
    expect: { kind: "dom-invariant", rule: "placeholder-text" },
    inject: async (page) => {
      await page.evaluate(() => {
        const el = document.createElement("div");
        el.textContent = "[object Object]";
        document.body.appendChild(el);
      });
    },
  },
  {
    // The other scoping rule: a user's DOCUMENT may legitimately contain the word
    // "undefined". Only the application's own chrome may not. Without this the first
    // thing a typing agent does is trip the oracle on its own input.
    name: "placeholder-text STAYS QUIET inside the editor host",
    expect: null,
    inject: async (page) => {
      await page.evaluate((hostTestId) => {
        const host = document.querySelector(`[data-testid="${hostTestId}"]`);
        // Throw rather than `host?.appendChild`. If the host selector ever drifts,
        // the optional-chaining form injects NOTHING, the oracle stays quiet, and
        // this negative control PASSES for entirely the wrong reason — a vacuous
        // test that asserts the scan ignores text it was never shown.
        if (!host) throw new Error(`negative control cannot run: no [data-testid="${hostTestId}"]`);
        const el = document.createElement("div");
        el.textContent = "the user typed undefined here";
        host.appendChild(el);
      }, HOST_TESTID);
    },
  },
];

/**
 * Cell-click targeting, checked alongside the oracles because it fails the same way:
 * silently, and only in the direction of wrong findings.
 *
 * `sheet.cellCenter` is the ONLY way to click something that exists purely as pixels
 * on a canvas. When it is wrong, every probe still succeeds — the click lands, the
 * page reacts, nothing errors — it just acts on the wrong cell, and a hunter reading
 * the result concludes the app mis-handles selection. Measured live: an origin error
 * of 43px made "click C3" select C1.
 */
const TARGETING_CELLS = ["A1", "A2", "A3", "B2", "C3", "D5"];

async function checkCellTargeting(page, baseUrl) {
  const problems = [];
  await page.goto(`${baseUrl}/harness/hunt?surface=sheet`, { waitUntil: "networkidle" });
  await page.waitForSelector(READY_SELECTOR, { timeout: 20_000 });
  for (const ref of TARGETING_CELLS) {
    const point = await page.evaluate((r) => window.__WB_HUNT__.read("sheet.cellCenter", [r]), ref);
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      problems.push(`sheet.cellCenter(${ref}) returned ${JSON.stringify(point)}`);
      continue;
    }
    await page.mouse.click(point.x, point.y);
    const active = await page.evaluate(() => window.__WB_HUNT__.read("sheet.activeCell"));
    if (active !== ref) {
      problems.push(`clicking sheet.cellCenter(${ref}) at (${point.x},${point.y}) selected ${active}`);
    }
  }
  return problems;
}

/**
 * Undo capability, checked because a prediction that assumes it produces a
 * confident FALSE finding when it is absent.
 *
 * Measured live: `MemStore.undo()` is a no-op ("No-op for memory store (no history
 * tracking)") while `MemDocStore` keeps real undo/redo stacks. So the same
 * prediction is sound on the doc surface and unsound on the sheet surface, and the
 * bridge exposes `canUndo` so a caller can tell which it is looking at.
 *
 * This asserts the POSITIVE capability only — that docs really can undo after an
 * edit. It deliberately does NOT assert that sheets cannot: that is a limitation
 * worth fixing, not a contract worth freezing, and pinning it would make an
 * improvement look like a regression. The sheet value is reported, not enforced.
 */
async function checkUndoCapability(page, baseUrl) {
  const problems = [];

  await page.goto(`${baseUrl}/harness/hunt?surface=doc`, { waitUntil: "networkidle" });
  await page.waitForSelector(READY_SELECTOR, { timeout: 20_000 });
  const before = await page.evaluate(() => window.__WB_HUNT__.read("doc.canUndo"));
  if (before !== false) problems.push(`doc.canUndo should be false on a freshly seeded document, got ${JSON.stringify(before)}`);
  await page.getByRole("textbox").first().click();
  await page.keyboard.type("Q");
  await page.waitForTimeout(50);
  const after = await page.evaluate(() => window.__WB_HUNT__.read("doc.canUndo"));
  if (after !== true) problems.push(`doc.canUndo should be true after an edit, got ${JSON.stringify(after)}`);

  await page.goto(`${baseUrl}/harness/hunt?surface=sheet`, { waitUntil: "networkidle" });
  await page.waitForSelector(READY_SELECTOR, { timeout: 20_000 });
  const sheetCanUndo = await page.evaluate(() => window.__WB_HUNT__.read("sheet.canUndo"));
  if (typeof sheetCanUndo !== "boolean") problems.push(`sheet.canUndo must answer with a boolean, got ${JSON.stringify(sheetCanUndo)}`);
  else console.log(`[verify:hunt-oracles] sheet.canUndo reports ${sheetCanUndo} (MemStore has no history — informational)`);

  return problems;
}

async function loadPlaywright() {
  try {
    const mod = await import("playwright");
    if (!mod.chromium) throw new Error("Playwright chromium launcher is unavailable.");
    return mod;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("Cannot find package 'playwright'") || message.includes("Cannot find module 'playwright'")) {
      console.error("[verify:hunt-oracles] Playwright is required. Run `pnpm install`, then");
      console.error("[verify:hunt-oracles] `pnpm --filter @wafflebase/frontend exec playwright install chromium`.");
      process.exit(1);
    }
    throw error;
  }
}

function matches(fired, expected) {
  return fired.some((f) => f.kind === expected.kind && (expected.rule === undefined || f.rule === expected.rule));
}

const playwright = await loadPlaywright();
const server = await createServer({
  configFile: path.resolve(frontendRoot, "vite.config.ts"),
  root: frontendRoot,
  logLevel: "silent",
  server: { host: HOST, port: PORT, strictPort: true },
});

let browser;
const failures = [];
try {
  await server.listen();
  const baseUrl = `http://${HOST}:${PORT}`;
  browser = await playwright.chromium.launch({ headless: true });

  for (const testCase of CASES) {
    // A fresh context per case, so one case's injected damage cannot leak into the
    // next and make a later oracle look like it fired on its own.
    const context = await browser.newContext({
      viewport: { width: 1600, height: 1200 },
      locale: "en-US",
      timezoneId: "UTC",
      colorScheme: "light",
    });
    try {
      const page = await context.newPage();
      await page.route("**/auth/**", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ styles: {} }) }),
      );
      const oracles = attachOracles(page, baseUrl);
      await page.goto(`${baseUrl}/harness/hunt?surface=doc`, { waitUntil: "networkidle" });
      await page.waitForSelector(READY_SELECTOR, { timeout: 20_000 });
      // Drain anything from page load itself. A case asserts about ITS fault, and a
      // load-time event would otherwise be credited to the injection.
      oracles.drain();

      await testCase.inject(page);

      // Positive and negative cases need opposite waiting strategies, and a single
      // fixed sleep gets one of them wrong. Proving something DID happen can stop as
      // soon as it happens, so poll — a fixed delay there is either flaky (too short
      // on a loaded machine) or slow. Proving something did NOT happen has no early
      // exit: the full window must elapse before silence means anything.
      let fired = [];
      if (testCase.expect === null) {
        await page.waitForTimeout(QUIET_WINDOW_MS);
        fired = [...oracles.drain(), ...(await scanDomInvariants(page, HOST_TESTID))];
      } else {
        const deadline = Date.now() + FIRE_DEADLINE_MS;
        // Page-event drains ACCUMULATE (each drain empties the buffer, so an event
        // seen on an earlier poll would be lost); the DOM scan is a fresh snapshot of
        // current state each time and must replace, not append, or a finding would be
        // duplicated once per poll in the failure message.
        const drained = [];
        for (;;) {
          drained.push(...oracles.drain());
          fired = [...drained, ...(await scanDomInvariants(page, HOST_TESTID))];
          if (matches(fired, testCase.expect) || Date.now() >= deadline) break;
          await page.waitForTimeout(25);
        }
      }

      if (testCase.expect === null) {
        if (fired.length > 0) {
          failures.push(`${testCase.name}: expected silence, got ${JSON.stringify(fired)}`);
        } else {
          console.log(`[verify:hunt-oracles] quiet as required: ${testCase.name}`);
        }
      } else if (!matches(fired, testCase.expect)) {
        failures.push(
          `${testCase.name}: expected ${JSON.stringify(testCase.expect)}, got ${JSON.stringify(fired) || "nothing"}`,
        );
      } else {
        console.log(`[verify:hunt-oracles] fired as required: ${testCase.name}`);
      }
    } finally {
      await context.close();
    }
  }

  // Targeting, in its own context so no injected fault from the cases above can
  // perturb the grid it measures.
  const targetingContext = await browser.newContext({
    viewport: { width: 1600, height: 1200 },
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "light",
  });
  try {
    const page = await targetingContext.newPage();
    const problems = await checkCellTargeting(page, baseUrl);
    for (const p of problems) failures.push(`cell targeting: ${p}`);
    if (problems.length === 0) {
      console.log(`[verify:hunt-oracles] cell clicks land correctly: ${TARGETING_CELLS.join(", ")}`);
    }
    const undoProblems = await checkUndoCapability(page, baseUrl);
    for (const p of undoProblems) failures.push(`undo capability: ${p}`);
    if (undoProblems.length === 0) {
      console.log("[verify:hunt-oracles] doc.canUndo tracks a real undo stack");
    }
  } finally {
    await targetingContext.close();
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Executable doesn't exist") || message.includes("download new browsers")) {
    console.error("[verify:hunt-oracles] Chromium is not installed for this Playwright version.");
    console.error("[verify:hunt-oracles] Run `pnpm --filter @wafflebase/frontend exec playwright install chromium`.");
    process.exit(1);
  }
  throw error;
} finally {
  if (browser) await browser.close();
  await server.close();
}

if (failures.length > 0) {
  console.error(`\n[verify:hunt-oracles] ${failures.length} oracle check(s) FAILED:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`[verify:hunt-oracles] all ${CASES.length} oracle checks + cell targeting passed.`);
