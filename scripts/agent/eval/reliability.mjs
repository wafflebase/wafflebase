// Ask the same reviewer the same question K times: does it answer the same way?
//
// Spec §3.2 (a)–(e) over K replicate runs of one corpus: finding-set agreement,
// per-class recurrence, verifier-verdict agreement, gate agreement, and the
// detection→reported attribution. Every number is stratified by severity and every
// number carries its `n`, because the pilot measured the churn to BE
// severity-dependent — one pooled agreement figure would average a gate verdict
// that never flips together with a nit population that reproduces 6% of the time.
// (6%, not the 17% an earlier draft of this comment carried: 17.6% is the FILE-level
// figure, and at finding level nits reproduce in all three replicates 2 times out of
// 34. Quoting a file-level share in a finding-level file is the exact confusion this
// module's own measurements corrected.)
//
// THE ONE SENTENCE THIS FILE EXISTS TO SUPPORT, and it has two halves that must
// travel together: **the panel is reliable at the decision level and unreliable at
// the finding level.** A single reliability number is how one half gets lost, so
// there is no such number in the output — the gate section and the class-agreement
// section are separate deliverables, each with its own denominator.
//
// FOUR THINGS THIS CANNOT SAY, all measured rather than suspected. They are stated
// here because each one otherwise gets discovered by a reader of the output:
//
//   1. IT IS A ONE-ARMED METRIC. §3.2's other half — CodeRabbit's natural retest
//      pairs — needs a pull request it reviewed twice with the finding's lines
//      untouched in between. Every item of the frozen corpus has exactly ONE
//      finding-bearing CodeRabbit review, so the number of usable pairs is n=0 and
//      no pair-finder is built here (a finder that can only return 0 cannot be
//      tested against real data). §3.2's own instruction is to report that number
//      honestly. Consequence: every figure below describes OUR panel, and it is not
//      a comparison. Nothing in this file can make it one.
//   2. AGREEMENT IS A LOWER BOUND. Findings have no identity across runs, so
//      agreement is computed over defect classes from `groupFindings` — and two
//      findings from different runs are cross-source there (`gateFor` needs the same
//      `run`), so they take the L2 gate, which answers `maybe` for a location tie
//      that misses the token bar. A `maybe` never merges, so every unmerged
//      same-defect pair splits one class in two, inflating the union and deflating
//      the ratio. The `maybe` count is therefore printed beside every ratio, and
//      NOTHING here re-thresholds or promotes one: resolving a `maybe` is
//      adjudication, not scoring.
//   3. κ IS UNINFORMATIVE ON THIS DATA, and it is reported anyway. It is legitimate
//      only for (c), where the universe is bounded ("findings present in both runs")
//      — never for presence/absence, where the union of OBSERVED classes has no true
//      negatives and expected agreement is undefined. Even in (c) the outcome
//      distribution is degenerate: 89 confirmed-high, 6 confirmed-low, 2 errored and
//      NOT ONE refutation across the 21 pilot replays. So κ near zero beside ~98%
//      raw agreement is the guaranteed result rather than a caveat, and κ is not a
//      bare number field anywhere in this output — it ships inside an object that
//      carries its marginals and that caveat, because a κ of 0.02 printed alone is
//      the most misleading number this file could produce.
//   4. EVERY n IS TINY. 7 items × 3 pairs = 21 pairwise comparisons; each per-item
//      figure rests on 3 observations, and per-lens on as few as 4 findings (`docs`
//      produced 4/5/8 across the three replicates — a 100% spread on the smallest n
//      in the grid). Hence: no bare mean anywhere. Each pair's value is printed
//      beside the other two and their range, because a mean of three numbers hides
//      exactly the spread this scorer exists to measure.
//
// THREE REFUSALS, and they are most of the value here. Each ABORTS:
//
//   - Two reviewers are not two replicates. Pooling runs whose `panel_sha`,
//     `config_hash` or `corpus_version` differ is the one error whose symptom is a
//     plausible number (decision 13: if the panel moves, only the corpus items carry
//     forward, never the results).
//   - A failed replay is not a clean review. An `error` item can carry zero findings,
//     which is indistinguishable at the record level from a review that found
//     nothing — and in an agreement metric a missing set reads as disagreement, in a
//     precision metric a false clean review is a perfect score.
//   - Reliability over one replicate is not a degraded number, it is undefined.
//
// NOTHING IS WRITTEN AND NOTHING IS SPENT. Records in, numbers out: no store, no
// network, no clock, and no `--out`. `--root` is where the store is READ from.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { KNOWN } from "../vendor/pipeline/severity.mjs";
import { LINKAGE, groupFindings } from "../finding-match.mjs";
import { POPULATIONS } from "./finding-record.mjs";
import { proportion } from "./volume-mix.mjs";
import { parseArgs } from "../vendor/pipeline/gh-checks.mjs";

const refuse = (msg) => {
  throw new Error(`reliability: ${msg}`);
};

/** Field separator for the composite keys below; the same choice and reason as
 *  `finding-match.mjs`'s — a character no id, path or hash can contain, so two
 *  different tuples can never read alike. A space would not do: a cited file path
 *  may contain one. */
const NUL = "\u0000";

/** Bumped when a field changes meaning, never when one is added — the rule
 *  `finding-record.mjs` states, for the reason it states it. */
export const SCHEMA_VERSION = 1;

/**
 * The direction every agreement figure in this output is wrong in, named as data
 * rather than left to a docstring.
 *
 * It is `"lower"` for the mechanism in point 2 above, and it is a FIELD because a
 * consumer that renders `jaccard.ratio` without it is reporting "the panel agrees
 * X% of the time", which is the one sentence this metric does not support. A
 * reader who sees a bound direction beside a ratio can at least tell which way to
 * be sceptical.
 */
export const BOUND = "lower";

/**
 * What the verifier said about a finding, and the two values that are NOT verdicts.
 *
 * The spec says "confirmed / refuted". The real vocabulary has four values and
 * refuted is not among them — measured across all 21 pilot replays:
 * `confirmed-high 89 · confirmed-low 6 · errored 2 · null 331`. Two consequences,
 * both of them lesson 6 ("absent has more than one cause, and pooling them is a
 * scoring bug"):
 *
 *   errored   the verifier RAN and failed. It is its own outcome and never a
 *             refutation — reading it as one would credit the panel with a
 *             self-correction it did not make.
 *   not-run   `verification: null`. The verifier never looked, and on this data
 *             that is structural rather than accidental: it runs on blocking
 *             severity only (`critical` 4 of 4 carry a verdict, `major` 93 of 100,
 *             `minor` and `nit` never). Two `not-run`s "agreeing" is not verifier
 *             agreement, so a class is excluded from (c) unless BOTH sides carry a
 *             real verdict — and the exclusion is counted, not silent.
 *   split     our own inability to attribute one outcome: the run has several
 *             members in this class carrying different verdicts. Also excluded,
 *             also counted.
 *
 * The 7 blocking findings with no verdict are unexplained; this file reports the
 * count and theorises nothing.
 */
export const VERIFIER_VERDICTS = Object.freeze(["confirmed-high", "confirmed-low", "errored"]);
export const VERIFIER_NON_VERDICTS = Object.freeze(["not-run", "split"]);

/** The κ caveat, carried in the output beside every κ so the two cannot be
 *  separated by a consumer. §3.2 asks for the caveat on the chart; on this data it
 *  is not a caveat but the expected result, which is why it is attached to the
 *  number rather than written next to it. */
export const KAPPA_CAVEAT =
  "κ is chance-corrected agreement and is uninformative when one outcome dominates: read it ONLY beside " +
  "raw agreement and the marginal distribution printed with it. On the pilot data one outcome (confirmed-high) " +
  "holds ~93% of all verdicts and there is not one refutation, so κ near 0 or undefined is the expected result " +
  "and says nothing about the verifier's stability.";

/**
 * Did the run's gate BLOCK this item? Three values, and the third is the one that
 * keeps the headline honest.
 *
 *   gated    at least one blocking, applicable lens check did not conclude success.
 *   clean    rows are present and none of them did.
 *   unknown  there are no rows to read. NEVER `clean`: a payload with no `panel[]`
 *            would otherwise produce "no lens failed" out of "no lens was
 *            recorded", which is exactly the absence-read-as-a-verdict bug this
 *            project keeps re-learning.
 */
export const GATE_VERDICTS = Object.freeze(["gated", "clean", "unknown"]);

/**
 * WHY the gate verdict is what it is — cause → answer, frozen so the two can never
 * be stated independently and disagree, the same construction `GATING_BASIS` uses.
 *
 * The rule is the WORKFLOW's, read off `.github/workflows/agent-review-panel.yml`:
 * it walks the lens manifest, takes `blocking && applicable`, maps the orchestrator
 * conclusion (`success` → success, `skipped` → neutral, anything else → failure)
 * and blocks on any required check that is not success. So `applicable: false` is
 * excluded from the decision entirely — on the pilot that is 15 of 126 rows, every
 * one of them a `skipped` docs lens — while an APPLICABLE lens that skipped would
 * block, because neutral is not success.
 *
 * ONE DELIBERATE DIVERGENCE FROM THE GATE, and it is the same one
 * `finding-record.mjs` documents for the lane: the workflow fails CLOSED on a lens
 * the payload never recorded (`raw = p ? p.conclusion : 'failure'`), because it is
 * deciding whether to stop a merge. A scorer must not turn "not recorded" into a
 * verdict, so a missing row reads `unknown` here and the item is excluded from the
 * agreement denominator with its reason. The two rules differ because the two jobs
 * differ; on the pilot the divergence is unreachable, since all 21 payloads carry
 * all six rows.
 */
