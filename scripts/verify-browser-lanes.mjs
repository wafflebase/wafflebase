import { execSync } from "node:child_process";
import { accessSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PREFIX = "[verify:browser]";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

function isPlaywrightAvailable() {
  try {
    const require = createRequire(
      path.resolve(repoRoot, "packages/frontend/package.json"),
    );
    const playwrightPath = require.resolve("playwright");
    const { chromium } = require(playwrightPath);
    if (!chromium) return false;
    const execPath = chromium.executablePath();
    accessSync(execPath);
    return true;
  } catch {
    return false;
  }
}

if (!isPlaywrightAvailable()) {
  console.log(
    `${PREFIX} ⚠ Chromium not found — skipping browser lanes.`,
  );
  console.log(
    `${PREFIX}   Install with: pnpm --filter @wafflebase/frontend exec playwright install chromium`,
  );
  process.exit(0);
}

console.log(`${PREFIX} Chromium found — running browser lanes.`);

try {
  execSync("pnpm verify:frontend:visual:browser", {
    cwd: repoRoot,
    stdio: "inherit",
  });
  execSync("pnpm verify:frontend:interaction:browser", {
    cwd: repoRoot,
    stdio: "inherit",
  });
} catch (error) {
  process.exit(error.status ?? 1);
}
