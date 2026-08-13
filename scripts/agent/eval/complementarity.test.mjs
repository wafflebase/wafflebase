// Fixtures only: no store, no network, no clock. `complementarityOf` takes
// records and returns counts, which is the whole reason it is separate from the
// CLI — a scorer that needed a store to be tested would be tested against one
// dataset and shipped against another.

import test from "node:test";
import assert from "node:assert/strict";
import { buildFindingRecord } from "./finding-record.mjs";
import { CLAIMS, TRIAGE_SCORE, VIEWS, complementarityOf, runIdsFrom, windowCensusOf, assertComparableWindow } from "./complementarity.mjs";
import { pairLabelKey } from "./pair-labels.mjs";

// --- fixtures ---------------------------------------------------------------
//
// Built through `buildFindingRecord` rather than hand-written, so a schema change
// breaks these tests instead of letting them pass over a shape nothing produces.

const panel = ({
  item = "pr-1",
  run = "run-1",
  lens = "correctness",
  file = "a.ts",
  summary,
  evidence = "",
  severity = "major",
  lane = "blocking",
  status = "ok",
} = {}) =>
  buildFindingRecord({
    arm: "panel",
    itemId: item,
    runId: run,
    population: "reported",
    finding: { lens, file, summary, evidence, severity, lane },
    detail: {
      lens,
      lane,
      novelty: null,
      unsettled: false,
      verification: null,
      samples: null,
      gate_state: "on",
      config_hash: "sha256:cfg",
      panel_sha: "sha",
      item_status: status,
      item_reason: null,
    },
  });

const coderabbit = ({
  item = "pr-1",
  file = "a.ts",
  summary,
  evidence = "",
  severity = "major",
  severityBasis = "header-field",
  window = "in-window",
  windowBasis = "commit-is-review-commit",
} = {}) =>
  buildFindingRecord({
    arm: "coderabbit",
    itemId: item,
    runId: null,
    population: "reported",
    finding: { file, summary, evidence, severity },
    detail: {
      source: "inline-comment",
      tier: "",
      vintage: "three-field",
      lens: "",
      stated_severity: severity,
      severity_basis: severityBasis,
      comment_id: "1",
      review_id: "1",
      posted_at: null,
      url: null,
      window,
      window_basis: windowBasis,
      at_commit: "abc",
      current_commit: "abc",
      review_commit: "abc",
    },
  });

/** Two wordings of ONE defect: same file, six shared significant tokens, so
 *  `tokenOverlap` is 1.00 against L2's 0.3 bar and `locationScore` is 1. */
const DEFECT_A_PANEL = "the paste handler bypasses the read only guard on the editor surface";
const DEFECT_A_CODERABBIT = "the paste handler bypasses the read only guard";
/** A second, unrelated defect — no shared significant token with the first. */
const DEFECT_B = "the retry loop never resets its backoff between attempts";
const DEFECT_C = "the manifest writer truncates a version list without logging";

const present = (arm, item) => ({ arm, item_id: item, state: "present" });
const absent = (arm, item) => ({ arm, item_id: item, state: "absent" });
const COVER_1 = [present("panel", "pr-1"), present("coderabbit", "pr-1")];

// --- the three counts -------------------------------------------------------

test("complementarityOf: both / panel-only / coderabbit-only, and the overlap they define", () => {
  const records = [
    panel({ summary: DEFECT_A_PANEL }),
    panel({ summary: DEFECT_B }),
    coderabbit({ summary: DEFECT_A_CODERABBIT }),
    coderabbit({ summary: DEFECT_C, file: "b.ts" }),
  ];
  const r = complementarityOf(records, { coverage: COVER_1 });
  assert.equal(r.overlap.both, 1, "the two wordings of defect A are one class");
  assert.equal(r.overlap.panel_only, 1);
  assert.equal(r.overlap.coderabbit_only, 1);
  assert.equal(r.overlap.classes, 3);
  assert.equal(r.overlap.jaccard, 1 / 3);
  // Every proportion carries its n, and the per-arm rate has a DIFFERENT
  // denominator from the overlap: it is that arm's own classes.
  assert.equal(r.byArm.panel.classes, 2);
  assert.equal(r.byArm.panel.only_rate, 1 / 2);
  assert.equal(r.byArm.coderabbit.only_rate, 1 / 2);
});

test("complementarityOf: a class of one is FIRST-CLASS — an arm that found nothing is a true negative", () => {
  // pr-2's CodeRabbit review was read and was clean. That is a data point: our
  // arm's finding there is a unique catch, and the item stays comparable.
  const records = [panel({ item: "pr-2", summary: DEFECT_B })];
  const r = complementarityOf(records, { coverage: [present("panel", "pr-2"), present("coderabbit", "pr-2")] });
  assert.equal(r.overlap.panel_only, 1);
  assert.equal(r.overlap.both, 0);
  assert.deepEqual(r.stats.items.comparable, ["pr-2"]);
  assert.equal(r.byItem["pr-2"].arms.coderabbit.state, "present");
  assert.equal(r.byItem["pr-2"].arms.coderabbit.findings, 0);
});

