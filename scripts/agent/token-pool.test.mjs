import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_SLOTS, readPoolSlots, readPoolTokens, selectStartIndex, createTokenPool } from "./token-pool.mjs";

/** Env with every pool variable cleared, so a stray real token can't leak in. */
function env(overrides = {}) {
  const base = { CLAUDE_CODE_OAUTH_TOKEN: "" };
  for (let i = 1; i <= MAX_SLOTS; i++) base[`CLAUDE_CODE_OAUTH_TOKEN_${i}`] = "";
  return { ...base, ...overrides };
}

test("readPoolTokens: the unsuffixed variable is slot zero", () => {
  assert.deepEqual(readPoolTokens(env({ CLAUDE_CODE_OAUTH_TOKEN: "a" })), ["a"]);
});

test("readPoolTokens: suffixed slots follow, in declared order", () => {
  const tokens = readPoolTokens(
    env({ CLAUDE_CODE_OAUTH_TOKEN: "a", CLAUDE_CODE_OAUTH_TOKEN_1: "b", CLAUDE_CODE_OAUTH_TOKEN_2: "c" }),
  );
  assert.deepEqual(tokens, ["a", "b", "c"]);
});

test("readPoolTokens: empty and whitespace-only slots are holes, not members", () => {
  // Every workflow passes all MAX_SLOTS variables; unregistered secrets arrive
  // as "". A hole must not shift the slots after it out of position, and must
  // not become a member that authenticates as nothing.
  const tokens = readPoolTokens(env({ CLAUDE_CODE_OAUTH_TOKEN_1: "b", CLAUDE_CODE_OAUTH_TOKEN_3: "d" }));
  assert.deepEqual(tokens, ["b", "d"]);
  assert.deepEqual(readPoolTokens(env({ CLAUDE_CODE_OAUTH_TOKEN_1: "   " })), []);
});

test("readPoolTokens: a token repeated across slots counts once", () => {
  // The migration state: the unsuffixed secret is kept AND copied into _1.
  // Counting it twice would make failover 'switch' to the same dead account.
  const tokens = readPoolTokens(env({ CLAUDE_CODE_OAUTH_TOKEN: "a", CLAUDE_CODE_OAUTH_TOKEN_1: "a" }));
  assert.deepEqual(tokens, ["a"]);
});

test("readPoolTokens: surrounding whitespace is stripped", () => {
  assert.deepEqual(readPoolTokens(env({ CLAUDE_CODE_OAUTH_TOKEN_1: " a\n" })), ["a"]);
});

test("readPoolTokens: slots past MAX_SLOTS are ignored", () => {
  const beyond = MAX_SLOTS + 1;
  assert.deepEqual(readPoolTokens(env({ [`CLAUDE_CODE_OAUTH_TOKEN_${beyond}`]: "x" })), []);
});

test("readPoolSlots: each token carries the secret name that supplied it", () => {
  // Holes and dedup mean a position in the pool is NOT its suffix, so a
  // diagnostic that says "slot 2 is bad" would send an operator to the wrong
  // secret. The name is the only actionable identifier — and the only one that
  // can be printed, since the token itself never can.
  const slots = readPoolSlots(env({ CLAUDE_CODE_OAUTH_TOKEN_2: "b", CLAUDE_CODE_OAUTH_TOKEN_5: "e" }));
  assert.deepEqual(slots, [
    { name: "CLAUDE_CODE_OAUTH_TOKEN_2", token: "b" },
    { name: "CLAUDE_CODE_OAUTH_TOKEN_5", token: "e" },
  ]);
});

test("selectStartIndex: consecutive runs land on different tokens", () => {
  const picks = [101, 102, 103, 104].map((runId) => selectStartIndex(4, { runId: String(runId), runAttempt: "1" }));
  assert.deepEqual(picks, [1, 2, 3, 0]);
});

test("selectStartIndex: a re-run does not re-pick the token that just died", () => {
  const first = selectStartIndex(4, { runId: "100", runAttempt: "1" });
  const second = selectStartIndex(4, { runId: "100", runAttempt: "2" });
  assert.notEqual(first, second);
});

test("selectStartIndex: a missing or unparseable run id is index zero, not NaN", () => {
  // Local runs and the `act` harness have no GITHUB_RUN_ID. NaN % n is NaN,
  // which would index the pool to `undefined` and authenticate as nothing.
  for (const runId of [undefined, "", "not-a-number"]) {
    assert.equal(selectStartIndex(4, { runId, runAttempt: undefined }), 0);
  }
});

