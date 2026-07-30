import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isFixerCommit,
  countFailedReviewRounds,
  summaryTokens,
  findingSimilarity,
  repeatRatio,
  groupReviewRounds,
  detectStalledRounds,
} from "./rounds.mjs";

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

// --- convergence detection ---------------------------------------------------

// The four summaries below are VERBATIM from PR #564's design-fit lens, round 2:
// one defect, four wordings, same file. An exact-text key (what dedupeFindings
// uses) saw four distinct findings; that is why this path needs fuzzy matching.
const D564 = [
  "Deliverables 2 and 3 are not actually implemented: the changes to agent-review-panel.yml, agent-iterate-ci.yml, and agent-implement.yml live only as text inside a committed .patch file under docs/tasks/active/, and are never applied to the real workflow files.",
  "Deliverables 2 & 3 are not actually applied — the workflow changes live only in an unapplied .patch file, so the pipeline gets none of the fixer-checklist or exploration-focus behavior the issue requires.",
  "Deliverables 2 and 3 are not actually implemented: the workflow prompt changes live only as inert text inside docs/tasks/active/20260727-scope-lenses-tighten-fixer-workflow-prompts.patch, and were never applied to the real .github/workflows/*.yml files.",
  "Deliverables 2 & 3 are not actually implemented — the fixer/implement prompt changes exist only as an inert .patch file committed under docs/, not applied to the workflow YAMLs. The issue requires edits to agent-review-panel.yml, agent-iterate-ci.yml, and agent-implement.yml; those files are unchanged",
];
const PATCH_FILE = "docs/tasks/active/20260727-scope-lenses-tighten-fixer-workflow-prompts.patch";
const f = (lens, file, summary) => ({ lens, file, summary, severity: "major" });
const round = (findings, partial = false, sha = "s") => ({ sha, findings, partial });

test("summaryTokens: splits identifiers, drops stopwords/short tokens, sorted + deduped", () => {
  // camelCase splits (readOnly → read+only, EditorAPI → editor+api); "on" is
  // too short and "only" is a stopword, so both drop out.
  assert.deepEqual(summaryTokens("readOnly guard on EditorAPI.paste()"), [
    "api", "editor", "guard", "paste", "read",
  ]);
  // snake_case, paths and dots all split; "the"/"is" dropped; "ts" too short
  assert.deepEqual(
    summaryTokens("the cache_read_input_tokens in a/b/file.ts is wrong"),
    ["cache", "file", "input", "read", "tokens", "wrong"].sort(),
  );
  assert.deepEqual(summaryTokens(""), []);
  assert.deepEqual(summaryTokens(null), []);
  assert.deepEqual(summaryTokens("!!! ... ???"), []); // punctuation only
  assert.deepEqual(summaryTokens("Bug X"), summaryTokens("bug x")); // case-insensitive
});

test("findingSimilarity: the real #564 rephrasings all match; lens/file gate to 0", () => {
  // Every pair of the four REAL wordings must clear the calibrated 0.3 threshold.
  for (let i = 0; i < D564.length; i++) {
    for (let j = i + 1; j < D564.length; j++) {
      const s = findingSimilarity(f("design-fit", PATCH_FILE, D564[i]), f("design-fit", PATCH_FILE, D564[j]));
      assert.ok(s >= 0.3, `#564 wordings ${i}/${j} scored ${s.toFixed(2)}, expected >= 0.3`);
    }
  }
  // Same text, DIFFERENT lens or DIFFERENT file → 0. This gate is what stops
  // three distinct bugs in one file (fixed one per round) reading as a repeat.
  assert.equal(findingSimilarity(f("design-fit", "a.ts", D564[0]), f("security", "a.ts", D564[0])), 0);
  assert.equal(findingSimilarity(f("design-fit", "a.ts", D564[0]), f("design-fit", "b.ts", D564[0])), 0);
  // Unrelated findings in the same file stay well below threshold.
  assert.ok(findingSimilarity(f("c", "a.ts", "off-by-one in the row loop"), f("c", "a.ts", D564[0])) < 0.3);
  // Degenerate tokens (coerceFindings placeholder) fall back to exact equality.
  const ph = "(malformed finding — treated as blocking)";
  assert.equal(findingSimilarity(f("c", "a.ts", ph), f("c", "a.ts", ph)), 1);
  assert.equal(findingSimilarity(f("c", "a.ts", "!!!"), f("c", "a.ts", "???")), 0);
  assert.equal(findingSimilarity(null, f("c", "a.ts", "x")), 0);
});

