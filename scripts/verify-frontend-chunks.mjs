import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DefaultChunkLimitKb = 500;
const DefaultChunkCountLimit = 60;
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendAssetsDir = path.resolve(
  scriptDir,
  "..",
  "packages",
  "frontend",
  "dist",
  "assets",
);

function parsePositiveLimit(name, fallback) {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.error(
      `[verify:frontend:chunks] ${name} must be a positive number.`,
    );
    process.exit(1);
  }

  return parsed;
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

const chunkLimitKb = parsePositiveLimit(
  "FRONTEND_CHUNK_LIMIT_KB",
  DefaultChunkLimitKb,
);
const chunkCountLimit = parsePositiveLimit(
  "FRONTEND_CHUNK_COUNT_LIMIT",
  DefaultChunkCountLimit,
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
