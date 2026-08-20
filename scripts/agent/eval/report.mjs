// PERSIST a metric into the eval store's `scores/`, and RENDER a comparison out of
// `scores/` into `reports/`. The store README has documented both directories since
// #677 and nothing has ever written to either; this is their first writer.
//
// TWO HALVES, ONE JOB. The persist step files a scorer's `--json` under
// `scores/`; the renderer reads `scores/` and writes one markdown file under
// `reports/`. They are one module because they are one sentence — the store's
// documented paths finally have a writer — and because the second is worthless
// without the first: a renderer with nothing committed to read would have to invoke
// the scorers, and that is the failure mode this file exists to avoid (below).
//
// 🔴 WHY IT RENDERS FROM COMMITTED DATA AND NEVER FROM A SCORER. Two of the three
// merged scorers reach the CodeRabbit arm through `adapters/coderabbit.mjs`, which
// makes live `gh api` calls. So a renderer that invoked them would need network, a
// `gh` on PATH and a resolvable repository — and the failure is not a crash. With no
// repository context the adapter yields ZERO CodeRabbit records and a completely
// plausible empty result, so the report would print a one-armed comparison that
// looks like a two-armed one. Persisting first and rendering from `scores/` makes
// the render reproducible offline, and makes a missing arm a missing FILE, which is
// visible. `report.test.mjs` runs the renderer with no store and no network at all.
//
// 🔴 THE RENDERER IS TOLD WHAT TO EXPECT; IT DOES NOT DISCOVER IT. `--run-id` and
// `--config-hash` are required on the render path even though the store could be
// listed instead, and that is the single most important decision in this file.
// Absence is the thing this report has to be able to say — four scorers exist in
// the plan and two of them are unbuilt — and absence is only observable against a
// declared expectation. A renderer that rendered whatever it found would omit an
// unbuilt scorer's section silently, and a reader cannot tell an omitted section
// from a measured zero. So the sections are a fixed list (`SECTIONS`), every one of
// them appears in every report, and the ones with no score file say so.
//
// 🔴 IT READS NUMBERS AND NEVER COMPUTES ONE. Every figure below is a field of a
// scorer's payload. The exceptions are arithmetic the report is explicitly for —
// the min/max of three replicate values (decision 33: a summary statistic is not a
// distribution, so report `n` and a range beside every central figure), the
// severity-stratified count ratio between the arms (§3.1's volume comparison), and
// §2's two DIRECTIONAL RATES — and the first two are computed by helpers imported
// from the scorers that own them rather than re-derived here. If a number is wanted
// that no scorer emits, the answer is a scorer, not a line in this file.
//
// ⟳ THE THIRD EXCEPTION IS A PRESENTATION FIX, NOT A NEW METRIC. §2 led with a
// Jaccard, and that figure is arithmetically right and rhetorically wrong: the union
// is dominated by classes only the panel raised, so a low intersection-over-union
// reads as "the two reviewers barely agree" when what happened is that the panel
// matched a substantial share of what CodeRabbit raised AND raised a hundred-odd
// things besides. The same counts, stated directionally, say so. Both rates are
// `both / (both + <the other arm>_only)` over fields §2 already prints in its own
// table, and both carry their `n`. This is NOT the constant #828 declined: that one
// was hand-measured by another tool and would have frozen while the data moved.
// #828's actual rule — every printed figure must be derivable from the payload in
// front of it — is what makes these two admissible and that one not.
//
// FOUR STATES, NOT TWO, AND A BLANK CELL IS NONE OF THEM. Lesson 6 is that absent
// has more than one cause and pooling them is a scoring bug. In a rendered report
// the pooling happens in PRESENTATION: an empty table cell could mean the scorer is
// unbuilt, or that it ran and measured a real zero, or that the quantity is
// structurally unmeasurable, or that a real measurement was withheld for a thin
// denominator. Those are four different facts and a reader acts differently on each,
// so `AVAILABILITY` names them and `renderCell` gives each its own words. A `present`
// figure cannot even be spelled without its `n` and its unit — see `figure`.
//
// WHAT THIS REPORT IS NOT, WHICH IS MOST OF WHAT IT SAYS. It is the first artifact
// in this benchmark with an audience, and it will be read as "who won". Nothing in
// the data supports that reading: NO HUMAN HAS JUDGED WHETHER A SINGLE FINDING IS
// REAL. Every figure here is about how MUCH, how CONSISTENTLY and how CHEAPLY, never
// how WELL. The blank cost section, the saturated overlap ceiling, the one-armed
// reliability and the self-review confound are not disclaimers around the result —
// they are the result, and `renderLimits` puts them on the page rather than in a
// footnote for exactly that reason.

import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { KNOWN } from "../severity.mjs";
import { parseArgs } from "../gh-checks.mjs";
import { repeated, spread } from "./reliability.mjs";
import { LABEL_AVAILABILITY, LABEL_SOURCES } from "./pair-labels.mjs";
import { SCORE_SCOPES, byConfigSegment } from "./store.mjs";

const refuse = (msg) => {
  throw new Error(`report: ${msg}`);
};

/** Bumped when a field changes meaning, never when one is added. */
export const SCHEMA_VERSION = 1;

/**
 * Vocabularies this file's rendering depends on, checked AT IMPORT TIME against the
 * modules that own them — the same guard `volume-mix.mjs` and `complementarity.mjs`
 * install, for the same reason. Lesson 7: a check whose input stops arriving never
 * fires and never complains. A rename upstream must break the import rather than
 * quietly change what a table means.
 */
const pin = (what, ok) => {
  if (!ok) refuse(`${what} — a vocabulary this renderer reads has changed upstream, so its tables no longer mean what they say`);
};
// The severity table's ROW ORDER is `KNOWN`, and it is only a meaningful order if
// `KNOWN` is worst-first. A reordering would silently print the nit row where the
// critical row belongs, which no test comparing counts would catch.
pin(
  `KNOWN is ${JSON.stringify(KNOWN)}, expected a worst-first ordered scale`,
  KNOWN.length === 4 && KNOWN[0] === "critical" && KNOWN[1] === "major" && KNOWN[2] === "minor" && KNOWN[3] === "nit",
);
pin(`SCORE_SCOPES is ${JSON.stringify(SCORE_SCOPES)}, expected the store's two score scopes`, SCORE_SCOPES.length === 2 && SCORE_SCOPES.includes("per-run") && SCORE_SCOPES.includes("cross-run"));

/**
 * The scorer ids this report reads, and the scope each is filed under.
 *
 * `cost-latency-v1` is #791's own constant, chosen there precisely so that this PR
 * would have an id already agreed rather than inventing a second name for the same
 * file. `segmentation-v1` follows the same pattern for plan PR 14. Both are UNBUILT
 * today, which is why they are listed here at all: a section that does not exist in
 * this table cannot render "not computed", and a report that silently omits an
 * unbuilt metric is a report that overstates its own coverage.
 *
 * The three merged scorers write NEITHER `scorer_id` NOR `scope` into their
 * payloads — they were all written to print rather than to be filed — so both are
 * supplied at the call and `validateScore` only checks that a payload which does
 * carry them agrees. Back-filling them into three merged modules is not this PR's
 * business.
 */
export const SECTIONS = Object.freeze([
  { key: "volume", scorer_id: "volume-mix-v1", scope: "per-run", title: "Volume and severity mix" },
  { key: "complementarity", scorer_id: "complementarity-v1", scope: "cross-run", title: "Overlap between the arms" },
  { key: "reliability", scorer_id: "reliability-v1", scope: "cross-run", title: "Reliability of our panel" },
  { key: "cost_latency", scorer_id: "cost-latency-v1", scope: "cross-run", title: "Cost and latency" },
  { key: "segmentation", scorer_id: "segmentation-v1", scope: "cross-run", title: "Where each arm wins, by segment" },
]);

/** Every scorer id this module knows, so a `--scorer-id` typo is refused at the
 *  persist step rather than filing a payload the renderer will never look for. */
export const SCORER_IDS = Object.freeze(SECTIONS.map((s) => s.scorer_id));

/**
 * Corpus items whose diff is this project's OWN plumbing, so a review of one is a
 * SELF-REVIEW and every cross-arm statement drawn from it is confounded.
 *
 * LISTED RATHER THAN DERIVED, and the reason is that it is not derivable: it is a fact
 * about what a path MEANS to this repository, which no score payload carries and no
 * file-class heuristic decides. `pr-524`'s diff is two workflow files, and one of them
 * is the review panel's own.
 *
 * Keyed by item id, and `renderCaveats` INTERSECTS it with the corpus actually being
 * rendered rather than asserting it. The report is reachable for any
 * `--corpus-version`, so a hard-coded "one of the seven items is a self-review" states
 * a confound about items a different corpus does not contain — three lines under a
 * header table printing the real item list.
 */
export const SELF_REVIEW_ITEMS = Object.freeze({
  "pr-524": "`.github/workflows/agent-review-panel.yml` and `.github/workflows/agent-iterate-ci.yml` — the review panel's own workflow files",
});

/**
 * The only corpus items where BOTH arms ran in production on the same commit from
 * the same trigger — the one genuinely comparable latency pair that exists, and it is
 * n=2.
 *
 * LISTED RATHER THAN DERIVED, for the same reason `SELF_REVIEW_ITEMS` is and with the
 * same intersection guard: no score payload carries it. It is a fact about which
 * commits happen to hold `agent-review-*` check runs, and our arm's replayed
 * `duration_ms` is not it — the replay times a process, these times are wall clock
 * from `workflow_run: CI (requested)`, the same event CodeRabbit's second anchor uses.
 *
 * 🔴 IT LIVES IN THE LIMITS AND NEVER IN §4, and the direction is why. Our replay
 * median reads 9.3 min against CodeRabbit's 6.8, which is close enough to look like a
 * fair fight; in production on these two commits ours took 18.7 and 19.0 against 8.0
 * and 8.6, about **2.2x LONGER**. So §4's figures understate us by roughly that
 * factor, and printing this pair as a headline would swap one misleading number for
 * another at n=2. It is a stated limit on §4's minutes, not a result.
 */
export const PRODUCTION_LATENCY_PAIR = Object.freeze({
  "pr-549": { panel_min: 18.7, coderabbit_min: 8.0 },
  "pr-605": { panel_min: 19.0, coderabbit_min: 8.6 },
});

/**
 * WHY A FIGURE IS NOT ON THE PAGE, and there are three answers rather than one.
 *
 *   present         a real measurement. Carries its value, its `n` and its unit —
 *                   including when the value is ZERO, which is a measurement and
 *                   not an absence. "CodeRabbit raised 0 criticals across 30
 *                   findings" is a fact about CodeRabbit.
 *   not-computed    NOBODY MEASURED IT. No score file exists, because the scorer is
 *                   unmerged (`cost-latency-v1`, #791) or unbuilt
 *                   (`segmentation-v1`). Says nothing about the quantity.
 *   not-measurable  STRUCTURALLY UNAVAILABLE — the measurement cannot exist on this
 *                   data however long anyone runs it. CodeRabbit retest pairs are
 *                   `n=0` because CodeRabbit cannot be re-run; a per-severity ratio
 *                   against an arm that raised none of that severity has no
 *                   denominator. Carries the reason, always.
 *   suppressed      MEASURED AND WITHHELD, because the denominator is too thin to
 *                   report. Decision 12 predicted the pilot's segmentation grid
 *                   would be entirely blank under min-n and called that the correct
 *                   output. Carries `n` and the `min_n` it failed.
 *
 * 🔴 A BLANK CELL IS A SCORING BUG IN PRESENTATION FORM, because it could be any of
 * the four and a reader would guess. Every one of them renders as words.
 */
export const AVAILABILITY = Object.freeze(["present", "not-computed", "not-measurable", "suppressed"]);

/**
 * A real measurement. REFUSES WITHOUT `n` AND A UNIT, and that refusal is the whole
 * reason this constructor exists instead of an object literal.
 *
 * Decision 33: a summary statistic is not a distribution, so every central figure
 * carries its `n`. Decision 28: file-level and finding-level reproducibility
 * REVERSE each other on this very data — per file, blocking findings churn more
 * than average; per defect class, `major` is the most reproducible stratum — so a
 * figure that does not name its unit is not merely thin, it is ambiguous between two
 * true statements that point opposite ways. This kit quoted one at the other's unit
 * for a day. A guard that aborts is worth more than the convention it enforces.
 */
export function figure(value, n, unit) {
  if (!Number.isFinite(n) || n < 0) {
    refuse(`a figure needs its n (got ${JSON.stringify(n)}) — decision 33: a summary statistic is not a distribution`);
  }
  if (typeof unit !== "string" || unit.trim() === "") {
    refuse(`a figure needs its unit (got ${JSON.stringify(unit)}) — decision 28: reproducibility reverses between file level and finding level, so a unitless figure is ambiguous between two true answers`);
  }
  return { availability: "present", value, n, unit };
}

/** Nobody measured it. The reason names WHO would have, so a reader can tell an
 *  unbuilt scorer from a scorer that was not run. */
export function notComputed(reason) {
  if (typeof reason !== "string" || reason.trim() === "") refuse("notComputed needs a reason — a bare absence is the blank cell this file exists to prevent");
  return { availability: "not-computed", reason };
}

/** The measurement cannot exist on this data. Distinct from `notComputed` because
 *  running the scorer would not help, which is the only thing a reader wants to
 *  know here. */
export function notMeasurable(reason) {
  if (typeof reason !== "string" || reason.trim() === "") refuse("notMeasurable needs a reason — an unexplained \"not measurable\" cannot be told apart from the not-computed case");
  return { availability: "not-measurable", reason };
}

/**
 * Measured, and withheld for a thin denominator.
 *
 * BOTH `n` AND `min_n` COME FROM THE PAYLOAD and neither is defaulted here. The
 * threshold is the segmentation scorer's decision (plan PR 14, decision 12), and a
 * fallback in this file would let the renderer keep printing `< 5` after PR 14 moved
 * it — a caption that contradicts the grid it captions. So a suppressed cell that
 * cannot say what it failed is refused.
 */
export function suppressed(n, minN) {
  if (!Number.isFinite(n) || !Number.isFinite(minN)) {
    refuse(
      `a suppressed cell must carry both its n (got ${JSON.stringify(n)}) and the min_n it failed (got ${JSON.stringify(minN)}) — ` +
        "the threshold belongs to the segmentation scorer, and a default here would caption its grid with a number it no longer uses",
    );
  }
  return { availability: "suppressed", n, min_n: minN };
}

/**
 * One cell as words. The four states get four different sentences, and none of them
 * is empty.
 *
 * `fmt` formats a `present` value only. It never sees an absence, which is what
 * keeps a caller from formatting `null` into `"0.00"` — the exact substitution this
 * whole vocabulary exists to make unspellable.
 */
export function renderCell(cell, fmt = (v) => String(v)) {
  if (!cell || !AVAILABILITY.includes(cell.availability)) {
    refuse(`a cell must carry one of ${AVAILABILITY.join(" | ")}, got ${JSON.stringify(cell)} — an unlabelled cell is a blank cell`);
  }
  switch (cell.availability) {
    case "present":
      return `${fmt(cell.value)} (n=${cell.n} ${cell.unit})`;
    case "not-computed":
      return `**not computed** — ${cell.reason}`;
    case "not-measurable":
      return `**not measurable** — ${cell.reason}`;
    default:
      return `**suppressed**: n=${cell.n} < ${cell.min_n}`;
  }
}

/**
 * A cell's value with NO `(n= unit)` suffix, for a table that renders the unit in its
 * own column.
 *
 * ⚠ ONLY LEGITIMATE WHEN THE UNIT IS RENDERED ADJACENTLY. `renderCell` appends the
 * `n` and the unit because a figure without them is ambiguous (see `figure`); this
 * variant drops the suffix to avoid printing it twice, which means the caller now
 * owes the unit. `unitOf` is the other half, and the reliability table uses the pair.
 * Absences still render as words here — that part is never optional.
 */
export function renderValue(cell, fmt = (v) => String(v)) {
  if (!cell || !AVAILABILITY.includes(cell.availability)) {
    refuse(`a cell must carry one of ${AVAILABILITY.join(" | ")}, got ${JSON.stringify(cell)} — an unlabelled cell is a blank cell`);
  }
  return cell.availability === "present" ? fmt(cell.value) : renderCell(cell);
}

/** A cell's unit, or an em-dash for an absence — an absent figure has no unit,
 *  and printing one would imply a measurement behind it. */
export function unitOf(cell) {
  return cell && cell.availability === "present" ? cell.unit : "—";
}

/**
 * The comparison's identity, DERIVED from the comparability key rather than
 * invented.
 *
 * The store's invariants make `(config_hash, corpus_version)` the pair that decides
 * whether two runs may be pooled, and decision 13 makes results from a different
 * reviewer unpoolable. So the report's own name is that pair: a report whose
 * filename names its reviewer and its corpus cannot be mistaken for one about
 * another reviewer, and `byConfigSegment` is reused rather than a second joiner
 * written, so the report file and the `scores/by-config/` directory it renders from
 * are named by one rule.
 */
export function comparisonIdFor({ configHash, corpusVersion } = {}) {
  return byConfigSegment(configHash, corpusVersion);
}

// --- reading the scorers' payloads -------------------------------------------
// Each `…Figures` function takes one scorer payload (or `null` for "no score file")
// and returns cells. They READ fields; the only arithmetic is the range and the
// stratified ratio the report is for.

/**
 * A count ratio between the arms, as a RANGE over the panel's replicates.
 *
 * 🔴 IT IS A RANGE BECAUSE A SINGLE VALUE HAS TO PICK A REPLICATE, AND EVERY WAY OF
 * PICKING ONE IS A BIAS. The first draft of this function divided by
 * `Math.max(...panelValues)` and reported the pilot's headline as `4.9×` where the
 * project's own published figure is `4.7×` — because the maximum is k2's 147 and the
 * published one is k1's 142. That is a small number and the wrong direction: it
 * flattered our arm, silently, by a choice of aggregator that no reader could see.
 * The panel produced three counts, so the ratio is three ratios, and the range is
 * what gets printed.
 *
 * ZERO IS NOT A SMALL NUMBER HERE. CodeRabbit raised no `critical` findings at all
 * on this corpus, so `panel ÷ coderabbit` in that stratum has no denominator — and
 * `Infinity`, an em-dash or a silently dropped row would each read as a ratio so
 * large it proves something. It proves nothing: the arm did not use that label.
 */
