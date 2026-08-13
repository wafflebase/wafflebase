// COMPLEMENTARITY: of the defect classes on a pull request, how many did BOTH
// reviewers raise, what did each raise alone, and where they agree on a defect do
// they agree on how bad it is.
//
// Spec §3.5, and the first consumer of `groupFindings` (#759). It computes NO
// matching of its own: `finding-match.mjs` decides when two findings are one
// defect, this file counts the classes that come out and states what each count's
// denominator is. A second notion of "same defect" beside the matcher's is how two
// numbers about one dataset come to disagree.
//
// THE ASYMMETRY THIS FILE EXISTS TO KEEP VISIBLE. Our arm can be replayed and
// CodeRabbit's cannot. There are three replicates of the panel over the pilot
// corpus and exactly one historical CodeRabbit review per pull request, which can
// never be re-run. Pool the replicates and our arm gets three chances at every
// defect while the other arm gets one — "unique to us" inflates, "unique to them"
// deflates, and NOTHING IN THE OUTPUT LOOKS WRONG. The panel's own per-item volume
// moved -33% to +67% between two replicates of one corpus, so this is a large
// effect rather than a rounding one.
//
// Hence `VIEWS`, and hence `per-replicate` being the default and the only one that
// needs no label: it compares ONE DRAW AGAINST ONE DRAW. `union` and
// `intersection` are bounds, they must be asked for by name, and every result
// carries `stats.draws` so a reader can see how many tries each arm got.
//
// WHAT IT NEVER DOES:
//
// - **Filter on `window`.** An `after-window` CodeRabbit finding is about code our
//   arm never saw, so its presence means the two arms are being compared on
//   different snapshots. That is an ASSERTION FAILURE, not a row to drop:
//   `assertComparableWindow` refuses the whole scoring run and the census is
//   printed either way. Silently excluding those findings would shrink the other
//   arm for a reason that is ours.
// - **Read an arm's silence as a zero.** A class set holds only findings, so an
//   item on which CodeRabbit reported nothing contributes no classes for that arm —
//   and that is a TRUE NEGATIVE, which is a data point, while "we could not load
//   that arm" is not. The two are told apart by a declared `POPULATION_STATES`
//   value per (arm, item) pair, and a pair nobody declared is refused rather than
//   assumed present.
// - **Pool a replay that ended `error`.** Decision 8: `status: "ok"` means "poolable
//   as a real verdict". An error item with zero findings is indistinguishable from
//   a clean one at the record level, so it is refused here and excluded by the CLI
//   with its reason printed.
// - **Compute reliability.** Agreement between replicates — Jaccard, kappa — is a
//   different metric over the same records and belongs to its own module. The
//   `intersection` view counts classes every replicate raised; it does not score
//   how much the replicates agree.
// - **Write anything.** Scores are derived data, recomputable from immutable
//   inputs, so persisting them would spend the store's write-once rule on a shape
//   that is cheap to recompute and expensive to correct. A library plus a CLI that
//   prints.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { KNOWN } from "../severity.mjs";
import { LINKAGE, groupFindings } from "../finding-match.mjs";
import { parseArgs } from "../gh-checks.mjs";
import { ARMS, POPULATIONS } from "./finding-record.mjs";
import { POPULATION_STATES, runRecords } from "./adapters/panel.mjs";
import { WINDOW, corpusRecords } from "./adapters/coderabbit.mjs";
import { LABEL_AVAILABILITY, LABEL_SOURCES, PAIR_VERDICTS, pairLabelCensus, pairLabelKey, readPairLabels, resolveClasses } from "./pair-labels.mjs";

const refuse = (msg) => {
  throw new Error(`complementarity: ${msg}`);
};

/**
 * The vocabulary this file compares against, checked AT IMPORT TIME against the
 * modules that own it.
 *
 * Lesson 7 applied to a string rather than a field: `assertEffort` did not fail
 * because its rule was wrong, it failed because its input stopped arriving. A
 * guard that greps for a value somebody renamed upstream never fires and never
 * complains — it just quietly stops being a guard. Every literal below is one this
 * file's arithmetic depends on, so a rename must break the import rather than the
 * number.
 */
const pin = (what, ok) => {
  if (!ok) refuse(`${what} — a vocabulary this module compares against has changed upstream, so its arithmetic is no longer sound`);
};
pin(`ARMS is ${JSON.stringify(ARMS)}, expected exactly the two compared arms`, ARMS.length === 2 && ARMS.includes("panel") && ARMS.includes("coderabbit"));
pin(`POPULATIONS does not contain "reported"`, POPULATIONS.includes("reported"));
pin(`POPULATION_STATES is ${JSON.stringify(POPULATION_STATES)}, expected present | absent`, POPULATION_STATES.length === 2 && POPULATION_STATES.includes("present") && POPULATION_STATES.includes("absent"));
pin(`WINDOW does not contain "after-window"`, WINDOW.includes("after-window"));
// The severity DISTANCE below is `|index(a) - index(b)|` over `KNOWN`, which is
// only a distance if `KNOWN` is ordered worst-first with no gaps. It is
// (`critical major minor nit`), and a reordering would silently turn "adjacent"
// into a different pair of severities rather than into an error.
pin(
  `KNOWN is ${JSON.stringify(KNOWN)}, expected a worst-first ordered scale`,
  KNOWN.length === 4 && KNOWN[0] === "critical" && KNOWN[1] === "major" && KNOWN[2] === "minor" && KNOWN[3] === "nit",
);
// The label vocabulary this file's band arithmetic depends on. `insufficient-basis`
// is pinned by name because pooling it with `different` is the one mistake that
// would move the CEILING on evidence nobody has, and `gold` because the headline
// band is the gold-only one.
pin(`PAIR_VERDICTS is ${JSON.stringify(PAIR_VERDICTS)}, expected same | different | insufficient-basis`, PAIR_VERDICTS.length === 3 && ["same", "different", "insufficient-basis"].every((v) => PAIR_VERDICTS.includes(v)));
pin(`LABEL_SOURCES does not contain "gold"`, LABEL_SOURCES.includes("gold"));
// The two states this file SETS itself are pinned by name, and the count with them:
// a state added upstream that this scorer never emits would leave a reader of the
// payload with a vocabulary wider than the code that fills it.
pin(
  `LABEL_AVAILABILITY is ${JSON.stringify(LABEL_AVAILABILITY)}, expected the seven states a band's provenance can be in`,
  LABEL_AVAILABILITY.length === 7 &&
    ["not-supplied", "no-store", "none-for-replicate", "resolved-nothing"].every((s) => LABEL_AVAILABILITY.includes(s)),
);

const PANEL = "panel";
const CODERABBIT = "coderabbit";

/**
 * HOW MANY DRAWS EACH ARM GETS, which is the whole decision this module exists to
 * make explicit. The default is the fair one and the other two must be asked for.
 *
 *   per-replicate  ONE panel run against CodeRabbit's one review. The headline, and
 *                  the only view whose "unique to us" and "unique to them" are
 *                  symmetric. Refuses records from more than one panel run, because
 *                  a pooled figure is exactly what looks right and is not.
 *   union          every replicate at once: a class counts for our arm if ANY
 *                  replicate raised it. An UPPER BOUND on our coverage — "our arm
 *                  at K=3 against CodeRabbit at K=1" — never a headline.
 *   intersection   a class counts for our arm only when EVERY replicate raised it.
 *                  What the panel finds reliably enough to find every time. It is a
 *                  coverage bound, NOT an agreement metric: it counts classes, and
 *                  says nothing about how much the replicates agree.
 *
 * A one-replicate `union` and a one-replicate `intersection` are the same
 * computation as `per-replicate`, deliberately: the views differ in how they read K
 * draws, not in what they do with one, and a view that changed the answer at K=1
 * would be doing something else as well.
 */
export const VIEWS = Object.freeze(["per-replicate", "union", "intersection"]);

/**
 * WHO CLAIMED A DEFECT CLASS. Five values, and the last two are separated from the
 * first three for the reason `GATING` separates `not-applicable` from `unknown` —
 * neither of them is a reviewer's silence and neither may be pooled with one:
 *
 *   both · panel-only · coderabbit-only   the three that answer the question.
 *   no-arm                a class whose members carry no readable arm. A hole in
 *                         the input, not a unique catch, and crediting it to either
 *                         arm would credit a reviewer for a finding nobody can
 *                         attribute. `groupFindings` drops nulls from `group.arms`,
 *                         so such a class arrives here looking exactly like an
 *                         empty one.
 *   not-claimed-in-view   `intersection` only: our arm raised it, but not in every
 *                         replicate, and CodeRabbit did not raise it at all. The
 *                         VIEW dropped it, so it is counted where the view's own
 *                         cost is visible rather than folded into a denominator.
 */
