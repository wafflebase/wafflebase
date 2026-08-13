// Turn a lenses directory into a config manifest (+ a reproduction snapshot), and
// turn a snapshot back into a lenses directory the panel can load. The bridge
// between "what settings produced this review?" and review-panel.mjs's on-disk
// `lenses.json` + `<id>.md` layout.
//
// THE BUG THIS FILE IS A FIX FOR, AND WHY IT SURVIVED. Both directions used to
// rebuild each lens from a HARDCODED SEVEN-FIELD LIST
// (`{id,title,model,samples,gating,needsIssueSpec,appliesWhen}`). Every field added
// to `lenses.json` after that list was written was therefore dropped — silently, in
// both directions. Two were: `scopeClasses` (#582's file-class routing) and
// `effort`.
//
// The cost was not theoretical. A materialised lenses dir carried no `effort` at
// all, so the panel saw `undefined` on every lens, `assertEffort` passed it (unset
// is legal), and all six lenses ran at the SDK default `high`. Production runs five
// of the six at `medium`. So every replay quietly upgraded 5 of 6 lenses on what
// review-panel.mjs calls "the panel's main cost dial" — a different reviewer AND a
// more expensive one. Note the SHAPE: `assertEffort` exists specifically to stop "a
// silent COST regression — no error, no changed output, nothing in the logs." It
// catches a WRONG value. It cannot catch one DELETED UPSTREAM of it. A validator
// only guards the door it stands in.
//
// And `scopeClasses` dropped means `lensScope` sees an omission, which it treats as
// EVERYTHING by design, so every replayed lens read the WHOLE pull-request diff
// instead of its file-class slice.
//
// WHY NEITHER WAS CAUGHT: the two bugs are the same bug at opposite ends of one
// round trip, and a round trip cannot see a field that neither end carries. The old
// test asserted `buildConfig(materializeLenses(...)) === the original hash` and
// passed, because a snapshot built and materialised by the same broken pair is
// perfectly self-consistent. The tests here round-trip against the REAL
// `scripts/agent/lenses/lenses.json`, never against their own output.
//
// SO THE FIELD LISTS ARE GONE. Both directions now COPY THE WHOLE LENS OBJECT and
// add or remove named keys — "adapters widen, never narrow", the convention this
// project adopted after upstream's `normalizeFindings` postmortem. A denylist of
// three derived keys can only ever drop those three; an allowlist of seven drops
// everything anyone adds next.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertEffort } from "../vendor/pipeline/ask.mjs";
import { parseArgs } from "../vendor/pipeline/gh-checks.mjs";
import { contentHash, configHash, CONFIG_HASH_VERSION } from "./config-hash.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Repo root, so `rubric_path` can be recorded repo-relative rather than as this
 * machine's absolute layout. `scripts/agent/eval/` → three levels up. */
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");

/** `scripts/agent/package.json` — the one place the SDK version is pinned. */
export const AGENT_PACKAGE_JSON = path.join(HERE, "..", "package.json");

/** The dependency whose pinned version is recorded as a result's `sdk_version`. */
export const SDK_PACKAGE = "@anthropic-ai/claude-agent-sdk";

/**
 * Keys that exist only inside a snapshot and must NOT be written into a
 * materialised `lenses.json`: all three are DERIVED from the rubric file that
 * `materializeLenses` writes beside it, so carrying them into a lenses dir would
 * put a second, staleable copy of the rubric's identity next to the rubric itself.
 *
 * A DENYLIST, not an allowlist, and that is the whole point of this module's
 * header: the failure mode being fixed is an allowlist that silently drops every
 * field added after it was written.
 */
export const SNAPSHOT_ONLY_LENS_KEYS = Object.freeze(["rubric_text", "rubric_sha256", "rubric_path"]);

/**
 * A lens id becomes a FILENAME at both boundaries — `lenses/<id>.md` is read here and
 * `destDir/<id>.md` is written by `materializeLenses` — so an id carrying a separator
 * or a `..` escapes the directory it is supposed to be confined to. Measured on the
 * unguarded version: an id of `../escaped` read a rubric from OUTSIDE the lenses dir
 * and then wrote a file OUTSIDE `destDir`.
 *
 * Rejected rather than sanitised, and rejected at BOTH boundaries rather than only
 * the write. Sanitising would silently map two distinct ids onto one filename, which
 * for a module whose entire job is telling two reviewers apart is the worse failure.
 * `capture-meta.mjs` established the idiom and the reason: a value that "survives
 * coercion but not this regex (`1e3`, ` 12`, `../..`) is how a path escapes its
 * prefix."
 *
 * `\` is refused as well as `/` even though POSIX does not treat it as a separator: a
 * snapshot written on Linux may be materialised on Windows, and the check has to hold
 * for whichever platform ends up joining the path.
 */