/** Said once, because the per-severity rows and the total row must give the same
 *  reason — they are the same fact about the same denominator. */
const INCONSISTENT_ARM = "the CodeRabbit arm reads differently across replicates, so it is not one review";

function armRatio(panelValues, codeRabbitCount) {
  const vs = (Array.isArray(panelValues) ? panelValues : []).filter((v) => Number.isFinite(v));
  if (codeRabbitCount === 0) {
    return notMeasurable(
      `CodeRabbit raised none in this stratum, so the ratio has no denominator (panel ${vs.join(" · ") || "none"})`,
    );
  }
  const s = spread(vs.map((v) => v / codeRabbitCount));
  if (s.n === 0) return notComputed("no panel replicate reported a count for this stratum");
  return figure(s, s.n, "replicates, over one CodeRabbit review");
}

/**
 * Volume and severity mix, SEVERITY-STRATIFIED, from one `volume-mix-v1` payload per
 * replicate.
 *
 * 🔴 THE STRATIFICATION IS NOT A REFINEMENT OF THE HEADLINE, IT IS THE HEADLINE.
 * A bare "4.7× more findings" would be this report's worst sentence: the two arms'
 * severity mixes are different populations. Our major rate is ~25% and CodeRabbit's
 * ~10%, and CodeRabbit's nit-or-minor share is 0.900 against our ~0.75 — so a pooled
 * ratio compares 142 of our findings against 30 of theirs as though a nit and a
 * blocker were one unit. Every ratio below therefore sits inside a severity row,
 * and the pooled figure is rendered beside the mix that qualifies it rather than
 * above it.
 *
 * The panel column is THREE VALUES, never one. Per-item volume moves 12–67% between
 * replicates of the same reviewer on the same item, so a single count is one draw
 * from a distribution; `spread` is imported from `reliability.mjs` rather than
 * re-implemented, because that module's docblock already forbids quoting its mean
 * without its range.
 */
export function volumeFigures(perReplicate) {
  // `perReplicate` may carry HOLES — one entry per replicate the caller declared, with
  // `null` where no score file exists. The hole count is kept, because a range over
  // two draws under a header that names three replicates is the exact
  // fewer-than-claimed reading this module exists to prevent.
  const declared = Array.isArray(perReplicate) ? perReplicate.length : 0;
  const reads = Array.isArray(perReplicate) ? perReplicate.filter(Boolean) : [];
  if (reads.length === 0) {
    return { availability: "not-computed", reason: `no ${sectionFor("volume").scorer_id} score is filed for any run — the volume scorer was never run against this store`, rows: [], replicates: [] };
  }
  const armOf = (payload, arm) => (payload.segments ?? []).filter((s) => s.arm === arm);
  // Summed over the arm's gate segments, because `volume-mix.mjs` splits an arm into
  // one segment per `gate_state` and the pilot's panel arm is a single `on` segment.
  // Reading only the first would silently drop a segment if a future run mixed them.
  const counts = (payload, arm, severity) =>
    armOf(payload, arm).reduce((a, s) => a + (s.summary?.severity?.stated?.counts?.[severity] ?? 0), 0);
  const total = (payload, arm) => armOf(payload, arm).reduce((a, s) => a + (s.summary?.findings ?? 0), 0);
  const unstated = (payload, arm) => armOf(payload, arm).reduce((a, s) => a + (s.summary?.severity?.unstated?.n ?? 0), 0);

  const replicates = reads.map((r) => ({
    run_id: r.run_id ?? null,
    panel: total(r, "panel"),
    coderabbit: total(r, "coderabbit"),
    completeness: r.completeness?.verdict ?? null,
    items_comparable: r.completeness?.items_comparable ?? [],
  }));
  // CodeRabbit is ONE review, read once per replicate because each panel replicate is
  // scored against it. If the three reads disagree, the arm was not the same arm, and
  // averaging them would hide that.
  const crTotals = [...new Set(replicates.map((r) => r.coderabbit))];
  const crConsistent = crTotals.length === 1;

  const rows = KNOWN.map((severity) => {
    const panelValues = reads.map((r) => counts(r, "panel", severity));
    const cr = counts(reads[0], "coderabbit", severity);
    const s = spread(panelValues);
    return {
      severity,
      panel_values: panelValues,
      panel_spread: s,
      // The panel cell's `n` is the number of DRAWS, not the count: the value is a
      // range over replicates and its n is how many replicates produced it.
      panel: figure(s, panelValues.length, "replicates"),
      coderabbit: figure(cr, crConsistent ? reads.length : 0, "review, read once per replicate"),
      ratio: crConsistent ? armRatio(panelValues, cr) : notMeasurable(INCONSISTENT_ARM),
    };
  });

  const panelTotals = replicates.map((r) => r.panel);
  // THE TOTAL ROW HONOURS `crConsistent` TOO, and an earlier version did not: every
  // severity row said "not measurable" while the bold total underneath printed a
  // confident ratio over replicate 0's denominator — the one the same function had
  // just declared unreliable. The BOLD row is the one a reader quotes, so it was the
  // worst place to leave the guard out.
  return {
    availability: "present",
    replicates,
    rows,
    coderabbit_consistent: crConsistent,
    panel_total: figure(spread(panelTotals), panelTotals.length, "replicates"),
    replicates_declared: declared,
    replicates_missing: declared - reads.length,
    contributing_run_ids: replicates.map((r) => r.run_id).filter(Boolean),
    coderabbit_total: crConsistent ? figure(replicates[0].coderabbit, 1, "review") : notMeasurable(INCONSISTENT_ARM),
    pooled_ratio: crConsistent ? armRatio(panelTotals, replicates[0].coderabbit) : notMeasurable(INCONSISTENT_ARM),
    // Printed because a rate over "the ones we could label" would rise as our ability
    // to label fell. On the pilot both arms state a severity for every finding.
    unstated: { panel: unstated(reads[0], "panel"), coderabbit: unstated(reads[0], "coderabbit") },
  };
}

/**
 * WHY A REPLICATE HAS NO ADJUDICATED BAND — five causes, five sentences, and NONE of
 * them is "the labels moved nothing".
 *
 * 🔴 THE DISTINCTION THIS EXISTS FOR IS `none-for-replicate` AGAINST
 * `resolved-nothing`. On the pilot, two of the three replicates have no adjudicated
 * pair at all and one has 43, and the two unadjudicated ones print a band identical to
 * their unlabelled one. If all three rendered the same cell shape a reader would
 * conclude that all three were adjudicated and two of them simply did not move — which
 * is lesson 6 (absence has more than one cause) at the row level, and it is the same
 * mistake as reading an arm's silence as a zero. So an unadjudicated replicate renders
 * as `not computed` WITH ITS CAUSE, and a replicate whose labels genuinely moved
 * nothing renders as a present figure, because that is a measurement.
 *
 * ALL FIVE ARE `not-computed` AND NONE IS `not-measurable`, deliberately: every one of
 * them is closed by adjudicating pairs. Nothing here is structurally unavailable, which
 * is exactly what separates this section from §3's one-armed reliability and §4's
 * cross-arm cell.
 *
 * The two states missing from this map are `resolved` and `resolved-nothing`, and both
 * carry a figure rather than a cause. `pair-labels.mjs` owns the vocabulary; the pin
 * below breaks the import if it grows a sixth silent state.
 */
export const LABEL_CAUSE = Object.freeze({
  "not-supplied": "the complementarity score was produced with no label store at all, so nothing was offered to this replicate",
  "no-store": "no pair labels are filed for this corpus version — nobody has adjudicated it",
  "store-empty": "the label directory exists and holds no usable record",
  "none-for-replicate": "labels exist for this corpus, but none names this replicate and none of their keys is in its undecided queue — nobody has looked here",
  "none-matched": "labels DO name this replicate and not one key matches a live undecided pair — every one moved or was promoted. A drift signal, not an absence of evidence",
});

/** A score file written before `complementarity.mjs` read labels at all. Distinct from
 *  `not-supplied`, which is a scorer that COULD have been handed a store and was not. */
const SCORE_PREDATES_LABELS = "this complementarity score carries no `labels` block — it predates the pair-label reader, so no band here has been adjudicated";

// The two vocabularies below decide what §2's labelled rows MEAN, so they are checked
// against the module that owns them at import time rather than copied. A seventh
// availability state added upstream with no sentence here would otherwise render as an
// empty cause, which is the blank cell this file exists to prevent.
pin(
  `LABEL_AVAILABILITY is ${JSON.stringify(LABEL_AVAILABILITY)}, expected every state to be either a figure or a stated cause`,
  LABEL_AVAILABILITY.every((a) => a === "resolved" || a === "resolved-nothing" || Object.hasOwn(LABEL_CAUSE, a)) &&
    Object.keys(LABEL_CAUSE).every((a) => LABEL_AVAILABILITY.includes(a)),
);
// GOLD FIRST IS LOAD-BEARING, not cosmetic. The scorer names the most trusted tier
// present as the headline, and §2 marks the band PROVISIONAL whenever that tier is not
// `gold` — a rule that inverts silently if the scale is ever reordered.
pin(`LABEL_SOURCES is ${JSON.stringify(LABEL_SOURCES)}, expected a trust-ordered scale with gold first`, LABEL_SOURCES.length >= 2 && LABEL_SOURCES[0] === "gold");

/**
 * A DIRECTIONAL rate — *"of everything THIS arm raised, how much did the other arm
 * raise too?"* — as a `{k, n, ratio}` proportion, so the count and the rate stay in one
 * cell exactly as §3's gate agreement does.
 *
 * 🔴 ITS DENOMINATOR IS ONE ARM'S OWN CLASSES, WHICH IS THE ENTIRE POINT. The Jaccard's
 * denominator is the union, and on this data the union is mostly panel-only classes —
 * so the Jaccard falls when the panel says MORE, which is not disagreement. A
 * directional rate divides by the arm being described, so "the panel matched 40% of
 * what CodeRabbit raised" and "CodeRabbit matched 8% of what the panel raised" are two
 * true sentences about one dataset and neither is dragged by the other arm's volume.
 *
 * `n > 0` is not assumed: an arm that raised nothing has no rate, and `null` is the
 * honest ratio there — `0/0 → 0.000` reads as a measurement of perfect disagreement.
 */
function directionalRate(k, n, unit) {
  return figure({ k, n, ratio: n > 0 ? k / n : null }, n, unit);
}

/**
 * Both directional rates for one basis, plus the Jaccard they qualify.
 *
 * `classes = both + panel_only + coderabbit_only` is the identity every count here
 * rests on, so each arm's own class count is one subtraction: the panel's is
 * `classes − coderabbit_only` and CodeRabbit's is `classes − panel_only`. Written that
 * way rather than as `both + x_only` because the adjudicated basis states `classes` and
 * `both` and leaves the two `_only` splits to be derived from one of them.
 */
function ratesFor({ both, classes, coderabbitOnly, jaccard, ceiling }) {
  return {
    coderabbit: directionalRate(both, both + coderabbitOnly, "CodeRabbit defect classes"),
    panel: directionalRate(both, classes - coderabbitOnly, "panel defect classes"),
    // 🔴 THE JACCARD TRAVELS AS A BAND HERE TOO, and the first draft of this table
    // printed the point alone in a column labelled "Jaccard". `report.test.mjs` has
    // asserted since #805 that no code path prints the overlap point without its
    // ceiling, and it caught this: the point is a LOWER BOUND, so a lone `3.5%` in a
    // lead table is the exact figure this section spends four paragraphs qualifying.
    // Demoting it below the two rates does not make it safe to print unqualified.
    jaccard: { low: jaccard, high: ceiling },
  };
}

/**
 * The same two rates on the ADJUDICATED counts, when a replicate has them.
 *
 * The resolved band states `both` and `classes`; the per-arm split needs
 * `coderabbit_only` after resolution, which is one subtraction of two stated fields —
 * a CodeRabbit-only class that resolves `same` becomes a shared class, and nothing else
 * moves it. It holds when two CodeRabbit classes resolve into ONE panel class too: the
 * pair leaves `coderabbit_only` twice and arrives in `both` once, which is exactly what
 * `after.both` already counts (`resolveClasses` adds the count of distinct newly-shared
 * PANEL classes, not the count of resolved CodeRabbit ones — the two are different
 * numbers and conflating them is that module's stated likeliest bug).
 */
function adjudicatedRates(overlap, headline) {
  const after = headline?.band?.after;
  if (!after || !Number.isFinite(after.both) || !Number.isFinite(after.classes)) return null;
  const crOnlyAfter = (overlap.coderabbit_only ?? 0) - (headline.resolution?.coderabbit_only_resolved_same ?? 0);
  return ratesFor({ both: after.both, classes: after.classes, coderabbitOnly: crOnlyAfter, jaccard: after.jaccard, ceiling: after.jaccard_upper_bound });
}

/**
 * One tier's resolved band as a cell, or the reason there is not one.
 *
 * `n` IS THE CLASS COUNT AT THE FLOOR AND THE UNIT IS DEFECT CLASSES — the same pair
 * the unlabelled band beside it carries, because the two are meant to be compared and a
 * band quoted at a different denominator from the one above it is decision 28's failure
 * inside a single row. The provenance — how many pairs were adjudicated out of how
 * large a queue — is a separate sentence with its own `n`, never folded into this one.
 */
function labelBandCell(tier, availability) {
  if (availability === "resolved" || availability === "resolved-nothing") {
    const after = tier?.band?.after ?? {};
    return figure({ low: after.jaccard, high: after.jaccard_upper_bound }, after.classes ?? 0, "defect classes");
  }
  return notComputed(LABEL_CAUSE[availability] ?? `the score reports label availability ${JSON.stringify(availability ?? null)}, which this renderer has no sentence for`);
}

/** One tier's row: the band, what moved it, and whether the ceiling moved. Every field
 *  is read; the only thing decided here is which of the two shapes the cell takes. */
function tierRow(tierName, tier, availability) {
  const res = tier?.resolution ?? {};
  const lab = tier?.labels ?? {};
  return {
    tier: tierName,
    availability,
    band: labelBandCell(tier, availability),
    applied: lab.applied ?? 0,
    in_tier: lab.in_tier ?? 0,
    via: lab.via ?? {},
    unmatched: Array.isArray(lab.unmatched) ? lab.unmatched.length : 0,
    cross_replicate: lab.cross_replicate ?? 0,
    resolved_same: res.coderabbit_only_resolved_same ?? 0,
    finished_apart: res.coderabbit_only_finished_apart ?? 0,
    still_undecided: res.coderabbit_only_still_undecided ?? 0,
    newly_shared: res.panel_classes_newly_shared ?? 0,
    on_already_shared: res.labels_on_already_shared_class ?? 0,
    fanout: Array.isArray(res.fanout) ? res.fanout.length : 0,
    floor_moved: tier?.band?.floor_moved === true,
    // READ, NEVER INFERRED FROM TWO PERCENTAGES. `ceiling_moved` is a field precisely
    // because a renderer diffing `before.jaccard_upper_bound` against `after`'s would
    // agree with the scorer right up to the rounding that hides a real move.
    ceiling_moved: tier?.band?.ceiling_moved === true,
  };
}

/**
 * One replicate's label block, as rows. The headline tier first, then every other tier
 * the store holds — SEPARATELY, never averaged, and never joined across replicates.
 */
function labelFiguresFor(labels) {
  if (!labels || typeof labels !== "object") {
    return { availability: "absent", tier: null, headline: null, other_tiers: [], band: notComputed(SCORE_PREDATES_LABELS) };
  }
  const headline = tierRow(labels.tier, labels.headline, labels.availability);
  // ONE ROW PER TIER PRESENT, in trust order rather than in object-key order, so two
  // renders of one dataset are byte-identical. A tier the store does not hold gets no
  // row: it is a fact about the store, and `by_tier` already omits it.
  const others = LABEL_SOURCES.filter((t) => t !== labels.tier && labels.by_tier && Object.hasOwn(labels.by_tier, t)).map((t) =>
    tierRow(t, labels.by_tier[t], labels.by_tier[t]?.availability),
  );
  return {
    availability: labels.availability ?? null,
    tier: labels.tier ?? null,
    headline,
    other_tiers: others,
    band: headline.band,
    unlabelled: labels.unlabelled ?? null,
  };
}

/**
 * WHAT IS IN THE LABEL STORE — read once, because the scorer reads it once.
 *
 * Every replicate's payload carries the same census: `complementarity.mjs` reads the
 * `labels/` tree once per run and hands the same records to each replicate. So taking
 * it from the first replicate that has one is not a choice of replicate — but "not a
 * choice" is exactly the kind of claim that stops being true silently, so the counts
 * are compared across replicates and a disagreement is reported rather than resolved.
 */
function labelStoreOf(reps) {
  const blocks = reps.map((r) => r.labels).filter((l) => l && typeof l === "object" && l.census);
  if (blocks.length === 0) return null;
  const first = blocks[0];
  const c = first.census ?? {};
  return {
    present: first.store?.present === true,
    n: c.n ?? 0,
    by_source: c.by_source ?? {},
    // 🔴 TWO COUNTS THAT ARE NOT THE SAME FACT. `keys_moved` is a pair whose ADDRESS
    // changed when a finding's text was re-parsed — the verdict is untouched and the
    // label still applies through its alternate key. `needs_readjudication` is a
    // VERDICT its annotator flagged as doubted. An earlier draft of this section
    // attached the second caption to the first count, which would tell a reader that
    // six judgements are doubted when none are.
    keys_moved: c.keys_moved ?? 0,
    needs_readjudication: c.needs_readjudication ?? 0,
    superseded: c.superseded ?? 0,
    unreadable: Array.isArray(first.store?.unreadable) ? first.store.unreadable.length : 0,
    invalid: Array.isArray(first.store?.invalid) ? first.store.invalid.length : 0,
    // A payload assembled from two scoring runs would carry two censuses. It cannot
    // happen through the CLI, which is why it is worth a line rather than a comment.
    //
    // 🔴 IT FINGERPRINTS EVERY FIELD THIS OBJECT HANDS THE RENDERER, not the three it
    // started with. The warning's own words are "the counts above describe only the
    // first", so it has to cover every count that comes from `blocks[0]` — and §2
    // quotes `by_source` and `superseded`, and §6 quotes `by_source` again, all of
    // which were outside the old fingerprint. A guard that watches three of seven
    // fields is the shape lesson 7 is about: it stands in one door and the room has
    // three. `unreadable` and `invalid` are store-level rather than census fields and
    // are included for the same reason — they are printed from the same first block.
    census_disagrees: new Set(blocks.map(censusFingerprint)).size > 1,
  };
}

