/**
 * Render a slides deck to per-slide PNGs with the product's own canvas
 * renderer — offline, from a `SlidesDocument` JSON file. No backend, no
 * Yorkie, no login: a Vite dev server serves the frontend's renderer and a
 * headless Chromium paints each slide through `renderSlideCanvas`, the same
 * call the editor's left rail makes, at the deck's logical size (1920 wide).
 *
 * The opt-in final check of the deck-authoring loop (docs/design/slides/
 * slides-lint.md). `wafflebase slides layout-report` / `slides lint` are the cheap
 * first pass; this is the exact one. For a deck that lives on a server, use
 * `wafflebase slides render <doc-id>` instead, which drives the live editor.
 *
 *   pnpm frontend render:slides <deck.json> --out <dir> [--slide N]
 *
 * Fonts: Chromium paints with the fonts installed on this machine, so text
 * can still differ from a browser with the deck's web fonts loaded.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const args = { file: undefined, out: undefined, slide: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") args.out = argv[++i];
    else if (a === "--slide") args.slide = Number(argv[++i]);
    else if (!a.startsWith("--")) args.file = a;
  }
  if (!args.file || !args.out) {
    throw new Error("usage: render-slides.mjs <deck.json> --out <dir> [--slide N]");
  }
  if (args.slide !== undefined && !(Number.isInteger(args.slide) && args.slide >= 1)) {
    throw new Error("--slide must be a positive integer (1-based)");
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const doc = JSON.parse(await readFile(path.resolve(args.file), "utf8"));
  const count = doc.slides?.length ?? 0;
  const indices =
    args.slide !== undefined ? [args.slide - 1] : Array.from({ length: count }, (_, i) => i);
  if (indices.some((i) => i >= count)) {
    throw new Error(`deck has ${count} slides; --slide ${args.slide} is out of range`);
  }
  await mkdir(path.resolve(args.out), { recursive: true });

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
    await page.goto(`http://127.0.0.1:${port}/scripts/render-slides.html`);
    await page.waitForFunction(() => typeof window.__renderSlide === "function", null, {
      timeout: 60_000,
    });
    for (const i of indices) {
      const url = await page.evaluate(
        ([d, idx]) => window.__renderSlide(d, idx),
        [doc, i],
      );
      if (!url) {
        console.error(`slide ${i + 1}: not renderable`);
        continue;
      }
      const file = path.join(path.resolve(args.out), `slide-${i + 1}.png`);
      await writeFile(file, Buffer.from(url.split(",")[1], "base64"));
      console.log(file);
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