export const GATE_BASIS = Object.freeze({
  /** A blocking, applicable lens concluded something other than `success`. */
  "lens-check-failed": "gated",
  /** Rows present, every blocking applicable one concluded `success`. */
  "no-lens-check-failed": "clean",
  /** No `panel[]` rows at all — the gate's own input is missing. */
  "no-panel-rows": "unknown",
  /** Rows present but none of them is blocking AND applicable, so the workflow's
   *  required-check set would be empty and there is no decision to reproduce.
   *  Distinct from `clean`, which is a decision. */
  "no-gating-rows": "unknown",
});

/** How the LANE route answered, used only to cross-check the route above. Same
 *  three answers, and `unknown` for the population that structurally has no lane
 *  (`sampled` records are pre-annotation), never `clean`. */
export const LANE_BASIS = Object.freeze({
  /** At least one record `gatingOf` calls `gates` — blocking severity on the
   *  blocking lane. Read off the record's own `gating`, not re-derived from
   *  `lane === "blocking"`, so "what blocks a PR" keeps one definition. */
  "record-gates": "gated",
  /** Records present, none of them gates. */
  "no-record-gates": "clean",
  /** The item produced no records at all, so the lane route has nothing to read.
   *  A clean review genuinely produces none, which is why this is not `clean`:
   *  the two are told apart by the envelope status, and that is the panel-row
   *  route's job rather than this one's. */
  "no-records": "unknown",
});

const severityRank = (s) => {
  const i = KNOWN.indexOf(String(s ?? "").toLowerCase().trim());
  return i === -1 ? KNOWN.length : i;
};

/**
 * The severity a defect CLASS is filed under: its most severe member's.
 *
 * Two runs can grade one defect differently, and they do — so the alternative
 * (stratify the input and group each stratum separately) would let one defect
 * become two classes purely because the second replicate called it `minor`, which
 * inflates the union in the stratum that matters most. Taking the maximum keeps a
 * defect in one class and files it where a reader looking for blocking-severity
 * churn would expect to find it; `severity_disagreement` in the recurrence output
 * says how often the members disagreed, so the choice is visible rather than
 * buried.
 */
export function classSeverity(members) {
  const list = (Array.isArray(members) ? members : []).map((m) => m?.finding?.severity);
  let best = null;
  for (const s of list) if (best === null || severityRank(s) < severityRank(best)) best = s;
  return best ?? null;
}

/** Distinct run ids among a class's members, sorted. `null` runs are dropped —
 *  a member that cannot say which replicate it came from cannot witness
 *  agreement between two. */
export function classRuns(members) {
  return [...new Set((Array.isArray(members) ? members : []).map((m) => m?.run).filter((r) => typeof r === "string" && r !== ""))].sort();
}

/**
 * Cohen's κ for two raters over a bounded outcome set, with everything needed to
 * read it attached.
 *
 * `pairs` is `[[outcomeA, outcomeB], …]`. The return value is deliberately NOT a
 * number: κ alone is the most misleading figure this module can emit, so it ships
 * with `raw_agreement`, the marginal distribution of each side, and the caveat.
 *
 * `kappa` is `null` — never 0 — when it is undefined: no pairs, or expected
 * agreement 1 (every rating on both sides identical, which is the degenerate table
 * this data walks straight into). A 0 there would read as "no better than chance"
 * for a rater that in fact never disagreed with itself.
 */
export function cohenKappa(pairs) {
  const list = (Array.isArray(pairs) ? pairs : []).filter((p) => Array.isArray(p) && p.length === 2);
  const n = list.length;
  const categories = [...new Set(list.flat())].sort();
  const marginals = { a: {}, b: {} };
  for (const c of categories) {
    marginals.a[c] = 0;
    marginals.b[c] = 0;
  }
  let agreed = 0;
  for (const [a, b] of list) {
    marginals.a[a]++;
    marginals.b[b]++;
    if (a === b) agreed++;
  }
  const observed = n > 0 ? agreed / n : null;
  const expected = n > 0 ? categories.reduce((s, c) => s + (marginals.a[c] / n) * (marginals.b[c] / n), 0) : null;
  let undefinedReason = null;
  if (n === 0) undefinedReason = "no comparable pair";
  else if (expected >= 1) undefinedReason = "one outcome holds every rating on both sides, so expected agreement is 1 and κ is undefined — NOT 0";
  return {
    n,
    raw_agreement: proportion(agreed, n),
    observed,
    expected,
    kappa: undefinedReason === null ? (observed - expected) / (1 - expected) : null,
    kappa_undefined_reason: undefinedReason,
    categories,
    marginals,
    caveat: KAPPA_CAVEAT,
  };
}

/** `{values, min, max, range, mean, n}` over the K-choose-2 pairwise figures.
 *  `mean` is here because §3.2's worked example quotes one, and it is never alone:
 *  `values` and `range` sit beside it, and `renderReport` prints them first. Three
 *  points describe a spread badly, and a mean describes it not at all. */
export function spread(values) {
  const xs = (Array.isArray(values) ? values : []).filter((v) => Number.isFinite(v));
  if (xs.length === 0) return { values: [], n: 0, min: null, max: null, range: null, mean: null };
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  return { values: xs, n: xs.length, min, max, range: max - min, mean: xs.reduce((a, b) => a + b, 0) / xs.length };
}

/**
 * The gate verdict a run reached for one item, from the `panel[]` rows.
 *
 * Rows are read defensively because they are model-adjacent output written by the
 * orchestrator: a row that is not an object, or whose `conclusion` is not a
 * string, cannot say `success` and therefore counts as a failure IF it is blocking
 * and applicable — matching the workflow, which fails closed on a row it cannot
 * read. That is a different case from a row that is ABSENT, which is the one this
 * file refuses to interpret.
 */
export function gateVerdictOf(panelRows) {
  const rows = Array.isArray(panelRows) ? panelRows.filter((r) => r && typeof r === "object" && !Array.isArray(r)) : [];
  const basis = (b, extra) => ({ gate: GATE_BASIS[b], gate_basis: b, rows: rows.length, ...extra });
  if (rows.length === 0) return basis("no-panel-rows", { gating_rows: 0, failed_rows: [] });
  // `blocking` describes the LENS, not the run — it is `true` on every slot the
  // pilot produced — so it is ANDed with `applicable` exactly as the workflow does.
  // Reading `blocking` alone would count a skipped, inapplicable docs lens as a
  // gating check that never went green.
  const gating = rows.filter((r) => r.blocking === true && r.applicable !== false);
  if (gating.length === 0) return basis("no-gating-rows", { gating_rows: 0, failed_rows: [] });
  const failed = gating.filter((r) => r.conclusion !== "success").map((r) => `${r.id ?? "(unnamed)"}:${r.conclusion ?? "(none)"}`);
  return basis(failed.length > 0 ? "lens-check-failed" : "no-lens-check-failed", { gating_rows: gating.length, failed_rows: failed });
}

/**
 * The same question answered from the FINDINGS instead — the cross-check.
 *
 * Two independent routes to one decision: the check-run conclusions the workflow
 * gates on, and the lane the novelty gate routed each finding to. They are derived
 * from different fields by different code, so agreement between them is evidence
 * and disagreement is a defect in one of them — which is why `reliabilityOf`
 * ABORTS on a disagreement rather than picking a winner.
 */
export function laneGateOf(records) {
  const rs = Array.isArray(records) ? records : [];
  const basis = (b, extra) => ({ lane_gate: LANE_BASIS[b], lane_basis: b, ...extra });
  if (rs.length === 0) return basis("no-records", { gating_records: 0 });
  const gates = rs.filter((r) => r?.gating === "gates").length;
  return basis(gates > 0 ? "record-gates" : "no-record-gates", { gating_records: gates });
}

// --- the three refusals ------------------------------------------------------

/**
 * ONE reviewer, ONE subject, or nothing is a replicate of anything.
 *
 * The pooling key is `(config_hash, panel_sha, corpus_version)`: the first two are
 * the reviewer — `config_hash` cannot see the panel's code, so a changed gate or a
 * new verifier stage leaves it identical — and the third is what was reviewed.
 * Decision 13 is explicit that when the reviewer moves only the corpus ITEMS carry
 * forward, never the results, and the fork's checkout determines `panel_sha`, so
 * this is a live hazard rather than a theoretical one.
 *
 * IT ALSO REFUSES AN INPUT THAT CANNOT PROVE THE REVIEWER. Zero visible identities
 * is not "one reviewer"; it is an unverifiable pool, and every number downstream
 * would be meaningless in a way nothing else would catch. Identity is read from BOTH
 * the records (every panel record carries the run's provenance) and the per-item
 * envelope facts, because a run whose every item produced no findings has no records
 * to read it off — and that run is exactly the one a reader would most want excluded.
 *
 * THE REVIEWER AND THE CORPUS ARE CHECKED SEPARATELY, and a value nobody stated is
 * NOT a value. Building one composite key out of all three looked tidier and was
 * wrong: a finding record cannot carry `corpus_version` — `provenanceOf` does not
 * put it there, and correctly, since it is a property of the run — so a placeholder
 * in that slot made every run disagree with ITSELF, and the guard fired on a
 * perfectly poolable input. That failure mode is the one this whole file is about:
 * an absence pooled with a value. An unstated corpus is therefore reported as
 * `null` rather than refused, while two DIFFERENT stated corpora still abort.
 */
