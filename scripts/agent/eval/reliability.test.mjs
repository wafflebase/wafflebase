import { test } from "node:test";
import assert from "node:assert/strict";
import { gateVerdict, fleissKappaBinary, computeReliability } from "./reliability.mjs";

test("gateVerdict: block iff a kept finding is critical/major", () => {
  assert.equal(gateVerdict({ findings: [{ severity: "major" }] }), "block");
  assert.equal(gateVerdict({ findings: [{ severity: "critical" }] }), "block");
  assert.equal(gateVerdict({ findings: [{ severity: "minor" }, { severity: "nit" }] }), "approve");
  assert.equal(gateVerdict({ findings: [] }), "approve");
  assert.equal(gateVerdict({}), "approve");
});

test("fleissKappaBinary: perfect agreement WITH variance → κ = 1", () => {
  // 2 items block-by-all, 2 items approve-by-all, K=3 → agreement perfect, both categories present
  const k = fleissKappaBinary([
    { block: 3, approve: 0 }, { block: 3, approve: 0 },
    { block: 0, approve: 3 }, { block: 0, approve: 3 },
  ]);
  assert.equal(k, 1);
});

test("fleissKappaBinary: no variance (all same category) → null (undefined)", () => {
  assert.equal(fleissKappaBinary([{ block: 3, approve: 0 }, { block: 3, approve: 0 }]), null);
});

test("fleissKappaBinary: unequal rater counts or K<2 → null", () => {
  assert.equal(fleissKappaBinary([{ block: 2, approve: 1 }, { block: 1, approve: 3 }]), null); // K mismatch
  assert.equal(fleissKappaBinary([{ block: 1, approve: 1 }]), null); // N<2
});

test("fleissKappaBinary: maximal disagreement → κ < 0", () => {
  // every item split 1/1 with K=2 → observed agreement 0, expected 0.5 → κ = -1
  const k = fleissKappaBinary([
    { block: 1, approve: 1 }, { block: 1, approve: 1 },
    { block: 1, approve: 1 }, { block: 1, approve: 1 },
  ]);
  assert.ok(k < 0);
});

test("computeReliability: stable items, flip detection, common-item filter", () => {
  const runs = [
    { runId: "A", verdicts: { i1: "block", i2: "approve", i3: "block" } },
    { runId: "B", verdicts: { i1: "block", i2: "approve", i3: "approve" } }, // i3 flips
    { runId: "C", verdicts: { i1: "block", i2: "approve", i3: "block", i4: "block" } }, // i4 not common
  ];
  const { per_item, aggregate } = computeReliability(runs);
  assert.equal(aggregate.n, 3);              // i1..i3 common; i4 excluded
  assert.equal(aggregate.k_runs, 3);
  assert.equal(aggregate.items_excluded, 1);
  assert.equal(per_item.i1.verdict_stable, true);
  assert.equal(per_item.i3.verdict_stable, false);
  assert.ok(Math.abs(aggregate.verdict_flip_rate - 1 / 3) < 1e-9);
});

test("computeReliability: <2 runs → note, no metric", () => {
  const { aggregate } = computeReliability([{ runId: "A", verdicts: { i1: "block" } }]);
  assert.equal(aggregate.n, 0);
  assert.match(aggregate.note, /≥2 runs/);
});
