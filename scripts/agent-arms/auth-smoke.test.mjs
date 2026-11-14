import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTH, QUOTA, classifyFailure, describeFailure, EXIT, worstExit } from "./auth-smoke.mjs";
import { SESSION_LIMIT_RE, redactSecrets } from "../agent/redact.mjs";
import * as probe from "../agent/pick-fix-credential.mjs";

const { classifyProbeFailure } = probe;

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
    // The period this list missed. Left unclassified it fell through to
    // "unknown" and exited 1, sending an operator to hunt a credential problem
    // they did not have — the exact misdiagnosis this file's header warns about.
    "You've hit your weekly limit · resets 11pm (UTC)",
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

test("worstExit: one broken credential outranks any number of working ones", () => {
  // The failure mode this exists to prevent: a pool of four where one secret
  // expired, three answer fine, and the check exits 0 because most of it worked.
  assert.equal(worstExit([EXIT.ok, EXIT.ok, EXIT.auth, EXIT.ok]), EXIT.auth);
  assert.equal(worstExit([EXIT.ok, EXIT.ok]), EXIT.ok);
  assert.equal(worstExit([]), EXIT.ok, "an empty pool is not a failure by itself");
});

test("worstExit: a misconfiguration outranks a quota refusal", () => {
  // Both are non-zero, but they send an operator to different places, and the
  // reassuring one ('nothing is misconfigured, retry later') would bury the
  // expired secret sitting next to it.
  assert.equal(worstExit([EXIT.quota, EXIT.auth]), EXIT.auth);
  assert.equal(worstExit([EXIT.ok, EXIT.quota]), EXIT.quota);
});

test("importing the module does not run the probe", () => {
  // The main guard is what makes this file testable at all: without it, the
  // import above would have fired a live SDK query and called process.exit.
  assert.equal(typeof classifyFailure, "function");
  assert.equal(typeof describeFailure, "function");
});

test("describeFailure: never echoes a credential into the public Actions log", () => {
  // This is the tool you run WHEN a credential is broken, so a malformed secret —
  // whose value the HTTP client quotes back verbatim — reaches it by design. The
  // repo is public, so its Actions log is public.
  const token = "sk-ant-oat01-AbCdEf1234567890XyZw QqRrSs9876543210AbCd";
  const raw = `Header 'Authorization' has invalid value: ${token}`;
  for (const kind of ["quota", "auth", "unknown"]) {
    const { text } = describeFailure(kind, raw);
    for (const fragment of token.split(/\s+/)) {
      assert.ok(!text.includes(fragment), `${kind} leaked "${fragment}": ${text}`);
    }
  }
  // Scrubbing must not blunt the diagnosis: the fault is still named exactly.
  assert.match(describeFailure("auth", raw).text, /invalid value: <REDACTED>/);
});

test("classifyFailure: reads the RAW text, so redaction cannot change the verdict", () => {
  // Both diagnoses survive scrubbing because `classifyFailure` runs upstream of it
  // — and because neither signal is credential-shaped, so nothing masks them even
  // when it does run.
  const cases = [["You've hit your session limit", "quota"], ["401 unauthorized", "auth"]];
  for (const [text, kind] of cases) {
    assert.equal(classifyFailure(text), kind);
    assert.equal(classifyFailure(redactSecrets(text, { extra: [] })), kind, `redaction changed: ${text}`);
  }
});

// One vocabulary, two thresholds. The fix-credential probe
// (`pick-fix-credential.mjs`) classifies with a NARROWED copy of this
// script's lists, because its "refused" latches a PR: where this pre-arm check
// calls a 429 or an overload `quota` (the credential worked; retry), the probe
// would page a human over a blip. It keeps a copy rather than importing it —
// it runs from a staged copy of the shared core, which does not carry this
// arm — so these tests are what keep the two lists one vocabulary: the lists
// themselves are compared pattern for pattern, and one message for each
// pattern shows the two thresholds.
//
// TWO CORES. The probe is part of the harness core, which wafflebase is moving
// onto yorkie's copy. yorkie's main at 0fa3f92f keeps its lists private, with
// a narrower auth list and no transient-first rule; yorkie's change that
// exports both lists (with this ordering and these patterns) is not merged
// yet. Against a core without the exported lists, the comparisons it cannot
// pass are reported as `todo`, naming what differs, instead of failing: they
// are a difference in the core to settle upstream, not in this arm. Against a
// core that exports both lists — this repository's today, and yorkie's once
// that change lands — every one of them is enforced.
const PROBE_LISTS = Array.isArray(probe.AUTH) && Array.isArray(probe.TRANSIENT);
const UPSTREAM_GAP = PROBE_LISTS
  ? false
  : "the shared core's probe keeps its vocabulary private, has a narrower auth list and lets auth words beat a transient signal";

