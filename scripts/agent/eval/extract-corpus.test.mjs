import { test } from "node:test";
import assert from "node:assert/strict";
import { buildItemMeta, manifestItem, resolveReviewPoint, headAtOpen } from "./extract-corpus.mjs";

const view = {
  number: 517, title: "Fix X", author: { login: "agent" }, mergedAt: "2026-07-01T00:00:00Z",
  baseRefName: "main", baseRefOid: "base123", headRefOid: "head456",
  files: [{ path: "a.ts" }, { path: "b.ts" }], additions: 200, deletions: 40,
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

test("buildItemMeta records scope from additions+deletions (S/M/L)", () => {
  assert.equal(buildItemMeta({ ...view, additions: 200, deletions: 40 }, "d", "").scope, "M"); // 240
  assert.equal(buildItemMeta({ ...view, additions: 10, deletions: 5 }, "d", "").scope, "S");    // 15
  assert.equal(buildItemMeta({ ...view, additions: 500, deletions: 5 }, "d", "").scope, "L");   // 505
  assert.equal(buildItemMeta({ ...view, additions: 200, deletions: 40 }, "d", "").additions, 200);
});

test("has_issue_spec is false for empty/whitespace issue spec", () => {
  assert.equal(buildItemMeta(view, "d", "").has_issue_spec, false);
  assert.equal(buildItemMeta(view, "d", "   ").has_issue_spec, false);
});

test("headAtOpen: newest commit pushed before PR creation = the opened state", () => {
  const view = {
    headRefOid: "H", createdAt: "2026-07-22T01:34:18Z",
    commits: [
      { oid: "C1", committedDate: "2026-07-22T01:33:40Z" }, // before open
      { oid: "C2", committedDate: "2026-07-22T05:48:04Z" }, // pushed during review
      { oid: "C3", committedDate: "2026-07-22T23:44:54Z" },
    ],
  };
  assert.equal(headAtOpen(view), "C1");
});

test("headAtOpen: multiple pre-open commits → the latest of them", () => {
  const view = {
    headRefOid: "H", createdAt: "2026-07-22T10:00:00Z",
    commits: [
      { oid: "C1", committedDate: "2026-07-22T08:00:00Z" },
      { oid: "C2", committedDate: "2026-07-22T09:00:00Z" }, // both before open
      { oid: "C3", committedDate: "2026-07-22T11:00:00Z" }, // after
    ],
  };
  assert.equal(headAtOpen(view), "C2");
});

test("resolveReviewPoint: default is pr-open; uses head-at-open", () => {
  const view = {
    headRefOid: "H", baseRefOid: "B", createdAt: "2026-07-22T01:34:18Z",
    author: { login: "someone" }, headRefName: "feature/x",
    commits: [
      { oid: "C1", committedDate: "2026-07-22T01:33:40Z" },
      { oid: "C2", committedDate: "2026-07-22T05:48:04Z" },
    ],
  };
  const r = resolveReviewPoint(view); // default
  assert.equal(r.review_point, "pr-open");
  assert.equal(r.review_commit, "C1");
  assert.equal(r.review_base, "B");
});

test("resolveReviewPoint: auto → first for autonomous, head for others", () => {
  const auto = { headRefName: "agent/280-x", author: { login: "app/yorkie-agent" }, headRefOid: "H", baseRefOid: "B", commits: [{ oid: "C1" }, { oid: "C2" }] };
  const human = { headRefName: "feature/x", author: { login: "someone" }, headRefOid: "H", baseRefOid: "B", commits: [{ oid: "C1" }] };
  const a = resolveReviewPoint(auto, "auto");
  assert.deepEqual([a.review_point, a.review_commit, a.review_base], ["first", "C1", "B"]);
  const h = resolveReviewPoint(human, "auto");
  assert.deepEqual([h.review_point, h.review_commit], ["head", "H"]);
});

test("resolveReviewPoint: explicit modes override; empty commits → head fallback", () => {
  const v = { headRefName: "agent/1-x", author: { login: "app/yorkie-agent" }, headRefOid: "H", baseRefOid: "B", commits: [] };
  assert.equal(resolveReviewPoint(v, "head").review_commit, "H");
  assert.equal(resolveReviewPoint(v, "first").review_commit, "H"); // no commits → falls back to head oid
});

test("buildItemMeta carries the review point", () => {
  const meta = buildItemMeta(view, "d", "", { review_commit: "C1", review_base: "B", review_point: "first" });
  assert.equal(meta.review_commit, "C1");
  assert.equal(meta.review_point, "first");
});

test("manifestItem is the compact index entry", () => {
  const meta = buildItemMeta(view, "d", "spec");
  assert.deepEqual(manifestItem(meta), {
    id: "pr-517", source_pr: 517, base_ref: "base123",
    sha256_diff: meta.sha256_diff, has_issue_spec: true,
    scope: "M", provenance: "human", review_point: "head",
  });
});
