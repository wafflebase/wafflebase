// Fail when this repo's copy of the pipeline differs from the commit its
// workflows actually run.
//
// WHY THIS EXISTS. `scripts/agent/` is no longer what executes. The workflows
// check the pipeline out of `wafflebase/agent-pipeline` at a pinned commit, and
// the copy here is a leftover that still backs the `agent:tests` lane. So the
// tests can pass against code that is not the code that runs — which is not a
// theoretical gap: by the time this lane was written the two had already drifted
// on three files, in both directions at once.
//
// DIRECTION MATTERS, and this deliberately does not guess. A difference means
// one of two very different things:
//   * upstream moved and the pipeline repo has not been synced yet, or
//   * someone edited the copy here, which does not affect what runs at all.
// Both are reported as drift; neither is auto-resolved. A tool that "fixed"
// this by copying one side over the other would, half the time, silently throw
// away the change it was meant to protect.
//
// Not a `verify:self` lane: it needs the pipeline repo on disk, and `verify:self`
// must keep working offline. CI checks this out and passes `--pipeline-dir`.

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..");

// Files under scripts/agent/ that are NOT part of the extracted pipeline. An
// exclusion list rather than an inclusion list on purpose: it is far shorter,
// changes far less often, and — the real reason — a NEW pipeline file added
// here is then drift by default, which is the safe direction. An inclusion list
// would silently ignore anything nobody remembered to add.
const STAYS = [
  /^eval\//,
  /^charters(-ui)?\//,
  /^hunt/,
  /^harvest\./,
  /^finding-match\./, // its test imports eval/; every importer is measurement
  /^capture-store\./,
  /^collect-captures\./,
  /^cache-report\./,
  /^spec-to-pr\./,
  /^classify\./,
  /^misses\.jsonl$/,
  /^lint-config\.test\.mjs$/, // tests repo-root eslint.config.mjs
  /^read-review-verdict\./, // dead; deleted from the pipeline, not yet from here
  /^node_modules\//,
  // vendor/ is a PINNED DEPENDENCY, not a mirror, and it has its own verifier
  // (scripts/vendor-pipeline.mjs) which re-hashes every file against a manifest.
  // Comparing it here too would report the same files twice and, worse, imply a
  // human should reconcile them by hand.
  /^vendor\//,
  // Central-repo-only test data: golden contract fixtures frozen from live
  // runs. They pin wire formats for the pipeline's own suite and have no
  // reason to exist in a consumer.
  /^__fixtures__\//,
  /^package-lock\.json$/, // regenerated locally; compared via package.json only
];

const staysBehind = (rel) => STAYS.some((re) => re.test(rel));

function walk(dir, base = "") {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const rel = base ? `${base}/${entry}` : entry;
    const abs = path.join(dir, entry);
    if (statSync(abs).isDirectory()) {
      if (!staysBehind(`${rel}/`)) out.push(...walk(abs, rel));
    } else if (!staysBehind(rel)) {
      out.push(rel);
    }
  }
  return out;
}