test("complementarityOf: an arm we could not LOAD is not an arm that found nothing", () => {
  // Identical records to the test above. The only difference is the declared
  // state, and it must remove the item from every pooled figure rather than
  // crediting our arm with a unique catch.
  const records = [panel({ item: "pr-2", summary: DEFECT_B })];
  const r = complementarityOf(records, { coverage: [present("panel", "pr-2"), absent("coderabbit", "pr-2")] });
  assert.equal(r.overlap.panel_only, 0, "a non-comparable item contributes to no pooled count");
  assert.deepEqual(r.stats.items.comparable, []);
  assert.deepEqual(r.stats.items.not_comparable, ["pr-2"]);
  assert.equal(r.byItem["pr-2"].comparable, false);
  assert.equal(r.byItem["pr-2"].arms.coderabbit.state, "absent");
  assert.match(r.stats.concerns.join("\n"), /items not comparable/);
});

test("complementarityOf: coverage is REQUIRED, and every arm/item pair must be declared", () => {
  const records = [panel({ summary: DEFECT_B })];
  assert.throws(() => complementarityOf(records, {}), /opts\.coverage is required/);
  assert.throws(() => complementarityOf(records, { coverage: [] }), /opts\.coverage is required/);
  // Half a frame: the panel declared, the other arm not. Refused rather than
  // defaulted, because the default that reads as a true negative is the bug.
  assert.throws(
    () => complementarityOf(records, { coverage: [present("panel", "pr-1")] }),
    /coverage declares no state for coderabbit\/pr-1/,
  );
  // A record on an item outside the frame entirely.
  assert.throws(
    () => complementarityOf([panel({ item: "pr-9", summary: DEFECT_B })], { coverage: COVER_1 }),
    /no coverage row for panel\/pr-9/,
  );
  assert.throws(() => complementarityOf(records, { coverage: [{ arm: "panel", item_id: "pr-1", state: "maybe" }] }), /state must be one of/);
});

test("coverageIndex: each row guard refuses on its own, with the offending row named", () => {
  // One condition per case, the rest of the row valid, so a passing assertion
  // names the guard that fired rather than whichever one happened to be first.
  const ok = present("coderabbit", "pr-1");
  const rows = (bad) => ({ coverage: [bad, ok] });
  const records = [];
  assert.throws(() => complementarityOf(records, rows({ arm: "human", item_id: "pr-1", state: "present" })), /coverage\[0\]\.arm must be one of panel \| coderabbit, got "human"/);
  assert.throws(() => complementarityOf(records, rows({ item_id: "pr-1", state: "present" })), /coverage\[0\]\.arm must be one of/);
  assert.throws(() => complementarityOf(records, rows({ arm: "panel", state: "present" })), /coverage\[0\]\.item_id must be a non-empty string, got undefined/);
  assert.throws(() => complementarityOf(records, rows({ arm: "panel", item_id: 415, state: "present" })), /coverage\[0\]\.item_id must be a non-empty string, got 415/);
  assert.throws(() => complementarityOf(records, rows({ arm: "panel", item_id: "   ", state: "present" })), /coverage\[0\]\.item_id must be a non-empty string, got " {3}"/);
  assert.throws(() => complementarityOf(records, rows({ arm: "panel", item_id: "pr-1" })), /coverage\[0\]\.state must be one of/);
});

test("coverageIndex: an item id is keyed the way the GROUPING keys it — trimmed", () => {
  // `defaultItemOf` trims, so a record carrying whitespace is grouped under the
  // trimmed id and its class reports that. A frame keyed on the raw string would
  // match no class at all and the run would report 0 of 0 with no error — total,
  // and silent, which is the failure mode this module exists to refuse.
  const r = complementarityOf([panel({ item: " pr-1 ", summary: DEFECT_B }), coderabbit({ item: "pr-1", summary: DEFECT_C, file: "b.ts" })], {
    coverage: [{ arm: "panel", item_id: " pr-1 ", state: "present" }, present("coderabbit", "pr-1")],
  });
  assert.deepEqual(r.stats.items.declared, ["pr-1"], "one item, not two spellings of one");
  assert.deepEqual(r.stats.items.comparable, ["pr-1"]);
  assert.equal(r.overlap.classes, 2, "and both arms' findings are scored rather than filtered away");
  assert.equal(r.byItem["pr-1"].arms.panel.findings, 1);
  assert.equal(r.byArm.panel.findings_comparable, 1);
});

// --- K draws against 1 ------------------------------------------------------

test("complementarityOf: the default view REFUSES to pool replicates", () => {
  const records = [panel({ run: "k1", summary: DEFECT_A_PANEL }), panel({ run: "k2", summary: DEFECT_A_PANEL }), coderabbit({ summary: DEFECT_A_CODERABBIT })];
  assert.throws(() => complementarityOf(records, { coverage: COVER_1 }), /2 panel run ids in one per-replicate view/);
  assert.throws(() => complementarityOf(records, { coverage: COVER_1, view: "nope" }), /view must be one of/);
  assert.deepEqual(VIEWS, ["per-replicate", "union", "intersection"]);
});

