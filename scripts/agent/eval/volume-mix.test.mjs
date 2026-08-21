// What these tests are FOR, since a scorer's tests are easy to write and hard to
// make load-bearing: every number this module emits could be wrong by a plausible
// amount and nothing would go red. So the assertions concentrate on the four
// places a wrong number comes from — a pooled subset, an absent value read as a
// zero, a vocabulary that drifted out from under a guard, and a denominator that
// silently changed — rather than on arithmetic.
//
// Two fixtures are REAL, taken from the pilot run of 2026-08-10 (`pilot-01__k1`,
// corpus `2026-08-10-pilot-reviewed`), because the interesting behaviour is not
// reproducible by invention: pr-524's frozen diff touches 22 lines in two long
// workflow files and six of the panel's nine findings cite lines outside every
// hunk. That is the scope-discipline signal, and a hand-made diff would not have
// produced it.
//
// Nothing here calls a model, needs an API key or touches the network.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { EvalStore, contentSha256 } from "./store.mjs";
import { GATING_BASIS, buildFindingRecord } from "./finding-record.mjs";
import { parseCodeRabbitReview } from "../harvest.mjs";
import { runRecords } from "./adapters/panel.mjs";
import {
  ARM_RESTATEMENT_TIER,
  GATE_SEGMENTS,
  LOCALIZATION_BASIS,
  RESTATEMENT_BASIS,
  SCOPE_BASIS,
  assertComparableWindow,
  assertOnePopulation,
  assertOneRunPerItem,
  assertRunMatchesCorpus,
  distribution,
  gateSegmentOf,
  itemGeometry,
  localizationOf,
  median,
  pin,
  proportion,
  renderReport,
  restatementsOf,
  roundOf,
  scopeOf,
  scoreItem,
  scoreVolumeAndMix,
  severityIsStated,
  severityMix,
} from "./volume-mix.mjs";

// --- fixtures ---------------------------------------------------------------

/**
 * pr-524's frozen diff, verbatim from `corpus/items/pr-524/diff.patch` minus the
 * hunk bodies (only the headers decide a range). Post-image ranges: 152–163 in
 * `agent-iterate-ci.yml`; 405–416, 438–452 and 456–463 in `agent-review-panel.yml`.
 */
const PR524_DIFF = [
  "diff --git a/.github/workflows/agent-iterate-ci.yml b/.github/workflows/agent-iterate-ci.yml",
  "index e40ea9a58..06144baec 100644",
  "--- a/.github/workflows/agent-iterate-ci.yml",
  "+++ b/.github/workflows/agent-iterate-ci.yml",
  "@@ -152,6 +152,12 @@ jobs:",
  "         with:",
  "+          allowed_bots: \"yorkie-agent[bot],yorkie-agent\"",
  "           prompt: |",
  "diff --git a/.github/workflows/agent-review-panel.yml b/.github/workflows/agent-review-panel.yml",
  "index f89f59f7d..e11b3e2ef 100644",
  "--- a/.github/workflows/agent-review-panel.yml",
  "+++ b/.github/workflows/agent-review-panel.yml",
  "@@ -405,6 +405,12 @@ jobs:",
  "         with:",
  "+          allowed_bots: \"yorkie-agent[bot],yorkie-agent\"",
  "@@ -432,12 +438,15 @@ jobs:",
  "   #     set or another tooling error — reds the job with no comment/label), and",
  "@@ -447,7 +456,8 @@ jobs:",
  "-       needs.promote.result == 'failure')",
  "+       needs.fix.result == 'failure')",
].join("\n");

const PR524_META = { id: "pr-524", additions: 19, deletions: 3 };
const PR524_GEO = itemGeometry("pr-524", { meta: PR524_META, diff: PR524_DIFF });

const CI = ".github/workflows/agent-iterate-ci.yml";
const PANEL_YML = ".github/workflows/agent-review-panel.yml";

/**
 * Four of pr-524's nine real panel findings — the ones the novelty gate annotated,
 * so each carries the ORIGIN git computed independently of this module. Two
 * `introduced` at lines the diff added, two `pre-existing` at line 93. They are
 * what pins the scope rule against a second opinion.
 */
const PR524_ANNOTATED = [
  { severity: "major", file: PANEL_YML, line: 413, summary: "bot allow-list hardcodes the login", lane: "blocking", lens: "correctness", novelty: { origin: "introduced" } },
  { severity: "major", file: CI, line: 160, summary: "allowed_bots may not be a supported input", lane: "blocking", lens: "correctness", novelty: { origin: "introduced" } },
  { severity: "major", file: CI, line: 93, summary: "app token minted with no permission scoping", lane: "blocking", lens: "security", novelty: { origin: "pre-existing" } },
  { severity: "major", file: CI, line: 93, summary: "mutable v1 tag for the action consuming the key", lane: "blocking", lens: "security", novelty: { origin: "pre-existing" } },
];

const panelRecord = (finding, over = {}) =>
  buildFindingRecord({
    arm: "panel",
    itemId: over.itemId ?? "pr-524",
    runId: over.runId ?? "pilot-01__k1",
    population: over.population ?? "reported",
    finding,
    detail: { lens: finding.lens ?? null, lane: finding.lane ?? null, novelty: finding.novelty ?? null, gate_state: "gate_state" in over ? over.gate_state : "on", item_status: over.item_status ?? "ok", ...over.detail },
  });

const crRecord = (over = {}) =>
  buildFindingRecord({
    arm: "coderabbit",
    itemId: over.itemId ?? "pr-524",
    runId: null,
    population: "reported",
    finding: { severity: over.severity ?? "minor", file: over.file ?? CI, line: over.line ?? 155, summary: over.summary ?? "a finding" },
    detail: {
      source: "review-body",
      tier: over.tier ?? "",
      review_id: "review_id" in over ? over.review_id : "1",
      posted_at: over.posted_at ?? "2026-07-22T10:17:23Z",
      window: over.window ?? "in-window",
      window_basis: "commit-at-or-before-review",
      severity_basis: over.severity_basis ?? "header-field",
      stated_severity: over.stated_severity ?? "🟡 Minor",
    },
  });

// --- the vocabulary pins ----------------------------------------------------

