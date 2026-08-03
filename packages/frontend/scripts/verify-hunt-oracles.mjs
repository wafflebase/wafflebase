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
    // The other scoping rule: a user's DOCUMENT may legitimately contain the word
    // "undefined". Only the application's own chrome may not. Without this the first
    // thing a typing agent does is trip the oracle on its own input.
    name: "placeholder-text STAYS QUIET inside the editor host",
    expect: null,
    inject: async (page) => {
      await page.evaluate((hostTestId) => {
        const host = document.querySelector(`[data-testid="${hostTestId}"]`);
        const el = document.createElement("div");
        el.textContent = "the user typed undefined here";
        host?.appendChild(el);
      }, HOST_TESTID);
    },
  },
];

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
      await page.waitForTimeout(120);
      const fired = [...oracles.drain(), ...(await scanDomInvariants(page, HOST_TESTID))];

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
console.log(`[verify:hunt-oracles] all ${CASES.length} oracle checks passed.`);