test("repeatRatio: many-to-one — N wordings of one prior are all repeats", () => {
  const a = f("c", "a.ts", "MIN over an all-blank range returns #NUM!");
  const b = f("c", "b.ts", "unrelated null deref in the header path");
  assert.equal(repeatRatio([a], [a]), 1);
  // The duplication case the panel actually produces: one prior, two wordings
  // of it this round. All of this round is recycled, so 1.0 — a one-to-one
  // pairing would score 0.5 and miss exactly when the loop is most stuck.
  assert.equal(repeatRatio([a], [a, a]), 1);
  const rephrased = f("c", PATCH_FILE, D564[1]);
  assert.equal(repeatRatio([f("c", PATCH_FILE, D564[0])], [rephrased, rephrased]), 1);
  // A genuinely new finding alongside a repeat still drags the ratio down.
  assert.equal(repeatRatio([a], [a, b]), 0.5);
  assert.equal(repeatRatio([a], [b]), 0);
  assert.equal(repeatRatio([], [a]), 0);
  assert.equal(repeatRatio([a], []), 0); // clean round is never a repeat
  assert.equal(repeatRatio(null, null), 0);
});

test("detectStalledRounds: the #521 shape — flat count, same findings → stalled", () => {
  const fs = [f("design-fit", PATCH_FILE, D564[0]), f("security", "lenses.json", "security scoped away from root files")];
  const r = detectStalledRounds([round(fs), round(fs), round(fs)]);
  assert.equal(r.stalled, true);
  assert.equal(r.stalls, 2);
  assert.equal(r.reason, "repeat-without-reduction");
  assert.ok(r.repeated.length > 0, "must name the findings it is paging about");
});

// THE most important negative. Carry-forward re-merges unresolved priors every
// round BY DESIGN, so a healthy PR shows near-total overlap. Keying on overlap
// alone would page on essentially every PR; only the count test saves us.
test("detectStalledRounds: shrinking 3→2→1 at overlap 1.0 is PROGRESS, not a stall", () => {
  const [x, y, z] = [f("c", "a.ts", D564[0]), f("c", "b.ts", D564[1]), f("c", "c.ts", D564[2])];
  const r = detectStalledRounds([round([x, y, z]), round([x, y]), round([x])]);
  assert.equal(r.stalled, false);
  assert.equal(r.reason, "progressing");
});

test("detectStalledRounds: rising count with high overlap → stalled (getting worse counts too)", () => {
  const x = f("design-fit", PATCH_FILE, D564[0]);
  const r = detectStalledRounds([
    round([x]),
    round([x, f("design-fit", PATCH_FILE, D564[1])]),
    round([x, f("design-fit", PATCH_FILE, D564[2]), f("design-fit", PATCH_FILE, D564[3])]),
  ]);
  assert.equal(r.stalled, true);
});

test("detectStalledRounds: flat count but DISJOINT findings → not a stall", () => {
  const mk = (n) => [f("c", `${n}.ts`, `a completely distinct defect number ${n} in the parser`)];
  const r = detectStalledRounds([round(mk(1)), round(mk(2)), round(mk(3))]);
  assert.equal(r.stalled, false);
  assert.equal(r.reason, "progressing");
});

test("detectStalledRounds: a partial round breaks the trailing run (unreadable never pages)", () => {
  const fs = [f("design-fit", PATCH_FILE, D564[0])];
  assert.equal(detectStalledRounds([round(fs), round(fs, true), round(fs)]).stalled, false);
  // partial as the newest round also breaks it
  assert.equal(detectStalledRounds([round(fs), round(fs), round(fs, true)]).stalled, false);
});

test("detectStalledRounds: needs minRepeats+1 rounds; one stalling pair is not enough", () => {
  const fs = [f("design-fit", PATCH_FILE, D564[0])];
  assert.equal(detectStalledRounds([round(fs), round(fs)]).reason, "too-few-rounds");
  assert.equal(detectStalledRounds([round(fs)]).stalled, false);
  // 3 rounds where only the newest pair repeats → 1 stall, below the threshold
  const other = [f("c", "z.ts", "an entirely different problem in another module")];
  const r = detectStalledRounds([round(other), round(fs), round(fs)]);
  assert.equal(r.stalls, 1);
  assert.equal(r.stalled, false);
  assert.equal(r.reason, "partial-stall");
});

