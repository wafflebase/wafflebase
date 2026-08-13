// The property this file exists to pin is a NEGATIVE one: that the panel's own
// judgement of a finding cannot reach the person judging it. A test that only checked
// the happy path would pass just as well against a CLI that printed the severity, the
// verifier's verdict and "CodeRabbit agrees" — and the dataset produced by that CLI
// would grade the panel against itself, publish a higher precision figure, and be
// undetectable downstream.
//
// So the first block constructs a record carrying ALL FOUR forbidden signals and
// asserts none of them survives, at every stage a human could see: the card, the
// payload and the rendered text. The second pins the thing that makes the job
// tractable at all — one judgement per defect rather than per wording — and it is
// pinned as a MERGE, because the failure mode is that the bundling silently stops
// working and every count still looks plausible.
//
// Nothing here calls a model or spawns anything. The filesystem tests write only into
// a fresh `mkdtemp` root; nothing touches the real eval store.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildFindingRecord } from "./finding-record.mjs";
import { BLINDED_FROM_ADJUDICATION, LABELS_DIR, armKeyOf, labelPathFor, validateLabel } from "./labels.mjs";
import { ADJUDICATION_MODES, LABEL_SOURCES } from "./labels.mjs";
import {
  CARD_FIELDS,
  MATCHER_OPERAND_FIELDS,
  ORDERS,
  PRESENTED_FIELDS,
  REFUSED_ORDERS,
  WITHHELD_FIELDS,
  admitRecord,
  applyJudgement,
  buildQueue,
  bundleCards,
  fileDiffSection,
  harvestVintage,
  presentBundle,
  readFindingLabels,
  renderCard,
  resolveOptions,
  runItemSession,
  runSession,
  writeLabels,
} from "./adjudicate.mjs";

const CV = "2026-08-10-pilot-reviewed";
const DIFF_SHA = `sha256:${"c".repeat(64)}`;
const META = new Map([["pr-605", { id: "pr-605", sha256_diff: DIFF_SHA, scope: "L", additions: 951, deletions: 53, changed_files: ["a.ts"] }]]);

/** A panel record carrying every signal the adjudicator must never see. */
const loaded = (over = {}) =>
  buildFindingRecord({
    arm: "panel",
    itemId: "pr-605",
    runId: "pilot-01__k1",
    population: "reported",
    finding: {
      file: "packages/notes/src/view/editor.ts",
      line: 132,
      summary: "undo floor is compared against a stack that can shrink independently",
      evidence: "editor.ts:132 reads undoFloor as an absolute depth",
      severity: "critical",
      // The gate outcome and the verifier's verdict, both on the finding itself.
      lane: "blocking",
      verification: "confirmed-high",
      unsettled: true,
      // A field no PR has added yet: an allowlist has to drop what it has not heard of.
      cross_arm_agreement: true,
      ...over,
    },
    detail: { lens: "correctness", gate_state: "on", verification: "confirmed-high", lane: "blocking" },
  });

const context = (over = {}) => ({
  corpusVersion: CV,
  itemMeta: META,
  diffFor: () => null,
  annotators: ["dlgpdmsly2"],
  mode: "human",
  labelSource: "gold",
  parserVintage: "harvest.mjs@sha256:abc",
  ...over,
});

const judgement = (over = {}) => ({ isReal: true, severity: "minor", confidence: "medium", evidence: "read editor.ts:132", ...over });

/** A scripted terminal: answers in order, and every line printed kept for inspection. */
function scriptedIo(answers) {
  const printed = [];
  const asked = [];
  let i = 0;
  return {
    printed,
    asked,
    remaining: () => answers.length - i,
    print: (t) => printed.push(String(t)),
    ask: async (prompt) => {
      asked.push(String(prompt));
      // An exhausted script means the session asked more than the test expected, which
      // is a real failure rather than a reason to hang.
      if (i >= answers.length) throw new Error(`the session asked ${answers.length + 1} questions; the script has ${answers.length}: ${prompt}`);
      return answers[i++];
    },
  };
}

/**
 * A fresh throwaway root, removed afterwards — and it AWAITS, which the first version
 * did not.
 *
 * `return fn(root)` inside a synchronous `try/finally` runs `rmSync` the moment an async
 * callback reaches its first `await`, so cleanup happened while the test body was still
 * running. **Measured rather than assumed, because the first guess at the consequence was
 * wrong:** the assertions were NOT weakened — `writeFileAtomic` calls
 * `mkdirSync(recursive)`, so anything written afterwards recreates the tree and an
 * `existsSync` check still catches it (verified by forcing a write in preview mode and
 * watching the test go red under both versions). What it actually cost is **3 leaked
 * temp directories per run, with label files in them**, recreated after the `rmSync`
 * that was supposed to remove them; awaiting leaks 0. This repository already has a test
 * that fails when another module leaves `eval-item-*` behind in `os.tmpdir()`, so the
 * leak is the kind of debris that is somebody's flake later.
 */