test("pin refuses a literal that has left the vocabulary owning it", () => {
  assert.equal(pin("in-window", ["in-window", "after-window"], "x"), "in-window");
  // The failure it prevents: a rename upstream leaves the guard running and never
  // firing, which is lesson 7 with a string instead of a field.
  assert.throws(() => pin("after-window", ["in-window"], "the after-window marker"), /no longer in the vocabulary that owns it/);
  // Objects are checked by KEY, which is how the GATING_BASIS pin works.
  assert.equal(pin("no-gate-in-arm", GATING_BASIS, "x"), "no-gate-in-arm");
  assert.throws(() => pin("lane-nonsense", GATING_BASIS, "x"), /no longer in the vocabulary/);
});

test("the no-gate segment key is GATING_BASIS's own, and it means not-applicable", () => {
  // If these drift apart, CodeRabbit records would be filed under a segment name
  // no other module uses, and a reader joining the two outputs would see two arms
  // where there is one.
  assert.equal(Object.hasOwn(GATING_BASIS, GATE_SEGMENTS.noGateInArm), true);
  assert.equal(GATING_BASIS[GATE_SEGMENTS.noGateInArm], "not-applicable");
  assert.notEqual(GATE_SEGMENTS.unrecorded, GATE_SEGMENTS.noGateInArm);
});

test("the duplicate tier is the string harvest.mjs actually returns", () => {
  // Pinned against the parser's own output rather than against this file's
  // expectation, the way `codeRabbitItemId` is pinned against `buildItemMeta`.
  // `CR_TIERS` is private, so this constant is a re-typed vocabulary value and
  // this is what keeps it from drifting in silence.
  const body = [
    "<details>",
    "<summary>♻️ Duplicate comments (1)</summary><blockquote>",
    "",
    "<details>",
    "<summary>a.ts (1)</summary><blockquote>",
    "",
    "`268-269`: _⚠️ Potential issue_ | _🟡 Minor_",
    "",
    "**The signature still shows the old type.**",
    "",
    "This was flagged in a previous review.",
    "",
    "</blockquote></details>",
    "",
    "</blockquote></details>",
  ].join("\n");
  const { findings } = parseCodeRabbitReview(body);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].tier, ARM_RESTATEMENT_TIER.coderabbit);
});

// --- proportions and distributions -----------------------------------------

test("a proportion over nothing is null, never zero", () => {
  assert.deepEqual(proportion(0, 0), { k: 0, n: 0, ratio: null });
  assert.deepEqual(proportion(3, 4), { k: 3, n: 4, ratio: 0.75 });
  // The whole point: `0/0 → 0.000` reads as a measurement of a reviewer that
  // produced nothing, which is the shape every blank cell in this benchmark takes.
  assert.notEqual(proportion(0, 0).ratio, 0);
});

test("median and distribution over an empty, odd and even series", () => {
  assert.equal(median([]), null);
  assert.equal(median([5]), 5);
  assert.equal(median([1, 2, 3, 7]), 2.5);
  assert.equal(median([3, 1, 2]), 2);
  assert.deepEqual(distribution([]), { n: 0, min: null, median: null, max: null, mean: null });
  const d = distribution([1, 2, 9]);
  assert.deepEqual([d.n, d.min, d.median, d.max], [3, 1, 2, 9]);
  assert.equal(d.mean, 4);
});

// --- item geometry ----------------------------------------------------------

test("the frozen diff's post-image hunk ranges, from the real pr-524 diff", () => {
  assert.equal(PR524_GEO.diff_lines, 22);
  assert.deepEqual(PR524_GEO.files.get(CI).ranges, [[152, 163]]);
  assert.deepEqual(PR524_GEO.files.get(PANEL_YML).ranges, [[405, 416], [438, 452], [456, 463]]);
  assert.equal(PR524_GEO.files.get(CI).post_image, true);
});

test("a hunk with no post-image lines contributes no range, and a deleted file none at all", () => {
  const geo = itemGeometry("pr-x", {
    meta: { additions: 0, deletions: 4 },
    diff: [
      "diff --git a/kept.ts b/kept.ts",
      "--- a/kept.ts",
      "+++ b/kept.ts",
      "@@ -10,2 +9,0 @@",  // pure deletion: nothing exists at 9 in the post-image
      "-gone",
      "diff --git a/dropped.ts b/dropped.ts",
      "--- a/dropped.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-gone",
    ].join("\n"),
  });
  assert.deepEqual(geo.files.get("kept.ts"), { post_image: true, ranges: [] });
  // The deleted file is still PART of the item — a finding on it is not a finding
  // on an unknown path — but it has no post-image to be inside.
  assert.deepEqual(geo.files.get("dropped.ts"), { post_image: false, ranges: [] });
});

test("a single-line hunk header with no count is one line, not zero", () => {
  const geo = itemGeometry("pr-x", { meta: { additions: 1, deletions: 0 }, diff: ["diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts", "@@ -7 +7 @@", "+x"].join("\n") });
  assert.deepEqual(geo.files.get("a.ts").ranges, [[7, 7]]);
});

test("the hunk parse is refused when it disagrees with changedFilesFromDiff", () => {
  // A prefix-less diff (`--no-prefix`) is the reachable form: this parser would
  // register `foo.ts` and the owner's rule registers nothing, so the file set the
  // ranges are keyed by would not be the item's file set. Refusing leaves the item
  // unscored; the alternative silently moves findings from in-diff to outside-diff.
  assert.throws(
    () => itemGeometry("pr-x", { meta: { additions: 1, deletions: 0 }, diff: ["diff --git foo.ts foo.ts", "--- foo.ts", "+++ foo.ts", "@@ -1 +1 @@", "+x"].join("\n") }),
    /disagree about which files the frozen diff touches/,
  );
  // The C-quoted path, which `changedFilesFromDiff` unquotes and this parser
  // cannot (the helpers are private). Documented as a refusal rather than a wrong
  // score, and pinned so it stays deliberate.
  assert.throws(
    () => itemGeometry("pr-x", { meta: { additions: 1, deletions: 0 }, diff: ['diff --git "a/na\\303\\257ve.ts" "b/na\\303\\257ve.ts"', '--- "a/na\\303\\257ve.ts"', '+++ "b/na\\303\\257ve.ts"', "@@ -1 +1 @@", "+x"].join("\n") }),
    /disagree about which files the frozen diff touches/,
  );
});