function assertSafeLensId(id, where) {
  const bad =
    typeof id !== "string" || id === "" || id === "." || id === ".." || id.includes("/") || id.includes("\\") || id.includes("\0");
  if (bad) {
    throw new Error(
      `${where}: lens id ${JSON.stringify(id)} is not usable as a filename — it must not be empty, ` +
        "`.`, `..`, or contain a path separator. A lens id becomes `<id>.md` at both ends of the round trip.",
    );
  }
  return id;
}

/**
 * The pinned SDK version, read from `scripts/agent/package.json` rather than
 * written down twice.
 *
 * It WAS written down twice — the CLI defaulted `--sdk-version` to a literal
 * "0.3.217". That happened to still be correct, which is the least useful state for
 * a duplicated constant to be in: it is the same drift class as the seven-field
 * lens lists above, and a wrong recorded SDK version is worse than an absent one
 * because it attributes a result to a build that never ran it.
 *
 * `readFile` is injected so a test can prove this READS rather than returns a
 * literal — a test that only compares the result against the same file it was read
 * from is tautological and would stay green over a re-hardcoded value.
 *
 * REFUSES on a RANGE. `sdk_version`'s only job is to say which build produced a
 * result; `^0.3.217` does not say that, and recording it would put an
 * unfalsifiable claim into a stored manifest. Throwing here is loud, free and
 * fixable by passing `--sdk-version` explicitly.
 */