test("complementarityOf: union counts a class our arm raised in ANY replicate; intersection only in ALL", () => {
  // Defect B is raised in both replicates; defect C only in k1. CodeRabbit raised
  // neither. So union sees two panel classes and intersection sees one — and the
  // one intersection drops is reported rather than deducted in silence.
  const records = [
    panel({ run: "k1", summary: DEFECT_B }),
    panel({ run: "k2", summary: DEFECT_B }),
    panel({ run: "k1", summary: DEFECT_C, file: "b.ts" }),
  ];
  const union = complementarityOf(records, { coverage: COVER_1, view: "union" });
  assert.equal(union.overlap.panel_only, 2);
  assert.equal(union.stats.draws.panel, 2, "the output states how many tries our arm got");
  assert.equal(union.stats.draws.coderabbit, 1);

  const inter = complementarityOf(records, { coverage: COVER_1, view: "intersection" });
  assert.equal(inter.overlap.panel_only, 1);
  assert.equal(inter.overlap.not_claimed_in_view, 1, "the class only one replicate raised is counted where the view's cost is visible");
  assert.equal(inter.overlap.classes, 1);
});

test("complementarityOf: at K=1 the three views agree — they differ in how they read K draws, not in what they do with one", () => {
  const records = [panel({ summary: DEFECT_A_PANEL }), coderabbit({ summary: DEFECT_A_CODERABBIT }), coderabbit({ summary: DEFECT_C, file: "b.ts" })];
  const shape = (view) => {
    const { both, panel_only, coderabbit_only, classes } = complementarityOf(records, { coverage: COVER_1, view }).overlap;
    return { both, panel_only, coderabbit_only, classes };
  };
  assert.deepEqual(shape("union"), shape("per-replicate"));
  assert.deepEqual(shape("intersection"), shape("per-replicate"));
});

// --- the window guard -------------------------------------------------------

test("assertComparableWindow: an after-window finding REFUSES the run; unplaceable is scored", () => {
  const after = [coderabbit({ summary: DEFECT_C, window: "after-window", windowBasis: "commit-after-review" })];
  assert.throws(() => assertComparableWindow(after), /1 of 1 CodeRabbit record\(s\) are after-window/);
  assert.throws(() => complementarityOf(after, { coverage: COVER_1 }), /after-window/);

  // Unplaceable is in-window BY CONSTRUCTION on a corpus frozen at the reviewed
  // commit — the force-push case. Counted and named, never dropped.
  const unplaceable = [coderabbit({ summary: DEFECT_C, window: "unplaceable", windowBasis: "review-commit-not-on-pr" })];
  const r = complementarityOf(unplaceable, { coverage: COVER_1 });
  assert.equal(r.overlap.coderabbit_only, 1, "an unplaceable finding is still scored");
  assert.equal(r.stats.window.by_window.unplaceable, 1);
  assert.match(r.stats.concerns.join("\n"), /snapshot could not be placed/);
});

test("windowCensusOf: by value AND by basis, because unplaceable has four causes", () => {
  const census = windowCensusOf([
    panel({ summary: DEFECT_B }),
    coderabbit({ summary: DEFECT_C }),
    coderabbit({ summary: DEFECT_B, file: "b.ts", window: "unplaceable", windowBasis: "commits-unavailable" }),
  ]);
  assert.equal(census.n, 2, "panel records have no window and are not counted in its denominator");
  assert.deepEqual(census.by_window, { "in-window": 1, unplaceable: 1 });
  assert.deepEqual(census.by_basis, { "commit-is-review-commit": 1, "commits-unavailable": 1 });
});

// --- severity agreement -----------------------------------------------------

test("complementarityOf: severity agreement is exact / adjacent / further-apart, with a direction", () => {
  const shared = (panelSeverity, crSeverity, item) => [
    panel({ item, summary: DEFECT_A_PANEL, severity: panelSeverity }),
    coderabbit({ item, summary: DEFECT_A_CODERABBIT, severity: crSeverity }),
  ];
  const cover = ["pr-1", "pr-2", "pr-3"].flatMap((i) => [present("panel", i), present("coderabbit", i)]);
  const r = complementarityOf(
    [...shared("major", "major", "pr-1"), ...shared("major", "minor", "pr-2"), ...shared("critical", "nit", "pr-3")],
    { coverage: cover },
  );
  assert.equal(r.severity.stated.n, 3);
  assert.equal(r.severity.stated.exact, 1);
  assert.equal(r.severity.stated.adjacent, 1);
  assert.equal(r.severity.stated["further-apart"], 1);
  assert.equal(r.severity.stated.panel_more_severe, 2);
  assert.equal(r.severity.stated.coderabbit_more_severe, 0);
  assert.equal(r.severity.stated.exact_rate, 1 / 3);
  assert.equal(r.byItem["pr-3"].severity.stated["further-apart"], 1);
});

test("complementarityOf: a severity CodeRabbit never stated is NOT pooled with one it did", () => {
  const cover = ["pr-1", "pr-2"].flatMap((i) => [present("panel", i), present("coderabbit", i)]);
  const r = complementarityOf(
    [
      panel({ summary: DEFECT_A_PANEL, severity: "nit" }),
      coderabbit({ summary: DEFECT_A_CODERABBIT, severity: "nit", severityBasis: "unstated" }),
      panel({ item: "pr-2", summary: DEFECT_A_PANEL, severity: "nit" }),
      coderabbit({ item: "pr-2", summary: DEFECT_A_CODERABBIT, severity: "nit" }),
    ],
    { coverage: cover },
  );
  assert.equal(r.severity.shared_classes, 2);
  assert.equal(r.severity.stated.n, 1, "only the class whose severity CodeRabbit actually wrote");
  assert.equal(r.severity.unstated.n, 1);
  assert.equal(r.severity.unstated.exact, 1, "reported apart, not discarded");
});

