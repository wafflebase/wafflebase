import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");
const host = "127.0.0.1";
const port = Number(process.env.INTERACTION_BROWSER_PORT || 4176);
const targetUrl = `http://${host}:${port}/harness/interaction`;
const bridgeKey = "__WB_INTERACTION__";

function printPlaywrightInstallHelp() {
  console.error(
    "[verify:interaction:browser] Playwright is required for browser interaction checks.",
  );
  console.error(
    "[verify:interaction:browser] Install project dependencies first: `pnpm install`.",
  );
  console.error(
    "[verify:interaction:browser] Install Chromium once per environment: " +
      "`pnpm --filter @wafflebase/frontend exec playwright install chromium`",
  );
}

async function loadPlaywright() {
  try {
    const module = await import("playwright");
    if (!module.chromium) {
      throw new Error("Playwright chromium launcher is unavailable.");
    }
    return module;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const isMissingPackage =
      message.includes("Cannot find package 'playwright'") ||
      message.includes("Cannot find module 'playwright'");
    if (isMissingPackage) {
      printPlaywrightInstallHelp();
      process.exit(1);
    }
    throw error;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[verify:interaction:browser] ${message}`);
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
    `[verify:interaction:browser] Timed out waiting for ${description}.${reason}`,
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
  console.log("[verify:interaction:browser] Scenario passed: value input commit.");
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
  console.log("[verify:interaction:browser] Scenario passed: formula input commit.");
}

async function runWheelScrollScenario(page) {
  // Reset any auto-scroll on the host div caused by prior focus operations.
  // Browsers auto-scroll overflow:hidden containers when focusing elements,
  // which shifts the internal scroll container out of the viewport.
  await page.evaluate(() => {
    const host = document.querySelector("[data-testid='interaction-sheet-host']");
    if (host) {
      host.scrollTop = 0;
      host.scrollLeft = 0;
    }
  });

  const before = await bridgeCall(page, "getScrollPosition");
  const point = await bridgeCall(page, "getScrollContainerCenterClientPoint");
  assert(!!point, "scroll container center point is unavailable");

  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, 1200);

  await waitForPredicate("vertical wheel scroll movement", async () => {
    const next = await bridgeCall(page, "getScrollPosition");
    return next.top > before.top + 1;
  });

  const after = await bridgeCall(page, "getScrollPosition");
  console.log(
    `[verify:interaction:browser] Scenario passed: wheel scroll ${before.top} -> ${after.top}.`,
  );
}

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
  browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1200 },
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "light",
  });

  try {
    const page = await context.newPage();
    await waitForHarnessReady(page);
    await runCellInputScenario(page);
    await runFormulaScenario(page);
    await runWheelScrollScenario(page);
    console.log("[verify:interaction:browser] All interaction scenarios passed.");
  } finally {
    await context.close();
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const needsBrowserInstall =
    message.includes("Executable doesn't exist") ||
    message.includes("Please run the following command to download new browsers");
  if (needsBrowserInstall) {
    printPlaywrightInstallHelp();
    process.exit(1);
  }
  throw error;
} finally {
  if (browser) {
    await browser.close();
  }
  await server.close();
}