/**
 * Everything `labelStoreOf` reads out of ONE label block, as a comparable string.
 *
 * `by_source` is an object, so its entries are sorted before serialising: two censuses
 * with the same counts in a different key order are the same census, and a fingerprint
 * that said otherwise would raise a disagreement warning on a payload that has none.
 * `pairLabelCensus` already sorts, so this only matters for a hand-assembled payload —
 * which is exactly the input this guard exists for.
 */
function censusFingerprint(block) {
  const c = block.census ?? {};
  return JSON.stringify([
    c.n ?? 0,
    Object.entries(c.by_source ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    c.keys_moved ?? 0,
    c.needs_readjudication ?? 0,
    c.superseded ?? 0,
    Array.isArray(block.store?.unreadable) ? block.store.unreadable.length : 0,
    Array.isArray(block.store?.invalid) ? block.store.invalid.length : 0,
  ]);
}

/**
 * Overlap, AS A BAND. From one `complementarity-v1` payload holding a
 * `per_replicate` array.
 *
 * 🔴 RENDERING THIS AS A POINT WOULD BE THE MOST MISLEADING THING THIS REPORT COULD
 * DO, and the reason is in the matcher rather than in the metric. `groupFindings`
 * never merges a `maybe`, which is the right fail direction — a false match
 * suppresses a real candidate and a suppressed candidate is a miss nobody recovers —
 * but it means every undecided cross-arm pair is counted as TWO unique catches, one
 * per arm. So the printed overlap is a LOWER BOUND, and the gap to the ceiling is
 * exactly the number of CodeRabbit classes holding a panel partner the matcher left
 * `maybe`.
 *
 * 🔴 AND THE CEILING IS SATURATED ON EVERY REPLICATE, which is the part that bounds
 * how hard the unique-catch counts may be read: every CodeRabbit-only class has an
 * undecided panel candidate, so "24 unique to CodeRabbit" is 24 UNRESOLVED PAIRS and
 * not 24 established misses. `saturated` is read from the payload, which measures it
 * rather than assuming it either way.
 *
 * When pair labels exist this becomes a point estimate. Until then it must not look
 * like one, so the point, the ceiling and the saturation note are one cell and there
 * is no code path that prints the point alone.
 *
 * 🔴 AND WHEN THEY DO EXIST, THE LABELLED BAND IS BESIDE THE UNLABELLED ONE AND NEVER
 * INSTEAD OF IT. `overlap.jaccard` and `unresolved.jaccard_upper_bound` keep the
 * meanings they had before labels were read, so the two are comparable in one place —
 * which is the only way a reader can see how much of the movement is adjudication and
 * how much is arithmetic.
 *
 * 🔴 PER REPLICATE, NEVER POOLED. There is no cross-replicate labelled figure below,
 * and that is a rule rather than an omission: a verdict resolves a pair inside ONE
 * draw, the three draws do not share the text their pairs are keyed on, and the scorer
 * deliberately carries no labels on its `union` / `intersection` views — only
 * `per_replicate` reaches this function at all. A pooled "labelled band" would be a
 * fourth number with no population behind it.
 */
export function complementarityFigures(payload) {
  if (!payload) {
    return { availability: "not-computed", reason: `no ${sectionFor("complementarity").scorer_id} score is filed for this comparability key`, bands: [] };
  }
  const reps = Array.isArray(payload.per_replicate) ? payload.per_replicate : [];
  if (reps.length === 0) {
    return { availability: "not-computed", reason: "the complementarity score carries no per-replicate result", bands: [] };
  }
  const bands = reps.map((r) => {
    const o = r.overlap ?? {};
    const u = r.unresolved ?? {};
    return {
      label: r.stats?.label ?? null,
      classes: o.classes ?? null,
      both: o.both ?? null,
      panel_only: o.panel_only ?? null,
      coderabbit_only: o.coderabbit_only ?? null,
      point: o.jaccard,
      ceiling: u.jaccard_upper_bound,
      saturated: u.saturated === true,
      maybe_links: u.maybe_links ?? null,
      strong_maybe_links: u.strong_maybe_links ?? null,
      triage_threshold: u.triage_threshold ?? null,
      coderabbit_with_candidate: u.coderabbit_classes_with_a_panel_candidate ?? null,
      // The band is the PAIR. There is no accessor for the point on its own.
      band: figure({ low: o.jaccard, high: u.jaccard_upper_bound }, o.classes ?? 0, "defect classes"),
      // THIS replicate's labels, from THIS replicate's block. Nothing here reads
      // another replicate's row, which is what makes "never pooled" a property of the
      // code rather than a promise in a comment.
      labels: labelFiguresFor(r.labels),
      // The two directional rates, on both bases. Per replicate, like everything else
      // in this function — a rate pooled over three draws would divide one replicate's
      // shared count by another's class count.
      rates: ratesFor({ both: o.both ?? 0, classes: o.classes ?? 0, coderabbitOnly: o.coderabbit_only ?? 0, jaccard: o.jaccard, ceiling: u.jaccard_upper_bound }),
      rates_adjudicated: r.labels?.headline ? adjudicatedRates(o, r.labels.headline) : null,
    };
  });
  const points = bands.map((b) => b.point).filter((v) => Number.isFinite(v));
  const ceilings = bands.map((b) => b.ceiling).filter((v) => Number.isFinite(v));
  return {
    availability: "present",
    bands,
    // The band ACROSS replicates takes the lowest point and the highest ceiling, so
    // it contains every replicate's own band. A tighter join would be a claim the
    // three draws do not support.
    overall: figure({ low: Math.min(...points), high: Math.max(...ceilings) }, points.length, "replicates"),
    point_spread: spread(points),
    ceiling_spread: spread(ceilings),
    all_saturated: bands.length > 0 && bands.every((b) => b.saturated),
    saturated_count: bands.filter((b) => b.saturated).length,
    severity_flip: bands.map((b, i) => ({ label: b.label, ...severityAgreementOf(reps[i]) })),
    // A description of the label STORE, which is one object per scoring run — not a
    // band, and deliberately the only label figure here that is not per replicate.
    label_store: labelStoreOf(reps),
    // How many replicates carry an adjudicated band at all. Counted rather than
    // pooled: it qualifies the section's own headline ("1 of 3"), and there is no
    // arithmetic anywhere below that spans two replicates' verdicts.
    replicates_adjudicated: bands.filter((b) => b.labels.band.availability === "present").length,
    // The per-finding undecided-pair counts #829 added, PRESENT OR NOT — the fact §2's
    // ceiling-budget sentence turns on. They are per class; their total is not a field,
    // and this module does not sum arrays it was handed.
    per_finding_pair_counts: reps.some((r) => Array.isArray(r?.labels?.headline?.resolution?.still_undecided)),
  };
}

/** The severity-agreement census on shared classes, read straight off the payload.
 *  Kept beside the band because its `n` is 4–6 classes: it is the clearest example in
 *  the whole report of a figure whose `n` is the point. */
function severityAgreementOf(rep) {
  const s = rep?.severity?.stated ?? {};
  return {
    shared: rep?.severity?.shared_classes ?? 0,
    n: s.n ?? 0,
    panel_more_severe: s.panel_more_severe ?? 0,
    coderabbit_more_severe: s.coderabbit_more_severe ?? 0,
  };
}

/**
 * Is this a `proportion` a table cell can actually print — `{k, n, ratio}`, all three
 * present and numeric?
 *
 * `k` in particular is the field that goes missing without symptom: `figure` demands
 * an `n`, so a proportion with no `n` is already refused at construction, and `ratio`
 * is what everyone remembers to check. `k` is the numerator, it is only read by the
 * formatter, and a missing one reaches the page as the string `undefined` inside a
 * pair of parentheses that otherwise looks entirely correct. `ratio` is allowed to be
 * `null` — `proportion(0, 0)` returns exactly that, and n=0 is a real state — but it
 * may not be absent.
 */
function isProportion(p) {
  return !!p && typeof p === "object" && Number.isFinite(p.k) && Number.isFinite(p.n) && (p.ratio === null || Number.isFinite(p.ratio));
}

/** Why a proportion was refused, named field by field, so the report says which half of
 *  the payload is missing rather than only that something is. */
function whyNotProportion(what, p) {
  if (!p || typeof p !== "object") return `${what} is ${JSON.stringify(p ?? null)}`;
  const missing = ["k", "n", "ratio"].filter((f) => (f === "ratio" ? !(p.ratio === null || Number.isFinite(p.ratio)) : !Number.isFinite(p[f])));
  return missing.length ? `${what} is missing ${missing.join(", ")}` : `${what} is unusable`;
}

/**
 * Reliability, and it is ONE-ARMED. From one `reliability-v1` payload.
 *
 * 🔴 THE SECOND ARM IS NOT MISSING, IT IS IMPOSSIBLE. CodeRabbit retest pairs are
 * `n=0` structurally: every corpus item has exactly one finding-bearing CodeRabbit
 * review and CodeRabbit cannot be re-run, so there is no (review n, review n+1) pair
 * to compare. That is `not-measurable`, never `not-computed` and never a blank — and
 * the payload states the reason itself, which is what makes it renderable rather
 * than asserted here.
 *
 * The two headline figures point OPPOSITE WAYS and must be rendered together: the
 * gate verdict reproduces on 7 of 7 items while finding-level agreement is ~0.43.
 * The panel is reliable at the decision level and unreliable at the finding level;
 * quoting either alone is a different report.
 */
export function reliabilityFigures(payload) {
  if (!payload) {
    return { availability: "not-computed", reason: `no ${sectionFor("reliability").scorer_id} score is filed for this comparability key` };
  }
  const gate = payload.gate?.agreement ?? null;
  const jac = payload.jaccard?.across_pairs ?? null;
  const rec = payload.recurrence?.overall ?? null;
  const retest = payload.coderabbit_retest_pairs ?? null;
  const items = Array.isArray(payload.items) ? payload.items : [];
  const kRuns = payload.k_runs ?? 0;
  return {
    availability: "present",
    k_runs: kRuns,
    run_ids: payload.run_ids ?? [],
    bound: payload.bound ?? null,
    // n is ITEM-RUNS, and the unit is spelled out: this is a per-item verdict
    // agreement, not a per-finding one.
    // The WHOLE proportion is the value, not its ratio: `{k, n, ratio}` keeps "7 of 7"
    // and "1.000" in one cell, and a renderer holding only the ratio would print a
    // rate with no numerator — which is the shape decision 33 forbids.
    //
    // 🔴 CHECKED FIELD BY FIELD, not merely for presence. `renderValue` protects a cell
    // that is ABSENT; it cannot protect a cell that is present and hollow, because by
    // then the formatter is already running. A `gate.agreement` carrying `ratio` and `n`
    // but no `k` printed `(undefined/7)` straight onto the page, and a `recurrence`
    // missing `in_all` threw a TypeError that aborted the whole render and left the CLI
    // exiting 1 with no report at all. Both are cheaper to refuse here.
    gate: isProportion(gate) ? figure(gate, gate.n, "items, each over all replicates") : notComputed(whyNotProportion("gate agreement", gate)),
    gate_per_item: payload.gate?.per_item ?? [],
    lane_census: payload.gate?.lane_census ?? [],
    jaccard: jac && jac.n > 0 ? figure(jac, jac.n, "run pairs, over defect classes") : notMeasurable("no run pair was scorable"),
    jaccard_by_severity: payload.jaccard?.across_pairs_by_severity ?? {},
    recurrence: isProportion(rec?.in_all) && isProportion(rec?.in_one)
      ? figure(rec, rec.n_classes ?? 0, "defect classes over all replicates")
      : notComputed(`the reliability score carries no usable recurrence figure (${whyNotProportion("in_all", rec?.in_all)}; ${whyNotProportion("in_one", rec?.in_one)})`),
    recurrence_by_severity: payload.recurrence?.by_severity ?? {},
    // The one-armedness, from the payload's own words.
    coderabbit: retest && retest.one_armed
      ? notMeasurable(`CodeRabbit retest pairs n=${retest.n} — ${retest.reason}`)
      : notComputed("the reliability score does not say whether the CodeRabbit arm is measurable"),
    unmerged_total: payload.jaccard?.unmerged_total ?? null,
    completeness: payload.completeness ?? null,
    items,
  };
}

/**
 * Cost and latency, from one `cost-latency-v1` payload.
 *
 * 🔴 THE CROSS-ARM CELL IS `not-measurable` PERMANENTLY, AND THAT IS A RESULT RATHER
 * THAN A GAP. It is the one cell in this report whose absence will never be filled by
 * running something, and the section is built so that a reader cannot construct the
 * missing number themselves:
 *
 *   COST     CodeRabbit is a flat subscription. There is no per-review price to put
 *            opposite our metered one — not a small number, not an unknown number,
 *            no such quantity — so the two live under different keys with different
 *            units and the scorer names its own basis on each.
 *   LATENCY  both arms have a number and they measure different things. Ours times a
 *            panel PROCESS on an offline replay of a historical commit, starting
 *            after the lane materialised a worktree, queueing for nothing. Theirs
 *            times a production reviewer end to end. The direction of that bias is
 *            measured and it is NOT the one this project assumed for years: on the
 *            two pilot commits where our panel also ran in production, from the same
 *            trigger, ours took about 2.2x LONGER. So publishing our replay median
 *            beside theirs would understate us by roughly that factor, and it is the
 *            n=2 production pair — in the limits, with its `n` — that says so.
 *
 * So the two arms are rendered as two blocks that share no table and no axis, each
 * figure naming the interval it was measured over. `renderCostLatency` is where that
 * is enforced; this function's job is to hand it cells that cannot be lined up.
 *
 * WHAT IT STILL WILL NOT DO: read `run.json`'s `totals`. The numbers are right there
 * and they are `$92.93` for the pilot. `putRun` recomputes them from the envelopes
 * PRESENT, so a failed attempt whose envelope was deleted during the K=3 repair
 * leaves no trace — and the scorer's own `totals_caveat` says so, which is why this
 * section renders the scorer's spend figures WITH that caveat attached rather than a
 * store total with nothing on the page to qualify it.
 *
 * ⟳ SCHEMA 1 PAYLOADS STILL RENDER. `coderabbit.latency` was `{wall_ms: null}` before
 * the arm's timing read was wired in, and a store may hold one. That path takes the
 * `not-computed` branch with the payload's own reason rather than throwing, because a
 * renderer that crashed on last week's score file would make re-rendering an old
 * comparison impossible — which is the one thing this report's purity buys.
 */
export function costLatencyFigures(payload) {
  const crossArm = notMeasurable(
    "PERMANENTLY, and this is a result rather than a gap. Cost: CodeRabbit is a flat subscription, so there is no per-review price to divide by — not an unknown one, no such quantity. Latency: both arms have a figure and they time different things, ours a panel process on an offline replay that queued for nothing and theirs a production reviewer end to end. The one genuinely comparable pair is in the limits below, it has n=2, and it does not flatter us",
  );
  if (!payload) {
    return {
      availability: "not-computed",
      reason: `no ${sectionFor("cost_latency").scorer_id} score is filed for this comparability key — nobody ran the cost/latency scorer against this store`,
      cross_arm: crossArm,
    };
  }
  const panel = payload.panel ?? {};
  const cr = payload.coderabbit ?? {};
  const gapFor = (metric) => (Array.isArray(payload.declared_gaps) ? payload.declared_gaps : []).find((g) => g.metric === metric) ?? null;
  const series = (s) => (s && Number.isFinite(s.n) && s.n > 0 ? s : null);

  // A `seriesOf` result as a cell, or the reason there is none. The `n` on the cell
  // is the series' own — never the corpus size, never the replicate count — because
  // this payload carries three different denominators for the same corpus (3
  // replicates, 7 items, 21 observations) and decision 33 is that the figure says
  // which one it is.
  const seriesCell = (s, unit, absent) => (series(s) ? figure(s, s.n, unit) : absent);

  const wall = series(panel.review_wall_ms);
  const latency = cr.latency ?? {};
  const selfTimed = latency.self_timed ?? null;
  const pushProxy = latency.push_proxy ?? null;
  // The interval NAMES come off the payload, never from a constant here. A renderer
  // holding its own copy of "coderabbit-start-marker-to-first-finding" would keep
  // captioning the figure with it after the scorer changed which instant it starts
  // from — the caption and the number must fail together or not at all.
  const intervalOf = (span, what) => (typeof span?.interval === "string" && span.interval.trim() !== "" ? span.interval : refuse(`${what} carries no interval name, so its minutes cannot be captioned`));

  return {
    availability: "present",
    reviewer: payload.reviewer ?? null,
    completeness: payload.completeness ?? null,
    schema_version: payload.schema_version ?? null,
    panel: {
      // Three denominators, three cells, each naming its own. `replicate_spend_usd`
      // counts REPLICATES and the two below count OBSERVATIONS; quoting one at the
      // other's `n` is decision 33's failure in both directions.
      spend: seriesCell(panel.replicate_spend_usd, "replicates, each a whole run's stored envelopes", notComputed("the cost score carries no per-replicate spend series")),
      cost_per_review: seriesCell(panel.review_cost_usd, "observations — one item in one replicate", notComputed("the cost score carries no pooled per-review cost series")),
      // OUR minutes refuse without an interval name too. The first version let this
      // one fall back to the literal `unnamed` while the other arm's refused, which is
      // the asymmetry that matters least on the pilot and most later: the figure a
      // reader is likeliest to quote against CodeRabbit's is ours, and an unnamed
      // interval is exactly how the two come to look commensurable.
      wall: wall
        ? figure(wall, wall.n, `observations, interval \`${intervalOf({ interval: panel.latency_interval }, "the panel's wall clock")}\``)
        : notComputed("the cost score carries no pooled wall-clock series"),
      interval: panel.latency_interval ?? null,
      // A MEASURED ZERO IS `present`, and this is the cell that proves it. The census
      // counts envelopes whose duration has no provenance; on the pilot it is 0 of
      // 21, and 0 here means "we looked and every replay was timed" — a different
      // fact from "nobody counted", which is what a blank would say.
      untimed: untimedCell(panel.duration_source),
      // Per replicate, because the fit is per replicate and a withheld one must say
      // what it failed. `suppressed` needs BOTH numbers from the payload — the
      // scorer owns `min_n` (#791's `MIN_FIT_ITEMS`) and a default here would caption
      // its refusal with a threshold it no longer uses.
      fits: (Array.isArray(panel.replicates) ? panel.replicates : []).map((rep) => ({
        run_id: rep.run_id ?? null,
        cell: fitCell(rep.cost_vs_size),
      })),
      by_size_bucket: Array.isArray(panel.by_size_bucket) ? panel.by_size_bucket : [],
    },
    coderabbit: {
      // STRUCTURAL, not missing: there is no per-review price for a flat
      // subscription, so running anything for longer produces no number.
      cost: cr.cost?.amortised_usd_per_pr === null || cr.cost?.amortised_usd_per_pr === undefined
        ? notMeasurable(cr.cost?.reason ?? "the cost score does not say why CodeRabbit has no per-review price")
        : figure(cr.cost.amortised_usd_per_pr, 1, "amortised USD per pull request, from a list price and a monthly volume supplied by the caller"),
      // NOBODY MEASURED IT, when nobody did — distinct from the cost cell above,
      // because this one a re-run closes and that one it does not.
      // THE `n` COMES OFF THE SERIES THAT WAS VALIDATED, not off its parent. `series()`
      // above checks `ms.n`, and an earlier version then passed `self_timed.n` — a
      // different field that happens to be equal in today's producer. Validating one
      // number and printing another is how a denominator drifts silently, and a
      // payload carrying `ms` without the sibling count threw inside `figure`.
      latency: series(selfTimed?.ms)
        ? figure(selfTimed.ms, selfTimed.ms.n, `items, interval \`${intervalOf(selfTimed, "the self-timed latency")}\``)
        : notComputed(latency.reason ?? gapFor("coderabbit_latency_ms")?.reason ?? "the cost score carries no CodeRabbit latency and gives no reason"),
      latency_secondary: series(pushProxy?.ms)
        ? figure(pushProxy.ms, pushProxy.ms.n, `items, interval \`${intervalOf(pushProxy, "the push-proxy latency")}\``)
        : null,
      self_timed: selfTimed,
      push_proxy: pushProxy,
      triggers: latency.triggers ?? null,
      requested: latency.requested === true,
    },
    // STILL A GAP AFTER THE LATENCY LANDED, and rendering it with its reason is the
    // deliverable rather than a shortfall: it needs adjudicated labels, and none
    // exist. The reason is the scorer's own words, so the report cannot drift from
    // what the scorer refused to compute.
    cost_per_real_finding: notComputed(
      gapFor("cost_per_real_finding")?.reason ?? "the cost score neither computed cost per real finding nor declared why not",
    ),
    cost_per_real_finding_unblocked_by: gapFor("cost_per_real_finding")?.unblocked_by ?? null,
    declared_gaps: Array.isArray(payload.declared_gaps) ? payload.declared_gaps : [],
    cross_arm: crossArm,
  };
}

/**
 * Replays whose duration has no provenance — a MEASURED ZERO on the pilot.
 *
 * `duration_source` has three values and only one of them is a measurement, so this
 * counts the other two. Zero of 21 is a fact about the store: every replay carries a
 * timing file. The state that would be wrong here is a blank, because "no replay was
 * untimed" and "nobody checked whether any replay was untimed" are the same empty
 * cell and different facts — which is the whole argument of this module.
 */
function untimedCell(census) {
  if (!census || !Number.isFinite(census.n) || !census.counts) {
    return notComputed("the cost score carries no duration_source census, so whether every replay was timed is unknown");
  }
  const untimed = Object.entries(census.counts).filter(([source]) => source !== "review-timing.json").reduce((a, [, n]) => a + (Number.isFinite(n) ? n : 0), 0);
  const unrecognised = Object.values(census.unrecognised ?? {}).reduce((a, n) => a + (Number.isFinite(n) ? n : 0), 0);
  return figure(untimed + unrecognised, census.n, "envelopes");
}

/**
 * One replicate's cost-vs-size fit: measured, or WITHHELD with both numbers that
 * decided it. The threshold is the scorer's — read, never defaulted.
 *
 * 🔴 A REFUSED FIT IS NEVER `not-measurable`, and that distinction is the whole
 * reason this function exists rather than a ternary. `not-measurable` means no
 * quantity exists however long anyone runs anything — a per-review price for a flat
 * subscription. A fit refused for too few points is the opposite: a third item
 * disproves it. Labelling it structural tells a reader to stop, when the answer is to
 * score more replicates.
 *
 * So the fallback is `not-computed`, and `suppressed` is used only when the payload
 * states the threshold it failed. A scorer that emits `min_n` gets the fourth state
 * with both numbers; one that does not still gets an honest, re-runnable absence
 * instead of a permanent one.
 */
function fitCell(fit) {
  if (!fit || !Number.isFinite(fit.n)) return notComputed("the cost score carries no cost-vs-size fit for this replicate");
  if (Number.isFinite(fit.intercept_usd)) return figure(fit, fit.n, "items priced in this replicate");
  if (Number.isFinite(fit.min_n) && fit.n < fit.min_n) return suppressed(fit.n, fit.min_n);
  return notComputed(fit.reason ?? "the cost score refused this fit and gave no reason");
}

/**
 * Segmentation — `not-computed` today, and EXPECTED TO BE BLANK when it is not.
 *
 * 🔴 THE BLANK GRID IS THE CORRECT OUTPUT, NOT A FAILURE. Decision 12 predicted it
 * before the corpus was frozen: seven items cannot fill a 27-bucket grid under a
 * min-n threshold, and the pilot exists to prove the cycle and emit a number rather
 * than to support a claim. So when plan PR 14 lands, this section's cells will read
 * `suppressed: n=2 < 5` and that is the honest rendering — a reader must be able to
 * tell "we measured nothing here" from "we measured zero here", and an empty table
 * says neither.
 *
 * The THRESHOLD is not this file's. It is read from each cell, so PR 14 can move it
 * without this renderer captioning its grid with a stale number.
 */
export function segmentationFigures(payload) {
  if (!payload) {
    return {
      availability: "not-computed",
      reason: `no ${sectionFor("segmentation").scorer_id} score is filed — the segmentation scorer is not built`,
      // 🔴 THE UNIT, because without it this sentence is false. It said "every cell is
      // expected to be suppressed", and plan PR 14 then measured 76 of 149 cells
      // reporting — 51%. The prediction holds PER PULL REQUEST, where the fattest
      // denominator is 4 items, and fails PER FINDING, where several buckets clear
      // min-n on both arms. Decision 12 has carried the unqualified version since
      // 2026-08-06 and this renderer inherited it; decision 38 is the correction, and
      // it is decision 28 — name the unit — for the fifth time in three days.
      expectation:
        "every PER-PULL-REQUEST cell is expected to be suppressed for a thin denominator, because the fattest such denominator on a 7-item corpus is 4 items — but PER-FINDING cells are not, and several clear min-n on both arms. Decision 12's blank-grid prediction is true per PR and false per finding, so it must not be quoted without its unit",
      cells: [],
      axes: [],
    };
  }
  const cells = (Array.isArray(payload.cells) ? payload.cells : []).map((c) => ({
    segment: c.segment ?? "(unnamed)",
    // THE CUBE'S THREE COORDINATES, carried beside the flat label instead of being
    // dropped. `segmentLabel` in the scorer says outright that flattening loses the
    // grouping and that the components travel separately for exactly this reason —
    // and for two releases nothing read them, so §5 rendered 149 stringly-typed keys
    // and made a reader parse `metric=…/…=…/arm=…` by eye to rebuild a grid that was
    // already in memory. `null` when the payload predates them: an unplaceable cell
    // is still rendered (see `ungrouped` below), never dropped.
    metric: typeof c.metric === "string" ? c.metric : null,
    axis: typeof c.axis === "string" ? c.axis : null,
    bucket: typeof c.bucket === "string" ? c.bucket : null,
    arm: typeof c.arm === "string" ? c.arm : null,
    // A cell the scorer withheld renders as withheld, with the numbers that decided
    // it. A cell it measured renders as measured, INCLUDING a measured zero.
    cell: c.suppressed === true ? suppressed(c.n, c.min_n) : figure(c.value, c.n, c.unit),
  }));
  // 🔴 AXES, NOT ONLY CELLS. An axis nobody can build has no cell to live in — the
  // pilot's `defect_type` needs adjudicated labels that do not exist — so a renderer
  // reading only `cells` drops it silently. That is precisely the failure this module
  // argues against one section up: absence is only observable against a declared
  // expectation, and the four availability states existed per cell and not per axis.
  // The scorer declares every axis with a status and a reason; they are rendered.
  const axes = (Array.isArray(payload.axes) ? payload.axes : []).map((a) => ({
    id: a.id ?? "(unnamed)",
    status: a.status ?? "unstated",
    // WHICH ARMS THE AXIS EXISTS FOR, read off the payload's own declaration. Three
    // of the pilot's seven axes are one-armed by construction — `novelty` reads a
    // field only the panel's records carry, `coderabbit_category` and `window` read
    // fields only CodeRabbit's do — so their empty column is a structural absence
    // and NOT a withheld cell. Rendering the two as one symbol would say "too thin
    // to report" about a measurement that was never available to make.
    arms: Array.isArray(a.arms) ? [...a.arms] : [],
    // What the axis COUNTS — `finding` or `item`. Read only to tell the pairs the
    // scorer refused on a unit mismatch from the ones it refused on their meaning;
    // see `pairs` below.
    unit: typeof a.unit === "string" ? a.unit : null,
    cell: a.status === "computed" ? null : notComputed(a.reason ?? `the scorer reported this axis as ${JSON.stringify(a.status ?? null)} and gave no reason`),
  }));
  const metrics = (Array.isArray(payload.metrics) ? payload.metrics : []).map((m) => ({
    id: m.id ?? "(unnamed)",
    spec: typeof m.spec === "string" ? m.spec : null,
    currency: typeof m.currency === "string" ? m.currency : null,
  }));
  // 🔴 A PAIR THE SCORER NEVER COMPUTED IS WHY A GRID HAS NO ROWS FOR AN AXIS, and
  // nothing rendered it, so a reader of `nit_ratio` could not tell whether severity
  // was missing because it was thin, because it was refused, or because somebody
  // forgot. Two of the pilot's twelve refusals are statements about the metric —
  // the nit ratio is a function of severity, and the novelty annotation only touches
  // blockers — and they are rendered with the scorer's own reason.
  //
  // The other ten are ONE fact repeated: a metric counted in pull requests cut by an
  // axis that cuts findings shares a single denominator across every bucket. They are
  // counted, not listed. The split is STRUCTURAL — the metric's `currency` against the
  // axis's `unit`, both stated in the payload — rather than a match on the reason text,
  // so a refusal with a new reason falls into the listed group and is read, not hidden.
  const axisUnit = new Map(axes.map((a) => [a.id, a.unit]));
  const currency = new Map(metrics.map((m) => [m.id, m.currency]));
  const allPairs = (Array.isArray(payload.pairs_not_computed) ? payload.pairs_not_computed : []).map((p) => ({
    metric: p.metric ?? "(unnamed)",
    axis: p.axis ?? "(unnamed)",
    cell: notComputed(p.reason ?? "the scorer refused this metric/axis pair and gave no reason"),
    unitMismatch: currency.get(p.metric) === "item" && axisUnit.get(p.axis) === "finding",
  }));
  return {
    availability: "present",
    cells,
    axes,
    // Each metric's own one-line spec, verbatim from the payload. §5 leads every grid
    // with it rather than with an authored gloss, so the sentence above a number and
    // the definition the scorer computed it from cannot drift apart.
    metrics,
    pairsRefused: allPairs.filter((p) => !p.unitMismatch),
    pairsUnitMismatch: allPairs.filter((p) => p.unitMismatch).length,
    ...groupSegmentation(cells),
    min_n: payload.min_n ?? null,
    min_n_source: payload.min_n_source ?? null,
    // The split, so §5 states what the grid actually did rather than what decision 12
    // predicted it would. These are the two cell states counted, not a new metric.
    reported: cells.filter((c) => c.cell.availability === "present").length,
    withheld: cells.filter((c) => c.cell.availability === "suppressed").length,
  };
}

/**
 * The flat cell list, regrouped into the cube it came from: one grid per metric,
 * one row per axis bucket, one column per arm.
 *
 * 🔴 IT REGROUPS AND COUNTS. IT COMPUTES NOTHING. Every value, `n`, unit and
 * suppression verdict below is the scorer's, untouched; the only arithmetic is
 * `length` over cells whose state the scorer already decided, which is the same
 * arithmetic `reported`/`withheld` above have always done. A total, a mean or a rank
 * that the payload does not state belongs in the scorer, where it would be tested
 * against the records it summarises — decision 12's invariant is that this file
 * prints only what it was given, and that invariant is the reason §5's numbers can
 * be quoted at all.
 *
 * ORDER COMES FROM THE PAYLOAD, by first appearance — metrics, then buckets, then
 * arms. Sorting here would be this file inventing a ranking, and it would also break
 * the byte-identical re-render property the moment a locale-sensitive comparator got
 * involved. The scorer emits axis by axis and bucket by bucket, so first-appearance
 * order is its grouping, preserved.
 *
 * A ROW WHOSE EVERY ARM IS WITHHELD IS NOT A ROW. It is counted and its label named
 * in `withheldRows`, which is the whole point: 73 of 149 cells carried no value, and
 * at one row each they were 73 of §5's 163 lines. A count naming the buckets they
 * fell on is exactly as honest — a withheld cell still publishes no number — and it
 * is the difference between a section that is read and one that is scrolled past.
 */
function groupSegmentation(cells) {
  // Cells the payload could not place. Kept, listed, and never silently dropped: a
  // payload written before the coordinates existed still renders every cell it has,
  // as the flat list it is, under a heading that says why.
  const placeable = (c) => c.metric !== null && c.arm !== null && c.axis !== null && c.bucket !== null;
  const ungrouped = cells.filter((c) => !placeable(c));
  const placed = cells.filter(placeable);
  const armOrder = [...new Set(placed.map((c) => c.arm))];
  const grids = [];
  for (const metric of new Set(placed.map((c) => c.metric))) {
    const mine = placed.filter((c) => c.metric === metric);
    const rows = [];
    for (const label of new Set(mine.map((c) => `${c.axis}=${c.bucket}`))) {
      const inRow = mine.filter((c) => `${c.axis}=${c.bucket}` === label);
      rows.push({
        label,
        axis: inRow[0].axis,
        bucket: inRow[0].bucket,
        // `null` for an arm with no cell at all — a one-armed axis — which is a
        // different fact from a withheld one and renders as a different symbol.
        cells: Object.fromEntries(armOrder.map((arm) => [arm, inRow.find((c) => c.arm === arm)?.cell ?? null])),
      });
    }
    // A row EARNS its place by holding at least one measurement. One that does not is
    // 100% withheld, and a table row is an expensive way to say nothing twice.
    const present = (r) => Object.values(r.cells).filter((c) => c !== null && c.availability === "present");
    const held = (r) => Object.values(r.cells).filter((c) => c !== null);
    grids.push({
      metric,
      arms: armOrder.filter((arm) => mine.some((c) => c.arm === arm)),
      rows: rows.filter((r) => present(r).length > 0),
      // Named, not just counted, so a reader can see WHICH buckets the corpus is too
      // thin for — that list is the argument for a bigger corpus and it is lost if
      // the rows are dropped silently.
      withheldRows: rows.filter((r) => present(r).length === 0).map((r) => r.label),
      // A two-arm row with both arms reported is the only kind of row §5 can compare,
      // and §4's deliverable is a comparison. Counted over the rows in the table below
      // it, so the sentence and the grid can never disagree — the segmentation
      // scorer's own `comparisons` array says 22 across this payload and so does this.
      comparable: rows.filter((r) => held(r).length > 1 && present(r).length === held(r).length).length,
      twoArm: rows.filter((r) => held(r).length > 1).length,
    });
  }
  return { grids, ungrouped };
}

/** The `SECTIONS` row for a key, refusing an unknown one so a typo cannot produce a
 *  section with no scorer behind it. */
export function sectionFor(key) {
  const s = SECTIONS.find((x) => x.key === key);
  if (!s) refuse(`unknown report section ${JSON.stringify(key)} — known: ${SECTIONS.map((x) => x.key).join(", ")}`);
  return s;
}

// --- assembling -------------------------------------------------------------

/**
 * Everything the report renders, from the score payloads. PURE: payloads in,
 * structure out — no store, no network, no clock.
 *
 * There is no clock ON PURPOSE, and it is the same decision `extract-corpus.mjs`
 * made for the corpus manifest: a `generated_at` would make two renders of one
 * dataset differ in bytes, so a re-render could not be diffed against its
 * predecessor to show that nothing moved. The report is identified by its
 * comparability key, which is a stronger statement than a timestamp.
 */
export function buildReport({ configHash, corpusVersion, panelSha = null, runIds = [], corpusItemIds = [], scores = {} } = {}) {
  const comparisonId = comparisonIdFor({ configHash, corpusVersion });
  if (typeof panelSha !== "string" || panelSha.trim() === "") {
    refuse(
      "panel_sha is required — decision 13 makes results from a different reviewer unpoolable, and the reviewer is the PAIR " +
        "(config_hash, panel_sha). A report that cannot name its reviewer cannot be checked by anyone who was not there",
    );
  }
  return {
    schema_version: SCHEMA_VERSION,
    comparison_id: comparisonId,
    reviewer: { config_hash: configHash, panel_sha: panelSha },
    corpus_version: corpusVersion,
    corpus_item_ids: [...corpusItemIds],
    run_ids: [...runIds],
    sections: {
      volume: volumeFigures(scores.volume),
      complementarity: complementarityFigures(scores.complementarity),
      reliability: reliabilityFigures(scores.reliability),
      cost_latency: costLatencyFigures(scores.cost_latency),
      segmentation: segmentationFigures(scores.segmentation),
    },
  };
}

// --- the report -------------------------------------------------------------

const pct = (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : "n/a");
const num = (v, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : "n/a");
/** A `spread` as words: the values, then the range. Never a mean alone — the
 *  imported `spread`'s own docblock forbids it. */
const values = (s, d = 0) => (s && s.n > 0 ? `${s.values.map((v) => num(v, d)).join(" · ")} (range ${num(s.range, d)})` : "n/a");
/** The same, as percentages — for the ratios and shares, where three decimals of a
 *  fraction are harder to read than one decimal of a percent. */
const pctValues = (s) => (s && s.n > 0 ? `${s.values.map((v) => pct(v)).join(" · ")} (range ${pct(s.range)})` : "n/a");
/** A ratio spread as `low×–high×`, collapsing to one value when the replicates agree.
 *  Never a single aggregate over three draws — see `armRatio`. */
const ratioRange = (s) => (s && s.n > 0 ? (s.min === s.max ? `${num(s.min, 1)}×` : `${num(s.min, 1)}×–${num(s.max, 1)}×`) : "n/a");
const band = (b) => `[${pct(b.low)}, ${pct(b.high)}]`;
const usd = (v) => (Number.isFinite(v) ? `$${v.toFixed(2)}` : "n/a");
/**
 * Minutes, and the UNIT IS IN THE STRING rather than in the column header.
 *
 * §4 is the one section where two arms print the same physical quantity measured over
 * different intervals, so a bare number lifted out of its row is the failure to guard
 * against. `9.3 min` survives being quoted; `9.3` does not.
 */
const minutes = (ms) => (Number.isFinite(ms) ? `${(ms / 60000).toFixed(1)} min` : "n/a");
/** A `seriesOf` result as its values are not available — only its five-number summary
 *  is stored — so the range is what gets printed, never the mean alone. */
const usdValues = (s) => (s && s.n > 0 ? `${usd(s.median)} (${usd(s.min)}–${usd(s.max)})` : "n/a");

/**
 * The whole report as markdown. Pure and exported, so what a reader sees is testable
 * without a store — and so no CLI can format a number the library did not read.
 *
 * IT RETURNS A STRING WHERE ITS SIBLINGS RETURN LINES, which is a deliberate
 * difference from `volume-mix.mjs` and `reliability.mjs`. Theirs are console views
 * printed line by line; this one is a DOCUMENT that lands in a file, and handing a
 * caller an array invites it to be joined without the trailing newline that makes
 * the file a well-formed text file.
 *
 * THE ORDER IS THE ARGUMENT, and it is not the order of the plan's spec row. What is
 * measured comes first, what is bounded comes second, and what is unavailable comes
 * third — but the limits are NOT last, because a reader who stops early must still
 * have seen them. The two confounds sit under the header, above the first number.
 */
export function renderReport(result) {
  const out = [];
  const r = result;
  const s = r.sections;

  out.push(`# Review-panel benchmark — pilot comparison`);
  out.push("");
  out.push(`Our AI review panel against **CodeRabbit**, on the same ${r.corpus_item_ids.length} pull requests at the same commits.`);
  out.push("");
  // S11: a report that does not name its reviewer cannot be checked. The pair, not
  // the config hash alone — `config_hash` cannot see the panel's own code, so a
  // changed gate or a new verifier stage leaves it identical.
  // Named columns rather than a headerless table: an empty cell anywhere in this
  // document is indistinguishable from a figure that was dropped, and the report's
  // own invariant is that there are none.
  out.push(`| what | value |`);
  out.push(`|---|---|`);
  out.push(`| comparison id | \`${r.comparison_id}\` |`);
  out.push(`| reviewer | \`panel_sha ${r.reviewer.panel_sha}\` · \`${r.reviewer.config_hash}\` |`);
  out.push(`| corpus | \`${r.corpus_version}\` — ${r.corpus_item_ids.join(", ") || "(none)"} |`);
  out.push(`| replicates | ${r.run_ids.length ? r.run_ids.map((x) => `\`${x}\``).join(" · ") : "(none)"} |`);
  out.push("");
  out.push(...renderWhatThisIsNot());
  out.push(...renderCaveats(r));
  out.push(...renderVolume(s.volume));
  out.push(...renderComplementarity(s.complementarity));
  out.push(...renderReliability(s.reliability));
  out.push(...renderCostLatency(s.cost_latency));
  out.push(...renderSegmentation(s.segmentation));
  out.push(...renderLimits(r));
  return out.join("\n") + "\n";
}

/**
 * The frame, and it goes ABOVE the first number.
 *
 * This is the first artifact in the project with an audience and it will be read as
 * "who won". Nothing here supports that reading, and the reason is one sentence: no
 * human has judged whether a single finding is real. Saying so after four tables
 * would be a disclaimer; saying it before them is the frame the tables are read in.
 */
function renderWhatThisIsNot() {
  return [
    "## What this measures, and what it does not",
    "",
    "**No human has judged whether a single finding in this report is real.** Every figure below is about",
    "*how much*, *how consistently* and *how cheaply* — never *how well*. There is no precision figure, no",
    "recall figure and no correctness figure anywhere in this document, because producing one requires",
    "adjudicated labels and none exist yet.",
    "",
    "So this is not a scoreboard. Where a quantity is unavailable the report says which of three things is",
    "true — nobody computed it, it cannot be computed on this data, or it was measured and withheld for a",
    "thin denominator — because those are different facts and a blank cell would pool them.",
    "",
  ];
}

/**
 * The two confounds, ON THE PAGE.
 *
 * We author both this benchmark and the system it measures, so the credibility
 * strategy is that the caveats go on the chart rather than in a footnote. Both of
 * these change how every number below should be read, and a reader who meets them
 * after the tables has already formed the impression they correct.
 */
function renderCaveats(r) {
  const rel = r.sections.reliability;
  const inOne = rel.availability === "present" && rel.recurrence.availability === "present" ? rel.recurrence.value.in_one : null;
  const items = r.corpus_item_ids;
  // WHICH of the rendered items are a self-review, intersected rather than assumed.
  // An earlier version stated "one of the seven items … `pr-524`" unconditionally, so
  // rendering any other corpus asserted a confound about an item that was not in it —
  // while the header table three lines above printed the real item list.
  const selfReviews = items.filter((id) => SELF_REVIEW_ITEMS[id]);
  const draws = r.sections.volume.availability === "present" ? r.sections.volume.replicates.length : r.run_ids.length;
  const out = ["## Two things that qualify every number below", ""];
  if (selfReviews.length > 0) {
    const n = selfReviews.length;
    out.push(
      `**① ${n === 1 ? "One" : String(n)} of the ${items.length} item(s) below ${n === 1 ? "is" : "are"} our panel reviewing its own plumbing.** ` +
        selfReviews.map((id) => `\`${id}\` changes ${SELF_REVIEW_ITEMS[id]}`).join("; ") + ".",
      `${n === 1 ? "It is" : "They are"} not excluded, because excluding ${n === 1 ? "it" : "them"} would shrink an already thin corpus; but any`,
      `cross-arm statement drawn from ${n === 1 ? "it" : "them"} is a self-review.`,
      "",
    );
  } else {
    // Said rather than omitted: "we checked and there are none" and "nobody checked"
    // are the same distinction this whole module is built around.
    out.push(
      `**① No item in this corpus is one of the known self-review items** (${Object.keys(SELF_REVIEW_ITEMS).join(", ")}), so no`,
      "figure below carries that confound.",
      "",
    );
  }
  out.push(
    inOne
      ? `**② ${pct(inOne.ratio)} of defect classes appear in exactly one replicate of ${rel.k_runs}** (${inOne.k}/${inOne.n}). A figure`
      : "**② A single replicate is a sample, not a measurement**, and this report has no recurrence figure to say by how much. A figure",
    "computed from a single replicate is therefore a *sample*, not a measurement — which is why the panel",
    draws === 1
      ? "column below carries a single value and must not be read as a property of the panel."
      : `column below carries ${draws} values rather than one.`,
    "",
  );
  return out;
}

