import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildConfig, materializeLenses } from "./config-build.mjs";
import { configHash } from "./config-hash.mjs";

function fakeLensesDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "lenses-"));
  writeFileSync(path.join(dir, "lenses.json"), JSON.stringify([
    { id: "correctness", title: "Correctness", gating: "blocking", needsIssueSpec: false, appliesWhen: ["**"], model: "claude-opus-4-8", samples: 2 },
  ]));
  writeFileSync(path.join(dir, "correctness.md"), "RUBRIC TEXT");
  return dir;
}

test("buildConfig: manifest lean (no rubric text), snapshot carries text + hash", () => {
  const dir = fakeLensesDir();
  try {
    const { manifest, snapshot, config_hash } = buildConfig(dir, { configId: "c1", sdkVersion: "0.3.217" });
    // manifest lens has rubric_sha256 but NOT rubric_text
    assert.match(manifest.lenses[0].rubric_sha256, /^sha256:/);
    assert.equal(manifest.lenses[0].rubric_text, undefined);
    assert.equal("_rubric_text" in manifest.lenses[0], false);
    // snapshot carries the full text + the hash + config_hash
    assert.equal(snapshot.lenses[0].rubric_text, "RUBRIC TEXT");
    assert.equal(snapshot.config_hash, config_hash);
    assert.equal(configHash(manifest), config_hash);   // hash matches the manifest
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("materializeLenses round-trips into a panel-loadable lenses dir", () => {
  const dir = fakeLensesDir();
  const out = mkdtempSync(path.join(tmpdir(), "matlens-"));
  try {
    const { snapshot } = buildConfig(dir, { configId: "c1", sdkVersion: "0.3.217" });
    materializeLenses(snapshot, out);
    assert.ok(existsSync(path.join(out, "lenses.json")));
    assert.equal(readFileSync(path.join(out, "correctness.md"), "utf8"), "RUBRIC TEXT");
    const lj = JSON.parse(readFileSync(path.join(out, "lenses.json"), "utf8"));
    assert.equal(lj[0].id, "correctness");
    assert.equal(lj[0].samples, 2);
    // rebuild from the materialized dir → SAME config_hash (round-trip stable)
    const rebuilt = buildConfig(out, { configId: "c1", sdkVersion: "0.3.217" });
    assert.equal(rebuilt.config_hash, snapshot.config_hash);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(out, { recursive: true, force: true }); }
});
