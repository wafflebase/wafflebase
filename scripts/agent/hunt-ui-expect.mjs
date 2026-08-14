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

/**
 * Operators that assert the app CHANGED, rather than that it holds some value.
 *
 * Each of these is vacuously violated when nothing happened: read a value, do nothing,
 * predict it differs — `not-equals` says violated, and so do `not-contains` and both
 * `each-*` comparisons against their own baseline. `equals` and `contains` are safe by
 * construction, because an unchanged value simply satisfies them.
 */
const CHANGE_ASSERTING_OPS = Object.freeze(["not-equals", "not-contains", "each-greater-than", "each-less-than"]);

/**
 * Action types that cannot change what a reader will report.
 *
 * `read` and `wait` observe; everything else in the vocabulary — `goto`, `click`,
 * `type`, `key`, `scroll` — can move the app. `goto` counts because it remounts the
 * surface from its seed, which is a change even though it is a navigation.
 */
const OBSERVING_ACTIONS = Object.freeze(["read", "wait"]);

/** Longest quote `checkGround` will look for in a page snapshot (ground C). */
const MAX_QUOTE_CHARS = 200;
/**
 * Ground B's `source` is model-supplied and goes into `CITATION`, whose
 * `[^\s:]+\.[A-Za-z0-9_]+` prefix backtracks on a long non-matching run. Bounded for
 * the same reason ground C's quote is.
 */
const MAX_SOURCE_CHARS = 300;

function isRef(value) {
  return typeof value === "string" && (READ_REF.test(value) || INPUT_REF.test(value));
}

/**
 * Is this value a stand-in the runner emitted because it could not deliver the real
 * one? `boundValue` substitutes `{__oversized}` / `{__unserializable}` rather than a
 * truncated value, precisely so nothing compares against a corrupted one.
 *
 * NOTHING IMPLEMENTED THIS UNTIL A REVIEW CAUGHT IT. Both this module's header and
 * the runner's `boundValue` docblock asserted the protocol treated these as
 * unevaluable; it did not. `equals` compared the marker as an ordinary object, so an
 * oversized read against a resolved ground-A baseline produced `violated` and an
 * ELIGIBLE candidate — a false finding manufactured by a value the runner had
 * already declared it could not measure. Two markers compared to each other were
 * worse: `equals` said `held`, hiding a real difference.
 *
 * A prose invariant that nothing enforces is not an invariant.
 */
export function isUnusableValue(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    (value.__oversized === true || value.__unserializable === true)
  );
}

/** Beyond this, a serialized reader value is replaced by a marker. */
export const MAX_VALUE_CHARS = 20_000;

/**
 * Bound a reader value WITHOUT corrupting it. The producer half of the marker
 * contract, deliberately in the SAME module as `isUnusableValue`.
 *
 * It began life in the runner, which is how the two halves drifted: the runner's
 * docblock promised the protocol treated markers as unevaluable, the protocol had never
 * heard of them, and no single file was wrong on its own. Producer and predicate now
 * live side by side, so that particular disagreement is not expressible.
 *
 * Why a marker rather than a shortened value: what leaves the runner is COMPARED, not
 * just displayed. `[11,18,32]` cut short is a different array, and comparing against it
 * yields a confident WRONG answer instead of no answer. Stringifying is equally unsafe —
 * `each-greater-than` against `"[11,18,32]"` is unevaluable, so every numeric prediction
 * would quietly stop working. Formatting for a model to read is a separate concern that
 * belongs at the tool boundary, where clipping is harmless.
 */