test("complementarityOf: our own severity floor is flagged — normalizeSeverity coerces an unknown to major", () => {
  // A lens emitting "moderate" lands in the blocking population with `severity_raw`
  // as its only trace, so a shared class carrying one is marked rather than read as
  // a measured major.
  const r = complementarityOf([panel({ summary: DEFECT_A_PANEL, severity: "moderate" }), coderabbit({ summary: DEFECT_A_CODERABBIT })], { coverage: COVER_1 });
  assert.equal(r.severity.stated.n, 1);
  assert.equal(r.severity.stated.exact, 1, "coerced to major, which is what the other arm said");
  assert.equal(r.severity.panel_coerced, 1, "and the coercion is visible beside it");
});

// --- what must never be pooled ----------------------------------------------

test("complementarityOf: refuses the sampled population and an item whose replay did not end ok", () => {
  const sampled = buildFindingRecord({ arm: "panel", itemId: "pr-1", runId: "run-1", population: "sampled", finding: { lens: "correctness", file: "a.ts", summary: DEFECT_B, severity: "nit" }, detail: { lens: "correctness" } });
  assert.throws(() => complementarityOf([sampled], { coverage: COVER_1 }), /not population "reported"/);
  assert.throws(
    () => complementarityOf([panel({ summary: DEFECT_B, status: "error" })], { coverage: COVER_1 }),
    /did not end ok: pr-1\(error\)/,
  );
  assert.throws(() => complementarityOf([{ arm: "human", item_id: "pr-1", population: "reported" }], { coverage: COVER_1 }), /arm outside/);
});

test("complementarityOf: a panel record with no lens is REFUSED, because the same-run gate reads one", () => {
  const noLens = panel({ summary: DEFECT_B });
  noLens.panel.lens = null;
  assert.throws(() => complementarityOf([noLens], { coverage: COVER_1 }), /carry no panel\.lens/);
});

test("complementarityOf: the lens reaches finding-match's same-run gate — two lenses on one file stay two classes", () => {
  // The record keeps its lens in the arm namespace, where `groupFindings` does not
  // look, so this passes only while the lens is hoisted onto the finding it groups.
  // Without it both findings read `lens: undefined`, the (lens, file) gate degrades
  // to a file-only gate and these two identical summaries collapse into one class.
  const r = complementarityOf(
    [panel({ lens: "correctness", summary: DEFECT_A_PANEL }), panel({ lens: "security", summary: DEFECT_A_PANEL })],
    { coverage: COVER_1 },
  );
  assert.equal(r.overlap.panel_only, 2, "two lenses are two claims under the gate finding-match documents");
  assert.equal(r.stats.grouping.gate["same-run"], 1, "and the pair really was gated as same-run");
  // The same two findings from two RUNS are a different population, and
  // `gateFor` deliberately gives them the looser cross-source gate.
  const across = complementarityOf(
    [panel({ run: "k1", lens: "correctness", summary: DEFECT_A_PANEL }), panel({ run: "k2", lens: "security", summary: DEFECT_A_PANEL })],
    { coverage: COVER_1, view: "union" },
  );
  assert.equal(across.stats.grouping.gate["cross-source"], 1);
  assert.equal(across.overlap.panel_only, 1, "one defect, found under two lenses on two tries");
});

// --- nothing is swallowed ---------------------------------------------------

test("complementarityOf: groupFindings' own stats are surfaced whole, and a nonzero one is a concern", () => {
  const r = complementarityOf([panel({ summary: DEFECT_A_PANEL }), coderabbit({ summary: DEFECT_A_CODERABBIT })], { coverage: COVER_1 });
  // The whole stats block, not a summary of it: every field is a denominator or a
  // hole in one.
  for (const key of ["skipped", "accessor_failures", "unattributed", "gate", "links", "intra_group_non_match", "no_evidence_pairs", "id_collisions", "anchors_extracted"]) {
    assert.ok(Object.hasOwn(r.stats.grouping, key), `stats.grouping.${key} is missing`);
  }
  assert.equal(r.stats.grouping.intra_group_non_match, 0);
  assert.equal(r.stats.linkage, "complete");
  assert.deepEqual(r.stats.concerns, [], "a clean run has nothing to report");

  // A candidate merge the matcher declined is the policy's cost, and it must reach
  // the reader as a line rather than as an absence.
  const undecided = complementarityOf([panel({ summary: DEFECT_A_PANEL }), coderabbit({ summary: "paste guard missing" })], { coverage: COVER_1 });
  assert.equal(undecided.stats.grouping.links.maybe, 1);
  assert.match(undecided.stats.concerns.join("\n"), /maybe links.*\(1\)/);
});

