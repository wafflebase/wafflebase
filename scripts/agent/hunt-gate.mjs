// The issue-hunt GATE — decides whether a candidate defect may be REPORTED.
//
// ============================================================================
// READ THIS FIRST: the polarity here is the INVERSE of review-panel.mjs.
// ============================================================================
// The review panel FAILS CLOSED. Uncertainty keeps a finding, because a false
// positive costs one fix round while a false negative merges a bug. Every helper
// there is built to that asymmetry: `normalizeSeverity` maps unknown → `major`,
// `coerceFindings` turns malformed output into a synthetic blocking finding,
// `unionSamples` takes the UNION across samples, and a null verifier verdict
// KEEPS the finding.
//
// Issue hunting has the opposite cost asymmetry. A false positive costs a
// maintainer's attention and pollutes the tracker — the documented curl outcome,
// where ~20% of submissions were AI slop, none of it ever found a real
// vulnerability, and the bug bounty was discontinued. A false negative costs
// nothing: the bug stays undiscovered, exactly as it is today, and the next run
// looks again. So this gate FAILS QUIET — uncertainty DROPS the candidate.
//
// Concretely, every one of those panel helpers is UNSAFE here and is deliberately
// NOT reused. Each would fail OPEN, i.e. invent a report:
//
//   review-panel helper   its behavior              why it breaks a quiet gate
//   ------------------    ---------------------     --------------------------
//   normalizeSeverity     unknown → "major"         "major" is reportable
//   coerceFindings        malformed → blocking      invents a report from junk
//   dedupeFindings        collision → max severity  a hallucinated critical wins
//   unionSamples          UNION of samples          one lucky sample is enough
//   keepUnrefuted         drops only on a refute     a crashed verifier reports
//
// The replacements below (`huntSeverity`, `coerceCandidates`, `dedupeCandidates`,
// `isFilingVerdict`) are those ideas with the failure direction flipped. There was a
// fifth, `intersectSamples`, inverting `unionSamples` by keeping only what >=2
// samples agreed on. It is gone: once the probe budget stopped starving samples they
// explored deeply enough to diverge, and it discarded 6 of 6 reproducing findings
// over citations one line apart. Precision now rests on replay and the panel.
//
// (The panel's null-verdict behaviour now lives in
// `annotateFindings`/`keepUnrefuted`, which drop a finding only on a concrete
// refutation — so a verdict that never arrived still KEEPS it there.)
//
// The survivors are NOT thin wrappers — do not "simplify" them back into their
// panel counterparts.
//
// What IS safely shared, because it is polarity-neutral: `CITATION` from
// citation.mjs (the repo's own shared home for it), `globToRegExp` from
// review-panel.mjs, and `KNOWN` from severity.mjs — the severity VOCABULARY is
// shared; only the coercion rule differs.

import { CITATION } from "./citation.mjs";
import { globToRegExp } from "./review-panel.mjs";
import { KNOWN } from "./severity.mjs";

// --- structured-output schemas (raw JSON Schema draft-7) ---------------------
// Pure data, so they live in this pure module rather than the orchestrator: it
// keeps them unit-testable, and it lets HUNT_GROUNDS be DERIVED from the verifier
// schema instead of hand-copied (the same drift guard review-panel.mjs applies to
// REFUTATION_GROUNDS).

// A probe is an argv ARRAY the trusted runner executes, never a shell string —
// the anti-slop mechanism and the most important shape in the pipeline. Three
// consequences, all still in force:
//   - No shell string is ever built from model output, so there is nothing to
//     inject into.
//   - The clean room is enforceable, because trusted code owns env/cwd/timeouts.
//   - Replay is exact: re-running the same argv IS the replay, so the "repro
//     doesn't match what the agent actually did" failure class cannot occur.
//     `repro.sh` is rendered from the argv for humans, never authored.
//
// The probe SCHEMA used to live here, because the hunter authored probes and
// predicted their outcome. It now runs them itself through one bounded in-process
// tool (`hunt-tool.mjs`) and cites journal indices instead, so the shape is owned
// by that tool's zod input and this duplicate was deleted rather than left to
// drift. The propose/execute split survives where it earns its keep — reporting —
// and exploration is no longer blind, which is the only way surprise is possible.

