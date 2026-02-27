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
const captureProfiles = [
  {
    id: "desktop",
    viewport: { width: 1800, height: 3400 },
    colorScheme: "light",
  },
  {
    id: "mobile",
    viewport: { width: 430, height: 4200 },
    colorScheme: "light",
  },
];

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

function captureKey(profileId, targetId) {
  return `${profileId}:${targetId}`;
}

function baselineFilenameFor(target, profile) {
  if (profile.id === "desktop") {
    return target.baselineFile;
  }
  const parsed = path.parse(target.baselineFile);
  return `${parsed.name}.${profile.id}${parsed.ext}`;
}

function baselinePathFor(target, profile) {
  return path.resolve(baselineDir, baselineFilenameFor(target, profile));
}

function actualPathFor(target, profile) {
  const parsed = path.parse(baselineFilenameFor(target, profile));
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

async function readBaseline(target, profile) {
  try {
    return await readFile(baselinePathFor(target, profile));
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

    const captures = new Map();

    for (const profile of captureProfiles) {
      const context = await browser.newContext({
        viewport: profile.viewport,
        deviceScaleFactor: 1,
        locale: "en-US",
        timezoneId: "UTC",
        colorScheme: profile.colorScheme,
      });

      try {
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

        for (const target of visualTargets) {
          const locator = page.locator(target.locator).first();
          await locator.waitFor({ state: "visible" });
          const screenshot = await locator.screenshot({
            type: "png",
            animations: "disabled",
          });
          captures.set(captureKey(profile.id, target.id), screenshot);
        }
      } finally {
        await context.close();
      }
    }

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
  for (const profile of captureProfiles) {
    for (const target of visualTargets) {
      const captured = capturedById.get(captureKey(profile.id, target.id));
      if (!captured) {
        throw new Error(`Missing captured screenshot for ${captureKey(profile.id, target.id)}.`);
      }
      const baselinePath = baselinePathFor(target, profile);
      const baselineFile = baselineFilenameFor(target, profile);
      await writeFile(baselinePath, captured);
      console.log(`[verify:visual:browser] Updated baseline ${baselineFile}.`);
    }
  }
  process.exit(0);
}

const missingTargets = [];
const mismatchedTargets = [];

for (const profile of captureProfiles) {
  for (const target of visualTargets) {
    const baseline = await readBaseline(target, profile);
    const baselineFile = baselineFilenameFor(target, profile);

    if (!baseline) {
      missingTargets.push({ profile, target, baselineFile });
      continue;
    }

    const captured = capturedById.get(captureKey(profile.id, target.id));
    if (!captured) {
      throw new Error(`Missing captured screenshot for ${captureKey(profile.id, target.id)}.`);
    }

    if (baseline.equals(captured)) {
      console.log(
        `[verify:visual:browser] Baseline matched ${baselineFile} (${shortHash(captured)}).`,
      );
      continue;
    }

    const actualPath = actualPathFor(target, profile);
    await writeFile(actualPath, captured);
    mismatchedTargets.push({
      baselineFile,
      baselineHash: shortHash(baseline),
      actualHash: shortHash(captured),
      actualPath,
    });
  }
}

if (missingTargets.length > 0) {
  console.error("[verify:visual:browser] Missing baseline screenshots:");
  for (const missing of missingTargets) {
    console.error(`- ${missing.baselineFile}`);
  }
}

if (mismatchedTargets.length > 0) {
  console.error("[verify:visual:browser] Visual baseline mismatches detected:");
  for (const mismatch of mismatchedTargets) {
    console.error(`- ${mismatch.baselineFile}`);
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
  `[verify:visual:browser] All ${visualTargets.length * captureProfiles.length} profile targets matched.`,
);