export function assertOneReviewer(runs) {
  const reviewers = new Map();
  const corpora = new Map();
  const note = (map, key, where) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(where);
  };
  const stated = (v) => typeof v === "string" && v.trim() !== "";
  for (const run of Array.isArray(runs) ? runs : []) {
    const id = run?.run_id ?? "(unnamed run)";
    if (stated(run?.corpus_version)) note(corpora, run.corpus_version, id);
    for (const r of Array.isArray(run?.records) ? run.records : []) {
      if (stated(r?.panel?.config_hash) && stated(r?.panel?.panel_sha)) note(reviewers, `${r.panel.config_hash}${NUL}${r.panel.panel_sha}`, id);
    }
    for (const it of Array.isArray(run?.items) ? run.items : []) {
      if (stated(it?.config_hash) && stated(it?.panel_sha)) note(reviewers, `${it.config_hash}${NUL}${it.panel_sha}`, id);
      if (stated(it?.corpus_version)) note(corpora, it.corpus_version, id);
    }
  }
  const listing = (map) => [...map.entries()].map(([key, where]) => `${key.split(NUL).join(" / ")} (${[...where].sort().join(", ")})`).join(" · ");
  if (reviewers.size === 0) {
    refuse(
      "no run states a (config_hash, panel_sha) — nothing here can be shown to be a replicate of anything else, and an " +
        "unprovable pool is worse than a missing number. Pass the envelope's reviewer identity on each item",
    );
  }
  if (reviewers.size > 1) {
    refuse(
      `the runs span ${reviewers.size} (config_hash, panel_sha) identities, so they are not replicates of one reviewer and no ` +
        `agreement figure over them means anything (decision 13): ${listing(reviewers)}`,
    );
  }
  if (corpora.size > 1) {
    refuse(
      `the runs span ${corpora.size} corpus versions, so they are not replicates over one subject and every per-item figure ` +
        `would be about a different pull request in each: ${listing(corpora)}`,
    );
  }
  const [config_hash, panel_sha] = [...reviewers.keys()][0].split(NUL);
  return { config_hash, panel_sha, corpus_version: corpora.size === 1 ? [...corpora.keys()][0] : null };
}

/**
 * Every item must be a real verdict, and an item whose status nobody supplied is
 * not one.
 *
 * A failed replay is NOT a clean review, and the two are indistinguishable at the
 * record level: `adapters/reviewer.mjs` writes `findings: null` on purpose so that
 * "nothing was found" is not spellable by a missing file, and an `error` item can
 * still carry a partial set. In an agreement metric a truncated set reads as
 * disagreement — the panel would look unreliable because the harness failed.
 *
 * UNKNOWN IS REFUSED TOO, and that is the load-bearing half of this guard.
 * `adapters/panel.mjs`'s per-item read does not return the envelope's `status`
 * (it rides on each record as `panel.item_status`, which an item with zero findings
 * therefore carries nowhere), so a caller that forgets it gets `undefined` — and
 * defaulting that to `ok` would silently pool exactly the items this refuses. The
 * caller must read the status from the store; the CLI below does.
 *
 * It ABORTS rather than excluding, deliberately, and the escape hatch is named in
 * the message: a partially-failed replicate is scorable only for the items that
 * succeeded, and choosing them is the operator's call rather than a default this
 * file makes by dropping rows.
 */
export function assertItemsOk(runs) {
  const bad = [];
  for (const run of Array.isArray(runs) ? runs : []) {
    const declared = new Map();
    for (const it of Array.isArray(run?.items) ? run.items : []) {
      if (typeof it?.item_id === "string" && it.item_id !== "") declared.set(it.item_id, it);
    }
    const fromRecords = new Set((Array.isArray(run?.records) ? run.records : []).map((r) => r?.item_id).filter((v) => typeof v === "string" && v !== ""));
    for (const id of new Set([...declared.keys(), ...fromRecords])) {
      const status = declared.get(id)?.status;
      if (status === "ok") continue;
      bad.push(`${run?.run_id ?? "(unnamed run)"}/${id}: status ${status === undefined ? "not supplied" : JSON.stringify(status)}${declared.get(id)?.reason ? ` (${declared.get(id).reason})` : ""}`);
    }
  }
  if (bad.length > 0) {
    refuse(
      `${bad.length} item(s) are not a poolable verdict, and an incomplete finding set reads as disagreement rather than ` +
        `as a failed replay: ${bad.join(" · ")}. Read envelope.status from the store — the panel adapter's per-item read ` +
        `does not return it — and select the items that succeeded with --item`,
    );
  }
}

/**
 * The corpus the caller ASKED for must be the corpus the runs replayed.
 *
 * `assertOneReviewer` proves the runs agree with EACH OTHER; this proves they agree
 * with the label being printed on the result. Without it a caller may pass
 * `--corpus-version A` while every run replayed B: the corpus item ids — and
 * therefore the coverage figure and the `completeness` verdict — come from A, the
 * agreement figures come from B, and the output is labelled A. Every number would be
 * real and the report would be about a corpus it never read, which is
 * `assertRunMatchesCorpus`'s hazard in `volume-mix.mjs` reached by a different route.
 *
 * A LABEL NOBODY CAN CHECK IS ALSO REFUSED. When the caller names a version and the
 * runs state none, there is nothing to verify it against — lesson 7's question, asked
 * of this guard's own input rather than of its rule. Requesting nothing is fine: the
 * result then carries the runs' own stated version and claims no more than that.
 */
export function assertRequestedCorpus(stated, requested) {
  if (!(typeof requested === "string" && requested.trim() !== "")) return stated;
  if (!(typeof stated === "string" && stated.trim() !== "")) {
    refuse(
      `the caller asked for corpus ${JSON.stringify(requested)} and no run states a corpus_version, so the label cannot be ` +
        `checked against the data — a figure labelled with an unverifiable corpus is worse than one labelled with none`,
    );
  }
  if (stated !== requested) {
    refuse(
      `the caller asked for corpus ${JSON.stringify(requested)} but the runs replayed ${JSON.stringify(stated)} — the item ` +
        `ids, the coverage figure and the completeness verdict would come from one corpus and every agreement figure from ` +
        `another, under one label`,
    );
  }
  return stated;
}

/** Two runs at the least. Reliability over one replicate is not a weaker number,
 *  it is undefined: there is no pair to compare, so `either` has no second set and
 *  every class would trivially recur 1/1. */
export function assertEnoughRuns(runs) {
  const list = (Array.isArray(runs) ? runs : []).filter((r) => r && typeof r === "object");
  if (list.length < 2) {
    refuse(`reliability needs ≥2 replicate runs and got ${list.length} — agreement between one observation and itself is not a measurement`);
  }
  const ids = list.map((r) => r.run_id);
  if (new Set(ids).size !== ids.length) {
    refuse(`the same run id appears twice (${ids.join(", ")}) — comparing a run with itself would report perfect agreement`);
  }
  return list;
}

// --- the metrics -------------------------------------------------------------

/** One population, and the caller is wrong rather than the data if it spans two:
 *  "what the panel reported" and "what its samples raised" are different questions,
 *  and this file asks both — separately, from two named inputs. */
function assertPopulation(records, expected, where) {
  const seen = [...new Set((Array.isArray(records) ? records : []).map((r) => r?.population))];
  if (seen.length > 1 || (seen.length === 1 && seen[0] !== expected)) {
    refuse(`${where} must all be population ${JSON.stringify(expected)}, got ${seen.map((s) => JSON.stringify(s)).join(", ")}`);
  }
  if (!POPULATIONS.includes(expected)) refuse(`population ${JSON.stringify(expected)} is not one of ${POPULATIONS.join(" | ")}`);
}

/** Our arm only. CodeRabbit has no replicates — it cannot be re-run, which is why
 *  §3.2's other half is n=0 — so a CodeRabbit record in here is a caller error and
 *  not a comparison. */
function assertPanelArm(records, where) {
  const foreign = [...new Set((Array.isArray(records) ? records : []).map((r) => r?.arm).filter((a) => a !== "panel"))];
  if (foreign.length > 0) {
    refuse(`${where} must be panel records, got arm(s) ${foreign.map((a) => JSON.stringify(a)).join(", ")} — the other arm cannot be replayed, so it has no replicates to agree with`);
  }
}

