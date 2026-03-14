import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");
const docsImagesDir = path.resolve(frontendRoot, "../docs/public/images");
const host = "127.0.0.1";
const port = Number(process.env.DOCS_SCREENSHOT_PORT || 4177);
const targetUrl = `http://${host}:${port}/harness/docs`;

const scenarios = [
  {
    id: "getting-started-contact-list",
    file: "getting-started-contact-list.png",
  },
  {
    id: "budget-complete",
    file: "budget-complete.png",
  },
  {
    id: "formula-examples",
    file: "formula-examples.png",
  },
];

async function loadPlaywright() {
  try {
    const module = await import("playwright");
    if (!module.chromium) {
      throw new Error("Playwright chromium launcher is unavailable.");
    }
    return module;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (
      message.includes("Cannot find package 'playwright'") ||
      message.includes("Cannot find module 'playwright'")
    ) {
      console.error(
        "[docs:screenshots] Playwright is required. Run: pnpm install && pnpm frontend exec playwright install chromium",
      );
      process.exit(1);
    }
    throw error;
  }
}

async function captureScreenshots(playwright) {
  const server = await createServer({
    configFile: path.resolve(frontendRoot, "vite.config.ts"),
    root: frontendRoot,
    logLevel: "silent",
    server: { host, port, strictPort: true },
  });

  let browser;
  try {
    await server.listen();
    browser = await playwright.chromium.launch({ headless: true });

    const context = await browser.newContext({
      viewport: { width: 900, height: 600 },
      deviceScaleFactor: 2,
      locale: "en-US",
      timezoneId: "UTC",
      colorScheme: "light",
    });

    const page = await context.newPage();
    await page.goto(targetUrl, { waitUntil: "networkidle" });

    // Disable animations and wait for fonts
    await page.addStyleTag({
      content:
        "*,*::before,*::after{animation:none!important;transition:none!important;}",
    });
    await page.evaluate(async () => {
      if (document.fonts && document.fonts.ready) {
        await document.fonts.ready;
      }
    });

    // Wait for all scenarios to be ready
    for (const scenario of scenarios) {
      const locator = page.locator(
        `[data-docs-scenario-id='${scenario.id}'][data-docs-scenario-ready='true']`,
      );
      await locator.waitFor({ state: "visible", timeout: 15000 });
    }

    // Wait for all async renders to complete
    await page.waitForTimeout(500);


    await mkdir(docsImagesDir, { recursive: true });

    for (const scenario of scenarios) {
      // Screenshot only the sheet container (the div with border), not the title
      const container = page.locator(
        `[data-docs-scenario-id='${scenario.id}'] > div:last-child`,
      );
      const screenshot = await container.screenshot({
        type: "png",
        animations: "disabled",
      });
      const outputPath = path.resolve(docsImagesDir, scenario.file);
      await writeFile(outputPath, screenshot);
      console.log(`[docs:screenshots] Saved ${scenario.file}`);
    }

    await context.close();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("Executable doesn't exist") ||
      message.includes("Please run the following command to download new browsers")
    ) {
      console.error(
        "[docs:screenshots] Chromium not installed. Run: pnpm frontend exec playwright install chromium",
      );
      process.exit(1);
    }
    throw error;
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
}

const playwright = await loadPlaywright();
await captureScreenshots(playwright);
console.log("[docs:screenshots] All screenshots captured.");