/** §1 — volume, severity-stratified, with the mix beside every ratio. */
function renderVolume(v) {
  const out = ["## 1. Volume and severity mix", ""];
  if (v.availability !== "present") {
    out.push(renderCell(v.availability === "not-computed" ? notComputed(v.reason) : v), "");
    return out;
  }
  if (v.replicates_missing > 0) {
    // ON THE PAGE, not on stderr. The column header below names the number of
    // replicates that CONTRIBUTED, and the document's own header table names every
    // replicate that was ASKED for; without this line the two silently disagree.
    out.push(
      `🔴 **${v.replicates_missing} of ${v.replicates_declared} declared replicate(s) have no volume score filed**, so every range in this`,
      `section is over ${v.replicates.length} draw(s), not ${v.replicates_declared}. Contributing: ${v.contributing_run_ids.map((x) => `\`${x}\``).join(", ") || "(none named)"}.`,
      "",
    );
  }
  out.push(
    "**A bare volume ratio would be the most misleading line in this report**, so there is not one: the two",
    "arms' severity mixes are different populations, and the ratio is given per stratum with the counts that",
    "make it.",
    "",
    `| severity | panel — ${v.replicates.length} replicates | CodeRabbit — 1 review | panel ÷ CodeRabbit |`,
    "|---|---|---|---|",
  );
  for (const row of v.rows) {
    out.push(
      `| \`${row.severity}\` | ${values(row.panel_spread)} | ${row.coderabbit.value} | ${renderValue(row.ratio, ratioRange)} |`,
    );
  }
  out.push(
    `| **total** | **${values(v.panel_total.value)}** | **${v.coderabbit_total.value}** | **${renderValue(v.pooled_ratio, ratioRange)}** |`,
    "",
    `Every finding on both arms states a severity (panel unstated ${v.unstated.panel}, CodeRabbit unstated ${v.unstated.coderabbit}), so no row`,
    "is a floor nobody declared.",
    "",
    "🔴 **The total ratio is the one number in this table that is not like-for-like**, and the rows above it",
    "are why: read it only together with them.",
    "",
  );
  return out;
}