/**
 * Defect classes over a set of runs' records, indexed the way every metric below
 * reads them.
 *
 * `groupFindings` partitions by item on its own (a class spanning two pull requests
 * is not a defect), so this passes every item at once and re-indexes the result.
 * The grouping is done ONCE per set of runs and shared by (a), (b) and (c), so the
 * three metrics can never disagree about what a class is.
 */
function classify(records) {
  const { groups, links, stats } = groupFindings(records);
  const itemOf = new Map(groups.map((g) => [g.id, g.item]));
  const classes = groups.map((g) => ({
    id: g.id,
    item: g.item,
    size: g.size,
    severity: classSeverity(g.members),
    severities: [...new Set(g.members.map((m) => m.finding?.severity))].sort(),
    runs: classRuns(g.members),
    members: g.members,
  }));
  // Which links CROSS runs is read off the matcher's OWN gate decision rather than
  // re-derived from the endpoints: `cross_source` is true for a pair iff `gateFor`
  // found the two findings came from different runs, which is precisely the
  // question — and re-deriving it from the two classes' run sets would answer a
  // subtly different one (a class can hold members from both runs, so its run set
  // does not say which run each side of the pair was from).
  //
  // The two kinds are counted apart because they inflate the union for different
  // reasons: a cross-run `maybe` is a same-defect pair that failed to merge across
  // replicates, and a within-run one is a run splitting its own restatement (§4.5).
  const unmergedOf = (ls) => ({
    // A pair the matcher called plausible and the policy refused to merge. Printed
    // beside every ratio: each one is a candidate same-defect pair counted twice in
    // the union, so it can only push a ratio DOWN.
    maybe_cross_run: ls.filter((l) => l.verdict === "maybe" && l.cross_source).length,
    maybe_within_run: ls.filter((l) => l.verdict === "maybe" && !l.cross_source).length,
    // `match` pairs complete linkage declined, for completeness: they also leave two
    // classes where the matcher itself saw one defect.
    match_held_apart: ls.filter((l) => l.verdict === "match").length,
  });
  const byItem = new Map();
  for (const l of links) {
    const item = itemOf.get(l.groups[0]) ?? itemOf.get(l.groups[1]) ?? null;
    if (!byItem.has(item)) byItem.set(item, []);
    byItem.get(item).push(l);
  }
  return {
    classes,
    itemOf,
    links,
    stats,
    unmerged: unmergedOf(links),
    // Per item, from the SAME grouping — so a per-item maybe count can never
    // disagree with the total, which is what a second `groupFindings` call per item
    // would eventually do.
    unmergedOfItem: (itemId) => unmergedOf(byItem.get(itemId) ?? []),
  };
}

/** Classes of one item, or every class when `itemId` is null. */
const classesOfItem = (classified, itemId) => (itemId === null ? classified.classes : classified.classes.filter((c) => c.item === itemId));

/**
 * (a) Finding-set agreement between two runs, over defect classes.
 *
 * `both / either`, where `either` is every class the two runs' findings produced
 * and `both` is those a member of each run reached. Grouping is done for the PAIR
 * rather than sliced out of a K-way grouping, because complete linkage is not
 * pairwise-stable: a third run's members can block a merge that the two runs alone
 * would have made, which would make a pair's answer depend on how many other
 * replicates were passed in. (b) uses the K-way grouping, and the two counts can
 * differ for exactly that reason — `stats` reports both denominators.
 */
export function jaccardOf(classes, runA, runB) {
  const relevant = classes.filter((c) => c.runs.includes(runA) || c.runs.includes(runB));
  const both = relevant.filter((c) => c.runs.includes(runA) && c.runs.includes(runB)).length;
  return { ...proportion(both, relevant.length), both, either: relevant.length, bound: BOUND };
}

/**
 * (b) Recurrence: in how many of the K runs did each defect class appear?
 *
 * §3.2's worked example is exactly this and calls it the useful part — "the two
 * core findings are rock-solid; the tail is noise" — because it tells a reader what
 * a single run over- and under-reports. `in_all` is the headline share; the whole
 * distribution is reported because that share alone cannot distinguish 2/3 from 1/3.
 */
export function recurrenceOf(classes, kRuns) {
  const counts = Object.fromEntries(Array.from({ length: kRuns }, (_, i) => [i + 1, 0]));
  let disagreement = 0;
  for (const c of classes) {
    const k = Math.min(c.runs.length, kRuns);
    if (k >= 1) counts[k]++;
    if (c.severities.filter((s) => s !== undefined && s !== null).length > 1) disagreement++;
  }
  const n = classes.length;
  return {
    n_classes: n,
    k_runs: kRuns,
    in_k: counts,
    in_all: proportion(counts[kRuns] ?? 0, n),
    in_one: proportion(counts[1] ?? 0, n),
    // How often the K runs graded one defect differently. It is reported here
    // because `classSeverity` files a class under its most severe member, and a
    // reader is entitled to know how often that choice was doing any work.
    severity_disagreement: proportion(disagreement, n),
    bound: BOUND,
  };
}

/**
 * (c) Verifier-verdict agreement, over classes present in BOTH runs.
 *
 * The denominator is the pairs where each side carries a real verdict, and every
 * other case is counted rather than dropped: `not-run` means the verifier never
 * looked (structural on this data — it runs on blocking severity only), and `split`
 * means one run's own members disagree, so neither can be attributed one outcome.
 * Pooling either into "agreement" would report the verifier's silence as its
 * consistency.
 */
export function verifierAgreementOf(classes, runA, runB) {
  const outcomeFor = (c, run) => {
    const mine = c.members.filter((m) => m.run === run);
    if (mine.length === 0) return null;
    const seen = [...new Set(mine.map((m) => (typeof m.finding?.panel?.verification === "string" ? m.finding.panel.verification : "not-run")))];
    if (seen.length > 1) return "split";
    return seen[0];
  };
  const shared = classes.filter((c) => c.runs.includes(runA) && c.runs.includes(runB));
  const pairs = [];
  const excluded = Object.fromEntries(VERIFIER_NON_VERDICTS.map((v) => [v, 0]));
  const outsideVocabulary = [];
  for (const c of shared) {
    const a = outcomeFor(c, runA);
    const b = outcomeFor(c, runB);
    for (const v of [a, b]) {
      if (v !== null && !VERIFIER_VERDICTS.includes(v) && !VERIFIER_NON_VERDICTS.includes(v)) outsideVocabulary.push(v);
    }
    if (VERIFIER_VERDICTS.includes(a) && VERIFIER_VERDICTS.includes(b)) {
      pairs.push([a, b]);
      continue;
    }
    for (const v of [a, b]) if (VERIFIER_NON_VERDICTS.includes(v)) excluded[v]++;
  }
  return {
    classes_in_both: shared.length,
    // Never a bare κ: `cohenKappa` returns the marginals and the caveat with it.
    agreement: cohenKappa(pairs),
    excluded,
    // A verification string the panel emitted that this file has never heard of.
    // Reported rather than silently treated as an outcome, for `assertEffort`'s
    // reason: a vocabulary that grew is a guard that stopped guarding.
    outside_vocabulary: [...new Set(outsideVocabulary)],
  };
}

/**
 * Records in one run sharing a `(file, line)` with another record of the same item
 * — §4.5's restatement confound, measured so a reader can see how much of the
 * disagreement below is a run repeating itself.
 *
 * It matters because a run's class count includes its own restatements, so a run
 * that said one thing twice looks like it disagreed with a run that said it once.
 * `cross_lens` is the interesting half: two lenses raising one location is the
 * measured case (`database.e2e-spec.ts:309`, raised by `correctness` and by
 * `design-fit` in k1), and the same-run gate cannot merge those.
 */
export function duplicateLocationsOf(records) {
  const at = new Map();
  for (const r of Array.isArray(records) ? records : []) {
    if (!(typeof r?.file === "string" && r.file !== "" && Number.isInteger(r?.line))) continue;
    const key = `${r.item_id}${NUL}${r.file}${NUL}${r.line}`;
    if (!at.has(key)) at.set(key, []);
    at.get(key).push(r);
  }
  let locations = 0;
  let records_involved = 0;
  let cross_lens = 0;
  for (const group of at.values()) {
    if (group.length < 2) continue;
    locations++;
    records_involved += group.length;
    if (new Set(group.map((r) => r?.panel?.lens ?? null)).size > 1) cross_lens++;
  }
  return { locations, records_involved, cross_lens, placeable: [...at.values()].reduce((a, g) => a + g.length, 0), n: Array.isArray(records) ? records.length : 0 };
}