export const CLAIMS = Object.freeze(["both", "panel-only", "coderabbit-only", "no-arm", "not-claimed-in-view"]);

/**
 * On a class BOTH arms claimed, how far apart are their severities — `exact`,
 * `adjacent` (one step on `KNOWN`), or `further-apart`.
 *
 * ⚠ THE CAVEAT THAT TRAVELS WITH EVERY NUMBER THIS PRODUCES. CodeRabbit's
 * severities are TRANSLATED at the arm boundary (decision 17): `trivial` becomes
 * `nit`, a section heading becomes `minor` or `nit`, and a finding that states none
 * anywhere is floored at `nit`. So this compares our rubric against a TRANSLATION
 * of theirs, not against theirs. It is not fixable here — the translation is the
 * only way the two scales meet at all — and it is why the census below is split by
 * `coderabbit.severity_basis` and never pooled across the split.
 */
export const SEVERITY_AGREEMENT = Object.freeze(["exact", "adjacent", "further-apart"]);

/**
 * The score at or above which an undecided cross-arm pair is worth a curator's
 * eye. A REPORTING AID, and it is important that it is nothing more.
 *
 * It does NOT re-threshold the matcher, promote anything, or enter any count this
 * module reports. `matchFindings` owns the `match`/`maybe`/`no` decision and its
 * bar is calibrated (`loc >= 0.6 && tokens >= 0.3`); a scorer that quietly moved
 * that bar would be adjudicating, which is a human's job or L3's.
 *
 * What it is for: the raw queue size reads as intractable and is not. The
 * distribution is bottom-heavy by construction — L2 answers `maybe` for any
 * cross-source pair with a location tie, and two findings on one file have a
 * location tie whether or not they are about the same thing — so a queue of
 * hundreds has a head of tens. Measured on the pilot's first replicate: 412
 * unresolved cross-arm pairs, 315 of them below 0.50, and **17 at or above this
 * value**. "412 unresolved, 17 worth reading" is actionable where "412
 * unresolved" is not.
 *
 * 0.70 is a reporting convenience rather than a calibrated boundary, and it is
 * named here rather than inlined so nobody mistakes it for the matcher's.
 */
export const TRIAGE_SCORE = 0.7;

/**
 * An item id as the GROUPING will key it.
 *
 * `finding-match.mjs`'s `defaultItemOf` trims (`f.item_id.trim()`), so a record
 * carrying `" pr-1 "` is grouped under `"pr-1"` and its class reports the trimmed
 * id. A frame keyed on the untrimmed string then matches no class at all, and the
 * failure is TOTAL AND SILENT: every class is filtered out of the scored set and
 * the run reports 0 of 0 with no error. Both sides use this, so there is one rule.
 */
const itemKey = (v) => String(v ?? "").trim();

/** Worst-first position on `KNOWN`; `-1` for a severity outside it, which
 *  `validateFindingRecord` already refuses, so it can only mean a caller built a
 *  record by hand. */
const rank = (severity) => KNOWN.indexOf(severity);

