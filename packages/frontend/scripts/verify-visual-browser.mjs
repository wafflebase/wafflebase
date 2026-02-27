import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createServer } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");
const baselineDir = path.resolve(frontendRoot, "tests/visual/baselines");
const baselinePath = path.resolve(baselineDir, "harness-visual.browser.png");
const actualPath = path.resolve(
  baselineDir,
  "harness-visual.browser.actual.png",
);
const host = "127.0.0.1";
const port = Number(process.env.VISUAL_BROWSER_PORT || 4175);
const targetUrl = `http://${host}:${port}/harness/visual`;
const updateBaseline =
  process.env.UPDATE_VISUAL_BROWSER_BASELINE === "true";

function shortHash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function printPlaywrightInstallHelp() {
  console.error(
    "[verify:visual:browser] Playwright is required for browser visual checks.",
  );
  console.error(
    "[verify:visual:browser] Install dependency: " +
      "`pnpm --filter @wafflebase/frontend add -D playwright`",
  );
  console.error(
    "[verify:visual:browser] Install browser: " +
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

async function readBaseline() {
  try {
    return await readFile(baselinePath);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function captureScreenshot(playwright) {
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
      viewport: { width: 1440, height: 1200 },
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
    const screenshot = await root.screenshot({
      type: "png",
      animations: "disabled",
    });
    await context.close();
    return screenshot;
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
const actual = await captureScreenshot(playwright);

await mkdir(baselineDir, { recursive: true });

if (updateBaseline) {
  await writeFile(baselinePath, actual);
  console.log(
    "[verify:visual:browser] Updated baseline at " + `${baselinePath}.`,
  );
  process.exit(0);
}

const baseline = await readBaseline();
if (!baseline) {
  console.error(
    "[verify:visual:browser] Baseline screenshot is missing. Run " +
      "`pnpm frontend test:visual:browser:update` to create it.",
  );
  process.exit(1);
}

if (baseline.equals(actual)) {
  console.log(
    "[verify:visual:browser] Baseline matched " +
      `(${shortHash(actual)}).`,
  );
  process.exit(0);
}

await writeFile(actualPath, actual);
console.error("[verify:visual:browser] Visual baseline mismatch detected.");
console.error(
  `[verify:visual:browser] baseline hash: ${shortHash(baseline)}`,
);
console.error(
  `[verify:visual:browser] actual hash:   ${shortHash(actual)}`,
);
console.error(
  "[verify:visual:browser] Inspect the mismatch and update baseline if " +
    "intended: `pnpm frontend test:visual:browser:update`.",
);
console.error(
  `[verify:visual:browser] Wrote actual output to ${actualPath}.`,
);
process.exit(1);