const CANDIDATE = {
  type: "object",
  properties: {
    oracle: { type: "string", enum: ["contract", "crash", "round-trip", "state", "formula-diff"] },
    severity: { type: "string", enum: ["critical", "major", "minor", "nit"] },
    title: { type: "string" },
    // `expected` and `observed` are what make a candidate falsifiable: the
    // hunter must commit to a claim the runner can contradict.
    expected: { type: "string" },
    observed: { type: "string" },
    // Evidence is CITED, not authored. These are indices into the session's probe
    // journal — the commands this process actually ran, in order. The hunter can
    // therefore only point at reproductions that genuinely happened; it cannot
    // describe a command it never issued, which is what a model-authored `probes`
    // array allowed. `resolveProbeRefs` (hunt-tool.mjs) converts them back into
    // the `probes`/`failingIndex` shape the gate, replay and report already use,
    // so nothing downstream had to change.
    probeRefs: { type: "array", items: { type: "integer" } },
    failingRef: { type: "integer" },
    citations: { type: "array", items: { type: "string" } },
    docCitation: { type: "string" },
  },
  required: ["oracle", "severity", "title", "expected", "observed", "probeRefs", "failingRef", "citations"],
};

export const EXPLORER_SCHEMA = {
  type: "object",
  properties: {
    candidates: { type: "array", items: CANDIDATE },
    summary: { type: "string" },
  },
  required: ["candidates", "summary"],
};

/**
 * The verifier's answer. Mirrors the panel's VERIFIER_SCHEMA but inverted:
 * `confirmationGround` is the analogue of `refutationGround`, forcing the model
 * to name WHICH enumerated way the candidate is a real defect so the trusted
 * gate can check a shape rather than trust prose.
 *
 * `duplicateOf` is a GATE field, not advisory. A verifier that spots a duplicate
 * must be able to kill the candidate directly; without it, that judgement would
 * have to be laundered through `verdict: "refuted"` and the reason would be lost.
 */
export const HUNT_VERIFIER_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["confirmed", "refuted"] },
    confidence: { type: "string", enum: ["high", "low"] },
    reason: { type: "string" },
    confirmationGround: {
      type: "string",
      enum: [
        "doc-contradicts-code", // contract: both sides located, they disagree
        "unhandled-failure", // crash: stack / 500 / hang, no guarded path
        "relation-violated", // round-trip: a metamorphic identity broke
        "state-inconsistent", // state: a lifecycle op left the wrong state
        "value-diverges", // formula-diff: value differs from the reference
        // Two grounds that only become available once the explorer can EXECUTE.
        // Both are checkable from a transcript, which is what keeps them from
        // degenerating into "this surprised me" — the one ground deliberately
        // absent from this list, because it is the slop generator that ended
        // curl's bug bounty.
        "self-inconsistent", // two paths disagree about the same data
        "schema-annotation-false", // `schema` declares a safety level the command violates
        "none",
      ],
    },
    groundedIn: { type: "array", items: { type: "string" } },
    duplicateOf: { type: ["string", "null"] },
  },
  required: ["verdict", "confidence", "reason", "confirmationGround", "groundedIn", "duplicateOf"],
};

/** Derived from the schema, never hand-copied — a stale duplicate would silently
 * accept a removed ground or reject a legal one. */
export const HUNT_GROUNDS = new Set(HUNT_VERIFIER_SCHEMA.properties.confirmationGround.enum);

// --- the UI hunter's schemas -------------------------------------------------
//
// A second hunter, not a second gate. `isFilingVerdict` below serves both; only the
// three things that genuinely differ between them are parameters. These schemas are
// the data half of that difference and live beside their CLI siblings on purpose —
// the property that the two ground sets must not overlap is only visible if both are
// in one place.

/**
 * A UI candidate. Two deliberate differences from `CANDIDATE`.
 *
 * Evidence is `actionRefs` into the ACTION journal rather than `probeRefs` into the
 * probe journal — same cited-not-authored contract, different vocabulary.
 *
 * And there is **no `citations` field at all.** Localising "the font-size button
 * misbehaved" to a source line means tracing toolbar → `EditorAPI` → the docs style
 * application, which is expensive in turns and exactly where a model invents a
 * plausible wrong line. The VERIFIER supplies the location instead, from source it
 * actually read, via `groundedIn`. Omitting the field rather than ignoring it is the
 * point: a field the schema does not offer cannot be filled in badly.
 */