test("an item whose meta carries no size has null diff lines, not zero", () => {
  const geo = itemGeometry("pr-x", { meta: {}, diff: "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n+x" });
  assert.equal(geo.diff_lines, null);
  // …and the density is then null rather than a division by zero.
  assert.equal(scoreItem({ arm: "panel", item_id: "pr-x", records: [], geometry: geo, item_status: "ok" }).per_100_diff_lines, null);
});

// --- localisation -----------------------------------------------------------

test("localisation: every basis, and the ordering that puts certainty first", () => {
  const at = (file, line) => localizationOf({ file, line }, PR524_GEO);
  assert.equal(at(CI, 160).localization_basis, "file-and-line-in-item");
  assert.equal(at(CI, 160).localization, "resolved");
  assert.equal(at(null, 160).localization_basis, "no-file");
  assert.equal(at(CI, null).localization_basis, "no-line");
  // Not checkable from a corpus item, which holds the diff and not the tree — so
  // `unresolvable`, never `unresolved`. Filing it as unresolved would report our
  // inability to look as the reviewer's failure to cite.
  assert.equal(at("packages/sheets/src/index.ts", 40).localization_basis, "file-not-in-item");
  assert.equal(at("packages/sheets/src/index.ts", 40).localization, "unresolvable");
  // A record with BOTH problems is filed under the one that is a fact.
  assert.equal(at("packages/sheets/src/index.ts", null).localization_basis, "no-line");
  assert.equal(localizationOf({ file: CI, line: 160 }, null).localization_basis, "item-unavailable");
  // A `./`-prefixed citation is the same file.
  assert.equal(at(`./${CI}`, 160).localization, "resolved");
  // Line 0 and a negative line are not lines.
  assert.equal(at(CI, 0).localization_basis, "no-line");
});

// --- scope discipline -------------------------------------------------------

test("scope: the real pr-524 findings, and the novelty gate agrees on all four", () => {
  for (const f of PR524_ANNOTATED) {
    const r = panelRecord(f);
    const { scope } = scopeOf(r, PR524_GEO);
    // git's own answer, computed by `novelty.mjs` during the replay and carried on
    // the record. This is the second opinion: `introduced` means the review commit
    // added the line, which is exactly "inside the diff".
    const expected = f.novelty.origin === "introduced" ? "in-diff" : "outside-diff";
    assert.equal(scope, expected, `${f.file}:${f.line} (${f.novelty.origin})`);
  }
});

test("scope: every basis, including the two that differ from localisation", () => {
  const at = (file, line) => scopeOf({ file, line }, PR524_GEO);
  assert.equal(at(PANEL_YML, 460).scope_basis, "line-in-hunk");
  assert.equal(at(PANEL_YML, 479).scope_basis, "line-outside-hunks");
  assert.equal(at(PANEL_YML, 479).scope, "outside-diff");
  assert.equal(at(null, 12).scope_basis, "no-file");
  assert.equal(at(PANEL_YML, null).scope_basis, "no-line");
  assert.equal(at(PANEL_YML, null).scope, "unknown");
  // THE DELIBERATE ASYMMETRY: the same record reads `outside-diff` for scope and
  // `unresolvable` for localisation. A path the diff does not touch is certainly
  // not inside the diff, whether or not it exists — but whether the citation
  // resolves needs the tree.
  assert.equal(at("packages/sheets/src/index.ts", 40).scope, "outside-diff");
  assert.equal(localizationOf({ file: "packages/sheets/src/index.ts", line: 40 }, PR524_GEO).localization, "unresolvable");
  assert.equal(scopeOf({ file: CI, line: 12 }, null).scope_basis, "item-unavailable");
});

test("scope: a citation on a file the diff deletes is unknown, not outside", () => {
  const geo = itemGeometry("pr-x", { meta: { additions: 0, deletions: 2 }, diff: ["diff --git a/dropped.ts b/dropped.ts", "--- a/dropped.ts", "+++ /dev/null", "@@ -1,2 +0,0 @@", "-gone"].join("\n") });
  // The file has no post-image, so the cited line must be about the pre-image —
  // a side of a boundary this rule does not draw. Reading it as `outside-diff`
  // would count a finding about deleted code as a scope-discipline failure.
  assert.equal(scopeOf({ file: "dropped.ts", line: 1 }, geo).scope_basis, "file-has-no-post-image");
  assert.equal(scopeOf({ file: "dropped.ts", line: 1 }, geo).scope, "unknown");
});

test("scope: a CONTEXT line inside a hunk is in-diff, and that is the metric's meaning", () => {
  // `in-diff` means "in a changed REGION", not "on a changed LINE". A hunk's
  // post-image range includes the context lines git prints around the change, and
  // a reviewer was shown those lines — CodeRabbit can post an inline comment on
  // one, so a rule counting only `+` lines would score the two arms differently
  // for a reason that is about diff formatting.
  //
  // The cost is measurable and it is the right cost. Across the 7-item pilot, 36
  // of our arm's 142 findings carry the novelty origin git computed during the
  // replay; 33 of the 35 comparable pairs agree with this rule, and BOTH
  // disagreements are findings anchored on a context line inside a hunk —
  // `pre-existing` to git, `in-diff` here. Neither answer is wrong; they are
  // answers to different questions, and "which line did this change introduce?"
  // is what `novelty.mjs` is for.
  const geo = itemGeometry("pr-x", {
    meta: { additions: 1, deletions: 0 },
    diff: ["diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts", "@@ -10,2 +10,3 @@", " untouched context", "+added", " more context"].join("\n"),
  });
  assert.deepEqual(geo.files.get("a.ts").ranges, [[10, 12]]);
  assert.equal(scopeOf({ file: "a.ts", line: 10 }, geo).scope, "in-diff", "leading context line");
  assert.equal(scopeOf({ file: "a.ts", line: 11 }, geo).scope, "in-diff", "the added line");
  assert.equal(scopeOf({ file: "a.ts", line: 12 }, geo).scope, "in-diff", "trailing context line");
  assert.equal(scopeOf({ file: "a.ts", line: 13 }, geo).scope, "outside-diff");
});

