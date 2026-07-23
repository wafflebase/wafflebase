import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseExecution,
  aggregate,
  scopeSize,
  formatTokens,
  formatMinutes,
  renderSummary,
  serializeRecord,
  parseMetricComment,
} from "./metrics.mjs";

const resultMsg = (over = {}) => ({
  type: "result",
  num_turns: 27,
  duration_ms: 89 * 60000,
  total_cost_usd: 1.23,
  session_id: "s1",
  modelUsage: { "claude-opus-4-8": {} },
  usage: {
    input_tokens: 100,
    output_tokens: 34633,
    cache_creation_input_tokens: 136293,
    cache_read_input_tokens: 800000,
  },
  ...over,
});

test("parseExecution: pulls turns/tokens(incl cache)/time/model from the last result", () => {
  const rec = parseExecution([{ type: "assistant" }, resultMsg()], "implement");
  assert.equal(rec.kind, "implement");
  assert.deepEqual(rec.models, ["claude-opus-4-8"]);
  assert.equal(rec.turns, 27);
  assert.equal(rec.tokens, 100 + 34633 + 136293 + 800000); // total incl. cache
  assert.equal(rec.durationMs, 89 * 60000);
  // no result message → null (caller treats as nothing to record)
  assert.equal(parseExecution([{ type: "assistant" }]), null);
  assert.equal(parseExecution("garbage"), null);
});

test("aggregate: sums across sessions; attempt counts review-fix rounds + 1", () => {
  const recs = [
    { kind: "implement", models: ["claude-opus-4-8"], turns: 10, tokens: 500000, durationMs: 600000 },
    { kind: "ci-fix", models: ["claude-opus-4-8"], turns: 5, tokens: 200000, durationMs: 120000 },
    { kind: "review-fix", models: ["claude-sonnet-5"], turns: 8, tokens: 300000, durationMs: 300000 },
  ];
  const agg = aggregate(recs);
  assert.deepEqual(agg.agents, ["claude-opus-4-8", "claude-sonnet-5"]); // unique, sorted
  assert.equal(agg.sessions, 3);
  assert.equal(agg.attempt, 2); // one review-fix → attempt 2
  assert.equal(agg.turns, 23);
  assert.equal(agg.tokens, 1000000);
  assert.equal(agg.durationMs, 1020000);
  // no review-fix → attempt 1
  assert.equal(aggregate([{ kind: "implement" }]).attempt, 1);
  assert.equal(aggregate([]).sessions, 0);
});

test("scopeSize: S/M/L thresholds on total diff lines", () => {
  assert.equal(scopeSize(10, 5), "S");
  assert.equal(scopeSize(50, 0), "S");
  assert.equal(scopeSize(60, 100), "M");
  assert.equal(scopeSize(300, 0), "M");
  assert.equal(scopeSize(400, 200), "L");
});

test("formatTokens / formatMinutes: human-friendly", () => {
  assert.equal(formatTokens(1_000_000), "~1.0M");
  assert.equal(formatTokens(6_200_000), "~6.2M");
  assert.equal(formatTokens(34_733), "~35K");
  assert.equal(formatTokens(0), "~0");
  assert.equal(formatMinutes(89 * 60000), "89m");
  assert.equal(formatMinutes(5000), "1m"); // floor at 1m
});

test("renderSummary: matches the requested bullet format", () => {
  const md = renderSummary({
    agg: { agents: ["claude-opus-4-8"], sessions: 1, attempt: 1, turns: 27, tokens: 1_000_000, durationMs: 89 * 60000 },
    scope: "M",
  });
  assert.match(md, /- Agents: claude-opus-4-8/);
  assert.match(md, /- Scope-size: M/);
  assert.match(md, /- Attempt: 1/);
  assert.match(md, /- Sessions: 1/);
  assert.match(md, /- Total-time: 89m/);
  assert.match(md, /- Turns: 27/);
  assert.match(md, /- Tokens: ~1\.0M/);
});

test("metric comment round-trip: hidden, self-contained, parses back; junk → null", () => {
  const rec = { kind: "review-fix", models: ["claude-opus-4-8"], turns: 3, tokens: 2, durationMs: 1 };
  const body = serializeRecord(rec);
  assert.match(body, /^<!-- agent-metric /); // a hidden HTML comment (renders invisibly)
  assert.match(body, / -->$/);
  assert.deepEqual(parseMetricComment(body), rec); // round-trips
  // not a metric comment / unparseable → null (so summarize just skips it)
  assert.equal(parseMetricComment("a normal human comment"), null);
  assert.equal(parseMetricComment(""), null);
});
