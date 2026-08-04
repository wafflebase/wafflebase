// The PREDICTION PROTOCOL — where a UI mismatch stops being an opinion.
//
// WHY THIS EXISTS. The free oracles from PR 1 only catch defects that announce
// themselves: a crash, a console error, a broken DOM. Most real UI bugs do none of
// that — the app carries on cheerfully doing the wrong thing. Every UI bug this
// repo's design doc cites is of that kind: "increase font size" made text smaller,
// "edit link" inserted one, typing landed in the wrong table. Nothing threw.
//
// Catching those means letting the agent say what it expected. And the moment an
// agent may say "that was wrong", it is both prosecutor and judge — which is the
// documented way to end up with curl's inbox. This module takes the judge's job
// back, and it is the whole of the precision argument for the UI hunter now that
// cross-sample agreement is gone from the pipeline (#662).
//
// FOUR RULES, all mechanical:
//
//   1. A prediction is a NAMED READER plus a COMPARISON, never prose. If the model
//      cannot say what it expects as a value some reader returns, it does not get to
//      expect it. "The document should look right" is unsayable here.
//
//   2. The prediction is submitted WITH the action and the model never sees the
//      result first (enforced in the runner, which performs the read in the same
//      round-trip). It cannot revise an expectation to fit what happened.
//
//   3. Ground A — "the app contradicts itself" — requires the expected value to be
//      a REFERENCE INTO THE JOURNAL, never a literal. A literal is the model
//      asserting a fact from its own belief about how spreadsheets ought to behave,
//      which is exactly what ground A exists to exclude. `@read:4` means "whatever
//      reader I ran at step 4 returned", so the baseline comes from the app's own
//      earlier behaviour.
//
//   4. UNEVALUABLE IS NOT VIOLATED. A comparison that cannot be carried out —
//      `each-greater-than` against a string, a reference that does not resolve — is
//      never a finding. Fail quiet, the same direction as `hunt-gate.mjs`: a model
//      that writes a nonsense comparison must not get a defect out of it.
//
// NO REGEX OPERATOR, deliberately, though the plan listed one. A model-supplied
// pattern is code this process would execute, with catastrophic-backtracking as the
// obvious hazard, and `contains` covers what `matches` was for. Adding it later
// needs a bounded matcher, not `new RegExp`.
//
// ============================================================================
// WHAT THIS DOES NOT CATCH — read before trusting an eligible candidate.
// ============================================================================
// The grounding check removes a CLASS of bad predictions: unsourced ones, invented
// UI quotes, out-of-scope doc citations, references to steps that never happened. It
// does NOT establish that a well-sourced prediction was a REASONABLE one. Two false
// findings turned up within minutes of this module first running, both ground A,
// both traceable to a real earlier read, both reproducing deterministically:
//
//   1. CAPABILITY GAP. "I edited a cell, then undid, so the old value is back" —
//      violated, because `MemStore.undo()` is a no-op ("No-op for memory store (no
//      history tracking)"). The product is fine; the sheet surface mounts a test
//      double without history. Mechanically avoidable, and now avoidable: the bridge
//      exposes `sheet.canUndo`/`doc.canUndo`, and the two disagree. Ask first.
//
//   2. GRANULARITY ASSUMPTION. "I typed XYZ, then undid, so the text is back" —
//      violated, because docs undo is per-keystroke: one undo left "XY". Whether
//      undo SHOULD coalesce a typing burst is a convention judgement (ground D),
//      not a self-contradiction. No mechanical check separates that from a real
//      defect, because the difference is entirely in what a reader ought to expect.
//
// Case 2 is why the verifier panel stays load-bearing and why its rubric attacks
// the EXPECTATION before the behaviour. `refutedAfterReplay` in the funnel is the
// number that says how often this is happening; if it climbs, the protocol is too
// permissive, not the verifiers too strict.
//
// Pure and dependency-free: `node:` and relative imports only, because the
// `agent:tests` lane runs with `scripts/agent/node_modules` absent.

import { CITATION } from "./citation.mjs";
import { citationInScope } from "./hunt-gate.mjs";

/**
 * The complete comparison vocabulary.
 *
 * Small on purpose. Every operator here is total over the values a reader can
 * return, decidable without executing anything the model wrote, and has an obvious
 * negation. `changed-from`/`unchanged` from the sketch are absent: once ground A
 * requires a reference for every operator they add nothing over
 * `not-equals`/`equals`, and a redundant operator is one more thing to get wrong.
 */