const withRoot = async (fn) => {
  const root = mkdtempSync(path.join(tmpdir(), "eval-adjudicate-test-"));
  try {
    return await fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};

// --- BLINDING ----------------------------------------------------------------

test("no panel severity, verifier verdict, gate outcome or cross-arm flag reaches the presenter", () => {
  const record = loaded();
  // The record really does carry all four, or this test proves nothing.
  assert.equal(record.severity, "critical");
  assert.equal(record.gating, "gates");
  assert.equal(record.panel.raw.verification, "confirmed-high");
  assert.equal(record.panel.raw.cross_arm_agreement, true);

  const card = admitRecord(record);
  const [bundle] = bundleCards([card]);
  const payload = presentBundle(bundle);
  const text = renderCard(payload, { index: 1, total: 1 });

  // `presented_fields` and `withheld_fields` legitimately NAME the blinded signals —
  // that is the record of the blinding, and it is what the label carries as its basis.
  // Dropping the two arrays is not string surgery on the content: nothing else in the
  // payload may mention them.
  const content = { ...payload };
  delete content.presented_fields;
  delete content.withheld_fields;
  // ⚠ A word scan is only decisive because this fixture's own prose is controlled. A
  // real reviewer may write "major regression" in its evidence, and that is the
  // reviewer's word rather than our leak. The structural guarantee is the allowlist in
  // the next test; this one proves the four signals of THIS record do not survive.
  for (const [what, blob] of [["card", JSON.stringify(card)], ["payload", JSON.stringify(content)], ["rendered text", text]]) {
    for (const banned of ["severity", "critical", "gating", "gates", "lane", "blocking", "verification", "confirmed-high", "unsettled", "cross_arm_agreement"]) {
      assert.ok(!blob.includes(banned), `${what} leaks ${banned}: ${blob.slice(0, 400)}`);
    }
  }
  // And the two this CLI withholds beyond the guide's four.
  for (const field of ["arm", "run_id"]) {
    assert.ok(!Object.hasOwn(content, field), `the payload must not carry ${field}`);
    assert.ok(WITHHELD_FIELDS.includes(field), `${field} must be declared withheld`);
  }
  // What it DOES carry: the claim, which is the thing being judged.
  assert.ok(text.includes("undo floor is compared against a stack"));
  assert.ok(text.includes("packages/notes/src/view/editor.ts:132"));
});

test("the card is an allowlist, so a field added later is dropped rather than carried", () => {
  const card = admitRecord(loaded({ __invented_by_a_future_pr: "leak" }));
  assert.deepEqual(Object.keys(card).sort(), [...CARD_FIELDS].sort());
  assert.ok(!Object.hasOwn(card, "__invented_by_a_future_pr"));
  // A denylist would have needed editing by whoever added that field, and they would
  // not have known to.
  assert.ok(!JSON.stringify(card).includes("leak"));
});

test("a bundle can never span two arms, because that IS the cross-arm agreement signal", () => {
  const panel = admitRecord(loaded());
  const cr = admitRecord(
    buildFindingRecord({
      arm: "coderabbit",
      itemId: "pr-605",
      population: "reported",
      finding: { file: "packages/notes/src/view/editor.ts", line: 132, summary: "undo floor is compared against a stack that can shrink independently", severity: "major" },
      detail: { source: "inline-comment", tier: "potential-issue" },
    }),
  );
  // Identical file, line and summary: the matcher would merge these instantly if they
  // were allowed into one grouping.
  const bundles = bundleCards([panel, cr]);
  assert.equal(bundles.length, 2, "one bundle per arm");
  for (const b of bundles) assert.equal(new Set(b.members.map((m) => m.arm)).size, 1);
  assert.deepEqual(bundles.map((b) => b.arm).sort(), ["coderabbit", "panel"]);
});

test("every triage order is blind, and the ones that are not are refused by name", () => {
  assert.deepEqual([...ORDERS], ["coverage", "locality", "none"]);
  for (const forbidden of Object.keys(REFUSED_ORDERS)) {
    assert.throws(() => buildQueue({ records: [], order: forbidden }), new RegExp(`--order ${forbidden} is refused`));
    assert.ok(resolveOptions({ root: "/r", "corpus-version": CV, run: "r1", order: forbidden }).problems.some((p) => p.includes("is refused")));
  }
  assert.ok(Object.hasOwn(REFUSED_ORDERS, "severity") && Object.hasOwn(REFUSED_ORDERS, "agreement"));
});

test("what was presented and what was withheld travels into the label", () => {
  const [bundle] = bundleCards([admitRecord(loaded())]);
  const [label] = applyJudgement({ bundle, judgement: judgement(), context: context() });
  assert.deepEqual(label.adjudication.presented_fields, [...PRESENTED_FIELDS]);
  for (const blinded of BLINDED_FROM_ADJUDICATION) {
    assert.ok(label.adjudication.withheld_fields.includes(blinded));
    assert.ok(!label.adjudication.presented_fields.includes(blinded));
  }
  // The CLI offers no pre-fill at all, so nothing can be accepted unreviewed.
  assert.equal(label.adjudication.suggestion, null);
  assert.equal(label.adjudication.suggestion_outcome, "not-shown");
});

// --- BUNDLING: where the 275 figure actually comes from -----------------------

test("two wordings of one defect are ONE judgement covering both keys", () => {
  // The plan's premise was that `findingKey` repeats across replicates. Measured on
  // the pilot's 428 panel records: 426 distinct keys, 2 in two replicates, none in all
  // three. The reuse is at defect-class level — 245 classes over the same 428 records
  // — so this merge is the entire mechanism that turns 428 judgements into 245.
  const k1 = admitRecord(loaded());
  const k3 = admitRecord(
    buildFindingRecord({
      arm: "panel",
      itemId: "pr-605",
      runId: "pilot-01__k3",
      population: "reported",
      finding: {
        file: "packages/notes/src/view/editor.ts",
        line: 132,
        summary: "undo floor compared against a stack which can shrink independently, so undo stops early",
        evidence: "editor.ts:132 reads undoFloor as an absolute depth",
        severity: "minor",
      },
      detail: { lens: "correctness" },
    }),
  );
  const bundles = bundleCards([k1, k3]);
  assert.equal(bundles.length, 1, "one defect, two wordings, one judgement");
  const [bundle] = bundles;
  assert.equal(bundle.covers, 2);
  assert.equal(bundle.keys.length, 2);
  const labels = applyJudgement({ bundle, judgement: judgement(), context: context() });
  assert.equal(labels.length, 2, "one label per key, from one reading");
  for (const l of labels) {
    assert.equal(l.class_id, bundle.class_id);
    assert.deepEqual(l.class_members, bundle.keys);
    assert.equal(l.is_real, true);
    assert.doesNotThrow(() => validateLabel(l, { itemMeta: META.get("pr-605") }));
  }
});

test("the matcher's operand fields are the record's own names, because a rename kills bundling", () => {
  // This file shipped that bug once: the card called the claim `claim` and the prose
  // `detail`, `findingSimilarity` found no tokens on either side, its never-merge-on-
  // no-evidence rule rejected every pair, and the queue came out at 428 classes for
  // 428 records. Nothing threw. So the operand names are asserted directly, and the
  // merge above is what goes red if they drift again.
  const card = admitRecord(loaded());
  for (const field of MATCHER_OPERAND_FIELDS) assert.ok(Object.hasOwn(card, field), `the card must carry ${field} under that name`);
  assert.equal(card.summary, loaded().summary);
  assert.equal(card.evidence, loaded().evidence);
});

test("coverage order puts the most-covering judgement first, and every order is total", () => {
  const records = [
    loaded({ file: "a.ts", summary: "alone in a.ts and nothing like the others" }),
    loaded({ file: "b.ts", summary: "shared defect about the retry loop bound" }),
    buildFindingRecord({
      arm: "panel",
      itemId: "pr-605",
      runId: "pilot-01__k2",
      population: "reported",
      finding: { file: "b.ts", line: 9, summary: "shared defect about the retry loop bound, restated", severity: "minor", evidence: "b.ts:9 retry loop" },
      detail: { lens: "correctness" },
    }),
  ];
  const { queue, census } = buildQueue({ records, order: "coverage" });
  assert.equal(census.bundles, 2);
  assert.equal(queue[0].covers, 2, "the pair first");
  assert.equal(queue[1].covers, 1);
});

test("the queue order is TOTAL, so two bundles that tie still come out the same way", () => {
  // Every field the comparators read has to tie before the final `class_id` tiebreak
  // is reachable, so the fixture is two unrelated claims at the SAME file and line.
  // Without it the tiebreak is dead code that a shuffled input cannot exercise: a
  // mutation removing it survived until this fixture existed.
  const at = (summary) => loaded({ file: "same.ts", line: 7, summary, evidence: `same.ts:7 ${summary}` });
  const records = [at("the retry bound is off by one"), at("an unrelated naming choice in the same hunk"), at("a third claim about that line's guard")];
  const { queue, census } = buildQueue({ records });
  assert.equal(census.bundles, 3, "three singletons at one location");
  for (const b of queue) assert.equal(b.covers, 1, "so covers, item, file and line all tie");
  // `Array.sort` is stable, so comparing two builds of the SAME input proves only that
  // sorting is not random. Every permutation must give one answer — including under
  // `none`, which applies no comparator and inherits `groupFindings`' own `(item, id)`
  // order. This assertion is what corrected that value's name: it was `arrival`, and
  // "input order" is not what it produced.
  for (const order of ORDERS) {
    for (const perm of [[2, 0, 1], [1, 2, 0], [2, 1, 0]]) {
      assert.deepEqual(
        buildQueue({ records: perm.map((i) => records[i]), order }).queue.map((b) => b.class_id),
        buildQueue({ records, order }).queue.map((b) => b.class_id),
        `${order} must not depend on input order`,
      );
    }
  }
});

test("the census states records and judgements separately, and never silently truncates", () => {
  const records = [loaded({ file: "a.ts", summary: "one" }), loaded({ file: "b.ts", summary: "two" }), loaded({ file: "c.ts", summary: "three" })];
  const { queue, census } = buildQueue({ records, limit: 2 });
  assert.equal(queue.length, 2);
  assert.equal(census.records_in, 3);
  assert.equal(census.bundles, 3);
  assert.equal(census.queued, 2);
  // A cap that drops data has to say what it dropped.
  assert.equal(census.withheld_from_queue, 1);
  assert.equal(census.records_covered_by_queue, 2);
});

test("an unusable record is dropped by name, not by shrinking the queue in silence", () => {
  const { queue, census, dropped } = buildQueue({ records: [loaded(), { arm: "panel", schema_version: 999 }] });
  assert.equal(queue.length, 1);
  assert.equal(census.dropped, 1);
  assert.equal(dropped[0].index, 1);
  assert.match(dropped[0].reason, /schema_version/);
});

// --- RESUMABILITY ------------------------------------------------------------

test("a key that already has a label is not asked again", async () => {
  const records = [loaded({ file: "a.ts", summary: "first defect" }), loaded({ file: "b.ts", summary: "second defect" })];
  const first = buildQueue({ records });
  assert.equal(first.queue.length, 2);
  const answered = first.queue[0].arm_keys;
  const second = buildQueue({ records, labelled: new Set(answered) });
  assert.equal(second.queue.length, 1, "the answered bundle is gone");
  assert.equal(second.census.settled, 1);
  assert.equal(second.census.pending, 1);
  assert.deepEqual(second.queue[0].class_id, first.queue[1].class_id, "and the unanswered one keeps its place");
});

test("labelling the panel's copy does not settle CodeRabbit's identical claim", () =>
  withRoot((root) => {
    // `findingKey` is (file, summary) and says nothing about who raised the claim, so
    // the two arms CAN produce one key. If the resume check ignored the arm, the second
    // arm's finding would be marked settled by the first arm's label and never asked —
    // which is a missing label that no count would report.
    const claim = { file: "a.ts", line: 4, summary: "identical wording from both reviewers", evidence: "a.ts:4" };
    const panel = buildFindingRecord({ arm: "panel", itemId: "pr-605", runId: "pilot-01__k1", population: "reported", finding: { ...claim, severity: "minor" }, detail: { lens: "correctness" } });
    const cr = buildFindingRecord({ arm: "coderabbit", itemId: "pr-605", population: "reported", finding: { ...claim, severity: "minor" }, detail: { source: "inline-comment" } });
    assert.equal(panel.finding_key, cr.finding_key, "the fixture's premise");

    const records = [panel, cr];
    assert.equal(buildQueue({ records }).census.bundles, 2);
    // Judge the panel's copy only.
    const panelBundle = buildQueue({ records, arm: "panel" }).queue[0];
    writeLabels(applyJudgement({ bundle: panelBundle, judgement: judgement(), context: context() }), { root, itemMeta: META });

    const after = buildQueue({ records, labelled: readFindingLabels(root, CV).keys });
    assert.equal(after.census.settled, 1);
    assert.equal(after.queue.length, 1, "CodeRabbit's copy is still pending");
    assert.equal(after.queue[0].arm, "coderabbit");
    assert.equal(armKeyOf("panel", panel.finding_key) === armKeyOf("coderabbit", cr.finding_key), false);
  }));

test("interrupt mid-queue, resume, and no judgement is lost or re-asked", () =>
  withRoot(async (root) => {
    const records = [
      loaded({ file: "a.ts", summary: "first defect in a" }),
      loaded({ file: "b.ts", summary: "second defect in b" }),
      loaded({ file: "c.ts", summary: "third defect in c" }),
    ];
    const write = (labels) => writeLabels(labels, { root, itemMeta: META });
    const ctx = context();

    // Session one: answer the first, then quit at the second.
    const io1 = scriptedIo(["y", "minor", "", "medium", "read a.ts", "", "", "q"]);
    const q1 = buildQueue({ records, labelled: readFindingLabels(root, CV).keys });
    assert.equal(q1.queue.length, 3);
    const r1 = await runSession({ queue: q1.queue, io: io1, write, context: ctx });
    assert.equal(r1.judged, 1);
    assert.equal(r1.quit, true);
    assert.equal(r1.written.length, 1);
    assert.equal(io1.remaining(), 0, "the script drove exactly the questions asked");

    // The judgement survived the quit, on disk, as a valid label.
    const onDisk = readFindingLabels(root, CV);
    assert.equal(onDisk.labels.length, 1);
    assert.equal(onDisk.unreadable.length, 0);
    assert.doesNotThrow(() => validateLabel(onDisk.labels[0], { itemMeta: META.get("pr-605") }));

    // Session two: the queue is rebuilt from those labels alone. No session file.
    const q2 = buildQueue({ records, labelled: onDisk.keys });
    assert.equal(q2.queue.length, 2, "two left");
    assert.equal(q2.census.settled, 1);
    assert.ok(!q2.queue.some((b) => b.class_id === q1.queue[0].class_id), "the answered one is not re-asked");
    const io2 = scriptedIo(["y", "minor", "", "low", "read b.ts", "", "", "n", "nit", "", "low", "read c.ts", "", "hallucination: the guard is present"]);
    const r2 = await runSession({ queue: q2.queue, io: io2, write, context: ctx });
    assert.equal(r2.judged, 2);
    assert.equal(readFindingLabels(root, CV).labels.length, 3, "all three judgements are on disk");
    assert.equal(buildQueue({ records, labelled: readFindingLabels(root, CV).keys }).queue.length, 0, "nothing pending");
  }));

test("a bundle whose keys are only PARTLY labelled is asked again, not counted as done", () =>
  withRoot((root) => {
    // One judgement writes N labels, so a crash can land between them. Marking the
    // bundle settled on the first key would leave a member key with no label that
    // nothing ever revisits — and re-asking costs one question, because the write path
    // overwrites with an identical answer.
    const k1 = loaded({ file: "b.ts", summary: "the retry bound is off by one here" });
    const k3 = loaded({ file: "b.ts", summary: "retry bound off by one, restated on another try" });
    const records = [k1, k3];
    const [bundle] = buildQueue({ records }).queue;
    assert.equal(bundle.keys.length, 2, "the fixture's premise: one bundle, two keys");
    // Write only the first of the two labels, as an interrupted session would.
    const labels = applyJudgement({ bundle, judgement: judgement(), context: context() });
    writeLabels([labels[0]], { root, itemMeta: META });

    const after = buildQueue({ records, labelled: readFindingLabels(root, CV).keys });
    assert.equal(after.census.settled, 0, "half-written is not settled");
    assert.equal(after.queue.length, 1, "the bundle comes back");
    assert.equal(after.queue[0].class_id, bundle.class_id);
    // And finishing it settles it.
    writeLabels([labels[1]], { root, itemMeta: META });
    assert.equal(buildQueue({ records, labelled: readFindingLabels(root, CV).keys }).queue.length, 0);
  }));

test("a skip writes nothing and comes back next session", () =>
  withRoot(async (root) => {
    const records = [loaded({ file: "a.ts", summary: "the one to skip" })];
    const { queue } = buildQueue({ records });
    const io = scriptedIo(["s"]);
    const r = await runSession({ queue, io, write: (l) => writeLabels(l, { root, itemMeta: META }), context: context() });
    assert.equal(r.skipped, 1);
    assert.equal(r.judged, 0);
    assert.equal(readFindingLabels(root, CV).labels.length, 0);
    assert.equal(buildQueue({ records, labelled: readFindingLabels(root, CV).keys }).queue.length, 1);
  }));

test("an unreadable label is counted, never read as an unjudged finding", () =>
  withRoot((root) => {
    const abs = labelPathFor({ root, corpusVersion: CV, schema: "finding-label", itemId: "pr-605", arm: "panel", findingKey: "a.ts::x" });
    writeLabels(
      applyJudgement({ bundle: bundleCards([admitRecord(loaded())])[0], judgement: judgement(), context: context() }),
      { root, itemMeta: META },
    );
    writeFileSync(abs, "{ truncated");
    const read = readFindingLabels(root, CV);
    assert.equal(read.unreadable.length, 1);
    assert.equal(read.labels.length, 1, "the intact one still reads");
    // Re-asking it would overwrite the only evidence of the first answer, so the
    // truncated file is named rather than passed over in silence.
    assert.equal(read.unreadable[0].path, abs);
    assert.match(read.unreadable[0].reason, /JSON/i);
  }));

test("a label file that parses but is not a label counts as unreadable, not as a label", () =>
  withRoot(async (root) => {
    // It used to land in `labels` and be left out of `keys`, so it looked like a label
    // that settled nothing: the bundle came back, the reader answered it again, and the
    // write path then refused because a file already existed there — a dead end with no
    // line saying why.
    const records = [loaded({ file: "a.ts", summary: "the one whose label got mangled" })];
    const [bundle] = buildQueue({ records }).queue;
    const [label] = applyJudgement({ bundle, judgement: judgement(), context: context() });
    const [abs] = writeLabels([label], { root, itemMeta: META });
    // Valid JSON, no `finding_key`, no `arm` — a hand edit, or a future writer's bug.
    writeFileSync(abs, JSON.stringify({ note: "I meant to put a label here" }, null, 2));

    const read = readFindingLabels(root, CV);
    assert.equal(read.labels.length, 0, "it is not a label");
    assert.equal(read.unreadable.length, 1, "and it is reported");
    assert.equal(read.unreadable[0].path, abs);
    assert.match(read.unreadable[0].reason, /no finding_key and arm/);
    assert.equal(read.keys.size, 0, "so it settles nothing");
    // Which is the same answer the truncated-JSON case gets, one level in.
    assert.equal(buildQueue({ records, labelled: read.keys }).queue.length, 1);
  }));

// --- WRITING -----------------------------------------------------------------

test("nothing is written without being told to write", () =>
  withRoot(async (root) => {
    const { queue } = buildQueue({ records: [loaded()] });
    const io = scriptedIo(["y", "minor", "", "medium", "read it", "", ""]);
    // `write: null` is the default, and the CLI only supplies one under --write.
    const r = await runSession({ queue, io, write: null, context: context() });
    assert.equal(r.judged, 1);
    assert.equal(r.labels.length, 1, "the label was built");
    assert.equal(r.written.length, 0, "and not written");
    assert.ok(!existsSync(path.join(root, LABELS_DIR)), `${root} must be untouched`);
    assert.ok(io.printed.some((p) => p.includes("NOT written")));
  }));

test("every written path is inside --root, and the tree is exactly the guide's layout", () =>
  withRoot((root) => {
    const labels = applyJudgement({ bundle: bundleCards([admitRecord(loaded())])[0], judgement: judgement(), context: context() });
    const written = writeLabels(labels, { root, itemMeta: META });
    for (const abs of written) {
      assert.ok(abs.startsWith(path.resolve(root) + path.sep), `${abs} escapes ${root}`);
      assert.ok(statSync(abs).isFile());
    }
    const dir = path.join(root, LABELS_DIR, CV, "findings", "pr-605", "panel");
    assert.deepEqual(readdirSync(dir).length, 1);
    assert.match(readdirSync(dir)[0], /^[0-9a-f]{64}\.json$/);
    // Readable as JSON, with a trailing newline, like every other file this store writes.
    const bytes = readFileSync(written[0], "utf8");
    assert.ok(bytes.endsWith("}\n"));
    assert.doesNotThrow(() => validateLabel(JSON.parse(bytes), { itemMeta: META.get("pr-605") }));
  }));

test("the write path re-checks drift against the item's CURRENT meta, and refuses a stale label", () =>
  withRoot((root) => {
    const labels = applyJudgement({ bundle: bundleCards([admitRecord(loaded())])[0], judgement: judgement(), context: context() });
    const reExtracted = new Map([["pr-605", { id: "pr-605", sha256_diff: `sha256:${"d".repeat(64)}` }]]);
    assert.throws(() => writeLabels(labels, { root, itemMeta: reExtracted }), /the label is STALE/);
    assert.ok(!existsSync(path.join(root, LABELS_DIR)), "and nothing was written");
  }));

test("an existing label is not overwritten unless re-adjudication is asked for", () =>
  withRoot((root) => {
    const labels = applyJudgement({ bundle: bundleCards([admitRecord(loaded())])[0], judgement: judgement(), context: context() });
    writeLabels(labels, { root, itemMeta: META });
    assert.throws(() => writeLabels(labels, { root, itemMeta: META }), /only with --relabel/);
    // Guide §8 requires re-adjudication to be possible: "labels are correctable".
    const corrected = applyJudgement({ bundle: bundleCards([admitRecord(loaded())])[0], judgement: judgement({ isReal: false, notes: "the guard is present after all" }), context: context() });
    assert.doesNotThrow(() => writeLabels(corrected, { root, itemMeta: META, relabel: true }));
    const read = readFindingLabels(root, CV);
    assert.equal(read.labels.length, 1);
    assert.equal(read.labels[0].is_real, false);
  }));

test("a judgement the schema refuses is reported and NOT written, and the session continues", () =>
  withRoot(async (root) => {
    const { queue } = buildQueue({ records: [loaded({ file: "a.ts", summary: "one" }), loaded({ file: "b.ts", summary: "two" })] });
    // An unexplained is_real/should_verifier_keep divergence: refused by the schema.
    const io = scriptedIo(["y", "minor", "n", "medium", "read a.ts", "", "", "y", "minor", "", "medium", "read b.ts", "", ""]);
    const r = await runSession({ queue, io, write: (l) => writeLabels(l, { root, itemMeta: META }), context: context() });
    assert.equal(r.judged, 1, "the second one still landed");
    assert.ok(io.printed.some((p) => p.includes("not written") && p.includes("diverges from is_real")));
    assert.equal(readFindingLabels(root, CV).labels.length, 1);
  }));

test("a bundle whose item was never frozen refuses rather than writing an unstampable label", () => {
  const [bundle] = bundleCards([admitRecord(loaded())]);
  assert.throws(() => applyJudgement({ bundle, judgement: judgement(), context: context({ itemMeta: new Map() }) }), /no sha256_diff for pr-605/);
});

// --- the interactive contract ------------------------------------------------

test("an ambiguous severity abbreviation re-asks instead of guessing", async () => {
  // `major` and `minor` share a first letter, and the first draft's `v[0] === raw`
  // silently resolved `m` to `major`. A mistyped severity is a wrong label that the
  // gate's own rule then reads.
  const { queue } = buildQueue({ records: [loaded()] });
  const io = scriptedIo(["y", "m", "minor", "", "medium", "read it", "", ""]);
  const r = await runSession({ queue, io, write: null, context: context() });
  assert.equal(r.labels[0].severity, "minor");
  assert.ok(io.printed.some((p) => p.includes("ambiguous") && p.includes("major or minor")));
});

test("the diff is shown on request, for the file under judgement only", async () => {
  const diff = [
    "diff --git a/packages/notes/src/view/editor.ts b/packages/notes/src/view/editor.ts",
    "@@ -1,3 +1,4 @@",
    "+const undoFloor = depth;",
    "diff --git a/unrelated.ts b/unrelated.ts",
    "@@ -1 +1 @@",
    "-secret",
  ].join("\n");
  assert.ok(fileDiffSection(diff, "packages/notes/src/view/editor.ts").includes("undoFloor"));
  assert.ok(!fileDiffSection(diff, "packages/notes/src/view/editor.ts").includes("secret"));
  assert.equal(fileDiffSection(diff, "nothing.ts"), null);
  assert.equal(fileDiffSection(null, "a.ts"), null);

  // A SUBSTRING TEST OVER A PATH SHOWS THE WRONG FILE, which for this tool means judging
  // a claim against code it is not about. `a.ts` is a substring of `data.ts`.
  const near = ["diff --git a/data.ts b/data.ts", "@@ -1 +1 @@", "+const notMine = 1;"].join("\n");
  assert.equal(fileDiffSection(near, "a.ts"), null, "a.ts must not match data.ts");
  assert.ok(fileDiffSection(near, "data.ts").includes("notMine"));
  // Both sides are compared, so a rename still resolves from either path.
  const renamed = ["diff --git a/old/name.ts b/new/name.ts", "similarity index 98%", "@@ -1 +1 @@", "+moved"].join("\n");
  for (const side of ["old/name.ts", "new/name.ts"]) assert.ok(fileDiffSection(renamed, side).includes("moved"), side);
  assert.equal(fileDiffSection(renamed, "name.ts"), null, "a bare basename is not either path");

  const { queue } = buildQueue({ records: [loaded()] });
  const io = scriptedIo(["d", "y", "minor", "", "medium", "read editor.ts:132", "", ""]);
  await runSession({ queue, io, write: null, context: context({ diffFor: () => diff }) });
  assert.ok(io.printed.some((p) => p.includes("+const undoFloor = depth;")));
  assert.ok(!io.printed.some((p) => p.includes("secret")));
});

test("an unrecognised answer prints the help rather than being read as a verdict", async () => {
  const { queue } = buildQueue({ records: [loaded()] });
  const io = scriptedIo(["yes please", "?", "y", "minor", "", "low", "read it", "", ""]);
  const r = await runSession({ queue, io, write: null, context: context() });
  assert.equal(r.judged, 1);
  assert.ok(io.printed.filter((p) => p.includes("real defect in this code")).length >= 2);
});

// --- the item flow -----------------------------------------------------------

test("an item verdict is typed in, and true_defects can name a defect no reviewer found", () =>
  withRoot(async (root) => {
    const io = scriptedIo([
      "y", "packages/notes/src/store/memory.ts", "40-52", "major", "correctness", "the eviction path never clears the index, so a reopened note reads stale rows",
      "n",
      "block", "known-defect", "correctness", "high", "read the diff and ran the memory store tests", "found by reading, not by either reviewer",
    ]);
    const r = await runItemSession({ itemId: "pr-605", io, write: (l) => writeLabels(l, { root, itemMeta: META }), context: context() });
    assert.equal(r.label.verdict_label, "block");
    assert.equal(r.label.true_defects.length, 1);
    assert.deepEqual(r.label.true_defects[0].line_range, [40, 52]);
    assert.equal(r.written.length, 1);
    assert.equal(r.written[0], path.join(root, LABELS_DIR, CV, "pr-605.json"));
    assert.doesNotThrow(() => validateLabel(JSON.parse(readFileSync(r.written[0], "utf8")), { itemMeta: META.get("pr-605") }));
  }));

test("a mistyped line range is re-asked, and a blank one still means 'not line-localizable'", () =>
  withRoot(async (root) => {
    // The two answers were indistinguishable: anything that did not match the pattern
    // was filed as `line_range: null`, which is the same record a blank answer produces
    // — and guide §4.2 treats "not line-localizable" as a real statement, so a dropped
    // location silently becomes one.
    const io = scriptedIo([
      "y", "a.ts", "12", "40..52", "52-40", "40-52", "major", "correctness", "a real blocking defect",
      "y", "b.ts", "", "major", "correctness", "a missing test, which has no single line",
      "n",
      "block", "known-defect", "correctness", "medium", "read both files", "",
    ]);
    const r = await runItemSession({ itemId: "pr-605", io, write: (l) => writeLabels(l, { root, itemMeta: META }), context: context() });
    assert.deepEqual(r.label.true_defects[0].line_range, [40, 52], "the typos were re-asked, not accepted");
    assert.equal(r.label.true_defects[1].line_range, null, "blank still means none");
    // Each rejection said what was wrong, including the reversed range.
    const complaints = io.printed.filter((p) => p.includes("is not a line range"));
    assert.equal(complaints.length, 3);
    assert.ok(complaints.some((p) => p.includes('"52-40"')), "end before start is refused too");
    assert.equal(io.remaining(), 0);
  }));

test("an item verdict that contradicts its own defect set is refused, and nothing is written", () =>
  withRoot(async (root) => {
    // `approve` beside a major defect. Guide §3 calls it a contradiction; V3 would
    // score the disagreement as the panel's error.
    const io = scriptedIo(["y", "a.ts", "", "major", "correctness", "a real blocking defect", "n", "approve", "benign", "medium", "read it", ""]);
    const r = await runItemSession({ itemId: "pr-605", io, write: (l) => writeLabels(l, { root, itemMeta: META }), context: context() });
    assert.equal(r.label, null);
    assert.equal(r.written.length, 0);
    assert.ok(io.printed.some((p) => p.includes("not written") && p.includes("contradiction")));
    assert.ok(!existsSync(path.join(root, LABELS_DIR)));
  }));

// --- the CLI contract --------------------------------------------------------

test("--root is required and has no default, and so is the corpus version", () => {
  const p = resolveOptions({}).problems;
  assert.ok(p.some((m) => m.includes("--root is required and has no default")));
  assert.ok(p.some((m) => m.includes("--corpus-version is required")));
  assert.ok(p.some((m) => m.includes("one of --records or --run is required")));
  assert.deepEqual(resolveOptions({ root: "/r", "corpus-version": CV, run: "r1", annotator: "dlgpdmsly2" }).problems, []);
});

test("EVERY session must name the annotator, not only a writing one", () => {
  // `--write` is absent by default, so the common first invocation is a preview — and a
  // preview with no annotator built `annotators: []`, which the schema refuses. The
  // refusal is caught per judgement and printed, so the session asked every question in
  // the queue and discarded every answer. Requiring it up front costs one flag.
  const base = { root: "/r", "corpus-version": CV, run: "r1" };
  for (const args of [base, { ...base, write: true }]) {
    assert.ok(resolveOptions(args).problems.some((m) => m.includes("--annotator is required")), JSON.stringify(args));
  }
  // `--json` prints the queue and returns without asking anything, so it is exempt.
  assert.deepEqual(resolveOptions({ ...base, json: true }).problems, []);
  assert.deepEqual(resolveOptions({ ...base, annotator: "dlgpdmsly2" }).problems, []);
});

test("a model read cannot claim gold, and the tiers come from the schema's own vocabulary", () => {
  const base = { root: "/r", "corpus-version": CV, run: "r1", annotator: "dlgpdmsly2" };
  assert.equal(resolveOptions({ ...base, mode: "model" }).labelSource, "silver");
  assert.equal(resolveOptions(base).labelSource, "gold");
  // `distant` is a real `LABEL_SOURCES` value and deliberately not one this CLI offers:
  // it means a label inferred with no per-item reading, and reading is all this does.
  assert.ok(LABEL_SOURCES.includes("distant"));
  assert.ok(resolveOptions({ ...base, "label-source": "distant" }).problems.some((m) => m.includes("distant")));
  // Derived from the vocabulary rather than a second copy of it, so a tier added to the
  // schema cannot be silently rejected here.
  for (const mode of ADJUDICATION_MODES) assert.deepEqual(resolveOptions({ ...base, mode }).problems, []);
  assert.ok(resolveOptions({ ...base, mode: "committee" }).problems.some((m) => m.includes("--mode must be one of")));
});

test("every replicate belongs in one invocation, so --run takes a list", () => {
  assert.deepEqual(resolveOptions({ root: "/r", "corpus-version": CV, run: "a__k1,a__k2,a__k3" }).runs, ["a__k1", "a__k2", "a__k3"]);
  assert.ok(resolveOptions({ root: "/r", "corpus-version": CV, run: "a", records: "f.json" }).problems.some((m) => m.includes("two sources")));
  assert.ok(resolveOptions({ root: "/r", "corpus-version": CV, run: ",", }).problems.some((m) => m.includes("names no run id")));
});

test("--limit and --arm are checked before anything is read", () => {
  assert.ok(resolveOptions({ root: "/r", "corpus-version": CV, run: "r", limit: "0" }).problems.some((m) => m.includes("--limit must be a positive integer")));
  assert.ok(resolveOptions({ root: "/r", "corpus-version": CV, run: "r", limit: "1.5" }).problems.some((m) => m.includes("--limit must be a positive integer")));
  assert.ok(resolveOptions({ root: "/r", "corpus-version": CV, run: "r", arm: "human" }).problems.some((m) => m.includes("--arm must be one of")));
  assert.deepEqual(resolveOptions({ root: "/r", "corpus-version": CV, run: "r", limit: "5" }).limit, 5);
});

test("the parser vintage names the module whose output a coderabbit key hashes", () => {
  const v = harvestVintage();
  assert.match(v, /^harvest\.mjs@sha256:[0-9a-f]{64}$/);
  // Unreadable → null, and the CodeRabbit write path then refuses rather than storing
  // a label whose key cannot be told from a current one.
  assert.equal(harvestVintage(path.join(tmpdir(), `no-such-agent-dir-${process.pid}`)), null);
});
