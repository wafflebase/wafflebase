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
// `intersectSamples`, `isFilingVerdict`) are the same five ideas with the failure
// direction flipped. (The panel's null-verdict behaviour now lives in
// `annotateFindings`/`keepUnrefuted`, which drop a finding only on a concrete
// refutation — so a verdict that never arrived still KEEPS it there.) They are NOT thin wrappers — do not "simplify" them back
// into their panel counterparts.
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

/**
 * One probe: an argv array the trusted runner will execute, never a shell string.
 *
 * This is the anti-slop mechanism and the single most important shape in the
 * pipeline. The hunter does NOT get Bash — it proposes argv and predicts the
 * outcome, and `hunt-probe.mjs` runs it. Three consequences:
 *   - No shell string is ever built from model output, so there is nothing to
 *     inject into.
 *   - The clean room is enforceable, because trusted code owns env/cwd/timeouts.
 *   - Replay is FREE and exact: re-running the same argv IS the replay, so the
 *     "repro doesn't match what the agent actually did" failure class cannot
 *     occur. `repro.sh` is rendered from the argv for humans, never authored.
 */
const PROBE = {
  type: "object",
  properties: {
    argv: { type: "array", items: { type: "string" } },
    note: { type: "string" },
    stdin: { type: "string" },
    files: {
      type: "array",
      items: {
        type: "object",
        properties: { path: { type: "string" }, contentBase64: { type: "string" } },
        required: ["path", "contentBase64"],
      },
    },
  },
  required: ["argv"],
};

const CANDIDATE = {
  type: "object",
  properties: {
    oracle: { type: "string", enum: ["contract", "crash", "round-trip", "state", "formula-diff"] },
    severity: { type: "string", enum: ["critical", "major", "minor", "nit"] },
    title: { type: "string" },
    // `expected` and `observed` are what make a candidate falsifiable: the
    // hunter must commit to a prediction the runner can contradict.
    expected: { type: "string" },
    observed: { type: "string" },
    probes: { type: "array", items: PROBE },
    failingIndex: { type: "integer" },
    citations: { type: "array", items: { type: "string" } },
    docCitation: { type: "string" },
  },
  required: ["oracle", "severity", "title", "expected", "observed", "probes", "failingIndex", "citations"],
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
 * Requires: an object, a non-empty string `title`, a recognized `severity`, a
 * non-empty `probes` array whose every entry has a non-empty argv of strings, and
 * a `failingIndex` in range. Returns `{ kept, dropped }` so the caller can report
 * how much was discarded — a silent drop rate is indistinguishable from a quiet
 * run, and the run log should be able to tell them apart.
 */
export function coerceCandidates(raw) {
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
    if (!Array.isArray(c.probes) || c.probes.length === 0) {
      reject(c, "no probes — cannot be replayed");
      continue;
    }
    const argvOk = c.probes.every(
      (p) =>
        p &&
        typeof p === "object" &&
        Array.isArray(p.argv) &&
        p.argv.length > 0 &&
        p.argv.every((a) => typeof a === "string"),
    );
    if (!argvOk) {
      reject(c, "a probe has a malformed argv");
      continue;
    }
    if (!Number.isInteger(c.failingIndex) || c.failingIndex < 0 || c.failingIndex >= c.probes.length) {
      reject(c, `failingIndex ${JSON.stringify(c.failingIndex)} out of range`);
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
 * INTERSECT independent explorer samples: keep only candidates that ≥2 samples
 * found. The inverse of `unionSamples`, and the cheapest precision lever here.
 *
 * The panel unions because a bug any sample spots is worth blocking on. Hunting
 * inverts that: a candidate only one sample produced is exactly the profile of a
 * one-off confabulation, and dropping it costs nothing. Fewer than 2 successful
 * samples therefore yields NOTHING — with one sample there is no agreement to
 * measure, and "no agreement" must not read as "agreed".
 *
 * Comparison is by fingerprint (the probe + observed shape), not by prose, so two
 * samples describing the same defect in different words still agree.
 */
export function intersectSamples(sampleCandidateLists, fingerprintOf, { minAgreement = 2 } = {}) {
  const lists = (Array.isArray(sampleCandidateLists) ? sampleCandidateLists : []).filter(Array.isArray);
  if (lists.length < minAgreement) return [];
  const counts = new Map();
  const first = new Map();
  for (const list of lists) {
    // Per-sample dedupe first: one sample repeating itself must not be able to
    // reach the agreement threshold on its own.
    const withinSample = new Set();
    for (const c of list) {
      const fp = fingerprintOf(c);
      if (typeof fp !== "string" || fp === "" || withinSample.has(fp)) continue;
      withinSample.add(fp);
      counts.set(fp, (counts.get(fp) ?? 0) + 1);
      if (!first.has(fp)) first.set(fp, c);
    }
  }
  return [...counts.entries()].filter(([, n]) => n >= minAgreement).map(([fp]) => first.get(fp));
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
 */
export function isFilingVerdict(candidate, verdicts, charter) {
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
      HUNT_GROUNDS.has(v.confirmationGround) &&
      v.confirmationGround !== "none" &&
      // A duplicate is a kill, not a note. `== null` is intentional: both null
      // and undefined mean "not a duplicate"; any string names one.
      v.duplicateOf == null,
  );
  if (!allConfirm) return false;

  // --- 4. CHECKED: citations that locate something, in scope ---------------
  const cites = (Array.isArray(claimed.citations) ? claimed.citations : []).filter(
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
 */
export function dropReason(candidate, verdicts, charter) {
  if (isFilingVerdict(candidate, verdicts, charter)) return null;
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
    (v) => !HUNT_GROUNDS.has(v.confirmationGround) || v.confirmationGround === "none",
  );
  if (ungroundedAt !== -1) return `verifier ${ungroundedAt} named no confirmation ground`;
  return "insufficient or out-of-scope citations";
}
