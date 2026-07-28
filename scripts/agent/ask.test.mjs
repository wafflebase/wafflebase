import { test } from "node:test";
import assert from "node:assert/strict";
import { assertAllowedTools, FORBIDDEN_TOOLS, classifyResult, withRetry } from "./ask.mjs";
import { CITATION } from "./review-panel.mjs";

// The point of ask.mjs is that the read-only tool grant is now a CHECKED
// invariant rather than a hardcoded array one caller happened to get right.
// These tests are that check. Note none of them install or touch the SDK —
// `assertAllowedTools` runs before the lazy `import()`, which is why the
// validation lives in its own function instead of inline in askStructured.

test("assertAllowedTools: accepts the read-only triple and returns a frozen copy", () => {
  const tools = assertAllowedTools(["Read", "Grep", "Glob"]);
  assert.deepEqual([...tools], ["Read", "Grep", "Glob"]);
  assert.ok(Object.isFrozen(tools), "returned array must be frozen so it cannot be widened after validation");
  // A frozen copy, not the caller's array — mutating the input afterwards must
  // not retroactively change what was validated.
  const input = ["Read"];
  const validated = assertAllowedTools(input);
  input.push("Bash");
  assert.deepEqual([...validated], ["Read"]);
});

test("assertAllowedTools: every forbidden tool is refused, whoever asks", () => {
  // Iterate the exported list rather than a hand-written copy: a tool added to
  // FORBIDDEN_TOOLS without a test would otherwise be silently uncovered.
  for (const tool of FORBIDDEN_TOOLS) {
    assert.throws(
      () => assertAllowedTools(["Read", tool]),
      new RegExp(`tool "${tool}" is never permitted`),
      `${tool} must be refused even alongside legitimate read-only tools`,
    );
  }
});

test("assertAllowedTools: Bash is refused even as the sole entry", () => {
  // The obvious way a future caller widens this: "my agent only needs Bash".
  assert.throws(() => assertAllowedTools(["Bash"]), /never permitted/);
});

test("assertAllowedTools: missing / empty / malformed input fails closed", () => {
  // Required, not defaulted — a default would let a new caller inherit read-only
  // access silently and then widen it at the call site with no visible signal.
  assert.throws(() => assertAllowedTools(undefined), /required and must be a non-empty array/);
  assert.throws(() => assertAllowedTools(null), /required and must be a non-empty array/);
  assert.throws(() => assertAllowedTools("Read"), /required and must be a non-empty array/);
  // Empty array is rejected rather than treated as "no tools": the SDK would run
  // an agent that cannot read anything, burning quota to return nothing useful.
  assert.throws(() => assertAllowedTools([]), /required and must be a non-empty array/);
  assert.throws(() => assertAllowedTools(["Read", ""]), /must be non-empty strings/);
  assert.throws(() => assertAllowedTools(["Read", "   "]), /must be non-empty strings/);
  assert.throws(() => assertAllowedTools(["Read", 42]), /must be non-empty strings/);
  assert.throws(() => assertAllowedTools(["Read", null]), /must be non-empty strings/);
});

test("FORBIDDEN_TOOLS: covers execution, mutation, network and re-spawn, and is frozen", () => {
  // Named explicitly because each entry closes a distinct escape route; a
  // reviewer should be able to see the four categories are all covered.
  for (const t of ["Bash", "Write", "Edit", "NotebookEdit", "WebFetch", "WebSearch", "Task"]) {
    assert.ok(FORBIDDEN_TOOLS.includes(t), `FORBIDDEN_TOOLS must include ${t}`);
  }
  assert.ok(Object.isFrozen(FORBIDDEN_TOOLS));
});

// --- moved-from-review-panel behavior, asserted at its new home ---------------
// review-panel.test.mjs already covers these through its re-export and is left
// untouched by this refactor (that is the evidence behavior did not change).
// These two assert the same contract against ask.mjs directly, so deleting the
// re-export later cannot silently drop the coverage.

test("classifyResult: still distinguishes verdict / api-error / no-output at its new home", () => {
  assert.equal(classifyResult({ subtype: "success", structured_output: { findings: [] } }).ok, true);
  const quota = classifyResult({ subtype: "success", is_error: true, api_error_status: 429, result: "You've hit your session limit · resets 3:30pm" });
  assert.equal(quota.kind, "api-error");
  assert.equal(quota.retryable, false, "a session limit cannot clear in-run, so it must not be retried");
  assert.equal(classifyResult({ subtype: "success", is_error: true, api_error_status: 529, result: "overloaded_error" }).retryable, true);
  assert.equal(classifyResult({ subtype: "success" }).kind, "no-output");
});

test("withRetry: retries only retryable errors", async () => {
  const noSleep = { baseMs: 0, sleep: async () => {} };
  let calls = 0;
  const out = await withRetry(async () => {
    calls++;
    if (calls < 3) { const e = new Error("transient"); e.retryable = true; throw e; }
    return "ok";
  }, noSleep);
  assert.equal(out, "ok");
  assert.equal(calls, 3);

  let once = 0;
  await assert.rejects(withRetry(async () => { once++; const e = new Error("quota"); e.retryable = false; throw e; }, noSleep));
  assert.equal(once, 1, "a non-retryable error must not be attempted twice");
});

test("CITATION: exported from review-panel.mjs so gates share one definition", () => {
  // Exported by this refactor. The hunt gate consumes it; re-typing the pattern
  // is the drift failure the panel's own comments argue against.
  assert.ok(CITATION.test("packages/cli/src/output/formatter.ts:44"));
  assert.ok(CITATION.test("see scripts/agent/ask.mjs:12 for why"));
  assert.doesNotMatch("looks fine", CITATION, "a bare assertion is not a citation");
  assert.doesNotMatch("packages/cli/src/output/formatter.ts", CITATION, "a path with no line number locates nothing");
});