test("scope: both ENDS of a hunk are inside it", () => {
  // Added after a surviving mutation: `line <= end` → `line < end` changed the
  // answer for a citation on a hunk's last line and no test noticed. An off-by-one
  // at a hunk boundary is the shape of error that shifts a scope rate by a few
  // percent and looks like a finding about the reviewer.
  const at = (line) => scopeOf({ file: CI, line }, PR524_GEO).scope_basis;
  assert.equal(at(152), "line-in-hunk", "first line of the hunk");
  assert.equal(at(163), "line-in-hunk", "last line of the hunk");
  assert.equal(at(151), "line-outside-hunks");
  assert.equal(at(164), "line-outside-hunks");
  // The same at both ends of a one-line hunk, where the two bounds coincide.
  const one = itemGeometry("pr-x", { meta: { additions: 1, deletions: 0 }, diff: ["diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts", "@@ -7 +7 @@", "+x"].join("\n") });
  assert.equal(scopeOf({ file: "a.ts", line: 7 }, one).scope_basis, "line-in-hunk");
  assert.equal(scopeOf({ file: "a.ts", line: 8 }, one).scope_basis, "line-outside-hunks");
});

test("a rename-only file block is part of the item, and a zero-line diff has no density", () => {
  // Also added after a surviving mutation, and it found a defect rather than a
  // gap: a pure rename emits a `diff --git` header with `similarity index` and NO
  // `+++` line at all. `changedFilesFromDiff` counts that file off the header, so
  // registering files only on `+++` made the guard refuse the whole item — an
  // over-refusal on input `gh pr diff` really produces.
  const geo = itemGeometry("pr-y", {
    meta: { additions: 0, deletions: 0 },
    diff: ["diff --git a/old.ts b/new.ts", "similarity index 100%", "rename from old.ts", "rename to new.ts"].join("\n"),
  });
  assert.deepEqual([...geo.files.keys()], ["new.ts"]);
  assert.deepEqual(geo.files.get("new.ts"), { post_image: false, ranges: [] });
  // A rename-only diff changes no lines, so density has no denominator. Without
  // the guard this is `Infinity` for any non-zero finding count — a number that
  // sorts to the top of any "most findings per line" table.
  assert.equal(geo.diff_lines, 0);
  const it = scoreItem({ arm: "panel", item_id: "pr-y", records: [panelRecord({ severity: "minor", file: "new.ts", line: 3, summary: "x" }, { itemId: "pr-y" })], geometry: geo, item_status: "ok" });
  assert.equal(it.per_100_diff_lines, null);
  assert.equal(it.findings, 1);
  // The citation cannot be placed: the diff shows no post-image for the file.
  assert.equal(it.scope.basis["file-has-no-post-image"], 1);
});

// --- restatement ------------------------------------------------------------

test("a run is not a round: our arm reports not-applicable, never zero", () => {
  const records = PR524_ANNOTATED.map((f) => panelRecord(f));
  const rs = restatementsOf(records);
  for (const r of rs) {
    assert.equal(r.restatement_basis, "arm-records-no-rounds");
    assert.equal(r.restatement, "not-applicable");
  }
  assert.equal(roundOf(records[0]), null);
  // Two replicates of the same item are still not two rounds — the same finding
  // seen twice under different run ids is reliability, not restatement.
  const twice = [panelRecord(PR524_ANNOTATED[0]), panelRecord(PR524_ANNOTATED[0], { runId: "pilot-02__k1" })];
  assert.deepEqual(restatementsOf(twice).map((r) => r.restatement_basis), ["arm-records-no-rounds", "arm-records-no-rounds"]);
});

test("one round is not-applicable; a repeat in a later round is restated", () => {
  const single = [crRecord({ summary: "a" }), crRecord({ summary: "b" })];
  assert.deepEqual(restatementsOf(single).map((r) => r.restatement_basis), ["single-round", "single-round"]);

  const two = [
    crRecord({ summary: "a", review_id: "1", posted_at: "2026-07-01T00:00:00Z" }),
    crRecord({ summary: "b", review_id: "1", posted_at: "2026-07-01T00:00:00Z" }),
    crRecord({ summary: "a", review_id: "2", posted_at: "2026-07-09T00:00:00Z" }),
    crRecord({ summary: "c", review_id: "2", posted_at: "2026-07-09T00:00:00Z" }),
  ];
  assert.deepEqual(restatementsOf(two).map((r) => r.restatement_basis), ["first-statement", "first-statement", "repeats-earlier-round", "first-statement"]);
  assert.equal(restatementsOf(two)[2].restatement, "restated");
});

test("round order comes from posted_at, not from input order", () => {
  // The later review is listed FIRST. If the order came from the array, its
  // finding would be the original and the earlier review's the restatement —
  // which reverses the metric on any PR whose comments arrive out of order.
  const out = restatementsOf([
    crRecord({ summary: "a", review_id: "2", posted_at: "2026-07-09T00:00:00Z" }),
    crRecord({ summary: "a", review_id: "1", posted_at: "2026-07-01T00:00:00Z" }),
  ]);
  assert.deepEqual(out.map((r) => r.restatement_basis), ["repeats-earlier-round", "first-statement"]);
});

test("the arm's own duplicate label is kept apart from our observation, and beats single-round", () => {
  const [r] = restatementsOf([crRecord({ tier: ARM_RESTATEMENT_TIER.coderabbit })]);
  // One round on the item, so nothing could be observed as a repeat — but
  // CodeRabbit itself says this repeats an earlier comment, and filing that as
  // "not applicable" would discard the only signal available.
  assert.equal(r.restatement_basis, "arm-duplicate-tier");
  assert.equal(r.restatement, "restated-per-arm-label");
  // Never pooled with `restated`: one is our measurement, the other is their claim.
  assert.notEqual(r.restatement, "restated");
  // And our observation wins when both apply.
  const both = restatementsOf([
    crRecord({ summary: "a", review_id: "1", posted_at: "2026-07-01T00:00:00Z" }),
    crRecord({ summary: "a", review_id: "2", posted_at: "2026-07-09T00:00:00Z", tier: ARM_RESTATEMENT_TIER.coderabbit }),
  ]);
  assert.equal(both[1].restatement_basis, "repeats-earlier-round");
});

