// Does a lane's failure summary name the thing that actually failed?
//
// It did not. The fixtures below are lifted from two real CI runs rather than
// invented, because both defects this file guards were invisible in a
// hand-written sample: a suite whose PASSING test names contain "error", and a
// tool that logs a handled error at WARN on its way past it.

import test from "node:test";
import assert from "node:assert/strict";

import { extractFailureSummary } from "../failure-summary.mjs";

/**
 * From `agent:tests` on PR #803, run 31579422745, abbreviated but not edited:
 * a PASSING test whose name contains `api-error`, ~2,600 lines ahead of the
 * real failure. This is the exact input that produced
 * `failureSummary: "# Subtest: classifyResult: … api-error …"`.
 */
const TAP_WITH_INNOCENT_ERROR_IN_A_NAME = [
  "TAP version 13",
  "# Subtest: classifyResult: distinguishes verdict / api-error / no-output at its new home",
  "ok 29 - classifyResult: distinguishes verdict / api-error / no-output at its new home",
  "  ---",
  "  duration_ms: 0.61",
  "  type: 'test'",
  "  ...",
  "# Subtest: REGRESSION: a run-limit failure is NOT a retryable API error",
  "ok 30 - REGRESSION: a run-limit failure is NOT a retryable API error",
  "# Subtest: every upload-artifact step that GLOBS a hidden path opts hidden files back in",
  "not ok 1530 - every upload-artifact step that GLOBS a hidden path opts hidden files back in",
  "  ---",
  "  duration_ms: 5.478649",
  "  type: 'test'",
  "  location: '/home/runner/work/wafflebase/wafflebase/scripts/agent/review-panel.test.mjs:2880:1'",
  "  failureType: 'testCodeFailure'",
  "  error: 'ci.yml \"Upload the CI context\" globs the hidden path .ci-context/ without include-hidden-files: true'",
  "  code: 'ERR_ASSERTION'",
  "  ...",
  "# tests 1611",
  "# fail 1",
].join("\n");

/**
 * From `verify:entropy` on run 31658161586: a NestJS fixture logging a HANDLED
 * error at WARN, ~700 lines before anything failed. This is what the old scan
 * returned for that lane.
 */
const NON_TAP_WITH_A_NOISY_WARNING = [
  "[Nest] 2937  - 08/13/2026, 1:45:41 AM    WARN [YorkieService] detach failed for doc-1: Error: detach failed",
  "[Nest] 2937  - 08/13/2026, 1:45:41 AM    WARN [AnalyticsProducer] view-event produce failed: Error: connect failed",
  " Test Files  148 passed | 4 skipped (152)",
  "verify:entropy: doc staleness FAILED for docs/design/harness-engineering.md",
  " ELIFECYCLE  Command failed with exit code 1.",
].join("\n");

test("TAP: the FAILING test is named, not a passing one whose name contains 'error'", () => {
  const got = extractFailureSummary(TAP_WITH_INNOCENT_ERROR_IN_A_NAME);
  assert.match(got, /^every upload-artifact step that GLOBS a hidden path/);
  assert.doesNotMatch(got, /classifyResult/, "reported a test that passed");
  assert.doesNotMatch(got, /api-error/, "matched on 'error' inside a passing test's name");
});

test("TAP: the error detail is attached to the test it belongs to", () => {
  const got = extractFailureSummary(TAP_WITH_INNOCENT_ERROR_IN_A_NAME);
  assert.match(got, /include-hidden-files/, "dropped the reason the test failed");
  assert.match(got, / — /, "name and detail must be joined, so the summary says what AND why");
});

test("TAP: a failure with no error line still reports the test's name", () => {
  const tap = ["not ok 3 - a test that failed quietly", "  ---", "  type: 'test'", "  ..."].join("\n");
  assert.equal(extractFailureSummary(tap), "a test that failed quietly");
});

test("TAP: a later failure's detail is never attached to an earlier one", () => {
  // The YAML search is bounded by the block terminator. Unbounded, this would
  // report the FIRST failing name with the SECOND failure's reason — a summary
  // that is wrong in the least detectable way, since both halves are real.
  const tap = [
    "not ok 1 - first failure, no detail",
    "  ---",
    "  type: 'test'",
    "  ...",
    "not ok 2 - second failure",
    "  ---",
    "  error: 'the second reason'",
    "  ...",
  ].join("\n");
  const got = extractFailureSummary(tap);
  assert.match(got, /^first failure, no detail/);
  assert.doesNotMatch(got, /the second reason/);
});

test("TAP is preferred even when an earlier line matches the loose pattern", () => {
  // Ordering, not just capability: the loose scan would return the banner.
  const tap = ["FAILED to warm the cache (retrying)", "not ok 7 - the real failure"].join("\n");
  assert.equal(extractFailureSummary(tap), "the real failure");
});

test("non-TAP: a WARN line is never the reason a lane failed", () => {
  const got = extractFailureSummary(NON_TAP_WITH_A_NOISY_WARNING);
  assert.doesNotMatch(got, /detach failed/, "reported a handled error logged at WARN");
  assert.match(got, /doc staleness FAILED/);
});

