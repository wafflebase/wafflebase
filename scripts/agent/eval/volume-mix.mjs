// The first comparative NUMBERS: volume, severity mix, nit ratio, localisation,
// scope discipline and restatement, over finding records from both arms.
//
// Spec §3.1 and the one §3.5 row that needs no cross-arm matching. Six metrics,
// exactly the six those sections name; nothing else belongs here, because a
// metric nobody specified is a metric nobody agreed to read.
//
// EVERYTHING BEFORE THIS FILE WAS PLUMBING, WHERE A BUG SHOWS UP AS A FAILURE.
// Here a bug shows up as a RESULT — plausible, well-formatted, wrong, and nothing
// goes red. So the design rule throughout is: for every number, know what its
// denominator is and what is missing from it. Concretely, three habits:
//
//   1. `proportion()` everywhere, and it returns `ratio: null` at n=0 rather than
//      0. A blank cell is readable; a confident 0.000 over nothing is not.
//   2. Absent is never pooled with zero. Each of the six metrics has a named
//      vocabulary whose middle values say "we could not tell" and "the question
//      does not apply", for the reason `GATING` has four values and not two.
//   3. Where a rule cannot be checked, the guard REFUSES rather than assumes —
//      `assertOnePopulation`, `assertComparableWindow`, `assertOneRunPerItem`,
//      `assertRunMatchesCorpus`. A scorer that cannot state its denominator must
//      not emit a number, and each of those four is a subset this project has
//      already been quietly scored over once.
//
// WHAT THIS FILE DELIBERATELY DOES NOT DO. No labels, no adjudication, no ground
// truth, and therefore no precision, recall or F1 — those are Wave 5's and they
// are what makes this shippable today. No cross-arm matching either: overlap,
// unique-to-arm and severity agreement all need `finding-match.mjs`'s looser
// notion of "the same defect, said differently", and that is the complementarity
// scorer's job. Restatement is in here because it is the one §3.5 row that is
// answerable WITHIN one arm, off the record's own exact `finding_key`.
//
// NOTHING IS WRITTEN AND NOTHING IS SPENT. It reads a store, computes, prints.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { KNOWN } from "../severity.mjs";
import { changedFilesFromDiff } from "./extract-corpus.mjs";
import { GATING_BASIS, POPULATIONS, gatingCensus } from "./finding-record.mjs";
import { SEVERITY_BASIS, WINDOW } from "./adapters/coderabbit.mjs";
import { parseArgs } from "../gh-checks.mjs";

const refuse = (msg) => {
  throw new Error(`volume & mix: ${msg}`);
};

/** Bumped when a field changes meaning, never when one is added — the same rule
 *  `finding-record.mjs` states, and for the same reason: every reader downstream
 *  is additive. */
export const SCHEMA_VERSION = 1;

/**
 * A string this file needs BY VALUE, checked against the module that owns the
 * vocabulary — at import time, so a rename upstream stops the scorer loading
 * instead of silently disarming one of its guards.
 *
 * This is lesson 7 applied to a literal rather than to a field: `assertEffort`
 * failed not because its rule was wrong but because its INPUT stopped arriving,
 * and a guard that greps for `"after-window"` after somebody renames that value
 * fails exactly the same way — it never fires, it never complains, and the number
 * it was protecting quietly starts pooling two corpora. Exported so a test can
 * prove it throws, because a check nothing can prove fires is decoration.
 */
export function pin(value, vocabulary, what) {
  if (!(Array.isArray(vocabulary) ? vocabulary : Object.keys(vocabulary ?? {})).includes(value)) {
    refuse(
      `${what} is ${JSON.stringify(value)}, which is no longer in the vocabulary that owns it — ` +
        `this file compares against that literal, so a renamed value would leave the check running and never firing`,
    );
  }
  return value;
}

/** The `window` value our arm never saw the code for. Only `in-window`,
 *  `unplaceable` and `no-window` may be scored; see `assertComparableWindow`. */
const AFTER_WINDOW = pin("after-window", WINDOW, "the after-window marker");
/** CodeRabbit's severity FLOOR marker — a default indistinguishable from a
 *  measurement is what `SEVERITY_BASIS` exists to make visible. */
const UNSTATED = pin("unstated", SEVERITY_BASIS, "the unstated-severity basis");
/** The basis every record from an arm with no merge gate carries. */
const NO_GATE_IN_ARM = pin("no-gate-in-arm", GATING_BASIS, "the no-gate-in-arm basis");

/**
 * WHICH GATE a segment's numbers are about, and why this is a segment key rather
 * than a field.
 *
 * A gate-off replay reads `gating: "gates"` for every blocking finding — true of
 * that replay, and misleading about the shipped gate, because the novelty gate
 * could not demote anything it never ran on. Pooling a gate-off run with a
 * gate-on one therefore produces a blocking population that is a property of the
 * harness rather than of the reviewer, and the store now genuinely holds both
 * (`adapters/panel.mjs`: envelopes written before the fidelity PR read gate-off).
 * So `gate_state` partitions the output and there is no code path that adds two
 * segments together.
 *
 * The two absences are kept apart for the reason `GATING` separates
 * `not-applicable` from `unknown`:
 *
 *   no-gate-in-arm         CodeRabbit has no merge gate. Not uncertainty.
 *   gate-state-unrecorded  our arm, and the envelope predates `gate.state`. That
 *                          IS uncertainty, and pooling it with a known-on run
 *                          would make "how much of our data has a known gate?"
 *                          scale with the other arm's size.
 */
export const GATE_SEGMENTS = Object.freeze({ noGateInArm: NO_GATE_IN_ARM, unrecorded: "gate-state-unrecorded" });

/**
 * Does the citation point at something we can find? Spec §3.1's "% of findings
 * citing a file **and** line that actually resolves".
 *
 * THREE values, and the third is the one that keeps this number honest:
 *
 *   resolved      it cites a file the frozen diff touches, and a line.
 *   unresolved    it cites no file, or no line. A definite failure to localise.
 *   unresolvable  it cites a path the frozen diff does not touch, so THIS STORE
 *                 CANNOT CHECK IT. A corpus item holds the diff, the changed-file
 *                 list and the metadata — not the tree — so a citation into
 *                 untouched code names a file that may well exist and cannot be
 *                 confirmed from here.
 *
 * Filing `unresolvable` under `unresolved` would report our inability to check as
 * the reviewer's failure to cite, which is a number about the corpus wearing a
 * label about the reviewer. Measured on the pilot: 0 of 39 records land there, so
 * today the distinction costs nothing and is the difference between a rate that
 * stays true when a lens cites `packages/…` and one that quietly does not.
 */
export const LOCALIZATION = Object.freeze(["resolved", "unresolved", "unresolvable"]);

/**
 * WHY the `localization` value is what it is — cause → answer, frozen so the two
 * can never be stated independently and disagree. Same construction as
 * `GATING_BASIS` and `WINDOW_BASIS`, for the same reason.
 *
 * ORDERING IS LOAD-BEARING, and it is `gatingOf`'s: the CERTAIN disqualifiers are
 * tested before the checkable ones. A record with no line and a file outside the
 * diff is `no-line` — a fact — rather than `file-not-in-item`, which is only our
 * inability to look.
 */