test("a record with no round id, on an item that has several, is unknown", () => {
  const out = restatementsOf([
    crRecord({ summary: "a", review_id: "1", posted_at: "2026-07-01T00:00:00Z" }),
    crRecord({ summary: "b", review_id: "2", posted_at: "2026-07-09T00:00:00Z" }),
    crRecord({ summary: "c", review_id: null }),
  ]);
  assert.equal(out[2].restatement_basis, "round-unrecorded");
  assert.equal(out[2].restatement, "unknown");
});

test("every declared basis maps to a declared answer, in all three vocabularies", () => {
  // The `gating`/`gating_basis` construction: one fact stated twice must never be
  // statable independently. This is what stops a future edit adding a basis whose
  // answer is a typo.
  for (const map of [LOCALIZATION_BASIS, SCOPE_BASIS, RESTATEMENT_BASIS]) {
    for (const [basis, answer] of Object.entries(map)) assert.equal(typeof answer, "string", basis);
  }
  assert.deepEqual([...new Set(Object.values(LOCALIZATION_BASIS))].sort(), ["resolved", "unresolvable", "unresolved"]);
  assert.deepEqual([...new Set(Object.values(SCOPE_BASIS))].sort(), ["in-diff", "outside-diff", "unknown"]);
  assert.deepEqual([...new Set(Object.values(RESTATEMENT_BASIS))].sort(), ["not-applicable", "not-restated", "restated", "restated-per-arm-label", "unknown"]);
});

// --- severity mix -----------------------------------------------------------

test("a stated severity and a floor are never pooled", () => {
  const records = [
    crRecord({ severity: "nit", severity_basis: "unstated", stated_severity: "" }),
    crRecord({ severity: "nit", severity_basis: "header-field" }),
    crRecord({ severity: "major", severity_basis: "tier-heading" }),
  ];
  const mix = severityMix(records);
  assert.equal(mix.n, 3);
  assert.equal(mix.stated.n, 2);
  assert.equal(mix.unstated.n, 1);
  // The floor is `nit` for CodeRabbit, so pooling it would move the arm's nit
  // ratio from 1/2 to 2/3 on a value nobody stated.
  assert.equal(mix.stated.nit_ratio.ratio, 0.5);
  assert.equal(mix.stated.counts.nit, 1);
  assert.equal(mix.unstated.counts.nit, 1);
  // Empty blocks carry no share at all rather than a mix of zeros.
  assert.equal(severityMix([]).stated.share, null);
});

test("our arm has a floor too: an unrecognised severity is not a stated major", () => {
  // `normalizeSeverity` maps anything it does not know to `major`, which BLOCKS.
  // The only trace is `severity_raw`, so that is what decides `stated`.
  const weird = panelRecord({ severity: "moderate", file: CI, line: 155, summary: "odd severity" });
  assert.equal(weird.severity, "major");
  assert.equal(weird.severity_raw, "moderate");
  assert.equal(severityIsStated(weird), false);
  assert.equal(severityIsStated(panelRecord({ severity: "major", file: CI, line: 155, summary: "ok" })), true);
  const mix = severityMix([weird]);
  assert.equal(mix.stated.n, 0);
  assert.equal(mix.unstated.counts.major, 1);
  // …so the arm's stated mix reports nothing rather than one confident blocker.
  assert.equal(mix.stated.share, null);
});

test("a CodeRabbit record's severity_raw cannot detect its floor — the basis can", () => {
  // Both fields come from the ONE severity the adapter hands the builder, so they
  // are always equal on this arm and `severity_raw` is useless here. If this ever
  // stops being true the branch in `severityIsStated` needs revisiting.
  const floored = crRecord({ severity: "nit", severity_basis: "unstated", stated_severity: "" });
  assert.equal(floored.severity, floored.severity_raw);
  assert.equal(severityIsStated(floored), false);
});

// --- the item score ---------------------------------------------------------

test("the real pr-524 panel item: 9 findings, 3 in the diff, restatement not applicable", () => {
  // The nine findings the pilot actually produced, at the lines it cited.
  const nine = [
    { severity: "major", file: PANEL_YML, line: 413, summary: "a", lane: "blocking" },
    { severity: "major", file: CI, line: 160, summary: "b", lane: "blocking" },
    { severity: "minor", file: PANEL_YML, line: 479, summary: "c" },
    { severity: "minor", file: PANEL_YML, line: 460, summary: "d" },
    { severity: "minor", file: CI, line: 147, summary: "e" },
    { severity: "major", file: CI, line: 93, summary: "f", lane: "blocking" },
    { severity: "major", file: CI, line: 93, summary: "g", lane: "blocking" },
    { severity: "minor", file: CI, line: 328, summary: "h" },
    { severity: "minor", file: CI, line: 289, summary: "i" },
  ].map((f) => panelRecord(f));
  const it = scoreItem({ arm: "panel", item_id: "pr-524", records: nine, geometry: PR524_GEO, item_status: "ok" });
  assert.equal(it.findings, 9);
  assert.equal(it.diff_lines, 22);
  assert.equal(Number(it.per_100_diff_lines.toFixed(2)), 40.91);
  assert.deepEqual(it.severity.stated.counts, { critical: 0, major: 4, minor: 5, nit: 0 });
  assert.equal(it.severity.stated.nit_ratio.ratio, 5 / 9);
  assert.equal(it.localization.rate.ratio, 1);
  assert.deepEqual(it.scope.basis, { "line-in-hunk": 3, "line-outside-hunks": 6 });
  assert.equal(it.scope.rate.ratio, 3 / 9);
  // The number this whole vocabulary exists for: NOT 0.
  assert.equal(it.restatement.rate.ratio, null);
  assert.equal(it.restatement.rate.n, 0);
  assert.equal(it.restatement.counts["not-applicable"], 9);
  assert.equal(it.poolable, true);
  // Zero rows are printed rather than omitted, so "no unresolvable citations" and
  // "we never looked" are different lines.
  assert.equal(it.localization.counts.unresolvable, 0);
});