export const EXPECT_OPS = Object.freeze([
  "equals",
  "not-equals",
  "contains",
  "not-contains",
  "each-greater-than",
  "each-less-than",
]);

/**
 * Where a prediction's authority comes from. See `checkGround` for what each one
 * has to prove — the letter is a claim, not a credential.
 */
export const EXPECT_GROUNDS = Object.freeze(["A", "B", "C", "D"]);

/** `@read:<i>` — the value reader at journal index i returned. */
const READ_REF = /^@read:(\d+)$/;
/** `@input:<i>` — the text the agent itself typed at journal index i. */
const INPUT_REF = /^@input:(\d+)$/;

/** Longest quote `checkGround` will look for in a page snapshot (ground C). */
const MAX_QUOTE_CHARS = 200;

function isRef(value) {
  return typeof value === "string" && (READ_REF.test(value) || INPUT_REF.test(value));
}

// --- shape ------------------------------------------------------------------

/**
 * Validate a prediction's SHAPE, returning a list of problems (empty = usable).
 *
 * Returns rather than throws: a malformed prediction is not an exception, it is a
 * candidate that will not be eligible, and the caller wants every reason at once so
 * the run log can say what was wrong instead of only the first thing.
 */
export function checkExpectationShape(expect) {
  const problems = [];
  if (!expect || typeof expect !== "object") return ["not an object"];

  if (typeof expect.read !== "string" || expect.read === "") problems.push("`read` must be a non-empty reader name");
  if (expect.args !== undefined && !Array.isArray(expect.args)) problems.push("`args` must be an array when present");
  if (!EXPECT_OPS.includes(expect.op)) {
    problems.push(`\`op\` must be one of ${EXPECT_OPS.join(", ")} (got ${JSON.stringify(expect.op)})`);
  }
  if (!("value" in expect)) problems.push("`value` is required (a literal, or an @read:/@input: reference)");
  if (!EXPECT_GROUNDS.includes(expect.ground)) {
    problems.push(`\`ground\` must be one of ${EXPECT_GROUNDS.join(", ")} (got ${JSON.stringify(expect.ground)})`);
  }
  // Prose that a human reads when triaging. Not machine-checked, and deliberately
  // not load-bearing anywhere — nothing downstream branches on it.
  if (typeof expect.because !== "string" || expect.because.trim() === "") {
    problems.push("`because` must say why, in one line");
  }
  // B and C are claims ABOUT something external, so they have to name it.
  if ((expect.ground === "B" || expect.ground === "C") && (typeof expect.source !== "string" || expect.source === "")) {
    problems.push(`ground ${expect.ground} requires \`source\``);
  }
  return problems;
}

// --- references -------------------------------------------------------------

/**
 * Resolve a prediction's `value` against the session journal.
 *
 * This is the ground-A check, and the reason it can be a check at all rather than a
 * hope. A model may write `ground: "A"` on anything; it cannot make `@read:4`
 * resolve to a reading that never happened. Same property as the CLI hunter's
 * `probeRefs` — evidence is cited, not authored.
 *
 * Returns `{ value, trace }` on success and `null` on any failure. Fails QUIET, so
 * an unresolvable reference costs the candidate rather than raising: dropping is
 * safe, and a reference nobody can follow is exactly what must not become a report.
 */
export function resolveExpectationRefs(expect, journal) {
  const entries = Array.isArray(journal) ? journal : [];
  const raw = expect?.value;

  if (!isRef(raw)) {
    // A literal is legal for grounds B/C/D. `checkGround` is what refuses it for A.
    return { value: raw, trace: null };
  }

  const read = READ_REF.exec(raw);
  if (read) {
    const i = Number(read[1]);
    const entry = entries[i];
    if (!entry || entry.action?.type !== "read") return null;
    // A read that failed observed nothing, so it cannot be a baseline.
    if (entry.ok !== true) return null;
    return {
      value: entry.value,
      trace: { kind: "read", index: i, reader: entry.action?.reader ?? null },
    };
  }

  const input = INPUT_REF.exec(raw);
  if (input) {
    const i = Number(input[1]);
    const entry = entries[i];
    if (!entry || entry.action?.type !== "type") return null;
    if (entry.ok !== true) return null;
    if (typeof entry.action.text !== "string") return null;
    return { value: entry.action.text, trace: { kind: "input", index: i, reader: null } };
  }

  return null;
}

