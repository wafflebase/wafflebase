import { readFile, readdir, access } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PREFIX = "[verify:entropy]";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const harnessConfigPath = path.resolve(repoRoot, "harness.config.json");

const VALID_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".yaml",
  ".yml",
  ".prisma",
  ".g4",
  ".sh",
  ".css",
]);

function stripFragment(ref) {
  const hashIndex = ref.indexOf("#");
  return hashIndex === -1 ? ref : ref.slice(0, hashIndex);
}

function isFilePath(ref) {
  if (ref.startsWith("http://") || ref.startsWith("https://")) {
    return false;
  }
  if (ref.startsWith("#")) {
    return false;
  }
  const clean = stripFragment(ref);
  const dotIndex = clean.lastIndexOf(".");
  if (dotIndex === -1) {
    return false;
  }
  const ext = clean.slice(dotIndex);
  return VALID_EXTENSIONS.has(ext);
}

/**
 * Extract file references from markdown content.
 * Skips fenced code blocks, extracts backtick paths and markdown link targets,
 * deduplicates, and filters to valid file paths.
 */
export function extractFileRefs(content, sourceName) {
  const lines = content.split("\n");
  let inCodeBlock = false;
  const seen = new Set();
  const refs = [];

  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      continue;
    }

    // Extract backtick-wrapped paths
    const backtickPattern = /`([a-zA-Z0-9@/_.\-]+\.[a-zA-Z0-9]+)`/g;
    let match;
    while ((match = backtickPattern.exec(line)) !== null) {
      const ref = match[1];
      if (isFilePath(ref) && !seen.has(ref)) {
        seen.add(ref);
        refs.push({ path: ref, source: sourceName });
      }
    }

    // Extract markdown link targets
    const linkPattern = /\[([^\]]*)\]\(([^)]+)\)/g;
    while ((match = linkPattern.exec(line)) !== null) {
      const ref = stripFragment(match[2]);
      if (isFilePath(ref) && !seen.has(ref)) {
        seen.add(ref);
        refs.push({ path: ref, source: sourceName });
      }
    }
  }

  return refs;
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function runDocStaleness(designDir) {
  const findings = [];
  const absoluteDesignDir = path.resolve(repoRoot, designDir);

  let entries;
  try {
    entries = await readdir(absoluteDesignDir, { withFileTypes: true });
  } catch {
    console.log(`${PREFIX} Could not read design directory: ${absoluteDesignDir}`);
    return { passed: true, findings: [] };
  }

  const mdFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name);

  for (const fileName of mdFiles) {
    const filePath = path.join(absoluteDesignDir, fileName);
    const content = await readFile(filePath, "utf8");
    const refs = extractFileRefs(content, `${designDir}/${fileName}`);

    for (const ref of refs) {
      const fromRoot = path.resolve(repoRoot, ref.path);
      const fromDesign = path.resolve(absoluteDesignDir, ref.path);

      const existsFromRoot = await fileExists(fromRoot);
      const existsFromDesign = await fileExists(fromDesign);

      if (!existsFromRoot && !existsFromDesign) {
        findings.push(
          `Broken ref in ${ref.source}: \`${ref.path}\` not found`,
        );
      }
    }
  }

  return {
    passed: findings.length === 0,
    findings,
  };
}

function spawnAsync(cmd, args, options) {
  return new Promise((resolve) => {
    execFile(cmd, args, options, (error, stdout, stderr) => {
      resolve({ error, stdout, stderr });
    });
  });
}

async function runKnip() {
  const findings = [];

  const { error, stdout, stderr } = await spawnAsync(
    "npx",
    ["knip", "--no-progress", "--reporter", "json"],
    { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 },
  );

  if (!stdout || stdout.trim() === "") {
    // No output means no issues, or knip failed to produce output
    if (error && !stderr.includes("knip")) {
      findings.push(`Knip execution error: ${error.message}`);
      return { passed: false, findings };
    }
    return { passed: true, findings: [] };
  }

  let report;
  try {
    report = JSON.parse(stdout);
  } catch {
    findings.push(`Could not parse knip output as JSON`);
    return { passed: false, findings };
  }

  // Report unused files
  if (report.files && report.files.length > 0) {
    for (const file of report.files) {
      findings.push(`Unused file: ${file}`);
    }
  }

  // Report unused exports
  if (report.exports && report.exports.length > 0) {
    for (const entry of report.exports) {
      const filePath = entry.file || entry.name || "unknown";
      const symbols = entry.symbols || [];
      for (const sym of symbols) {
        findings.push(`Unused export: ${sym.symbol} in ${filePath}`);
      }
    }
  }

  // Report unused types
  if (report.types && report.types.length > 0) {
    for (const entry of report.types) {
      const filePath = entry.file || entry.name || "unknown";
      const symbols = entry.symbols || [];
      for (const sym of symbols) {
        findings.push(`Unused type: ${sym.symbol} in ${filePath}`);
      }
    }
  }

  return {
    passed: findings.length === 0,
    findings,
  };
}