const UI_CANDIDATE = {
  type: "object",
  properties: {
    oracle: { type: "string", enum: ["prediction", "crash", "dom-invariant"] },
    severity: { type: "string", enum: ["critical", "major", "minor", "nit"] },
    title: { type: "string" },
    expected: { type: "string" },
    observed: { type: "string" },
    actionRefs: { type: "array", items: { type: "integer" } },
    failingRef: { type: "integer" },
  },
  required: ["oracle", "severity", "title", "expected", "observed", "actionRefs", "failingRef"],
};

export const UI_EXPLORER_SCHEMA = {
  type: "object",
  properties: {
    candidates: { type: "array", items: UI_CANDIDATE },
    summary: { type: "string" },
  },
  required: ["candidates", "summary"],
};

/**
 * The UI verifier's answer. Same shape as `HUNT_VERIFIER_SCHEMA`, different grounds.
 *
 * `groundedIn` carries more weight here than it does for the CLI hunter: it is not
 * merely supporting evidence, it is the ONLY source of the `file:line` citations the
 * gate's step 4 checks, because the explorer never supplies any.
 */
export const UI_VERIFIER_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["confirmed", "refuted"] },
    confidence: { type: "string", enum: ["high", "low"] },
    reason: { type: "string" },
    confirmationGround: {
      type: "string",
      enum: [
        "expectation-violated", // a grounded prediction failed, and the failure is the app's fault
        "invariant-violated", // a free oracle fired: duplicate id, dangling ARIA, placeholder text
        "unhandled-failure", // pageerror, unhandled rejection, a console error from app code
        "state-desync", // two readers disagree about the same state
        // "looks-wrong" HAS NO ENTRY HERE, and that is the whole design. The agent has
        // no visual channel, a spatial claim traces to nothing, and the moment a
        // ground exists for "this seems off" the grounding tiers stop meaning
        // anything. See the Phase 31 section in harness-engineering.md.
        "none",
      ],
    },
    groundedIn: { type: "array", items: { type: "string" } },
    duplicateOf: { type: ["string", "null"] },
  },
  required: ["verdict", "confidence", "reason", "confirmationGround", "groundedIn", "duplicateOf"],
};

/** Derived, never hand-copied — same drift guard as `HUNT_GROUNDS`. */
export const UI_GROUNDS = new Set(UI_VERIFIER_SCHEMA.properties.confirmationGround.enum);

/**
 * The grounds both hunters legitimately share — an ALLOWLIST, not an observation.
 *
 * A ground normally carries no meaning outside the hunter it was written for:
 * `doc-contradicts-code` is meaningless in a browser, `expectation-violated` is
 * meaningless for a CLI probe. So an overlap is almost always a mistake, and a test
 * pins the actual overlap to exactly this set — which means adding a ground to one
 * hunter cannot silently widen the other. Widening it is a deliberate edit with a
 * reason written down, and these two have theirs:
 *
 *   none               both schemas' refusal value, and the gate refuses to act on
 *                      it either way. Shared because DECLINING is universal.
 *   unhandled-failure  a crash with no guarded path is the same defect whether the
 *                      stack came out of a CLI process or a `pageerror`. This is the
 *                      one genuinely surface-independent oracle in either hunter.
 */
export const SHARED_GROUNDS = new Set(["none", "unhandled-failure"]);

// --- severity ---------------------------------------------------------------

/**
 * Strict severity read: returns the canonical string, or `null` for anything
 * unrecognized.
 *
 * The VOCABULARY comes from severity.mjs's `KNOWN` so the two gates cannot drift
 * on what the words are. Only the failure direction differs, and it differs on
 * purpose: `normalizeSeverity` maps unknown → `"major"`, which is correct for
 * review (fail toward blocking) and exactly backwards here, where `"major"` is
 * reportable and a garbled severity would manufacture a report. `null` flows to
 * `isFilingVerdict`, which drops it.
 */
export function huntSeverity(raw) {
  return typeof raw === "string" && KNOWN.includes(raw) ? raw : null;
}