test("an item that is not status ok is excluded, and is not a zero", () => {
  const errored = scoreItem({ arm: "panel", item_id: "pr-605", records: [], geometry: PR524_GEO, item_status: "error", item_reason: "panel-timeout", population_state: "absent" });
  assert.equal(errored.poolable, false);
  assert.deepEqual(errored.exclusions, ["population-absent", "item-status-error"]);
  assert.equal(errored.item_reason, "panel-timeout");
  // A clean review IS a data point: present, zero records, poolable.
  const clean = scoreItem({ arm: "panel", item_id: "pr-605", records: [], geometry: PR524_GEO, item_status: "ok", population_state: "present" });
  assert.equal(clean.poolable, true);
  assert.equal(clean.findings, 0);
  assert.equal(clean.per_100_diff_lines, 0);
  // A panel item whose status nobody supplied fails toward exclusion: an `error`
  // item with zero findings is indistinguishable from a clean one at the record
  // level, so "unknown" must not be pooled as "ok".
  assert.equal(scoreItem({ arm: "panel", item_id: "pr-605", records: [], geometry: PR524_GEO }).exclusions.includes("item-status-unknown"), true);
});

// --- the guards -------------------------------------------------------------

test("mixing the two populations is refused", () => {
  const reported = panelRecord(PR524_ANNOTATED[0]);
  const sampled = panelRecord(PR524_ANNOTATED[1], { population: "sampled" });
  assert.equal(assertOnePopulation([reported, reported]), "reported");
  assert.equal(assertOnePopulation([]), null);
  assert.throws(() => assertOnePopulation([reported, sampled]), /span 2 populations/);
  assert.throws(() => scoreVolumeAndMix({ reads: [{ arm: "panel", item_id: "pr-524", records: [reported, sampled] }] }), /span 2 populations/);
});

test("an after-window record is refused, and unplaceable is scored and counted", () => {
  assert.throws(() => assertComparableWindow([crRecord({ window: "after-window" })]), /about code our arm never reviewed/);
  // The pilot's three real unplaceable findings — pr-415's, whose review commit a
  // force-push removed — are SCORED. Dropping them would delete an item.
  const unplaceable = [crRecord({ itemId: "pr-415", window: "unplaceable", summary: "x" })];
  assert.doesNotThrow(() => assertComparableWindow(unplaceable));
  const it = scoreItem({ arm: "coderabbit", item_id: "pr-415", records: unplaceable, geometry: PR524_GEO, item_status: "ok" });
  assert.equal(it.findings, 1);
  assert.deepEqual(it.window, { unplaceable: 1 });
  assert.doesNotThrow(() => assertComparableWindow([crRecord({ window: "no-window" })]));
});

test("two replicates of one item are refused rather than aggregated", () => {
  const a = panelRecord(PR524_ANNOTATED[0], { runId: "pilot-01__k1" });
  const b = panelRecord(PR524_ANNOTATED[1], { runId: "pilot-02__k1" });
  assert.doesNotThrow(() => assertOneRunPerItem([a, a]));
  assert.throws(() => assertOneRunPerItem([a, b]), /does not aggregate across replicates/);
  // The other arm has no replicates, so two records with `run_id: null` are fine.
  assert.doesNotThrow(() => assertOneRunPerItem([crRecord({ summary: "a" }), crRecord({ summary: "b" })]));
});

test("a run of a different corpus version is refused", () => {
  assert.throws(() => assertRunMatchesCorpus({ run_id: "2026-07-28T00-00-00-000Z__baseline-opus-s2", corpus_version: "fork-era" }, "2026-08-10-pilot-reviewed"), /not "2026-08-10-pilot-reviewed"/);
  assert.doesNotThrow(() => assertRunMatchesCorpus({ run_id: "pilot-01__k1", corpus_version: "2026-08-10-pilot-reviewed" }, "2026-08-10-pilot-reviewed"));
  // No run to check (the CodeRabbit arm alone) is not an error.
  assert.doesNotThrow(() => assertRunMatchesCorpus(null, "2026-08-10-pilot-reviewed"));
});

// --- gate segmentation ------------------------------------------------------

test("a gate-off run and a gate-on run never pool", () => {
  const on = panelRecord(PR524_ANNOTATED[0], { gate_state: "on" });
  const off = panelRecord(PR524_ANNOTATED[1], { gate_state: "off-no-base-sha" });
  assert.equal(gateSegmentOf(on), "on");
  assert.equal(gateSegmentOf(off), "off-no-base-sha");
  const result = scoreVolumeAndMix({
    reads: [{ arm: "panel", item_id: "pr-524", records: [on, off], population_state: "present", item_status: "ok" }],
    geometry: new Map([["pr-524", PR524_GEO]]),
    corpusItemIds: ["pr-524"],
  });
  // TWO segments, each with its own n. A single segment of 2 would report a
  // blocking population that is a property of the harness, not of the reviewer.
  assert.equal(result.segments.length, 2);
  assert.deepEqual(result.segments.map((s) => s.gate_state).sort(), ["off-no-base-sha", "on"]);
  for (const s of result.segments) assert.equal(s.summary.findings, 1);
  // And nothing anywhere adds them up.
  assert.equal(result.segments.some((s) => s.summary.findings === 2), false);
});

test("an envelope with no recorded gate state is its own segment, not pooled with a known one", () => {
  const known = panelRecord(PR524_ANNOTATED[0], { gate_state: "on" });
  const unrecorded = panelRecord(PR524_ANNOTATED[1], { gate_state: null });
  assert.equal(gateSegmentOf(unrecorded), GATE_SEGMENTS.unrecorded);
  const result = scoreVolumeAndMix({ reads: [{ arm: "panel", item_id: "pr-524", records: [known, unrecorded], item_status: "ok" }], geometry: new Map([["pr-524", PR524_GEO]]), corpusItemIds: ["pr-524"] });
  assert.equal(result.segments.length, 2);
  // The other arm has no gate AT ALL, which is a different absence.
  assert.equal(gateSegmentOf(crRecord()), GATE_SEGMENTS.noGateInArm);
});

// --- completeness -----------------------------------------------------------

