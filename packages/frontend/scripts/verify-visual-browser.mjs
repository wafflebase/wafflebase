import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createServer } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");
const baselineDir = path.resolve(frontendRoot, "tests/visual/baselines");
const host = "127.0.0.1";
const port = Number(process.env.VISUAL_BROWSER_PORT || 4175);
const targetUrl = `http://${host}:${port}/harness/visual`;
const updateBaseline = process.env.UPDATE_VISUAL_BROWSER_BASELINE === "true";

const scenarioIds = [
  "sheet-freeze-selection",
  "sheet-overflow-clip",
  "sheet-merge-layout",
  "sheet-formula-errors",
  "sheet-dimensions-freeze",
];

const visualTargets = [
  {
    id: "harness-root",
    locator: "[data-testid='visual-harness-root']",
    baselineFile: "harness-visual.browser.png",
  },
  ...scenarioIds.map((scenarioId) => ({
    id: scenarioId,
    locator: `[data-visual-scenario-id='${scenarioId}']`,
    baselineFile: `harness-visual.browser.${scenarioId}.png`,
  })),
];

function shortHash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function baselinePathFor(target) {
  return path.resolve(baselineDir, target.baselineFile);
}

function actualPathFor(target) {
  const parsed = path.parse(target.baselineFile);
  return path.resolve(baselineDir, `${parsed.name}.actual${parsed.ext}`);
}

function printPlaywrightInstallHelp() {
  console.error(
    "[verify:visual:browser] Playwright is required for browser visual checks.",
  );
  console.error(
    "[verify:visual:browser] Install project dependencies first: `pnpm install`.",
  );
  console.error(
    "[verify:visual:browser] Install Chromium once per environment: " +
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

async function readBaseline(target) {
  try {
    return await readFile(baselinePathFor(target));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function captureScreenshots(playwright) {
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
      viewport: { width: 1800, height: 3400 },
      deviceScaleFactor: 1,
      locale: "en-US",
      timezoneId: "UTC",
      colorScheme: "light",
    });

    const page = await context.newPage();
    await page.goto(targetUrl, { waitUntil: "networkidle" });
    await page.addStyleTag({
      content:
        "*,*::before,*::after{animation:none!important;transition:none!important;}",
    });
    await page.evaluate(async () => {
      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      }
    });

    const root = page.locator("[data-testid='visual-harness-root']");
    await root.waitFor({ state: "visible" });

    const sheetSection = page.locator(
      "[data-testid='visual-harness-sheet-section'][data-visual-sheet-ready='true']",
    );
    await sheetSection.waitFor({ state: "visible", timeout: 20000 });

    const captures = new Map();
    for (const target of visualTargets) {
      const locator = page.locator(target.locator).first();
      await locator.waitFor({ state: "visible" });
      const screenshot = await locator.screenshot({
        type: "png",
        animations: "disabled",
      });
      captures.set(target.id, screenshot);
    }

    await context.close();
    return captures;
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
}

const playwright = await loadPlaywright();
const capturedById = await captureScreenshots(playwright);

await mkdir(baselineDir, { recursive: true });

if (updateBaseline) {
  for (const target of visualTargets) {
    const captured = capturedById.get(target.id);
    if (!captured) {
      throw new Error(`Missing captured screenshot for ${target.id}.`);
    }
    const baselinePath = baselinePathFor(target);
    await writeFile(baselinePath, captured);
    console.log(`[verify:visual:browser] Updated baseline ${target.baselineFile}.`);
  }
  process.exit(0);
}

const missingTargets = [];
const mismatchedTargets = [];

for (const target of visualTargets) {
  const baseline = await readBaseline(target);
  if (!baseline) {
    missingTargets.push(target);
    continue;
  }

  const captured = capturedById.get(target.id);
  if (!captured) {
    throw new Error(`Missing captured screenshot for ${target.id}.`);
  }

  if (baseline.equals(captured)) {
    console.log(
      `[verify:visual:browser] Baseline matched ${target.baselineFile} (${shortHash(captured)}).`,
    );
    continue;
  }

  const actualPath = actualPathFor(target);
  await writeFile(actualPath, captured);
  mismatchedTargets.push({
    target,
    baselineHash: shortHash(baseline),
    actualHash: shortHash(captured),
    actualPath,
  });
}

if (missingTargets.length > 0) {
  console.error("[verify:visual:browser] Missing baseline screenshots:");
  for (const target of missingTargets) {
    console.error(`- ${target.baselineFile}`);
  }
}

if (mismatchedTargets.length > 0) {
  console.error("[verify:visual:browser] Visual baseline mismatches detected:");
  for (const mismatch of mismatchedTargets) {
    console.error(`- ${mismatch.target.baselineFile}`);
    console.error(`  baseline hash: ${mismatch.baselineHash}`);
    console.error(`  actual hash:   ${mismatch.actualHash}`);
    console.error(`  actual output: ${mismatch.actualPath}`);
  }
}

if (missingTargets.length > 0 || mismatchedTargets.length > 0) {
  console.error(
    "[verify:visual:browser] Inspect mismatches and refresh intended baselines: " +
      "`pnpm frontend test:visual:browser:update`.",
  );
  process.exit(1);
}

console.log(
  `[verify:visual:browser] All ${visualTargets.length} visual targets matched.`,
);