/** §2 — overlap, as a band, with its ceiling and the saturation warning. */
function renderComplementarity(c) {
  const out = ["## 2. Overlap between the arms — a band, not a number", ""];
  if (c.availability !== "present") {
    out.push(renderCell(notComputed(c.reason)), "");
    return out;
  }
  out.push(...renderDirectionalRates(c));
  out.push(
    "**The point estimate is a lower bound and the ceiling is saturated, so this is an interval and cannot",
    "honestly be reported as a value.** The matcher never merges an ambiguous pair: it becomes a *link* and",
    "its two findings stay in two classes, which counts one undecided pair as two unique catches — one per",
    "arm. The gap between the two columns below is exactly the size of that undecided queue.",
    "",
    "| replicate | classes | both | panel-only | CodeRabbit-only | overlap (lower bound) | ceiling | band |",
    "|---|---|---|---|---|---|---|---|",
  );
  for (const b of c.bands) {
    out.push(
      `| \`${b.label}\` | ${b.classes} | ${b.both} | ${b.panel_only} | ${b.coderabbit_only} | ${pct(b.point)} | ${pct(b.ceiling)} | **${band(b.band.value)}** |`,
    );
  }
  out.push(
    "",
    `Across ${c.overall.n} replicate(s) the band is **${band(c.overall.value)}** — the lowest bound and the highest ceiling, so it`,
    `contains ${c.overall.n === 1 ? "the single replicate's own band" : `all ${c.overall.n}`}. Lower bounds ${pctValues(c.point_spread)}; ceilings ${pctValues(c.ceiling_spread)}.`,
    "",
  );
  if (c.all_saturated) {
    const worst = c.bands[0];
    out.push(
      `🔴 **The ceiling is SATURATED on all ${c.saturated_count} replicates.** Every CodeRabbit-only class has an undecided panel`,
      `partner, so *"${worst.coderabbit_only} unique to CodeRabbit"* means **${worst.coderabbit_only} unresolved pairs**, not ${worst.coderabbit_only} established misses. A saturated`,
      "ceiling means the matcher cannot currently separate *\"CodeRabbit caught something we missed\"* from *\"we said",
      "the same thing in different words\"*, and that is a property of the two arms rather than a threshold to tune.",
      "",
      // 🔴 WHERE THE CEILING COMES FROM, which is not the matcher and is worth one
      // sentence because this project has puzzled over the figure for a week. When the
      // ceiling is saturated every CodeRabbit class merges in the limit, so the bound
      // collapses to CodeRabbit's class count over the panel's — an exact identity on a
      // saturated replicate, and it reproduces every ceiling in the table above.
      //
      // ⟳ AND IT IS CHECKED BEFORE IT IS CLAIMED, because the sentence says "exactly".
      // It printed the FRACTION from the two class counts and the PERCENTAGE from
      // `unresolved.jaccard_upper_bound`, and nothing made the two agree: on a payload
      // whose saturation flag is true but whose counts no longer reproduce its ceiling
      // it rendered `leaves 30/288 = 20.4%`, where 30/288 is 10.4% — a false identity,
      // asserted, in a section built on every figure being derivable from the payload
      // in front of it. `saturated` is a field this renderer cannot verify, so the
      // arithmetic is verified instead, at the precision the page prints.
      ...(ceilingIdentityHolds(worst)
        ? [
            `**And the ceiling is a property of the two counts rather than of the matcher.** \`${worst.label}\` has`,
            `${worst.rates.coderabbit.n} CodeRabbit class(es) against the panel's ${worst.rates.panel.n}, so even a perfect match on every one of them`,
            `leaves ${worst.rates.coderabbit.n}/${worst.rates.panel.n} = ${pct(worst.ceiling)} — which is exactly the ceiling on that row. It is arithmetic about how`,
            "much each arm said, and no amount of adjudication moves it.",
            "",
          ]
        : []),
      `The queue is ${worst.maybe_links} undecided pairs on \`${worst.label}\`, of which **${worst.strong_maybe_links} score ≥ ${worst.triage_threshold}**. Those two`,
      "numbers buy different ends of the band, and the cheap one buys the end that is already tight:",
      "",
      `- **The floor** rises when a pair is labelled \`same\`, one pair at a time. The ${worst.strong_maybe_links} strong candidates are where`,
      "  the cheap gains are, and they are the reason a first pass is worth running at all.",
      `- **The ceiling** only falls when a CodeRabbit finding has EVERY one of its pairs decided \`different\` — until`,
      `  the last one is settled the finding could still turn out shared, so its ceiling contribution does not move.`,
      `  ${worst.coderabbit_with_candidate} of this replicate's findings carry an undecided panel candidate, and the pairs attached to them are`,
      `  bounded only by the ${worst.maybe_links}-pair queue itself.`,
      "",
      "🔴 **So the honest cost is hundreds of decisions, not tens** — the two bounds have different budgets and only",
      "the floor's is small. The exact ceiling budget is smaller than the whole queue, because pairs owned by a",
      // ⟳ THE SECOND HALF OF THIS SENTENCE STOPPED BEING TRUE. The scorer now emits a
      // per-finding pair count — one row per CodeRabbit-only class, under each tier's
      // `resolution.{resolved,finished_apart,still_undecided}[].pairs` — so the
      // deduction it calls underivable is derivable. What is still missing is a TOTAL,
      // and this module adds up nothing it was not handed: a sum over a payload array
      // is a number the renderer computed, which the invariant at the top of this file
      // forbids and which is why the figure was declined twice already. So the sentence
      // names the field and still refuses the number.
      ...(c.per_finding_pair_counts
        ? [
            "finding that is already shared cannot move either bound. The per-finding pair counts that settle it are",
            "now in the score — one row per CodeRabbit-only class under `labels.…resolution.*[].pairs` — but their TOTAL",
            "is not, and this renderer computes no number it was not handed, so the exact budget is still not stated here.",
          ]
        : [
            "finding that is already shared cannot move either bound; that deduction needs a per-finding pair count this",
            "scorer does not emit, so it is not stated here as a number.",
          ]),
      // The old closing line said "until those labels exist". On the pilot they now
      // exist for one replicate of three, so it would be false on the page — and the
      // table above is still the UNLABELLED band, which is the part a reader must not
      // lose while being told that adjudication has started.
      c.replicates_adjudicated > 0
        ? `**Labels now exist for ${c.replicates_adjudicated} of ${c.bands.length} replicate(s) — the adjudicated band is below, and this table's is still the unlabelled one.**`
        : "**Until those labels exist, this row must not be read as a point estimate.**",
      "",
    );
  }
  const flips = c.severity_flip.filter((f) => f.coderabbit_more_severe > 0);
  out.push(
    `Severity agreement on shared classes is over ${c.severity_flip.map((f) => f.n).join(" · ")} classes — ` +
      (flips.length > 0
        ? `and it **flips sign**: the panel is harsher on ${c.severity_flip.map((f) => f.panel_more_severe).join(" · ")} classes and CodeRabbit harsher on ${c.severity_flip.map((f) => f.coderabbit_more_severe).join(" · ")}.`
        : `the panel is harsher on ${c.severity_flip.map((f) => f.panel_more_severe).join(" · ")}.`),
    "**n is far too small for a claim, and that is the finding.**",
    "",
  );
  out.push(...renderAdjudicatedBand(c));
  return out;
}

/**
 * Does `CodeRabbit classes ÷ panel classes` actually equal the ceiling this row prints?
 *
 * AT PRINT PRECISION, deliberately, because that is the claim being made. The sentence
 * this guards says the quotient is *exactly* the ceiling, and a reader checks that
 * against the two numbers on the page — so the comparison is between what would be
 * printed, not between two full-precision floats that differ in the fifteenth decimal.
 * Both sides go through `pct`, which is also what renders them.
 *
 * When it does not hold, the sentence is omitted rather than softened. It is an
 * explanation of a figure that is already on the page with its own band, not a figure
 * in its own right — so dropping it removes an assertion and hides nothing, whereas
 * printing "approximately" would keep a claim this renderer cannot support.
 */