// --- candidate hygiene ------------------------------------------------------

/**
 * Keep only structurally usable candidates, DROPPING everything else.
 *
 * The exact inverse of `coerceFindings`, which never drops and turns junk into a
 * synthetic blocking finding. Here junk must vanish: a candidate missing its
 * probes cannot be replayed, and a candidate that cannot be replayed must never
 * be reported. Dropping is safe (the next run looks again); reporting junk is not.
 *
 * Requires: an object, a non-empty string `title`, a recognized `severity`, and
 * whatever `evidenceOf` demands. Returns `{ kept, dropped }` so the caller can report
 * how much was discarded — a silent drop rate is indistinguishable from a quiet
 * run, and the run log should be able to tell them apart.
 *
 * `evidenceOf` exists because the two hunters carry different evidence: a CLI
 * candidate replays an argv sequence, a UI candidate replays an action sequence.
 * Everything else about "structurally usable" is identical, so only that one check
 * is a parameter. It returns a REJECTION REASON or `null` — never a boolean, so the
 * drop table can say what was wrong rather than only that something was.
 */
export function cliProbeEvidence(c) {
  if (!Array.isArray(c.probes) || c.probes.length === 0) return "no probes — cannot be replayed";
  const argvOk = c.probes.every(
    (p) =>
      p &&
      typeof p === "object" &&
      Array.isArray(p.argv) &&
      p.argv.length > 0 &&
      p.argv.every((a) => typeof a === "string"),
  );
  if (!argvOk) return "a probe has a malformed argv";
  if (!Number.isInteger(c.failingIndex) || c.failingIndex < 0 || c.failingIndex >= c.probes.length) {
    return `failingIndex ${JSON.stringify(c.failingIndex)} out of range`;
  }
  return null;
}

export function coerceCandidates(raw, { evidenceOf = cliProbeEvidence } = {}) {
  const kept = [];
  const dropped = [];
  const reject = (c, why) => dropped.push({ candidate: c, why });
  for (const c of Array.isArray(raw) ? raw : []) {
    if (!c || typeof c !== "object") {
      reject(c, "not an object");
      continue;
    }
    if (typeof c.title !== "string" || c.title.trim() === "") {
      reject(c, "missing title");
      continue;
    }
    if (huntSeverity(c.severity) === null) {
      reject(c, `unrecognized severity ${JSON.stringify(c.severity)}`);
      continue;
    }
    // A validator that throws, or that returns something other than a string or
    // null, drops the candidate. Fail quiet: a broken evidence check must not be a
    // way for junk to pass, and this is a gate whose every branch rejects.
    let why;
    try {
      why = evidenceOf(c);
    } catch (err) {
      reject(c, `evidence check failed: ${err?.message ?? err}`);
      continue;
    }
    if (why !== null) {
      reject(c, typeof why === "string" ? why : "evidence check returned no reason");
      continue;
    }
    kept.push(c);
  }
  return { kept, dropped };
}

/**
 * Collapse candidates that share a fingerprint, keeping the FIRST occurrence.
 *
 * Differs from `dedupeFindings` in what it does on collision: the panel keeps the
 * highest severity, so a duplicate can escalate a finding. Here escalation is a
 * fail-open path — one hallucinated `critical` sharing a fingerprint with a real
 * `nit` would report as critical — so severity is never merged. Same fingerprint
 * means same probe and same observed shape, so the entries are the same defect and
 * the first is as good as any.
 */
export function dedupeCandidates(candidates, fingerprintOf) {
  const seen = new Set();
  const out = [];
  for (const c of Array.isArray(candidates) ? candidates : []) {
    const fp = fingerprintOf(c);
    if (typeof fp !== "string" || fp === "" || seen.has(fp)) continue;
    seen.add(fp);
    out.push(c);
  }
  return out;
}

/**
 * The in-scope code locations a candidate blames — its evidence set.
 *
 * `file.ext:line` strings inside `codeScope` only. Doc citations are excluded on
 * purpose: `docCitation` is optional in the schema, and the first live runs showed
 * one sample supplying it and the other omitting it for the SAME defect, so
 * letting it into the identity made the identity unstable.
 */