test("selectStartIndex: a run id beyond MAX_SAFE_INTEGER still lands in range", () => {
  const index = selectStartIndex(4, { runId: "9".repeat(25), runAttempt: "1" });
  assert.ok(Number.isInteger(index) && index >= 0 && index < 4, `got ${index}`);
});

test("selectStartIndex: an empty pool is index zero rather than a divide by zero", () => {
  assert.equal(selectStartIndex(0, { runId: "7", runAttempt: "1" }), 0);
});

test("createTokenPool: a single token behaves exactly as before the pool existed", () => {
  const pool = createTokenPool({ env: env({ CLAUDE_CODE_OAUTH_TOKEN: "solo" }) });
  assert.equal(pool.size, 1);
  assert.equal(pool.current(), "solo");
  assert.equal(pool.advance("session limit"), null); // nothing to fall back to
});

test("createTokenPool: an empty pool reports no token instead of throwing", () => {
  // The SDK's own 'no credentials' error is a better diagnostic than ours, so
  // an unconfigured environment must reach it rather than dying here.
  const pool = createTokenPool({ env: env() });
  assert.equal(pool.size, 0);
  assert.equal(pool.current(), null);
});

test("createTokenPool: current() is stable across calls so one job keeps one cache", () => {
  // The whole reason distribution is per-job: prompt caches are per-account,
  // and review-panel's warmup gate pays for the shared prefix exactly once.
  const pool = createTokenPool({
    env: env({ CLAUDE_CODE_OAUTH_TOKEN_1: "a", CLAUDE_CODE_OAUTH_TOKEN_2: "b", CLAUDE_CODE_OAUTH_TOKEN_3: "c" }),
    runId: "1",
    runAttempt: "1",
  });
  const first = pool.current();
  for (let i = 0; i < 20; i++) assert.equal(pool.current(), first);
});

test("createTokenPool: advance() hands out every other token before giving up", () => {
  const pool = createTokenPool({
    env: env({ CLAUDE_CODE_OAUTH_TOKEN_1: "a", CLAUDE_CODE_OAUTH_TOKEN_2: "b", CLAUDE_CODE_OAUTH_TOKEN_3: "c" }),
    runId: "0",
    runAttempt: "1",
  });
  const seen = [pool.current()];
  for (let next = pool.advance("limit"); next !== null; next = pool.advance("limit")) seen.push(next);
  assert.deepEqual([...seen].sort(), ["a", "b", "c"]);
  assert.equal(pool.advance("limit"), null, "a dry pool stays dry");
});

test("createTokenPool: advance() wraps past the start index", () => {
  // Starting at the last slot must still reach the earlier ones — the failover
  // order is a rotation, not a suffix.
  const pool = createTokenPool({
    env: env({ CLAUDE_CODE_OAUTH_TOKEN_1: "a", CLAUDE_CODE_OAUTH_TOKEN_2: "b" }),
    runId: "1", // size 2 → starts at index 1 ("b")
    runAttempt: "1",
  });
  assert.equal(pool.current(), "b");
  assert.equal(pool.advance("limit"), "a");
});

test("createTokenPool: current() reflects the token advance() returned", () => {
  const pool = createTokenPool({
    env: env({ CLAUDE_CODE_OAUTH_TOKEN_1: "a", CLAUDE_CODE_OAUTH_TOKEN_2: "b" }),
    runId: "0",
    runAttempt: "1",
  });
  const next = pool.advance("limit");
  assert.equal(pool.current(), next);
});

test("createTokenPool: advancing off a token already retired is a no-op", () => {
  // Concurrent lenses in one panel round discover the same exhaustion. The
  // second report must not burn a second, healthy token.
  const pool = createTokenPool({
    env: env({ CLAUDE_CODE_OAUTH_TOKEN_1: "a", CLAUDE_CODE_OAUTH_TOKEN_2: "b", CLAUDE_CODE_OAUTH_TOKEN_3: "c" }),
    runId: "0",
    runAttempt: "1",
  });
  const dead = pool.current();
  const next = pool.advance("limit", dead);
  assert.equal(pool.advance("limit", dead), next, "same dead token reported twice");
  assert.equal(pool.current(), next);
});

test("createTokenPool: retired tokens are reported for the run summary", () => {
  const pool = createTokenPool({
    env: env({ CLAUDE_CODE_OAUTH_TOKEN_1: "a", CLAUDE_CODE_OAUTH_TOKEN_2: "b" }),
    runId: "0",
    runAttempt: "1",
  });
  assert.equal(pool.retiredCount(), 0);
  pool.advance("session limit");
  assert.equal(pool.retiredCount(), 1);
});
