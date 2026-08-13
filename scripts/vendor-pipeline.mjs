// Vendor the pinned pipeline for the measurement half to import.
//
// WHY VENDOR RATHER THAN SHARE. `harvest.mjs`, `eval/`, the hunters,
// `cache-report.mjs` and `verify-self.mjs` all need the pipeline's own rules —
// its severity classification, its file routing, its dedupe key, its config
// identity. That is not accidental coupling: you cannot score a reviewer without
// the reviewer's own definitions, and `eval/config-hash.mjs` hashes
// `FILE_CLASSES` and `sampleCountFor` precisely so its numbers match the panel's.
//
// The alternative was carving those ~35 symbols into a shared kernel, which only
// helps if the PIPELINE imports them from there too — otherwise the kernel holds
// a copy and the copies drift, which is the exact failure eval/README warns
// about. That means editing `review-panel.mjs`, 3,210 lines of gating reviewer,
// mid-extraction. Deliberately not doing that now.
//
// So this is a PINNED DEPENDENCY, not a second maintained copy. Nobody edits
// `vendor/pipeline/`. It is written by `--write` from a checkout of the pinned
// commit, every file is recorded with its sha256, and CI re-hashes them offline.
// Editing it is caught the same way editing node_modules would be.
//
//   node scripts/vendor-pipeline.mjs --pipeline-dir <checkout> --write   # refresh
//   node scripts/vendor-pipeline.mjs                                     # verify (offline)

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..");
const VENDOR = path.join(REPO, "scripts", "agent", "vendor", "pipeline");
const MANIFEST = path.join(REPO, "scripts", "agent", "vendor", "VENDOR.json");

// The transitive closure of what the retained half imports. Explicit rather than
// computed, so a reviewer can see the surface — but `assertClosed` below proves
// the list is COMPLETE, so an upstream file gaining an import fails loudly here
// instead of at runtime in a hunt or a replay.
// `set-state.mjs` and `session-job-summary.mjs` are here for a second reason: two
// steps in `agent-implement.yml`'s `implement` job invoke them, and that job has no
// adapter — it checks out THIS repo, so those paths resolved out of the mirror. With
// the mirror gone they resolve out of vendor/ instead, which is byte-verified and
// needs no network. Both bring their own deps (`guard-verdict`, `metrics`) which
// were already here, so the closure did not widen.
const FILES = [
  "ask.mjs", "capture-meta.mjs", "citation.mjs", "command.mjs", "disclosure.mjs",
  "finding-key.mjs", "fix-report.mjs", "gh-checks.mjs", "git-env.mjs", "guard-verdict.mjs",
  "metrics.mjs", "novelty.mjs", "prior-findings.mjs", "rebuttal.mjs", "review-panel.mjs",
  "review-state.mjs", "rounds.mjs", "session-job-summary.mjs", "set-state.mjs", "severity.mjs",
];

// Non-code assets the measurement half needs BYTE-EXACTLY rather than merely
// semantically. `eval/config-hash.mjs` hashes the lens manifest precisely so its
// numbers provably match the panel's, and `config-build.mjs` / `cache-report.mjs`
// build their manifests from the real rubrics — a paraphrased copy would defeat the
// hash it exists to compute. Listed separately from FILES because `assertClosed`
// reasons about imports, and prose has none.
const ASSETS = [
  "lenses/lenses.json",
  "lenses/blast-radius.md", "lenses/correctness.md", "lenses/design-fit.md",
  "lenses/docs.md", "lenses/security.md", "lenses/test-adequacy.md",
];

const VENDORED = [...FILES, ...ASSETS];

/** Every vendored file, relative to the vendor root, subdirectories included. */
function walkVendor(dir, base = "") {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const rel = base ? `${base}/${entry}` : entry;
    const abs = path.join(dir, entry);
    if (statSync(abs).isDirectory()) out.push(...walkVendor(abs, rel));
    else out.push(rel);
  }
  return out;
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1] ?? true;
};
const die = (...lines) => { console.error(lines.join("\n")); process.exit(1); };

/**
 * Every relative import inside the vendored set must resolve inside it.
 *
 * The pattern matches `from "x"`, `import("x")` AND a side-effect `import "x"`, in
 * either quote style. It used to understand only double-quoted `from`/`import()`,
 * which means an unclosed side-effect import would have passed here and failed at
 * runtime instead — the same shape-matching hole fixed in the drift guard's matcher.
 */