function ceilingIdentityHolds(worst) {
  const cr = worst?.rates?.coderabbit?.n;
  const panel = worst?.rates?.panel?.n;
  if (!Number.isFinite(cr) || !Number.isFinite(panel) || panel <= 0) return false;
  return pct(cr / panel) === pct(worst.ceiling);
}

/**
 * §2's LEAD, and the Jaccard is not it.
 *
 * 🔴 THE INTERSECTION-OVER-UNION FIGURE IS ARITHMETICALLY RIGHT AND RHETORICALLY WRONG,
 * which is a defect in a report whose whole job is to be read correctly. Its
 * denominator is the union, and on this data the union is mostly classes only the panel
 * raised — so the number falls when our arm says MORE, and a reader meets `3.5%` and
 * concludes the two reviewers barely agree. What actually happened is on the same three
 * counts: the panel raised a large share of what CodeRabbit raised, and raised many
 * things besides. Both directional rates say that; the Jaccard cannot.
 *
 * SO THE TWO RATES LEAD AND THE JACCARD SITS BESIDE THEM, LABELLED. It is not dropped —
 * it is the set-theoretic figure the spec asks for and it is what the band below is
 * built from — but it is no longer the first number a reader meets, and it is never
 * printed without the word "union" nearby.
 *
 * EACH ROW STATES ITS BASIS. A replicate with adjudicated pairs gets a second row
 * rather than a silently upgraded first one: the unadjudicated rate stays on the page
 * beside it, and no replicate that nobody adjudicated can be mistaken for one that was.
 */
function renderDirectionalRates(c) {
  const rate = (cell) => renderValue(cell, (p) => `${p.k} of ${p.n}${p.ratio === null ? "" : ` — **${pct(p.ratio)}**`}`);
  const out = [
    "**Read the two directional rates before the Jaccard.** They are the same three counts stated three ways,",
    "and only the last is dragged by our own volume: the union is mostly classes CodeRabbit never raised, so",
    "a low intersection-over-union says more about how much MORE the panel reports than about how much the two",
    "arms agree. Each rate divides by the arm it describes, so neither moves when the other arm gets louder.",
    "",
    "| replicate | basis | CodeRabbit classes the panel also raised | panel classes CodeRabbit also raised | Jaccard (intersection ÷ union) |",
    "|---|---|---|---|---|",
  ];
  for (const b of c.bands) {
    // The unadjudicated basis, always — including for a replicate that also has an
    // adjudicated one. Two rows, never one row that quietly became the other.
    out.push(`| \`${b.label}\` | unadjudicated | ${rate(b.rates.coderabbit)} | ${rate(b.rates.panel)} | ${band(b.rates.jaccard)} |`);
    if (b.rates_adjudicated && b.labels.band.availability === "present") {
      out.push(
        `| \`${b.label}\` | ${b.labels.headline.applied} \`${b.labels.headline.tier}\` label(s) applied | ${rate(b.rates_adjudicated.coderabbit)} | ${rate(b.rates_adjudicated.panel)} | ${band(b.rates_adjudicated.jaccard)} |`,
      );
    }
  }
  out.push(
    "",
    "**All three columns describe one dataset**, and the two rates keep a denominator the Jaccard does not: each",
    "arm's own class count. Resolving an undecided pair raises a rate's numerator and leaves its denominator",
    "alone, while it moves the union in both directions at once — which is why the band below needs a ceiling",
    "and these two do not.",
    "",
  );
  return out;
}

/**
 * §2's adjudicated band — the first figure in this report that is genuinely PARTIAL
 * rather than absent, and the reason it needs its own subsection.
 *
 * 🔴 THE NUMBER AND WHAT IT RESTS ON GO IN THE SAME BREATH. A floor that moves from
 * 3.5% to 7.3% on human judgements is real, and it is also a few dozen decisions out of
 * a queue of hundreds, on one replicate of three, with a ceiling that structurally
 * cannot move yet. A subsection that printed the moved floor cleanly and left the rest
 * to §6 would be the most misleading paragraph in this document — and unlike every
 * other absence here, this one is not absent enough to protect itself.
 *
 * FOUR THINGS ARE THEREFORE NEVER SEPARATED FROM THE BAND:
 *   the TIER          a `silver` band is an AI read-through pending human confirmation
 *                     and ANNOTATION-GUIDE §6 says do not treat it as the ceiling, so
 *                     the tier is a column and not a footnote.
 *   the CAUSE         a replicate nobody adjudicated says so, in words, and does not
 *                     share a cell shape with one whose labels moved nothing.
 *   `ceiling_moved`   rendered as the fact it is, with its reason, in both directions.
 *   the DENOMINATOR   how many pairs were adjudicated out of how large a queue, on how
 *                     many replicates of how many.
 */
function renderAdjudicatedBand(c) {
  const store = c.label_store;
  const bands = c.bands;
  // Nothing to render for a score file written before labels were read. Said in one
  // line rather than omitted: a missing subsection and an unadjudicated corpus are the
  // same blank space and different facts.
  if (!store) {
    return [
      "### The adjudicated band",
      "",
      `${renderCell(bands[0]?.labels?.band ?? notComputed(SCORE_PREDATES_LABELS))}`,
      "",
      "So every band above is the unlabelled one, and the two states a labelled band distinguishes — *nobody",
      "adjudicated this replicate* and *the labels moved nothing* — cannot be told apart from this score file.",
      "",
    ];
  }
  const out = [
    "### The adjudicated band",
    "",
    "**A pair label resolves one undecided pair; it does not re-partition the panel's own classes.** The band in",
    "the table above stays exactly as it was — this one sits beside it, never instead of it, so the movement that",
    "is adjudication can be told from the movement that is arithmetic.",
    "",
    "🔴 **It is per replicate and never pooled.** A verdict settles a pair inside one draw, the three draws do not",
    "share the text their pairs are keyed on, and the `union` and `intersection` views deliberately carry no",
    "labels at all. There is no row below that spans two replicates.",
    "",
    `| replicate | tier | unlabelled band | adjudicated band | what the labels did |`,
    "|---|---|---|---|---|",
  ];
  for (const b of bands) {
    const h = b.labels.headline;
    out.push(
      `| \`${b.label}\` | ${b.labels.tier ? `\`${b.labels.tier}\`` : "—"} | ${band(b.band.value)} | ${renderValue(h.band, (v) => `**${band(v)}** (n=${h.band.n} ${h.band.unit})`)} | ${didWhat(h)} |`,
    );
  }
  out.push("");
  // WHAT EACH MOVED BAND RESTS ON, per replicate, with both denominators: the pairs
  // adjudicated against the size of that replicate's own queue, and the replicate
  // against the number of draws. The section's whole credibility is this line.
  const adjudicated = bands.filter((b) => b.labels.band.availability === "present");
  if (adjudicated.length > 0) {
    out.push(`**What each band above rests on** — the number and its denominators, in one place:`, "");
    for (const b of adjudicated) {
      const h = b.labels.headline;
      out.push(
        `- \`${b.label}\`: **${h.applied} of ${h.in_tier} \`${h.tier}\` label(s)** applied against an undecided queue of`,
        `  **${b.maybe_links} pair(s)**, on **1 replicate of ${bands.length}**.` +
          // Each of these is a real caveat on the same number, and each is omitted when
          // it is zero rather than printed as "0 of them" — a zero here is the absence
          // of a caveat, not a measurement being withheld.
          (h.via["pair_key_at_801"] ? ` ${h.via["pair_key_at_801"]} matched only through the alternate key vintage.` : "") +
          (h.on_already_shared ? ` ${h.on_already_shared} sit on a class both arms already claim, and are counted nowhere.` : ""),
        ...(h.fanout
          ? [`  ${h.fanout} resolved class(es) name more than one panel partner: the CodeRabbit class leaves the denominator once,`,
             "  and the panel's own classes stay apart — a label resolves a pair and does not merge two panel findings."]
          : []),
      );
    }
    out.push("");
  }
  out.push(...renderCeilingMoved(adjudicated, bands.length));
  out.push(...renderTrustTier(c, store));
  out.push(...renderLabelProvenance(bands, store));
  return out;
}

/** What a tier's labels did to a replicate, as one cell. A `resolved-nothing` row says
 *  so IN THOSE WORDS: it is a measurement, and the sentence that makes it one. */
function didWhat(row) {
  // A verdict adjudicated on ANOTHER draw of the same corpus, applied here because the
  // pair key is derived from the two findings' text rather than from the run. Sound,
  // and worth saying: a reader counting adjudications on this replicate would otherwise
  // credit it with work done on a different one.
  const elsewhere = row.cross_replicate > 0 ? `, ${row.cross_replicate} of them adjudicated on another draw` : "";
  if (row.availability === "resolved") {
    return `${row.applied} of ${row.in_tier} \`${row.tier}\` label(s) applied${elsewhere} — ${row.resolved_same} CodeRabbit-only class(es) resolved \`same\`, ${row.finished_apart} finished apart, ${row.still_undecided} still undecided`;
  }
  if (row.availability === "resolved-nothing") {
    return `${row.applied} of ${row.in_tier} \`${row.tier}\` label(s) applied${elsewhere} and **no class changed state** — the band is unmoved, and that is measured rather than unlooked-at`;
  }
  return `${row.applied} of ${row.in_tier} ${row.tier ? `\`${row.tier}\` ` : ""}label(s) applied`;
}

/**
 * S5, ON THE PAGE. `ceiling_moved` is the single most misread thing in this subsystem
 * and this is where a reader meets it, so it is rendered as a fact with its reason in
 * BOTH directions — never as a blank, and never as a silence that reads like a
 * shortfall.
 *
 * A `same` verdict adds to the ceiling's numerator exactly what it removes from its
 * denominator, so only a CodeRabbit finding with EVERY one of its pairs decided moves
 * the ceiling. On a partial label set that is the correct outcome rather than a
 * limitation — and a ceiling that DOES move is the flattering direction, so it is
 * flagged rather than celebrated.
 */
function renderCeilingMoved(adjudicated, total) {
  if (adjudicated.length === 0) return [];
  const out = [];
  for (const b of adjudicated) {
    const h = b.labels.headline;
    if (h.ceiling_moved) {
      out.push(
        `🔴 **The ceiling MOVED on \`${b.label}\` (\`${h.tier}\`): ${h.finished_apart} CodeRabbit-only class(es) had every one of their pairs decided.**`,
        "A moved ceiling narrows the band in the direction that flatters this project, so it is the one number here to",
        `check hardest: it is sound only if every pair of each of those ${h.finished_apart} classes was genuinely decided, and`,
        `\`insufficient-basis\` is not a decision. ${h.still_undecided} class(es) remain undecided on this replicate.`,
        "",
      );
    } else {
      out.push(
        `**On \`${b.label}\` the floor moved and the ceiling did not, and that is the arithmetic rather than a shortfall.**`,
        "A `same` verdict adds to the ceiling's numerator exactly what it removes from its denominator, so only a",
        `CodeRabbit finding with EVERY one of its pairs decided can move it — and ${h.finished_apart} of \`${b.label}\`'s ${b.coderabbit_only} have that`,
        `today, with ${h.still_undecided} still undecided. \`ceiling_moved\` is a field of the score, not two percentages a reader is`,
        "left to diff.",
        "",
      );
    }
  }
  if (adjudicated.length < total) {
    out.push(
      `**${total - adjudicated.length} of the ${total} replicate(s) above carry no adjudicated band at all**, and their row says which of the`,
      "five causes applies. An unadjudicated replicate is not a replicate where the labels found nothing — nobody",
      "has looked at it — and pooling those two would be this report's own lesson one level down.",
      "",
    );
  }
  return out;
}

/**
 * THE TRUST TIER, ON THE FIGURE. `ANNOTATION-GUIDE.md` §6: a `silver` label is an AI
 * read-through or a merge of noisy signals *pending human confirmation* — "usable but
 * imperfect; do not treat as the ceiling". So a band moved by one is provisional, and a
 * reader must be able to see that without opening the score file.
 *
 * The scorer names the most trusted tier present as the headline and resolves every
 * other tier separately; there is no pooled band and no way to express one. Both facts
 * are rendered, because a table of two tiers with no sentence between them invites
 * exactly the average that cannot be computed.
 */
function renderTrustTier(c, store) {
  const out = [];
  const sources = Object.entries(store.by_source);
  const headline = c.bands[0]?.labels?.tier ?? null;
  out.push(
    `**Trust tier, on the figure rather than in a footnote.** The store holds ${store.n} pair record(s)` +
      (sources.length ? ` — ${sources.map(([t, n]) => `${n} \`${t}\``).join(" · ")}` : "") + ".",
    `Each tier is resolved separately and **never pooled**: there is no band above computed over two tiers, and the`,
    "scorer has no argument that would express one.",
    "",
  );
  if (headline !== null && headline !== LABEL_SOURCES[0]) {
    out.push(
      `🔴 **The band above is \`${headline}\`'s, not \`${LABEL_SOURCES[0]}\`'s — so it is PROVISIONAL.** The store holds no`,
      `\`${LABEL_SOURCES[0]}\` record for this corpus, and ANNOTATION-GUIDE §6 says of a weaker tier: *"usable but imperfect;`,
      'do not treat as the ceiling."* Read every figure in this subsection as pending human confirmation.',
      "",
    );
  }
  // Every other tier the store holds, resolved separately — never bold, never joined to
  // the band above, and carrying `ceiling_moved` because a weaker tier that narrows the
  // band is precisely the row a reader would otherwise quote.
  const others = c.bands.flatMap((b) => b.labels.other_tiers.map((t) => ({ label: b.label, row: t })));
  if (others.length > 0) {
    out.push(
      `**Other tiers, resolved separately and quoted nowhere above.** A \`silver\` label is an AI read-through pending`,
      'human confirmation and a `distant` one is inferred without per-item reading; §6 of the guide says *"do not treat',
      'as the ceiling."* No row below is this report\'s band.',
      "",
      "| replicate | tier | adjudicated band | ceiling moved | what the labels did |",
      "|---|---|---|---|---|",
    );
    for (const { label, row } of others) {
      // `ceiling moved` is a fact about a band, so a row with no band gets an em-dash
      // rather than a `no`. "The ceiling did not move" and "there is no band here to
      // move" are the same word and different facts — the distinction this whole
      // subsection is built on, one column to the right.
      const moved = row.band.availability !== "present" ? "—" : row.ceiling_moved ? `🔴 yes — ${row.finished_apart} class(es) finished apart` : "no";
      out.push(
        `| \`${label}\` | \`${row.tier}\` | ${renderValue(row.band, (v) => `${band(v)} (n=${row.band.n} ${row.band.unit})`)} | ${moved} | ${didWhat(row)} |`,
      );
    }
    out.push("");
    // 🔴 THE ROW A READER WOULD OTHERWISE QUOTE. A weaker tier has more labels, so it
    // finishes more classes, so its band is TIGHTER — and a tighter interval is what
    // everyone here wants. Said out loud, because the table above cannot say it: the
    // provisional row being the narrower one is the flattering direction, and the tier
    // is the only thing standing between it and the headline.
    if (others.some((o) => o.row.ceiling_moved)) {
      out.push(
        "🔴 **A weaker tier can produce a TIGHTER band, and tightness is not confidence.** Above, the provisional tier's",
        "ceiling moves where the headline tier's does not — more labels finish more classes — so the narrower interval",
        "is the one that has NOT been confirmed by a human. That is the flattering direction, which is why the tier is",
        "a column here and not a note at the bottom.",
        "",
      );
    }
  }
  return out;
}

/**
 * The two provenance counts, AS TWO SENTENCES.
 *
 * 🔴 `keys_moved` AND `needs_readjudication` ARE DIFFERENT FACTS AND AN EARLIER DRAFT
 * CONFLATED THEM. A moved key means a finding's text was re-parsed, so the PAIR'S
 * ADDRESS changed — the verdict is untouched and the label still applies through its
 * alternate key. `needs_readjudication` is a VERDICT flagged as doubted, and it is the
 * one that would qualify a band. On the pilot the first is 6 and the second is 0: a
 * reader told that six judgements are doubted, when none are, is worse informed than one
 * told nothing. Neither caption may ever carry the other's count.
 */
function renderLabelProvenance(bands, store) {
  const out = [
    "**Two provenance counts that are not the same fact, and neither may be read as the other:**",
    "",
    `- **${store.keys_moved} of ${store.n} record(s) carry a pair key that MOVED.** A finding's text was re-parsed, so the pair's`,
    "  *address* changed. The verdict is untouched, and such a label still applies through its alternate key vintage.",
    `- **${store.needs_readjudication} of ${store.n} record(s) are flagged for re-adjudication.** That is a doubt about a VERDICT, and it is the`,
    "  count that would qualify a band. It is not the count above, and the two must never be captioned interchangeably.",
    "",
  ];
  if (store.superseded > 0) {
    out.push(
      `${store.superseded} record(s) carry a superseded earlier verdict, kept rather than overwritten so two published agreement`,
      "numbers against two label vintages stay checkable.",
      "",
    );
  }
  // Dropped label files, as a measured count. A label this store could not read can
  // only WIDEN a band, so zero is worth printing beside the bands it did not widen.
  out.push(
    `The store was read with **${store.unreadable} unreadable file(s)** and **${store.invalid} refused by the record validator**; a dropped label`,
    "can only widen a band, never narrow one.",
    "",
  );
  // A label matching no live pair has two causes the queue cannot separate, so it is
  // reported per replicate rather than summed into one drift number.
  //
  // 🔴 ONLY WHERE IT IS AN ANOMALY, and `complementarity.mjs` makes the same exclusion
  // for the same reason. On a replicate nobody adjudicated, "every label matches
  // nothing here" IS `none-for-replicate` rather than a finding about it — so printing
  // it would put an identical warning on the two replicates that are behaving exactly
  // as expected, which is how the one real drift signal gets lost in a list of three.
  // The first draft of this function did precisely that: `45 label(s) match no
  // undecided pair` under both unadjudicated rows, beside a `2` that means something.
  for (const b of bands) {
    const h = b.labels.headline;
    if (!h || h.unmatched === 0 || h.band.availability !== "present") continue;
    out.push(
      `⚠ **${h.unmatched} \`${h.tier}\` label(s) match no undecided pair on \`${b.label}\`.** Either the key moved again, or the matcher`,
      "has since promoted that pair to a match and its class is already shared. Reported rather than dropped, because",
      "the queue alone cannot separate the two.",
      "",
    );
  }
  if (store.census_disagrees) {
    out.push(
      "🔴 **The replicates report different label censuses**, so this score file was assembled from more than one read of",
      "the label store and the counts above describe only the first. Re-score in one run before quoting them.",
      "",
    );
  }
  return out;
}

