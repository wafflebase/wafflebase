import { test } from "node:test";
import assert from "node:assert/strict";
import { askStructured, assertAllowedTools, PERMITTED_TOOLS, classifyResult, withRetry } from "./ask.mjs";
import { REVIEW_TOOLS } from "./review-panel.mjs";

// ask.mjs exists to make the read-only tool grant a CHECKED invariant instead of
// a hardcoded array. These tests are that check, so they are deliberately mostly
// NEGATIVE: the interesting property is what the gate refuses.
//
// None of them install or touch the SDK. `assertAllowedTools` runs before the
// lazy `import()`, which is what lets the askStructured tests below assert the
// validation happens at all without a token or a network call.

// --- the allow-list itself ---------------------------------------------------

test("PERMITTED_TOOLS: pinned to exactly the read-only triple", () => {
  // A LITERAL pin, not derived from the module. The point is that widening the
  // grant must break a test — if this asserted against PERMITTED_TOOLS itself it
  // would pass no matter what anyone added to it.
  assert.deepEqual([...PERMITTED_TOOLS], ["Read", "Grep", "Glob"]);
  assert.ok(Object.isFrozen(PERMITTED_TOOLS));
});

test("assertAllowedTools: accepts the full permitted set and any subset", () => {
  assert.deepEqual(assertAllowedTools(["Read", "Grep", "Glob"]), ["Read", "Grep", "Glob"]);
  assert.deepEqual(assertAllowedTools(["Read"]), ["Read"]);
  // A copy, not the caller's array — mutating the input afterwards must not
  // retroactively change what was validated and handed to the session.
  const input = ["Read"];
  const validated = assertAllowedTools(input);
  input.push("Bash");
  assert.deepEqual(validated, ["Read"]);
});

test("assertAllowedTools: refuses execution / write / network / spawn tools", () => {
  // Literal names, deliberately NOT looped over a list the module exports.
  for (const tool of ["Bash", "Write", "Edit", "MultiEdit", "NotebookEdit", "WebFetch", "WebSearch"]) {
    assert.throws(() => assertAllowedTools(["Read", tool]), /is not permitted/, `${tool} must be refused`);
  }
});

test("assertAllowedTools: refuses tools an author of a deny-list would have missed", () => {
  // The regression this allow-list exists for. Every name here is a REAL tool in
  // pinned SDK 0.3.217 (sdk-tools.d.ts) that a hand-written deny-list of
  // "dangerous" names did not contain. `Agent` is the worst of them: it spawns
  // subagents that inherit the parent's tools, i.e. the exact respawn escape the
  // module claims to prevent. An allow-list refuses all of them for free.
  for (const tool of ["Agent", "REPL", "Workflow", "CronCreate", "RemoteTrigger", "Artifact", "Mcp", "SendFeedback"]) {
    assert.throws(() => assertAllowedTools(["Read", tool]), /is not permitted/, `${tool} must be refused`);
  }
});

test("assertAllowedTools: refuses scoped permission-rule syntax", () => {
  // THE critical bypass. `allowedTools` entries are permission RULES, so these
  // are legal SDK input — and because the list is an auto-APPROVE list, a
  // name-based deny-list would not merely fail to catch them, it would
  // pre-approve the shell invocation past permissionMode:'dontAsk'.
  for (const rule of ["Bash(git diff:*)", "Bash(*)", "Bash(git log:*)", "WebFetch(domain:example.com)", "Read(/etc/**)"]) {
    assert.throws(() => assertAllowedTools([rule]), /is not permitted/, `${rule} must be refused`);
  }
});

test("assertAllowedTools: refuses MCP tool names", () => {
  for (const t of ["mcp__server__exec", "mcp__workspace__bash", "mcp__*"]) {
    assert.throws(() => assertAllowedTools([t]), /is not permitted/, `${t} must be refused`);
  }
});

test("assertAllowedTools: refuses non-canonical spellings rather than repairing them", () => {
  // Strictness is the design: a validator that normalizes its input is guessing
  // at intent, and a capability gate is the last place to guess. " Bash" is the
  // specific case a trim-then-compare-untrimmed bug would have let through.
  for (const t of [" Bash", "Bash ", "bash", "READ", " Read", "Read\t"]) {
    assert.throws(() => assertAllowedTools([t]), /is not permitted/, `${JSON.stringify(t)} must be refused`);
  }
});

test("assertAllowedTools: missing / empty / malformed input fails closed", () => {
  // Required, not defaulted — a default would let a new caller inherit read-only
  // access silently and then widen it with no visible signal.
  assert.throws(() => assertAllowedTools(undefined), /required and must be a non-empty array/);
  assert.throws(() => assertAllowedTools(null), /required and must be a non-empty array/);
  assert.throws(() => assertAllowedTools("Read"), /required and must be a non-empty array/);
  // Empty is rejected rather than read as "no tools": the SDK would run an agent
  // that cannot read anything, burning a paid session to return nothing.
  assert.throws(() => assertAllowedTools([]), /required and must be a non-empty array/);
  assert.throws(() => assertAllowedTools(["Read", ""]), /must be non-empty strings/);
  assert.throws(() => assertAllowedTools(["Read", "   "]), /must be non-empty strings/);
  assert.throws(() => assertAllowedTools(["Read", 42]), /must be non-empty strings/);
  assert.throws(() => assertAllowedTools(["Read", null]), /must be non-empty strings/);
});