test("complementarityOf: one ABSENT draw makes the pair absent — half a view is not all of it", () => {
  // K replicates give an item K coverage rows. An item one replicate never reached
  // is a hole in that view, not a clean review in the other two.
  const records = [panel({ run: "k1", summary: DEFECT_B })];
  const r = complementarityOf(records, {
    coverage: [{ arm: "panel", item_id: "pr-1", state: "present" }, { arm: "panel", item_id: "pr-1", state: "absent" }, present("coderabbit", "pr-1")],
    view: "union",
  });
  assert.equal(r.byItem["pr-1"].arms.panel.state, "absent");
  assert.deepEqual(r.stats.items.comparable, []);
  assert.equal(r.overlap.panel_only, 0);
});

test("complementarityOf: an arm's severity for a class is the MOST severe thing it said, not the last or the mean", () => {
  // Two panel claims on one defect, one major and one nit. The arm called this
  // defect major; averaging its own claims would answer a question nobody asked.
  const r = complementarityOf(
    [
      panel({ summary: DEFECT_A_PANEL, severity: "major" }),
      panel({ summary: `${DEFECT_A_PANEL} entirely`, severity: "nit" }),
      coderabbit({ summary: DEFECT_A_CODERABBIT, severity: "major" }),
    ],
    { coverage: COVER_1 },
  );
  assert.equal(r.overlap.both, 1, "all three claims are one class");
  assert.equal(r.classes.find((c) => c.claim === "both").panel_claims, 2);
  assert.equal(r.severity.stated.exact, 1, "major against major");
  assert.equal(r.severity.stated["further-apart"], 0);
});

test("complementarityOf: an unresolved cross-arm maybe makes the overlap a LOWER bound, and says when the ceiling is useless", () => {
  // Same file, enough shared tokens to tie but not to match: L2 answers `maybe`,
  // `groupFindings` never merges one, so the pair currently counts as two unique
  // catches — one for each arm.
  const r = complementarityOf(
    [panel({ summary: "the paste handler bypasses the read only guard on the editor surface" }), coderabbit({ summary: "paste guard missing" })],
    { coverage: COVER_1 },
  );
  assert.equal(r.overlap.both, 0);
  assert.equal(r.overlap.coderabbit_only, 1);
  assert.equal(r.unresolved.coderabbit_classes_with_a_panel_candidate, 1);
  assert.equal(r.unresolved.both_upper_bound, 1);
  assert.equal(r.unresolved.jaccard_upper_bound, 1, "if that one maybe were a match, everything would be shared");
  assert.equal(r.unresolved.saturated, true, "every coderabbit-only class has a candidate, so the ceiling says nothing");

  // With no cross-arm candidate at all the bound is real rather than saturated.
  const clean = complementarityOf([panel({ summary: DEFECT_B }), coderabbit({ summary: DEFECT_C, file: "b.ts" })], { coverage: COVER_1 });
  assert.equal(clean.unresolved.maybe_links, 0);
  assert.equal(clean.unresolved.saturated, false);
});

test("complementarityOf: the undecided queue is sorted strongest first and counted against the triage score", () => {
  // Three CodeRabbit findings on one file, each undecided against the panel's one,
  // at THREE DISTINCT scores — which is what makes the sort direction observable.
  // The spread comes from `symbolOverlap`: all three share the panel's file (so
  // `locationScore` is 1) and none reaches the token bar, and they differ only in
  // how many of the panel's backticked symbols they name. That is not a contrived
  // shape — it is exactly how the strongest real pairs score: a shared symbol
  // carries a pair to 1.00 while the prose stays under the bar, so it is a `maybe`
  // rather than a `match`.
  const withSymbols = (summary, evidence) => coderabbit({ summary, evidence });
  const records = [
    panel({ summary: DEFECT_A_PANEL, evidence: "`applyPaste` and `readOnlyGuard` are both involved" }),
    withSymbols("clipboard sanitiser concern", "`applyPaste` and `readOnlyGuard`"), // both symbols → 1.00
    withSymbols("another separate remark", "`applyPaste` and `unrelatedHelper`"), // one of two → 0.75
    withSymbols("a third distinct note", "`totallyOther` and `anotherThing`"), // none → 0.50
  ];
  const r = complementarityOf(records, { coverage: COVER_1 });
  const scores = r.unresolved.pairs.map((p) => p.score);
  assert.equal(new Set(scores).size, 3, "the fixture must produce DISTINCT scores or it cannot observe an order");
  assert.deepEqual(scores, [1, 0.75, 0.5], "strongest first — the head is the only part anybody reads");
  assert.equal(r.unresolved.maybe_links, 3, "the count is the whole queue, never a capped top-N");
  assert.equal(r.unresolved.triage_threshold, TRIAGE_SCORE);
  assert.equal(r.unresolved.strong_maybe_links, 2, "two of the three clear 0.70");
  assert.ok(r.unresolved.strong_maybe_links < r.unresolved.maybe_links, "a bottom-heavy queue is the point: the two numbers must be able to differ");
  // Every pair names the classes it joins, so the queue is a work list rather than
  // a tally — and TRIAGE_SCORE moves no count the module reports.
  assert.ok(r.unresolved.pairs.every((p) => p.groups.length === 2 && p.item === "pr-1"));
  assert.equal(r.overlap.both, 0, "a maybe never merges, whatever it scores");
  assert.equal(r.overlap.coderabbit_only, 3);
});