/** §3 — reliability, one-armed, with both halves of the sentence. */
function renderReliability(rl) {
  const out = ["## 3. Reliability — our panel only", ""];
  if (rl.availability !== "present") {
    out.push(renderCell(notComputed(rl.reason)), "");
    return out;
  }
  out.push(
    `**This section is one-armed and cannot be made otherwise.** CodeRabbit: ${renderCell(rl.coderabbit)}`,
    "",
    "**The two headline figures point opposite ways and belong together.**",
    "",
    "| | measured | unit |",
    "|---|---|---|",
    // Every row goes through `renderCell`, so a section whose scorer omitted one
    // figure prints why rather than `undefined` — the first draft read
    // "reproduces on undefined of undefined items" because it reached into a cell's
    // value without asking whether the cell held one.
    `| gate verdict agreement | ${renderValue(rl.gate, (p) => `**${num(p.ratio)}** (${p.k}/${p.n})`)} | ${unitOf(rl.gate)} |`,
    `| finding-set agreement (Jaccard) | ${renderValue(rl.jaccard, (sp) => `**${values(sp, 3)}**`)} | ${unitOf(rl.jaccard)} |`,
    `| in all ${rl.k_runs} replicates | ${renderValue(rl.recurrence, (rc) => `**${num(rc.in_all.ratio)}** (${rc.in_all.k}/${rc.in_all.n})`)} | ${unitOf(rl.recurrence)} |`,
    `| in exactly one replicate | ${renderValue(rl.recurrence, (rc) => `**${num(rc.in_one.ratio)}** (${rc.in_one.k}/${rc.in_one.n})`)} | ${unitOf(rl.recurrence)} |`,
    "",
    `So the decision the panel *ships* reproduces on ${renderValue(rl.gate, (p) => `${p.k} of ${p.n}`)} items, while *which findings* it reports does not.`,
    "**Both are true, and they are about different units** — the gate verdict is per item, the agreement figures",
    "are per defect class. A reproducibility statistic that does not name its unit is ambiguous between two",
    "answers that point opposite ways.",
    "",
  );
  const sev = rl.recurrence_by_severity ?? {};
  if (Object.keys(sev).length > 0) {
    out.push(
      `Stratified, because one number for "the panel" would average the ${renderValue(rl.gate, (p) => `${p.k}/${p.n}`)} verdict agreement above against a nit:`,
      "",
      "| severity | classes | in all | in exactly one |",
      "|---|---|---|---|",
    );
    for (const k of KNOWN) {
      const b = sev[k];
      if (!b) continue;
      out.push(`| \`${k}\` | ${b.n_classes ?? "?"} | ${num(b.in_all?.ratio)} | ${num(b.in_one?.ratio)} |`);
    }
    out.push("");
  }
  if (rl.unmerged_total) {
    out.push(
      `Every agreement figure above is a **${rl.bound} bound**: ${rl.unmerged_total.maybe_cross_run} cross-run pairs were left undecided by the matcher and`,
      "never merged, so each one splits a same-defect pair into two classes and deflates every ratio.",
      "",
    );
  }
  return out;
}

/**
 * §4 — cost and latency, as TWO BLOCKS THAT SHARE NO TABLE.
 *
 * 🔴 THE LAYOUT IS THE ARGUMENT HERE, more than in any other section. Both arms carry
 * minutes and both carry money, and every instinct a reader brings is one this data
 * cannot support: they want a cost per review to compare (there is no per-review
 * price for a flat subscription) and they want a latency ratio (the two clocks time
 * different things, and the honest version says we are the slower one). Put the two
 * latencies in one table and the reader does the division themselves — so they are
 * never in one table, never on one axis, and every figure carries the name of the
 * interval it was measured over rather than the word "latency" alone.
 *
 * `renderCell` does the rest: each of the four availability states gets its own
 * sentence, and the cross-arm cell says `not measurable` PERMANENTLY, which is a
 * result and not a hole waiting on a scorer.
 */
function renderCostLatency(cl) {
  const out = ["## 4. Cost and latency", ""];
  if (cl.availability !== "present") {
    out.push(
      `Panel: ${renderCell(notComputed(cl.reason))}`,
      "",
      `Cross-arm: ${renderCell(cl.cross_arm)}`,
      "",
      "**This is an absence of the first kind — nobody computed it — and it is not a zero.** The store does hold",
      "each replay's cost in its run envelopes, and this report deliberately does not read them: a run total",
      "carries no per-item distribution, no size bucket and no `n`, and it is recomputed from the envelopes",
      "*present*, so a failed attempt whose envelope was removed leaves no trace in it. See the limits below.",
      "",
    );
    return out;
  }
  const p = cl.panel;
  const c = cl.coderabbit;
  out.push(
    "**The two arms are in two blocks, with two units and no shared axis, and this section computes no ratio",
    "between them.** That is not caution about thin data: on cost there is no second number to divide by, and on",
    "latency the two figures time different things — read the cross-arm row at the end of this section before",
    "quoting either against the other.",
    "",
    "### Our panel",
    "",
    "| what | measured | unit |",
    "|---|---|---|",
    `| spend per replicate | ${renderValue(p.spend, (s) => `**${usdValues(s)}**`)} | ${unitOf(p.spend)} |`,
    `| cost per review | ${renderValue(p.cost_per_review, (s) => `**${usd(s.median)}** (${usd(s.min)}–${usd(s.max)})`)} | ${unitOf(p.cost_per_review)} |`,
    `| wall clock per review | ${renderValue(p.wall, (s) => `**${minutes(s.median)}** (${minutes(s.min)}–${minutes(s.max)})`)} | ${unitOf(p.wall)} |`,
    // The measured zero, rendered as a measurement. `0 (n=21 envelopes)` and a blank
    // cell are the same width on the page and opposite in meaning.
    // `0 of 21`, never a bare `0`. `renderValue` drops the `(n= unit)` suffix because
    // the unit has its own column, which leaves the denominator to the caller — and
    // this is the one row where the denominator IS the finding: 0 of 21 says every
    // replay was timed, while `0` alone says nothing about how many were looked at.
    `| replays with no wall clock | ${renderValue(p.untimed, (v) => `**${v}** of ${p.untimed.n}`)} | ${unitOf(p.untimed)} |`,
    "",
  );
  if (p.fits.length > 0) {
    out.push(
      "Cost against size, per replicate — a fixed per-item floor plus a marginal rate, because the average cost",
      "per line inverts on this corpus (the biggest item is the cheapest per line) and is therefore not printed:",
      "",
      "| replicate | fit |",
      "|---|---|",
    );
    for (const f of p.fits) {
      out.push(
        `| \`${f.run_id ?? "(unnamed)"}\` | ${renderValue(f.cell, (fit) => `${usd(fit.intercept_usd)} per item + ${usd(fit.slope_usd_per_1000_lines)} per 1000 lines — ${pct(fit.fixed_share)} of the replicate is the per-item floor`)} |`,
      );
    }
    out.push("");
  }
  out.push(
    "### CodeRabbit",
    "",
    "**A different kind of number in both rows, and the units say which.** Neither belongs in the table above.",
    "",
    "| what | measured | unit |",
    "|---|---|---|",
    `| latency | ${renderValue(c.latency, (s) => `**${minutes(s.median)}** (${minutes(s.min)}–${minutes(s.max)})`)} | ${unitOf(c.latency)} |`,
  );
  if (c.latency_secondary) {
    out.push(
      `| latency, second anchor | ${renderValue(c.latency_secondary, (s) => `${minutes(s.median)} (${minutes(s.min)}–${minutes(s.max)})`)} | ${unitOf(c.latency_secondary)} |`,
    );
  }
  out.push(`| cost per review | ${renderCell(c.cost)} | — |`, "");
  if (c.latency.availability === "present" && c.triggers) {
    // WHY the second anchor pools fewer items, on the page. Its exclusions are a
    // decision the adapter READ from CodeRabbit's own marker, not an outlier rule:
    // one on-demand item reads 183.7 min from the push and 7.8 from the review's own
    // start, and a second reads an entirely ordinary 9.8 — so magnitude cannot sort
    // them and the trigger has to be read.
    out.push(
      `The two anchors agree on the ${c.triggers.automatic} automatically-triggered item(s) and are pooled separately because of the`,
      `${c.triggers["on-demand"]} on-demand one(s): where a human asked for the review, the second anchor times the human's delay in`,
      "asking rather than the review. The first anchor is CodeRabbit's own clock and survives both.",
      "",
    );
  }
  out.push(
    "### Cross-arm",
    "",
    // `renderCell` already emits its own bold marker on every absence, so nothing
    // here wraps it in a second pair — an earlier draft did and rendered `****not
    // measurable**` , which markdown collapses into a literal asterisk.
    `Cost per review, and latency, between the arms: ${renderCell(cl.cross_arm)}`,
    "",
    `Cost per real finding: ${renderCell(cl.cost_per_real_finding)}`,
    cl.cost_per_real_finding_unblocked_by ? ["", `Unblocked by: ${cl.cost_per_real_finding_unblocked_by}.`] : [],
    "",
    "That last one is the figure a budget holder actually wants, and it is the one absence in this section that a",
    "re-run would close — the others are properties of the two arms rather than of this pipeline.",
    "",
  );
  return out.flat().filter((line, i, all) => line !== "" || all[i - 1] !== "");
}

/**
 * A generated sentence, folded to the width the report's authored prose is written
 * at, so the raw markdown stays readable beside it.
 *
 * ONLY FOR PROSE, never for a table row — a fold inside a `|`-delimited line would
 * break the table.
 *
 * 🔴 IT NEVER BREAKS INSIDE A CODE SPAN, and that is not a nicety: this section's
 * bucket names contain spaces, CodeRabbit's verbatim taxonomy included, so a naive
 * space split folded `` `coderabbit_category=data integrity & integration` `` across
 * two lines and markdown then rendered the backticks as literal characters in the
 * published report. Backtick parity is tracked and a break is only taken outside a
 * span; an over-long span simply overhangs, which is the harmless failure.
 *
 * Pure and width-driven, so it cannot make two renders of one dataset differ.
 */
function wrapProse(text, width = 115) {
  const out = [];
  let line = "";
  let open = false;
  for (const word of text.split(" ")) {
    const closes = (word.match(/`/g) ?? []).length % 2 === 1;
    if (line === "") line = word;
    else if (open || line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      out.push(line);
      line = word;
    }
    if (closes) open = !open;
  }
  if (line !== "") out.push(line);
  return out;
}

/**
 * §5 — segmentation. Absent today; a grid per metric when it lands.
 *
 * 🔴 THE DEFECT THIS SHAPE FIXES. The first version pushed `sg.cells` into one table
 * and produced 149 consecutive rows, two columns, 73 of them carrying no value, rows
 * up to 231 characters — 163 lines, 34% of the report. The cube is metric × bucket ×
 * arm and it was emitted as a one-dimensional list of composite keys, so a reader had
 * to parse `metric=…/…=…/arm=…` by eye 149 times to rebuild the grid the payload
 * already carried. An honest number nobody reads has already failed, and this section
 * is quoted anyway.
 *
 * ARMS ARE COLUMNS, which is the part that makes the section do its job: §4's
 * deliverable is "where each arm wins", and panel and CodeRabbit were previously
 * dozens of rows apart on the same bucket.
 */
function renderSegmentation(sg) {
  const out = ["## 5. Where each arm wins, by segment", ""];
  if (sg.availability !== "present") {
    out.push(
      renderCell(notComputed(sg.reason)),
      "",
      `**Expected when it lands:** ${sg.expectation}.`,
      "",
      "That is worth stating in advance because a blank grid and an unbuilt grid look identical, and only one of",
      "them is a result.",
      "",
    );
    return out;
  }
  out.push(
    "§1's metrics again, cut by segment: the question here is not who scores higher overall but **where** each arm",
    "does. A cell moves when an arm's behaviour changes inside that bucket — or when the bucket simply collects more",
    "findings, which is why every cell carries its own `n`. What no cell can tell you is *why*: these are slices of",
    "one set of replays, not a controlled comparison, so a difference along an axis is a description of this corpus",
    "and never an attribution to it.",
    "",
  );
  // WHAT THE GRID ACTUALLY DID, above it, because decision 12 predicted a blank grid
  // and half of this one reports. The prediction was true per pull request only.
  out.push(
    `**${sg.reported} of ${sg.cells.length} cells report; ${sg.withheld} are withheld** for a denominator below` +
      ` min-n${sg.min_n === null ? "" : ` = ${sg.min_n}`}${sg.min_n_source ? ` (${sg.min_n_source})` : ""}.`,
    "A withheld cell carries the `n` that failed and no value, so it cannot be read as a measured zero.",
  );
  // The sentence about withholding is only true while something is withheld. A grid
  // with none would otherwise print "0 rows saying nothing is what made this section
  // unread", which is the caption-contradicts-its-grid failure that `suppressed()`
  // refuses a defaulted `min_n` to prevent, one paragraph up.
  if (sg.withheld > 0) {
    out.push(
      ...wrapProse(
        "Where a whole segment is withheld on every arm it is **counted and named below its grid rather than given a row of its " +
          // The count is `sg.withheld`, not a literal.
          `own** — a count withholds exactly as much as a row does, and ${sg.withheld} rows saying nothing is what made this section unread.`,
      ),
    );
  }
  out.push("");
  // Axes that produced no column at all, each with the scorer's own reason. An axis
  // nobody can build is a different fact from a bucket that came out thin, and only
  // one of the two appears in the table below.
  const absentAxes = sg.axes.filter((a) => a.cell);
  if (absentAxes.length > 0) {
    out.push("Axes declared but absent from the grid:", "", "| axis | why |", "|---|---|");
    for (const a of absentAxes) out.push(`| \`${a.id}\` | ${renderCell(a.cell)} |`);
    out.push("");
  }
  // Why a grid below has no rows for an axis at all. A refused pair is a third kind of
  // absence — not thin, not unbuildable, but meaningless as posed — and it was the one
  // §5 never printed.
  if (sg.pairsRefused.length > 0) {
    out.push(`Metric × axis pairs the scorer refused, by construction rather than for a thin denominator:`, "", "| pair | why |", "|---|---|");
    for (const p of sg.pairsRefused) out.push(`| \`${p.metric}\` × \`${p.axis}\` | ${renderCell(p.cell)} |`);
    out.push("");
  }
  if (sg.pairsUnitMismatch > 0) {
    out.push(
      ...wrapProse(
        `A further ${sg.pairsUnitMismatch} pair(s) are not listed because they are one fact repeated: a metric counted in pull requests, cut by an axis ` +
          "that cuts findings, gives every bucket the same denominator — a numerator filter rather than a segment (§4.1).",
      ),
      "",
    );
  }
  // The one-armed axes, named once. Their empty column is `—` in every grid below and
  // that symbol has to mean something specific, or a reader reads it as a thin cell.
  const oneArmed = sg.axes.filter((a) => a.status === "computed" && a.arms.length === 1);
  if (oneArmed.length > 0) {
    out.push(
      ...wrapProse(
        `\`—\` marks an axis the scorer declares for one arm only — ${oneArmed.map((a) => `\`${a.id}\` (${a.arms.join(", ")})`).join(" · ")} — because the field it cuts on ` +
          "exists in that arm's records and nowhere else. It is not a withheld cell: there is no measurement to withhold, and a bigger corpus would not produce one.",
      ),
      "",
    );
  }
  for (const g of sg.grids) out.push(...renderSegmentationGrid(g, sg.metrics));
  // Cells the payload gave no coordinates for. Never dropped — a payload that predates
  // the grouping fields renders as the flat list it is, and says so.
  if (sg.ungrouped.length > 0) {
    out.push(
      `**${sg.ungrouped.length} cell(s) carry no metric/axis/bucket/arm and cannot be placed in a grid**, so they are listed as the`,
      "scorer emitted them. That is a payload from before those fields existed, not a measurement problem.",
      "",
      "| segment | figure |",
      "|---|---|",
    );
    for (const c of sg.ungrouped) out.push(`| \`${c.segment}\` | ${renderCell(c.cell, num)} |`);
    out.push("");
  }
  return out;
}

/**
 * One metric's grid: buckets down, arms across.
 *
 * THE UNIT IS HOISTED INTO THE COLUMN HEADER, and only when every reported cell in
 * that column agrees on it. That is the `renderValue`/`unitOf` contract — drop the
 * `(n= unit)` suffix only where the unit is rendered adjacently — and it is what
 * keeps a row readable: the panel's unit string is `findings with a stated severity;
 * median of 3 replicates`, which repeated in every cell of every row is most of the
 * 231-character width this section had. A column whose cells disagree keeps the unit
 * in each cell, because a header that averaged two units would be the one thing
 * `figure()` refuses to allow.
 */
