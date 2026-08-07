// ONE normalised record for a review finding, whichever reviewer produced it.
//
// The benchmark has two arms — this repository's review panel and CodeRabbit —
// and they emit incompatible shapes. The panel writes `verdict.json` findings
// carrying `lane`, `novelty`, `unsettled` and a per-finding verifier outcome;
// CodeRabbit posts markdown comments. NOTHING CAN BE COMPARED until both map
// into one record, and this file is that record: its vocabulary, its builder and
// a strict validator. `adapters/panel.mjs` fills our side; the CodeRabbit
// adapter fills the other.
//
// It computes NO metric. No precision, no agreement, no counts-as-a-result — a
// record is what a scorer reads, not a scorer.
//
// THE ONE THING THIS FILE EXISTS TO GET RIGHT: "did this finding gate?" is not a
// boolean, and writing it as one is how demoted findings get scored as blocking
// ones. Since #668 the answer depends on the `lane` the novelty gate routed on,
// not on severity alone, and a lane can be legitimately ABSENT for more than one
// reason. `blocking: true | false` cannot spell "we could not tell", so the
// moment it is written every unknown becomes one of the two answers — silently,
// and in the direction that inflates the blocking population. See `GATING` and
// `GATING_BASIS` below, which are the whole design.
//
// IDENTITY IS NOT SIMILARITY, and this record deliberately does not blur them.
// `finding_key` is the panel's own exact key (`finding-key.mjs`), because
// anything that must agree with `dedupeFindings`, `compareSampleAgreement` or
// `review-lens-stats.json` has to key findings the way they do. Its known limit
// is real and documented in `eval/README.md`: one defect reworded counts as two.
// The fix for THAT is `finding-match.mjs` (#646), applied by the cross-arm
// matcher — a second, looser mechanism used for a second, different job.
// Swapping similarity in here would make our own numbers quietly stop matching
// the panel's, with nothing anywhere looking wrong.

import { BLOCKING, KNOWN, normalizeSeverity } from "../severity.mjs";
import { findingLocation } from "../novelty.mjs";
import { findingKey } from "../finding-key.mjs";

/**
 * Bumped when a field changes meaning, never when one is added — every reader
 * below is additive, and the store's envelope validator already established that
 * an unknown field survives rather than being rejected or dropped.
 */
export const SCHEMA_VERSION = 1;

/**
 * The reviewers being compared. `coderabbit` is named here, before its adapter
 * exists, because a record whose `arm` vocabulary has one value is not a record
 * for two arms — and the fields the other arm CANNOT fill are what the schema is
 * shaped around (see `ARM_ONLY_FIELDS`).
 */
export const ARMS = Object.freeze(["panel", "coderabbit"]);

/**
 * WHICH SET OF FINDINGS this record came from. Two exist in one run envelope and
 * they answer different questions, so pooling them is a scoring bug rather than
 * a merge:
 *
 *   reported  `verdict.json`'s findings — what the panel REPORTED, after dedupe,
 *             restatement clustering, verification and lane routing. Upstream:
 *             "verdict.json keeps EVERY finding, demoted ones included". This is
 *             the like-for-like comparator against CodeRabbit's posted comments,
 *             and the only population in which a finding HAS a lane.
 *   sampled   every finding every detection sample raised, from
 *             `stageDetail[lens].samples` — BEFORE dedupe, clustering and the
 *             verifier. It answers "what could this panel find across repeated
 *             tries?", which is a coverage question with no CodeRabbit
 *             counterpart at all. Nothing here has a lane, by construction.
 *
 * The record carries which one it is so a scorer cannot silently pool them, and
 * the two are never mixed inside one call.
 */
export const POPULATIONS = Object.freeze(["reported", "sampled"]);

/**
 * Did this finding gate the merge? FOUR values, and every one of them earns its
 * place:
 *
 *   gates           it failed the lens check
 *   does-not-gate   it did not, and we know why
 *   unknown         WE COULD NOT TELL — the gate's decision is not in the data
 *   not-applicable  the arm has no merge gate, so the question does not apply
 *
 * The prompt this was built from asked for three (`gates · demoted · unknown`),
 * and the fourth is a deliberate departure with a concrete failure behind it.
 * `demoted` is one of TWO distinct ways a panel finding does not gate: the
 * novelty gate routed it to `backlog`, or its severity never reached the gate at
 * all (`annotateFindings` stamps a lane only on `critical`/`major`, so for a
 * minor or a nit the absence of a lane is the design and not missing data).
 * Filing a nit under `demoted` would make "how many findings did the gate demote?"
 * disagree with `laneCounts`' `backlog` tally, which is the same word for a
 * different number — this project's signature failure. So the middle value says
 * only what is certain, and `GATING_BASIS` says which cause it was.
 *
 * `not-applicable` is separated from `unknown` for the same reason one level up.
 * CodeRabbit does not gate anything, ever; that is not uncertainty, and pooling
 * it with our genuinely-unrecorded cases would make "how much of our data has an
 * unrecorded gate decision?" scale with the size of the other arm.
 */