function assertClosed(dir, files) {
  const have = new Set(files);
  const missing = [];
  for (const f of files) {
    const src = readFileSync(path.join(dir, f), "utf8");
    for (const m of src.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*(["'])(\.{1,2}\/[A-Za-z0-9._/-]+\.mjs)\1/g)) {
      // RESOLVED against the importing file, not reduced to a basename. Taking the
      // basename would let `./lenses/b.mjs` be satisfied by a root `b.mjs` — the
      // same collapse the drift guard's matcher was fixed for. No nested module is
      // vendored today, so this is latent; a shape that only works while the set
      // stays flat is exactly what stops holding the moment someone adds one.
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(f), m[2]));
      if (!have.has(target)) missing.push(`${f} imports ${m[2]}`);
    }
  }
  if (missing.length) {
    die(
      "The vendored set is not closed — these imports would not resolve:",
      ...missing.map((m) => `  ${m}`),
      "",
      "Add the missing module to FILES in scripts/vendor-pipeline.mjs and re-run --write.",
    );
  }
}

/** The commit the workflows pin, which is the only version worth vendoring. */
function pinnedCommit() {
  const dir = path.join(REPO, ".github", "workflows");
  const found = new Set();
  for (const f of readdirSync(dir).filter((x) => x.startsWith("agent-") && x.endsWith(".yml"))) {
    const lines = readFileSync(path.join(dir, f), "utf8").split("\n");
    lines.forEach((line, i) => {
      if (!/^\s*repository:\s*wafflebase\/agent-pipeline\s*(#.*)?$/.test(line)) return;
      const ref = lines.slice(i + 1, i + 4).find((l) => /^\s*ref:/.test(l)) ?? "";
      const sha = /^\s*ref:\s*([0-9a-f]{40})\b/.exec(ref)?.[1];
      if (sha) found.add(sha);
    });
  }
  if (found.size !== 1) die(`Expected exactly one pinned pipeline commit, found ${found.size}.`);
  return [...found][0];
}

if (arg("--write")) {
  const src = arg("--pipeline-dir");
  if (!src || src === true) die("usage: --pipeline-dir <checkout of wafflebase/agent-pipeline> --write");
  const from = path.join(path.resolve(src), "packages", "pipeline");
  if (!existsSync(from)) die(`No packages/pipeline in ${src}`);
  rmSync(VENDOR, { recursive: true, force: true });
  mkdirSync(VENDOR, { recursive: true });
  const files = {};
  for (const f of VENDORED) {
    const abs = path.join(from, f);
    if (!existsSync(abs)) die(`The vendored list names ${f}, which is not in the pipeline repo.`);
    mkdirSync(path.dirname(path.join(VENDOR, f)), { recursive: true });
    copyFileSync(abs, path.join(VENDOR, f));
    files[f] = sha256(readFileSync(abs));
  }
  assertClosed(VENDOR, FILES);
  writeFileSync(MANIFEST, `${JSON.stringify({
    // Read by verify; and by a human wondering what this directory is.
    note: "Vendored, pinned copy of wafflebase/agent-pipeline. DO NOT EDIT — regenerate with scripts/vendor-pipeline.mjs --write.",
    repo: "wafflebase/agent-pipeline",
    commit: pinnedCommit(),
    files,
  }, null, 2)}\n`);
  console.log(`Vendored ${VENDORED.length} files (${FILES.length} modules, ${ASSETS.length} assets) at ${pinnedCommit().slice(0, 9)}.`);
  process.exit(0);
}

// Verify. Offline: re-hash what is on disk against the manifest.
if (!existsSync(MANIFEST)) die(`No ${path.relative(REPO, MANIFEST)}. Run with --pipeline-dir <checkout> --write.`);
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
const pinned = pinnedCommit();
const problems = [];

if (manifest.commit !== pinned) {
  problems.push(
    `The vendored copy is at ${String(manifest.commit).slice(0, 9)} but the workflows run ${pinned.slice(0, 9)}.`,
    "  Re-vendor: check out the pinned commit and run --pipeline-dir <checkout> --write.",
  );
}
const onDisk = existsSync(VENDOR) ? walkVendor(VENDOR).sort() : [];
const listed = Object.keys(manifest.files ?? {}).sort();
for (const f of listed) {
  const abs = path.join(VENDOR, f);
  if (!existsSync(abs)) { problems.push(`  missing: vendor/pipeline/${f}`); continue; }
  if (sha256(readFileSync(abs)) !== manifest.files[f]) problems.push(`  EDITED: vendor/pipeline/${f}`);
}
for (const f of onDisk) if (!listed.includes(f)) problems.push(`  unlisted file present: vendor/pipeline/${f}`);
if (onDisk.length) assertClosed(VENDOR, onDisk.filter((f) => f.endsWith(".mjs")));

if (problems.length) {
  die(
    "The vendored pipeline does not match its manifest.",
    "",
    ...problems,
    "",
    "vendor/pipeline/ is a PINNED DEPENDENCY — nothing here is edited by hand.",
    "Change the pipeline in wafflebase/agent-pipeline, tag it, bump the pin, then re-vendor.",
  );
}
console.log(`vendor/pipeline: ${listed.length} files verified at ${pinned.slice(0, 9)}.`);
