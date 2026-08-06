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
  // NOT getByRole("textbox"): on the doc surface that resolves to the editor's hidden
  // IME textarea — `position:fixed;top:0;left:0;width:1px;height:1px;opacity:0`
  // (docs/src/view/text-editor.ts:416-425). Clicking a 1x1 invisible element pinned at
  // the viewport origin happens to work, but it is a caret-placement path no other
  // lane in this repo uses, and Playwright's visibility/stability checks on it are a
  // plausible 30s timeout that would fail the whole lane. The canvas is the real
  // target and is what a user clicks.
  await page.locator(`[data-testid="${HOST_TESTID}"] canvas`).first().click();
  await page.keyboard.type("Q");
  // Poll rather than sleep. The undo stack is pushed asynchronously relative to the
  // keystroke, so a fixed wait is either flaky on a loaded machine or needlessly slow —
  // and this lane gates CI. Same reasoning as the positive oracle cases above.
  let after = null;
  const deadline = Date.now() + FIRE_DEADLINE_MS;
  for (;;) {
    after = await page.evaluate(() => window.__WB_HUNT__.read("doc.canUndo"));
    if (after === true || Date.now() >= deadline) break;
    await page.waitForTimeout(25);
  }
  if (after !== true) {
    problems.push(
      `doc.canUndo was still ${JSON.stringify(after)} after an edit and ${FIRE_DEADLINE_MS}ms of polling — ` +
        "either the bridge reader is broken (harness fault) or docs undo regressed (product fault); " +
        "check MemDocStore's undo stack before assuming either.",
    );
  }

  await page.goto(`${baseUrl}/harness/hunt?surface=sheet`, { waitUntil: "networkidle" });
  await page.waitForSelector(READY_SELECTOR, { timeout: 20_000 });
  const sheetCanUndo = await page.evaluate(() => window.__WB_HUNT__.read("sheet.canUndo"));
  if (typeof sheetCanUndo !== "boolean") problems.push(`sheet.canUndo must answer with a boolean, got ${JSON.stringify(sheetCanUndo)}`);
  else console.log(`[verify:hunt-oracles] sheet.canUndo reports ${sheetCanUndo} (MemStore has no history — informational)`);

  return problems;
}

/**
 * The seeded positive control: does a KNOWN defect actually show up?
 *
 * Everything else in this file is a negative control — it proves the hunter does not
 * report things that are fine. Nothing proved the opposite, and the two failures look
 * identical from outside: a run that finds nothing because the app is healthy and a
 * run that finds nothing because the instrument is dead both print zero.
 *
 * `?fault=drop-second-char` makes the harness swallow every second printable
 * keystroke. Typing `ABCDEF` must therefore produce `ACE`. That is the cleanest
 * possible ground-A shape — the app contradicting the agent's own input — so if the
 * funnel can carry anything, it can carry this.
 *
 * BOTH DIRECTIONS ARE ASSERTED, and the second matters as much as the first. A fault
 * that is always on would make every run report, which is a worse failure than a
 * fault that never fires: it manufactures findings rather than merely missing them.
 */
const FAULT_TYPED = "ABCDEF";
const FAULT_EXPECTED_WITH_FAULT = "ACE";

async function typeIntoDoc(page, baseUrl, query) {
  await page.goto(`${baseUrl}/harness/hunt?surface=doc${query}`, { waitUntil: "networkidle" });
  await page.waitForSelector(READY_SELECTOR, { timeout: 20_000 });
  const before = await page.evaluate(() => window.__WB_HUNT__.read("doc.text"));
  await page.locator(`[data-testid="${HOST_TESTID}"] canvas`).first().click();
  await page.keyboard.type(FAULT_TYPED);
  // Poll for settlement rather than sleeping: the text lands asynchronously relative
  // to the keystrokes, and this lane gates CI.
  let text = before;
  const deadline = Date.now() + FIRE_DEADLINE_MS;
  for (;;) {
    const next = await page.evaluate(() => window.__WB_HUNT__.read("doc.text"));
    if (next !== before && next === text) break;
    text = next;
    if (Date.now() >= deadline) break;
    await page.waitForTimeout(25);
  }
  return { before, after: text };
}

async function checkSeededFault(page, baseUrl) {
  const problems = [];

  // 1. The fault is DECLARED in the DOM, so a seeded run can never be mistaken for a
  //    real one when someone reads a report or a screenshot later.
  await page.goto(`${baseUrl}/harness/hunt?surface=doc&fault=drop-second-char`, { waitUntil: "networkidle" });
  await page.waitForSelector(READY_SELECTOR, { timeout: 20_000 });
  const declared = await page.getAttribute("[data-testid='hunt-harness-root']", "data-hunt-harness-fault");
  if (declared !== "drop-second-char") {
    problems.push(`the active fault must be published on the root, got ${JSON.stringify(declared)}`);
  }

  // 2. An UNKNOWN fault id is ignored, not honoured. The registry is closed, so a
  //    typo must degrade to a clean run rather than to some other defect.
  await page.goto(`${baseUrl}/harness/hunt?surface=doc&fault=not-a-real-fault`, { waitUntil: "networkidle" });
  await page.waitForSelector(READY_SELECTOR, { timeout: 20_000 });
  const unknown = await page.getAttribute("[data-testid='hunt-harness-root']", "data-hunt-harness-fault");
  if (unknown !== "none") problems.push(`an unknown fault id must be ignored, got ${JSON.stringify(unknown)}`);

  // 3. WITH the fault: every second character is dropped.
  const seeded = await typeIntoDoc(page, baseUrl, "&fault=drop-second-char");
  if (!seeded.after.includes(FAULT_EXPECTED_WITH_FAULT)) {
    problems.push(
      `?fault=drop-second-char: typed ${FAULT_TYPED}, expected the document to contain ` +
        `${FAULT_EXPECTED_WITH_FAULT}, got ${JSON.stringify(seeded.after.slice(0, 120))} — the positive ` +
        "control is not injecting, so a clean hunt run proves nothing",
    );
  }
  if (seeded.after.includes(FAULT_TYPED)) {
    problems.push(`?fault=drop-second-char: the full ${FAULT_TYPED} survived, so nothing was dropped`);
  }

  // 4. WITHOUT it: the text arrives intact. This is the half that keeps a
  //    permanently-on fault from turning every run into a false report.
  const clean = await typeIntoDoc(page, baseUrl, "");
  if (!clean.after.includes(FAULT_TYPED)) {
    problems.push(
      `the CLEAN route dropped characters: typed ${FAULT_TYPED}, got ` +
        `${JSON.stringify(clean.after.slice(0, 120))} — either the fault leaked across navigations or ` +
        "typing is genuinely broken, and those need opposite responses",
    );
  }

  return problems;
}