export const GATING = Object.freeze(["gates", "does-not-gate", "unknown", "not-applicable"]);

/**
 * WHY the `gating` value is what it is — cause → answer, and the mapping is the
 * source of truth so the two can never be stated independently and disagree
 * (`validateFindingRecord` refuses a record whose pair does not match).
 *
 * The causes are kept apart because ABSENT HAS MORE THAN ONE CAUSE and pooling
 * them is a scoring bug. `buildStageDetail`'s own docstring is the standing
 * instruction: "A reader must treat a MISSING lane as 'unknown', never as
 * 'blocking' … reading absence as blocking would silently score demoted findings
 * as gating ones."
 *
 * NOTE the one lane predicate this deliberately does NOT reuse: the panel's
 * private `findingGates` reads a missing lane as GATING. That is right for a
 * gate — it fails toward blocking, because it is deciding whether to stop a
 * merge — and wrong for a scorer, which must not turn "not recorded" into a
 * verdict. Two jobs, two rules, and this is the scorer's one.
 */
export const GATING_BASIS = Object.freeze({
  /** `lane: "blocking"` — the gate looked at it and kept it on the gate. */
  "lane-blocking": "gates",
  /** `lane: "backlog"` — real, but the novelty gate placed the code before the base. */
  "lane-backlog": "does-not-gate",
  /** `lane: "discarded"` — the verifier concretely refuted it. Filtered out of
   *  `verdict.json` upstream of the record, so it is rare rather than impossible. */
  "lane-discarded": "does-not-gate",
  /** minor/nit: `classify` reads severity, so it cannot gate whatever its lane
   *  says. Checked FIRST, because the real gate is the conjunction of both. */
  "non-blocking-severity": "does-not-gate",
  /** Blocking severity and no lane at all: a capture written before #668, or a
   *  population that is annotated later (every `sampled` blocker lands here). */
  "lane-absent": "unknown",
  /** A lane outside `LANES`. Not read as anything — an unrecognised routing
   *  decision is exactly the case where guessing costs the most. */
  "lane-unrecognized": "unknown",
  /** The arm has no merge gate. */
  "no-gate-in-arm": "not-applicable",
});

/**
 * The fields only our arm can fill, named once so PR 8 inherits the list rather
 * than rediscovering it against a half-built CodeRabbit adapter. Everything here
 * lives inside the record's arm namespace (`record.panel`), never at the top
 * level, which is what keeps the top level meaningful for a reviewer that has no
 * lenses, no samples and no verifier.
 */
export const ARM_ONLY_FIELDS = Object.freeze({
  panel: Object.freeze(["lens", "lane", "novelty", "unsettled", "verification", "samples", "gate_state", "config_hash", "panel_sha", "item_status", "item_reason"]),
  coderabbit: Object.freeze([]),
});

const refuse = (msg) => {
  throw new Error(`finding record: ${msg}`);
};

/**
 * Did this finding gate, and on what grounds? Pure, exported, and the one place
 * the question is answered.
 *
 * SEVERITY IS TESTED BEFORE THE LANE, and that ordering is the panel's, not a
 * shortcut: a lens check fails on `classify(gatingFindings(merged))`, so a
 * finding gates iff its severity is blocking AND its lane is not `backlog`.
 * Severity is normalised exactly as `classify` normalises it, unknown → `major`
 * — so a garbled severity is read as blocking here too, and `severity_raw` on
 * the record is what makes that coercion visible afterwards.
 */
export function gatingOf(finding, { arm = "panel" } = {}) {
  const basis = (b) => ({ gating: GATING_BASIS[b], gating_basis: b });
  if (arm !== "panel") return basis("no-gate-in-arm");
  const f = finding && typeof finding === "object" ? finding : {};
  if (!BLOCKING.has(normalizeSeverity(f.severity))) return basis("non-blocking-severity");
  if (typeof f.lane !== "string") return basis("lane-absent");
  if (f.lane === "blocking") return basis("lane-blocking");
  if (f.lane === "backlog") return basis("lane-backlog");
  if (f.lane === "discarded") return basis("lane-discarded");
  return basis("lane-unrecognized");
}