test("detectStalledRounds: junk input → false, never throws", () => {
  for (const junk of [null, undefined, [], "nope", [null, 3, "x"], [{}, {}, {}]]) {
    assert.doesNotThrow(() => detectStalledRounds(junk));
    assert.equal(detectStalledRounds(junk).stalled, false);
  }
  // findings not an array on every round → counts as 0, ratio 0 → no stall
  assert.equal(detectStalledRounds([{ findings: "x" }, { findings: "x" }, { findings: "x" }]).stalled, false);
});

test("detectStalledRounds: two clean rounds never stall (empty curr → ratio 0)", () => {
  assert.equal(detectStalledRounds([round([]), round([]), round([])]).stalled, false);
});

// --- groupReviewRounds -------------------------------------------------------

const NAMES = ["agent-review-correctness", "agent-review-design-fit"];
const run = (name, findings, over = {}) => ({
  name, app: { slug: "github-actions" }, conclusion: "failure",
  completed_at: "2026-07-27T06:00:00Z",
  output: { summary: "s", text: JSON.stringify(findings) }, ...over,
});
const commit = (sha, checkRuns) => ({ sha, parents: [{ sha: "p" }], checkRuns });

test("groupReviewRounds: commit order preserved; non-panel commits are not rounds", () => {
  const one = [{ severity: "major", file: "a.ts", summary: "x" }];
  const rounds = groupReviewRounds(
    [commit("c1", [run("agent-review-correctness", one)]), commit("c2", []), commit("c3", [run("agent-review-correctness", one)])],
    NAMES,
  );
  assert.deepEqual(rounds.map((r) => r.sha), ["c1", "c3"]);
  assert.equal(rounds[0].findings[0].lens, "correctness"); // prefix stripped
});

test("groupReviewRounds: unreadable payloads mark the round partial, not clean", () => {
  const bad = (over) => groupReviewRounds([commit("c1", [{ name: "agent-review-correctness", app: { slug: "github-actions" }, ...over }])], NAMES)[0];
  assert.equal(bad({ output: { text: "not json" } }).partial, true);
  assert.equal(bad({ output: { text: '{"not":"an array"}' } }).partial, true);
  assert.equal(bad({ output: {} }).partial, true); // ABSENT text ≠ "found nothing"
  assert.equal(bad({ output: { text: "[]" } }).partial, false); // "[]" IS a clean verdict
  assert.deepEqual(bad({ output: { text: "[]" } }).findings, []);
});

test("groupReviewRounds: infra/quota findings mark the round partial (not a repeat)", () => {
  const infra = [{ severity: "major", summary: "Review could not run — Claude API/quota error (429): limit" }];
  const r = groupReviewRounds([commit("c1", [run("agent-review-correctness", infra)])], NAMES)[0];
  assert.equal(r.partial, true);
  assert.equal(r.findings.length, 0);
  const noVerdict = [{ severity: "major", summary: "Reviewer did not produce a valid verdict: boom" }];
  assert.equal(groupReviewRounds([commit("c1", [run("agent-review-correctness", noVerdict)])], NAMES)[0].partial, true);
});

test("groupReviewRounds: other-app check ignored; newest run per lens wins", () => {
  const one = [{ severity: "major", file: "a.ts", summary: "x" }];
  const foreign = { name: "agent-review-correctness", app: { slug: "some-other-app" }, output: { text: JSON.stringify(one) } };
  assert.deepEqual(groupReviewRounds([commit("c1", [foreign])], NAMES), []);
  // two runs of one lens on one commit → the later completed_at wins
  const older = run("agent-review-correctness", [{ severity: "major", file: "a.ts", summary: "OLD" }], { completed_at: "2026-07-27T05:00:00Z" });
  const newer = run("agent-review-correctness", [{ severity: "major", file: "a.ts", summary: "NEW" }], { completed_at: "2026-07-27T07:00:00Z" });
  assert.deepEqual(groupReviewRounds([commit("c1", [older, newer])], NAMES)[0].findings.map((x) => x.summary), ["NEW"]);
});