/**
 * Which gate the matcher applies to the WITHIN-run pairs — **probed, not inferred.**
 *
 * WHY THIS IS A PROBE, and it is the most instructive line in the file. The first
 * version answered the question from the RECORD SHAPE: a finding record keeps its
 * lens at `panel.lens`, so `matchAnchored`'s same-run test compares two absent
 * values, `trim(undefined) !== trim(undefined)` is false, and the gate degrades to
 * file-only. That was a true statement about `groupFindings` as it stood and a
 * FALSE one about `groupFindings` in general — a change that teaches it to read a
 * record's lens makes the gate lens-aware while every record still looks exactly the
 * same from here. Measured against such a change in review: this function printed
 * `file-only` while the grouper was gating on `panel.lens`, and the number it
 * qualified (a run's own class count) had already moved by 26 classes.
 *
 * That is this project's signature failure in miniature — a field answering the
 * question it was defined for rather than the one its name suggests — so the answer
 * now comes from ASKING THE GROUPER. Two synthetic findings, same item, same run,
 * same file, same summary, differing only in the lensed arm's lens: if they land in
 * one class the gate ignored the lens, and if they stay two it did not. The probe is
 * pure, costs one 2-node grouping, and is right under any version of the matcher —
 * including versions that do not exist yet.
 *
 * Deliberately NOT built with `buildFindingRecord`: the probe has to exercise the
 * GATE, not the schema, and a validator that grew a required field would then break
 * the probe rather than answer it. The record census rides along beside the verdict
 * because "how many records expose a lens, and where" is what a reader needs to
 * interpret it.
 *
 * Cross-run pairs are unaffected by any of this — they are cross-source, and L2
 * never reads a lens — which is why the headline survives a change here and a run's
 * own class count does not.
 */
export function matcherGateOf(records) {
  const rs = Array.isArray(records) ? records : [];
  const probe = (lens) => ({
    arm: "panel",
    item_id: "probe-item",
    run_id: "probe-run",
    file: "packages/probe/src/gate-probe.ts",
    line: 1,
    summary: "the within-run gate probe finding whose summary is identical on both sides so only the lens can separate them",
    evidence: "identical evidence on both sides, so the matcher's token overlap is 1 and nothing but the lens can decide",
    severity: "major",
    panel: { lens },
  });
  const { groups } = groupFindings([probe("correctness"), probe("design-fit")]);
  return {
    // `file-only`: the two probes merged, so the lens did not reach the gate.
    // `lens-and-file`: they did not, so it did.
    within_run_gate: groups.length === 1 ? "file-only" : "lens-and-file",
    probe_classes: groups.length,
    probed: true,
    records_with_top_level_lens: rs.filter((r) => typeof r?.lens === "string" && r.lens !== "").length,
    records_with_namespaced_lens: rs.filter((r) => typeof r?.panel?.lens === "string" && r.panel.lens !== "").length,
    n: rs.length,
  };
}

/** Per-severity slices of one pair's agreement, plus the unstratified figure. The
 *  strata are `KNOWN`'s four, always all four, because "no blocking class in
 *  either run" and "we did not stratify" are different facts. */
function bySeverity(fn, classes) {
  return Object.fromEntries(KNOWN.map((s) => [s, fn(classes.filter((c) => c.severity === s))]));
}

/**
 * Reliability over K replicate runs of one corpus. PURE: records in, numbers out.
 *
 * `runs` is `[{ run_id, records, sampled, items }]`:
 *
 *   records  the `reported` population — `verdict.json`'s findings as records.
 *   sampled  optional. The `sampled` population, for (e)'s detection stage. It has
 *            no lane by construction, so no lane-derived figure is computed on it.
 *   items    `[{ item_id, status, panel, config_hash, panel_sha, corpus_version }]`
 *            — the envelope facts records do not carry: the status the refusal
 *            needs, and the `panel[]` rows (d) reads. Every field comes off one
 *            stored item; none is inferred.
 */