/**
 * One finding → one record.
 *
 * WIDENS, NEVER NARROWS. The whole finding is carried verbatim at
 * `record[arm].raw` and the named fields are derived beside it — never rebuilt
 * from a field list. That is the convention this PR is the third site of:
 * upstream fixed the same bug once in `normalizeFindings`, which "used to
 * rebuild each finding as exactly `{severity,file,summary,evidence}`, which
 * silently dropped everything the orchestrator annotates onto a finding after
 * the lens produced it", and three copies of that mistake outlived the fix. A
 * field a future round annotates survives into `raw` whether or not this file
 * has heard of it.
 *
 * `detail` is the arm's own sub-object. It is spread BEFORE `raw` so a caller
 * cannot shadow the verbatim copy with a field of its own.
 *
 * Refuses rather than degrades: this is the handoff point, and the read path
 * that degrades is the adapter, which drops what it cannot use and says so.
 */
export function buildFindingRecord({ arm = "panel", itemId, runId = null, population, finding, detail = {} } = {}) {
  if (!ARMS.includes(arm)) refuse(`arm must be one of ${ARMS.join(" | ")}, got ${JSON.stringify(arm)}`);
  if (typeof itemId !== "string" || itemId.trim() === "") {
    refuse(`itemId must be a non-empty string, got ${JSON.stringify(itemId)} — a finding nobody can attribute to a pull request cannot be scored against one`);
  }
  if (!POPULATIONS.includes(population)) {
    refuse(`population must be one of ${POPULATIONS.join(" | ")}, got ${JSON.stringify(population)} — a record that does not say which set it came from is one a scorer can pool with the other`);
  }
  if (!(finding && typeof finding === "object" && !Array.isArray(finding))) {
    refuse(`finding must be an object, got ${JSON.stringify(finding)}`);
  }
  // Verbatim, so `finding_key` stays DERIVABLE from the record's own fields:
  // `${file ?? ""}::${summary.toLowerCase().trim()}`. Trimming or defaulting
  // either of them here would break that identity, and a reader recomputing the
  // key from the record would silently get a different one.
  const file = typeof finding.file === "string" ? finding.file : null;
  const summary = typeof finding.summary === "string" ? finding.summary : null;
  // `line` is NOT part of the key — the panel's key has never had one — and it
  // comes from upstream's own reader, which falls back to the first same-file
  // `file:line` citation in the evidence. So it can be known when `file` alone
  // was given, and it is recorded rather than re-derived by each scorer.
  const line = findingLocation(finding)?.line ?? null;
  const { gating, gating_basis } = gatingOf(finding, { arm });
  return {
    schema_version: SCHEMA_VERSION,
    arm,
    item_id: itemId,
    // The observation this was read out of, so K replicates stay distinguishable.
    // `null` for an arm with no such notion — which is a fact about that arm, not
    // a missing value.
    run_id: typeof runId === "string" && runId.trim() !== "" ? runId : null,
    population,
    finding_key: findingKey(finding),
    file,
    line,
    summary,
    evidence: typeof finding.evidence === "string" ? finding.evidence : null,
    severity: normalizeSeverity(finding.severity),
    // What the reviewer ACTUALLY said, before `normalizeSeverity`'s unknown →
    // `major` fail-safe. Without it the coercion is unrecoverable, and
    // CodeRabbit's `trivial` — 268 findings of it — would be indistinguishable
    // from a real `major` once the adapter has translated it.
    severity_raw: typeof finding.severity === "string" ? finding.severity : null,
    gating,
    gating_basis,
    [arm]: { ...detail, raw: finding },
  };
}

/**
 * Everything that must be true of a record before anything may read it.
 *
 * Strict, and it throws — unlike the store's envelope validator this guards a
 * derivation rather than a write, and a malformed record reaching a scorer costs
 * a wrong number rather than a corrupt file. The check worth the most is the
 * LAST one: `gating` and `gating_basis` are refused when they disagree, so a
 * future adapter cannot hand-write "gates" beside a basis that means it did not.
 */
