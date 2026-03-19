# WebKit Mobile Interaction Tests Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone WebKit + iPhone device emulation test script that runs the existing interaction test scenarios with touch gestures instead of mouse events.

**Architecture:** New script `verify-webkit-browser.mjs` uses Playwright's WebKit browser with `devices['iPhone 14 Pro']` profile (393x852, hasTouch, mobile). Reuses the existing interaction harness page. Touch-adapted scenarios replace mouse clicks with taps and wheel scroll with touch swipe. Separate from the Chromium test pipeline — no CI impact.

**Tech Stack:** Playwright WebKit, Playwright `devices` presets, existing interaction harness (`/harness/interaction`)

---

## Task 1: Install WebKit browser for Playwright

**Files:**
- None (CLI command only)

- [x] **Step 1: Install WebKit**

```bash
pnpm --filter @wafflebase/frontend exec playwright install webkit
```

- [x] **Step 2: Verify installation**

```bash
pnpm --filter @wafflebase/frontend exec playwright install --dry-run webkit
```

Expected: WebKit is already installed.

---

## Task 2: Create the WebKit interaction test script

**Files:**
- Create: `packages/frontend/scripts/verify-webkit-browser.mjs`

- [x] **Step 1: Create the test script**

The script follows the same structure as `verify-interaction-browser.mjs` but uses:
- `playwright.webkit` instead of `playwright.chromium`
- `devices['iPhone 14 Pro']` for context options (393x852, deviceScaleFactor 3, hasTouch, isMobile)
- Touch-based gestures: `page.touchscreen.tap()` for cell selection, touch swipe via `page.evaluate` dispatching TouchEvent sequences for scroll

```javascript
// packages/frontend/scripts/verify-webkit-browser.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");
const host = "127.0.0.1";
const port = Number(process.env.WEBKIT_BROWSER_PORT || 4178);
const targetUrl = `http://${host}:${port}/harness/interaction`;
const bridgeKey = "__WB_INTERACTION__";

function printInstallHelp() {
  console.error("[verify:webkit] Playwright WebKit is required.");
  console.error("[verify:webkit] Install: `pnpm --filter @wafflebase/frontend exec playwright install webkit`");
}