export function codeLocations(candidate, codeScope) {
  const cites = Array.isArray(candidate?.citations) ? candidate.citations : [];
  const out = new Set();
  for (const c of cites) {
    const loc = citationPath(c) === null ? null : CITATION.exec(String(c))?.[0];
    if (loc && citationInScope(c, codeScope)) out.add(loc);
  }
  return out;
}

/**
 * Do two candidates describe the same defect? True when their in-scope code
 * evidence OVERLAPS on at least one `file:line`.
 *
 * Overlap, not equality — this is the correction the first two live runs forced.
 * Hashing an identity (whether the argv, or the first citation, or the full
 * citation set) failed because two samples describing the same defect cite
 * overlapping but not identical evidence, in arbitrary order. Meanwhile a single
 * shared FILE is too coarse: `formatter.ts` genuinely holds two distinct defects
 * (the exit-code bug at :39/:46 and the envelope bug at :43), and collapsing them
 * would hide one. Line-level overlap separates those two cases exactly.
 *
 * Same shape of judgement `rounds.mjs` already makes for stall detection — an
 * overlap measure gated on file, not a hash comparison.
 */
export function sameDefect(locsA, locsB) {
  for (const l of locsA) if (locsB.has(l)) return true;
  return false;
}


// --- citations --------------------------------------------------------------

/**
 * The file path a citation points at, or `null` if it does not locate anything.
 * Uses the shared `CITATION` pattern so "what counts as evidence" has one
 * definition across both gates.
 */
export function citationPath(citation) {
  if (typeof citation !== "string") return null;
  const m = CITATION.exec(citation);
  if (!m) return null;
  return m[0].slice(0, m[0].lastIndexOf(":"));
}

/**
 * Does a citation locate a file inside one of `globs`?
 *
 * Scope matters because an unscoped citation is not evidence for THIS charter: a
 * `contract` candidate citing something outside `packages/cli` has not shown a
 * CLI contract violation, however real the thing it found may be. Empty/missing
 * globs return false — fail quiet, so a charter that forgot to declare a scope
 * reports nothing rather than everything.
 */
export function citationInScope(citation, globs) {
  const path = citationPath(citation);
  if (path === null) return false;
  if (!Array.isArray(globs) || globs.length === 0) return false;
  return globs.some((g) => typeof g === "string" && globToRegExp(g).test(path));
}

// --- the gate ---------------------------------------------------------------

/**
 * May this candidate be REPORTED? The single decision point, and the only place
 * that answer is computed.
 *
 * Structured as four stages, two owned by trusted code and two checking model
 * output. The model NEVER decides the gate — same architecture as the panel,
 * where subagents classify and the script concludes.
 *
 *   1. TRUSTED  — did the probe actually reproduce, deterministically?
 *   2. TRUSTED  — does the candidate conform to the charter that raised it?
 *   3. CHECKED  — do ALL verifiers confirm, at high confidence, on a named ground?
 *   4. CHECKED  — are there enough in-scope `file.ext:line` citations?
 *
 * Every branch returns false. That is the fail-quiet property: there is exactly
 * one path to `true`, and it requires positive evidence at all four stages.
 *
 * ⚠️ THE ONE LINE MOST LIKELY TO BE MISREAD AS A BUG ⚠️
 * A `null`/missing verdict (the verifier errored or never ran) DROPS the
 * candidate here. review-panel.mjs does the opposite — `keepUnrefuted` discards a
 * finding only on a concrete refutation, so a verdict that never arrived KEEPS it — and a reviewer skimming for symmetry with
 * the panel will read this as inverted logic. It is inverted, deliberately: a
 * crashed verifier has produced no evidence, and no evidence must never become a
 * report. `verdicts.every(...)` over a length-checked array gives exactly that.
 *
 * TWO HUNTERS, ONE GATE. The UI hunter reaches this same function with different
 * grounds and a different source of citations. Those are the only two things that
 * differ, so they are options rather than a second gate — a second gate would mean
 * the mutation tests guarding this one guard nothing over there, and "every branch
 * returns false" is a property that has to be TESTED, not asserted twice.
 *
 * Both options can only NARROW. `grounds` is intersected against nothing — it
 * replaces the permitted set, and a smaller set rejects more. `citationsOf` selects
 * WHICH strings are checked, and every one of them still has to match `CITATION`
 * and fall inside `charter.codeScope`. Neither can skip a stage, and the defaults
 * reproduce the CLI hunter's behaviour exactly, so every existing call site is
 * unaffected.
 */