async function runDependencyFreshness(failOnCritical) {
  const findings = [];

  // Run pnpm audit
  const auditResult = await spawnAsync(
    "pnpm",
    ["audit", "--json"],
    { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 },
  );

  let vulnCounts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  if (auditResult.stdout && auditResult.stdout.trim()) {
    try {
      const auditReport = JSON.parse(auditResult.stdout);
      vulnCounts = auditReport.metadata?.vulnerabilities ?? vulnCounts;
    } catch {
      // pnpm audit may output non-JSON on some errors
    }
  }

  const totalVulns = vulnCounts.low + vulnCounts.moderate + vulnCounts.high + vulnCounts.critical;
  if (totalVulns > 0) {
    const parts = [];
    if (vulnCounts.low > 0) parts.push(`${vulnCounts.low} low`);
    if (vulnCounts.moderate > 0) parts.push(`${vulnCounts.moderate} moderate`);
    if (vulnCounts.high > 0) parts.push(`${vulnCounts.high} high`);
    if (vulnCounts.critical > 0) parts.push(`${vulnCounts.critical} critical`);
    console.log(`${PREFIX}   Vulnerabilities: ${parts.join(", ")}`);
  } else {
    console.log(`${PREFIX}   Vulnerabilities: none`);
  }

  // Run pnpm outdated
  const outdatedResult = await spawnAsync(
    "pnpm",
    ["outdated", "--recursive", "--json"],
    { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 },
  );

  let outdatedCount = 0;
  if (outdatedResult.stdout && outdatedResult.stdout.trim()) {
    try {
      const outdatedReport = JSON.parse(outdatedResult.stdout);
      outdatedCount = Object.keys(outdatedReport).length;
    } catch {
      // pnpm outdated may output non-JSON on some errors
    }
  }

  console.log(`${PREFIX}   Outdated packages: ${outdatedCount}`);

  // Only fail on critical vulnerabilities
  if (failOnCritical && vulnCounts.critical > 0) {
    findings.push(
      `${vulnCounts.critical} critical vulnerabilities found (run \`pnpm audit\` for details)`,
    );
  }

  return {
    passed: findings.length === 0,
    findings,
  };
}

async function readHarnessConfig() {
  try {
    const raw = await readFile(harnessConfigPath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      return {};
    }
    console.error(`${PREFIX} Could not parse harness config at ${harnessConfigPath}.`);
    process.exit(1);
  }
}

async function main() {
  const config = await readHarnessConfig();
  const entropyConfig = config.entropy || {};
  let totalFindings = [];

  // Dead-code detection (knip)
  if (entropyConfig.deadCode?.enabled !== false) {
    console.log(`${PREFIX} Running dead-code detection (knip)...`);
    const knipResult = await runKnip();
    if (knipResult.findings.length > 0) {
      for (const finding of knipResult.findings) {
        console.log(`${PREFIX}   ${finding}`);
      }
    }
    console.log(
      `${PREFIX} Dead code: ${knipResult.findings.length} issues found.`,
    );
    totalFindings = totalFindings.concat(knipResult.findings);
  }

  // Doc-staleness check
  if (entropyConfig.docStaleness?.enabled !== false) {
    const designDir = entropyConfig.docStaleness.designDir || "design";
    console.log(`${PREFIX} Running doc-staleness check...`);
    const stalenessResult = await runDocStaleness(designDir);
    if (stalenessResult.findings.length > 0) {
      for (const finding of stalenessResult.findings) {
        console.log(`${PREFIX}   ${finding}`);
      }
    }
    console.log(
      `${PREFIX} Doc staleness: ${stalenessResult.findings.length} issues found.`,
    );
    totalFindings = totalFindings.concat(stalenessResult.findings);
  }

  // Dependency freshness check
  if (entropyConfig.dependencyFreshness?.enabled !== false) {
    const failOnCritical =
      entropyConfig.dependencyFreshness?.failOnCritical !== false;
    console.log(`${PREFIX} Running dependency freshness check...`);
    const freshnessResult = await runDependencyFreshness(failOnCritical);
    if (freshnessResult.findings.length > 0) {
      for (const finding of freshnessResult.findings) {
        console.log(`${PREFIX}   ${finding}`);
      }
    }
    console.log(
      `${PREFIX} Dependency freshness: ${freshnessResult.findings.length} issues found.`,
    );
    totalFindings = totalFindings.concat(freshnessResult.findings);
  }

  if (totalFindings.length === 0) {
    console.log(`${PREFIX} All entropy checks passed.`);
  } else {
    console.log(
      `${PREFIX} ${totalFindings.length} total issues found.`,
    );
    process.exit(1);
  }
}

// Only run main when executed directly (not imported for tests)
const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  main();
}