test("complementarityOf: cross-arm is a property of the two FINDINGS a link joins, not of their classes", () => {
  // A shared class carries BOTH arms, so a link from it to a panel-only class looks
  // cross-arm if you read the classes — while joining two panel findings. Here the
  // grouping emits two maybe links and exactly ONE of them is cross-arm.
  //
  // Not a hypothetical: reading the classes reported 424 undecided cross-arm pairs
  // on the pilot's first replicate where the true count is 412, which is what an
  // inspector pairing every panel record against every CodeRabbit record through
  // `matchFindings` directly returns.
  const records = [
    panel({ summary: DEFECT_A_PANEL, evidence: "`sharedHelper`" }), // merges with the CodeRabbit finding
    panel({ summary: "wholly separate wording about something else entirely", evidence: "`sharedHelper`" }), // maybe against it, same arm
    coderabbit({ summary: DEFECT_A_CODERABBIT }),
  ];
  const r = complementarityOf(records, { coverage: COVER_1 });
  assert.equal(r.overlap.both, 1);
  assert.equal(r.overlap.panel_only, 1);
  assert.equal(r.stats.grouping.links.maybe, 2, "the grouping saw two undecided links");
  assert.equal(r.unresolved.maybe_links, 1, "and only one of them joins findings from different arms");
});

test("complementarityOf: the undecided queue covers the SAME items the overlap does", () => {
  // pr-2 is not comparable — CodeRabbit was never loaded for it — so it is out of
  // every pooled figure. Its cross-arm maybe must be out of the queue too, or the
  // queue and the overlap it qualifies have different denominators (and the pair
  // arrives with `item: null`, because the scored classes do not name that item).
  const records = [
    panel({ summary: DEFECT_B }),
    panel({ item: "pr-2", summary: DEFECT_A_PANEL }),
    coderabbit({ item: "pr-2", summary: "paste guard missing" }),
  ];
  const r = complementarityOf(records, {
    coverage: [...COVER_1, present("panel", "pr-2"), absent("coderabbit", "pr-2")],
  });
  assert.deepEqual(r.stats.items.comparable, ["pr-1"]);
  assert.equal(r.unresolved.maybe_links, 0, "the only cross-arm maybe is on the item nothing else counts");
  assert.deepEqual(r.unresolved.pairs, []);
  assert.ok(r.unresolved.pairs.every((p) => p.item !== null));
});

test("complementarityOf: an input that is not a record object is COUNTED, never silently dropped", () => {
  const r = complementarityOf([panel({ summary: DEFECT_B }), null, "nope", ["also nope"]], { coverage: COVER_1 });
  assert.equal(r.stats.records.malformed, 3);
  assert.equal(r.stats.records.n, 1, "`n` is the denominator and it counts what survived");
  assert.match(r.stats.concerns.join("\n"), /inputs dropped before grouping: not a record object \(3\)/);
  assert.equal(r.overlap.panel_only, 1, "and the record that WAS usable is still scored");
});

test("complementarityOf: a rate with no denominator is null, never 0", () => {
  const r = complementarityOf([], { coverage: COVER_1 });
  assert.equal(r.overlap.classes, 0);
  assert.equal(r.overlap.jaccard, null, "0/0 → 0.000 reads as a measurement of perfect disagreement");
  assert.equal(r.byArm.panel.only_rate, null);
  assert.equal(r.severity.stated.exact_rate, null);
});

test("CLAIMS: the two values that are not a reviewer's silence are separated from the three that are", () => {
  assert.deepEqual(CLAIMS, ["both", "panel-only", "coderabbit-only", "no-arm", "not-claimed-in-view"]);
});

// --- the CLI's one parsing rule ---------------------------------------------

test("runIdsFrom: --run-id is repeatable, because parseArgs keeps only the last value", () => {
  assert.deepEqual(runIdsFrom(["node", "s.mjs", "--run-id", "k1", "--run-id", "k2", "--run-id", "k3"]), ["k1", "k2", "k3"]);
  assert.deepEqual(runIdsFrom(["node", "s.mjs", "--root", "/x", "--run-id", "k1", "--json"]), ["k1"]);
  // A flag with no value must not swallow the next flag as its run id — that is
  // how a three-replicate run silently scores one.
  assert.deepEqual(runIdsFrom(["node", "s.mjs", "--run-id", "--json"]), []);
  assert.deepEqual(runIdsFrom(["node", "s.mjs"]), []);
  assert.deepEqual(runIdsFrom(undefined), []);
});

// --- adjudicated pairs: what a label may and may not move -------------------
//
// The band is what this whole module reports, so the tests that matter most are the
// ones that pin which END of it a verdict is allowed to move. A ceiling that drops is
// what everybody wants from a label store — which is exactly why an off-by-one here
// would look like success.

/** One item, three defects: one both arms agree on, and two same-file pairs the
 *  matcher leaves undecided. Baseline band `1/5 = 20%` .. `3/3 = 100%`. */
