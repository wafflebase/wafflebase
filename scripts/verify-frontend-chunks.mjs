import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HardDefaultChunkLimitKb = 500;
const HardDefaultChunkCountLimit = 60;
const HardDefaultEagerLimitKb = 1500;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const harnessConfigPath = path.resolve(scriptDir, "..", "harness.config.json");
const frontendDistDir = path.resolve(
  scriptDir,
  "..",
  "packages",
  "frontend",
  "dist",
);
const frontendAssetsDir = path.join(frontendDistDir, "assets");

/**
 * The JavaScript a cold load of ANY route downloads before the app can run:
 * the entry `<script type="module">` plus every `<link rel="modulepreload">`
 * Vite wrote into `dist/index.html`. The per-chunk cap cannot see this — a
 * 700 kB engine chunk is within budget on its own, and is still a regression
 * when a misplaced shared helper makes the entry import it statically, which
 * is how the slides and sheet engines once ended up preloaded on the
 * homepage. Returns paths relative to `dist`, in document order, deduped.
 */
export function eagerScriptPaths(html) {
  const paths = [];
  const tags = html.match(/<(?:script|link)\b[^>]*>/g) ?? [];
  for (const tag of tags) {
    const attr = (name) =>
      tag.match(new RegExp(`\\s${name}=["']([^"']*)["']`))?.[1];
    const isEntry = tag.startsWith("<script") && attr("type") === "module";
    const isPreload =
      tag.startsWith("<link") && attr("rel") === "modulepreload";
    const ref = isEntry ? attr("src") : isPreload ? attr("href") : undefined;
    // An inline module script has no src; an absolute URL is not ours.
    if (!ref || /^(?:[a-z]+:)?\/\//i.test(ref)) continue;
    const rel = ref.replace(/^\//, "");
    if (!paths.includes(rel)) paths.push(rel);
  }
  return paths;
}

/** Sums the eager scripts' on-disk size, in kB (1000 bytes, like the
 *  per-chunk budget). */
export async function measureEagerScripts(distDir) {
  const html = await readFile(path.join(distDir, "index.html"), "utf8");
  const scripts = [];
  for (const rel of eagerScriptPaths(html)) {
    const details = await stat(path.join(distDir, rel));
    scripts.push({ name: rel, sizeKb: details.size / 1000 });
  }
  const totalKb = scripts.reduce((sum, s) => sum + s.sizeKb, 0);
  return { scripts, totalKb };
}

function parsePositiveNumber(label, value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.error(`[verify:frontend:chunks] ${label} must be a positive number.`);
    process.exit(1);
  }
  return parsed;
}

async function readHarnessConfig() {
  try {
    const raw = await readFile(harnessConfigPath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return {};
    }
    console.error(
      "[verify:frontend:chunks] Could not parse harness config at " +
        `${harnessConfigPath}.`,
    );
    process.exit(1);
  }
}

function readConfiguredBudget(config, key, fallback) {
  const value = config?.frontend?.chunkBudgets?.[key];
  if (value === undefined) {
    return fallback;
  }
  return parsePositiveNumber(
    `harness.config.json frontend.chunkBudgets.${key}`,
    value,
  );
}

function readChunkOverrides(config) {
  const raw = config?.frontend?.chunkBudgets?.overrides;
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    console.error(
      "[verify:frontend:chunks] harness.config.json frontend.chunkBudgets.overrides must be an array.",
    );
    process.exit(1);
  }
  return raw.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      console.error(
        `[verify:frontend:chunks] overrides[${index}] must be an object.`,
      );
      process.exit(1);
    }
    if (typeof entry.pattern !== "string" || entry.pattern.length === 0) {
      console.error(
        `[verify:frontend:chunks] overrides[${index}].pattern must be a non-empty string.`,
      );
      process.exit(1);
    }
    const maxKb = parsePositiveNumber(
      `harness.config.json frontend.chunkBudgets.overrides[${index}].maxKb`,
      entry.maxKb,
    );
    let regex;
    try {
      regex = new RegExp(entry.pattern);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[verify:frontend:chunks] overrides[${index}].pattern is not a valid RegExp: ${message}`,
      );
      process.exit(1);
    }
    return { regex, maxKb };
  });
}

function effectiveLimitForChunk(name, defaultLimit, overrides) {
  for (const override of overrides) {
    if (override.regex.test(name)) return override.maxKb;
  }
  return defaultLimit;
}

function parsePositiveLimit(name, fallback) {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }
  return parsePositiveNumber(name, value);
}

async function readChunkSizes() {
  const entries = await readdir(frontendAssetsDir, { withFileTypes: true });
  const chunks = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".js")) {
      continue;
    }

    const chunkPath = path.join(frontendAssetsDir, entry.name);
    const details = await stat(chunkPath);
    chunks.push({
      name: entry.name,
      sizeKb: details.size / 1000,
    });
  }

  chunks.sort((left, right) => right.sizeKb - left.sizeKb);
  return chunks;
}

function formatChunk(chunk) {
  return `${chunk.name} (${chunk.sizeKb.toFixed(2)} kB)`;
}

async function main() {
  const harnessConfig = await readHarnessConfig();
  const defaultChunkLimitKb = readConfiguredBudget(
    harnessConfig,
    "maxChunkKb",
    HardDefaultChunkLimitKb,
  );
  const defaultChunkCountLimit = readConfiguredBudget(
    harnessConfig,
    "maxChunkCount",
    HardDefaultChunkCountLimit,
  );
  const defaultEagerLimitKb = readConfiguredBudget(
    harnessConfig,
    "maxEagerKb",
    HardDefaultEagerLimitKb,
  );
  const chunkOverrides = readChunkOverrides(harnessConfig);

  const chunkLimitKb = parsePositiveLimit(
    "FRONTEND_CHUNK_LIMIT_KB",
    defaultChunkLimitKb,
  );
  const chunkCountLimit = parsePositiveLimit(
    "FRONTEND_CHUNK_COUNT_LIMIT",
    defaultChunkCountLimit,
  );
  const eagerLimitKb = parsePositiveLimit(
    "FRONTEND_EAGER_LIMIT_KB",
    defaultEagerLimitKb,
  );
  let chunks;

  try {
    chunks = await readChunkSizes();
  } catch {
    console.error(
      "[verify:frontend:chunks] Could not read frontend build artifacts at " +
        `${frontendAssetsDir}. Run \`pnpm frontend build\` first.`,
    );
    process.exit(1);
  }

  if (chunks.length === 0) {
    console.error(
      "[verify:frontend:chunks] No JavaScript chunks found in frontend build " +
        "artifacts.",
    );
    process.exit(1);
  }

  if (chunks.length > chunkCountLimit) {
    console.error(
      "[verify:frontend:chunks] Found too many JavaScript chunks: " +
        `${chunks.length} (limit: ${chunkCountLimit}).`,
    );
    process.exit(1);
  }

  const overBudgetChunks = chunks.filter((chunk) => {
    const limit = effectiveLimitForChunk(chunk.name, chunkLimitKb, chunkOverrides);
    return chunk.sizeKb > limit;
  });

  if (overBudgetChunks.length > 0) {
    console.error(
      "[verify:frontend:chunks] Found chunk(s) above their allowed limit:",
    );
    for (const chunk of overBudgetChunks) {
      const limit = effectiveLimitForChunk(chunk.name, chunkLimitKb, chunkOverrides);
      console.error(`- ${formatChunk(chunk)} > ${limit} kB`);
    }
    process.exit(1);
  }

  let eager;
  try {
    eager = await measureEagerScripts(frontendDistDir);
  } catch {
    console.error(
      "[verify:frontend:chunks] Could not read the entry scripts referenced by " +
        `${path.join(frontendDistDir, "index.html")}. Run \`pnpm frontend build\` first.`,
    );
    process.exit(1);
  }

  if (eager.scripts.length === 0) {
    console.error(
      "[verify:frontend:chunks] dist/index.html references no module script.",
    );
    process.exit(1);
  }

  if (eager.totalKb > eagerLimitKb) {
    console.error(
      "[verify:frontend:chunks] Eager JavaScript (entry + modulepreload) is " +
        `${eager.totalKb.toFixed(2)} kB, above the ${eagerLimitKb} kB budget. ` +
        "Every route downloads all of it before first render:",
    );
    for (const script of [...eager.scripts].sort((a, b) => b.sizeKb - a.sizeKb)) {
      console.error(`- ${formatChunk(script)}`);
    }
    console.error(
      "A large engine chunk in this list usually means a small module shared " +
        "by the entry and that engine has no manualChunks home " +
        "(packages/frontend/vite.config.ts).",
    );
    process.exit(1);
  }

  console.log(
    "[verify:frontend:chunks] Checked " +
      `${chunks.length} JS chunks (limit: ${chunkCountLimit}) against ` +
      `${chunkLimitKb} kB.`,
  );
  console.log(
    `[verify:frontend:chunks] Largest chunk: ${formatChunk(chunks[0])}.`,
  );
  console.log(
    "[verify:frontend:chunks] Eager entry: " +
      `${eager.totalKb.toFixed(2)} kB in ${eager.scripts.length} script(s) ` +
      `(limit: ${eagerLimitKb} kB).`,
  );
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  await main();
}