export function isFilingVerdict(
  candidate,
  verdicts,
  charter,
  { grounds = HUNT_GROUNDS, citationsOf = (claimed) => claimed.citations } = {},
) {
  // --- 1. TRUSTED: replay ---------------------------------------------------
  // Computed by hunt-probe.mjs, never by a model. A candidate that did not
  // reproduce in a clean room is dropped with no appeal, and a non-deterministic
  // observation is dropped too: an intermittent result is indistinguishable from
  // an environment artifact, and this is where phantom repros die.
  if (!candidate || typeof candidate !== "object") return false;
  const replay = candidate.replay;
  if (!replay || typeof replay !== "object") return false;
  if (replay.status !== "reproduced") return false;
  if (replay.deterministic !== true) return false;

  // --- 2. TRUSTED: charter conformance -------------------------------------
  if (!charter || typeof charter !== "object") return false;
  const claimed = candidate.claimed;
  if (!claimed || typeof claimed !== "object") return false;
  if (!Array.isArray(charter.oracles) || !charter.oracles.includes(claimed.oracle)) return false;
  // The fields a human needs for the report to mean anything: what the defect is,
  // and the expected-vs-observed pair that makes it falsifiable. `coerceCandidates`
  // already requires a title, so this is defence in depth — but it is also what
  // makes the monotonicity property hold (removing ANY evidence field can only
  // move toward a drop), and a gate with a hole in that property is one `??`
  // default away from reporting an empty issue.
  for (const field of ["title", "expected", "observed"]) {
    if (typeof claimed[field] !== "string" || claimed[field].trim() === "") return false;
  }
  // huntSeverity, NOT normalizeSeverity — see this file's header. A garbled
  // severity returns null and fails the includes() below rather than becoming
  // a reportable "major".
  const severity = huntSeverity(claimed.severity);
  const reportable = Array.isArray(charter.reportableSeverities) ? charter.reportableSeverities : ["critical", "major"];
  if (severity === null || !reportable.includes(severity)) return false;

  // --- 3. CHECKED: unanimous, grounded confirmation ------------------------
  const need = Math.max(2, Number(charter.verifiers) || 2);
  if (!Array.isArray(verdicts) || verdicts.length < need) return false;
  const allConfirm = verdicts.every(
    (v) =>
      v &&
      typeof v === "object" &&
      v.verdict === "confirmed" &&
      v.confidence === "high" &&
      typeof v.confirmationGround === "string" &&
      // A malformed `grounds` (not a Set, or missing `has`) drops every candidate
      // rather than admitting them: this is the branch a caller is most likely to
      // get wrong, and the failure has to land on the quiet side.
      grounds instanceof Set &&
      grounds.has(v.confirmationGround) &&
      v.confirmationGround !== "none" &&
      // A duplicate is a kill, not a note. `== null` is intentional: both null
      // and undefined mean "not a duplicate"; any string names one.
      v.duplicateOf == null,
  );
  if (!allConfirm) return false;

  // --- 4. CHECKED: citations that locate something, in scope ---------------
  // WHERE the citations come from is the caller's choice; what they have to prove is
  // not. The CLI hunter reads them off the explorer's claim, the UI hunter off the
  // verifiers' `groundedIn` — and either way each one still has to match `CITATION`
  // and land inside `charter.codeScope`. A `citationsOf` that throws or returns a
  // non-array yields zero citations, which fails the `minCitations` check below.
  let sourced;
  try {
    sourced = citationsOf(claimed, verdicts);
  } catch {
    sourced = null;
  }
  const cites = (Array.isArray(sourced) ? sourced : []).filter(
    (s) => typeof s === "string" && CITATION.test(s),
  );
  const minCitations = Number.isInteger(charter.minCitations) ? charter.minCitations : 1;
  if (cites.length < minCitations) return false;
  if (!cites.some((c) => citationInScope(c, charter.codeScope))) return false;

  // A contract violation needs BOTH sides: the documented promise and the code
  // that breaks it. One citation is enough for a crash, which is why this is
  // per-charter rather than a uniform arity that would under-constrain one or
  // over-constrain the other.
  if (charter.requiresDocCitation) {
    const doc = claimed.docCitation;
    if (typeof doc !== "string" || !CITATION.test(doc)) return false;
    if (!citationInScope(doc, charter.docsScope)) return false;
  }

  return true;
}