export function reliabilityOf(runs, { corpusItemIds = [], corpusVersion = null } = {}) {
  const list = assertEnoughRuns(runs);
  for (const run of list) {
    assertPanelArm(run.records, `run ${run.run_id}'s records`);
    assertPopulation(run.records, "reported", `run ${run.run_id}'s records`);
    assertPanelArm(run.sampled, `run ${run.run_id}'s sampled records`);
    assertPopulation(run.sampled, "sampled", `run ${run.run_id}'s sampled records`);
  }
  const reviewer = assertOneReviewer(list);
  assertRequestedCorpus(reviewer.corpus_version, corpusVersion);
  assertItemsOk(list);

  const runIds = list.map((r) => r.run_id);
  const kRuns = list.length;
  const recordsOf = (run) => (Array.isArray(run.records) ? run.records : []);
  const sampledOf = (run) => (Array.isArray(run.sampled) ? run.sampled : []);
  const allRecords = list.flatMap(recordsOf);
  const itemIds = [...new Set([...allRecords.map((r) => r.item_id), ...list.flatMap((run) => (Array.isArray(run.items) ? run.items : []).map((it) => it.item_id))])].filter((v) => typeof v === "string" && v !== "").sort();
  // Which runs actually hold each item, so a per-item figure can never quote a K
  // it did not have. An item missing from one replicate is a real state — the
  // pilot's first K=3 attempt lost two items to a session limit — and its
  // agreement is over 2 runs, not 3.
  const runsWithItem = new Map(
    itemIds.map((id) => [id, list.filter((run) => (Array.isArray(run.items) ? run.items : []).some((it) => it.item_id === id) || recordsOf(run).some((r) => r.item_id === id)).map((run) => run.run_id)]),
  );
  const pairs = [];
  for (let i = 0; i < kRuns; i++) for (let j = i + 1; j < kRuns; j++) pairs.push([runIds[i], runIds[j]]);

  // --- (a) and (c): one grouping per pair -----------------------------------
  const perPair = pairs.map(([a, b]) => {
    const A = list.find((r) => r.run_id === a);
    const B = list.find((r) => r.run_id === b);
    const classified = classify([...recordsOf(A), ...recordsOf(B)]);
    const shared = itemIds.filter((id) => runsWithItem.get(id).includes(a) && runsWithItem.get(id).includes(b));
    return {
      runs: [a, b],
      // The pair's own denominator: only items BOTH runs hold can witness
      // agreement between them.
      items_compared: shared,
      overall: jaccardOf(classified.classes.filter((c) => shared.includes(c.item)), a, b),
      by_severity: bySeverity((cs) => jaccardOf(cs, a, b), classified.classes.filter((c) => shared.includes(c.item))),
      per_item: shared.map((id) => ({
        item_id: id,
        ...jaccardOf(classesOfItem(classified, id), a, b),
        findings: { [a]: recordsOf(A).filter((r) => r.item_id === id).length, [b]: recordsOf(B).filter((r) => r.item_id === id).length },
        unmerged: classified.unmergedOfItem(id),
      })),
      verifier: verifierAgreementOf(classified.classes.filter((c) => shared.includes(c.item)), a, b),
      unmerged: classified.unmerged,
      grouping: { classes: classified.classes.length, gate: classified.stats.gate, pairs: classified.stats.pairs, linkage: classified.stats.linkage },
    };
  });

  // --- (b): ONE grouping over all K ----------------------------------------
  const kWay = classify(allRecords);
  const recurrence = {
    k_runs: kRuns,
    overall: recurrenceOf(kWay.classes, kRuns),
    by_severity: bySeverity((cs) => recurrenceOf(cs, kRuns), kWay.classes),
    per_item: itemIds.map((id) => ({
      item_id: id,
      k_runs: runsWithItem.get(id).length,
      ...recurrenceOf(classesOfItem(kWay, id), runsWithItem.get(id).length),
    })),
    unmerged: kWay.unmerged,
    // §4.6: which gate the within-run pairs got, and how many of each kind there
    // were. A cross-source census far larger than the same-run one is the expected
    // shape; the reverse would mean the run ids were not read.
    matcher_gate: matcherGateOf(allRecords),
    gate_census: kWay.stats.gate,
    grouping: { classes: kWay.classes.length, pairs: kWay.stats.pairs, linkage: kWay.stats.linkage, intra_group_non_match: kWay.stats.intra_group_non_match, unattributed: kWay.stats.unattributed, skipped: kWay.stats.skipped.length },
  };

  // --- (d) gate agreement, both routes -------------------------------------
  const gatePerItem = [];
  const laneDisagreements = [];
  const lensCross = { compared: 0, agreed: 0, disagreements: [] };
  const routeCross = { item_runs_compared: 0, agreed: 0 };
  for (const id of itemIds) {
    const verdicts = [];
    for (const run of list) {
      const stored = (Array.isArray(run.items) ? run.items : []).find((it) => it.item_id === id);
      if (!stored) continue;
      const mine = recordsOf(run).filter((r) => r.item_id === id);
      const panelRoute = gateVerdictOf(stored.panel);
      const laneRoute = laneGateOf(mine);
      const comparable = panelRoute.gate !== "unknown" && laneRoute.lane_gate !== "unknown";
      if (comparable) {
        routeCross.item_runs_compared++;
        if (panelRoute.gate === laneRoute.lane_gate) routeCross.agreed++;
      }
      if (comparable && panelRoute.gate !== laneRoute.lane_gate) {
        laneDisagreements.push(
          `${run.run_id}/${id}: panel rows say ${panelRoute.gate} (${panelRoute.gate_basis}${panelRoute.failed_rows.length ? `: ${panelRoute.failed_rows.join(", ")}` : ""}) ` +
            `but ${laneRoute.gating_records} record(s) gate (${laneRoute.lane_basis})`,
        );
      }
      // The finer-grained form of the same cross-check, per LENS: a check run
      // concludes `failure` iff one of that lens's findings reached the blocking
      // lane. It is REPORTED rather than refused on, because a legitimate mismatch
      // is imaginable — a lens whose only blocking finding the verifier discarded
      // is filtered out of `verdict.json` upstream of the record — while the
      // item-level routes above are the gate's own decision and a disagreement
      // there is a defect in one of them.
      for (const row of Array.isArray(stored.panel) ? stored.panel : []) {
        if (!(row && typeof row === "object") || row.blocking !== true || row.applicable === false) continue;
        lensCross.compared++;
        const failed = row.conclusion !== "success";
        const gates = mine.some((r) => r?.panel?.lens === row.id && r?.gating === "gates");
        if (failed === gates) lensCross.agreed++;
        else lensCross.disagreements.push(`${run.run_id}/${id}/${row.id}: conclusion ${JSON.stringify(row.conclusion)} vs ${gates ? "a" : "no"} blocking-lane finding`);
      }
      verdicts.push({ run_id: run.run_id, ...panelRoute, ...laneRoute });
    }
    const known = verdicts.filter((v) => v.gate !== "unknown");
    gatePerItem.push({
      item_id: id,
      n_runs: verdicts.length,
      verdicts,
      // `null`, never `true`: an item whose verdict is unknown in some replicate
      // has not been shown to reproduce, and "we could not tell" must not read as
      // "it agreed".
      agrees: verdicts.length >= 2 && known.length === verdicts.length ? new Set(known.map((v) => v.gate)).size === 1 : null,
      unknown_runs: verdicts.filter((v) => v.gate === "unknown").map((v) => `${v.run_id}:${v.gate_basis}`),
    });
  }
  if (laneDisagreements.length > 0) {
    refuse(
      `the two routes to the gate decision disagree on ${laneDisagreements.length} item-run(s), so one of them is wrong and ` +
        `this scorer will not pick: ${laneDisagreements.join(" · ")}`,
    );
  }
  const decided = gatePerItem.filter((g) => g.agrees !== null);
  const gate = {
    per_item: gatePerItem,
    // The headline of the whole file, and the half that reproduces.
    agreement: proportion(decided.filter((g) => g.agrees).length, decided.length),
    items_undecidable: gatePerItem.filter((g) => g.agrees === null).map((g) => ({ item_id: g.item_id, n_runs: g.n_runs, unknown_runs: g.unknown_runs })),
    // The gate's INPUT beside its output, per run. It is the number that shows the
    // hierarchy: the verdict never flipped on the pilot while this moved 35·34·30.
    lane_census: list.map((run) => {
      const rs = recordsOf(run);
      const lanes = {};
      for (const r of rs) {
        const lane = typeof r?.panel?.lane === "string" ? r.panel.lane : "(none)";
        lanes[lane] = (lanes[lane] ?? 0) + 1;
      }
      return { run_id: run.run_id, findings: rs.length, lanes, gating_records: rs.filter((r) => r?.gating === "gates").length };
    }),
    // Counted while comparing, not asserted afterwards: `agreed` is equal to
    // `item_runs_compared` on any input that reaches here, because a disagreement
    // aborted above — but it is COUNTED so that a future edit which downgrades the
    // abort to a warning still prints a true number rather than a reassuring one.
    route_cross_check: routeCross,
    lens_cross_check: lensCross,
  };

  // --- (e) per-stage --------------------------------------------------------
  // A DETECTION PAIR NEEDS THE POPULATION FROM BOTH SIDES, and the items both sides
  // hold. Neither was checked at first, and each produced the failure this whole file
  // is written against:
  //
  //   - `some(...)` meant that if ONE run carried sampled records, every pair
  //     involving a run that did not was still scored — 0 shared classes over the one
  //     side's N, printed as a Jaccard of 0.000. That reads as two runs agreeing on
  //     nothing when the truth is that one population was never supplied. Absence is
  //     not disagreement, and this is the metric where the distinction is cheapest to
  //     lose: a caller may legitimately pass `sampled` for some runs and not others.
  //   - the reported arm restricts each pair to the items BOTH runs hold
  //     (`items_compared`); the detection pairs did not, so an item present in only
  //     one run inflated the detection union. (e) exists to compare the two stages,
  //     and comparing them across different denominators is the confound it would
  //     have introduced into its own headline.
  const sampledItemsOf = (run) => new Set(sampledOf(run).map((r) => r.item_id));
  const detectionPairs = pairs.map(([a, b]) => {
    const A = list.find((r) => r.run_id === a);
    const B = list.find((r) => r.run_id === b);
    if (sampledOf(A).length === 0 || sampledOf(B).length === 0) {
      const missing = [sampledOf(A).length === 0 ? a : null, sampledOf(B).length === 0 ? b : null].filter(Boolean);
      // `overall: null`, never a ratio: `spread` drops a non-finite value, so an
      // unscorable pair cannot enter the across-pairs figure, and `renderReport`
      // prints why instead of printing a 0.
      return { runs: [a, b], available: false, reason: `no sampled records for ${missing.join(", ")} — absence is not disagreement`, items_compared: [], overall: null, by_severity: null, unmerged: null };
    }
    const shared = itemIds.filter((id) => sampledItemsOf(A).has(id) && sampledItemsOf(B).has(id));
    const mine = [...sampledOf(A), ...sampledOf(B)].filter((r) => shared.includes(r.item_id));
    const classified = classify(mine);
    return {
      runs: [a, b],
      available: true,
      items_compared: shared,
      overall: jaccardOf(classified.classes, a, b),
      by_severity: bySeverity((cs) => jaccardOf(cs, a, b), classified.classes),
      unmerged: classified.unmerged,
    };
  });
  const scorablePairs = detectionPairs.filter((p) => p.available);
  const detection = scorablePairs.length > 0
    ? (() => {
        const kWaySampled = classify(list.flatMap(sampledOf));
        return {
          available: true,
          jaccard: { per_pair: detectionPairs, across_pairs: spread(scorablePairs.map((p) => p.overall.ratio)) },
          pairs_unscorable: detectionPairs.filter((p) => !p.available).map((p) => ({ runs: p.runs, reason: p.reason })),
          recurrence: { overall: recurrenceOf(kWaySampled.classes, kRuns), by_severity: bySeverity((cs) => recurrenceOf(cs, kRuns), kWaySampled.classes) },
          // Stated, not implied: nothing lane-derived is computed on this
          // population, because `buildStageDetail` records samples as the lens
          // emitted them and `annotateFindings` runs later. Every `sampled`
          // blocker reads `gating: "unknown"`, which is the honest answer.
          lane_figures: null,
          lane_note: "the sampled population is structurally pre-annotation: no lane, so no lane-derived figure",
        };
      })()
    : {
        available: false,
        reason: "no pair has the sampled population on both sides — pass it for at least two runs to attribute the detection→reported delta",
        pairs_unscorable: detectionPairs.map((p) => ({ runs: p.runs, reason: p.reason })),
      };
  const stages = {
    detection,
    // The delta itself, per item and per run: how many findings the detection
    // samples raised and how many survived dedupe, clustering, verification and
    // lane routing into what the panel reported.
    attribution: list.map((run) => {
      const rs = recordsOf(run);
      const ss = sampledOf(run);
      const ids = [...new Set([...rs.map((r) => r.item_id), ...ss.map((r) => r.item_id)])].sort();
      return {
        run_id: run.run_id,
        sampled: ss.length,
        reported: rs.length,
        delta: ss.length === 0 ? null : rs.length - ss.length,
        per_item: ids.map((id) => {
          const sampled = ss.filter((r) => r.item_id === id).length;
          const reported = rs.filter((r) => r.item_id === id).length;
          return { item_id: id, sampled, reported, delta: ss.length === 0 ? null : reported - sampled };
        }),
        per_lens: (() => {
          const out = {};
          for (const r of ss) {
            const lens = r?.panel?.lens ?? "(none)";
            out[lens] = out[lens] ?? { sampled: 0, reported: 0 };
            out[lens].sampled++;
          }
          for (const r of rs) {
            const lens = r?.panel?.lens ?? "(none)";
            out[lens] = out[lens] ?? { sampled: 0, reported: 0 };
            out[lens].reported++;
          }
          return out;
        })(),
      };
    }),
  };

  // --- completeness ---------------------------------------------------------
  const corpusIds = [...new Set(corpusItemIds)].sort();
  const reasons = [];
  for (const id of corpusIds) if (!itemIds.includes(id)) reasons.push(`corpus item ${id} is in no run`);
  for (const [id, holders] of runsWithItem) if (holders.length !== kRuns) reasons.push(`${id} is present in ${holders.length} of ${kRuns} run(s) (${holders.join(", ")}), so its agreement is over fewer replicates`);
  for (const g of gate.items_undecidable) reasons.push(`${g.item_id}: gate verdict unknown in ${g.unknown_runs.join(", ")}`);
  if (!detection.available) reasons.push("the detection stage was not scored: no sampled records");
  if (lensCross.disagreements.length > 0) reasons.push(`${lensCross.disagreements.length} lens check(s) disagree with the lane: ${lensCross.disagreements.join(" · ")}`);
  for (const p of perPair) for (const v of p.verifier.outside_vocabulary) reasons.push(`verification ${JSON.stringify(v)} is outside this file's vocabulary`);

  return {
    schema_version: SCHEMA_VERSION,
    bound: BOUND,
    linkage: LINKAGE,
    k_runs: kRuns,
    run_ids: runIds,
    reviewer,
    corpus_version: corpusVersion,
    items: itemIds,
    // §3.2's other half, and the number is measured rather than pending: every
    // corpus item has exactly one finding-bearing CodeRabbit review, so there is no
    // (review n, review n+1) pair with the finding's lines untouched between them.
    // No pair-finder is built — one that can only return 0 is untestable — and the
    // consequence is stated here rather than left to a reader: this output describes
    // our panel and is not a comparison.
    coderabbit_retest_pairs: { n: 0, reason: "every corpus item has exactly one finding-bearing CodeRabbit review, so no retest pair exists; CodeRabbit cannot be re-run", one_armed: true },
    jaccard: {
      population: "reported",
      per_pair: perPair.map((p) => ({ runs: p.runs, items_compared: p.items_compared, overall: p.overall, by_severity: p.by_severity, per_item: p.per_item, unmerged: p.unmerged, grouping: p.grouping })),
      // The three values and their range. Never a mean on its own — see `spread`.
      across_pairs: spread(perPair.map((p) => p.overall.ratio)),
      across_pairs_by_severity: Object.fromEntries(KNOWN.map((s) => [s, { ...spread(perPair.map((p) => p.by_severity[s].ratio)), classes: perPair.map((p) => p.by_severity[s].either) }])),
      unmerged_total: {
        maybe_cross_run: perPair.reduce((a, p) => a + p.unmerged.maybe_cross_run, 0),
        maybe_within_run: perPair.reduce((a, p) => a + p.unmerged.maybe_within_run, 0),
        match_held_apart: perPair.reduce((a, p) => a + p.unmerged.match_held_apart, 0),
      },
      // §4.5's confound, per run: a run's class count carries its own restatements,
      // so a run that said one thing twice looks like it disagreed with a run that
      // said it once.
      within_run_duplicate_locations: list.map((run) => ({ run_id: run.run_id, ...duplicateLocationsOf(recordsOf(run)) })),
    },
    recurrence,
    verifier: {
      per_pair: perPair.map((p) => ({ runs: p.runs, ...p.verifier })),
      // THERE IS DELIBERATELY NO POOLED FIGURE. The K-choose-2 pairs are not
      // independent — every class shared by all three runs would be counted three
      // times — so a pooled κ would carry an n that overstates the evidence by a
      // factor nobody could recover from the number. §3.2 asks for the figure per
      // pair, and per pair is also the only honest denominator.
      no_pooled_figure: "the pairs share classes, so pooling them would triple-count and inflate n; read the per-pair figures",
      population_note: "the verifier runs on blocking severity only — a null verification means it never looked, and is excluded from the denominator rather than counted as agreement",
    },
    gate,
    stages,
    completeness: { verdict: reasons.length === 0 && corpusIds.length > 0 && itemIds.length === corpusIds.length ? "complete" : "partial", reasons, corpus_item_count: corpusIds.length },
    stats: {
      records: { reported: allRecords.length, sampled: list.reduce((a, run) => a + sampledOf(run).length, 0), per_run: list.map((run) => ({ run_id: run.run_id, reported: recordsOf(run).length, sampled: sampledOf(run).length })) },
      pairwise_comparisons: pairs.length * itemIds.length,
      severity_census: Object.fromEntries(KNOWN.map((s) => [s, allRecords.filter((r) => r.severity === s).length])),
      verification_census: (() => {
        const out = { "not-run": 0 };
        for (const r of allRecords) {
          const v = typeof r?.panel?.verification === "string" ? r.panel.verification : "not-run";
          out[v] = (out[v] ?? 0) + 1;
        }
        return out;
      })(),
      // Blocking-severity records with no verification, which is the population
      // whose 7 members are unexplained. Counted, not theorised about.
      blocking_without_verification: allRecords.filter((r) => (r.severity === "critical" || r.severity === "major") && typeof r?.panel?.verification !== "string").length,
    },
  };
}