export const LOCALIZATION_BASIS = Object.freeze({
  /** Cites a path the frozen diff touches, plus a positive line number. */
  "file-and-line-in-item": "resolved",
  /** No file at all. `findingKey` tolerates it, so it reaches here. */
  "no-file": "unresolved",
  /** A file and no line — including the case where the panel's own
   *  `findingLocation` could not mine one out of the evidence. */
  "no-line": "unresolved",
  /** A path the frozen diff does not touch. Not checkable from a corpus item. */
  "file-not-in-item": "unresolvable",
  /** The item is not in the corpus version being scored, or its diff would not
   *  read — so no citation on it can be checked either way. */
  "item-unavailable": "unresolvable",
});

/**
 * Is the finding anchored INSIDE the diff, or in untouched code? Spec §3.1's
 * scope discipline.
 *
 * Computed from the ONE input both arms were given — the frozen diff's hunks —
 * and deliberately NOT from `novelty.origin`, which would have been easier and is
 * wrong twice over: `annotateFindings` stamps novelty only on critical/major, so
 * two thirds of the pilot's panel findings carry none, and CodeRabbit records have
 * no such field at all, so the metric would not be comparable across arms. The
 * novelty annotation is used as a CHECK on this rule instead — where both exist
 * they agree 4/4 on the pilot, which is what a test pins.
 *
 * The post-image is what is compared, because that is the code as reviewed. A
 * pure-deletion hunk contributes no post-image line and a finding cannot be
 * inside it.
 *
 * `in-diff` MEANS "IN A CHANGED REGION", NOT "ON A CHANGED LINE" — a hunk's
 * post-image range includes the context lines git prints around the change, and a
 * reviewer was shown those. Counting only `+` lines would score the two arms
 * differently for a reason that is about diff formatting rather than about either
 * reviewer, since an inline comment can be posted on a context line.
 *
 * The cost of that choice is measured rather than assumed. Across the 7-item
 * pilot, 36 of our arm's 142 findings carry the novelty origin git computed during
 * the replay; **33 of the 35 comparable pairs agree with this rule**, and both
 * disagreements are findings anchored on a context line inside a hunk —
 * `pre-existing` to git, `in-diff` here. Neither answer is wrong: "which line did
 * this change introduce?" is `novelty.mjs`'s question, not this one's.
 */
export const SCOPE = Object.freeze(["in-diff", "outside-diff", "unknown"]);

/**
 * WHY the `scope` value is what it is.
 *
 * `file-not-in-item` reads `outside-diff` HERE while the same record reads
 * `unresolvable` for localisation, and the asymmetry is deliberate rather than an
 * inconsistency: the two metrics ask different questions of one record. "Is this
 * anchored inside the diff?" is answerable — a path the diff does not touch is
 * certainly not inside it, whether the path exists or was hallucinated. "Does the
 * citation resolve?" is not answerable without the tree. Each answer is sound for
 * its own question, and a reviewer who reads both columns should see this row
 * differ between them.
 */
export const SCOPE_BASIS = Object.freeze({
  /** The cited line falls in a hunk's post-image range. */
  "line-in-hunk": "in-diff",
  /** It falls in the file, outside every hunk — untouched code. */
  "line-outside-hunks": "outside-diff",
  /** The cited path is not in the frozen diff at all, so nothing about it was
   *  touched by the change under review. */
  "file-not-in-item": "outside-diff",
  /** No file cited: nothing to place. */
  "no-file": "unknown",
  /** A file and no line: the file was touched, but "which hunk" has no answer,
   *  and reading a file-level citation as in-diff would count a finding about
   *  line 900 of a file whose only hunk is at 10 as scope-disciplined. */
  "no-line": "unknown",
  /** The frozen diff gives this file NO post-image lines, so there is no range a
   *  citation could be inside. TWO causes, and the name is neutral between them
   *  on purpose: the diff deletes the file (the cited line is about code the
   *  change removed), or it renames it / changes its mode with no content hunk (the
   *  line exists in the tree and the diff does not show it). Same answer, because
   *  both need the tree this store does not hold — but reading either as
   *  `outside-diff` would count a finding about deleted code as a scope failure. */
  "file-has-no-post-image": "unknown",
  /** The item is not in the corpus version being scored, or its diff would not read. */
  "item-unavailable": "unknown",
});

/**
 * Does this finding repeat one from an EARLIER ROUND of the same pull request?
 * Spec §3.5's restatement rate.
 *
 * A ROUND IS NOT A REPLICATE, and conflating them is the trap this vocabulary is
 * shaped around. K replicates of one item are K independent tries at the SAME
 * snapshot — that is reliability (§3.2) and a different scorer — whereas a round
 * is a fresh review after the author pushed. `run_id` therefore never acts as a
 * round key here, and `eval/README.md` states the consequence for our arm
 * outright: "an item replays one pass: no multi-round fix loop and no
 * prior-findings recheck, so round-to-round behaviour is out of scope".
 *
 * FIVE values, and the last two exist because the pilot lands entirely on them:
 *
 *   restated                 we OBSERVED the same `finding_key` in an earlier round.
 *   restated-per-arm-label   the arm says so itself (CodeRabbit's ♻️ Duplicate
 *                            tier) and we did not observe the earlier round. Kept
 *                            apart from `restated` rather than pooled: one is our
 *                            measurement, the other is the other arm's claim, and
 *                            `adapters/coderabbit.mjs`'s standing rule is to
 *                            record the fact and let the scorer choose.
 *   not-restated             there were earlier rounds and this is not in them.
 *   not-applicable           there is nothing an earlier round could be — see the
 *                            two bases. NOT zero. Reporting "restatement 0%" for a
 *                            corpus with one round per item is a confident wrong
 *                            number, and it is what the pilot would print.
 *   unknown                  rounds exist on this item and this record does not
 *                            say which one it is from.
 */
export const RESTATEMENT = Object.freeze(["restated", "restated-per-arm-label", "not-restated", "not-applicable", "unknown"]);

/** WHY the `restatement` value is what it is. Ordering is load-bearing — see
 *  `restatementsOf`, which tests our own observation before the arm's label and
 *  the arm's label before "there was only one round", so a finding CodeRabbit
 *  itself calls a duplicate is never filed as not-applicable. */
export const RESTATEMENT_BASIS = Object.freeze({
  /** The key appeared in a round that closed earlier. */
  "repeats-earlier-round": "restated",
  /** The arm filed it under its own duplicate tier. */
  "arm-duplicate-tier": "restated-per-arm-label",
  /** Rounds exist, earlier ones do not hold this key. */
  "first-statement": "not-restated",
  /** This arm records no rounds AT ALL — our replay of one frozen snapshot. A
   *  different absence from `single-round`, which is a fact about the item. */
  "arm-records-no-rounds": "not-applicable",
  /** The arm has rounds and this item had exactly one, so no finding on it can
   *  repeat an earlier one. */
  "single-round": "not-applicable",
  /** The item has several rounds and this record carries no round id. */
  "round-unrecorded": "unknown",
});

