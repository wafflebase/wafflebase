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
  // Import aliases (`@/types/comments.ts`) are module specifiers, not paths —
  // resolving one means reading tsconfig, and the file it names is reached from
  // a different root than the doc appears to give.
  if (ref.startsWith("@/")) {
    return false;
  }
  // Deliberately elided paths (`frontend/.../yorkie-doc-store.ts`) are prose
  // shorthand. The author is pointing at a file without spelling out where it
  // sits; there is nothing here to verify.
  if (ref.includes("...")) {
    return false;
  }
  const clean = stripFragment(ref);
  // A bare extension (`.test.ts`) names a suffix convention, not a file.
  if (clean.slice(clean.lastIndexOf("/") + 1).startsWith(".")) {
    return false;
  }
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
    const backtickPattern = /`([a-zA-Z0-9@/_.-]+\.[a-zA-Z0-9]+)`/g;
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

/**
 * Index tracked repo paths by basename, so a ref can be matched by its tail
 * without scanning every path for every ref.
 */
export function buildSuffixIndex(files) {
  const byBasename = new Map();
  for (const file of files) {
    const basename = file.slice(file.lastIndexOf("/") + 1);
    let bucket = byBasename.get(basename);
    if (!bucket) {
      byBasename.set(basename, (bucket = []));
    }
    bucket.push(file);
  }
  return byBasename;
}

let trackedFiles;
async function listTrackedFiles() {
  trackedFiles ??= spawnAsync("git", ["ls-files"], {
    cwd: repoRoot,
    maxBuffer: 64 * 1024 * 1024,
  }).then(({ error, stdout }) =>
    // No git (or no checkout) means no suffix index — resolution falls back to
    // the explicit bases below rather than reporting every ref as broken.
    error ? null : stdout.split("\n").filter(Boolean),
  );
  return trackedFiles;
}

/**
 * Decide whether a doc's file reference still points at something real.
 *
 * Design docs cite paths the way a reader needs them, and three forms are all
 * legitimate: repo-root-relative (`packages/cli/src/output/formatter.ts`),
 * relative to the citing doc (`../cli.md`), and the package-relative tail
 * (`src/output/formatter.ts`) — the dominant convention in this repo. Only the
 * first two resolve against a base directory, so a tail is matched against the
 * tracked-file index instead.
 *
 * A tail that matches more than one tracked file is still resolved: the check
 * exists to catch docs pointing at files that no longer exist, not to enforce
 * path precision. Reporting an ambiguous-but-present file as "not found" is
 * the false positive this resolver is built to avoid.
 */
export async function refResolves(ref, { bases, suffixIndex }) {
  for (const base of bases) {
    if (await fileExists(path.resolve(base, ref))) {
      return true;
    }
  }

  if (!suffixIndex) {
    return false;
  }

  // Strip a leading `./` so the tail lines up with a tracked path segment.
  const tail = ref.replace(/^(?:\.\/)+/, "");
  const candidates = suffixIndex.get(tail.slice(tail.lastIndexOf("/") + 1));
  if (!candidates) {
    return false;
  }

  // The leading separator keeps `api/documents.ts` from matching a tracked
  // `legacy-api/documents.ts` — the tail must start at a path boundary.
  const suffix = `/${tail}`;
  if (candidates.some((file) => file === tail || file.endsWith(suffix))) {
    return true;
  }

  // Docs also elide the segments a reader does not need:
  // `frontend/app/docs/docs-view.tsx` for
  // `packages/frontend/src/app/docs/docs-view.tsx`. Accept a reference whose
  // segments appear in the tracked path in order. Order is still required, so
  // `packages/docs/src/view/ruler.ts` does not resolve against the slides
  // ruler — naming the wrong package stays a finding.
  const want = tail.split("/");
  return candidates.some((file) => {
    let i = 0;
    for (const segment of file.split("/")) {
      if (segment === want[i]) {
        i += 1;
      }
      if (i === want.length) {
        return true;
      }
    }
    return false;
  });
}

/**
 * Every `.md` under the design directory, as paths relative to it. Recursive:
 * the subsystem docs live in `sheets/`, `docs/`, `slides/`, `board/` and the
 * rest, and a non-recursive read left 86 of 110 design docs unchecked.
 */
export async function listDesignDocs(dir, prefix = "") {
  const docs = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isFile() && entry.name.endsWith(".md")) {
      docs.push(relative);
    } else if (entry.isDirectory()) {
      docs.push(...(await listDesignDocs(path.join(dir, entry.name), relative)));
    }
  }
  return docs.sort();
}

/**
 * Whether a finding is advisory rather than blocking.
 *
 * Two entry shapes, both requiring a `reason`. `pattern` downgrades every
 * finding in the design docs whose relative path it matches — for a spec whose
 * whole subject is unbuilt. `doc` + `ref` downgrades one named reference and is
 * the shape to prefer, because the rest of that doc keeps blocking: a doc
 * carrying a planned-file name today still fails on real drift tomorrow.
 */
export function isAdvisory(docPath, refPath, advisory = []) {
  return advisory.some((rule) => {
    if (rule.pattern) {
      return new RegExp(rule.pattern).test(docPath);
    }
    return rule.doc === docPath && rule.ref === refPath;
  });
}

async function runDocStaleness(designDir, advisory = []) {
  const findings = [];
  const advisoryFindings = [];
  const absoluteDesignDir = path.resolve(repoRoot, designDir);

  let docs;
  try {
    docs = await listDesignDocs(absoluteDesignDir);
  } catch {
    console.log(`${PREFIX} Could not read design directory: ${absoluteDesignDir}`);
    return { passed: true, findings: [], advisoryFindings: [] };
  }

  const tracked = await listTrackedFiles();
  const suffixIndex = tracked ? buildSuffixIndex(tracked) : null;

  for (const relative of docs) {
    const filePath = path.join(absoluteDesignDir, relative);
    const content = await readFile(filePath, "utf8");
    const refs = extractFileRefs(content, `${designDir}/${relative}`);

    for (const ref of refs) {
      const resolved = await refResolves(ref.path, {
        bases: [repoRoot, path.dirname(filePath), absoluteDesignDir],
        suffixIndex,
      });

      if (resolved) {
        continue;
      }

      const finding = `Broken ref in ${ref.source}: \`${ref.path}\` matches no tracked file`;
      if (isAdvisory(relative, ref.path, advisory)) {
        advisoryFindings.push(finding);
      } else {
        findings.push(finding);
      }
    }
  }

  return {
    passed: findings.length === 0,
    findings,
    advisoryFindings,
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
    const designDir = entropyConfig.docStaleness?.designDir || "design";
    const advisory = entropyConfig.docStaleness?.advisory ?? [];
    console.log(`${PREFIX} Running doc-staleness check...`);
    const stalenessResult = await runDocStaleness(designDir, advisory);
    if (stalenessResult.findings.length > 0) {
      for (const finding of stalenessResult.findings) {
        console.log(`${PREFIX}   ${finding}`);
      }
    }
    // Advisory findings are printed, never hidden. A suppressed count that
    // nobody can see reads as "these docs are clean" when they are not.
    if (stalenessResult.advisoryFindings.length > 0) {
      for (const finding of stalenessResult.advisoryFindings) {
        console.log(`${PREFIX}   (advisory) ${finding}`);
      }
      console.log(
        `${PREFIX} Doc staleness: ${stalenessResult.advisoryFindings.length} advisory issues (non-blocking).`,
      );
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
