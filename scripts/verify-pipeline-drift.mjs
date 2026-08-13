// Keep the pipeline OUT of this repo, and keep what stays pointed at vendor/.
//
// WHY THIS EXISTS. `scripts/agent/` used to hold a full copy of the pipeline that
// did not execute — the workflows check the pipeline out of
// `wafflebase/agent-pipeline` at a pinned commit. So the `agent:tests` lane could
// pass against code that was not the code that runs, and by the time this lane was
// first written the two had already drifted on three files, in both directions.
//
// That copy is now DELETED, and these checks are what keep it deleted:
//
//   1. every checkout is pinned to a full commit sha, not a mutable tag or branch;
//   2. no file the pipeline repo owns may reappear under scripts/agent/;
//   3. nothing that stayed may IMPORT a path that used to resolve into it;
//   4. nor BUILD one as a string — `path.join(HERE, "lenses", …)` and friends; and
//   5. the vendored bytes match the pinned checkout, not merely their own manifest.
//
// 3 and 4 are the ones with teeth. While the mirror existed a stray `./severity.mjs`
// resolved, so the mistake was invisible; now it resolves nowhere, and without these
// it surfaces as a runtime crash inside a hunt or a replay, far from the commit that
// caused it. 4 is the worse half: a path built as a string fails when it is USED, and
// a fail-quiet reader turns it into wrong data instead of an error — `harvest.mjs`
// swallowed exactly that and recorded an empty `panelSaw` for every PR.
//
// 5 exists because `scripts/vendor-pipeline.mjs` can only prove vendor/ matches
// VENDOR.json, and both live here: a copy taken from the wrong commit, vendored with
// a matching manifest, satisfies it. This lane holds the pinned checkout, so it is
// the only place that can anchor those bytes to something external.
//
// The measurement half still needs the pipeline's own rules — its severity
// classification, its dedupe key, its lens manifest — so it reads them from
// `scripts/agent/vendor/pipeline/`, a pinned sha256-verified copy maintained by
// `scripts/vendor-pipeline.mjs`. Nobody edits that directory.
//
// Not a `verify:self` lane: it needs the pipeline repo on disk, and `verify:self`
// must keep working offline. CI checks this out and passes `--pipeline-dir`.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `from "x"`, `import("x")`, and side-effect `import "x"` — single- or double-quoted.
// Deliberately loose: the specifier is judged by RESOLVING it (below) rather than by
// its shape, so a mirror module named with a digit, an underscore, or sitting in a
// subdirectory cannot slip past the pattern. A shape-matching regex silently stops
// covering the case it was written for the moment someone adds such a file.
const IMPORT_RE = /(?:\bfrom|\bimport)\s*\(?\s*(["'])([^"'\n]+)\1/g;

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
  /^package-lock\.json$/,
  // `package.json` outlived the mirror on purpose. It declares what the RETAINED
  // half needs — the hunters `await import` the Agent SDK, and `eval/run.test.mjs`
  // reads the pinned SDK version straight out of it — so it is measurement's
  // manifest now, free to diverge from the pipeline's own.
  /^package\.json$/,
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

/**
 * Every pinned agent-pipeline ref in the workflows, with where it was found.
 *
 * Returns `{ pins, loose }`. A ref that is not a full 40-hex commit lands in `loose`
 * rather than being dropped: this used to silently ignore anything that was not a
 * sha, so a checkout re-pointed at `ref: main` — the mutable ref the whole pin
 * exists to avoid — was invisible here AND satisfied "all workflows agree" as long
 * as one sha-pinned site remained. The guard that caught that shape lived in
 * `scripts/agent/checks.test.mjs`, which the mirror deletion removed.
 */
export function readPins(workflowDir) {
  const pins = new Map();
  const loose = [];
  for (const file of readdirSync(workflowDir).filter((f) => f.startsWith("agent-") && f.endsWith(".yml"))) {
    const lines = readFileSync(path.join(workflowDir, file), "utf8").split("\n");
    lines.forEach((line, i) => {
      if (!/^\s*repository:\s*wafflebase\/agent-pipeline\s*(#.*)?$/.test(line)) return;
      const refLine = lines.slice(i + 1, i + 4).find((l) => /^\s*ref:/.test(l));
      const where = `${file}:${i + 2}`;
      if (refLine === undefined) { loose.push(`${where} — checkout has no ref: at all`); return; }
      const sha = /^\s*ref:\s*([0-9a-f]{40})\b/.exec(refLine)?.[1];
      if (sha) pins.set(sha, [...(pins.get(sha) ?? []), where]);
      else loose.push(`${where} — ${refLine.trim()}`);
    });
  }
  return { pins, loose };
}

/**
 * Paths that NAME a deleted pipeline file without importing it.
 *
 * The import check cannot see these: `path.join(HERE, "lenses", "lenses.json")` is a
 * string, resolved at runtime, and every one of them fails late — some of them
 * quietly. `harvest.mjs` swallowed exactly this ENOENT and recorded an empty
 * `panelSaw` for every PR, turning the miss corpus into a lie rather than an error.
 *
 * Anchored on `HERE`, the module's own directory, which is what makes this precise:
 * a `path.join(work, "lenses")` into a temp dir is a materialised fixture and must
 * not be flagged, while anything rooted at the module's own location is a reference
 * to this repository's tree. A call whose arguments mention `vendor` is the fix.
 */
export function stalePipelinePaths(root, pipelineFiles) {
  const names = new Set([...pipelineFiles].map((f) => f.split("/")[0]));
  const bad = [];
  const scan = (dir, base = "") => {
    for (const entry of readdirSync(dir)) {
      const rel = base ? `${base}/${entry}` : entry;
      const abs = path.join(dir, entry);
      if (statSync(abs).isDirectory()) {
        if (entry !== "node_modules" && entry !== "vendor") scan(abs, rel);
        continue;
      }
      if (!entry.endsWith(".mjs")) continue;
      const src = readFileSync(abs, "utf8");
      for (const m of src.matchAll(/path\.(?:join|resolve)\(\s*HERE\s*,([^)]*)\)/g)) {
        const args = m[1];
        if (/vendor/.test(args)) continue;
        for (const s of args.matchAll(/["']([^"']+)["']/g)) {
          if (names.has(s[1])) bad.push(`${rel} builds a path to ${s[1]}`);
        }
      }
    }
  };
  scan(root);
  return bad;
}

// The RETAINED half must read the pipeline through vendor/, never through the
// mirror. While the mirror still exists a stray `./severity.mjs` RESOLVES, so the
// mistake is invisible until the mirror is deleted — at which point it surfaces as
// a runtime crash inside a hunt or a replay.
//
// `mirrorModules` is supplied by the CALLER, read from the pipeline repo rather than
// from `root`, so this keeps working after F2 deletes the mirror — which is the case
// it exists for. Only files that STAY are scanned: the mirror importing its own
// siblings is correct, and is byte-compared against the pinned commit instead.
/**
 * Files under `root` that the pipeline repo owns — i.e. the mirror growing back.
 *
 * `vendor/` and every measurement path are in STAYS, so the vendored copy does not
 * count as a reappearance: it is a pinned dependency with its own verifier, and
 * reporting it here would tell people to delete the thing they are supposed to use.
 */
export function reappearedMirrorFiles(root, pipelineFiles) {
  return walk(root).filter((f) => pipelineFiles.has(f)).sort();
}

export function mirrorImports(root, mirrorModules) {
  const bad = [];
  const scan = (dir, base = "") => {
    for (const entry of readdirSync(dir)) {
      const rel = base ? `${base}/${entry}` : entry;
      const abs = path.join(dir, entry);
      if (statSync(abs).isDirectory()) {
        if (entry !== "node_modules" && entry !== "vendor") scan(abs, rel);
        continue;
      }
      if (!entry.endsWith(".mjs")) continue;
      if (!base && mirrorModules.has(entry)) continue; // a mirror file: exempt
      if (!base && mirrorModules.has(entry.replace(/\.test\.mjs$/, ".mjs"))) continue; // its test
      for (const [, , spec] of readFileSync(abs, "utf8").matchAll(IMPORT_RE)) {
        // A bare `vendor/…` is the exact mistake the message below warns about: Node
        // reads it as a PACKAGE name, so it resolves nowhere and fails only at runtime,
        // and only once something actually imports the file.
        if (spec.startsWith("vendor/")) {
          bad.push(`${rel} imports ${spec} (bare specifier — needs a leading ./ or ../)`);
          continue;
        }
        if (!spec.startsWith("./") && !spec.startsWith("../")) continue; // node:, package
        const target = path.relative(root, path.resolve(path.dirname(abs), spec));
        if (mirrorModules.has(target)) bad.push(`${rel} imports ${spec}`);
      }
    }
  };
  scan(root);
  return bad;
}

function die(lines) {
  console.error(lines.join("\n"));
  process.exit(1);
}

function main() {
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
  const { pins, loose } = readPins(path.join(REPO, ".github", "workflows"));
  if (loose.length) {
    die([
      "These agent-pipeline checkouts are not pinned to a full commit sha:",
      ...loose.map((l) => `  ${l}`),
      "",
      "A tag or branch is MUTABLE: what runs can change without any commit here, and",
      "the vendored copy is verified against the pinned sha, so a loose ref also means",
      "nothing anchors vendor/pipeline/ to what the workflows execute.",
      "Pin the 40-character commit, with the tag in a trailing comment.",
    ]);
  }
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

  // 2. The mirror must stay deleted. Anything here that the pipeline repo owns is a
  //    NEW mirror forming — the same failure the byte-comparison used to catch,
  //    stated in the form that survives the deletion. The exclusion-list design
  //    still does the work: a file nobody added to STAYS is a pipeline file by
  //    default, which is the safe direction.
  const pipelineFiles = new Set(walk(theirs).filter((f) => !staysBehind(f)));
  const reappeared = reappearedMirrorFiles(ours, pipelineFiles);
  if (reappeared.length) {
    die([
      "The pipeline mirror is growing back in scripts/agent/:",
      ...reappeared.map((f) => `  ${f}`),
      "",
      "These files belong to wafflebase/agent-pipeline and do NOT run from here. The",
      "workflows execute the pinned commit, so a copy in this repo is invisible in",
      "production while looking authoritative to anyone reading it.",
      "",
      "  * you need to change pipeline behaviour -> land it in wafflebase/agent-pipeline,",
      "                                             tag, then bump the pin here",
      "  * you need to READ pipeline code        -> import it from vendor/pipeline/,",
      "                                             or add it to that vendored set",
      "  * the file is really measurement        -> add it to STAYS in this script",
    ]);
  }

  // 3. The retained half must read the pipeline through vendor/, never by a path
  //    that used to resolve into the mirror. Now the primary check: with the mirror
  //    gone these no longer resolve at all, so this converts a runtime crash inside
  //    a hunt or a replay into a CI failure on the commit that introduced it.
  const badImports = mirrorImports(ours, pipelineFiles);
  if (badImports.length) {
    die([
      "These files import the DELETED mirror rather than vendor/pipeline/:",
      ...badImports.map((b) => `  ${b}`),
      "",
      "Import through vendor/pipeline/ — `./vendor/pipeline/severity.mjs`, or",
      "`../vendor/pipeline/…` from a subdirectory. The leading `./` is REQUIRED: a",
      "bare `vendor/…` is a package specifier to Node, and fails with",
      "\"Cannot find package 'vendor'\" only at runtime.",
      "",
      "If the module you need is not vendored yet, add it to FILES in",
      "scripts/vendor-pipeline.mjs and re-run --write.",
    ]);
  }

  // 4. Paths that NAME a deleted pipeline file without importing it. The import
  //    check above cannot see these, and they fail late — sometimes silently.
  const stalePaths = stalePipelinePaths(ours, pipelineFiles);
  if (stalePaths.length) {
    die([
      "These files build a path to something the pipeline owns, outside vendor/:",
      ...stalePaths.map((p) => `  ${p}`),
      "",
      "That path no longer exists. Unlike a bad import it does not fail at load —",
      "it fails when the code runs, and a fail-quiet reader turns it into wrong data",
      "rather than an error. Point it at vendor/pipeline/, e.g.",
      '`path.join(HERE, "vendor", "pipeline", "lenses", "lenses.json")`.',
    ]);
  }

  // 5. The vendored bytes must match the PINNED CHECKOUT, not merely the manifest
  //    committed beside them. `scripts/vendor-pipeline.mjs` re-hashes vendor/ against
  //    VENDOR.json offline, which catches a hand-edit — but both live in this repo,
  //    so a wrong copy vendored with a matching manifest satisfies it. This is the
  //    external anchor, and it is what the deleted byte-comparison used to provide.
  const vendorRoot = path.join(ours, "vendor", "pipeline");
  const manifestPath = path.join(ours, "vendor", "VENDOR.json");
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const wrong = [], absent = [];
    if (manifest.commit !== pinned) {
      die([
        `The vendored copy records ${String(manifest.commit).slice(0, 9)} but the workflows run ${pinned.slice(0, 9)}.`,
        "Re-vendor against the pinned commit: scripts/vendor-pipeline.mjs --pipeline-dir <checkout> --write.",
      ]);
    }
    for (const rel of Object.keys(manifest.files ?? {})) {
      const mine = path.join(vendorRoot, rel);
      const theirsFile = path.join(theirs, rel);
      if (!existsSync(theirsFile)) { absent.push(rel); continue; }
      if (!readFileSync(mine).equals(readFileSync(theirsFile))) wrong.push(rel);
    }
    if (wrong.length || absent.length) {
      die([
        `vendor/pipeline/ does not match wafflebase/agent-pipeline@${pinned.slice(0, 9)}:`,
        ...wrong.map((f) => `  differs:  ${f}`),
        ...absent.map((f) => `  not in the pinned commit at all:  ${f}`),
        "",
        "The manifest hashes agree with the bytes on disk, so this is not a hand-edit:",
        "the vendored copy was taken from a different commit than the one that runs.",
        "Re-vendor: scripts/vendor-pipeline.mjs --pipeline-dir <checkout> --write.",
      ]);
    }
  }

  console.log(
    `scripts/agent holds no pipeline mirror, and reads wafflebase/agent-pipeline@${pinned.slice(0, 9)} ` +
      `through vendor/ (bytes verified against the pinned checkout).`,
  );
  process.exit(0);
}

// Importable for `scripts/test/verify-pipeline-drift.test.mjs`: without this guard
// the module body runs on import and exits before a single assertion.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