/** Every pinned agent-pipeline commit in the workflows, with where it was found. */
export function readPins(workflowDir) {
  const pins = new Map();
  for (const file of readdirSync(workflowDir).filter((f) => f.startsWith("agent-") && f.endsWith(".yml"))) {
    const lines = readFileSync(path.join(workflowDir, file), "utf8").split("\n");
    lines.forEach((line, i) => {
      if (!/^\s*repository:\s*wafflebase\/agent-pipeline\s*(#.*)?$/.test(line)) return;
      const ref = lines.slice(i + 1, i + 4).find((l) => /^\s*ref:/.test(l)) ?? "";
      const sha = /^\s*ref:\s*([0-9a-f]{40})\b/.exec(ref)?.[1];
      if (sha) pins.set(sha, [...(pins.get(sha) ?? []), `${file}:${i + 2}`]);
    });
  }
  return pins;
}

function die(lines) {
  console.error(lines.join("\n"));
  process.exit(1);
}

const argv = process.argv.slice(2);
const dirArg = argv.indexOf("--pipeline-dir");
if (dirArg === -1 || !argv[dirArg + 1]) {
  die(["usage: node scripts/verify-pipeline-drift.mjs --pipeline-dir <checkout of wafflebase/agent-pipeline>"]);
}
const pipelineRoot = path.resolve(argv[dirArg + 1]);
const theirs = path.join(pipelineRoot, "packages", "pipeline");
const ours = path.join(REPO, "scripts", "agent");

// 1. Every workflow must pin the SAME commit. A split pin means half the
//    pipeline runs one version and half another, which no per-file comparison
//    would reveal.
const pins = readPins(path.join(REPO, ".github", "workflows"));
if (pins.size === 0) die(["No pinned agent-pipeline commit found in .github/workflows/agent-*.yml."]);
if (pins.size > 1) {
  die([
    "The workflows do not agree on which pipeline commit to run:",
    ...[...pins].map(([sha, where]) => `  ${sha}  <- ${where.join(", ")}`),
    "",
    "Bump them together. A split pin runs two versions of the pipeline in one PR.",
  ]);
}
const [pinned] = [...pins.keys()];

// 2. Compare the file sets and contents.
const oursFiles = new Set(walk(ours));
const theirFiles = new Set(walk(theirs).filter((f) => !staysBehind(f)));
const differ = [], onlyHere = [], onlyThere = [];

for (const rel of [...oursFiles].sort()) {
  if (!theirFiles.has(rel)) { onlyHere.push(rel); continue; }
  const a = readFileSync(path.join(ours, rel));
  const b = readFileSync(path.join(theirs, rel));
  if (!a.equals(b)) differ.push(rel);
}
for (const rel of [...theirFiles].sort()) if (!oursFiles.has(rel)) onlyThere.push(rel);

// The RETAINED half must read the pipeline through vendor/, never through the
// mirror. While the mirror still exists a stray `./severity.mjs` RESOLVES, so the
// mistake is invisible until the mirror is deleted — at which point it surfaces as
// a runtime crash inside a hunt or a replay. Checked here because this file is
// where the mirror/retained split is already defined.
//
// Only files that STAY are checked. The mirror importing its own siblings is
// correct and must not change: it is byte-compared against the pinned commit.
const mirrorModules = new Set(theirFiles);
const badImports = [];
const scan = (dir, base = "") => {
  for (const entry of readdirSync(dir)) {
    const rel = base ? `${base}/${entry}` : entry;
    const abs = path.join(dir, entry);
    if (statSync(abs).isDirectory()) { if (entry !== "node_modules" && entry !== "vendor") scan(abs, rel); continue; }
    if (!entry.endsWith(".mjs")) continue;
    if (!base && mirrorModules.has(entry)) continue;      // a mirror file: exempt
    if (!base && mirrorModules.has(entry.replace(/\.test\.mjs$/, ".mjs"))) continue; // its test
    for (const m of readFileSync(abs, "utf8").matchAll(/(?:from|import\()\s*"(\.{1,2}\/(?:\.\.\/)*)([a-z-]+)\.mjs"/g)) {
      if (m[1].includes("vendor")) continue;
      if (mirrorModules.has(`${m[2]}.mjs`)) badImports.push(`${rel} imports ${m[1]}${m[2]}.mjs`);
    }
  }
};
scan(ours);
if (badImports.length) {
  die([
    "These files import the MIRROR rather than vendor/pipeline/:",
    ...badImports.map((b) => `  ${b}`),
    "",
    "The mirror does not run and is going away. Import through vendor/pipeline/ —",
    "`./vendor/pipeline/severity.mjs`, or `../vendor/pipeline/…` from a subdirectory.",
    "The leading `./` is REQUIRED: a bare `vendor/…` is a package specifier to Node,",
    "and fails with \"Cannot find package 'vendor'\" only at runtime.",
  ]);
}

if (!differ.length && !onlyHere.length && !onlyThere.length) {
  console.log(`scripts/agent matches wafflebase/agent-pipeline@${pinned.slice(0, 9)} (${oursFiles.size} files).`);
  process.exit(0);
}

die([
  `scripts/agent has DRIFTED from the pipeline commit these workflows run (${pinned.slice(0, 9)}).`,
  "",
  ...(differ.length ? ["Different content:", ...differ.map((f) => `  ${f}`), ""] : []),
  ...(onlyHere.length ? ["Only in this repo (never runs — either port it upstream or delete it):",
    ...onlyHere.map((f) => `  ${f}`), ""] : []),
  ...(onlyThere.length ? ["Only in the pipeline repo (this copy is stale):",
    ...onlyThere.map((f) => `  ${f}`), ""] : []),
  "This copy does NOT run. The workflows execute the pinned commit above, so a",
  "change here is invisible in production and the `agent:tests` lane is testing",
  "something other than what runs.",
  "",
  "Resolve by deciding which side is ahead — this lane will not guess:",
  "  * you changed the pipeline    -> land it in wafflebase/agent-pipeline, tag,",
  "                                   then bump the pin in .github/workflows/",
  "  * upstream moved              -> sync the pipeline repo and bump the pin",
  "  * the file is measurement     -> add it to STAYS in this script",
]);