test("the fix-credential probe's lists are this script's, pattern for pattern", { todo: UPSTREAM_GAP }, () => {
  // Exact, not by example: a pattern added, widened or narrowed in one copy
  // classifies the examples below the same and would pass them.
  const key = (list) => list.map((re) => `${re.source}/${re.flags}`).sort();
  assert.ok(QUOTA.includes(SESSION_LIMIT_RE), "the quota list no longer holds the pipeline's own session-limit rule");
  assert.deepEqual(key(QUOTA.filter((re) => re !== SESSION_LIMIT_RE)), key(probe.TRANSIENT ?? []), "the transient-capacity lists differ");
  assert.deepEqual(key(AUTH), key(probe.AUTH ?? []), "the auth lists differ");
});

test("the fix-credential probe reads this vocabulary, narrowed to refusals that stay refused", () => {
  // The same rejected credential reads the same in both.
  for (const msg of [
    "401 Unauthorized",
    "403 Forbidden",
    "unauthorized",
    "authentication_error",
    "authentication failed",
    "Invalid API key",
    "invalid token",
    "invalid credential",
    "expired token",
    "expired credential",
    "Not logged in · Please run /login",
    "Please run /login",
  ]) {
    assert.equal(classifyProbeFailure(msg), "auth", msg);
    assert.equal(classifyFailure(msg), "auth", msg);
  }
  // A closed usage window is quota in both.
  assert.equal(classifyProbeFailure("You've hit your session limit · resets 3am"), "quota");
  assert.equal(classifyFailure("You've hit your session limit · resets 3am"), "quota");
  // A transient refusal is quota to the pre-arm check and NOT a refusal there.
  for (const msg of [
    "429 Too Many Requests",
    "rate limit exceeded",
    "Overloaded (529)",
    "quota exceeded, retry later",
    "at capacity, retry later",
    "too many requests",
  ]) {
    assert.equal(classifyFailure(msg), "quota", msg);
    assert.equal(classifyProbeFailure(msg), "unknown", msg);
  }
});

test("the fix-credential probe: the rest of the auth words, and a transient signal beats them", { todo: UPSTREAM_GAP }, () => {
  for (const msg of ["not authenticated", "permission denied", "see /login"]) {
    assert.equal(classifyProbeFailure(msg), "auth", msg);
    assert.equal(classifyFailure(msg), "auth", msg);
  }
  // A transient refusal that also carries auth words is still transient: a
  // 429 that says "unauthorized" must not latch a PR.
  assert.equal(classifyProbeFailure("429 rate limited: unauthorized burst"), "unknown");
});

test("the runner's own faults in the stderr tail are not a refusal, in either reading", () => {
  // The SDK's exit error carries the CLI's stderr tail, so a filesystem error
  // or a URL on the runner reaches both classifiers. Read as auth, this script
  // would tell an operator their credential is broken, and the probe would
  // refuse every slot and page the PR. The same cases as the core's own suite.
  const exit = (tail) => `Claude Code process exited with code 1. stderr: ${tail}`;
  for (const msg of [
    exit("Error: EACCES: permission denied, mkdir '/tmp/probe-abc/.claude'"),
    exit("Error: EPERM: permission denied, open '/tmp/probe-abc/.claude.json'"),
    exit("sh: /usr/local/bin/claude: Permission denied"),
    exit("mkdir: cannot create directory '/tmp/x': Permission denied"),
    exit("fetch failed: GET https://console.example.com/oauth/login (ECONNRESET)"),
    exit("500 Internal server error; see https://status.example.com/login"),
    exit("    at Object.<anonymous> (/app/login.js:12:5)"),
    exit("    at run (/login.mjs:3:1)"),
    exit("GET /login/callback failed"),
  ]) {
    assert.equal(classifyFailure(msg), "unknown", msg);
  }
  // The same words still read as auth when they are about the credential.
  for (const msg of [
    exit("Not logged in · Please run /login"),
    exit("You must sign in first. Run /login."),
    exit("Error: permission denied for this token"),
    "error 0 Permission denied: the credential lacks access",
  ]) {
    assert.equal(classifyFailure(msg), "auth", msg);
  }
});