// --- askStructured actually enforces it --------------------------------------
// Without these, deleting the assertAllowedTools call from askStructured — the
// one line that makes any of the above load-bearing — leaves the suite green.

test("askStructured: validates the grant BEFORE opening a session", async () => {
  // The SDK is never reached: these reject with the VALIDATION error, and the
  // assertion on the message is what proves the ordering. If the import ran
  // first, an unresolvable/unauthenticated SDK would produce a different error.
  await assert.rejects(
    () => askStructured({ prompt: "x", schema: {}, allowedTools: ["Bash"] }),
    /is not permitted/,
    "a forbidden grant must fail before any session is opened",
  );
  await assert.rejects(
    () => askStructured({ prompt: "x", schema: {}, allowedTools: ["Bash(git diff:*)"] }),
    /is not permitted/,
    "a scoped rule must fail before any session is opened",
  );
  await assert.rejects(
    () => askStructured({ prompt: "x", schema: {} }),
    /required and must be a non-empty array/,
    "an omitted grant must fail before any session is opened",
  );
});

// There is deliberately NO "valid grant reaches the SDK" test here. Asserting
// that would mean letting askStructured past the validation gate, which opens a
// real model session — slow, and on any runner that has credentials it would
// burn a paid session from a unit suite. The complement is covered without a
// session by the direct `assertAllowedTools(REVIEW_TOOLS)` assertion below: a
// valid grant returns rather than throws, so the rejections above are the gate
// firing and not a blanket failure.

test("REVIEW_TOOLS: the panel's actual grant is inside the permitted set", () => {
  // Pins what review-panel.mjs really passes at both call sites. Exported for
  // exactly this: previously nothing could observe the panel's grant at all.
  assert.deepEqual(REVIEW_TOOLS, ["Read", "Grep", "Glob"]);
  assert.deepEqual(assertAllowedTools(REVIEW_TOOLS), REVIEW_TOOLS, "the panel's own grant must pass its own gate");
});

// --- moved-from-review-panel behavior, asserted at its new home ---------------
// review-panel.test.mjs still covers these through the re-export and is untouched
// by this refactor (that is the evidence behavior did not change). These assert
// the same contract against ask.mjs directly, so deleting the re-export later
// cannot silently drop the coverage. Kept at parity with the originals, not
// weaker: retry-cap, terminal_reason and the returned value are all covered.

test("classifyResult: distinguishes verdict / api-error / no-output at its new home", () => {
  const ok = classifyResult({ subtype: "success", structured_output: { findings: [], summary: "s" } });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.output, { findings: [], summary: "s" });

  const quota = classifyResult({
    subtype: "success",
    is_error: true,
    api_error_status: 429,
    result: "You've hit your session limit · resets 3:30pm (UTC)",
  });
  assert.equal(quota.kind, "api-error");
  assert.equal(quota.status, 429);
  assert.equal(quota.retryable, false, "a session limit cannot clear in-run, so it must not be retried");

  assert.equal(classifyResult({ subtype: "success", is_error: true, api_error_status: 529, result: "overloaded_error" }).retryable, true);
  assert.equal(classifyResult({ subtype: "error", is_error: true, api_error_status: 500, result: "internal error" }).retryable, true);
  assert.equal(classifyResult({ terminal_reason: "api_error", result: "fetch failed" }).retryable, true);

  const none = classifyResult({ subtype: "success" });
  assert.equal(none.kind, "no-output");
  assert.equal(none.retryable, false);
});

test("withRetry: retries retryable errors, honors the cap, never retries non-retryable", async () => {
  const noSleep = { baseMs: 0, sleep: async () => {} };

  let calls = 0;
  const out = await withRetry(async () => {
    calls++;
    if (calls < 3) { const e = new Error("transient"); e.retryable = true; throw e; }
    return "ok";
  }, noSleep);
  assert.equal(out, "ok");
  assert.equal(calls, 3);

  let capped = 0;
  await assert.rejects(withRetry(async () => { capped++; const e = new Error("x"); e.retryable = true; throw e; }, { ...noSleep, retries: 2 }));
  assert.equal(capped, 3, "retries:2 means 3 total attempts, then give up");

  let once = 0;
  await assert.rejects(withRetry(async () => { once++; const e = new Error("quota"); e.retryable = false; throw e; }, noSleep));
  assert.equal(once, 1, "a non-retryable error must not be attempted twice");
});

test("withRetry: backoff grows exponentially from baseMs", async () => {
  // The delay argument was previously unobserved — both suites stubbed sleep with
  // a zero-arg no-op, so a backoff of 0 would have passed.
  const delays = [];
  await assert.rejects(
    withRetry(async () => { const e = new Error("x"); e.retryable = true; throw e; },
      { retries: 3, baseMs: 100, sleep: async (ms) => { delays.push(ms); }, jitter: () => 0 }),
  );
  assert.deepEqual(delays, [100, 200, 400]);
});