export function boundValue(value) {
  if (value === undefined) return null;
  let json;
  try {
    json = JSON.stringify(value);
  } catch {
    // A circular structure, or a BigInt. Either way it cannot cross the process
    // boundary, so it must not masquerade as a value that did.
    return { __unserializable: true };
  }
  if (json === undefined) return null;
  if (json.length <= MAX_VALUE_CHARS) return value;
  return { __oversized: true, chars: json.length };
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
export function resolveExpectationRefs(expect, journal, { atIndex = null } = {}) {
  const entries = Array.isArray(journal) ? journal : [];
  const raw = expect?.value;

  if (!isRef(raw)) {
    // A literal is legal for grounds B/C/D. `checkGround` is what refuses it for A.
    return { value: raw, trace: null };
  }

  /**
   * A baseline must come from a step STRICTLY BEFORE the one predicting against it.
   *
   * Without this, an action can reference its own journal entry, and the degenerate
   * case is unconditionally reportable: a `read` action carrying
   * `not-equals @read:<its own index>` compares the same reading to itself, so it
   * violates every single time while passing every grounding check — traceable,
   * same-reader, deterministic on replay. A defect generator with a valid passport.
   *
   * `atIndex` is optional because the ordering can only be checked when the caller
   * knows which step is predicting. When it is absent the check cannot run, which is
   * why the orchestrator (PR 4) must pass it.
   */
  const before = (i) => {
    // Only ABSENT means "cannot check". A present-but-malformed index — "0", 0.5, NaN —
    // used to satisfy `!Number.isInteger(atIndex)` and wave the ordering check through,
    // so a caller with an off-by-one bug in its own bookkeeping silently re-enabled the
    // self-reference generator. Verified: `atIndex: "0"` and `atIndex: 0.5` both made a
    // `not-equals @read:0` self-reference eligible. A safety check must not fail open on
    // input it does not understand.
    if (atIndex === null || atIndex === undefined) return true;
    if (!Number.isInteger(atIndex)) return false;
    return i < atIndex;
  };

  const read = READ_REF.exec(raw);
  if (read) {
    const i = Number(read[1]);
    if (!before(i)) return null;
    const entry = entries[i];
    if (!entry || entry.action?.type !== "read") return null;
    // A read that failed observed nothing, so it cannot be a baseline.
    if (entry.ok !== true) return null;
    // Nor can a value the runner could not deliver.
    if (isUnusableValue(entry.value)) return null;
    return {
      value: entry.value,
      trace: { kind: "read", index: i, reader: entry.action?.reader ?? null },
    };
  }

  const input = INPUT_REF.exec(raw);
  if (input) {
    const i = Number(input[1]);
    if (!before(i)) return null;
    const entry = entries[i];
    if (!entry || entry.action?.type !== "type") return null;
    if (entry.ok !== true) return null;
    if (typeof entry.action.text !== "string") return null;
    return { value: entry.action.text, trace: { kind: "input", index: i, reader: null } };
  }

  return null;
}

// --- evaluation -------------------------------------------------------------

/**
 * Deep equality over JSON-shaped reader values, key-order independent.
 *
 * Two fixes over the naive `JSON.stringify(a ?? null)`. Object key ORDER is not
 * semantic — `doc.styleSummary` is assembled by the editor and two runs need not agree
 * on ordering — so keys are sorted before comparing, or a reordering would read as a
 * violation. And `undefined` is NOT collapsed into `null`: an unset style and a
 * present-but-null value are different observations, and `?? null` merged them.
 */
function stable(value) {
  if (value === undefined) return "\u0000undefined";
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sameValue(a, b) {
  return stable(a) === stable(b);
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

  // BEFORE any operator runs. A marker means the runner could not deliver the value,
  // so there is nothing to compare on that side — and every operator below is total
  // over objects, so without this guard each one would happily return a verdict.
  if (isUnusableValue(actual)) {
    return { verdict: "unevaluable", detail: `read value is unusable: ${JSON.stringify(actual)}` };
  }
  if (isUnusableValue(expectedValue)) {
    return { verdict: "unevaluable", detail: `baseline value is unusable: ${JSON.stringify(expectedValue)}` };
  }

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
      if (typeof actual === "string") {
        // No String(expectedValue). Coercing turned a type error into a comparison —
        // an object became "[object Object]" and then genuinely "was not present",
        // reporting `violated` for what is really a malformed prediction.
        if (typeof expectedValue !== "string") {
          return { verdict: "unevaluable", detail: `${op} against a string needs a string, got ${typeof expectedValue}` };
        }
        has = actual.includes(expectedValue);
      } else if (Array.isArray(actual)) has = actual.some((x) => sameValue(x, expectedValue));
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
      // `[].every(...)` is true, so an empty comparison would report `held` — a pass
      // asserting nothing. Saying so is more useful than a vacuous success, and it
      // catches the case where a selection reader legitimately returned nothing.
      if (got.length === 0) {
        return { verdict: "unevaluable", detail: `${op} over an empty list asserts nothing` };
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
export function checkGround(expect, { journal = [], snapshot = "", charter = {}, atIndex = null } = {}) {
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
    const resolved = resolveExpectationRefs(expect, journal, { atIndex });
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
    /**
     * An assertion that the app CHANGED needs something that could have changed it.
     *
     * The `atIndex` rule stops a prediction citing its own step. It does not stop the
     * same generator spread across two steps, which a live session produced within four
     * actions: read `doc.text`, read `doc.text` again, predict `not-equals @read:<the
     * first>`. Nothing between them but another read, so it violates every time — and it
     * passed every other check here (traceable, same reader, strictly earlier) and was
     * reported as GROUNDED.
     *
     * The window is scanned from the baseline INCLUSIVE, which is what makes `@input:`
     * work: "I typed X, so the text now differs" is grounded by the `type` action at the
     * referenced index itself. For an `@read:` baseline that entry is a read, so it
     * correctly fails to count.
     *
     * Fails CLOSED when the window cannot be established, because a check that cannot
     * run is not a check that passed — the tool always supplies `atIndex`.
     */
    if (CHANGE_ASSERTING_OPS.includes(expect.op)) {
      if (!Number.isInteger(atIndex)) {
        return {
          eligible: false,
          why: `ground A with \`${expect.op}\` asserts a change, which cannot be verified without knowing which step is predicting`,
        };
      }
      const from = resolved.trace.index;
      // INCLUSIVE of the predicting action, which is usually the change itself: "I click
      // Increase font size, and expect the sizes to differ" is grounded by that click.
      // Excluding it refused the canonical good case — caught by the existing test for it.
      const window = (Array.isArray(journal) ? journal : []).slice(from, atIndex + 1);
      const changed = window.some((e) => e?.action?.type && !OBSERVING_ACTIONS.includes(e.action.type));
      if (!changed) {
        return {
          eligible: false,
          why:
            `ground A with \`${expect.op}\` asserts a change, but nothing between ${expect.value} and this step ` +
            `could have caused one — only ${OBSERVING_ACTIONS.join("/")} actions, which observe without acting`,
        };
      }
    }
    return { eligible: true, why: `ground A traced to journal ${resolved.trace.kind} #${resolved.trace.index}` };
  }

  if (ground === "B") {
    // A documented promise. Reuses the gate's own definition of what counts as a
    // citation and what counts as in scope, so "evidence" means one thing across
    // both hunters.
    const source = expect?.source;
    if (typeof source === "string" && source.length > MAX_SOURCE_CHARS) {
      return { eligible: false, why: `ground B source is ${source.length} chars; keep it under ${MAX_SOURCE_CHARS}` };
    }
    // `docs/design/../../etc/x:1` matches a `docs/design/**` glob while pointing
    // elsewhere. Nothing here reads the path from disk, so this is a misleading-citation
    // guard rather than a traversal one — but a citation that does not mean what it
    // says is not evidence.
    if (typeof source === "string" && source.split("/").includes("..")) {
      return { eligible: false, why: `ground B source must not contain ".." (got ${JSON.stringify(source)})` };
    }
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
export function assessExpectation(
  expect,
  actual,
  { journal = [], snapshot = "", charter = {}, actualError = null, atIndex = null } = {},
) {
  const shape = checkExpectationShape(expect);
  if (shape.length > 0) {
    return { verdict: "unevaluable", eligible: false, why: `malformed prediction: ${shape.join("; ")}`, detail: null };
  }

  // A prediction read that THREW measured nothing, so there is nothing to judge.
  //
  // The runner emitted `actualError` for exactly this and nothing consumed it, which
  // left a browser failure looking like a defect: `actual` came back null, `equals`
  // against a resolved baseline said `violated`, and ground A having traced, the
  // candidate was eligible. Infrastructure trouble manufacturing a report is the
  // fail-quiet inversion this module's header forbids.
  //
  // Keyed on `actualError` and NOT on `actual === null`, deliberately: null is a
  // legitimate reading. `sheet.cellValue` of an empty cell is null, and so is
  // `doc.selection` with nothing selected. Treating null as unevaluable would silently
  // blind the hunter to every defect about emptiness.
  if (actualError) {
    return { verdict: "unevaluable", eligible: false, why: `prediction read failed: ${actualError}`, detail: null };
  }

  const resolved = resolveExpectationRefs(expect, journal, { atIndex });
  if (!resolved) {
    return {
      verdict: "unevaluable",
      eligible: false,
      why: `reference ${JSON.stringify(expect.value)} does not resolve to a successful EARLIER journal entry`,
      detail: null,
    };
  }

  const { verdict, detail } = evaluateExpectation(expect, actual, resolved.value);
  if (verdict !== "violated") {
    // Nothing to ground. A prediction that held, or one that could not be judged,
    // is not a candidate no matter how well sourced it was.
    return { verdict, eligible: false, why: verdict === "held" ? "prediction held" : detail, detail };
  }

  const ground = checkGround(expect, { journal, snapshot, charter, atIndex });
  return { verdict, eligible: ground.eligible, why: ground.why, detail, trace: resolved.trace };
}