/**
 * The arm's OWN marker for "this repeats something I already said", by arm.
 *
 * `"duplicate"` is `harvest.mjs`'s `CR_TIERS` value and that table is private, so
 * this is the one string this module re-types — the same situation
 * `codeRabbitItemId` documents for `pr-<n>`, and it takes the same remedy: a test
 * pins it by running `parseCodeRabbitReview` over a ♻️ Duplicate section and
 * asserting the tier it returns equals this, so the duplication cannot drift in
 * silence. The alternative was exporting a constant out of `harvest.mjs`, a
 * merged file with live consumers that this change has no other reason to touch.
 *
 * Our arm has NO entry, and that is a statement rather than an omission. The
 * panel's `mergedFrom` marks WITHIN-round restatement clustering — two wordings of
 * one defect in a single pass, which `clusterCounts` already tallies — and reading
 * it as cross-round restatement would report the same word for a different number,
 * this project's signature failure.
 */
export const ARM_RESTATEMENT_TIER = Object.freeze({ coderabbit: "duplicate" });

/**
 * A count over a denominator, and the ONLY way this file emits a share.
 *
 * `ratio` is `null` at n=0, never 0. The house rule is that every proportion
 * carries its `n`; the reason it is a rule is that `0/0 → 0.000` is the shape a
 * blank cell takes when nobody wrote this function, and it reads as a measurement
 * of a reviewer that produced nothing.
 */
export function proportion(k, n) {
  return { k, n, ratio: n > 0 ? k / n : null };
}

/** Median of the finite values, or `null` for none. The house summary for a
 *  per-PR distribution: spec §4.1 quotes medians ("our panel posts a median of 30
 *  findings per PR against CodeRabbit's 2") because a mean over 7 items whose
 *  sizes span 22 to 1004 diff lines is dominated by the largest. */
export function median(values) {
  const xs = [...(Array.isArray(values) ? values : [])].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = xs.length >> 1;
  return xs.length % 2 === 1 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}

/** `{ min, median, max, mean, n }` over a per-item series, every field `null` at
 *  n=0. The distribution is reported instead of one pooled number because §4.1
 *  measured what pooling costs: findings-per-PR is a PR-denominated metric and
 *  the pilot's items differ in size by 45×. */
export function distribution(values) {
  const xs = [...(Array.isArray(values) ? values : [])].filter((v) => Number.isFinite(v));
  if (xs.length === 0) return { n: 0, min: null, median: null, max: null, mean: null };
  return {
    n: xs.length,
    min: Math.min(...xs),
    median: median(xs),
    max: Math.max(...xs),
    mean: xs.reduce((a, b) => a + b, 0) / xs.length,
  };
}