/**
 * The join nothing else covers: does a REAL reader value, produced by the real
 * runner, actually drive the prediction protocol to a violated verdict?
 *
 * Every piece either side of this line is unit-tested. `assessExpectation` is tested
 * against hand-written journals, and the runner is tested against scripted
 * observations. Neither proves they fit, and a hand-written fixture asserting a
 * property the pipeline does not have is the single most repeated defect in this
 * whole build — a test named for a property, passing, while the property was false.
 *
 * So this drives `runUiPlan` (a real browser, a real journal) and hands the result to
 * `assessExpectation` unmodified. It costs one extra Vite+Chromium boot (~7s) and
 * that is the price of exercising the real producer rather than a stand-in.
 *
 * The plan is the canonical ground-A shape: type something, then on a LATER action
 * predict that the document still contains it, traced to `@input:` — the agent's own
 * keystrokes. With the fault seeded that must be `violated` AND `eligible`; without
 * it, `held`. Both directions, because a protocol that always violates is worse than
 * one that never does.
 */
const FUNNEL_PLAN = {
  actions: [
    { type: "goto", surface: "doc" },
    { type: "read", reader: "doc.text" },
    { type: "type", text: FAULT_TYPED },
    {
      type: "type",
      text: "!",
      expect: {
        read: "doc.text",
        op: "contains",
        value: "@input:2",
        ground: "A",
        because: "the document must still contain what I typed a moment ago",
      },
    },
  ],
};

async function checkPredictionFunnel(repoRoot) {
  const problems = [];
  const { runUiPlan } = await import(`${repoRoot}/scripts/agent/hunt-ui-probe.mjs`);
  const { assessExpectation } = await import(`${repoRoot}/scripts/agent/hunt-ui-expect.mjs`);

  // The journal the MCP tool would have built, assembled from what the runner
  // actually returned — never hand-authored, which is the entire point.
  const journalFrom = (observations) =>
    observations.map((o, i) => ({
      action: FUNNEL_PLAN.actions[i],
      ok: o.ok === true,
      value: o.value,
      error: o.ok ? undefined : o.error,
      oracles: o.oracles ?? [],
    }));

  for (const [label, fault, wantVerdict] of [
    ["seeded", "drop-second-char", "violated"],
    ["clean", null, "held"],
  ]) {
    let observations;
    try {
      observations = runUiPlan(FUNNEL_PLAN, { repoRoot, attempts: 1, fault })[0];
    } catch (error) {
      problems.push(`${label}: the plan could not run — ${error.message}`);
      continue;
    }
    const atIndex = FUNNEL_PLAN.actions.length - 1;
    const failing = observations[atIndex];
    const prediction = assessExpectation(FUNNEL_PLAN.actions[atIndex].expect, failing?.actual, {
      journal: journalFrom(observations),
      snapshot: "",
      charter: {},
      actualError: failing?.actualError ?? null,
      atIndex,
    });
    if (prediction.verdict !== wantVerdict) {
      problems.push(
        `${label}: expected the prediction to be ${wantVerdict}, got ${prediction.verdict}` +
          ` (${prediction.detail ?? "no detail"}); read back ${JSON.stringify(String(failing?.actual).slice(0, 80))}`,
      );
    }
    // A violation that is not ELIGIBLE never becomes a candidate, so a funnel that
    // violates but grounds nothing is still a dead instrument.
    if (wantVerdict === "violated" && prediction.eligible !== true) {
      problems.push(
        `${label}: the violation was not eligible — ${prediction.why ?? "no reason given"}. A ground-A ` +
          "prediction traced to the agent's own input must ground, or nothing can ever be reported.",
      );
    }
  }
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
    const faultProblems = await checkSeededFault(page, baseUrl);
    for (const p of faultProblems) failures.push(`seeded fault: ${p}`);
    if (faultProblems.length === 0) {
      console.log("[verify:hunt-oracles] ?fault=drop-second-char injects, and the clean route does not");
    }
  } finally {
    await targetingContext.close();
  }

  // Outside the context above: this one drives `runUiPlan`, which owns its own
  // browser and its own Vite. It is the last check because it is the slowest.
  const funnelProblems = await checkPredictionFunnel(path.resolve(frontendRoot, "..", ".."));
  for (const p of funnelProblems) failures.push(`prediction funnel: ${p}`);
  if (funnelProblems.length === 0) {
    console.log("[verify:hunt-oracles] a real reader value drives a ground-A prediction to violated, and holds when clean");
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
console.log(
  `[verify:hunt-oracles] all ${CASES.length} oracle checks + cell targeting + undo capability + seeded fault + prediction funnel passed.`,
);