/**
 * Why was this candidate not reported? For the run log only — NEVER consulted to
 * decide anything.
 *
 * Deliberately re-derives the reason by re-running the same checks in the same
 * order rather than having `isFilingVerdict` return a reason alongside its
 * boolean. A gate that returns a rich object invites a caller to branch on the
 * detail; keeping the decision a bare boolean means there is nothing to branch
 * on. The cost is this function drifting from the gate, which the tests pin by
 * asserting the two always agree.
 *
 * The options MUST be forwarded, not defaulted: a UI drop explained through the
 * CLI's citation source would blame `claimed.citations` — a field UI candidates do
 * not even have — for a candidate the panel actually refuted. Same options in, same
 * decision out.
 */
export function dropReason(candidate, verdicts, charter, options = {}) {
  const { grounds = HUNT_GROUNDS, citationsOf = (claimed) => claimed.citations } = options;
  if (isFilingVerdict(candidate, verdicts, charter, { grounds, citationsOf })) return null;
  if (!candidate || typeof candidate !== "object") return "malformed candidate";
  const replay = candidate.replay;
  if (!replay || typeof replay !== "object") return "not replayed";
  if (replay.status !== "reproduced") return `replay: ${replay.status ?? "unknown"}`;
  if (replay.deterministic !== true) return "replay non-deterministic";
  if (!charter || typeof charter !== "object") return "no charter";
  const claimed = candidate.claimed;
  if (!claimed || typeof claimed !== "object") return "no claimed record";
  if (!Array.isArray(charter.oracles) || !charter.oracles.includes(claimed.oracle)) {
    return `oracle ${JSON.stringify(claimed.oracle)} not in charter`;
  }
  // Mirror isFilingVerdict step 2, in the same order: a missing/blank evidence
  // field drops there, so re-derive it here or the drop is misattributed to the
  // citations check at the bottom.
  for (const field of ["title", "expected", "observed"]) {
    if (typeof claimed[field] !== "string" || claimed[field].trim() === "") {
      return `claimed.${field} is missing or blank`;
    }
  }
  const severity = huntSeverity(claimed.severity);
  if (severity === null) return `unrecognized severity ${JSON.stringify(claimed.severity)}`;
  const reportable = Array.isArray(charter.reportableSeverities) ? charter.reportableSeverities : ["critical", "major"];
  if (!reportable.includes(severity)) return `severity ${severity} below charter threshold`;
  const need = Math.max(2, Number(charter.verifiers) || 2);
  if (!Array.isArray(verdicts) || verdicts.length < need) {
    return `only ${Array.isArray(verdicts) ? verdicts.length : 0} of ${need} verdicts`;
  }
  // findIndex, NOT find: a null/absent verdict is a legitimate case here, and
  // `find` would RETURN that null, making `if (found)` false and sending a
  // nullish verdict on to the next check to be dereferenced. Indexes are never
  // falsy-ambiguous.
  const dupAt = verdicts.findIndex((v) => v && v.duplicateOf != null);
  if (dupAt !== -1) return `duplicate of ${verdicts[dupAt].duplicateOf}`;
  const unusableAt = verdicts.findIndex((v) => !v || typeof v !== "object");
  if (unusableAt !== -1) return `verifier ${unusableAt} produced no verdict (errored)`;
  const refutedAt = verdicts.findIndex((v) => v.verdict !== "confirmed");
  if (refutedAt !== -1) return `verifier ${refutedAt} refuted the candidate`;
  const lowAt = verdicts.findIndex((v) => v.confidence !== "high");
  if (lowAt !== -1) return `verifier ${lowAt} was not confident`;
  const ungroundedAt = verdicts.findIndex(
    (v) => !(grounds instanceof Set) || !grounds.has(v.confirmationGround) || v.confirmationGround === "none",
  );
  if (ungroundedAt !== -1) return `verifier ${ungroundedAt} named no confirmation ground`;
  return "insufficient or out-of-scope citations";
}