const LABELLABLE = () => {
  const shared = { file: "a.ts", summary: DEFECT_A_PANEL };
  const sharedCr = { file: "a.ts", summary: DEFECT_A_CODERABBIT };
  const undecidedPanel = { file: "b.ts", summary: DEFECT_B };
  const undecidedCr = { file: "b.ts", summary: "unrelated remark about naming" };
  const otherPanel = { file: "c.ts", summary: DEFECT_C };
  const otherCr = { file: "c.ts", summary: "a third distinct note" };
  return {
    records: [panel(shared), coderabbit(sharedCr), panel(undecidedPanel), coderabbit(undecidedCr), panel(otherPanel), coderabbit(otherCr)],
    // The key is computed from the FINDINGS, independently of the scorer's own
    // pairing. If `complementarity.mjs` ever keyed a pair differently — a swapped
    // argument order, a different normalisation — the label below would match nothing
    // and this test would fail, which is the only way to check a key across two
    // programs without testing one against its own output.
    keyB: pairLabelKey({ ...undecidedPanel, line: null }, { ...undecidedCr, line: null }),
    keyC: pairLabelKey({ ...otherPanel, line: null }, { ...otherCr, line: null }),
  };
};

const DIFF_SHA = `sha256:${"1".repeat(64)}`;
const goldLabel = (key, verdict) => ({
  schema: "pair-label",
  schema_version: 1,
  pair_key: key,
  pair_key_at_801: null,
  pair_key_moved: false,
  corpus_version: "cv-1",
  run_id: "run-1",
  item_id: "pr-1",
  verdict,
  label_source: "gold",
  annotators: ["someone"],
  confidence: null,
  confidence_absent_reason: "the worksheet format has no confidence field",
  diff_sha256: DIFF_SHA,
});
const store = (labels) => ({ present: true, dir: "/store/labels/cv-1/pairs", labels, unreadable: [], invalid: [] });
const LABEL_OPTS = { diffShaOf: () => DIFF_SHA, runId: "run-1" };

test("complementarityOf: a PARTIAL label set moves the FLOOR and NOT the ceiling", () => {
  // THE CHECK THIS PR EXISTS TO PASS, end to end. One of the two undecided pairs is
  // adjudicated `same`; the other is untouched. The resolved class leaves the union
  // AND joins `both`, so the floor rises — while the ceiling's numerator gains
  // exactly what its denominator loses and the value does not budge.
  const { records, keyB } = LABELLABLE();
  const before = complementarityOf(records, { coverage: COVER_1 });
  assert.equal(before.overlap.jaccard, 1 / 5);
  assert.equal(before.unresolved.jaccard_upper_bound, 1);

  const after = complementarityOf(records, { coverage: COVER_1, pairLabels: store([goldLabel(keyB, "same")]), ...LABEL_OPTS });
  const band = after.labels.headline.band;
  assert.equal(after.labels.availability, "resolved");
  assert.equal(after.labels.tier, "gold");
  assert.equal(after.labels.headline.labels.applied, 1, "the label matched a live pair — the key agrees across the two modules");
  assert.equal(after.labels.headline.resolution.coderabbit_only_resolved_same, 1);
  assert.equal(band.after.jaccard, 2 / 4, "floor: 1/5 → 2/4");
  assert.equal(band.floor_moved, true);
  assert.equal(band.before.jaccard_upper_bound, band.after.jaccard_upper_bound, "THE CEILING MUST NOT MOVE on a partial label set");
  assert.equal(band.ceiling_moved, false);
  assert.ok(!after.stats.concerns.some((c) => /CEILING moved/.test(c)), "and no concern claims it did");
});

test("complementarityOf: the pre-existing band fields keep their meaning when labels exist", () => {
  // ADAPTERS WIDEN, NEVER NARROW. `report.mjs` renders `overlap.jaccard` and
  // `unresolved.jaccard_upper_bound` as the band; both must still be the UNLABELLED
  // numbers, or a consumer that has never heard of a label silently starts printing a
  // different statistic.
  const { records, keyB } = LABELLABLE();
  const before = complementarityOf(records, { coverage: COVER_1 });
  const after = complementarityOf(records, { coverage: COVER_1, pairLabels: store([goldLabel(keyB, "same")]), ...LABEL_OPTS });
  assert.deepEqual(after.overlap, before.overlap, "every count in `overlap` is label-blind");
  assert.equal(after.unresolved.jaccard_upper_bound, before.unresolved.jaccard_upper_bound);
  assert.equal(after.unresolved.coderabbit_classes_with_a_panel_candidate, before.unresolved.coderabbit_classes_with_a_panel_candidate);
  assert.equal(after.unresolved.saturated, before.unresolved.saturated);
  assert.deepEqual(after.byArm, before.byArm);
  // The labelled band lives in NEW fields, beside them.
  assert.notEqual(after.labels.headline.band.after.jaccard, after.overlap.jaccard);
});

