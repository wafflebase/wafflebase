import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");
const baselineDir = path.resolve(frontendRoot, "src/visual-tests/baselines");
const baselinePath = path.resolve(baselineDir, "harness-visual.html");
const actualPath = path.resolve(baselineDir, "harness-visual.actual.html");

function normalize(html) {
  return `${html.trim()}\n`;
}

function shortHash(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

async function renderHarnessHtml() {
  const server = await createServer({
    configFile: path.resolve(frontendRoot, "vite.config.ts"),
    root: frontendRoot,
    logLevel: "silent",
    server: { middlewareMode: true },
  });

  try {
    const module = await server.ssrLoadModule("/src/app/harness/visual/page.tsx");
    const component = module.default;
    if (typeof component !== "function") {
      throw new Error("Harness page default export is not a component.");
    }

    const markup = renderToStaticMarkup(createElement(component));
    return normalize(`<!doctype html>\n${markup}`);
  } finally {
    await server.close();
  }
}

async function readBaseline() {
  try {
    return await readFile(baselinePath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

const actual = await renderHarnessHtml();
const updateBaseline = process.env.UPDATE_VISUAL_BASELINE === "true";

await mkdir(baselineDir, { recursive: true });

if (updateBaseline) {
  await writeFile(baselinePath, actual, "utf8");
  console.log(`[verify:visual] Updated baseline at ${baselinePath}.`);
  process.exit(0);
}

const baseline = await readBaseline();
if (baseline === null) {
  console.error(
    "[verify:visual] Baseline snapshot is missing. Run " +
      "`pnpm frontend test:visual:update` to create it.",
  );
  process.exit(1);
}

if (baseline !== actual) {
  await writeFile(actualPath, actual, "utf8");
  console.error("[verify:visual] Visual baseline mismatch detected.");
  console.error(`[verify:visual] baseline hash: ${shortHash(baseline)}`);
  console.error(`[verify:visual] actual hash:   ${shortHash(actual)}`);
  console.error(
    "[verify:visual] Inspect the diff and update baseline if intended: " +
      "`pnpm frontend test:visual:update`.",
  );
  console.error(`[verify:visual] Wrote actual output to ${actualPath}.`);
  process.exit(1);
}

console.log(
  `[verify:visual] Baseline matched (${shortHash(actual)}).`,
);