// --- the report --------------------------------------------------------------

const ratio = (p) => (p?.ratio === null || p?.ratio === undefined ? `n/a (n=${p?.n ?? 0})` : `${p.k}/${p.n}=${p.ratio.toFixed(3)}`);
const num = (v, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : "n/a");
const values = (s) => (s.n === 0 ? "n/a (n=0)" : `${s.values.map((v) => num(v)).join(" · ")} (range ${num(s.range)}, mean ${num(s.mean)}, n=${s.n})`);

/**
 * The result as lines. Pure and exported, so what a reader sees is testable
 * without a store — and so the CLI cannot print a number the library did not
 * compute.
 *
 * The ORDER is the argument. The gate verdict comes first because it is the half
 * that reproduces, then the finding-level agreement that does not, then what each
 * is a lower bound because of. A reader who stops after two lines should still have
 * both halves of the sentence.
 */
export function renderReport(result) {
  const out = [];
  const r = result;
  out.push(
    `reliability · ${r.k_runs} replicate(s) ${r.run_ids.join(", ")} · corpus ${r.corpus_version ?? "(unstated)"} · ` +
      `reviewer ${r.reviewer.panel_sha.slice(0, 9)}/${r.reviewer.config_hash.slice(0, 20)} · ${r.completeness.verdict.toUpperCase()}`,
  );
  out.push(`  ONE ARM ONLY: CodeRabbit retest pairs n=0 — ${r.coderabbit_retest_pairs.reason}. Nothing below is a comparison.`);
  for (const reason of r.completeness.reasons) out.push(`  ! ${reason}`);

  out.push("");
  out.push(`(d) GATE AGREEMENT — the decision the panel ships: ${ratio(r.gate.agreement)} item(s) reach the same verdict in all ${r.k_runs} run(s)`);
  for (const g of r.gate.per_item) {
    out.push(`  ${g.item_id}: ${g.verdicts.map((v) => `${v.gate}${v.gate === "unknown" ? `(${v.gate_basis})` : ""}`).join(" ")} — ${g.agrees === null ? "UNDECIDABLE" : g.agrees ? "agrees" : "FLIPS"} (n=${g.n_runs})`);
  }
  out.push(`  routes agree on ${r.gate.route_cross_check.agreed}/${r.gate.route_cross_check.item_runs_compared} item-run(s) (panel rows vs finding lanes), and ${r.gate.lens_cross_check.agreed}/${r.gate.lens_cross_check.compared} lens check(s) match their lane`);
  for (const d of r.gate.lens_cross_check.disagreements) out.push(`  ! ${d}`);
  for (const c of r.gate.lane_census) {
    out.push(`  ${c.run_id}: ${c.gating_records} gating finding(s) of ${c.findings} · lanes ${Object.entries(c.lanes).map(([l, n]) => `${l}=${n}`).join(" ") || "(none)"}`);
  }

  out.push("");
  out.push(`(a) FINDING-SET AGREEMENT (Jaccard over defect classes, a ${r.bound.toUpperCase()} BOUND): ${values(r.jaccard.across_pairs)}`);
  for (const p of r.jaccard.per_pair) {
    out.push(`  ${p.runs.join(" ↔ ")}: ${ratio(p.overall)} over ${p.items_compared.length} item(s) · ${p.unmerged.maybe_cross_run} cross-run maybe(s) never merged, ${p.unmerged.match_held_apart} match(es) held apart`);
    out.push(`     by severity ${KNOWN.map((s) => `${s} ${ratio(p.by_severity[s])}`).join(" · ")}`);
    for (const it of p.per_item) {
      out.push(`     ${it.item_id}: ${ratio(it)} (${Object.entries(it.findings).map(([run, n]) => `${run}=${n}`).join(", ")} finding(s), ${it.unmerged.maybe_cross_run} cross-run maybe)`);
    }
  }
  out.push(`  a maybe NEVER merges, so each one splits a same-defect pair into two classes and deflates every ratio above: ${r.jaccard.unmerged_total.maybe_cross_run} cross-run, ${r.jaccard.unmerged_total.maybe_within_run} within-run`);
  for (const d of r.jaccard.within_run_duplicate_locations) {
    out.push(`  ${d.run_id}: ${d.locations} location(s) carry >1 finding in ONE run (${d.records_involved} record(s), ${d.cross_lens} cross-lens) — a run's own restatements inflate its class count`);
  }

  out.push("");
  const rec = r.recurrence;
  out.push(`(b) RECURRENCE over ${rec.k_runs} run(s): ${rec.overall.n_classes} defect class(es) · in all ${rec.k_runs} ${ratio(rec.overall.in_all)} · in exactly one ${ratio(rec.overall.in_one)}`);
  out.push(`  distribution ${Object.entries(rec.overall.in_k).map(([k, n]) => `${k}/${rec.k_runs}=${n}`).join(" ")} · severity disagreement within a class ${ratio(rec.overall.severity_disagreement)}`);
  for (const s of KNOWN) {
    const b = rec.by_severity[s];
    out.push(`  ${s}: ${b.n_classes} class(es) · in all ${ratio(b.in_all)} · in exactly one ${ratio(b.in_one)}`);
  }
  for (const it of rec.per_item) out.push(`  ${it.item_id}: ${it.n_classes} class(es) over ${it.k_runs} run(s) · in all ${ratio(it.in_all)} · in one ${ratio(it.in_one)}`);
  out.push(
    `  within-run pairs took the ${rec.matcher_gate.within_run_gate} gate — PROBED against this grouper, not inferred ` +
      `(${rec.matcher_gate.records_with_top_level_lens} of ${rec.matcher_gate.n} records expose a top-level lens; ` +
      `${rec.matcher_gate.records_with_namespaced_lens} carry one at panel.lens) · gate census ${Object.entries(rec.gate_census).map(([g, n]) => `${g}=${n}`).join(" ")}`,
  );
  out.push(`  linkage ${rec.grouping.linkage} · ${rec.grouping.classes} class(es) from ${rec.grouping.pairs.compared} pair(s) (${rec.grouping.pairs.match} match, ${rec.grouping.pairs.maybe} maybe, ${rec.grouping.pairs.no} no) · intra-class non-match ${rec.grouping.intra_group_non_match}`);

  out.push("");
  out.push("(c) VERIFIER-VERDICT AGREEMENT on classes present in both runs:");
  for (const v of r.verifier.per_pair) {
    const a = v.agreement;
    out.push(`  ${v.runs.join(" ↔ ")}: ${v.classes_in_both} class(es) in both · raw agreement ${ratio(a.raw_agreement)}`);
    // κ is NEVER printed without the marginals and the caveat — the whole point of
    // `cohenKappa` returning an object.
    out.push(
      `     κ ${a.kappa === null ? `undefined (${a.kappa_undefined_reason})` : num(a.kappa)} · observed ${num(a.observed)} expected ${num(a.expected)} · ` +
        `marginals ${v.runs[0]} {${Object.entries(a.marginals.a).map(([o, n]) => `${o}=${n}`).join(" ") || "none"}} ${v.runs[1]} {${Object.entries(a.marginals.b).map(([o, n]) => `${o}=${n}`).join(" ") || "none"}}`,
    );
    out.push(`     excluded ${Object.entries(v.excluded).map(([why, n]) => `${why}=${n}`).join(" ")} — ${r.verifier.population_note}`);
    if (v.outside_vocabulary.length > 0) out.push(`     ! verification value(s) outside the vocabulary: ${v.outside_vocabulary.join(", ")}`);
  }
  out.push(`  κ CAVEAT: ${KAPPA_CAVEAT}`);
  out.push(`  verification census over ${r.stats.records.reported} reported record(s): ${Object.entries(r.stats.verification_census).map(([v, n]) => `${v}=${n}`).join(" ")} · ${r.stats.blocking_without_verification} blocking-severity record(s) carry none`);

  out.push("");
  out.push("(e) PER STAGE — detection (pre-verifier samples) → reported:");
  for (const a of r.stages.attribution) {
    out.push(`  ${a.run_id}: sampled ${a.sampled} → reported ${a.reported} (${a.delta === null ? "no sampled population" : a.delta})`);
    out.push(`     per item ${a.per_item.map((it) => `${it.item_id} ${it.sampled}→${it.reported}${it.delta === null ? "" : ` (${it.delta})`}`).join(" · ")}`);
  }
  if (r.stages.detection.available) {
    out.push(`  detection-stage Jaccard: ${values(r.stages.detection.jaccard.across_pairs)}`);
    for (const p of r.stages.detection.jaccard.per_pair) {
      // An unscorable pair prints its REASON, never a ratio — a 0.000 here would be
      // one run's missing population reported as the two runs disagreeing.
      if (!p.available) {
        out.push(`     ${p.runs.join(" ↔ ")}: not scored — ${p.reason}`);
        continue;
      }
      out.push(`     ${p.runs.join(" ↔ ")}: ${ratio(p.overall)} over ${p.items_compared.length} item(s) · by severity ${KNOWN.map((s) => `${s} ${ratio(p.by_severity[s])}`).join(" · ")}`);
    }
    const d = r.stages.detection.recurrence.overall;
    out.push(`  detection-stage recurrence: ${d.n_classes} class(es) · in all ${r.k_runs} ${ratio(d.in_all)} · in one ${ratio(d.in_one)}`);
    out.push(`  ${r.stages.detection.lane_note}`);
  } else {
    out.push(`  ! ${r.stages.detection.reason}`);
  }
  return out;
}

