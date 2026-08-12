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
// distribution, so report `n` and a range beside every central figure) and the
// severity-stratified count ratio between the arms (§3.1's volume comparison) — and
// both are computed by helpers imported from the scorers that own them rather than
// re-derived here. If a number is wanted that no scorer emits, the answer is a
// scorer, not a line in this file.
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
 * Cost and latency — `not-computed` today, and the section exists so that it can say
 * so.
 *
 * #791 is OPEN, not merged, so nothing has ever written `cost-latency-v1.json`. The
 * temptation this section resists is reading `run.json`'s `totals` instead: the
 * numbers are right there and they are `$92.93` for the pilot. Two reasons not to.
 * A run total is not a scored figure — it has no per-item distribution, no size
 * bucket and no `n` — and `putRun` recomputes totals from the envelopes PRESENT, so
 * a failed attempt whose envelope was deleted during the K=3 repair leaves no trace
 * in it. Printing a store total as this report's cost figure would publish a number
 * that is known to understate true spend, with nothing on the page saying so. The
 * standing caveat is in `renderLimits` instead, where it belongs.
 *
 * 🔴 AND THERE IS NO RATIO HERE EVEN WHEN #791 LANDS. CodeRabbit is a flat
 * subscription with no per-review price, so cost has no cross-arm denominator; and
 * latency is computable for both but not comparable — ours is a replay PROCESS time,
 * theirs is production end-to-end, and the bias runs in our favour.
 */
export function costLatencyFigures(payload) {
  if (!payload) {
    return {
      availability: "not-computed",
      reason: `no ${sectionFor("cost_latency").scorer_id} score is filed — the cost/latency scorer is not merged, so nobody has computed it`,
      cross_arm: notMeasurable(
        "CodeRabbit is a flat subscription with no per-review price, so cost has no cross-arm denominator; and latency is computable for both arms but not comparable — ours is replay process time, theirs is production end-to-end, and the bias runs in our favour",
      ),
    };
  }
  return {
    availability: "present",
    reviewer: payload.reviewer ?? null,
    completeness: payload.completeness ?? null,
    // Deliberately not unpacked further. This PR cannot render fields whose shape is
    // still in review on #791; when it merges, the section grows here and the
    // absence path above stops being taken.
    payload_keys: Object.keys(payload).sort(),
    cross_arm: notMeasurable("no per-review price for CodeRabbit, and the two latencies are not comparable — see #791"),
  };
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
      expectation: "on a corpus this small every cell is expected to be suppressed for a thin denominator, and decision 12 calls that blank grid the correct output rather than a failure",
      cells: [],
    };
  }
  const cells = (Array.isArray(payload.cells) ? payload.cells : []).map((c) => ({
    segment: c.segment ?? "(unnamed)",
    // A cell the scorer withheld renders as withheld, with the numbers that decided
    // it. A cell it measured renders as measured, INCLUDING a measured zero.
    cell: c.suppressed === true ? suppressed(c.n, c.min_n) : figure(c.value, c.n, c.unit),
  }));
  return { availability: "present", cells, min_n: payload.min_n ?? null };
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
      `The queue is ${worst.maybe_links} undecided pairs, of which **${worst.strong_maybe_links} score ≥ ${worst.triage_threshold}** — so adjudicating this costs tens of`,
      "pairs rather than hundreds. **Until those labels exist, this row must not be read as a point estimate.**",
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

/** §4 — cost and latency. Absent, in the flavour that says nobody measured it. */
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
  out.push(`Cross-arm: ${renderCell(cl.cross_arm)}`, "");
  return out;
}

/** §5 — segmentation. Absent today; blank by design when it lands. */
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
  out.push("| segment | figure |", "|---|---|");
  for (const c of sg.cells) out.push(`| \`${c.segment}\` | ${renderCell(c.cell)} |`);
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
    "**No adjudicated labels exist.** No precision, recall or correctness figure appears anywhere above. This",
    "is the limit that subsumes the rest: every number here describes behaviour, not quality.",
    "",
    "**The spec asked for a radar chart and there is not one.** A radar implies every axis is a comparable",
    "per-arm quantity, and on this data at most one of four is. Reliability is one-armed; cost has no per-review",
    "price for CodeRabbit; latency is computable for both but not comparable, and the bias runs in our favour.",
    "Volume is genuinely two-armed but must be severity-stratified, which a single radar axis cannot show, and",
    "overlap is an interval rather than a point. Four axes of which three are fictional would be worse than the",
    "tables above, so the tables are what this report ships.",
    "",
    "**The store's own spend total understates true spend.** `putRun` recomputes a run's totals from the",
    "envelopes *present*, and one failed attempt's envelope was deleted during the K=3 repair — so any cost",
    "figure read out of this store is low by that attempt, and nothing inside the store can see it. Stated here",
    "rather than corrected anywhere, because the evidence for it is outside the store by construction.",
    "",
  ];
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