function renderSegmentationGrid(g, metrics) {
  const spec = metrics.find((m) => m.id === g.metric)?.spec ?? null;
  const out = [`### \`${g.metric}\`${spec === null ? "" : ` — ${spec}`}`, ""];
  // A metric whose every segment is withheld gets a sentence, not an empty table with
  // a header. The rows are still named, so "which buckets" is answerable.
  if (g.rows.length === 0) {
    out.push(
      ...wrapProse(`**No cell cleared min-n.** All ${g.withheldRows.length} segment(s) are withheld on every arm: ${g.withheldRows.map((r) => `\`${r}\``).join(" · ")}.`),
      "",
    );
    return out;
  }
  const unitOfColumn = (arm) => {
    const units = new Set(g.rows.map((r) => r.cells[arm]).filter((c) => c !== null && c.availability === "present").map((c) => c.unit));
    return units.size === 1 ? [...units][0] : null;
  };
  const units = Object.fromEntries(g.arms.map((arm) => [arm, unitOfColumn(arm)]));
  out.push(
    ...wrapProse(`Both arms report on **${g.comparable} of the ${g.twoArm}** segments this metric cuts on both arms — those rows, and only those, are a comparison.`),
    "",
    `| segment | ${g.arms.map((arm) => `${arm}${units[arm] === null ? "" : ` · ${units[arm]}`}`).join(" | ")} |`,
    `|---|${g.arms.map(() => "---").join("|")}|`,
  );
  for (const r of g.rows) {
    // `num` is passed HERE and the default is left alone. §5 is the first table whose
    // values pass through `renderCell`/`renderValue` rather than being formatted by
    // its caller, so it is the first place the raw `String(v)` default shows — it
    // printed a real cell as `0.6944444444444444`. Changing the default instead would
    // reformat CodeRabbit's measured `critical` zero as `0.000`, which reads as a
    // precision this data does not have, and would redden the test that pins a bare `0`.
    const cells = g.arms.map((arm) => {
      const c = r.cells[arm];
      if (c === null) return "—";
      if (c.availability !== "present") return renderCell(c, num);
      return units[arm] === null ? renderCell(c, num) : `${renderValue(c, num)} · n=${c.n}`;
    });
    out.push(`| \`${r.label}\` | ${cells.join(" | ")} |`);
  }
  if (g.withheldRows.length > 0) {
    out.push("", ...wrapProse(`Withheld on every arm and not given rows — ${g.withheldRows.length} segment(s): ${g.withheldRows.map((r) => `\`${r}\``).join(" · ")}.`));
  }
  out.push("");
  return out;
}

/**
 * The limits, and there are more of them than there are numbers above.
 *
 * Not a footer of disclaimers: each of these bounds a specific figure in a specific
 * direction, and two of them are the reason a metric the spec asked for is not on
 * the page at all.
 */
function renderLimits(r) {
  const s = r.sections;
  const out = [
    "## 6. Limits — what bounds each figure above",
    "",
    // ⟳ THIS LIMIT'S PREMISE WENT FALSE WHILE ITS CONSEQUENCE STAYED TRUE, which is the
    // most dangerous shape a hardcoded sentence can have. It read "No adjudicated
    // labels exist" unconditionally; 357 adjudicated PAIR labels now exist and §2
    // renders a band from them. The conclusion is untouched — there is still no
    // precision figure — but for a reason the old sentence could not state, and an
    // assertion that cannot fail when it becomes wrong is exactly what lesson 1 is
    // about. So it is derived from the label census the complementarity payload
    // carries, and the two kinds of label are named apart.
    ...labelsLimit(s),
    "",
    "**The spec asked for a radar chart and there is not one.** A radar implies every axis is a comparable",
    "per-arm quantity, and on this data at most one of four is. Reliability is one-armed; cost has no per-review",
    "price for CodeRabbit; latency is computable for both but not comparable, and the bias runs in our favour.",
    "Volume is genuinely two-armed but must be severity-stratified, which a single radar axis cannot show, and",
    "overlap is an interval rather than a point. Four axes of which three are fictional would be worse than the",
    "tables above, so the tables are what this report ships.",
    "",
    "**Two of the cross-arm rows measure GitHub, not a reviewer.** CodeRabbit's localisation rate and",
    "in-diff rate are exactly 1.000 in every cell that reports — every one of its findings resolves to a",
    "file and a line inside a hunk — **because an inline review comment is anchored to a diff line by",
    "construction.** So *\"CodeRabbit localises 100%, we localise 80%\"* is a fact about the comment API and",
    "not about reviewer discipline: our arm can cite a path the frozen diff never touched, and theirs",
    "cannot. Of the metrics cut by both arms, only the nit ratio compares the reviewers. Same species as",
    "the radar above — an axis that looks comparable and is not — and the second figure in two days that",
    "survived every check while measuring the wrong quantity.",
    "",
    "**The store's own spend total understates true spend.** `putRun` recomputes a run's totals from the",
    "envelopes *present*, and one failed attempt's envelope was deleted during the K=3 repair — so any cost",
    "figure read out of this store is low by that attempt, and nothing inside the store can see it. Stated here",
    "rather than corrected anywhere, because the evidence for it is outside the store by construction.",
    "",
  ];
  out.push(...renderLatencyLimit(r));
  if (s.complementarity.availability === "present" && s.complementarity.all_saturated) {
    out.push(
      "**The overlap ceiling is saturated, so the unique-catch counts are upper bounds on nothing.** They count",
      "unresolved pairs. Resolving them is adjudication, not scoring, and re-thresholding the matcher to make",
      "them resolve would trade this benchmark's error for a worse one in the panel's own harvest path.",
      "",
    );
  }
  if (s.reliability.availability === "present") {
    out.push(
      `**K=${s.reliability.k_runs} gives an estimate of spread, not a tight one.** Three points cannot distinguish agreement from`,
      "coincidence, and this project has twice characterised variance from two points and been wrong.",
      "",
    );
  }
  out.push(
    "**Every proportion above carries its `n` and its unit.** Where one is missing the figure is not printed at",
    "all, which is why some cells read `not measurable` rather than showing a number with no denominator.",
    "",
  );
  return out;
}

/**
 * §6's FIRST limit, and the one that subsumes the rest — derived, because its premise
 * moved.
 *
 * 🔴 TWO KINDS OF LABEL, AND ONLY ONE OF THEM MAKES A PRECISION FIGURE. A **pair**
 * label answers *"are these two findings the same defect?"* and is what §2's band rests
 * on. A **validity** label answers *"is this finding real?"* and is what precision,
 * recall and correctness need. The store now holds hundreds of the first and none of
 * the second for this corpus, so the conclusion this limit has always stated survives
 * intact while the sentence that used to justify it — *"no adjudicated labels exist"* —
 * is now false on its face.
 *
 * That is the failure mode this project keeps re-learning: the old line was an
 * assertion with no input, so it could not go red when the world moved under it. This
 * one reads the census the payload carries, so a store with validity labels in it would
 * change what §6 says rather than leaving §6 confidently wrong.
 */
function labelsLimit(s) {
  const store = s.complementarity.availability === "present" ? s.complementarity.label_store : null;
  if (!store || store.n === 0) {
    return [
      "**No adjudicated labels exist.** No precision, recall or correctness figure appears anywhere above. This",
      "is the limit that subsumes the rest: every number here describes behaviour, not quality.",
    ];
  }
  const sources = Object.entries(store.by_source);
  return [
    `**${store.n} adjudicated PAIR label(s) exist${sources.length ? ` (${sources.map(([t, n]) => `${n} \`${t}\``).join(" · ")})` : ""}, and no validity label does.** Those are`,
    "different questions and only the second bounds this report: a pair label answers *\"are these two findings the",
    "same defect?\"*, which is what §2's adjudicated band rests on, while precision, recall and correctness need",
    "*\"is this finding real?\"* — and nobody has judged that for a single finding here. **So there is still no",
    "precision, recall or correctness figure anywhere above**, and every number in this report describes behaviour",
    "rather than quality. The limit is unchanged; the reason for it is now narrower, and adjudicating pairs does",
    "not shrink it.",
  ];
}

/**
 * §4's minutes, bounded in the direction that does not flatter us — and only for the
 * items this report actually renders.
 *
 * Intersected rather than asserted, exactly like the self-review caveat: the pair is a
 * fact about two specific commits, so a report over a corpus that does not contain
 * them must not claim it. When they are absent the limit still gets a sentence,
 * because "we could not bound this" and "we did not think to" are the distinction this
 * whole module is built around.
 */
function renderLatencyLimit(r) {
  const s = r.sections.cost_latency;
  if (s.availability !== "present") return [];
  // 🔴 GATED ON EITHER ARM'S MINUTES, not on CodeRabbit's alone. The first version
  // required CodeRabbit's latency to be `present`, which deleted this caveat — and its
  // "no production pair on this corpus" fallback with it — from every report rendered
  // over a score file that carries our own wall clock and not theirs. That is the most
  // common payload there is, and it is the one where the caveat matters most: §4 then
  // prints OUR minutes with nothing bounding how they may be read against a number a
  // reader already has in their head.
  const ourMinutes = s.panel.wall.availability === "present";
  const theirMinutes = s.coderabbit.latency.availability === "present";
  if (!ourMinutes && !theirMinutes) return [];
  const items = r.corpus_item_ids.filter((id) => PRODUCTION_LATENCY_PAIR[id]);
  if (items.length === 0) {
    return [
      "**§4's latency figures have no production pair to bound them on this corpus.** Our arm's number is a replay",
      "process's time and CodeRabbit's is production end to end; the only way to bound the gap between those two",
      "kinds of number is a commit where both arms ran in production, and this corpus contains none. The direction",
      "of the bias is therefore unmeasured here rather than absent.",
      "",
    ];
  }
  const pairs = items.map((id) => PRODUCTION_LATENCY_PAIR[id]);
  // DERIVED FROM THE TWO STATED MINUTES, not asserted beside them. The first version
  // printed a hard-coded `2.2x` next to the four numbers it came from, which is the one
  // shape this module forbids everywhere else: a figure a reader cannot check against
  // the inputs on the same line. It is the mean of the per-item ratios, so editing a
  // minute value moves it, and it can never contradict the pair it summarises.
  //
  // This is the ONE place a cross-arm latency ratio is legitimate, and only because
  // both sides are the SAME interval — production, from one trigger. §4's two
  // intervals are different clocks and no ratio between them is computed anywhere.
  const ratios = pairs.map((p) => p.panel_min / p.coderabbit_min);
  const meanRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  return [
    `**🔴 §4's latency understates our panel, and here is the measurement that says so — n=${items.length}.** ` +
      `${items.map((id) => `\`${id}\``).join(" and ")} carry`,
    "`agent-review-*` check runs on the frozen commit itself, so on those two the panel ran **in production**, from",
    "the same `workflow_run: CI (requested)` trigger CodeRabbit's second anchor uses. Both arms' clocks start",
    `together there: ours **${pairs.map((p) => p.panel_min.toFixed(1)).join(" and ")} min**, theirs **${pairs.map((p) => p.coderabbit_min.toFixed(1)).join(" and ")} min** — about **${meanRatio.toFixed(1)}x longer**, the opposite`,
    "direction from §4's replay figures. So §4's minutes are not a tie, and they are not a win; they are a",
    `different interval. **n=${items.length}** is far too thin for a claim, which is exactly why this is a stated limit on §4`,
    "rather than a row inside it.",
    "",
  ];
}

// --- CLI ---------------------------------------------------------------------

const USAGE =
  "usage: report.mjs --root <eval-data-root> --corpus-version <v> --config-hash <sha256:...> [--panel-sha <sha>]\n" +
  "                  --run-id <id> [--run-id <id> ...] [--dry-run]\n" +
  "       report.mjs --root <eval-data-root> --persist --scorer-id <id> --scope per-run|cross-run\n" +
  "                  --from <file|-> [--run-id <id>] [--corpus-version <v>] [--config-hash <sha256:...>]\n" +
  "\n" +
  "PERSIST files a scorer's --json output under scores/; the default mode RENDERS a\n" +
  "markdown comparison out of scores/ into reports/<comparison id>.md.\n" +
  "\n" +
  "The render path makes NO network calls and invokes no scorer: it reads only what is\n" +
  "committed. --run-id and --config-hash are REQUIRED there even though the store\n" +
  "could be listed, because a section whose score file is missing must render as\n" +
  "'not computed', and that is only observable against a declared expectation.\n" +
  "\n" +
  "--root is REQUIRED and has no default. Writing benchmark data into whichever\n" +
  "repository this code happens to live in would be permanent.";

async function main() {
  const args = parseArgs(process.argv, { booleans: ["persist", "dry-run", "help", "json"] });
  if (args.help) {
    console.log(USAGE);
    return;
  }
  // `--root` is REQUIRED and has no default anywhere in this directory: git history
  // is permanent, so one flag that fell back to a path inside this repository would
  // commit benchmark data into `wafflebase` for good. #791 and the store both make
  // the same refusal; this is the third and it is not a coincidence.
  if (!args.root) {
    console.error("--root is required (no default: this module must not be able to write inside its own repository)\n");
    console.error(USAGE);
    process.exit(2);
  }
  const { EvalStore } = await import("./store.mjs");
  const store = new EvalStore(args.root);
  // `repeated` prepends the dashes itself — pass the bare flag name. `parseArgs` is
  // single-valued by construction, so a repeated `--run-id` would otherwise keep only
  // the last one and a K=3 report would render one replicate under a three-replicate
  // header. Reused from `reliability.mjs` rather than copied: two implementations of
  // this already exist in this directory (`runIdsFrom` is complementarity's) and a
  // third would be the one that drifts.
  const runIds = repeated(process.argv, "run-id");

  if (args.persist) {
    if (!args["scorer-id"] || !args.scope || !args.from) {
      console.error("--persist needs --scorer-id, --scope and --from\n");
      console.error(USAGE);
      process.exit(2);
    }
    // A scorer id outside `SECTIONS` is refused rather than filed. The renderer looks
    // for a fixed list of names, so a typo would write a file nothing ever reads and
    // leave the section it was meant for reading "not computed" — a silent no-op with
    // a success exit code, which is this project's signature failure.
    if (!SCORER_IDS.includes(args["scorer-id"])) {
      console.error(`--scorer-id ${JSON.stringify(args["scorer-id"])} is not one this report reads (${SCORER_IDS.join(", ")}) — filing it would be a silent no-op`);
      process.exit(2);
    }
    const raw = args.from === "-" ? readFileSync(0, "utf8") : readFileSync(args.from, "utf8");
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (e) {
      console.error(`--from ${args.from} is not JSON: ${e.message}`);
      process.exit(1);
    }
    const written = store.putScore(
      {
        scorerId: args["scorer-id"],
        scope: args.scope,
        runId: runIds[0] ?? null,
        configHash: args["config-hash"] ?? null,
        corpusVersion: args["corpus-version"] ?? null,
      },
      payload,
    );
    console.error(`persisted ${args["scorer-id"]} (${args.scope}) → ${written}`);
    return;
  }

  for (const flag of ["corpus-version", "config-hash"]) {
    if (!args[flag]) {
      console.error(`--${flag} is required on the render path\n`);
      console.error(USAGE);
      process.exit(2);
    }
  }
  const corpus = store.getCorpus(args["corpus-version"]);
  if (corpus === null) {
    console.error(`corpus version ${JSON.stringify(args["corpus-version"])} does not exist under this root`);
    process.exit(1);
  }
  if (runIds.length === 0) {
    console.error("--run-id is required (repeatable) — a report that does not name its replicates cannot say which per-run scores are missing");
    process.exit(2);
  }

  const key = { configHash: args["config-hash"], corpusVersion: args["corpus-version"] };
  // The PANEL SHA is read from a run envelope rather than taken on trust, because it
  // is the half of the reviewer pair that `config_hash` cannot see. `--panel-sha`
  // exists for a store whose runs are absent, and a disagreement is refused rather
  // than resolved: two answers to "who reviewed this" is exactly the state decision
  // 13 says must not be pooled.
  const stated = new Set();
  for (const runId of runIds) {
    const run = store.getRun(runId);
    if (!run) {
      console.error(`run ${JSON.stringify(runId)} does not exist under this root`);
      process.exit(1);
    }
    if (typeof run.runJson?.panel_sha === "string" && run.runJson.panel_sha.trim() !== "") stated.add(run.runJson.panel_sha);
    if (run.runJson?.config_hash && run.runJson.config_hash !== args["config-hash"]) {
      console.error(`run ${runId} was produced under config_hash ${run.runJson.config_hash}, not ${args["config-hash"]} — refusing to pool two reviewers (decision 13)`);
      process.exit(1);
    }
  }
  if (args["panel-sha"]) stated.add(args["panel-sha"]);
  if (stated.size > 1) {
    console.error(`the runs name ${stated.size} panel_sha values (${[...stated].join(", ")}) — they are not replicates of one reviewer`);
    process.exit(1);
  }

  const scores = {};
  const missing = [];
  for (const section of SECTIONS) {
    if (section.scope === "per-run") {
      // One file per replicate, and a replicate whose score is absent is RECORDED as
      // absent rather than skipped: `volumeFigures` renders three values, so silently
      // dropping one would print a two-replicate range under a three-replicate header.
      const perRun = runIds.map((runId) => {
        const got = store.getScore({ scorerId: section.scorer_id, scope: "per-run", runId });
        if (!got) missing.push(`${section.scorer_id} for ${runId}`);
        return got ? { ...got, run_id: runId } : null;
      });
      // The NULLS ARE PASSED THROUGH, holes and all. An earlier version filtered them
      // out here, which did exactly what the comment above forbids: with 2 of 3 score
      // files present the section rendered "panel — 2 replicates" and a 2-value range
      // while the header table listed 3, and the only trace of the third was a line on
      // stderr. `volumeFigures` counts the holes and the section states them.
      scores[section.key] = perRun;
    } else {
      const got = store.getScore({ scorerId: section.scorer_id, scope: "cross-run", ...key });
      if (!got) missing.push(section.scorer_id);
      scores[section.key] = got;
    }
  }
  for (const m of missing) console.error(`  ! no score filed for ${m} — its section will render as "not computed"`);

  const result = buildReport({
    ...key,
    panelSha: [...stated][0] ?? null,
    runIds,
    corpusItemIds: corpus.map((it) => it.id),
    scores,
  });
  const markdown = renderReport(result);
  if (args.json) console.log(JSON.stringify(result, null, 2));
  // A report rendered over missing inputs is still a correct report — the absences are
  // ON the page — but it is not the complete comparison, and a pipeline must not be
  // able to quote it as one by ignoring stderr. Same rule as the three scorers'.
  //
  // SET BEFORE THE DRY-RUN BRANCH, not after it. The first draft returned early on
  // `--dry-run` and therefore exited 0 over two absent sections, which is the wrong
  // way round: a dry run writes nothing but prints the whole report to stdout, so it
  // is the mode most likely to be piped somewhere.
  process.exitCode = missing.length === 0 ? 0 : 1;
  if (args["dry-run"]) {
    process.stdout.write(markdown);
    console.error(`\ndry run: nothing written. ${missing.length} section input(s) absent.`);
    return;
  }
  const written = store.putReport(result.comparison_id, markdown);
  console.error(`wrote ${written}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error("report failed:", e.message);
    process.exit(1);
  });
}
