import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { GitFsStore } from "./store.mjs";

function tmpStore() {
  const root = mkdtempSync(path.join(tmpdir(), "agent-eval-store-"));
  return { store: new GitFsStore(root), root };
}

const runJson = (over = {}) => ({
  run_id: "R1", config_hash: "sha256:abc", corpus_version: "2026-07-28a",
  status: "complete", ...over,
});

test("putRun/getRun round-trips; config.snapshot is write-once", () => {
  const { store, root } = tmpStore();
  try {
    store.putRun("R1", { runJson: runJson(), configSnapshot: { config_hash: "sha256:abc", n: 1 } });
    // second putRun refreshes run.json but must NOT overwrite the snapshot
    store.putRun("R1", { runJson: runJson({ status: "partial" }), configSnapshot: { config_hash: "sha256:abc", n: 999 } });
    const got = store.getRun("R1");
    assert.equal(got.runJson.status, "partial");         // run.json updated
    assert.equal(got.configSnapshot.n, 1);               // snapshot frozen
    assert.equal(store.getRun("missing"), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("putItem is write-once and throws on re-write; getItem round-trips transcript", () => {
  const { store, root } = tmpStore();
  try {
    store.putRun("R1", { runJson: runJson(), configSnapshot: {} });
    const transcript = [{ type: "result", total_cost_usd: 0.5 }];
    store.putItem("R1", "pr-517", { envelope: { status: "ok", item_id: "pr-517" }, payload: { adapter: "reviewer", findings: [] }, transcript });
    assert.equal(store.hasItem("R1", "pr-517"), true);
    const got = store.getItem("R1", "pr-517");
    assert.equal(got.envelope.status, "ok");
    assert.equal(got.payload.adapter, "reviewer");
    assert.deepEqual(got.transcript, transcript);        // gzip round-trip
    assert.throws(() => store.putItem("R1", "pr-517", { envelope: {}, payload: {}, transcript: null }), /write-once/);
    assert.equal(store.getItem("R1", "missing"), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("listRuns filters by (configHash, corpusVersion)", () => {
  const { store, root } = tmpStore();
  try {
    store.putRun("R1", { runJson: runJson({ run_id: "R1", config_hash: "sha256:abc", corpus_version: "v1" }), configSnapshot: {} });
    store.putRun("R2", { runJson: runJson({ run_id: "R2", config_hash: "sha256:abc", corpus_version: "v1" }), configSnapshot: {} });
    store.putRun("R3", { runJson: runJson({ run_id: "R3", config_hash: "sha256:xyz", corpus_version: "v1" }), configSnapshot: {} });
    assert.deepEqual(store.listRuns({ configHash: "sha256:abc", corpusVersion: "v1" }), ["R1", "R2"]);
    assert.deepEqual(store.listRuns(), ["R1", "R2", "R3"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("scores: per-run and cross-run keyed separately; re-score overwrites", () => {
  const { store, root } = tmpStore();
  try {
    store.putScore({ scope: "per-run", runId: "R1" }, "reliability-v1", { a: 1 });
    store.putScore({ scope: "cross-run", configHash: "sha256:abc", corpusVersion: "v1" }, "reliability-v1", { kappa: 0.6 });
    assert.deepEqual(store.getScore({ scope: "per-run", runId: "R1" }, "reliability-v1"), { a: 1 });
    assert.equal(store.getScore({ scope: "cross-run", configHash: "sha256:abc", corpusVersion: "v1" }, "reliability-v1").kappa, 0.6);
    store.putScore({ scope: "per-run", runId: "R1" }, "reliability-v1", { a: 2 }); // re-score allowed
    assert.deepEqual(store.getScore({ scope: "per-run", runId: "R1" }, "reliability-v1"), { a: 2 });
    assert.throws(() => store.putScore({ scope: "bogus" }, "s", {}), /scope/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("corpus item + manifest round-trip; missing → null", () => {
  const { store, root } = tmpStore();
  try {
    store.putCorpusItem("pr-517", {
      meta: { id: "pr-517", source_pr: 517 },
      diff: "diff --git a b\n", changedFiles: ["a.ts", "b.ts"], issueSpec: "fix it",
    });
    const inp = store.getCorpusItemInput("pr-517");
    assert.equal(inp.meta.source_pr, 517);
    assert.equal(inp.diff, "diff --git a b\n");
    assert.deepEqual(inp.changedFiles, ["a.ts", "b.ts"]);
    assert.equal(inp.issueSpec, "fix it");
    store.putCorpusManifest("2026-07-28a", { corpus_version: "2026-07-28a", items: [{ id: "pr-517" }] });
    assert.deepEqual(store.getCorpus("2026-07-28a"), [{ id: "pr-517" }]);
    assert.equal(store.getCorpus("nope"), null);
    assert.equal(store.getCorpusItemInput("nope"), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("putConfig/getConfig round-trips; missing → null", () => {
  const { store, root } = tmpStore();
  try {
    store.putConfig("baseline-opus-s2", { config_id: "baseline-opus-s2", target: "reviewer" });
    assert.equal(store.getConfig("baseline-opus-s2").target, "reviewer");
    assert.equal(store.getConfig("nope"), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("issueSpec omitted when empty; getLabels null when reserved", () => {
  const { store, root } = tmpStore();
  try {
    store.putCorpusItem("pr-1", { meta: { id: "pr-1" }, diff: "x", changedFiles: [], issueSpec: "" });
    assert.equal(store.getCorpusItemInput("pr-1").issueSpec, null);
    assert.equal(store.getLabels("2026-07-28a", "pr-1"), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