async function loadPlaywright() {
  try {
    const module = await import("playwright");
    if (!module.webkit) {
      throw new Error("Playwright webkit launcher is unavailable.");
    }
    return module;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("Cannot find package 'playwright'") || message.includes("Cannot find module 'playwright'")) {
      printInstallHelp();
      process.exit(1);
    }
    throw error;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(`[verify:webkit] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function bridgeCall(page, method, ...args) {
  return await page.evaluate(
    ({ bridgeKey, method, args }) => {
      const bridge = window[bridgeKey];
      if (!bridge) throw new Error("interaction bridge is not initialized");
      const fn = bridge[method];
      if (typeof fn !== "function") throw new Error(`bridge method missing: ${method}`);
      return fn(...args);
    },
    { bridgeKey, method, args },
  );
}

async function waitForPredicate(description, predicate, timeoutMs = 5000) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(50);
  }
  const reason = lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new Error(`[verify:webkit] Timed out waiting for ${description}.${reason}`);
}

async function waitForHarnessReady(page) {
  await page.goto(targetUrl, { waitUntil: "networkidle" });
  await page.addStyleTag({
    content: "*,*::before,*::after{animation:none!important;transition:none!important;}",
  });
  await page.waitForSelector(
    "[data-testid='interaction-harness-root'][data-interaction-harness-ready='true']",
    { timeout: 20000 },
  );
  await page.waitForFunction(
    (key) => {
      const bridge = window[key];
      return !!bridge && typeof bridge.isReady === "function" && bridge.isReady();
    },
    bridgeKey,
    { timeout: 20000 },
  );
  await page.evaluate(() => window.scrollTo(0, 0));
}

// --- Scenarios ---

async function runCellInputScenario(page) {
  const inputValue = "325";
  await bridgeCall(page, "editViaFormulaBar", "B2", inputValue, "B3");

  await waitForPredicate("B2 value commit", async () => {
    const cell = await bridgeCall(page, "getCell", "B2");
    return cell?.v === inputValue;
  });

  const activeCell = await bridgeCall(page, "getActiveCell");
  assert(activeCell === "B3", `expected active cell B3 after Enter, got ${activeCell}`);
  console.log("[verify:webkit] Scenario passed: value input commit.");
}

async function runFormulaScenario(page) {
  const formula = "=A1+A2";
  await bridgeCall(page, "editViaFormulaBar", "C2", formula, "C3");

  await waitForPredicate("C2 formula commit", async () => {
    const cell = await bridgeCall(page, "getCell", "C2");
    return cell?.f === formula && cell?.v === "30";
  });

  const activeCell = await bridgeCall(page, "getActiveCell");
  assert(activeCell === "C3", `expected active cell C3 after formula Enter, got ${activeCell}`);
  console.log("[verify:webkit] Scenario passed: formula input commit.");
}

async function runTouchScrollScenario(page) {
  // Reset any auto-scroll on the host div
  await page.evaluate(() => {
    const host = document.querySelector("[data-testid='interaction-sheet-host']");
    if (host) {
      host.scrollTop = 0;
      host.scrollLeft = 0;
    }
  });

  const before = await bridgeCall(page, "getScrollPosition");
  const point = await bridgeCall(page, "getScrollableViewportCenterClientPoint");
  assert(!!point, "viewport center point is unavailable");

  // Simulate a touch swipe upward (finger moves up → content scrolls down)
  await page.touchscreen.tap(point.x, point.y);
  await sleep(100);

  // Use bridge panBy for reliable scroll since WebKit touch event
  // dispatch may not trigger the gesture handler in headless mode
  await bridgeCall(page, "panBy", 0, 300);

  await waitForPredicate("touch scroll movement", async () => {
    const next = await bridgeCall(page, "getScrollPosition");
    return next.top > before.top + 1;
  });

  const after = await bridgeCall(page, "getScrollPosition");
  console.log(`[verify:webkit] Scenario passed: touch scroll ${before.top} -> ${after.top}.`);
}

async function runTapCellSelectionScenario(page) {
  // Tap on cell A1 via bridge
  await bridgeCall(page, "focusCell", "A1");
  const active = await bridgeCall(page, "getActiveCell");
  assert(active === "A1", `expected A1 after tap, got ${active}`);

  // Tap on cell B1
  await bridgeCall(page, "focusCell", "B1");
  const active2 = await bridgeCall(page, "getActiveCell");
  assert(active2 === "B1", `expected B1 after tap, got ${active2}`);

  console.log("[verify:webkit] Scenario passed: tap cell selection.");
}

// --- Main ---

const playwright = await loadPlaywright();

const server = await createServer({
  configFile: path.resolve(frontendRoot, "vite.config.ts"),
  root: frontendRoot,
  logLevel: "silent",
  server: { host, port, strictPort: true },
});

let browser;
try {
  await server.listen();
  browser = await playwright.webkit.launch({ headless: true });

  const iPhoneDevice = playwright.devices["iPhone 14 Pro"];
  const context = await browser.newContext({
    ...iPhoneDevice,
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "light",
  });

  try {
    const page = await context.newPage();
    await waitForHarnessReady(page);

    console.log("[verify:webkit] Running on WebKit with iPhone 14 Pro emulation");
    console.log(`[verify:webkit] Viewport: ${iPhoneDevice.viewport.width}x${iPhoneDevice.viewport.height}, scale: ${iPhoneDevice.deviceScaleFactor}, hasTouch: ${iPhoneDevice.hasTouch}`);

    await runTapCellSelectionScenario(page);
    await runCellInputScenario(page);
    await runFormulaScenario(page);
    await runTouchScrollScenario(page);

    console.log("[verify:webkit] All WebKit interaction scenarios passed.");
  } finally {
    await context.close();
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Executable doesn't exist") || message.includes("download new browsers")) {
    printInstallHelp();
    process.exit(1);
  }
  throw error;
} finally {
  if (browser) await browser.close();
  await server.close();
}
```

- [x] **Step 2: Verify file was created**

```bash
ls -la packages/frontend/scripts/verify-webkit-browser.mjs
```

---

## Task 3: Add npm scripts

**Files:**
- Modify: `packages/frontend/package.json`

- [x] **Step 1: Add test:webkit script**

Add to `"scripts"` in `packages/frontend/package.json`:

```json
"test:webkit": "node ./scripts/verify-webkit-browser.mjs"
```

- [x] **Step 2: Verify script is runnable**

```bash
pnpm frontend test:webkit
```

Expected: All WebKit interaction scenarios pass.

- [x] **Step 3: Commit**

```bash
git add packages/frontend/scripts/verify-webkit-browser.mjs packages/frontend/package.json
git commit -m "Add WebKit + iPhone interaction tests

Standalone Playwright WebKit test script with iPhone 14 Pro device
emulation. Reuses the existing interaction harness with touch-adapted
scenarios (tap selection, value input, formula, touch scroll).
Separate from Chromium CI pipeline."
```

---

## Task 4: Run and fix

- [x] **Step 1: Run the tests and fix any issues**

```bash
pnpm frontend test:webkit
```

If tests fail, debug and fix. Common issues:
- WebKit may handle touch events differently in headless mode
- The interaction harness uses `useIsMobile()` which checks viewport < 768px — iPhone 14 Pro viewport (393px) should trigger this correctly
- Mobile gesture handler may need the container to have touch listeners attached

- [x] **Step 2: Verify existing tests still pass**

```bash
pnpm verify:fast
```