export function pinnedSdkVersion({ readFile = (p) => readFileSync(p, "utf8"), pkgPath = AGENT_PACKAGE_JSON } = {}) {
  const pkg = JSON.parse(readFile(pkgPath));
  const pinned = ((pkg && pkg.dependencies) || {})[SDK_PACKAGE];
  if (typeof pinned !== "string" || pinned === "") {
    throw new Error(`${pkgPath} declares no ${SDK_PACKAGE} dependency — pass --sdk-version explicitly.`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(pinned)) {
    throw new Error(
      `${SDK_PACKAGE} is pinned as "${pinned}", which is a RANGE and does not identify the build that runs. ` +
        "Recording it would attribute a result to an unknown SDK; pass --sdk-version explicitly instead.",
    );
  }
  return pinned;
}

/**
 * Read a lenses dir (lenses.json + <id>.md rubrics) into a config manifest and a
 * reproduction snapshot. The manifest is the lean template (rubric hashes only);
 * the snapshot inlines full rubric text + the computed config_hash — the receipt.
 *
 * `capturedAt` is injectable so a snapshot can be byte-reproducible in a test.
 * Production passes nothing and gets a wall-clock stamp; it is provenance, never
 * hashed, and PR 3 established the same stance for corpus items (no wall-clock in
 * the item at all, determinism proved per-file).
 *
 * `sdkVersion` DEFAULTS to the pin rather than to `undefined`. An omitted one used
 * to drop the key out of the serialised manifest entirely — `JSON.stringify` elides
 * `undefined` — so a caller that simply forgot the option produced an unattributed
 * manifest with nothing anywhere saying so. Provenance that goes missing quietly is
 * the failure this whole subsystem keeps re-learning; every manifest this returns now
 * records which SDK build it belongs to, and a caller that wants a different one
 * still passes it.
 *
 * THIS IS THE WRITE PATH, so it REFUSES rather than approximates. Every lens's
 * `effort` is validated with the panel's own `assertEffort` before a snapshot
 * exists, because the panel validates it before spending a token: a snapshot of a
 * config the panel would refuse to start on is a guaranteed-wasted replay, and it
 * is cheaper to find out here. Every lens id is checked for filename safety at the
 * same point, for the same reason. `configHash`, by contrast, never throws — it is a
 * read path.
 */
export function buildConfig(lensesDir, { configId, target = "reviewer", sdkVersion = pinnedSdkVersion(), description = "", capturedAt } = {}) {
  const manifestPath = path.join(lensesDir, "lenses.json");
  const manifestLenses = JSON.parse(readFileSync(manifestPath, "utf8"));
  const lenses = manifestLenses.map((l) => {
    assertSafeLensId(l.id, manifestPath);
    try {
      assertEffort(l.effort);
    } catch (err) {
      throw new Error(`${manifestPath}: lens "${l.id}" has an invalid \`effort\` — ${err.message}`);
    }
    const rubricFile = path.join(lensesDir, `${l.id}.md`);
    const rubricText = readFileSync(rubricFile, "utf8");
    // WIDEN, never narrow: every key the manifest carries survives, whether or not
    // this module has heard of it. The three added here are derived from the rubric
    // file, which the lenses dir holds as bytes and a manifest holds as identity.
    return {
      ...l,
      // The file actually READ, not a hardcoded `scripts/agent/lenses/<id>.md`. With
      // a `--lenses-dir` pointing anywhere else the constant was simply false: it
      // named a path this run never opened, in the one field whose whole purpose is
      // to say where the bytes came from. Recorded repo-relative when the dir is
      // inside the repo, so a stored manifest carries no machine-specific layout.
      rubric_path: repoRelative(rubricFile),
      rubric_sha256: contentHash(rubricText),
      _rubric_text: rubricText, // stripped from the manifest; kept for the snapshot
    };
  });

  const manifest = {
    schema_version: 1,
    config_id: configId,
    config_hash_version: CONFIG_HASH_VERSION,
    target,
    description,
    sdk_version: sdkVersion,
    lenses: lenses.map((l) => stripKeys(l, ["_rubric_text"])),
  };
  const hash = configHash(manifest);
  const snapshot = {
    config_hash: hash,
    config_hash_version: CONFIG_HASH_VERSION,
    captured_at: capturedAt ?? new Date().toISOString(),
    schema_version: 1,
    config_id: configId,
    target,
    sdk_version: sdkVersion,
    // The snapshot swaps the rubric POINTER for the rubric BYTES: it has to stand
    // alone, because the file it points at is exactly the thing that moves.
    lenses: lenses.map((l) => ({ ...stripKeys(l, ["_rubric_text", "rubric_path"]), rubric_text: l._rubric_text })),
  };
  return { manifest, snapshot, config_hash: hash };
}

/** A path relative to the repo root when it is inside the repo, else resolved
 * absolute. Keeps `rubric_path` portable for the normal case without lying about an
 * out-of-tree lenses dir, which is the only case an absolute path can describe. */
function repoRelative(file) {
  const abs = path.resolve(file);
  const rel = path.relative(REPO_ROOT, abs);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : abs;
}

/** A shallow copy of `obj` without `keys`. Deletion, not reconstruction — see the
 * module header on why every field list in here is a denylist. */
function stripKeys(obj, keys) {
  const out = { ...obj };
  for (const k of keys) delete out[k];
  return out;
}

/**
 * Write a snapshot back out as a lenses dir review-panel.mjs can load: a
 * `lenses.json` (everything the manifest carried) + one `<id>.md` per rubric. Lets
 * the runner feed the panel exactly the config under test, from the frozen receipt.
 *
 * Every key survives except the three derived ones, so the panel receives the same
 * `scopeClasses` and the same `effort` it would have read from
 * `scripts/agent/lenses/` — including, for a lens that sets no `effort`, NO
 * `effort` key at all. Preserving an ABSENCE matters as much as preserving a value:
 * `security` runs at the SDK default by omission, and writing `"high"` out
 * explicitly would change the manifest's bytes while claiming to reproduce it.
 */
export function materializeLenses(snapshot, destDir) {
  // Every id checked BEFORE anything is written, so a bad one cannot leave a
  // half-materialised dir behind — and checked here as well as in `buildConfig`
  // because a snapshot may have been built elsewhere, or by an older version.
  for (const l of snapshot.lenses) assertSafeLensId(l.id, "snapshot");
  mkdirSync(destDir, { recursive: true });
  const lensesJson = snapshot.lenses.map((l) => stripKeys(l, SNAPSHOT_ONLY_LENS_KEYS));
  writeFileSync(path.join(destDir, "lenses.json"), JSON.stringify(lensesJson, null, 2) + "\n");
  for (const l of snapshot.lenses) writeFileSync(path.join(destDir, `${l.id}.md`), l.rubric_text ?? "");
  return destDir;
}

// --- CLI: emit a config manifest for inspection -----------------------------

/**
 * Resolve the CLI's options. Exported and pure so the two properties that matter
 * are testable without running the process:
 *
 *   1. `out` is `undefined` when `--out` is absent. There is NO DEFAULT OUTPUT
 *      PATH, deliberately — a default would let a forgotten flag write a manifest
 *      into whatever directory the operator happened to be standing in, and #675
 *      set the precedent (`--root` required, no default anywhere).
 *   2. `sdkVersion` comes from the pin unless the flag overrides it, so the literal
 *      that used to live here cannot come back without a test noticing.
 */
export function resolveCliOptions(argv, { readFile } = {}) {
  const args = parseArgs(argv);
  return {
    // The panel's own rubrics, which now arrive vendored: the pipeline lives in
    // wafflebase/agent-pipeline, and `vendor/pipeline/lenses/` is a pinned,
    // sha256-verified copy of them rather than a second maintained set.
    lensesDir: args["lenses-dir"] ?? path.join(HERE, "..", "vendor", "pipeline", "lenses"),
    out: args.out,
    configId: args["config-id"] ?? "baseline",
    sdkVersion: args["sdk-version"] ?? pinnedSdkVersion(readFile ? { readFile } : {}),
    description: args.description ?? "",
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const opts = resolveCliOptions(process.argv);
  const { manifest, config_hash } = buildConfig(opts.lensesDir, opts);
  if (opts.out) {
    mkdirSync(path.dirname(opts.out), { recursive: true });
    writeFileSync(opts.out, JSON.stringify(manifest, null, 2) + "\n");
  }
  console.log(JSON.stringify({ config_hash, manifest }, null, 2));
}