export function validateFindingRecord(record) {
  const r = record;
  if (r === null || typeof r !== "object" || Array.isArray(r)) {
    refuse(`a record must be a JSON object, got ${JSON.stringify(r)}`);
  }
  if (r.schema_version !== SCHEMA_VERSION) {
    refuse(`schema_version must be ${SCHEMA_VERSION}, got ${JSON.stringify(r.schema_version)}`);
  }
  if (!ARMS.includes(r.arm)) refuse(`arm must be one of ${ARMS.join(" | ")}, got ${JSON.stringify(r.arm)}`);
  if (typeof r.item_id !== "string" || r.item_id.trim() === "") {
    refuse(`item_id must be a non-empty string, got ${JSON.stringify(r.item_id)}`);
  }
  if (!(r.run_id === null || (typeof r.run_id === "string" && r.run_id.trim() !== ""))) {
    refuse(`run_id must be a non-empty string or null, got ${JSON.stringify(r.run_id)} — "" would read as a run whose id nobody wrote down`);
  }
  if (!POPULATIONS.includes(r.population)) {
    refuse(`population must be one of ${POPULATIONS.join(" | ")}, got ${JSON.stringify(r.population)}`);
  }
  if (typeof r.finding_key !== "string" || r.finding_key === "") {
    refuse(`finding_key must be a non-empty string, got ${JSON.stringify(r.finding_key)}`);
  }
  for (const field of ["file", "summary", "evidence"]) {
    if (!(r[field] === null || typeof r[field] === "string")) {
      refuse(`${field} must be a string or null, got ${JSON.stringify(r[field])}`);
    }
  }
  if (!(r.line === null || (Number.isInteger(r.line) && r.line >= 1))) {
    refuse(`line must be a positive integer or null, got ${JSON.stringify(r.line)}`);
  }
  if (!KNOWN.includes(r.severity)) {
    refuse(`severity must be one of ${KNOWN.join(" | ")}, got ${JSON.stringify(r.severity)} — a foreign vocabulary is translated at the arm boundary, never carried into the record`);
  }
  if (!(r.severity_raw === null || typeof r.severity_raw === "string")) {
    refuse(`severity_raw must be a string or null, got ${JSON.stringify(r.severity_raw)}`);
  }
  if (!GATING.includes(r.gating)) refuse(`gating must be one of ${GATING.join(" | ")}, got ${JSON.stringify(r.gating)}`);
  if (!Object.hasOwn(GATING_BASIS, r.gating_basis ?? "")) {
    refuse(`gating_basis must be one of ${Object.keys(GATING_BASIS).join(" | ")}, got ${JSON.stringify(r.gating_basis)}`);
  }
  if (GATING_BASIS[r.gating_basis] !== r.gating) {
    refuse(
      `gating ${JSON.stringify(r.gating)} contradicts gating_basis ${JSON.stringify(r.gating_basis)}, which means ` +
        `${JSON.stringify(GATING_BASIS[r.gating_basis])} — the two are one fact stated twice and must never be written independently`,
    );
  }
  // The arm namespace is keyed BY the arm, so "which fields could the other arm
  // not fill?" is answerable by reading the record rather than by reading this
  // file. A foreign namespace is refused rather than ignored: a record carrying
  // both would be two claims about who found the defect.
  if (!(r[r.arm] && typeof r[r.arm] === "object" && !Array.isArray(r[r.arm]))) {
    refuse(`a ${r.arm} record must carry a ${r.arm} sub-object, got ${JSON.stringify(r[r.arm])}`);
  }
  for (const other of ARMS.filter((a) => a !== r.arm)) {
    if (Object.hasOwn(r, other)) refuse(`a ${r.arm} record must not carry a ${other} namespace — one finding has one author`);
  }
  if (!Object.hasOwn(r[r.arm], "raw")) {
    refuse(`${r.arm}.raw is missing — the record carries the whole finding verbatim beside the derived fields, so nothing a future round annotates is lost`);
  }
  return r;
}

/**
 * How many records fell into each `gating` value, plus the basis breakdown.
 *
 * Not a metric — a census, and the thing a CLI prints so that "how much of this
 * data has an unrecorded gate decision?" is a question anyone can ask without
 * writing code. It carries its own `n`, per the house rule that no proportion is
 * ever reported without its denominator.
 */
export function gatingCensus(records) {
  const out = { n: 0, gating: Object.fromEntries(GATING.map((g) => [g, 0])), basis: {} };
  for (const r of Array.isArray(records) ? records : []) {
    if (!r || typeof r !== "object") continue;
    out.n++;
    if (Object.hasOwn(out.gating, r.gating)) out.gating[r.gating]++;
    out.basis[r.gating_basis] = (out.basis[r.gating_basis] ?? 0) + 1;
  }
  return out;
}