test("coverage is per arm: one arm short makes the whole result partial", () => {
  // THE BUG THIS PINS: a pooled item-id union reported the real pilot as
  // COMPLETE, because CodeRabbit covers all seven items and our arm covers one.
  // A comparison is only as complete as its thinnest arm.
  const result = scoreVolumeAndMix({
    reads: [
      { arm: "panel", item_id: "pr-524", records: [panelRecord(PR524_ANNOTATED[0])], population_state: "present", item_status: "ok" },
      { arm: "coderabbit", item_id: "pr-524", records: [crRecord()], population_state: "present", item_status: "ok" },
      { arm: "coderabbit", item_id: "pr-605", records: [crRecord({ itemId: "pr-605" })], population_state: "present", item_status: "ok" },
    ],
    geometry: new Map([["pr-524", PR524_GEO], ["pr-605", PR524_GEO]]),
    corpusVersion: "2026-08-10-pilot-reviewed",
    corpusItemIds: ["pr-524", "pr-605"],
  });
  assert.equal(result.completeness.verdict, "partial");
  assert.deepEqual(result.completeness.items_comparable, ["pr-524"]);
  const panel = result.completeness.by_arm.find((a) => a.arm === "panel");
  assert.deepEqual(panel.items_not_read, ["pr-605"]);
  assert.equal(panel.items_scored, 1);
  assert.ok(result.completeness.reasons.some((r) => /panel: 1 corpus item\(s\) never read/.test(r)));
  // The report leads with what the comparison rests on.
  assert.ok(renderReport(result)[1].includes("1 of 2 corpus item(s) scored on EVERY arm: pr-524"));
});

test("a capped or partial run is labelled, never silently scored", () => {
  const reads = [{ arm: "panel", item_id: "pr-524", records: [panelRecord(PR524_ANNOTATED[0])], population_state: "present", item_status: "ok" }];
  const geometry = new Map([["pr-524", PR524_GEO]]);
  const capped = scoreVolumeAndMix({ reads, geometry, corpusItemIds: ["pr-524"], corpusVersion: "v", run: { run_id: "r", corpus_version: "v", status: "capped", item_count: 7, items_ok: 1, notes: "stopped at the cost cap before pr-605" } });
  assert.equal(capped.completeness.verdict, "partial");
  assert.ok(capped.completeness.reasons.some((r) => r === "run status capped"));
  assert.equal(capped.completeness.run.notes, "stopped at the cost cap before pr-605");
  // The same reads under a complete run over the whole corpus are complete.
  const whole = scoreVolumeAndMix({ reads, geometry, corpusItemIds: ["pr-524"], corpusVersion: "v", run: { run_id: "r", corpus_version: "v", status: "complete", item_count: 1, items_ok: 1 } });
  assert.equal(whole.completeness.verdict, "complete");
  assert.deepEqual(whole.completeness.reasons, []);
  // An empty corpus is never "complete": there is nothing to have covered.
  assert.equal(scoreVolumeAndMix({ reads: [], geometry, corpusItemIds: [] }).completeness.verdict, "partial");
});