test("complementarityOf: a scoring run with no label input says so, rather than reading as unlabelled-and-adjudicated", () => {
  const { records } = LABELLABLE();
  const r = complementarityOf(records, { coverage: COVER_1 });
  assert.equal(r.labels.availability, "not-supplied");
  assert.equal(r.labels.headline, null, "there is no band to report, and no zeroed one pretending to be it");
  assert.equal(r.labels.census.n, 0);
  // An EMPTY store is a different fact from an absent one, and both differ from
  // "labels exist and resolved nothing here".
  const empty = complementarityOf(records, { coverage: COVER_1, pairLabels: { present: false, dir: null, labels: [], unreadable: [], invalid: [] }, ...LABEL_OPTS });
  assert.equal(empty.labels.availability, "no-store");
  const unmatched = complementarityOf(records, { coverage: COVER_1, pairLabels: store([goldLabel("ffffffffffff", "same")]), ...LABEL_OPTS });
  assert.equal(unmatched.labels.availability, "none-matched");
  assert.equal(unmatched.labels.headline.labels.unmatched.length, 1, "and the label is listed, not dropped");
});

test("complementarityOf: every undecided pair carries the key its label would be filed under", () => {
  // The queue is a work list, and a curator works from `labels/<cv>/pairs/<key>.json`.
  // Printing the key beside the pair is what makes the queue adjudicable without a
  // second tool to compute it — and the class ids answer a different question, so both
  // are reported.
  const { records, keyB, keyC } = LABELLABLE();
  const r = complementarityOf(records, { coverage: COVER_1 });
  assert.deepEqual(r.unresolved.pairs.map((p) => p.pair_key).sort(), [keyB, keyC].sort());
  for (const p of r.unresolved.pairs) {
    assert.match(p.pair_key, /^[0-9a-f]{12}$/);
    assert.equal(p.groups.length, 2, "the pre-existing field is untouched");
    // The two sides are named, and named the right way round: the class the label
    // resolves is the CodeRabbit one.
    const crClass = r.classes.find((c) => c.id === p.coderabbit_class);
    const panelClass = r.classes.find((c) => c.id === p.panel_class);
    assert.ok(crClass.coderabbit_claims > 0 && crClass.panel_claims === 0);
    assert.ok(panelClass.panel_claims > 0 && panelClass.coderabbit_claims === 0);
  }
});

test("complementarityOf: a stale label refuses the whole scoring run", () => {
  // The drift guard, through the scorer. A label adjudicated against a diff the
  // corpus no longer holds is refused rather than skipped, because a band computed
  // over the rest would mix two diffs with nothing in the output saying so.
  const { records, keyB } = LABELLABLE();
  assert.throws(
    () => complementarityOf(records, { coverage: COVER_1, pairLabels: store([goldLabel(keyB, "same")]), diffShaOf: () => `sha256:${"9".repeat(64)}`, runId: "run-1" }),
    /adjudicated against a diff this corpus no longer holds/,
  );
  // And a label store handed over as a bare array is refused too: a list cannot say
  // whether the store exists or what in it was unreadable.
  assert.throws(() => complementarityOf(records, { coverage: COVER_1, pairLabels: [goldLabel(keyB, "same")], ...LABEL_OPTS }), /must be the object readPairLabels/);
});

test("complementarityOf: `insufficient-basis` leaves the pair undecided, so neither bound moves", () => {
  // Three verdicts, three behaviours — asserted here as well as in the unit tests,
  // because this is the value whose mishandling would move the CEILING. Both pairs are
  // adjudicated and neither is DECIDED, so a full label set over this replicate must
  // leave the band exactly where an empty one does.
  const { records, keyB, keyC } = LABELLABLE();
  const r = complementarityOf(records, {
    coverage: COVER_1,
    pairLabels: store([goldLabel(keyB, "insufficient-basis"), goldLabel(keyC, "insufficient-basis")]),
    ...LABEL_OPTS,
  });
  assert.equal(r.labels.headline.labels.applied, 2, "both were read");
  assert.equal(r.labels.availability, "resolved-nothing", "and neither resolved anything");
  assert.equal(r.labels.headline.resolution.coderabbit_only_finished_apart, 0, "insufficient-basis finishes nothing");
  assert.equal(r.labels.headline.resolution.coderabbit_only_still_undecided, 2);
  assert.equal(r.labels.headline.band.floor_moved, false);
  assert.equal(r.labels.headline.band.ceiling_moved, false);
  assert.deepEqual(r.labels.headline.band.after, r.labels.headline.band.before);

  // The contrast: `different` on a class whose ONLY pair it is finishes that class,
  // which is the one movement that lowers the ceiling. Asserted beside the case above
  // so the difference between the two verdicts is visible in one place.
  const mixed = complementarityOf(records, {
    coverage: COVER_1,
    pairLabels: store([goldLabel(keyB, "insufficient-basis"), goldLabel(keyC, "different")]),
    ...LABEL_OPTS,
  });
  assert.equal(mixed.labels.headline.resolution.coderabbit_only_finished_apart, 1);
  assert.equal(mixed.labels.headline.resolution.coderabbit_only_still_undecided, 1, "the insufficient-basis class is still in the pool");
  assert.equal(mixed.labels.headline.band.floor_moved, false, "deciding a pair apart never raises the floor");
  assert.equal(mixed.labels.headline.band.ceiling_moved, true);
  assert.match(mixed.stats.concerns.join("\n"), /label-resolved CEILING moved/, "a ceiling that moves is called out, because it is what everyone wants to see");
});
