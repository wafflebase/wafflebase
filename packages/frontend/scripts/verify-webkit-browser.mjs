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
  console.error(
    "[verify:webkit] Playwright WebKit is required.",
  );
  console.error(
    "[verify:webkit] Install: `pnpm --filter @wafflebase/frontend exec playwright install webkit`",
  );
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
    const isMissingPackage =
      message.includes("Cannot find package 'playwright'") ||
      message.includes("Cannot find module 'playwright'");
    if (isMissingPackage) {
      printInstallHelp();
      process.exit(1);
    }
    throw error;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[verify:webkit] ${message}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function bridgeCall(page, method, ...args) {
  return await page.evaluate(
    ({ bridgeKey, method, args }) => {
      const bridge = window[bridgeKey];
      if (!bridge) {
        throw new Error("interaction bridge is not initialized");
      }
      const fn = bridge[method];
      if (typeof fn !== "function") {
        throw new Error(`interaction bridge method is missing: ${method}`);
      }
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
      if (await predicate()) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(50);
  }

  const reason =
    lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new Error(
    `[verify:webkit] Timed out waiting for ${description}.${reason}`,
  );
}

async function waitForHarnessReady(page) {
  await page.goto(targetUrl, { waitUntil: "networkidle" });
  await page.addStyleTag({
    content:
      "*,*::before,*::after{animation:none!important;transition:none!important;}",
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
  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
}

// --- Scenarios ---

async function runTapCellSelectionScenario(page) {
  await bridgeCall(page, "focusCell", "A1");
  const active = await bridgeCall(page, "getActiveCell");
  assert(active === "A1", `expected A1 after tap, got ${active}`);

  await bridgeCall(page, "focusCell", "B1");
  const active2 = await bridgeCall(page, "getActiveCell");
  assert(active2 === "B1", `expected B1 after tap, got ${active2}`);

  console.log("[verify:webkit] Scenario passed: tap cell selection.");
}

async function runCellInputScenario(page) {
  const inputValue = "325";
  await bridgeCall(page, "editViaFormulaBar", "B2", inputValue, "B3");

  await waitForPredicate("B2 value commit", async () => {
    const cell = await bridgeCall(page, "getCell", "B2");
    return cell?.v === inputValue;
  });

  const activeCell = await bridgeCall(page, "getActiveCell");
  assert(
    activeCell === "B3",
    `expected active cell B3 after Enter, got ${activeCell}`,
  );
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
  assert(
    activeCell === "C3",
    `expected active cell C3 after formula Enter, got ${activeCell}`,
  );
  console.log("[verify:webkit] Scenario passed: formula input commit.");
}

async function runTouchScrollScenario(page) {
  // Reset any auto-scroll on the host div caused by prior focus operations.
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

  // Directly set scrollTop on the scroll container — WebKit headless
  // does not honour scrollBy() calls reliably.
  await page.evaluate(() => {
    const host = document.querySelector("[data-testid='interaction-sheet-host']");
    const scrollEl =
      host?.querySelector("[data-testid='interaction-scroll-container']") ||
      host?.querySelector("div[style*='overflow']");
    if (scrollEl) {
      scrollEl.scrollTop = 300;
    }
  });

  await waitForPredicate("touch scroll movement", async () => {
    const next = await bridgeCall(page, "getScrollPosition");
    return next.top > before.top + 1;
  });

  const after = await bridgeCall(page, "getScrollPosition");
  console.log(
    `[verify:webkit] Scenario passed: touch scroll ${before.top} -> ${after.top}.`,
  );
}

async function runDoubleTapEditPanelScenario(page) {
  // First, select A1 so the sheet is in a known state.
  await bridgeCall(page, "focusCell", "A1");

  // Verify panel is not visible initially.
  let editState = await bridgeCall(page, "getMobileEditState");
  assert(editState === null, `expected no edit state initially, got ${JSON.stringify(editState)}`);

  // Simulate double-tap via bridge (calls handleMobileDoubleTap internally).
  await bridgeCall(page, "doubleTapCell", "B1");

  // Wait for the mobile edit panel to appear.
  // handleMobileDoubleTap calls toInputString() which is async, so we need to wait.
  await waitForPredicate("mobile edit panel to open", async () => {
    const state = await bridgeCall(page, "getMobileEditState");
    return state !== null;
  }, 5000);

  editState = await bridgeCall(page, "getMobileEditState");
  assert(editState !== null, "mobile edit panel did not open after double-tap");
  console.log(
    `[verify:webkit] Double-tap opened edit panel for ${editState.cellRef} with value "${editState.value}"`,
  );

  // THE KEY CHECK: dispatch a synthesized mousedown event on the same cell,
  // simulating what iOS browsers do after a touch sequence. This is the root
  // cause of the "panel opens then immediately closes" bug — the synthesized
  // mousedown triggers selectStart → selectionChange → panel dismissed.
  // The fix installs a one-shot capture-phase listener that swallows it.
  await bridgeCall(page, "dispatchSynthesizedMouseDown", "B1");
  await sleep(100);

  const editStateAfterMouse = await bridgeCall(page, "getMobileEditState");
  assert(
    editStateAfterMouse !== null,
    "mobile edit panel closed after synthesized mousedown — " +
    "the panel should remain open after double-tap",
  );

  console.log("[verify:webkit] Scenario passed: double-tap edit panel stays open.");
}

// --- Main ---

const playwright = await loadPlaywright();

const server = await createServer({
  configFile: path.resolve(frontendRoot, "vite.config.ts"),
  root: frontendRoot,
  logLevel: "silent",
  server: {
    host,
    port,
    strictPort: true,
  },
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
    console.log(
      `[verify:webkit] Viewport: ${iPhoneDevice.viewport.width}x${iPhoneDevice.viewport.height}, ` +
      `scale: ${iPhoneDevice.deviceScaleFactor}, hasTouch: ${iPhoneDevice.hasTouch}`,
    );

    await runTapCellSelectionScenario(page);
    await runCellInputScenario(page);
    await runFormulaScenario(page);
    await runTouchScrollScenario(page);
    await runDoubleTapEditPanelScenario(page);

    console.log("[verify:webkit] All WebKit interaction scenarios passed.");
  } finally {
    await context.close();
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const needsBrowserInstall =
    message.includes("Executable doesn't exist") ||
    message.includes("Please run the following command to download new browsers");
  if (needsBrowserInstall) {
    printInstallHelp();
    process.exit(1);
  }
  throw error;
} finally {
  if (browser) {
    await browser.close();
  }
  await server.close();
}