const normPath = (p) => (typeof p === "string" ? p.trim().replace(/^\.\//, "").replace(/^\/+/, "") : "");

/**
 * The frozen diff's shape, per corpus item: how many lines it changed and which
 * post-image line ranges each file contributes.
 *
 * `diff_lines` comes from `meta.additions` + `meta.deletions` rather than being
 * recounted, because `diffLineCounts` already froze that answer at extraction and
 * a second count beside it is how `scope`'s denominator and the manifest's would
 * come to disagree. The hunk RANGES have no upstream reader, so they are parsed
 * here — and the parse is checked against `changedFilesFromDiff`, the module that
 * owns "which files does this diff touch". A file this parser missed would make
 * every finding on it read `file-not-in-item`, which silently moves records from
 * `in-diff` to `outside-diff` and makes our arm look undisciplined. So the
 * mismatch REFUSES, and the whole item goes unscored rather than half-scored.
 *
 * ONE KNOWN CASE REFUSES RATHER THAN WORKS, deliberately: a C-QUOTED path
 * (`+++ "b/na\303\257ve.ts"`, which git emits for a non-ASCII filename when
 * `core.quotePath` is on). `changedFilesFromDiff` unquotes it and this parser does
 * not, because the two helpers that do — `stripDiffPathPrefix` and
 * `unquoteGitPath` — are private to `extract-corpus.mjs`. The guard above catches
 * it as an invented path and names the item. That is the correct failure
 * direction, and it is a refusal to score rather than a wrong score; the fix is to
 * export those two helpers, which is a change to a merged module this PR has no
 * other reason to touch. No pilot item has such a path.
 */
export function itemGeometry(itemId, { meta, diff } = {}) {
  const text = typeof diff === "string" ? diff : "";
  const files = new Map();
  const ensure = (p, postImage) => {
    const key = normPath(p);
    if (!key) return null;
    const got = files.get(key) ?? { post_image: false, ranges: [] };
    got.post_image = got.post_image || postImage;
    files.set(key, got);
    return got;
  };
  let current = null;
  let headerPath = null;
  for (const line of text.split("\n")) {
    let m = /^diff --git (?:"a\/[^"]*" "b\/(.+)"|a\/.+ b\/(.+))$/.exec(line);
    if (m) {
      headerPath = m[1] ?? m[2];
      // Registered HERE, with no post-image yet, because a file block does not
      // have to contain a `+++` line at all: a pure rename or a mode change emits
      // the header, `similarity index`, `rename from/to` and nothing else.
      // `changedFilesFromDiff` counts those files off this same header, so
      // registering them only on `+++` made the two disagree and the guard below
      // refused the whole item — found by mutation-testing the density guard,
      // which is what a rename-only diff reaches. A `+++ b/<path>` line upgrades
      // this entry; `+++ /dev/null` leaves it as it is.
      ensure(headerPath, false);
      current = null;
      continue;
    }
    m = /^\+\+\+ (.+)$/.exec(line);
    if (m) {
      const raw = m[1];
      if (raw === "/dev/null") {
        // A deletion. The file IS part of the item and it has no post-image, so a
        // citation on it cannot be placed on either side of a hunk boundary.
        ensure(headerPath, false);
        current = null;
      } else {
        current = ensure(raw.replace(/^b\//, ""), true);
      }
      continue;
    }
    if (!current) continue;
    m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (m) {
      const start = Number(m[1]);
      const count = m[2] === undefined ? 1 : Number(m[2]);
      // `+c,0` is a pure-deletion hunk: it contributes no post-image line, so it
      // is not a range a finding can be inside.
      if (count > 0 && Number.isInteger(start) && start >= 1) current.ranges.push([start, start + count - 1]);
    }
  }
  // The guard, not a formality: these two are one fact derived two ways.
  const owned = new Set(changedFilesFromDiff(text).map(normPath));
  const mine = new Set(files.keys());
  const missing = [...owned].filter((p) => !mine.has(p));
  const extra = [...mine].filter((p) => !owned.has(p));
  if (missing.length || extra.length) {
    refuse(
      `${itemId}: the hunk parse and changedFilesFromDiff disagree about which files the frozen diff touches` +
        (missing.length ? ` — missed: ${missing.join(", ")}` : "") +
        (extra.length ? ` — invented: ${extra.join(", ")}` : "") +
        `. Every finding on a missed file would read file-not-in-item, which moves it from in-diff to outside-diff`,
    );
  }
  const additions = Number.isFinite(meta?.additions) ? meta.additions : null;
  const deletions = Number.isFinite(meta?.deletions) ? meta.deletions : null;
  return {
    item_id: itemId,
    additions,
    deletions,
    // `null`, not 0: an item whose meta would not read has an UNKNOWN size, and a
    // density of `findings / 0` is either Infinity or a silent skip.
    diff_lines: additions === null || deletions === null ? null : additions + deletions,
    files,
  };
}

/** Where the record's citation sits, per `LOCALIZATION_BASIS`. Pure. */
export function localizationOf(record, geometry) {
  const basis = (b) => ({ localization: LOCALIZATION_BASIS[b], localization_basis: b });
  const file = normPath(record?.file);
  if (file === "") return basis("no-file");
  if (!(Number.isInteger(record?.line) && record.line >= 1)) return basis("no-line");
  if (!geometry) return basis("item-unavailable");
  if (!geometry.files.has(file)) return basis("file-not-in-item");
  return basis("file-and-line-in-item");
}

/** Whether the record is anchored inside the frozen diff, per `SCOPE_BASIS`. Pure. */
export function scopeOf(record, geometry) {
  const basis = (b) => ({ scope: SCOPE_BASIS[b], scope_basis: b });
  const file = normPath(record?.file);
  if (file === "") return basis("no-file");
  if (!geometry) return basis("item-unavailable");
  const f = geometry.files.get(file);
  if (!f) return basis("file-not-in-item");
  if (!(Number.isInteger(record?.line) && record.line >= 1)) return basis("no-line");
  if (!f.post_image) return basis("file-has-no-post-image");
  return basis(f.ranges.some(([a, b]) => record.line >= a && record.line <= b) ? "line-in-hunk" : "line-outside-hunks");
}

/**
 * Which review ROUND a record came from, and `null` for an arm that records none.
 *
 * CodeRabbit's rounds are real and ordered: every finding — inline or nested in a
 * review body — carries the `review_id` of the review that posted it, plus the
 * timestamp that orders them. Our arm's replay has no rounds at all, and
 * `run_id` is deliberately not substituted: see `RESTATEMENT`.
 */
export function roundOf(record) {
  if (record?.arm !== "coderabbit") return null;
  const id = record?.coderabbit?.review_id;
  if (!(typeof id === "string" && id.trim() !== "")) return null;
  return { key: id, at: typeof record?.coderabbit?.posted_at === "string" ? record.coderabbit.posted_at : "" };
}

/**
 * Restatement for every record of ONE item and ONE arm, in the input's order.
 *
 * Takes the whole item because the answer is not a property of a record: it
 * depends on which rounds closed before this one. Returns a parallel array, and
 * mutates nothing (decision 7).
 *
 * IDENTITY, NOT SIMILARITY. Two rounds "hold the same finding" when their exact
 * `finding_key` matches — the panel's own key, so this number agrees with
 * `dedupeFindings` — which means a defect REWORDED between rounds counts as new
 * and this rate reads LOW. That limit is documented on the record itself and the
 * looser rule that fixes it is the cross-arm matcher's, applied for a different
 * job. A second, looser key in here would make our numbers quietly stop matching
 * the panel's.
 *
 * ORDER OF THE TESTS IS THE DESIGN. Our own observation beats the arm's label
 * (stronger evidence, and it cannot be gamed by a tier name), and the label beats
 * `single-round` (a finding CodeRabbit itself calls a duplicate must never be
 * filed as "nothing could have been restated").
 */
export function restatementsOf(records) {
  const rs = Array.isArray(records) ? records : [];
  const basis = (b) => ({ restatement: RESTATEMENT_BASIS[b], restatement_basis: b });
  const rounds = new Map();
  for (const r of rs) {
    const round = roundOf(r);
    if (!round) continue;
    if (!rounds.has(round.key)) rounds.set(round.key, { at: round.at, keys: new Set() });
    rounds.get(round.key).keys.add(r.finding_key);
  }
  // Ordered by when the round was posted, with the id as the tie-break so the
  // order is total and does not depend on iteration luck.
  const order = [...rounds.entries()].sort((a, b) => String(a[1].at).localeCompare(String(b[1].at)) || String(a[0]).localeCompare(String(b[0])));
  const seenBefore = new Map(); // round key → keys held by every EARLIER round
  const running = new Set();
  for (const [key, round] of order) {
    seenBefore.set(key, new Set(running));
    for (const k of round.keys) running.add(k);
  }
  return rs.map((r) => {
    const round = roundOf(r);
    if (r?.arm !== "coderabbit") return basis("arm-records-no-rounds");
    if (round && seenBefore.get(round.key)?.has(r.finding_key)) return basis("repeats-earlier-round");
    if (typeof r?.coderabbit?.tier === "string" && r.coderabbit.tier === ARM_RESTATEMENT_TIER.coderabbit) return basis("arm-duplicate-tier");
    if (order.length === 1) return basis("single-round");
    if (!round) return basis("round-unrecorded");
    return basis("first-statement");
  });
}

/**
 * Did the reviewer STATE this severity, or is the record carrying a floor?
 *
 * Two arms, two rules, and there is no arm-agnostic one available: `severity_raw`
 * is equal to `severity` on every CodeRabbit record by construction — both are
 * derived from the single `severity` the adapter hands the builder, which the
 * adapter has already translated — and `finding-record.mjs` says so in place. So
 * the other arm's floor is only visible through `coderabbit.severity_basis`.
 *
 * OUR ARM HAS A FLOOR TOO, and it is easy to miss because nothing names it:
 * `normalizeSeverity` maps anything it does not recognise to `major`, which is
 * BLOCKING. A lens emitting `"moderate"` therefore lands in the blocking
 * population with `severity_raw: "moderate"` as the only trace, so that is what
 * this reads. Measured on the pilot: 9 of 9 panel records state a known severity,
 * so the branch is a guard rather than a correction today.
 */
export function severityIsStated(record) {
  if (record?.arm === "coderabbit") return record?.coderabbit?.severity_basis !== UNSTATED;
  return KNOWN.includes(String(record?.severity_raw ?? "").toLowerCase().trim());
}

const tally = (values) => {
  const o = {};
  for (const v of values) o[v] = (o[v] ?? 0) + 1;
  return o;
};

const countsByKnown = (records) => Object.fromEntries(KNOWN.map((s) => [s, records.filter((r) => r.severity === s).length]));

/**
 * Severity mix and nit ratio, over ONE population of records.
 *
 * STATED AND UNSTATED ARE NEVER POOLED, which is `SEVERITY_BASIS`'s own standing
 * instruction: "no severity-segmented number may pool an `unstated` record with a
 * stated one". The mix over stated records is the headline; the unstated block
 * sits beside it with its own `n` so the exclusion is a number rather than a
 * silence. On the pilot the unstated block is empty (30 of 30 CodeRabbit records
 * carry a header-field severity) — which is a fact about those seven pull
 * requests, not about the arm: 389 of its 3001 findings repository-wide state no
 * severity anywhere.
 *
 * `share` is `null` at n=0 rather than an object of zeros, so a consumer cannot
 * render a mix for a population that has none.
 */
export function severityMix(records) {
  const rs = Array.isArray(records) ? records : [];
  const split = { stated: [], unstated: [] };
  for (const r of rs) split[severityIsStated(r) ? "stated" : "unstated"].push(r);
  const block = (group) => {
    const counts = countsByKnown(group);
    return {
      n: group.length,
      counts,
      share: group.length === 0 ? null : Object.fromEntries(KNOWN.map((s) => [s, counts[s] / group.length])),
      // §3.1: "Share of findings that are `nit` or `minor`". A reviewer that
      // mostly produces nits is a different product from one that mostly produces
      // blockers, so this is the metric the mix exists to support.
      nit_ratio: proportion(counts.nit + counts.minor, group.length),
    };
  };
  return { n: rs.length, stated: block(split.stated), unstated: block(split.unstated) };
}

/** A census over a `*_BASIS` map's answers: `{ <answer>: n }` for every declared
 *  answer including the zeros, plus the basis breakdown. The zeros are printed
 *  because "no unresolvable citations" and "we never looked" are different facts.
 */
function censusOf(values, bases, vocabulary) {
  return {
    n: values.length,
    counts: { ...Object.fromEntries(vocabulary.map((v) => [v, 0])), ...tally(values) },
    basis: tally(bases),
  };
}

/**
 * One item, one arm: every §3.1/§3.5 metric this PR owns, plus what is missing
 * from each.
 *
 * `poolable` is the item's own verdict on itself and it is computed, not assumed —
 * decision 8: `status: "ok"` means exactly one thing, that this item is a real
 * verdict. An `error` item is NOT a zero; in a precision metric a false clean
 * review is a perfect score. And `population_state: "absent"` is a third
 * exclusion, because `adapters/reviewer.mjs` writes `findings: null` on purpose so
 * that "nothing was found" is not spellable by a missing file.
 */
export function scoreItem({ arm, item_id, records = [], geometry = null, population_state = "present", item_status = null, item_reason = null, dropped = [] } = {}) {
  const rs = Array.isArray(records) ? records : [];
  const locs = rs.map((r) => localizationOf(r, geometry));
  const scopes = rs.map((r) => scopeOf(r, geometry));
  const rests = restatementsOf(rs);
  const exclusions = [];
  if (population_state !== "present") exclusions.push(`population-${population_state}`);
  if (item_status !== null && item_status !== "ok") exclusions.push(`item-status-${item_status}`);
  if (arm === "panel" && item_status === null) {
    // Fails toward EXCLUSION. A panel item whose envelope status nobody supplied
    // could be an `error` item with zero findings, which is indistinguishable
    // from a clean review at the record level — see the task doc's finding on
    // `panelRecords`' return shape.
    exclusions.push("item-status-unknown");
  }
  const lines = geometry?.diff_lines ?? null;
  return {
    arm,
    item_id,
    run_id: rs.find((r) => typeof r.run_id === "string")?.run_id ?? null,
    poolable: exclusions.length === 0,
    exclusions,
    item_status,
    item_reason,
    population_state,
    dropped: Array.isArray(dropped) ? dropped.length : 0,
    findings: rs.length,
    diff_lines: lines,
    // §3.1 "Findings per 100 diff lines" — `null`, never 0, when the size is
    // unknown, so a missing item cannot read as an infinitely careful reviewer.
    per_100_diff_lines: lines === null || lines === 0 ? null : (rs.length / lines) * 100,
    severity: severityMix(rs),
    localization: {
      ...censusOf(locs.map((l) => l.localization), locs.map((l) => l.localization_basis), LOCALIZATION),
      // §3.1's rate. The denominator is EVERY finding, including the ones we
      // could not check — a rate over "the checkable ones" would rise as our
      // ability to check fell.
      rate: proportion(locs.filter((l) => l.localization === "resolved").length, rs.length),
    },
    scope: {
      ...censusOf(scopes.map((s) => s.scope), scopes.map((s) => s.scope_basis), SCOPE),
      rate: proportion(scopes.filter((s) => s.scope === "in-diff").length, rs.length),
    },
    restatement: {
      ...censusOf(rests.map((r) => r.restatement), rests.map((r) => r.restatement_basis), RESTATEMENT),
      // The denominator EXCLUDES `not-applicable`, and that is the whole point of
      // this metric having a vocabulary: on a corpus with one round per item the
      // rate is `null` with n=0, not 0%. A scorer that printed 0% here would be
      // reporting "neither reviewer repeats itself" about data in which neither
      // reviewer was ever asked twice.
      rate: (() => {
        const applicable = rests.filter((r) => r.restatement !== "not-applicable");
        return proportion(applicable.filter((r) => r.restatement === "restated").length, applicable.length);
      })(),
    },
    gating: gatingCensus(rs),
    // Which snapshot each finding was about. Our arm has no `window` field, so
    // this stays empty for it rather than being defaulted to something.
    window: tally(rs.map((r) => r.coderabbit?.window).filter((w) => typeof w === "string")),
  };
}

/** Sum two `proportion`s' parts. Pooling over FINDINGS is legitimate — every
 *  finding is one observation — which is why this exists for the finding-
 *  denominated metrics and why nothing like it exists for the per-PR ones. */
const poolProportions = (parts) => proportion(parts.reduce((a, p) => a + p.k, 0), parts.reduce((a, p) => a + p.n, 0));

/**
 * One arm, one `gate_state`: the per-item rows and the arm-level summary.
 *
 * THE TWO CURRENCIES ARE KEPT APART, per spec §4.1, because they give opposite
 * answers and this is the file where that stops being a caveat and becomes a
 * shape. Findings-denominated metrics (severity mix, nit ratio, localisation,
 * scope, restatement) pool over findings and carry one `n`. PR-denominated ones
 * (findings per PR, findings per 100 lines) do NOT pool: they are reported as a
 * distribution over items, plus — for density only — an explicitly named
 * `pooled` figure, because Σfindings/Σlines and the median of the per-item rates
 * are different numbers and quoting either one unlabelled is how a reader gets
 * the wrong one.
 */
function summarizeArm(items) {
  const poolable = items.filter((it) => it.poolable);
  const findings = poolable.reduce((a, it) => a + it.findings, 0);
  const lines = poolable.map((it) => it.diff_lines).filter((v) => Number.isFinite(v));
  const totalLines = lines.reduce((a, b) => a + b, 0);
  return {
    items_scored: poolable.length,
    items_excluded: items.filter((it) => !it.poolable).map((it) => ({ item_id: it.item_id, exclusions: it.exclusions, item_reason: it.item_reason })),
    findings,
    findings_per_item: distribution(poolable.map((it) => it.findings)),
    per_100_diff_lines: {
      // Dominated by the largest item, and named so nobody reads it as typical:
      // the pilot's items span 22 to 1004 frozen diff lines.
      pooled: totalLines > 0 ? (findings / totalLines) * 100 : null,
      pooled_diff_lines: totalLines,
      per_item: distribution(poolable.map((it) => it.per_100_diff_lines).filter((v) => v !== null)),
    },
    severity: severityMixOf(poolable),
    localization: poolProportions(poolable.map((it) => it.localization.rate)),
    // The ANSWER census beside the rate, because the rate alone is misleading the
    // moment `unresolvable` is non-empty — and on the pilot it is 27 of our arm's
    // 142 findings. Those 27 cite a precise, real repository path that the frozen
    // diff does not touch, so they are not failures to localise; they are
    // citations a corpus item cannot check. A reader seeing `0.796` next to the
    // other arm's `1.000` will draw the wrong conclusion without this.
    localization_counts: LOCALIZATION.reduce((a, v) => ({ ...a, [v]: poolable.reduce((n, it) => n + it.localization.counts[v], 0) }), {}),
    scope: poolProportions(poolable.map((it) => it.scope.rate)),
    restatement: poolProportions(poolable.map((it) => it.restatement.rate)),
  };
}

/** The arm's severity mix, summed from the per-item blocks rather than recomputed
 *  from records — one derivation, so the rows and the total cannot disagree. */
function severityMixOf(items) {
  const block = (which) => {
    const counts = Object.fromEntries(KNOWN.map((s) => [s, items.reduce((a, it) => a + it.severity[which].counts[s], 0)]));
    const n = items.reduce((a, it) => a + it.severity[which].n, 0);
    return {
      n,
      counts,
      share: n === 0 ? null : Object.fromEntries(KNOWN.map((s) => [s, counts[s] / n])),
      nit_ratio: proportion(counts.nit + counts.minor, n),
    };
  };
  return { n: items.reduce((a, it) => a + it.severity.n, 0), stated: block("stated"), unstated: block("unstated") };
}

/**
 * Which gate segment a record belongs to. Never a pooled key — see `GATE_SEGMENTS`.
 */
export function gateSegmentOf(record) {
  if (record?.arm !== "panel") return GATE_SEGMENTS.noGateInArm;
  const s = record?.panel?.gate_state;
  return typeof s === "string" && s.trim() !== "" ? s : GATE_SEGMENTS.unrecorded;
}

/**
 * One `population`, or nothing is comparable.
 *
 * `reported` and `sampled` answer different questions — what the panel SAID
 * versus what it could find across repeated tries — and only the first has a
 * CodeRabbit counterpart. `finding-record.mjs` carries `population` on every
 * record precisely so a scorer cannot pool them by accident, and this is the
 * scorer honouring that.
 */
export function assertOnePopulation(records) {
  const seen = [...new Set((Array.isArray(records) ? records : []).map((r) => r?.population))];
  if (seen.length > 1) {
    refuse(
      `records span ${seen.length} populations (${seen.join(", ")}) — "what the panel reported" and "what its samples ` +
        `raised before dedupe" are different questions, and CodeRabbit has no counterpart to the second`,
    );
  }
  const population = seen[0] ?? null;
  if (population !== null && !POPULATIONS.includes(population)) refuse(`population ${JSON.stringify(population)} is not one of ${POPULATIONS.join(" | ")}`);
  return population;
}

/**
 * No finding may be about code our arm never saw.
 *
 * ASSERTED, NOT SEGMENTED, and that is a deliberate narrowing. The pilot corpus
 * was re-frozen at the commit CodeRabbit reviewed, so `after-window` is 0 across
 * all seven items today — measured — which makes `window` a GUARD rather than a
 * scoring input. A scorer that instead pooled `after-window` records would be
 * comparing two reviewers on two different snapshots and reporting one number, and
 * a scorer that quietly DROPPED them would delete 80% of the other arm's findings
 * on the pre-re-freeze corpus. Neither is a default anybody should get by
 * accident, so both are refused and the remedy is a window-segmented scorer,
 * which is the segmentation engine's job rather than this file's.
 *
 * `unplaceable` and `no-window` are scored and COUNTED, never dropped: the
 * pilot's three are all pr-415, whose only CodeRabbit review sits on a commit a
 * force-push removed from the pull request. They are in-window by construction —
 * the corpus is frozen at exactly that commit — and `placeInWindow` cannot order
 * what is not in the list.
 */
export function assertComparableWindow(records) {
  const bad = (Array.isArray(records) ? records : []).filter((r) => r?.coderabbit?.window === AFTER_WINDOW);
  if (bad.length > 0) {
    const items = [...new Set(bad.map((r) => r.item_id))];
    refuse(
      `${bad.length} record(s) on ${items.join(", ")} are ${AFTER_WINDOW}: they are about code our arm never reviewed, ` +
        `so pooling them compares two reviewers on two different snapshots. Re-freeze the corpus at the reviewed commit, ` +
        `or segment on window — which is the segmentation engine's job, not this scorer's`,
    );
  }
}

/**
 * One run per item, or say why not.
 *
 * K IS 1 TODAY AND 3 TOMORROW, and this file refuses the second rather than
 * inventing an aggregation for it. "Findings per PR" over 3 replicates is not a
 * bigger sample of one number — it is a choice between the mean, the union and the
 * intersection, and each answers a different question; the union in particular is
 * a COVERAGE measure that would make our arm's volume rise with K while
 * CodeRabbit's stayed fixed. Choosing per-replicate agreement is what the
 * reliability scorer is for, so the honest move here is to score one replicate at
 * a time and name the flag that picks it.
 */
export function assertOneRunPerItem(records) {
  const runs = new Map();
  for (const r of Array.isArray(records) ? records : []) {
    if (r?.arm !== "panel") continue;
    const key = `${r.item_id}`;
    if (!runs.has(key)) runs.set(key, new Set());
    runs.get(key).add(r.run_id ?? "(none)");
  }
  const many = [...runs.entries()].filter(([, s]) => s.size > 1);
  if (many.length > 0) {
    refuse(
      `${many.map(([item, s]) => `${item} has ${s.size} runs (${[...s].join(", ")})`).join("; ")} — this scorer does not ` +
        `aggregate across replicates. A mean, a union and an intersection over K runs are three different metrics and the ` +
        `union grows with K, so pass one --run at a time; cross-replicate agreement is the reliability scorer's`,
    );
  }
}

/**
 * The run being scored must be a run OF the corpus being scored.
 *
 * `runs/` is not safe to glob. It holds output from before the corpus was frozen —
 * a different corpus and a different panel — and decision 6 says none of it is
 * carried forward. Selecting by `run_id` is only half the protection; the other
 * half is checking that the run says it replayed this corpus version, because a
 * mismatch here is the one error whose symptom is a plausible number.
 */
export function assertRunMatchesCorpus(run, corpusVersion) {
  if (!run) return;
  if (typeof corpusVersion === "string" && corpusVersion.trim() !== "" && run.corpus_version !== corpusVersion) {
    refuse(
      `run ${JSON.stringify(run.run_id)} replayed corpus ${JSON.stringify(run.corpus_version ?? null)}, not ` +
        `${JSON.stringify(corpusVersion)} — scoring one corpus's findings against another's diff sizes produces a number ` +
        `that looks right and measures nothing`,
    );
  }
}

/**
 * Volume and mix for every arm, every item, one population.
 *
 * `reads` is EXACTLY what the two adapters return per item, with `arm` added:
 * `{arm, item_id, population_state, records, dropped}` (`sources` and `declared`
 * ride along from the CodeRabbit side and are reported, not scored). Consuming
 * the adapters' own shape rather than a re-shaped one is what keeps
 * `population_state: "absent"` visible — a zero-record item is only a true
 * negative when the endpoint answered.
 *
 * Refuses on a caller error (mixed populations, several replicates, a foreign
 * corpus, an after-window record) and LABELS a data shortfall (a partial run, a
 * capped run, items the run never reached, items whose status is not `ok`). The
 * split is deliberate: the first four mean the number would be wrong, the rest
 * mean it is right about less than somebody may assume.
 */
export function scoreVolumeAndMix({ reads = [], geometry = new Map(), run = null, corpusVersion = null, corpusItemIds = [] } = {}) {
  const all = reads.flatMap((rd) => (Array.isArray(rd.records) ? rd.records : []));
  const population = assertOnePopulation(all);
  assertComparableWindow(all);
  assertOneRunPerItem(all);
  assertRunMatchesCorpus(run, corpusVersion);

  // One score row per (arm, gate segment, item). The segment comes off the
  // RECORDS rather than off the read, so a read whose records disagree about the
  // gate splits into two rows instead of averaging into one.
  const rows = [];
  for (const rd of reads) {
    const records = Array.isArray(rd.records) ? rd.records : [];
    const bySegment = new Map();
    for (const r of records) {
      const seg = gateSegmentOf(r);
      if (!bySegment.has(seg)) bySegment.set(seg, []);
      bySegment.get(seg).push(r);
    }
    // A read with NO records still produces a row — that is the whole point of
    // `population_state` — filed under the segment the arm would have used.
    if (bySegment.size === 0) bySegment.set(rd.arm === "panel" ? (typeof rd.gate_state === "string" ? rd.gate_state : GATE_SEGMENTS.unrecorded) : GATE_SEGMENTS.noGateInArm, []);
    for (const [gate_state, segRecords] of bySegment) {
      rows.push({ gate_state, ...scoreItem({ ...rd, records: segRecords, geometry: geometry.get(rd.item_id) ?? null }) });
    }
  }

  const segments = [];
  for (const key of [...new Set(rows.map((r) => `${r.arm} ${r.gate_state}`))].sort()) {
    const [arm, gate_state] = key.split(" ");
    const items = rows.filter((r) => r.arm === arm && r.gate_state === gate_state).sort((a, b) => a.item_id.localeCompare(b.item_id));
    segments.push({ arm, gate_state, population, items, summary: summarizeArm(items) });
  }

  const corpusIds = [...new Set(corpusItemIds)].sort();
  const reasons = [];
  if (run && run.status !== "complete") reasons.push(`run status ${run.status}`);
  // COVERAGE IS PER ARM, and it is per arm because the pooled version reported
  // this very pilot as COMPLETE: the CodeRabbit arm covers all seven items, our
  // arm covers one, and a union over both arms' item ids hides that entirely. A
  // comparison is only as complete as its THINNEST arm — the number a reader
  // quotes is a difference between two arms, so an item only one of them was
  // scored on contributes to neither side of it.
  const coverage = [...new Set(reads.map((rd) => rd.arm))].sort().map((arm) => {
    const armRows = rows.filter((r) => r.arm === arm);
    const read = new Set(armRows.map((r) => r.item_id));
    const scored = [...new Set(armRows.filter((r) => r.poolable).map((r) => r.item_id))].sort();
    const notRead = corpusIds.filter((id) => !read.has(id));
    if (notRead.length > 0) reasons.push(`${arm}: ${notRead.length} corpus item(s) never read (${notRead.join(", ")})`);
    for (const r of armRows.filter((x) => !x.poolable)) reasons.push(`${arm}/${r.item_id} excluded (${r.exclusions.join(", ")})`);
    if (corpusIds.length > 0 && scored.length < corpusIds.length) reasons.push(`${arm}: ${scored.length} of ${corpusIds.length} corpus item(s) scored`);
    return { arm, items_scored: scored.length, items_scored_ids: scored, items_not_read: notRead };
  });
  // The items BOTH arms were scored on — the only population any cross-arm
  // statement may be made over, and the pilot's is one item wide.
  const comparable = corpusIds.filter((id) => coverage.every((c) => c.items_scored_ids.includes(id)));

  return {
    schema_version: SCHEMA_VERSION,
    population,
    corpus_version: corpusVersion,
    completeness: {
      // `partial` unless every corpus item was scored for every arm that was
      // read. It is computed from the ITEMS, not copied from `run.json.status` —
      // a run whose `--items` named one of seven reports `complete`, which is
      // true of the run and says nothing about corpus coverage. Scoring 1 item as
      // if it were 7 is the failure this project keeps re-learning.
      verdict: reasons.length === 0 && corpusIds.length > 0 ? "complete" : "partial",
      reasons,
      corpus_item_count: corpusIds.length,
      by_arm: coverage,
      // Named so nobody has to intersect the arms themselves to find out what the
      // comparison rests on.
      items_comparable: comparable,
      run: run
        ? { run_id: run.run_id ?? null, status: run.status ?? null, item_count: run.item_count ?? null, items_ok: run.items_ok ?? null, items_error: run.items_error ?? null, notes: run.notes ?? "" }
        : null,
    },
    segments,
  };
}

// --- the report -------------------------------------------------------------

const pct = (p) => (p?.ratio === null || p?.ratio === undefined ? `n/a (n=${p?.n ?? 0})` : `${p.k}/${p.n}=${p.ratio.toFixed(3)}`);
const num = (v, digits = 2) => (Number.isFinite(v) ? v.toFixed(digits) : "n/a");
const mixStr = (block) => KNOWN.filter((s) => block.counts[s] > 0).map((s) => `${s}=${block.counts[s]}`).join(" ") || "(none)";

/**
 * The result as lines. Pure and exported, so what a reader sees is testable
 * without spawning anything — and so the CLI cannot format a number the library
 * did not compute.
 */
export function renderReport(result) {
  const out = [];
  const c = result.completeness;
  out.push(`volume & mix · corpus ${result.corpus_version ?? "(none)"} · population ${result.population ?? "(none)"} · ${c.verdict.toUpperCase()}`);
  // The comparable set FIRST, because it bounds every cross-arm sentence anybody
  // will write from the rest of this report.
  out.push(`  ${c.items_comparable.length} of ${c.corpus_item_count} corpus item(s) scored on EVERY arm: ${c.items_comparable.join(", ") || "(none)"}`);
  for (const r of c.reasons) out.push(`  ! ${r}`);
  for (const seg of result.segments) {
    out.push("");
    // THE RUN ID IS PART OF THE HEADING, not a detail. Measured across the three
    // completed replicates of the pilot, per-item volume moves by +13% to +67%
    // between runs of the SAME reviewer on the SAME item (pr-549: 12 · 20 · 16)
    // while the arm total moves 5.8% (142 · 147 · 139). So a per-item count is one
    // draw from a distribution, not a property of the item, and a table that does
    // not name its replicate invites exactly that misreading.
    const runs = [...new Set(seg.items.map((it) => it.run_id).filter(Boolean))];
    out.push(`${seg.arm} [gate ${seg.gate_state}]${runs.length ? ` · run ${runs.join(", ")}` : ""}`);
    if (runs.length === 0 && seg.arm === "panel") out.push(`  ! no run id on these records — a per-item count that cannot name its replicate is not attributable`);
    for (const it of seg.items) {
      out.push(
        `  ${it.item_id}${it.run_id ? `@${it.run_id}` : ""}: ${it.findings} finding(s)` +
          ` · ${it.diff_lines ?? "?"} diff line(s)` +
          ` · ${num(it.per_100_diff_lines)}/100 lines` +
          ` · severity ${mixStr(it.severity.stated)} (stated ${it.severity.stated.n}, unstated ${it.severity.unstated.n})` +
          (it.poolable ? "" : ` · EXCLUDED ${it.exclusions.join(",")}`),
      );
      out.push(
        `     nit ${pct(it.severity.stated.nit_ratio)}` +
          ` · localised ${pct(it.localization.rate)}` +
          ` · in-diff ${pct(it.scope.rate)}` +
          ` · restated ${pct(it.restatement.rate)}` +
          (it.dropped ? ` · ${it.dropped} dropped` : ""),
      );
      // The basis, not the value — an `unresolvable` citation and a missing line
      // are one number and two different problems.
      out.push(`     localisation basis ${Object.entries(it.localization.basis).map(([b, n]) => `${b}=${n}`).join(" ")}`);
      // The window census is PRINTED, not merely computed. It moves under this
      // module — the arm-boundary fix for a finding sitting exactly on the frozen
      // review commit turns three `unplaceable` records into `in-window` without
      // any metric here changing — and a scorer that silently accepts either
      // census is the failure this project keeps repeating. `assertComparableWindow`
      // refuses the one value that would be a real comparison error; this line is
      // how a reader sees the rest of the distribution rather than trusting it.
      if (Object.keys(it.window).length > 0) out.push(`     window ${Object.entries(it.window).map(([w, n]) => `${w}=${n}`).join(" ")}`);
      out.push(`     scope basis ${Object.entries(it.scope.basis).map(([b, n]) => `${b}=${n}`).join(" ")} · restatement basis ${Object.entries(it.restatement.basis).map(([b, n]) => `${b}=${n}`).join(" ")}`);
    }
    const s = seg.summary;
    out.push(
      `  ARM: ${s.items_scored} item(s) scored · ${s.findings} finding(s)` +
        ` · per item min/median/max ${s.findings_per_item.min ?? "n/a"}/${s.findings_per_item.median ?? "n/a"}/${s.findings_per_item.max ?? "n/a"} (mean ${num(s.findings_per_item.mean)})`,
    );
    out.push(
      `       per 100 lines: pooled ${num(s.per_100_diff_lines.pooled)} over ${s.per_100_diff_lines.pooled_diff_lines} line(s)` +
        ` · per-item median ${num(s.per_100_diff_lines.per_item.median)}`,
    );
    out.push(`       severity ${mixStr(s.severity.stated)} (stated ${s.severity.stated.n}, unstated ${s.severity.unstated.n}) · nit ${pct(s.severity.stated.nit_ratio)}`);
    out.push(
      `       localised ${pct(s.localization)}` +
        ` (${s.localization_counts.unresolvable} unresolvable — cites a path outside the frozen diff, NOT a failure to cite)` +
        ` · in-diff ${pct(s.scope)} · restated ${pct(s.restatement)}`,
    );
    for (const ex of s.items_excluded) out.push(`       ! ${ex.item_id} not pooled: ${ex.exclusions.join(", ")}${ex.item_reason ? ` (${ex.item_reason})` : ""}`);
  }
  return out;
}

// --- CLI: read a store, print the numbers. Writes nothing. -------------------

const ARM_CHOICES = Object.freeze(["panel", "coderabbit", "both"]);

const USAGE =
  "usage: volume-mix.mjs --root <eval-data-root> --corpus-version <v> [--run <run-id>]\n" +
  "                     [--arm panel|coderabbit|both] [--item <item-id>] [--population reported|sampled] [--json]\n" +
  "\n" +
  "Volume, severity mix, nit ratio, localisation, scope discipline and restatement,\n" +
  "per item and per arm. Reads only; writes nothing, spawns nothing and costs\n" +
  "nothing (the CodeRabbit arm makes read-only GitHub API calls).\n" +
  "\n" +
  "--run selects ONE replicate. This scorer does not aggregate across K.\n" +
  "--json prints the whole result to stdout; the census goes to stderr.";

async function main() {
  const args = parseArgs(process.argv, { booleans: ["json", "help"] });
  if (args.help) {
    console.log(USAGE);
    return;
  }
  // `--root` is REQUIRED and has no default anywhere in this directory: git
  // history is permanent, so one flag that fell back to a path inside this
  // repository would commit benchmark data into `wafflebase` for good.
  if (!args.root || !args["corpus-version"]) {
    console.error(USAGE);
    process.exit(2);
  }
  const arm = args.arm ?? "both";
  if (!ARM_CHOICES.includes(arm)) {
    console.error(`--arm must be one of ${ARM_CHOICES.join(" | ")}, got ${JSON.stringify(arm)}`);
    process.exit(2);
  }
  const population = args.population ?? "reported";
  if (!POPULATIONS.includes(population)) {
    console.error(`--population must be one of ${POPULATIONS.join(" | ")}, got ${JSON.stringify(population)}`);
    process.exit(2);
  }
  const wantPanel = arm === "panel" || arm === "both";
  const wantCodeRabbit = arm === "coderabbit" || arm === "both";
  if (wantPanel && !args.run) {
    console.error("--run is required to score the panel arm: a run id names ONE replicate, and runs/ must never be globbed (decision 6)");
    process.exit(2);
  }
  if (wantCodeRabbit && population !== "reported") {
    console.error(`population ${JSON.stringify(population)} does not exist in the CodeRabbit arm — pass --arm panel to score it`);
    process.exit(2);
  }

  const { EvalStore } = await import("./store.mjs");
  const store = new EvalStore(args.root);
  const corpus = store.getCorpus(args["corpus-version"]);
  if (corpus === null) {
    console.error(`corpus version ${JSON.stringify(args["corpus-version"])} does not exist under this root`);
    process.exit(1);
  }
  const wanted = corpus.filter((it) => !args.item || it.id === args.item);
  const geometry = new Map();
  for (const it of wanted) {
    const input = store.getCorpusItemInput(it.id);
    // A read path: an item that is not frozen under this root degrades to no
    // geometry, and every localisation and scope answer on it reads
    // `item-unavailable` rather than being silently placed.
    if (input) geometry.set(it.id, itemGeometry(it.id, input));
    else console.error(`  ! ${it.id}: no frozen item under this root — its citations cannot be placed`);
  }

  const reads = [];
  let run = null;
  if (wantPanel) {
    const { runRecords } = await import("./adapters/panel.mjs");
    const stored = store.getRun(args.run);
    if (!stored) {
      console.error(`run ${JSON.stringify(args.run)} does not exist under this root`);
      process.exit(1);
    }
    run = stored.runJson;
    for (const rd of runRecords(store, args.run, { population, itemId: args.item ?? null })) {
      // `envelope.status` is read HERE because `panelRecords` does not return it:
      // it rides on each RECORD as `panel.item_status`, so an `error` item with
      // zero findings carries the status nowhere a scorer can see. Supplying it
      // from the store is what lets decision 8 be enforced on exactly the items
      // it matters most for.
      const item = store.getItem(args.run, rd.item_id);
      reads.push({ arm: "panel", ...rd, item_status: item?.envelope?.status ?? null, item_reason: item?.envelope?.reason ?? null, gate_state: item?.envelope?.gate?.state ?? null });
    }
  }
  if (wantCodeRabbit) {
    const { corpusRecords } = await import("./adapters/coderabbit.mjs");
    for (const rd of corpusRecords(store, args["corpus-version"], { itemId: args.item ?? null })) {
      // CodeRabbit has no run and no item status: the arm is not replayed, so the
      // only completeness question is whether both its endpoints answered, which
      // `population_state` already carries.
      reads.push({ arm: "coderabbit", ...rd, item_status: "ok" });
    }
  }
  if (reads.length === 0) {
    console.error("no items to score");
    process.exit(1);
  }

  const result = scoreVolumeAndMix({ reads, geometry, run, corpusVersion: args["corpus-version"], corpusItemIds: wanted.map((it) => it.id) });
  for (const line of renderReport(result)) console.error(line);
  if (args.json) console.log(JSON.stringify(result, null, 2));
  // A PARTIAL result exits non-zero, so a pipeline cannot quote it as a complete
  // one by ignoring a line of stderr. Same reason the runner exits 1 on a capped
  // run: the number is real, and it is about less than the corpus.
  process.exitCode = result.completeness.verdict === "complete" ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error("volume & mix failed:", e.message);
    process.exit(1);
  });
}
