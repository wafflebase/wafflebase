import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseExecution,
  sumExecutions,
  aggregate,
  aggregatePanelStats,
  scopeSize,
  formatTokens,
  formatMinutes,
  renderSummary,
  serializeRecord,
  parseMetricComment,
  METRIC_PREFIX,
  SUMMARY_MARKER,
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

test("sumExecutions: sums EVERY result message (not last-wins like parseExecution)", () => {
  const a = resultMsg({ num_turns: 3, duration_ms: 1000, total_cost_usd: 1.5, modelUsage: { "claude-opus-4-8": {} }, usage: { input_tokens: 10, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } });
  const b = resultMsg({ num_turns: 5, duration_ms: 2000, total_cost_usd: 2.25, modelUsage: { "claude-sonnet-5": {} }, usage: { input_tokens: 20, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, session_id: "s2" });
  const rec = sumExecutions([{ type: "assistant" }, a, b], "review");
  assert.equal(rec.kind, "review");
  assert.deepEqual(rec.models, ["claude-opus-4-8", "claude-sonnet-5"]); // unique, sorted, across all calls
  assert.equal(rec.turns, 8); // 3 + 5, not just the last (5)
  assert.equal(rec.tokens, 30); // 10 + 20
  assert.equal(rec.durationMs, 3000);
  assert.equal(rec.costUsd, 3.75); // 1.5 + 2.25, not just the last
  assert.equal(rec.sessionId, "s2"); // last call's session id
  assert.equal(rec.calls, 2);
  // no result messages at all → calls:0, all-zero (caller treats as nothing to record)
  const empty = sumExecutions([{ type: "assistant" }]);
  assert.equal(empty.calls, 0);
  assert.equal(empty.turns, 0);
  assert.equal(sumExecutions("garbage").calls, 0);
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

test("aggregatePanelStats: rolls up lens/round entries — agreement, severity-weighted raised/kept, verifier tallies", () => {
  const entries = [
    {
      agreement: "identical",
      raised: { critical: 1, major: 0, minor: 2, nit: 0 },
      kept: { critical: 1, major: 0, minor: 2, nit: 0 },
      verifier: { sentToVerifier: 1, refuted: 0, refutedHighConfidence: 0 },
    },
    {
      agreement: "partial",
      raised: { critical: 0, major: 2, minor: 0, nit: 1 },
      kept: { critical: 0, major: 1, minor: 0, nit: 1 },
      verifier: { sentToVerifier: 2, refuted: 1, refutedHighConfidence: 1 },
    },
  ];
  const rolled = aggregatePanelStats(entries);
  assert.deepEqual(rolled.agreementCounts, { identical: 1, partial: 1, disjoint: 0, single: 0 });
  assert.deepEqual(rolled.raised, { critical: 1, major: 2, minor: 2, nit: 1 });
  assert.deepEqual(rolled.kept, { critical: 1, major: 1, minor: 2, nit: 1 });
  assert.deepEqual(rolled.verifier, { sentToVerifier: 3, refuted: 1, refutedHighConfidence: 1 });
  // tolerant of junk/empty input — never throws, never blocks recording
  assert.deepEqual(aggregatePanelStats([]).verifier, { sentToVerifier: 0, refuted: 0, refutedHighConfidence: 0 });
  assert.deepEqual(aggregatePanelStats(null).agreementCounts, { identical: 0, partial: 0, disjoint: 0, single: 0 });
  assert.deepEqual(aggregatePanelStats([null, "junk", {}]).raised, { critical: 0, major: 0, minor: 0, nit: 0 });
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
  assert.match(md, /### Code-fix agent/);
  assert.match(md, /- Agents: claude-opus-4-8/);
  assert.match(md, /- Scope-size: M/);
  assert.match(md, /- Attempt: 1/);
  assert.match(md, /- Sessions: 1/);
  assert.match(md, /- Total-time: 89m/);
  assert.match(md, /- Turns: 27/);
  assert.match(md, /- Tokens: ~1\.0M/);
  // no review-panel records on this PR → no "Review panel" section at all,
  // and the top total-tokens line reflects code-fix only
  assert.doesNotMatch(md, /### Review panel/);
  assert.match(md, /- Total-tokens: ~1\.0M \(code-fix ~1\.0M \+ review ~0\)/);
});

test("renderSummary: with review-panel data, renders a separate section + combined total", () => {
  const md = renderSummary({
    agg: { agents: ["claude-opus-4-8"], sessions: 3, attempt: 2, turns: 31, tokens: 1_100_000, durationMs: 94 * 60000 },
    panelAgg: { agents: ["claude-opus-4-8"], sessions: 2, turns: 15, tokens: 300_000, durationMs: 27 * 60000 },
    panelStats: {
      agreementCounts: { identical: 6, partial: 1, disjoint: 1, single: 0 },
      raised: { critical: 2, major: 5, minor: 3, nit: 1 },
      kept: { critical: 1, major: 3, minor: 0, nit: 0 },
      verifier: { sentToVerifier: 7, refuted: 3, refutedHighConfidence: 2 },
    },
    scope: "M",
  });
  assert.match(md, /### Code-fix agent/);
  assert.match(md, /### Review panel/);
  assert.match(md, /- Rounds: 2/);
  assert.match(md, /- Total-time: 27m/);
  assert.match(md, /- Sample-agreement: 6 identical, 1 partial, 1 disjoint \(8 lens-round samples\)/);
  assert.match(md, /- Findings raised: 2 critical, 5 major, 3 minor, 1 nit/);
  assert.match(md, /- Sent to verifier: 7/);
  assert.match(md, /- Refuted: 3 \(2 high-confidence\)/);
  assert.match(md, /- Survived to gate: 1 critical, 3 major/);
  // combined total = code-fix (1.1M) + review (300K) = 1.4M
  assert.match(md, /- Total-tokens: ~1\.4M \(code-fix ~1\.1M \+ review ~300K\)/);
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

// Guard the --final sweep: it deletes per-session records by matching
// METRIC_PREFIX. That filter must NEVER match the SUMMARY comment we just
// posted, or promotion would delete its own summary. ("agent-metric " has a
// trailing space; "agent-metrics-summary" has an 's' — no substring overlap.)
test("sweep filter: METRIC_PREFIX matches a record but NOT the summary marker", () => {
  const record = serializeRecord({ kind: "review-fix", turns: 3, tokens: 2, durationMs: 1 });
  assert.ok(record.includes(METRIC_PREFIX)); // a per-session record IS swept
  assert.ok(!SUMMARY_MARKER.includes(METRIC_PREFIX)); // the summary is NOT
  // renderSummary output (which carries SUMMARY_MARKER) must not look like a record
  const summary = renderSummary({
    agg: { agents: ["claude-opus-4-8"], sessions: 1, attempt: 1, turns: 1, tokens: 1, durationMs: 1 },
    panelAgg: null, panelStats: null, scope: "S",
  });
  assert.ok(summary.includes(SUMMARY_MARKER));
  assert.ok(!summary.includes(METRIC_PREFIX));
});