// --- CLI: read a store, print the numbers. Writes nothing. -------------------

const USAGE =
  "usage: reliability.mjs --root <eval-data-root> --corpus-version <v> --run-id <id> --run-id <id> [--run-id <id>]\n" +
  "                      [--item <item-id>]... [--json]\n" +
  "\n" +
  "Agreement between K replicate runs of one corpus: finding-set agreement (Jaccard),\n" +
  "per-class recurrence, verifier-verdict agreement, gate agreement and the\n" +
  "detection→reported delta. Every figure is stratified by severity and carries its n.\n" +
  "\n" +
  "--run-id and --item are REPEATABLE. Reads only: writes nothing, spawns nothing,\n" +
  "costs nothing, and there is no --out.\n" +
  "\n" +
  "It REFUSES to pool runs of two reviewers or two corpora, to score an item whose\n" +
  "envelope status is not ok, and to report agreement over fewer than two runs.";

/** Every occurrence of a repeatable flag, in order.
 *
 *  `parseArgs` keeps the LAST value for a repeated flag, which is exactly wrong
 *  here: the flag that names the K replicates is the one flag whose whole job is to
 *  accumulate, and silently scoring the last one would report reliability over a
 *  single run — which the third refusal exists to make impossible. `--item` is
 *  repeatable for the same reason in reverse: when one replicate lost an item, the
 *  poolable subset is several items, and the operator has to be able to name it. */
export function repeated(argv, flag) {
  const out = [];
  const list = Array.isArray(argv) ? argv : [];
  for (let i = 2; i < list.length; i++) {
    if (list[i] === `--${flag}` && typeof list[i + 1] === "string" && !list[i + 1].startsWith("--")) {
      out.push(list[i + 1]);
      i++;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv, { booleans: ["json", "help"] });
  if (args.help) {
    console.log(USAGE);
    return;
  }
  const runIds = repeated(process.argv, "run-id");
  const items = repeated(process.argv, "item");
  // `--root` is REQUIRED and has no default anywhere in this directory: git history
  // is permanent, so one flag that fell back to a path inside this repository would
  // commit benchmark data into `wafflebase` for good.
  if (!args.root || !args["corpus-version"] || runIds.length === 0) {
    console.error(USAGE);
    process.exit(2);
  }
  const { EvalStore } = await import("./store.mjs");
  const { runRecords } = await import("./adapters/panel.mjs");
  const store = new EvalStore(args.root);
  const corpus = store.getCorpus(args["corpus-version"]);
  if (corpus === null) {
    console.error(`corpus version ${JSON.stringify(args["corpus-version"])} does not exist under this root`);
    process.exit(1);
  }

  const runs = [];
  for (const runId of runIds) {
    const stored = store.getRun(runId);
    if (!stored) {
      console.error(`run ${JSON.stringify(runId)} does not exist under this root`);
      process.exit(1);
    }
    const wanted = items.length > 0 ? items : store.listItems(runId);
    const reported = [];
    const sampled = [];
    const itemFacts = [];
    for (const itemId of wanted) {
      // The envelope is read HERE because the adapter's per-item read does not
      // return it: `status` rides on each RECORD as `panel.item_status`, so an
      // `error` item with zero findings carries it nowhere a scorer can see, and
      // `panel[]` — the gate's own input — is not a record field at all.
      const item = store.getItem(runId, itemId);
      if (!item) {
        console.error(`  ! ${runId}/${itemId}: not replayed under this run`);
        continue;
      }
      itemFacts.push({
        item_id: itemId,
        status: item.envelope?.status,
        reason: item.envelope?.reason ?? null,
        panel: item.payload?.panel ?? null,
        config_hash: item.envelope?.config_hash ?? null,
        panel_sha: item.envelope?.panel_sha ?? null,
        corpus_version: item.envelope?.corpus_version ?? null,
      });
      for (const read of runRecords(store, runId, { population: "reported", itemId })) reported.push(...read.records);
      for (const read of runRecords(store, runId, { population: "sampled", itemId })) sampled.push(...read.records);
    }
    runs.push({ run_id: runId, records: reported, sampled, items: itemFacts, corpus_version: stored.runJson?.corpus_version ?? null });
  }

  const result = reliabilityOf(runs, {
    corpusItemIds: corpus.map((it) => it.id).filter((id) => items.length === 0 || items.includes(id)),
    corpusVersion: args["corpus-version"],
  });
  for (const line of renderReport(result)) console.error(line);
  if (args.json) console.log(JSON.stringify(result, null, 2));
  // A PARTIAL result exits non-zero, so a pipeline cannot quote it as a complete
  // one by ignoring a line of stderr — the same rule `volume-mix.mjs` follows and
  // the runner's capped-run exit code establishes.
  process.exitCode = result.completeness.verdict === "complete" ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error("reliability failed:", e.message);
    process.exit(1);
  });
}
