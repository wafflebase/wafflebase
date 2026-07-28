import { test } from "node:test";
import assert from "node:assert/strict";
import { buildItemMeta, manifestItem } from "./extract-corpus.mjs";

const view = {
  number: 517, title: "Fix X", author: { login: "agent" }, mergedAt: "2026-07-01T00:00:00Z",
  baseRefName: "main", baseRefOid: "base123", headRefOid: "head456",
  files: [{ path: "a.ts" }, { path: "b.ts" }],
};

test("buildItemMeta maps PR view + diff into a corpus meta", () => {
  const meta = buildItemMeta(view, "diff --git a b\n", "# Issue\nbody");
  assert.equal(meta.id, "pr-517");
  assert.equal(meta.source_pr, 517);
  assert.deepEqual(meta.changed_files, ["a.ts", "b.ts"]);
  assert.equal(meta.base_ref, "base123");
  assert.equal(meta.has_issue_spec, true);
  assert.match(meta.sha256_diff, /^sha256:[0-9a-f]{64}$/);
  assert.equal(meta.label_status, "unlabeled");
});

test("has_issue_spec is false for empty/whitespace issue spec", () => {
  assert.equal(buildItemMeta(view, "d", "").has_issue_spec, false);
  assert.equal(buildItemMeta(view, "d", "   ").has_issue_spec, false);
});

test("manifestItem is the compact index entry", () => {
  const meta = buildItemMeta(view, "d", "spec");
  assert.deepEqual(manifestItem(meta), {
    id: "pr-517", source_pr: 517, base_ref: "base123",
    sha256_diff: meta.sha256_diff, has_issue_spec: true,
  });
});