/** `{key: n}` over a list. Sorted keys, so two runs print identically. */
function tally(items, pick) {
  const out = {};
  for (const it of items) {
    const k = pick(it);
    if (k === undefined || k === null) continue;
    out[k] = (out[k] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/** A share with its denominator attached, or `null` when there is no denominator.
 *  `0/0 → 0.000` is what an unwritten branch looks like and it reads as a
 *  measurement, which is the house rule this helper exists to keep. */
const share = (num, den) => (den > 0 ? num / den : null);

/**
 * WHICH SNAPSHOT each CodeRabbit finding is about, as a census — by value and by
 * basis. The basis rather than only the value, because `unplaceable` has four
 * causes and one of them ("the commit list did not load") is OUR failure rather
 * than a fact about the finding.
 */
export function windowCensusOf(records) {
  const cr = (Array.isArray(records) ? records : []).filter((r) => r?.arm === CODERABBIT);
  return {
    n: cr.length,
    by_window: tally(cr, (r) => r.coderabbit?.window ?? "(none)"),
    by_basis: tally(cr, (r) => r.coderabbit?.window_basis ?? "(none)"),
  };
}

/**
 * REFUSE to score two arms on two different snapshots.
 *
 * Decision 22 made `window` a guard rather than a scoring input, and this is the
 * guard. An `after-window` finding was written against code our arm never
 * reviewed, so a class it does or does not join says nothing about either
 * reviewer — and the failure is invisible in the output, because the number that
 * comes out is a perfectly ordinary number.
 *
 * `unplaceable` is NOT refused, and the difference is the corpus. On a corpus
 * frozen at the commit CodeRabbit reviewed, an unplaceable finding is in-window BY
 * CONSTRUCTION — pr-415's three sat exactly on the commit its item is frozen at,
 * unplaceable only because a force-push later removed that commit from the pull
 * request. Refusing them would drop 10% of the other arm for a reason that is
 * about git history rather than about review. They are counted and named instead.
 */
export function assertComparableWindow(records) {
  const census = windowCensusOf(records);
  const after = census.by_window["after-window"] ?? 0;
  if (after > 0) {
    refuse(
      `${after} of ${census.n} CodeRabbit record(s) are after-window — they were written against code this corpus was not ` +
        `frozen at, so the two arms would be compared on different snapshots. Re-freeze the corpus at the reviewed commit ` +
        `(extract-corpus.mjs --review-commit) rather than filtering them out here; window is a guard, not a scoring input`,
    );
  }
  return census;
}

/**
 * The finding `groupFindings` should see for one record.
 *
 * WIDENS, NEVER NARROWS — a copy of the whole record with ONE field added, never a
 * rebuilt field list. The added field is `lens`, and it is added because of a real
 * gap between two merged modules:
 *
 *   `groupFindings`' same-run gate is `trim(a.lens) !== trim(b.lens) || file...`,
 *   read off the finding itself. `buildFindingRecord` puts the lens in the ARM
 *   NAMESPACE (`record.panel.lens`), because a reviewer with no lenses must not
 *   have a top-level one. So a record handed to `groupFindings` unmodified reports
 *   `lens: undefined` on BOTH sides of every pair, `"" !== ""` is false, and the
 *   (lens, file) gate silently degrades to a file-only gate. Nothing fails; the
 *   panel's classes just quietly merge across lenses.
 *
 * That is silent degradation of a gate, which is the failure this project names
 * first, so the lens is put where the gate looks and `assertLensPresent` below
 * refuses the run if it is not there to put. The alternative — leaving it out and
 * getting the looser gate — is a scoring decision nobody wrote down, and it moves
 * the number in the direction of fewer panel classes.
 *
 * CODERABBIT RECORDS GET NO LENS, deliberately, even though the adapter fills one.
 * `gateFor` makes every pair involving that arm cross-source and L2 never reads a
 * lens, so hoisting it would change the class-id digest and nothing else — and
 * `gateFor`'s own reason for the rule applies: CodeRabbit's lens "is a
 * category→lens guess of OURS, so gating on it would partition one reviewer's
 * comments by our own annotation".
 */
function groupable(record) {
  return record.arm === PANEL ? { ...record, lens: record.panel?.lens ?? null } : { ...record };
}

/**
 * Every panel record must carry a lens, or the gate above is not the gate.
 *
 * A guard that ABORTS rather than a log line: with no lens the pairs still compare,
 * still merge and still produce classes — just under a looser rule than the one
 * this module documents. Measured on the pilot, all 428 panel findings across three
 * replicates carry one, so this is a guard rather than a correction.
 */
function assertLensPresent(records) {
  const missing = records.filter((r) => r.arm === PANEL && !(typeof r.panel?.lens === "string" && r.panel.lens.trim() !== ""));
  if (missing.length > 0) {
    refuse(
      `${missing.length} panel record(s) carry no panel.lens (first: ${JSON.stringify(missing[0].item_id)} ${JSON.stringify(missing[0].finding_key)}) — ` +
        `finding-match.mjs's same-run gate reads lens off the finding, so scoring without it would apply a file-only gate ` +
        `and merge classes across lenses without saying so`,
    );
  }
}

/**
 * The (arm, item) pairs this scoring run covers, and WHETHER EACH ARM ANSWERED for
 * each item. Required; there is no default.
 *
 * This is the true-negative guard, and it is an input rather than a derivation
 * because it CANNOT be derived: a class set holds only findings, so zero classes
 * for an arm on an item is the same shape whether the reviewer read the pull
 * request and found nothing or whether we failed to load it. Only the adapter
 * knows which — both of them return `population_state` per item for exactly this —
 * so an undeclared pair is refused instead of assumed.
 *
 * A pair is `present` only when EVERY row for it is present. With K replicates a
 * panel item has K rows; an item one replicate never reached is not a clean review
 * in the other two, it is a hole, and half a view reported as all of it is the
 * defect this whole subsystem keeps finding.
 */
function coverageIndex(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    refuse(
      `opts.coverage is required and must be a non-empty array of { arm, item_id, state } rows — without it "this arm found ` +
        `nothing here" and "this arm was not loaded" are the same zero, and only one of them is a data point`,
    );
  }
  const index = new Map(); // `${arm}/${item}` → state
  const items = new Set();
  for (const [i, row] of rows.entries()) {
    const arm = row?.arm;
    const raw = row?.item_id;
    const state = row?.state;
    if (!ARMS.includes(arm)) refuse(`coverage[${i}].arm must be one of ${ARMS.join(" | ")}, got ${JSON.stringify(arm)}`);
    // Validated on the ORIGINAL value — `"   "` is not an item id — and then keyed
    // on the trimmed one, because that is what the grouping will key on.
    if (typeof raw !== "string" || raw.trim() === "") refuse(`coverage[${i}].item_id must be a non-empty string, got ${JSON.stringify(raw)}`);
    if (!POPULATION_STATES.includes(state)) refuse(`coverage[${i}].state must be one of ${POPULATION_STATES.join(" | ")}, got ${JSON.stringify(state)}`);
    const item = itemKey(raw);
    items.add(item);
    const key = `${arm}/${item}`;
    // `absent` wins: one unreadable draw makes the pair unreadable for this view.
    if (state === "absent" || !index.has(key)) index.set(key, state);
  }
  // EVERY arm/item pair, not most of them. A pair nobody declared has no state at
  // all, and the missing state is exactly the one that reads as a true negative in
  // the output — so it is refused here rather than defaulted anywhere.
  const holes = [...items].sort().flatMap((item) => ARMS.filter((arm) => !index.has(`${arm}/${item}`)).map((arm) => `${arm}/${item}`));
  if (holes.length > 0) {
    refuse(`coverage declares no state for ${holes.join(", ")} — every arm must say whether it answered for every item in the frame, the arms that found nothing included`);
  }
  // `stateOf` normalises its argument the same way, so a record whose `item_id`
  // carries whitespace resolves to the pair it was declared under instead of
  // silently missing it.
  return { index, items: [...items].sort(), stateOf: (arm, item) => index.get(`${arm}/${itemKey(item)}`) ?? null };
}

/** Caller errors, all four of them: a number computed over any of these subsets is
 *  wrong rather than incomplete, so it must not be computed at all. */
function assertScorable(records, coverage, view) {
  const wrongPopulation = records.filter((r) => r.population !== "reported");
  if (wrongPopulation.length > 0) {
    refuse(
      `${wrongPopulation.length} record(s) are not population "reported" (first: ${JSON.stringify(wrongPopulation[0].population)}) — ` +
        `"sampled" is our arm's pre-verifier set and CodeRabbit has no counterpart to it, so the two cannot be compared`,
    );
  }
  const notOk = records.filter((r) => r.arm === PANEL && r.panel?.item_status != null && r.panel.item_status !== "ok");
  if (notOk.length > 0) {
    const items = [...new Set(notOk.map((r) => `${r.item_id}(${r.panel.item_status})`))].sort();
    refuse(
      `${notOk.length} panel record(s) come from item(s) whose replay did not end ok: ${items.join(", ")} — decision 8 defines ` +
        `"ok" as poolable as a real verdict, and an error item's absence would be scored as a clean review`,
    );
  }
  const undeclared = [...new Set(records.filter((r) => coverage.stateOf(r.arm, r.item_id) === null).map((r) => `${r.arm}/${r.item_id}`))].sort();
  if (undeclared.length > 0) {
    refuse(`no coverage row for ${undeclared.join(", ")} — every (arm, item) pair that contributes a record must declare whether that arm answered`);
  }
  const runs = [...new Set(records.filter((r) => r.arm === PANEL).map((r) => r.run_id ?? "(none)"))].sort();
  if (view === "per-replicate" && runs.length > 1) {
    refuse(
      `${runs.length} panel run ids in one per-replicate view (${runs.join(", ")}) — our arm has replicates and CodeRabbit has one ` +
        `historical review, so pooling K draws against 1 inflates "unique to panel" and deflates "unique to CodeRabbit" with ` +
        `nothing in the output looking wrong. Score each replicate separately, or ask for view "union"/"intersection" by name`,
    );
  }
  return runs;
}

/** The most severe thing an arm said about one defect class, plus how many claims
 *  it made. `null` when the arm is not in the class. The MOST severe rather than a
 *  mean: an arm that says "critical" once and "nit" twice has called the defect
 *  critical, and averaging its own claims would answer a question nobody asked. */
function armSeverity(members, arm) {
  const mine = members.filter((m) => m.arm === arm);
  if (mine.length === 0) return null;
  let best = null;
  for (const m of mine) {
    const r = rank(m.finding.severity);
    if (r >= 0 && (best === null || r < best.rank)) best = { rank: r, severity: m.finding.severity };
  }
  return best === null ? { severity: null, rank: -1, claims: mine.length } : { ...best, claims: mine.length };
}

/**
 * One defect class → the row this module reports.
 *
 * `claim` is read from the members' arms rather than from `group.arms`, because
 * the `intersection` view narrows what counts as a panel claim and the narrowing
 * has to happen where the class is read, not by re-grouping. Re-grouping per view
 * would give three different class-id sets for one dataset.
 */
function classify(group, { view, replicates }) {
  const members = group.members;
  const panelRuns = [...new Set(members.filter((m) => m.arm === PANEL).map((m) => m.run ?? "(none)"))].sort();
  const panelClaims =
    view === "intersection"
      ? replicates.length > 0 && replicates.every((r) => panelRuns.includes(r))
      : panelRuns.length > 0;
  const crClaims = members.some((m) => m.arm === CODERABBIT);
  const hasArm = members.some((m) => m.arm !== null);
  const claim = !hasArm ? "no-arm" : panelClaims && crClaims ? "both" : panelClaims ? "panel-only" : crClaims ? "coderabbit-only" : "not-claimed-in-view";

  const panelSeverity = panelClaims ? armSeverity(members, PANEL) : null;
  const crSeverity = crClaims ? armSeverity(members, CODERABBIT) : null;
  let severity = null;
  if (claim === "both" && panelSeverity?.rank >= 0 && crSeverity?.rank >= 0) {
    const distance = Math.abs(panelSeverity.rank - crSeverity.rank);
    severity = {
      panel: panelSeverity.severity,
      coderabbit: crSeverity.severity,
      distance,
      agreement: distance === 0 ? "exact" : distance === 1 ? "adjacent" : "further-apart",
      more_severe: distance === 0 ? "equal" : panelSeverity.rank < crSeverity.rank ? PANEL : CODERABBIT,
      // A severity CodeRabbit did not state is a floor this project chose, and the
      // instruction on `SEVERITY_BASIS` is absolute: no severity-segmented number
      // may pool an unstated record with a stated one. Carried per class so the
      // census can split rather than drop.
      coderabbit_stated: members.filter((m) => m.arm === CODERABBIT).every((m) => m.finding.coderabbit?.severity_basis !== "unstated"),
      // Our arm has a floor too and it is the loud direction: `normalizeSeverity`
      // maps anything unrecognised to `major`, which BLOCKS. A lens emitting
      // "moderate" lands in the blocking population with `severity_raw` as its
      // only trace.
      panel_coerced: members.filter((m) => m.arm === PANEL).some((m) => !KNOWN.includes(m.finding.severity_raw)),
    };
  }
  return {
    id: group.id,
    item: group.item,
    claim,
    size: group.size,
    panel_claims: panelSeverity?.claims ?? 0,
    coderabbit_claims: crSeverity?.claims ?? 0,
    panel_runs: panelRuns,
    files: [...new Set(members.map((m) => m.finding.file).filter((f) => typeof f === "string" && f !== ""))].sort(),
    summary: members[0]?.finding.summary ?? null,
    severity,
    // Every `maybe` and every match complete linkage declined, as ids. A class with
    // candidates is one a curator should look at before anybody quotes it as a
    // unique catch — the policy's cost, made visible rather than implied by an
    // absence.
    candidates: group.candidates,
  };
}

/** The five counts and the overlap they define, over one set of class rows. Spec
 *  §3.5's Jaccard: of every defect class either arm raised, the share both did. */
function overlapOf(rows) {
  const counts = Object.fromEntries(CLAIMS.map((c) => [c, 0]));
  for (const row of rows) counts[row.claim]++;
  const n = counts.both + counts["panel-only"] + counts["coderabbit-only"];
  return {
    classes: n,
    both: counts.both,
    panel_only: counts["panel-only"],
    coderabbit_only: counts["coderabbit-only"],
    // Never inside `classes`: a class nobody can attribute is a hole in the input,
    // and a class no arm claims in this view was dropped BY the view.
    no_arm: counts["no-arm"],
    not_claimed_in_view: counts["not-claimed-in-view"],
    jaccard: share(counts.both, n),
    panel_unique_rate: share(counts["panel-only"], n),
    coderabbit_unique_rate: share(counts["coderabbit-only"], n),
  };
}

/**
 * HOW MUCH OF THE OVERLAP IS STILL UNDECIDED — the number that says how firm the
 * headline is.
 *
 * `groupFindings` never merges a `maybe`: an ambiguous pair becomes a link and its
 * two findings stay in two classes. That fail direction is right (a false match
 * suppresses a candidate and a suppressed candidate is a miss nobody recovers)
 * but it means every unresolved cross-arm pair is currently counted as TWO unique
 * catches, one for each arm. So the reported overlap is a LOWER BOUND, and the
 * size of the gap is exactly the number of CodeRabbit classes that have a panel
 * class the matcher called `maybe`.
 *
 * The upper bound moves the denominator too: merging m pairs adds m to `both` and
 * removes m classes from the union. Stated as a bound and never as the headline —
 * resolving a `maybe` needs a curator or the designed-and-unbuilt L3, and both are
 * somebody else's PR.
 */
function unresolvedCrossArm(links, classes, overlap, memberOfDigest) {
  const armsOf = new Map(classes.map((c) => [c.id, { panel: c.panel_claims > 0, coderabbit: c.coderabbit_claims > 0 }]));
  const itemOf = new Map(classes.map((c) => [c.id, c.item]));
  // A link joins two FINDINGS, and the arms that decide whether it is cross-arm are
  // theirs — not those of the classes they landed in.
  //
  // Keying this off the classes over-counts, and not by a rounding error: a SHARED
  // class carries both arms, so a link from it to a panel-only class satisfies
  // "one side has panel, the other has coderabbit" while joining two panel
  // findings. Measured on the pilot's first replicate, that read 424 where the
  // true count is 412 — and 412 is what an independent inspector gets pairing every
  // panel record against every CodeRabbit record through `matchFindings` directly.
  // `link.members` carries the two digests and `groupFindings`' own group members
  // carry each digest's arm, so the honest answer needs no new data — but it does
  // need the RAW groups: the class rows this module reports deliberately do not
  // carry members, and reading `c.members ?? []` off them silently yielded an empty
  // map and a queue of zero.
  const crWithCandidate = new Set();
  const panelWithCandidate = new Set();
  const pairs = [];
  for (const link of links) {
    if (link.verdict !== "maybe") continue;
    const memberArms = link.members.map((d) => memberOfDigest.get(d)?.arm ?? null);
    if (memberArms[0] === null || memberArms[1] === null || memberArms[0] === memberArms[1]) continue;
    // BOTH classes must be in scope before this pair is counted anywhere.
    //
    // `links` spans every item the grouping saw, while `classes` here is the SCORED
    // set — comparable items only. A link on an item one arm never answered for
    // therefore resolves to no class, and counting it would give the queue a
    // different denominator from the overlap it qualifies: measured, a
    // non-comparable item contributed a pair with `item: null` to a queue whose
    // every other row belongs to an item that was actually scored.
    const [a, b] = link.groups.map((id) => armsOf.get(id));
    if (!a || !b) continue;
    // WHICH SIDE IS WHICH, because a pair label's key is order-dependent — panel
    // side first — and `link.members` is in the grouping's own order, not the arms'.
    // Swapping them produces a different 12-hex key, which does not throw and does
    // not warn: it silently matches nothing, and a label store that resolves zero
    // pairs looks exactly like a store nobody has filled.
    const panelSide = memberArms[0] === PANEL ? 0 : 1;
    const panelDigest = link.members[panelSide];
    const crDigest = link.members[1 - panelSide];
    pairs.push({
      score: link.score,
      groups: [...link.groups],
      item: itemOf.get(link.groups[0]) ?? null,
      // ADDED, never replacing `groups` — a curator works from the pair key and the
      // class ids answer a different question. The key is what joins this row to
      // `labels/<cv>/pairs/<pair_key>.json`, so printing it makes the queue
      // adjudicable without a second tool to compute it.
      pair_key: pairLabelKey(memberOfDigest.get(panelDigest)?.finding, memberOfDigest.get(crDigest)?.finding),
      // `link.groups[i]` is the class of `link.members[i]` — the two arrays are built
      // from the same pair in the same order, which is what makes this index safe.
      panel_class: link.groups[panelSide],
      coderabbit_class: link.groups[1 - panelSide],
    });
    // The CLASS each of those findings sits in is what could become shared, so the
    // candidate sets stay class-keyed — and view-aware, since `intersection`
    // narrows what counts as a panel claim.
    for (const [id, arms] of [[link.groups[0], a], [link.groups[1], b]]) {
      if (arms.coderabbit && !arms.panel) crWithCandidate.add(id);
      if (arms.panel && !arms.coderabbit) panelWithCandidate.add(id);
    }
  }
  // STRONGEST FIRST, because the queue is a work list rather than a count and its
  // head is the only part anybody will read. Ties broken on the class ids, which
  // are content-derived, so two runs over one dataset print in one order.
  pairs.sort((p, q) => q.score - p.score || p.groups[0].localeCompare(q.groups[0]) || p.groups[1].localeCompare(q.groups[1]));
  const m = crWithCandidate.size;
  const both = overlap.both + m;
  const total = overlap.classes - m;
  return {
    maybe_links: pairs.length,
    // The whole queue, strongest first — not a top-N. A cap here would be silent
    // truncation of the one artefact a curator would work from.
    pairs,
    triage_threshold: TRIAGE_SCORE,
    // WHAT THE QUEUE ACTUALLY COSTS. The count alone reads as intractable and is
    // not: the score distribution is bottom-heavy, because L2 hands a `maybe` to
    // any cross-source pair with a location tie, and two findings on one file have
    // a location tie by construction. So most of the queue is same-file-different-
    // subject and the triage is the head of it. Printed beside the total for that
    // reason, never instead of it.
    strong_maybe_links: pairs.filter((p) => p.score >= TRIAGE_SCORE).length,
    coderabbit_classes_with_a_panel_candidate: m,
    panel_classes_with_a_coderabbit_candidate: panelWithCandidate.size,
    both_upper_bound: both,
    jaccard_upper_bound: share(both, total),
    // TRUE when every coderabbit-only class has an undecided panel candidate, i.e.
    // the ceiling is "all of them" and therefore says nothing. Measured rather than
    // assumed either way, and it is not a corner case: L2 returns `maybe` for any
    // cross-source pair with a location tie that misses the token bar, so two
    // findings on ONE FILE are undecided by default. A saturated bound means the
    // matcher cannot currently separate "CodeRabbit caught something we missed"
    // from "we said the same thing in different words" — which bounds how hard the
    // unique-catch counts may be read, and is not fixable inside a scorer.
    saturated: overlap.coderabbit_only > 0 && m === overlap.coderabbit_only,
  };
}

/**
 * THE BAND AGAIN, WITH THE ADJUDICATED PAIRS TAKEN INTO ACCOUNT — one resolution per
 * trust tier, never a pooled one.
 *
 * The headline is the GOLD tier's, and that is a decision rather than a default: a
 * silver pair labeler exists for this corpus, failed its own pre-registered
 * validation at 17/23, and its verdicts were deliberately kept out of the store. If
 * they ever land, the gold-only band must still be computable and a reader must be
 * able to see which tier moved which number — so every tier present gets its own
 * entry, `headline` names the one the band above it came from, and there is no code
 * path that averages two tiers' verdicts on one pair.
 *
 * `opts.pairLabels` is the `readPairLabels` result, NOT a bare array: the result
 * carries whether the directory exists and what it could not read, and those are the
 * difference between "nobody has adjudicated this corpus" and "adjudicated, and three
 * files are corrupt". A bare array cannot say either, so it is refused.
 */
function labelledBands(scored, pairs, overlap, opts) {
  const store = opts.pairLabels ?? null;
  const emptyStore = { present: false, dir: null, n: 0, unreadable: [], invalid: [] };
  if (store === null || store === undefined) {
    // A caller that passed nothing. Reported as a state rather than as an absent key,
    // so a reader of the payload can tell "no labels were offered to this scoring
    // run" from "labels were offered and resolved nothing".
    return { availability: "not-supplied", tier: null, headline: null, by_tier: {}, store: emptyStore, census: pairLabelCensus([]) };
  }
  if (Array.isArray(store) || !(typeof store === "object" && Array.isArray(store.labels))) {
    refuse(
      `opts.pairLabels must be the object readPairLabels(root, corpusVersion) returns ({ present, labels, unreadable, invalid }), got ` +
        `${Array.isArray(store) ? "a bare array" : JSON.stringify(store)} — a bare list cannot say whether the label store exists or what in it was unreadable, ` +
        `and those are two of the states the band's provenance has to distinguish`,
    );
  }
  const classRows = scored.map((c) => ({ id: c.id, item: c.item, claim: c.claim }));
  const byTier = {};
  for (const tier of LABEL_SOURCES) {
    if (!store.labels.some((L) => L.label_source === tier)) continue;
    byTier[tier] = resolveClasses({ classes: classRows, pairs, labels: store.labels, diffShaOf: opts.diffShaOf, runId: opts.runId ?? null, tier });
  }
  // Gold, or the most trusted tier the store actually holds. Named in the payload so
  // a report can never present a silver-moved band as the headline by accident.
  const headlineTier = LABEL_SOURCES.find((t) => Object.hasOwn(byTier, t)) ?? null;
  const headline = headlineTier === null
    ? resolveClasses({ classes: classRows, pairs, labels: [], diffShaOf: opts.diffShaOf, runId: opts.runId ?? null, tier: "gold" })
    : byTier[headlineTier];
  return {
    // `store-empty` is what the resolver can see; the scorer knows whether the
    // directory was there at all, so it says which.
    availability: store.labels.length === 0 && !store.present ? "no-store" : headline.availability,
    tier: headlineTier,
    headline,
    by_tier: byTier,
    store: {
      present: store.present === true,
      dir: store.dir ?? null,
      n: store.labels.length,
      unreadable: Array.isArray(store.unreadable) ? store.unreadable : [],
      invalid: Array.isArray(store.invalid) ? store.invalid : [],
    },
    // Over EVERY tier, unlike the band: a census is a description of the store and
    // pooling tiers in a description is not the bug — pooling them in an arithmetic is.
    census: pairLabelCensus(store.labels),
    // The unlabelled band, restated here so the two are side by side in one place.
    // `overlap.jaccard` keeps its own meaning above; this is a copy, not a move.
    unlabelled: { jaccard: overlap.jaccard, classes: overlap.classes, both: overlap.both },
  };
}

/** The severity-agreement census over shared classes, SPLIT by whether CodeRabbit
 *  stated the severity it is being compared on. */
function severityCensus(rows) {
  const shared = rows.filter((r) => r.claim === "both" && r.severity !== null);
  const stated = shared.filter((r) => r.severity.coderabbit_stated);
  const census = (list) => ({
    n: list.length,
    exact: list.filter((r) => r.severity.agreement === "exact").length,
    adjacent: list.filter((r) => r.severity.agreement === "adjacent").length,
    "further-apart": list.filter((r) => r.severity.agreement === "further-apart").length,
    panel_more_severe: list.filter((r) => r.severity.more_severe === PANEL).length,
    coderabbit_more_severe: list.filter((r) => r.severity.more_severe === CODERABBIT).length,
    exact_rate: share(list.filter((r) => r.severity.agreement === "exact").length, list.length),
  });
  return {
    shared_classes: rows.filter((r) => r.claim === "both").length,
    // Shared classes with no comparable severity pair at all. Unreachable through
    // the adapters — `validateFindingRecord` refuses a severity outside `KNOWN` —
    // and counted anyway, because "0 because there were none" and "0 because the
    // branch was never written" look identical in a report.
    uncomparable: rows.filter((r) => r.claim === "both" && r.severity === null).length,
    stated: census(stated),
    // NOT pooled with the above, and reported rather than dropped: these compare
    // our rubric against a floor nobody stated, which is a different question.
    unstated: census(shared.filter((r) => !r.severity.coderabbit_stated)),
    panel_coerced: shared.filter((r) => r.severity.panel_coerced).length,
  };
}

/**
 * Complementarity over finding records from both arms. Pure: records in, counts
 * out, no store, no network, no clock.
 *
 * `opts`:
 *   coverage    REQUIRED. `[{ arm, item_id, state }]` — see `coverageIndex`.
 *   view        one of `VIEWS`; default `per-replicate`, which refuses K > 1.
 *   label       free text carried into `stats.label`, so a printed result says
 *               which draw it is of.
 *   threshold   passed through to `groupFindings`; the matcher owns the default.
 *   pairLabels  OPTIONAL. The `readPairLabels(root, cv)` result. Omitting it leaves
 *               every count below exactly as it was before labels existed and the
 *               payload's `labels.availability` reads `not-supplied`.
 *   diffShaOf   `itemId -> "sha256:…"`. REQUIRED WHENEVER `pairLabels` is given: it
 *               is the drift guard's only input, and an optional guard input is not
 *               a guard.
 *   runId       the replicate being scored, so a verdict adjudicated on another draw
 *               is counted as such rather than silently applied.
 */
export function complementarityOf(records, opts = {}) {
  const view = opts.view ?? "per-replicate";
  if (!VIEWS.includes(view)) refuse(`view must be one of ${VIEWS.join(" | ")}, got ${JSON.stringify(view)}`);
  const supplied = Array.isArray(records) ? records : [];
  const input = supplied.filter((r) => r && typeof r === "object" && !Array.isArray(r));
  // Counted, not swallowed. `groupFindings` records its own non-finding inputs in
  // `stats.skipped` with their positions, and anything dropped HERE never reaches
  // it — so without this the two censuses disagree and a caller that passed an
  // array half full of nulls reads a clean run over the half that survived.
  const malformed = supplied.length - input.length;
  const foreign = input.filter((r) => !ARMS.includes(r.arm));
  if (foreign.length > 0) refuse(`${foreign.length} record(s) carry an arm outside ${ARMS.join(" | ")} (first: ${JSON.stringify(foreign[0].arm)})`);

  const coverage = coverageIndex(opts.coverage);
  const panelRuns = assertScorable(input, coverage, view);
  assertLensPresent(input);
  const window = assertComparableWindow(input);

  const grouped = groupFindings(input.map(groupable), { threshold: opts.threshold });
  const replicates = panelRuns.filter((r) => r !== "(none)");
  const classes = grouped.groups.map((g) => classify(g, { view, replicates }));
  // digest → the arm AND the finding, off the raw groups, because a link joins two
  // findings and the class each landed in carries whichever arms merged into it. The
  // finding comes along because a pair label's key is computed from both sides' text,
  // and only the raw groups still hold it: the class rows this module reports
  // deliberately do not carry members.
  const memberOfDigest = new Map();
  for (const g of grouped.groups) for (const m of g.members) memberOfDigest.set(m.digest, { arm: m.arm, finding: m.finding });

  // An item is COMPARABLE only when every arm answered for it. The cross-arm
  // numbers are computed over those items alone, because an item where one arm is
  // `absent` contributes classes to the other arm and none to it — which reads in
  // the output as a unique catch and is nothing of the kind.
  const comparable = coverage.items.filter((item) => ARMS.every((arm) => coverage.stateOf(arm, item) === "present"));
  const comparableSet = new Set(comparable);
  const scored = classes.filter((c) => comparableSet.has(c.item));

  const byItem = {};
  for (const item of coverage.items) {
    const rows = classes.filter((c) => c.item === item);
    byItem[item] = {
      comparable: comparableSet.has(item),
      arms: Object.fromEntries(
        ARMS.map((arm) => [
          arm,
          {
            state: coverage.stateOf(arm, item),
            findings: input.filter((r) => r.arm === arm && itemKey(r.item_id) === item).length,
            classes: rows.filter((c) => (arm === PANEL ? c.panel_claims > 0 : c.coderabbit_claims > 0)).length,
          },
        ]),
      ),
      overlap: overlapOf(rows),
      severity: severityCensus(rows),
    };
  }

  const byArm = Object.fromEntries(
    ARMS.map((arm) => {
      const only = scored.filter((c) => c.claim === `${arm}-only`).length;
      const both = scored.filter((c) => c.claim === "both").length;
      return [
        arm,
        {
          findings: input.filter((r) => r.arm === arm).length,
          findings_comparable: input.filter((r) => r.arm === arm && comparableSet.has(itemKey(r.item_id))).length,
          items: tally(coverage.items, (item) => coverage.stateOf(arm, item)),
          classes: both + only,
          shared: both,
          only,
          // Of everything this arm raised, the share the other arm did not. Its
          // denominator is this arm's classes, NOT the union — the two answer
          // different questions and only this one is per-arm.
          only_rate: share(only, both + only),
        },
      ];
    }),
  );

  const g = grouped.stats;
  const concerns = [];
  const note = (n, msg) => {
    if (n) concerns.push(`${msg} (${n})`);
  };
  note(malformed, "inputs dropped before grouping: not a record object");
  note(g.skipped.length, "inputs skipped by grouping");
  note(g.accessor_failures.length, "accessor failures during grouping");
  note(g.unattributed, "findings naming no pull request, grouped with nothing");
  note(g.gate.defaulted, "pairs whose provenance was unreadable, gated by the fallback rule");
  note(g.intra_group_non_match, "non-match pairs INSIDE a class — complete linkage is broken");
  note(g.links.maybe, "maybe links: candidate merges the matcher would not make");
  note(g.links.match_held_apart, "matches complete linkage declined");
  note(g.no_evidence_pairs, "pairs refused for carrying no token and no anchor");
  note(g.id_collisions, "classes that digested alike and took an occurrence suffix");
  note(classes.filter((c) => c.claim === "no-arm").length, "classes whose members carry no readable arm");
  note(coverage.items.length - comparable.length, "items not comparable: an arm did not answer");
  note(window.by_window.unplaceable ?? 0, "CodeRabbit findings whose snapshot could not be placed");
  note(window.by_window["no-window"] ?? 0, "CodeRabbit findings on a pull request this corpus never froze");

  const overlap = overlapOf(scored);
  const unresolved = unresolvedCrossArm(grouped.links, scored, overlap, memberOfDigest);
  const labels = labelledBands(scored, unresolved.pairs, overlap, opts);
  note(labels.store.unreadable.length, "pair label file(s) that could not be read");
  note(labels.store.invalid.length, "pair label file(s) refused by the record validator");
  // Only where it is an ANOMALY. On a replicate no label was adjudicated on,
  // "every label matches nothing here" is the definition of `none-for-replicate`
  // rather than a finding about it, and raising it as a concern would put a warning
  // on the two replicates that are behaving exactly as expected — which is how a real
  // drift signal (`none-matched`: labels DO name this run and still match nothing)
  // gets lost in a list of three identical notes.
  if (labels.availability !== "none-for-replicate") {
    note(labels.headline?.labels.unmatched.length ?? 0, "pair label(s) matching no undecided pair in this replicate");
  }
  // A ceiling that moves is what everyone WANTS this to do, so it is called out as a
  // concern rather than left to be noticed: on a partial label set it must not move,
  // and the only thing that legitimately moves it is a class every one of whose pairs
  // is decided.
  if (labels.headline?.band.ceiling_moved) {
    concerns.push(`the label-resolved CEILING moved: ${labels.headline.resolution.coderabbit_only_finished_apart} coderabbit-only class(es) had every pair decided`);
  }
  return {
    classes,
    byArm,
    byItem,
    overlap,
    severity: severityCensus(scored),
    unresolved,
    // NEW, and additive: every field above keeps the meaning it had before labels
    // existed. `overlap.jaccard` is still the unlabelled floor and
    // `unresolved.jaccard_upper_bound` still the unlabelled ceiling, so a consumer
    // that has never heard of a label renders exactly what it rendered before.
    labels,
    stats: {
      view,
      label: typeof opts.label === "string" ? opts.label : null,
      linkage: LINKAGE,
      // How many tries each arm got. The one number that makes a pooled view
      // readable as a bound rather than as a result.
      draws: { panel: replicates.length || (panelRuns.length ? 1 : 0), coderabbit: 1 },
      panel_runs: panelRuns,
      records: {
        n: input.length,
        panel: input.filter((r) => r.arm === PANEL).length,
        coderabbit: input.filter((r) => r.arm === CODERABBIT).length,
        // Supplied but not a record object, so never grouped and never counted
        // anywhere else. A number rather than a note alone, because `n` is a
        // denominator and this says what it is missing.
        malformed,
      },
      items: { declared: coverage.items, comparable, not_comparable: coverage.items.filter((i) => !comparableSet.has(i)) },
      window,
      // Surfaced whole, never summarised: every one of these is a denominator or a
      // hole in one, and a scorer that swallows them reports a clean run over an
      // input it silently narrowed.
      grouping: g,
      concerns,
    },
  };
}

// --- CLI: read a store, print the counts. Writes nothing. --------------------

/**
 * Every `--run-id` on the command line, in order.
 *
 * `parseArgs` is single-valued by construction — `a[key] = argv[i + 1]` — so a
 * repeated flag keeps only the last one, and a run of three replicates would
 * silently score one. Collected here rather than by teaching `parseArgs` to
 * accumulate: that function is shared by six CLIs in this family and a flag that
 * became an array only when repeated would change what every one of them reads.
 */
export function runIdsFrom(argv) {
  const out = [];
  const list = Array.isArray(argv) ? argv : [];
  for (let i = 2; i < list.length; i++) {
    if (list[i] !== "--run-id") continue;
    const value = list[i + 1];
    if (typeof value !== "string" || value.startsWith("--")) continue;
    out.push(value);
    i++;
  }
  return out;
}

const USAGE =
  "usage: complementarity.mjs --root <eval-data-root> --corpus-version <v> --run-id <id> [--run-id <id> ...]\n" +
  "                           [--item <item-id>] [--json]\n" +
  "\n" +
  "Overlap, unique-to-arm and severity agreement between our review panel and\n" +
  "CodeRabbit, over defect classes from finding-match.mjs. Reads only; writes\n" +
  "nothing into the store, spawns nothing and costs nothing. The CodeRabbit arm\n" +
  "makes read-only GitHub API calls, exactly as its adapter does.\n" +
  "\n" +
  "--run-id is REPEATABLE and each one is scored as its own draw against\n" +
  "CodeRabbit's single historical review. The per-replicate numbers are the\n" +
  "headline; the union and intersection of the replicates are printed after them,\n" +
  "labelled as bounds.\n" +
  "\n" +
  "Adjudicated pairs under <root>/labels/<corpus-version>/pairs/ are read if they\n" +
  "are there and reported per replicate and per trust tier, never pooled across\n" +
  "tiers. A `same` verdict raises the floor; only a CodeRabbit class with EVERY\n" +
  "one of its pairs decided can move the ceiling. Nothing is written.";

const pct = (r) => (r === null ? "n/a" : `${(r * 100).toFixed(1)}%`);

/**
 * WHAT THE ADJUDICATED PAIRS DID TO THIS REPLICATE'S BAND, in the report.
 *
 * Six of the seven availability states print a REASON rather than a number, because
 * every one of them is a different sentence and "the band did not move" is the same
 * output for all of them. The state a reader is most likely to misread is
 * `none-for-replicate`: k1 and k3 have no labels at all, so their band is the
 * unlabelled one, and a line saying nothing would leave it looking adjudicated.
 */
function labelLines(labels) {
  if (!labels) return "";
  const a = labels.availability;
  if (a === "not-supplied") return "";
  const why = {
    "no-store": "no pair labels are filed for this corpus version, so the band is the unlabelled one",
    "store-empty": "the pair label store holds no usable record, so the band is the unlabelled one",
    "none-for-replicate": "no pair label was adjudicated on this replicate and none of the store's keys appears in its queue, so the band is the unlabelled one",
    "none-matched": "pair labels name this replicate and NONE matches a live undecided pair — every key has moved or been promoted, so the band is the unlabelled one",
  };
  if (Object.hasOwn(why, a)) return `\n  pair labels: ${why[a]} (store: ${labels.store.n} record(s))`;
  const h = labels.headline;
  const r = h.resolution;
  const b = h.band;
  return (
    `\n  pair labels (${h.tier} only, never pooled across tiers): ${h.labels.applied} of ${h.labels.in_tier} ${h.tier} label(s) match a live undecided pair` +
    ` — same ${h.labels.by_verdict.same ?? 0} · different ${h.labels.by_verdict.different ?? 0} · insufficient-basis ${h.labels["by_verdict"]["insufficient-basis"] ?? 0}` +
    `\n  label-resolved band: ${b.after.both}/${b.after.classes} = ${pct(b.after.jaccard)} .. ${b.after.both_upper_bound}/${b.after.classes_at_ceiling} = ${pct(b.after.jaccard_upper_bound)}` +
    `   (unlabelled: ${pct(b.before.jaccard)} .. ${pct(b.before.jaccard_upper_bound)})` +
    `\n    ${r.coderabbit_only_resolved_same} coderabbit-only class(es) resolved SHARED · ${r.coderabbit_only_finished_apart} finished apart` +
    ` · ${r.coderabbit_only_still_undecided} still undecided` +
    // The reason the ceiling holds still, printed every time rather than only when
    // somebody asks: a `same` verdict adds to the ceiling's numerator exactly what it
    // removes from its denominator, so only a FINISHED class can move it.
    (b.ceiling_moved
      ? `\n    the ceiling MOVED, because ${r.coderabbit_only_finished_apart} class(es) had every pair decided`
      : `\n    the ceiling is unchanged BY CONSTRUCTION: no coderabbit-only class has every one of its pairs decided, and a \`same\` verdict cancels between the ceiling's numerator and its denominator`) +
    (r.labels_on_already_shared_class
      ? `\n    ! ${r.labels_on_already_shared_class} \`same\` label(s) sit on a class BOTH arms already claim — counted nowhere, because their class is already in \`both\``
      : "") +
    (r.fanout.length
      ? `\n    ! ${r.fanout.length} coderabbit class(es) are \`same\` with MORE THAN ONE panel class. The panel's own classes stay apart:` +
        ` the matcher owns that partition and nobody adjudicated those panel/panel pairs`
      : "") +
    (h.labels.unmatched.length
      ? `\n    ! ${h.labels.unmatched.length} ${h.tier} label(s) match no undecided pair here (promoted to a match, or the finding's text was re-parsed and the key moved) — listed in --json, not dropped`
      : "") +
    (h.labels.cross_replicate ? `\n    ! ${h.labels.cross_replicate} verdict(s) were adjudicated on a different draw of the same corpus, and applied because the key is content-derived` : "") +
    (Object.keys(h.labels.other_tiers).length
      ? `\n    ! tier(s) NOT in this band: ${Object.entries(h.labels.other_tiers).map(([t, n]) => `${t}=${n}`).join(" · ")} — resolved separately under labels.by_tier, never averaged with ${h.tier}`
      : "")
  );
}

/** One view's block of the report. Every proportion carries its `n`. */
function reportView(title, result) {
  const o = result.overlap;
  const s = result.severity;
  const u = result.unresolved;
  console.error(
    `\n${title}` +
      `\n  draws: panel ${result.stats.draws.panel} · coderabbit ${result.stats.draws.coderabbit}` +
      `\n  ${o.classes} defect class(es) over ${result.stats.items.comparable.length} comparable item(s)` +
      ` from ${result.stats.records.panel} panel + ${result.stats.records.coderabbit} coderabbit finding(s)` +
      `\n  both arms:        ${o.both}/${o.classes} = ${pct(o.jaccard)}   (overlap, spec §3.5 Jaccard)` +
      `\n  panel only:       ${o.panel_only}/${o.classes} = ${pct(o.panel_unique_rate)}` +
      `\n  coderabbit only:  ${o.coderabbit_only}/${o.classes} = ${pct(o.coderabbit_unique_rate)}` +
      // A `maybe` never merges, so every undecided cross-arm pair is currently
      // counted as two unique catches. The headline is therefore a LOWER bound and
      // this line is how far it could move if a curator resolved them all.
      `\n  overlap is a LOWER bound: ${u.coderabbit_classes_with_a_panel_candidate} of ${o.coderabbit_only} coderabbit-only class(es)` +
      ` have a panel candidate the matcher left undecided (${u.maybe_links} cross-arm maybe link(s)), so at most` +
      ` ${u.both_upper_bound}/${o.classes - u.coderabbit_classes_with_a_panel_candidate} = ${pct(u.jaccard_upper_bound)}` +
      (u.saturated
        ? `\n  ! THE CEILING IS SATURATED and therefore uninformative: EVERY coderabbit-only class has an undecided panel` +
          ` candidate. Read "${o.coderabbit_only} unique to CodeRabbit" as ${o.coderabbit_only} UNRESOLVED pairs, not as ${o.coderabbit_only} established misses`
        : "") +
      // The queue is bottom-heavy, so its size and its cost are different numbers
      // and printing only the first reads as intractable.
      `\n  the undecided queue is triageable: ${u.strong_maybe_links} of ${u.maybe_links} pair(s) score >= ${u.triage_threshold}` +
      ` (strongest first in --json; the rest are mostly same-file, different subject)` +
      labelLines(result.labels) +
      (o.not_claimed_in_view ? `\n  ! ${o.not_claimed_in_view} class(es) dropped BY this view — our arm raised them, but not in every replicate` : "") +
      (o.no_arm ? `\n  ! ${o.no_arm} class(es) whose members carry no readable arm — counted nowhere, credited to nobody` : "") +
      `\n  severity agreement on the ${s.stated.n} shared class(es) CodeRabbit stated a severity for:` +
      ` exact ${s.stated.exact} · adjacent ${s.stated.adjacent} · further ${s.stated["further-apart"]}` +
      ` · panel harsher ${s.stated.panel_more_severe} · coderabbit harsher ${s.stated.coderabbit_more_severe}` +
      (s.unstated.n ? `\n  ! ${s.unstated.n} shared class(es) compare against a severity CodeRabbit never stated — reported apart, never pooled` : "") +
      (s.panel_coerced ? `\n  ! ${s.panel_coerced} shared class(es) carry a panel severity normalizeSeverity coerced to major` : ""),
  );
  for (const c of result.stats.concerns) console.error(`  ! ${c}`);
}

/** Per item, for the headline view only: the asymmetry is per item too, and an
 *  arm/item state is printed even when it is `present` and boring. */
function reportItems(result) {
  console.error("\n  per item (headline replicate):");
  for (const [item, row] of Object.entries(result.byItem)) {
    const arms = ARMS.map((a) => `${a} ${row.arms[a].state}/${row.arms[a].findings}f`).join(" · ");
    console.error(
      `    ${item}: ${arms}` +
        ` → both ${row.overlap.both} · panel-only ${row.overlap.panel_only} · coderabbit-only ${row.overlap.coderabbit_only}` +
        ` · overlap ${pct(row.overlap.jaccard)} (n=${row.overlap.classes})` +
        (row.comparable ? "" : "   ⚠ NOT COMPARABLE — an arm did not answer"),
    );
  }
}

async function main() {
  const args = parseArgs(process.argv, { booleans: ["json", "help"] });
  if (args.help) {
    console.log(USAGE);
    return;
  }
  const runIds = runIdsFrom(process.argv);
  // `--root` is REQUIRED and has no default anywhere in this directory: git
  // history is permanent, so one flag that fell back to a path inside this
  // repository would commit benchmark data into `wafflebase` for good. There is no
  // `--out` for the same reason (`extract-corpus.mjs` names it: the fork harness
  // called this `--out`); this CLI writes nothing at all.
  if (!args.root || !args["corpus-version"] || runIds.length === 0) {
    console.error(USAGE);
    process.exit(2);
  }
  // A REPEATED run id is a typo, and it is the expensive kind. Each `--run-id` is
  // scored as an independent draw, so naming one twice prints the same replicate
  // twice and reports a range across "two" draws that is really one. Worse, the
  // union and intersection views are fed that leg's records TWICE while
  // `stats.draws` still reads 1, because the draw count is derived from the
  // distinct run ids on the records. Deduping silently would hide the typo; this
  // is a usage error and it exits like one.
  const duplicates = [...new Set(runIds.filter((id, i) => runIds.indexOf(id) !== i))];
  if (duplicates.length > 0) {
    console.error(`--run-id must name distinct runs; repeated: ${duplicates.join(", ")}`);
    process.exit(2);
  }
  const { EvalStore } = await import("./store.mjs");
  const store = new EvalStore(args.root);
  const corpus = store.getCorpus(args["corpus-version"]);
  if (corpus === null) {
    console.error(`corpus version ${JSON.stringify(args["corpus-version"])} does not exist under ${args.root}`);
    process.exit(1);
  }
  const wanted = new Set(corpus.filter((it) => !args.item || it.id === args.item).map((it) => it.id));

  // --- the pair labels, and the drift guard's input ---------------------------
  //
  // Read once for the whole run: the labels are keyed by corpus version and pair
  // content, not by replicate, so every view resolves against one store.
  //
  // `sha256_diff` comes from each item's own `meta.json` rather than from the corpus
  // MANIFEST, which also carries a copy. The manifest's copy is written by
  // `extract-corpus.mjs` from the same field, so the two normally agree — but a
  // re-extraction is exactly the event the drift guard exists to catch, and checking a
  // label against a cached copy of the value would be checking it against something
  // that moves for the same reason.
  const pairLabels = readPairLabels(args.root, args["corpus-version"]);
  const diffSha = new Map();
  for (const itemId of corpus.map((it) => it.id)) {
    const input = store.getCorpusItemInput(itemId);
    if (input?.meta?.sha256_diff) diffSha.set(itemId, input.meta.sha256_diff);
  }
  const diffShaOf = (itemId) => diffSha.get(itemId) ?? null;
  if (pairLabels.labels.length > 0) {
    const census = pairLabelCensus(pairLabels.labels);
    const list = (t) => Object.entries(t).map(([k, n]) => `${k}=${n}`).join(" · ");
    console.error(
      `\npair label store · ${pairLabels.labels.length} record(s) under ${pairLabels.dir}: ${list(census.by_source)}` +
        ` · verdicts ${list(census.by_verdict)}` +
        // Provenance printed with the census rather than on request: a band resting on
        // verdicts flagged for re-adjudication is one a reader must not quote without
        // knowing that, and #801 moved six of these keys.
        (census.needs_readjudication ? ` · ${census.needs_readjudication} flagged for re-adjudication` : "") +
        (census.keys_moved ? ` · ${census.keys_moved} key(s) moved since adjudication` : ""),
    );
  }
  for (const bad of pairLabels.unreadable) console.error(`  ! unreadable pair label ${bad.file}: ${bad.reason}`);
  for (const bad of pairLabels.invalid) console.error(`  ! invalid pair label ${bad.file}: ${bad.reason}`);

  // --- read both arms, and record what each one could answer -----------------
  //
  // A coverage row per (arm, item, run), including the rows that say NOTHING WAS
  // THERE. An item a run never reached must be declared `absent` rather than left
  // out, because a missing row and a clean review produce the same zero classes
  // and only one of them is a data point.
  const coverage = [];
  const excluded = [];
  const panelByRun = new Map();
  for (const runId of runIds) {
    const run = store.getRun(runId);
    if (run === null) {
      console.error(`run ${runId} does not exist under ${args.root}`);
      process.exit(1);
    }
    if (run.runJson.corpus_version !== args["corpus-version"]) {
      console.error(`run ${runId} replayed corpus ${JSON.stringify(run.runJson.corpus_version)}, not ${JSON.stringify(args["corpus-version"])} — refusing to compare two corpora`);
      process.exit(1);
    }
    // `run.json`'s `status` is derived from every PLANNED ITEM BEING PRESENT, and
    // an `infra` error item writes an envelope — so `complete` is true of a leg
    // that failed two of seven items, and a plain re-dispatch skips them forever.
    // `items_ok` against `item_count` is the check that separates the two, and a
    // leg that fails it is refused rather than scored over the items that did work:
    // its missing items are holes, and the per-item rows below would report them as
    // an arm that answered with nothing.
    if (run.runJson.items_ok !== run.runJson.item_count) {
      console.error(
        `run ${runId} reports status ${JSON.stringify(run.runJson.status)} with items_ok ${run.runJson.items_ok} of ${run.runJson.item_count} — ` +
          `"complete" means every planned item is PRESENT, not that every item succeeded. Resume the run before scoring it`,
      );
      process.exit(1);
    }
    const records = [];
    const stored = new Set(store.listItems(runId));
    for (const itemId of [...wanted].sort()) {
      if (!stored.has(itemId)) {
        excluded.push({ run_id: runId, item_id: itemId, reason: "the run never stored this corpus item" });
        coverage.push({ arm: PANEL, item_id: itemId, run_id: runId, state: "absent" });
        continue;
      }
      const status = store.getItem(runId, itemId)?.envelope?.status ?? null;
      if (status !== "ok") {
        // Excluded and LABELLED, never silently: an error item is not a zero, and a
        // reader must be able to see the item vanish rather than infer it.
        excluded.push({ run_id: runId, item_id: itemId, reason: `item status ${JSON.stringify(status)}` });
        coverage.push({ arm: PANEL, item_id: itemId, run_id: runId, state: "absent" });
        continue;
      }
      const [item] = runRecords(store, runId, { population: "reported", itemId });
      coverage.push({ arm: PANEL, item_id: itemId, run_id: runId, state: item.population_state });
      records.push(...item.records);
    }
    panelByRun.set(runId, records);
  }

  const crRecords = [];
  for (const item of corpusRecords(store, args["corpus-version"], { itemId: args.item ?? null })) {
    coverage.push({ arm: CODERABBIT, item_id: item.item_id, run_id: null, state: item.population_state });
    crRecords.push(...item.records);
  }

  // --- the window census, asserted and printed before any number -------------
  const window = windowCensusOf(crRecords);
  console.error(
    `window census · ${crRecords.length} CodeRabbit record(s): ` +
      Object.entries(window.by_window).map(([k, n]) => `${k}=${n}`).join(" · ") +
      `\n  basis: ` + Object.entries(window.by_basis).map(([k, n]) => `${k}=${n}`).join(" · "),
  );
  // Thrown from `complementarityOf` too; done here as well so the refusal names the
  // census that was printed one line above it rather than arriving mid-scoring.
  assertComparableWindow(crRecords);

  for (const e of excluded) console.error(`  ! excluded ${e.run_id}/${e.item_id}: ${e.reason}`);

  // --- the headline: one draw against one draw, once per replicate ------------
  const perReplicate = runIds.map((runId) =>
    complementarityOf([...panelByRun.get(runId), ...crRecords], {
      // THIS replicate's rows only. Pooling the other legs' coverage here would
      // mark an item absent in one draw as absent in all of them, which is the
      // union view's answer arriving inside the headline.
      coverage: coverage.filter((c) => c.arm === CODERABBIT || c.run_id === runId),
      view: "per-replicate",
      label: runId,
      pairLabels,
      diffShaOf,
      runId,
    }),
  );
  console.error(`\n=== HEADLINE — one panel replicate against CodeRabbit's one review, ${runIds.length} time(s) ===`);
  for (const [i, result] of perReplicate.entries()) reportView(`replicate ${runIds[i]}`, result);

  const jaccards = perReplicate.map((r) => r.overlap.jaccard).filter((j) => j !== null);
  if (jaccards.length > 1) {
    console.error(
      `\n  overlap across ${jaccards.length} replicate(s): ${jaccards.map((j) => pct(j)).join(" · ")}` +
        ` — range ${pct(Math.min(...jaccards))}–${pct(Math.max(...jaccards))}.` +
        `\n  Quote the range, never a mean: a mean with no spread is a number that reads as a property of the panel.`,
    );
  }
  reportItems(perReplicate[0]);

  // --- the bounds, labelled, never mixed into the headline --------------------
  // NO PAIR LABELS ARE APPLIED HERE, deliberately. These two views pool K draws
  // against CodeRabbit's one, and a label resolves a pair inside ONE draw — so
  // resolving inside a pooled view would apply a per-replicate correction to a
  // deliberately unfair comparison and produce a number that is neither. The band is
  // reported per replicate and never pooled; that rule is the reason `VIEWS` exists,
  // and it does not stop applying because there are labels now.
  if (runIds.length > 1) {
    const all = [...runIds.flatMap((r) => panelByRun.get(r)), ...crRecords];
    console.error(`\n=== BOUNDS — NOT the headline. Our arm gets ${runIds.length} draws here and CodeRabbit still gets 1. ===`);
    reportView(`UPPER BOUND on our coverage: our arm at K=${runIds.length} vs CodeRabbit at K=1 (union of replicates)`, complementarityOf(all, { coverage, view: "union", label: "union" }));
    reportView(`what the panel finds RELIABLY: classes present in all ${runIds.length} replicates`, complementarityOf(all, { coverage, view: "intersection", label: "intersection" }));
  }

  if (args.json) {
    console.log(JSON.stringify({ per_replicate: perReplicate, excluded }, null, 2));
  }
  // A partial result must not be quotable as a complete one by ignoring stderr.
  if (excluded.length > 0 || perReplicate.some((r) => r.stats.items.not_comparable.length > 0)) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error("complementarity scorer failed:", e.message);
    process.exit(1);
  });
}