// --- evaluation -------------------------------------------------------------

/** Deep-ish equality over JSON-shaped reader values. */
function sameValue(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function numbersOf(value) {
  const list = Array.isArray(value) ? value : [value];
  // `undefined` is what a reader returns for an unset style, and it is not a
  // number — treating it as one would make "every size increased" trivially true.
  return list.every((n) => typeof n === "number" && Number.isFinite(n)) ? list : null;
}

/**
 * Decide whether a prediction held. THE ONLY PLACE A MISMATCH IS DECIDED.
 *
 * `verdict` is one of:
 *   `held`        the prediction was right — no finding
 *   `violated`    the prediction was wrong — a candidate, if its ground checks out
 *   `unevaluable` the comparison could not be carried out — NOT a finding
 *
 * That third value is the load-bearing one. Collapsing it into `violated` would
 * turn every malformed comparison into a defect report, which is precisely the
 * failure mode this whole module exists to prevent. Collapsing it into `held` would
 * be safe but silent, so it stays distinct and gets counted.
 *
 * `expectedValue` is passed separately from `expect.value` because it has already
 * been through `resolveExpectationRefs` — comparing against the literal string
 * "@read:4" is a bug this signature makes hard to write.
 */
export function evaluateExpectation(expect, actual, expectedValue) {
  const op = expect?.op;
  if (!EXPECT_OPS.includes(op)) return { verdict: "unevaluable", detail: `unknown op ${JSON.stringify(op)}` };

  switch (op) {
    case "equals":
      return sameValue(actual, expectedValue)
        ? { verdict: "held", detail: "equal" }
        : { verdict: "violated", detail: `expected ${JSON.stringify(expectedValue)}, read ${JSON.stringify(actual)}` };

    case "not-equals":
      return sameValue(actual, expectedValue)
        ? { verdict: "violated", detail: `expected a change from ${JSON.stringify(expectedValue)}, read the same value` }
        : { verdict: "held", detail: "differs" };

    case "contains":
    case "not-contains": {
      const wants = op === "contains";
      let has;
      if (typeof actual === "string") has = actual.includes(String(expectedValue));
      else if (Array.isArray(actual)) has = actual.some((x) => sameValue(x, expectedValue));
      else return { verdict: "unevaluable", detail: `${op} needs a string or array, read ${typeof actual}` };
      if (has === wants) return { verdict: "held", detail: wants ? "present" : "absent" };
      return {
        verdict: "violated",
        detail: `expected ${JSON.stringify(expectedValue)} to be ${wants ? "present" : "absent"}`,
      };
    }

    case "each-greater-than":
    case "each-less-than": {
      const got = numbersOf(actual);
      const want = numbersOf(expectedValue);
      if (!got || !want) {
        return { verdict: "unevaluable", detail: `${op} needs finite numbers on both sides` };
      }
      // Pairwise when the lengths match — that is the "every run got bigger" shape.
      // A length change means the comparison is not about the same things any more,
      // which is unevaluable rather than a violation.
      if (got.length !== want.length) {
        return { verdict: "unevaluable", detail: `length changed ${want.length} -> ${got.length}` };
      }
      const ok = got.every((n, i) => (op === "each-greater-than" ? n > want[i] : n < want[i]));
      return ok
        ? { verdict: "held", detail: `every value ${op === "each-greater-than" ? "increased" : "decreased"}` }
        : {
            verdict: "violated",
            detail: `expected every value to ${op === "each-greater-than" ? "increase" : "decrease"}: ${JSON.stringify(want)} -> ${JSON.stringify(got)}`,
          };
    }

    default:
      return { verdict: "unevaluable", detail: `unhandled op ${JSON.stringify(op)}` };
  }
}

// --- grounding --------------------------------------------------------------

/**
 * Is this prediction's claimed authority real?
 *
 * The tier letter is what the model asserts; this is what the process verifies. A
 * violated prediction whose ground does not check out is NOT a candidate — it is
 * journalled and forgotten.
 *
 * Returns `{ eligible, why }`. `why` always says something, including on success,
 * so the run log can show what a candidate was admitted on rather than only what
 * killed one.
 */
export function checkGround(expect, { journal = [], snapshot = "", charter = {} } = {}) {
  const ground = expect?.ground;

  if (ground === "D") {
    // "Ctrl+Z should undo", "Tab should move to the next cell". Often right, and
    // sourced from nothing but the model's prior about other software — so it is
    // where the slop lives. Journalled for a human to skim, never reportable.
    return { eligible: false, why: "ground D (convention) is never eligible — logged for a human, not reported" };
  }

  if (ground === "A") {
    // A literal here is the model asserting a fact it believes, which is the exact
    // thing "self-evident" must not mean. The value has to come from the app's own
    // earlier behaviour.
    if (!isRef(expect?.value)) {
      return {
        eligible: false,
        why: "ground A requires `value` to be an @read:/@input: reference, not a literal — a literal is the model's own belief",
      };
    }
    const resolved = resolveExpectationRefs(expect, journal);
    if (!resolved) {
      return { eligible: false, why: `ground A reference ${JSON.stringify(expect.value)} does not resolve to a successful journal entry` };
    }
    // Comparing one reader's output against another's is a category error that would
    // "violate" on almost any input — `doc.blockCount` was never going to equal
    // `sheet.cellValue`. Cross-reader comparisons are still expressible at B/C/D,
    // where something external backs them.
    if (resolved.trace?.kind === "read" && resolved.trace.reader !== expect.read) {
      return {
        eligible: false,
        why: `ground A compares reader \`${expect.read}\` against \`${resolved.trace.reader}\` at ${expect.value} — different readers are not a self-contradiction`,
      };
    }
    return { eligible: true, why: `ground A traced to journal ${resolved.trace.kind} #${resolved.trace.index}` };
  }

  if (ground === "B") {
    // A documented promise. Reuses the gate's own definition of what counts as a
    // citation and what counts as in scope, so "evidence" means one thing across
    // both hunters.
    const source = expect?.source;
    if (typeof source !== "string" || !CITATION.test(source)) {
      return { eligible: false, why: `ground B \`source\` must locate a line (file.ext:123), got ${JSON.stringify(source)}` };
    }
    if (!citationInScope(source, charter?.docsScope)) {
      return { eligible: false, why: `ground B source ${source} is outside this charter's docsScope` };
    }
    return { eligible: true, why: `ground B cited ${source}` };
  }

  if (ground === "C") {
    // The app's own words. Checkable because the snapshot is what the page actually
    // said at that step — a quote the model invented is not in it.
    const quote = expect?.source;
    if (typeof quote !== "string" || quote.trim() === "") {
      return { eligible: false, why: "ground C `source` must quote the UI text being relied on" };
    }
    if (quote.length > MAX_QUOTE_CHARS) {
      return { eligible: false, why: `ground C quote is ${quote.length} chars; keep it under ${MAX_QUOTE_CHARS}` };
    }
    if (typeof snapshot !== "string" || !snapshot.includes(quote)) {
      return { eligible: false, why: `ground C quote ${JSON.stringify(quote)} does not appear in the page snapshot at that step` };
    }
    return { eligible: true, why: `ground C quoted on-screen text ${JSON.stringify(quote)}` };
  }

  return { eligible: false, why: `unknown ground ${JSON.stringify(ground)}` };
}

/**
 * The whole protocol for one prediction: shape, then reference, then comparison,
 * then ground.
 *
 * Order matters and is the same fail-quiet order the CLI hunter uses. In
 * particular the GROUND is checked last, after a violation is established, so the
 * run log can distinguish "predicted wrongly" from "predicted on a basis we do not
 * accept" — two very different things that a single boolean would merge.
 */
export function assessExpectation(expect, actual, { journal = [], snapshot = "", charter = {} } = {}) {
  const shape = checkExpectationShape(expect);
  if (shape.length > 0) {
    return { verdict: "unevaluable", eligible: false, why: `malformed prediction: ${shape.join("; ")}`, detail: null };
  }

  const resolved = resolveExpectationRefs(expect, journal);
  if (!resolved) {
    return {
      verdict: "unevaluable",
      eligible: false,
      why: `reference ${JSON.stringify(expect.value)} does not resolve to a successful journal entry`,
      detail: null,
    };
  }

  const { verdict, detail } = evaluateExpectation(expect, actual, resolved.value);
  if (verdict !== "violated") {
    // Nothing to ground. A prediction that held, or one that could not be judged,
    // is not a candidate no matter how well sourced it was.
    return { verdict, eligible: false, why: verdict === "held" ? "prediction held" : detail, detail };
  }

  const ground = checkGround(expect, { journal, snapshot, charter });
  return { verdict, eligible: ground.eligible, why: ground.why, detail, trace: resolved.trace };
}