test("non-TAP: the loose scan is otherwise unchanged", () => {
  // The fallback is deliberately still a heuristic — this pins that fixing the
  // TAP case did not quietly alter what every other lane reports.
  const vitest = ["> vitest run", "some ordinary progress output", "✗ src/thing.test.ts > does a thing"].join("\n");
  assert.equal(extractFailureSummary(vitest), "✗ src/thing.test.ts > does a thing");
});

test("no match at all falls back to the last line, and empty input to null", () => {
  assert.equal(extractFailureSummary("build ok\nall good\ndone in 3s"), "done in 3s");
  assert.equal(extractFailureSummary(""), null);
  assert.equal(extractFailureSummary("   \n  \n"), null);
  assert.equal(extractFailureSummary(undefined), null);
});

test("output is capped at 500 characters, whichever branch produced it", () => {
  const long = "x".repeat(900);
  assert.equal(extractFailureSummary(`not ok 1 - ${long}`).length, 500);
  assert.equal(extractFailureSummary(`ERROR ${long}`).length, 500);
});

test("a TRUNCATED yaml block does not borrow a later failure's reason", () => {
  // Not hypothetical here: the `Unable to deserialize cloned data` failure this
  // lane has been hit by cuts the TAP stream mid-message, so a block with no
  // `...` terminator is a shape this repo actually produces. Unbounded, the
  // search would walk past the truncation and attach the NEXT failure's reason to
  // this name — a summary whose halves are both real and whose pairing is wrong.
  const lines = ["not ok 1 - the truncated one", "  ---", "  type: 'test'"];
  for (let i = 0; i < 20; i += 1) lines.push(`  filler line ${i}`);
  lines.push("  error: 'a reason belonging to something else'");
  const got = extractFailureSummary(lines.join("\n"));
  assert.equal(got, "the truncated one");
  assert.doesNotMatch(got, /belonging to something else/);
});

test("'not ok' inside a test NAME is not mistaken for a failure", () => {
  // The marker is anchored to the start of the line. Unanchored, a passing test
  // that quotes the TAP vocabulary in its own name reports itself as the failure
  // — the same class of bug as matching `api-error` in a name, one level down.
  const tap = [
    "ok 12 - renderSummary: handles the phrase not ok 3 - without tripping",
    "not ok 13 - the genuine failure",
  ].join("\n");
  assert.equal(extractFailureSummary(tap), "the genuine failure");
});

/**
 * Real `node --test` spec output, v24.18.0, captured from the same two-test file
 * used for the end-to-end check. Node picks this reporter over TAP on a TTY, and
 * the choice has moved between majors — so both formats have to work.
 */
const SPEC_WITH_INNOCENT_ERROR_IN_A_NAME = [
  "✔ classifyResult: distinguishes verdict / api-error / no-output (0.326958ms)",
  "✖ the genuinely broken thing (0.421333ms)",
  "ℹ tests 2",
  "ℹ pass 1",
  "ℹ fail 1",
  "",
  "✖ failing tests:",
  "",
  "test at probe.test.mjs:4:1",
  "✖ the genuinely broken thing (0.421333ms)",
  "  AssertionError [ERR_ASSERTION]: the real reason",
  "  ",
  "  1 !== 2",
].join("\n");

test("SPEC reporter: the failing test is named, not the passing one containing 'error'", () => {
  const got = extractFailureSummary(SPEC_WITH_INNOCENT_ERROR_IN_A_NAME);
  assert.match(got, /^the genuinely broken thing/);
  assert.doesNotMatch(got, /classifyResult/, "reported the test that PASSED");
});

test("SPEC reporter: the assertion message is attached", () => {
  assert.match(extractFailureSummary(SPEC_WITH_INNOCENT_ERROR_IN_A_NAME), /AssertionError.*the real reason/);
});

test("SPEC reporter: the '✖ failing tests:' header is not mistaken for a failure", () => {
  // It is a ✖ line with no duration. Without the duration requirement the summary
  // reads "failing tests" — technically a ✖ line, and useless.
  assert.doesNotMatch(extractFailureSummary(SPEC_WITH_INNOCENT_ERROR_IN_A_NAME), /^failing tests/);
});

test("TAP: a multi-line error is read from its block scalar, not reported as '|-'", () => {
  // Verbatim from `node --test-reporter=tap`, v24: an assertion message with more
  // than one line becomes `error: |-` with the text indented underneath. Reading
  // the captured group literally produced the summary `… — |-`, which is what the
  // end-to-end run printed before this branch existed.
  const tap = [
    "not ok 2 - the genuinely broken thing",
    "  ---",
    "  duration_ms: 0.415916",
    "  failureType: 'testCodeFailure'",
    "  error: |-",
    "    the real reason",
    "    ",
    "    1 !== 2",
    "  code: 'ERR_ASSERTION'",
    "  ...",
  ].join("\n");
  const got = extractFailureSummary(tap);
  assert.equal(got, "the genuinely broken thing — the real reason");
  assert.doesNotMatch(got, /\|-/, "reported the YAML block header instead of the message");
});

test("SPEC reporter: the section header alone is never returned as the failure", () => {
  // Asserted directly rather than via the realistic fixture, where the header
  // happens to come AFTER the first failure and so is never reached. Dropping the
  // duration requirement survives that fixture and fails this one — which is the
  // point: the guard is for output whose ordering we do not control.
  const out = ["✖ failing tests:", "", "✖ the real one (1.5ms)"].join("\n");
  assert.equal(extractFailureSummary(out), "the real one");
});
