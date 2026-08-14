// Tests for the config manifest / snapshot round trip.
//
// THE ONE THAT MATTERS runs against the REAL `scripts/agent/lenses/lenses.json`, not
// a fixture. The bug this module was written to fix was invisible to a round trip
// over a fixture: `buildConfig` dropped `scopeClasses` and `effort` on the way in,
// `materializeLenses` dropped them again on the way out, and a snapshot built and
// materialised by the same broken pair is perfectly self-consistent. The old test
// asserted exactly that self-consistency and passed. A round trip cannot see a
// field neither of its ends carries — so the fixed point has to be the real
// manifest.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildConfig,
  materializeLenses,
  pinnedSdkVersion,
  resolveCliOptions,
  AGENT_PACKAGE_JSON,
  SDK_PACKAGE,
  SNAPSHOT_ONLY_LENS_KEYS,
} from "./config-build.mjs";
import { configHash, CONFIG_HASH_VERSION } from "./config-hash.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REAL_LENSES_DIR = path.join(HERE, "..", "vendor", "pipeline", "lenses");
const PINNED_AT_WRITING = "0.3.217";

function tmp(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

/** A minimal lenses dir carrying one made-up field, so "widen, never narrow" is
 * asserted against a field this module has never heard of. */
function fakeLensesDir(overrides = {}) {
  const dir = tmp("lenses-");
  writeFileSync(path.join(dir, "lenses.json"), JSON.stringify([{
    id: "correctness",
    title: "Correctness",
    gating: "blocking",
    needsIssueSpec: false,
    appliesWhen: ["**"],
    scopeClasses: ["code", "policy"],
    model: "claude-opus-5",
    samples: 1,
    effort: "medium",
    someFutureField: "must survive both directions",
    ...overrides,
  }]));
  writeFileSync(path.join(dir, "correctness.md"), "RUBRIC TEXT");
  return dir;
}

// --- the manifest / snapshot split -------------------------------------------

test("buildConfig: manifest is lean, snapshot carries the rubric text and the hash", () => {
  const dir = fakeLensesDir();
  try {
    const { manifest, snapshot, config_hash } = buildConfig(dir, { configId: "c1", sdkVersion: PINNED_AT_WRITING, capturedAt: "2026-08-05T00:00:00.000Z" });
    assert.match(manifest.lenses[0].rubric_sha256, /^sha256:/);
    assert.equal(manifest.lenses[0].rubric_text, undefined);
    assert.equal("_rubric_text" in manifest.lenses[0], false);
    // The file this run actually read — see the rubric_path tests below for why this
    // is not the constant `scripts/agent/lenses/<id>.md` it used to be.
    assert.equal(path.resolve(manifest.lenses[0].rubric_path), path.join(dir, "correctness.md"));
    // The snapshot swaps the pointer for the bytes: it must stand alone, because the
    // file it would point at is the thing that moves.
    assert.equal(snapshot.lenses[0].rubric_text, "RUBRIC TEXT");
    assert.equal(snapshot.lenses[0].rubric_path, undefined);
    assert.equal(snapshot.config_hash, config_hash);
    assert.equal(configHash(manifest), config_hash);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("buildConfig: both outputs record which hash algorithm produced them", () => {
  const dir = fakeLensesDir();
  try {
    const { manifest, snapshot } = buildConfig(dir, { configId: "c1", sdkVersion: PINNED_AT_WRITING });
    assert.equal(manifest.config_hash_version, CONFIG_HASH_VERSION);
    assert.equal(snapshot.config_hash_version, CONFIG_HASH_VERSION);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("buildConfig: captured_at is injectable, so a snapshot is byte-reproducible", () => {
  // PR 3 took the same stance for corpus items — determinism proved per-file, no
  // wall clock anywhere in the payload. Here the stamp stays (it is real
  // provenance, and it is excluded from the hash) but a test can pin it.
  const dir = fakeLensesDir();
  try {
    const at = "2026-08-05T12:00:00.000Z";
    const a = buildConfig(dir, { configId: "c1", sdkVersion: PINNED_AT_WRITING, capturedAt: at });
    const b = buildConfig(dir, { configId: "c1", sdkVersion: PINNED_AT_WRITING, capturedAt: at });
    assert.equal(a.snapshot.captured_at, at);
    assert.equal(JSON.stringify(a.snapshot), JSON.stringify(b.snapshot), "a pinned capture time must give byte-identical snapshots");
    const live = buildConfig(dir, { configId: "c1", sdkVersion: PINNED_AT_WRITING });
    assert.match(live.snapshot.captured_at, /^\d{4}-\d{2}-\d{2}T/, "production still stamps a real time");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("buildConfig: captured_at does not change identity", () => {
  const dir = fakeLensesDir();
  try {
    const a = buildConfig(dir, { configId: "c1", capturedAt: "2020-01-01T00:00:00.000Z" });
    const b = buildConfig(dir, { configId: "c1", capturedAt: "2026-08-05T00:00:00.000Z" });
    assert.equal(a.config_hash, b.config_hash);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- widen, never narrow -----------------------------------------------------

test("buildConfig: a field this module has never heard of survives on the way IN", () => {
  const dir = fakeLensesDir();
  try {
    const { manifest, snapshot } = buildConfig(dir, { configId: "c1" });
    assert.equal(manifest.lenses[0].someFutureField, "must survive both directions");
    assert.equal(snapshot.lenses[0].someFutureField, "must survive both directions");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("materializeLenses: a field this module has never heard of survives on the way OUT", () => {
  const dir = fakeLensesDir();
  const out = tmp("matlens-");
  try {
    const { snapshot } = buildConfig(dir, { configId: "c1" });
    materializeLenses(snapshot, out);
    const written = JSON.parse(readFileSync(path.join(out, "lenses.json"), "utf8"));
    assert.equal(written[0].someFutureField, "must survive both directions");
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(out, { recursive: true, force: true }); }
});

test("materializeLenses: writes a dir the panel can load, minus the derived keys", () => {
  const dir = fakeLensesDir();
  const out = tmp("matlens-");
  try {
    const { snapshot } = buildConfig(dir, { configId: "c1" });
    materializeLenses(snapshot, out);
    assert.ok(existsSync(path.join(out, "lenses.json")));
    assert.equal(readFileSync(path.join(out, "correctness.md"), "utf8"), "RUBRIC TEXT");
    const written = JSON.parse(readFileSync(path.join(out, "lenses.json"), "utf8"));
    // The rubric's identity lives in the file beside it, not in a second copy that
    // can go stale against it.
    for (const key of SNAPSHOT_ONLY_LENS_KEYS) {
      assert.equal(key in written[0], false, `${key} is derived and must not be written into a lenses dir`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(out, { recursive: true, force: true }); }
});

// --- the round trip that has to be against the real manifest -----------------

test("round trip over the REAL lenses.json preserves every lens field and the identity", () => {
  const out = tmp("real-matlens-");
  try {
    const source = JSON.parse(readFileSync(path.join(REAL_LENSES_DIR, "lenses.json"), "utf8"));
    assert.ok(source.length >= 6, `expected the real manifest, got ${source.length} lenses`);

    const { snapshot, config_hash } = buildConfig(REAL_LENSES_DIR, { configId: "live", sdkVersion: PINNED_AT_WRITING });
    materializeLenses(snapshot, out);
    const written = JSON.parse(readFileSync(path.join(out, "lenses.json"), "utf8"));

    assert.equal(written.length, source.length);
    for (const [i, before] of source.entries()) {
      const after = written[i];
      assert.equal(after.id, before.id, "lens order must survive");
      // Field by field, including the two that were dropped and the ABSENCES, which
      // matter as much: `security` sets no `effort` and must not acquire one.
      assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort(), `lens ${before.id}: key set changed`);
      for (const key of Object.keys(before)) {
        assert.deepEqual(after[key], before[key], `lens ${before.id}: ${key} did not survive the round trip`);
      }
    }

    // And the reviewer the materialised dir describes is the SAME reviewer.
    const rebuilt = buildConfig(out, { configId: "live", sdkVersion: PINNED_AT_WRITING });
    assert.equal(rebuilt.config_hash, config_hash, "the materialised dir describes a different reviewer");
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("the effort cost regression is closed: every live value survives materialisation", () => {
  // The specific, measured regression. A materialised dir used to carry NO `effort`
  // on any lens, so the panel saw `undefined` everywhere, `assertEffort` passed it
  // (unset is legal), and all six lenses ran at the SDK default `high`. Five of six
  // run at `medium` in production. That is a different reviewer and a more expensive
  // one, on what review-panel.mjs calls "the panel's main cost dial".
  const out = tmp("effort-matlens-");
  try {
    const source = JSON.parse(readFileSync(path.join(REAL_LENSES_DIR, "lenses.json"), "utf8"));
    const { snapshot } = buildConfig(REAL_LENSES_DIR, { configId: "live" });
    materializeLenses(snapshot, out);
    const written = JSON.parse(readFileSync(path.join(out, "lenses.json"), "utf8"));

    const setEffort = source.filter((l) => l.effort !== undefined);
    const unsetEffort = source.filter((l) => l.effort === undefined);
    assert.ok(setEffort.length >= 1 && unsetEffort.length >= 1,
      "the live manifest no longer mixes set and unset effort — this test's premise was that asymmetry");

    for (const before of setEffort) {
      const after = written.find((l) => l.id === before.id);
      assert.equal(after.effort, before.effort, `lens ${before.id} would replay at a different effort`);
    }
    for (const before of unsetEffort) {
      const after = written.find((l) => l.id === before.id);
      assert.equal("effort" in after, false, `lens ${before.id} sets no effort and must not acquire one`);
    }

    // And the same for the routing field, whose loss meant every replayed lens read
    // the whole pull-request diff instead of its file-class slice.
    for (const before of source) {
      const after = written.find((l) => l.id === before.id);
      assert.deepEqual(after.scopeClasses, before.scopeClasses, `lens ${before.id} would replay over the wrong slice of the diff`);
    }
  } finally { rmSync(out, { recursive: true, force: true }); }
});

// --- the write path refuses ---------------------------------------------------

test("buildConfig refuses a config the panel would refuse to start on", () => {
  // The panel validates every `effort` before the first token is spent. A snapshot
  // of an invalid config is a guaranteed-wasted replay, and it is cheaper to find
  // out here. `configHash` by contrast never throws — it is a read path.
  const dir = fakeLensesDir({ effort: "hgih" });
  try {
    assert.throws(() => buildConfig(dir, { configId: "c1" }), /lens "correctness" has an invalid `effort`/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("buildConfig accepts an ABSENT effort — unset is legal and is the live case", () => {
  const dir = fakeLensesDir({ effort: undefined });
  try {
    const { snapshot } = buildConfig(dir, { configId: "c1" });
    assert.equal("effort" in snapshot.lenses[0], false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// --- a lens id becomes a filename at both ends --------------------------------

test("buildConfig refuses a lens id that would escape the lenses dir", () => {
  // Measured on the unguarded version: an id of `../escaped` READ a rubric from
  // outside the lenses dir. Refused rather than sanitised — sanitising would map two
  // distinct ids onto one filename, which for a module whose job is telling two
  // reviewers apart is the worse failure.
  const dir = tmp("lenses-esc-");
  const outside = path.join(dir, "escaped.md");
  const nested = path.join(dir, "sub");
  try {
    mkdirSync(nested, { recursive: true });
    writeFileSync(outside, "OUTSIDE THE LENSES DIR");
    writeFileSync(path.join(nested, "lenses.json"), JSON.stringify([{ id: "../escaped", title: "E", model: "m", samples: 1 }]));
    assert.throws(() => buildConfig(nested, { configId: "c1" }), /is not usable as a filename/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("materializeLenses refuses the same, and writes nothing before it does", () => {
  // Checked here as well as in buildConfig because a snapshot may have been built
  // elsewhere or by an older version — and checked before the first write, so a bad
  // id cannot leave a half-materialised dir behind.
  const out = tmp("matlens-esc-");
  try {
    const snapshot = { lenses: [{ id: "ok", rubric_text: "R" }, { id: "../escaped", rubric_text: "BAD" }] };
    assert.throws(() => materializeLenses(snapshot, path.join(out, "dest")), /is not usable as a filename/);
    assert.equal(existsSync(path.join(out, "escaped.md")), false, "a rubric was written outside destDir");
    assert.equal(existsSync(path.join(out, "dest", "lenses.json")), false, "a partial lenses dir was left behind");
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test("every id form that is not a plain filename is refused, at both boundaries", () => {
  for (const id of ["", ".", "..", "a/b", "../x", "a\\b", "sub/../x"]) {
    const snapshot = { lenses: [{ id, rubric_text: "R" }] };
    const out = tmp("matlens-form-");
    try {
      assert.throws(() => materializeLenses(snapshot, out), /is not usable as a filename/, `id ${JSON.stringify(id)} was accepted`);
    } finally { rmSync(out, { recursive: true, force: true }); }
  }
  // And the live ids still pass, which is the half a guard usually gets wrong.
  const live = JSON.parse(readFileSync(path.join(REAL_LENSES_DIR, "lenses.json"), "utf8"));
  const out = tmp("matlens-live-");
  try {
    const { snapshot } = buildConfig(REAL_LENSES_DIR, { configId: "live" });
    materializeLenses(snapshot, out);
    for (const l of live) assert.ok(existsSync(path.join(out, `${l.id}.md`)), `lens ${l.id} was rejected`);
  } finally { rmSync(out, { recursive: true, force: true }); }
});

// --- rubric_path names the file that was actually read ------------------------

test("rubric_path follows --lenses-dir instead of naming a file it never opened", () => {
  // It used to be the constant `scripts/agent/lenses/<id>.md` regardless, so with any
  // other lenses dir the one field whose purpose is to say where the bytes came from
  // was simply false.
  const dir = fakeLensesDir();
  try {
    const { manifest } = buildConfig(dir, { configId: "c1" });
    const recorded = manifest.lenses[0].rubric_path;
    assert.notEqual(recorded, "scripts/agent/lenses/correctness.md", "rubric_path is still the hardcoded default");
    assert.equal(path.resolve(recorded), path.join(dir, "correctness.md"), "rubric_path must resolve to the file that was read");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("rubric_path stays repo-relative for the real lenses dir", () => {
  // The normal case must carry no machine-specific layout into a stored manifest.
  const { manifest } = buildConfig(REAL_LENSES_DIR, { configId: "live" });
  for (const lens of manifest.lenses) {
    assert.equal(lens.rubric_path, path.join("scripts", "agent", "vendor", "pipeline", "lenses", `${lens.id}.md`));
    assert.equal(path.isAbsolute(lens.rubric_path), false);
  }
});

// --- provenance: the SDK version is read, not written down twice --------------

test("a manifest always records which SDK build it belongs to", () => {
  // An omitted `sdkVersion` used to drop the key out of the serialised manifest
  // entirely (JSON.stringify elides undefined), so a caller that simply forgot the
  // option produced an unattributed manifest with nothing saying so.
  const dir = fakeLensesDir();
  try {
    const { manifest, snapshot } = buildConfig(dir, { configId: "c1" }); // no sdkVersion
    const round = JSON.parse(JSON.stringify(manifest));
    assert.ok("sdk_version" in round, "sdk_version vanished from the serialised manifest");
    assert.match(round.sdk_version, /^\d+\.\d+\.\d+$/);
    assert.equal(round.sdk_version, pinnedSdkVersion(), "the default must be the pin");
    assert.equal(snapshot.sdk_version, round.sdk_version);
    // An explicit value still wins.
    assert.equal(buildConfig(dir, { configId: "c1", sdkVersion: "1.2.3" }).manifest.sdk_version, "1.2.3");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("pinnedSdkVersion READS the pin (proved with an injected file, not with the file itself)", () => {
  // A test that compares the result against the same package.json it was read from
  // is tautological: it would stay green over a re-hardcoded literal. So the reader
  // is injected and the expected value is one no hardcode could return.
  const fake = JSON.stringify({ dependencies: { [SDK_PACKAGE]: "9.9.9" } });
  assert.equal(pinnedSdkVersion({ readFile: () => fake }), "9.9.9");
});

test("pinnedSdkVersion resolves against the real package.json", () => {
  const real = pinnedSdkVersion();
  assert.match(real, /^\d+\.\d+\.\d+$/);
  const declared = JSON.parse(readFileSync(AGENT_PACKAGE_JSON, "utf8")).dependencies[SDK_PACKAGE];
  assert.equal(real, declared);
});

test("pinnedSdkVersion refuses a RANGE rather than recording an unfalsifiable version", () => {
  // `sdk_version`'s only job is to say which build produced a result. `^0.3.217`
  // does not say that, and a wrong recorded version is worse than an absent one.
  const ranged = JSON.stringify({ dependencies: { [SDK_PACKAGE]: "^0.3.217" } });
  assert.throws(() => pinnedSdkVersion({ readFile: () => ranged }), /is a RANGE and does not identify the build/);
  const missing = JSON.stringify({ dependencies: {} });
  assert.throws(() => pinnedSdkVersion({ readFile: () => missing }), /declares no @anthropic-ai\/claude-agent-sdk/);
});

// --- the CLI has no default output path --------------------------------------

test("resolveCliOptions: --out has NO default, so a forgotten flag writes nothing", () => {
  // #675 set the precedent: `--root` required, no default anywhere, so a forgotten
  // flag cannot write into a directory nobody chose.
  const fake = JSON.stringify({ dependencies: { [SDK_PACKAGE]: "9.9.9" } });
  const readFile = () => fake;
  const bare = resolveCliOptions(["node", "config-build.mjs"], { readFile });
  assert.equal(bare.out, undefined, "--out must not acquire a default output path");
  const given = resolveCliOptions(["node", "config-build.mjs", "--out", "/tmp/x/manifest.json"], { readFile });
  assert.equal(given.out, "/tmp/x/manifest.json");
});

test("resolveCliOptions: sdkVersion comes from the pin, and the flag overrides it", () => {
  const fake = JSON.stringify({ dependencies: { [SDK_PACKAGE]: "9.9.9" } });
  const readFile = () => fake;
  assert.equal(resolveCliOptions(["node", "cb.mjs"], { readFile }).sdkVersion, "9.9.9");
  assert.equal(resolveCliOptions(["node", "cb.mjs", "--sdk-version", "1.2.3"], { readFile }).sdkVersion, "1.2.3");
});

test("resolveCliOptions: the default lenses dir is the panel's own", () => {
  const readFile = () => JSON.stringify({ dependencies: { [SDK_PACKAGE]: "9.9.9" } });
  const opts = resolveCliOptions(["node", "cb.mjs"], { readFile });
  assert.equal(opts.lensesDir, REAL_LENSES_DIR);
  assert.equal(opts.configId, "baseline");
});
