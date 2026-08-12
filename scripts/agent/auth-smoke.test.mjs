import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyFailure, describeFailure, EXIT } from "./auth-smoke.mjs";

// This script had no test suite, and it is the FIRST thing an adopter runs —
// so its diagnosis is the first thing they read. It reported "auth almost
// certainly failed" for a session limit, which is the opposite of the truth:
// a quota refusal proves the credential was accepted and the request reached
// the service. These tests pin the distinction.

test("the message this script actually got wrong classifies as quota", () => {
  // Verbatim from wafflebase run 31475897522, the first live exercise of the
  // extracted pipeline. It was reported as an auth failure.
  const real = "Claude Code returned an error result: You've hit your session limit · resets 10:50am (UTC)";
  assert.equal(classifyFailure(real), "quota");
  const { code, text } = describeFailure("quota", real);
  assert.equal(code, EXIT.quota);
  assert.match(text, /Authentication SUCCEEDED/);
  assert.doesNotMatch(text, /auth.{0,20}failed/i, "must not tell the reader their credential is broken");
});

test("capacity and quota refusals never read as a credential problem", () => {
  for (const m of [
    "You've hit your session limit · resets 10:50am (UTC)",
    "rate_limit_error: too many requests",
    "Rate limit exceeded",
    "HTTP 429",
    "overloaded_error: the service is overloaded",
    "You have exceeded your usage limit",
    "quota exceeded for this organization",
    "insufficient capacity, try again later",
  ]) {
    assert.equal(classifyFailure(m), "quota", m);
    assert.equal(describeFailure("quota", m).code, EXIT.quota, m);
  }
});

test("real credential failures are still reported as credential failures", () => {
  for (const m of [
    "HTTP 401 Unauthorized",
    "403 forbidden",
    "authentication_error: invalid bearer token",
    "authentication failed",
    "invalid api key provided",
    "invalid_token",
    "expired token",
    "not authenticated",
    "permission denied",
  ]) {
    assert.equal(classifyFailure(m), "auth", m);
    const { code, text } = describeFailure("auth", m);
    assert.equal(code, EXIT.auth);
    assert.match(text, /CLAUDE_CODE_OAUTH_TOKEN/, "must name the secret to fix");
  }
});

test("the message an unauthenticated SDK actually returns classifies as auth", () => {
  // Verbatim from testbed run 31478400821, which ran the reusable workflow with a
  // deliberately invalid token. The first version of the classifier returned
  // "unknown" for this — the most likely real failure of all, an absent or
  // malformed token, was the one case it could not name.
  const real = "Claude Code returned an error result: Not logged in \u00b7 Please run /login";
  assert.equal(classifyFailure(real), "auth");
  const { code, text } = describeFailure("auth", real);
  assert.equal(code, EXIT.auth);
  assert.match(text, /CLAUDE_CODE_OAUTH_TOKEN/);
});

test("quota wins when a capacity refusal is dressed up in credential language", () => {
  // Observed shape: the transport reports a 429 while the prose mentions the
  // account. The specific signal is the more reliable one, so quota is checked
  // first — otherwise this reads as "your token is bad" and sends the adopter
  // after a credential that is fine.
  assert.equal(classifyFailure("429: your account has hit its session limit"), "quota");
  assert.equal(classifyFailure("permission denied: rate limit exceeded for this key"), "quota");
});

test("an unclassifiable failure says so, and errs toward needing attention", () => {
  for (const m of ["socket hang up", "ECONNRESET", "", null, undefined, "something odd happened"]) {
    assert.equal(classifyFailure(m), "unknown", String(m));
  }
  const { code, text } = describeFailure("unknown", "socket hang up");
  // Not exit 0: an unknown failure must never read as "safe to arm".
  assert.equal(code, EXIT.auth);
  assert.match(text, /could not be classified/);
  assert.match(text, /socket hang up/, "the raw message must survive into the output");
});

test("the raw detail always reaches the reader, even when empty", () => {
  for (const kind of ["quota", "auth", "unknown"]) {
    assert.match(describeFailure(kind, "").text, /\(no detail\)/, kind);
    assert.match(describeFailure(kind, "   ").text, /\(no detail\)/, `${kind} whitespace-only`);
  }
});

test("the exit codes are distinct and 0 is reserved for success", () => {
  const codes = [EXIT.ok, EXIT.auth, EXIT.quota, EXIT.tooling];
  assert.deepEqual(codes, [0, 1, 2, 3]);
  assert.equal(new Set(codes).size, 4, "a caller must be able to tell the outcomes apart");
  // Nothing but success may exit 0 — the workflow reads this as "safe to arm".
  for (const kind of ["quota", "auth", "unknown"]) {
    assert.notEqual(describeFailure(kind, "x").code, EXIT.ok, kind);
  }
});

test("importing the module does not run the probe", () => {
  // The main guard is what makes this file testable at all: without it, the
  // import above would have fired a live SDK query and called process.exit.
  assert.equal(typeof classifyFailure, "function");
  assert.equal(typeof describeFailure, "function");
});