test("a localisation rate never travels without its unresolvable count", () => {
  // Added after the full 7-item pilot landed: 27 of our arm's 142 findings cite a
  // real repository path the frozen diff does not touch, which drops the rate to
  // 0.796 beside the other arm's 1.000. Those 27 are citations this store CANNOT
  // CHECK, not failures to cite, and a pooled rate printed alone invites exactly
  // the wrong reading.
  const outside = panelRecord({ severity: "minor", file: "packages/sheets/src/view/worksheet.ts", line: 40, summary: "elsewhere" });
  const inside = panelRecord({ severity: "minor", file: CI, line: 160, summary: "here" });
  const result = scoreVolumeAndMix({
    reads: [{ arm: "panel", item_id: "pr-524", records: [inside, outside], population_state: "present", item_status: "ok" }],
    geometry: new Map([["pr-524", PR524_GEO]]),
    corpusItemIds: ["pr-524"],
  });
  const s = result.segments[0].summary;
  assert.equal(s.localization.ratio, 0.5);
  assert.deepEqual(s.localization_counts, { resolved: 1, unresolved: 0, unresolvable: 1 });
  const text = renderReport(result).join("\n");
  assert.match(text, /localised 1\/2=0\.500 \(1 unresolvable/);
  // The per-item line names the cause too, not just the answer.
  assert.match(text, /localisation basis .*file-not-in-item=1/);
  // Same record, two metrics, two sound answers — the scope column calls it
  // outside-diff, which is certain, while localisation calls it unresolvable.
  assert.equal(s.scope.ratio, 0.5);
});

test("every per-item figure names the replicate that produced it", () => {
  // Measured across the pilot's three completed replicates: per-item volume moves
  // +13% to +67% between runs of the SAME reviewer on the SAME item — pr-549 is
  // 12 · 20 · 16 — while the arm total moves 5.8% (142 · 147 · 139). So a per-item
  // count is ONE DRAW, not a property of the item, and a report that does not name
  // its run id invites a reader to treat it as the latter.
  const result = scoreVolumeAndMix({
    reads: [{ arm: "panel", item_id: "pr-524", records: [panelRecord(PR524_ANNOTATED[0], { runId: "pilot-01__k2" })], population_state: "present", item_status: "ok" }],
    geometry: new Map([["pr-524", PR524_GEO]]),
    corpusItemIds: ["pr-524"],
  });
  assert.equal(result.segments[0].items[0].run_id, "pilot-01__k2");
  const text = renderReport(result).join("\n");
  assert.match(text, /panel \[gate on\] · run pilot-01__k2/);
  assert.match(text, /pr-524@pilot-01__k2: 1 finding\(s\)/);
});

test("critical is a live severity bucket, not a structurally empty one", () => {
  // Replicate 1 of the pilot produced 0 criticals across 142 findings, replicate 2
  // produced 3 and replicate 3 produced 1 — from the same reviewer on the same
  // corpus. So `critical` must never be treated as absent, and no test here may
  // encode that it is.
  const crit = panelRecord({ severity: "critical", file: CI, line: 160, summary: "a real blocker", lane: "blocking" });
  const mix = severityMix([crit, panelRecord({ severity: "nit", file: CI, line: 161, summary: "a nit" })]);
  assert.equal(mix.stated.counts.critical, 1);
  assert.equal(mix.stated.share.critical, 0.5);
  // …and it is NOT a nit: the nit ratio is `nit` + `minor` only, so a critical
  // must not leak into it.
  assert.equal(mix.stated.nit_ratio.k, 1);
  const it = scoreItem({ arm: "panel", item_id: "pr-524", records: [crit], geometry: PR524_GEO, item_status: "ok" });
  assert.equal(it.severity.stated.counts.critical, 1);
  assert.match(renderReport(scoreVolumeAndMix({
    reads: [{ arm: "panel", item_id: "pr-524", records: [crit], population_state: "present", item_status: "ok" }],
    geometry: new Map([["pr-524", PR524_GEO]]),
    corpusItemIds: ["pr-524"],
  })).join("\n"), /severity critical=1/);
});

test("the window census is printed, not merely computed", () => {
  // It moves under this module: the arm-boundary fix for a finding sitting exactly
  // on the frozen review commit turns pr-415's three `unplaceable` records into
  // `in-window`, and NO metric here changes. A scorer that silently accepts either
  // census is the failure this project keeps repeating, so the distribution is on
  // the page even though only `after-window` is refused.
  const result = scoreVolumeAndMix({
    reads: [{ arm: "coderabbit", item_id: "pr-415", records: [crRecord({ itemId: "pr-415", window: "unplaceable" }), crRecord({ itemId: "pr-415", window: "in-window", summary: "b" })], population_state: "present", item_status: "ok" }],
    geometry: new Map([["pr-415", PR524_GEO]]),
    corpusItemIds: ["pr-415"],
  });
  assert.match(renderReport(result).join("\n"), /window unplaceable=1 in-window=1/);
  // Our arm has no window field, so its rows carry no window line rather than a
  // defaulted one.
  const ours = scoreVolumeAndMix({
    reads: [{ arm: "panel", item_id: "pr-524", records: [panelRecord(PR524_ANNOTATED[0])], population_state: "present", item_status: "ok" }],
    geometry: new Map([["pr-524", PR524_GEO]]),
    corpusItemIds: ["pr-524"],
  });
  assert.doesNotMatch(renderReport(ours).join("\n"), /window /);
});

test("the report prints n/a rather than a number for a rate over nothing", () => {
  const result = scoreVolumeAndMix({
    reads: [{ arm: "panel", item_id: "pr-524", records: [panelRecord(PR524_ANNOTATED[0])], population_state: "present", item_status: "ok" }],
    geometry: new Map([["pr-524", PR524_GEO]]),
    corpusItemIds: ["pr-524"],
  });
  const text = renderReport(result).join("\n");
  assert.match(text, /restated n\/a \(n=0\)/);
  assert.match(text, /restatement basis arm-records-no-rounds=1/);
  // No formatted zero anywhere for the restatement rate.
  assert.doesNotMatch(text, /restated 0\/0=0\.000/);
});

// --- end to end through a real store ---------------------------------------

test("end to end: a stored run reads back through the panel adapter and scores", () => {
  const root = mkdtempSync(path.join(tmpdir(), "eval-volume-mix-test-"));
  try {
    const store = new EvalStore(root);
    const runId = "2026-08-10T00-00-00-000Z__pilot";
    const meta = {
      id: "pr-524",
      source_pr: 524,
      review_commit: "4".repeat(40),
      review_base: "0".repeat(40),
      review_point: "pinned",
      diff_method: "gh-pr-diff",
      changed_files: [CI, PANEL_YML],
      additions: 19,
      deletions: 3,
      // The store RECOMPUTES this and refuses a mismatch, so the fixture cannot
      // fake it — which is the point: the item under test is a real stored item.
      sha256_diff: contentSha256(PR524_DIFF),
    };
    store.putCorpusItem("pr-524", { meta, diff: PR524_DIFF, changedFiles: [CI, PANEL_YML], issueSpec: null });
    store.putCorpusManifest("test-corpus", { corpus_version: "test-corpus", item_count: 1, items: [{ id: "pr-524", source_pr: 524, review_commit: meta.review_commit }] });
    const envelope = {
      run_id: runId,
      item_id: "pr-524",
      config_hash: "sha256:cafe",
      panel_sha: "0".repeat(39) + "1",
      panel_digest: `sha256:${"0".repeat(64)}`,
      corpus_version: "test-corpus",
      status: "ok",
      reason: null,
      transcript: { state: "absent" },
      gate: { state: "on", line: "novelty gate: on" },
      duration_ms: 575214,
      duration_source: "review-timing.json",
    };
    store.putRun(runId, { runJson: { run_id: runId, corpus_version: "test-corpus", status: "complete", item_count: 1, items_ok: 1, items_error: 0 } });
    store.putItem(runId, "pr-524", { envelope, payload: { adapter: "reviewer", findings: PR524_ANNOTATED, stageDetail: {} } });

    const input = store.getCorpusItemInput("pr-524");
    const geometry = new Map([["pr-524", itemGeometry("pr-524", input)]]);
    const reads = runRecords(store, runId).map((rd) => ({ arm: "panel", ...rd, item_status: store.getItem(runId, rd.item_id).envelope.status }));
    const result = scoreVolumeAndMix({ reads, geometry, run: store.getRun(runId).runJson, corpusVersion: "test-corpus", corpusItemIds: ["pr-524"] });

    assert.equal(result.completeness.verdict, "complete");
    assert.equal(result.segments.length, 1);
    const seg = result.segments[0];
    assert.equal(seg.gate_state, "on");
    assert.equal(seg.summary.findings, 4);
    assert.equal(seg.items[0].diff_lines, 22);
    // Two of the four annotated findings are inside the diff — the same answer the
    // novelty gate reached, derived here from the frozen diff alone.
    assert.equal(seg.items[0].scope.rate.k, 2);
    assert.equal(seg.items[0].scope.rate.n, 4);
    // The whole result survives JSON, which is what a report renderer is handed.
    const round = JSON.parse(JSON.stringify(result));
    assert.equal(round.segments[0].items[0].restatement.rate.ratio, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
