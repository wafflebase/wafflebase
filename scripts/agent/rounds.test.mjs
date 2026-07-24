import { test } from "node:test";
import assert from "node:assert/strict";
import { isFixerCommit, countFailedReviewRounds } from "./rounds.mjs";

const fixer = (sha, checkRuns = []) => ({ sha, parents: [{ sha: "p1" }], checkRuns });
const merge = (sha, checkRuns = []) => ({ sha, parents: [{ sha: "p1" }, { sha: "p2" }], checkRuns });
const failingRun = (name = "agent-review-correctness") => ({ name, app: { slug: "github-actions" }, conclusion: "failure" });
const passingRun = (name = "agent-review-correctness") => ({ name, app: { slug: "github-actions" }, conclusion: "success" });

test("isFixerCommit: one parent → true; merge (2) or root (0) → false", () => {
  assert.equal(isFixerCommit({ parents: [{ sha: "a" }] }), true);
  assert.equal(isFixerCommit({ parents: [{ sha: "a" }, { sha: "b" }] }), false);
  assert.equal(isFixerCommit({ parents: [] }), false);
  assert.equal(isFixerCommit({}), false);
  assert.equal(isFixerCommit(undefined), false);
});

test("countFailedReviewRounds: PR #521 shape — 3 fixer + 3 merge, same failing check → 3, not 6", () => {
  const req = ["agent-review-correctness"];
  const commits = [
    fixer("f1", [failingRun()]), fixer("f2", [failingRun()]), fixer("f3", [failingRun()]),
    merge("m1", [failingRun()]), merge("m2", [failingRun()]), merge("m3", [failingRun()]),
  ];
  assert.equal(countFailedReviewRounds(commits, req), 3);
});

test("countFailedReviewRounds: empty commits → 0", () => {
  assert.equal(countFailedReviewRounds([], ["agent-review-correctness"]), 0);
});

test("countFailedReviewRounds: fixer commit with only a passing check → not counted", () => {
  assert.equal(countFailedReviewRounds([fixer("f1", [passingRun()])], ["agent-review-correctness"]), 0);
});

test("countFailedReviewRounds: check-run name not in requiredCheckNames → not counted", () => {
  assert.equal(countFailedReviewRounds([fixer("f1", [failingRun("some-other-check")])], ["agent-review-correctness"]), 0);
});

test("countFailedReviewRounds: failing check-run from a different app.slug → not counted (regression guard)", () => {
  const commits = [fixer("f1", [{ name: "agent-review-correctness", app: { slug: "some-other-app" }, conclusion: "failure" }])];
  assert.equal(countFailedReviewRounds(commits, ["agent-review-correctness"]), 0);
});
