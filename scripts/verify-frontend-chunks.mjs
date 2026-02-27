import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HardDefaultChunkLimitKb = 500;
const HardDefaultChunkCountLimit = 60;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const harnessConfigPath = path.resolve(scriptDir, "..", "harness.config.json");
const frontendAssetsDir = path.resolve(
  scriptDir,
  "..",
  "packages",
  "frontend",
  "dist",
  "assets",
);

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

const chunkLimitKb = parsePositiveLimit(
  "FRONTEND_CHUNK_LIMIT_KB",
  defaultChunkLimitKb,
);
const chunkCountLimit = parsePositiveLimit(
  "FRONTEND_CHUNK_COUNT_LIMIT",
  defaultChunkCountLimit,
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

const overBudgetChunks = chunks.filter((chunk) => chunk.sizeKb > chunkLimitKb);

if (overBudgetChunks.length > 0) {
  console.error(
    "[verify:frontend:chunks] Found chunk(s) above the allowed limit of " +
      `${chunkLimitKb} kB:`,
  );
  for (const chunk of overBudgetChunks) {
    console.error(`- ${formatChunk(chunk)}`);
  }
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
