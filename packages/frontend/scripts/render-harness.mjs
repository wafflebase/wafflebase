/**
 * The offline render harness shared by `render:slides` and
 * `render:thumbnails`: a Vite dev server serving the frontend's own
 * renderers on loopback, and a headless Chromium page that loads
 * `render-slides.html`. No backend, no Yorkie, no login — the browser holds
 * no session and is used only as a rasterizer.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** `data:`/`blob:` and loopback only; everything else is refused. */
export function isLoopbackRequest(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === "data:" || parsed.protocol === "blob:") return true;
  return (
    (parsed.protocol === "http:" || parsed.protocol === "https:") &&
    LOOPBACK.has(parsed.hostname)
  );
}

/**
 * Run `fn(page)` against a page whose `window.__renderSlide` /
 * `window.__renderThumbnail` hooks are installed.
 *
 * `blockExternal` aborts every request that is not loopback, so a rendered
 * artifact can only depend on what this checkout serves (an image URL in a
 * deck, a web font) and nothing reaches the network.
 */
export async function withRenderPage({ blockExternal = false } = {}, fn) {
  const server = await createServer({
    root: frontendRoot,
    configFile: path.resolve(frontendRoot, "vite.config.ts"),
    server: { host: "127.0.0.1", port: 0, strictPort: false },
    logLevel: "error",
  });
  await server.listen();
  const { port } = server.httpServer.address();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => console.error(`[page] ${e.message}`));
    if (blockExternal) {
      await page.route("**/*", (route) => {
        const url = route.request().url();
        if (isLoopbackRequest(url)) return route.continue();
        console.error(`[blocked] ${url}`);
        return route.abort("blockedbyclient");
      });
    }
    await page.goto(`http://127.0.0.1:${port}/scripts/render-slides.html`);
    await page.waitForFunction(
      () =>
        typeof window.__renderSlide === "function" &&
        typeof window.__renderThumbnail === "function",
      null,
      { timeout: 60_000 },
    );
    return await fn(page);
  } finally {
    await browser.close();
    await server.close();
  }
}
