import test from "node:test";
import assert from "node:assert/strict";
import { guardVerdictLine, renderGuardSummary } from "./guard-verdict.mjs";

test("proceed line names the round being dispatched, not the failed count", () => {
  const line = guardVerdictLine({
    decision: "proceed",
    failedRounds: 1,
    max: 3,
    stall: { reason: "progressing", stalls: 0, rounds: 2 },
    standstillCount: 0,
  });
  assert.match(line, /proceed/);
  assert.match(line, /fix round 2 of 3/);
  assert.match(line, /progressing/);
  assert.match(line, /standstill: 0/);
});

test("verdict line is single-line even when inputs carry newlines", () => {
  const line = guardVerdictLine({ decision: "page", reason: "stall\nmultiline" });
  assert.ok(!/\n/.test(line));
});

test("page line names the known reason in plain language", () => {
  assert.match(guardVerdictLine({ decision: "page", reason: "round-cap" }), /budget is exhausted/);
  assert.match(guardVerdictLine({ decision: "page", reason: "infra" }), /API\/quota/);
  // Unknown reasons pass through rather than throwing — the guard may grow
  // a page path faster than this map.
  assert.match(guardVerdictLine({ decision: "page", reason: "novel-reason" }), /novel-reason/);
});

test("latched decision renders without any round data", () => {
  assert.match(guardVerdictLine({ decision: "latched" }), /already paged/);
  assert.match(renderGuardSummary({ decision: "latched" }), /SKIPPED \(already paged\)/);
});

test("page summary tolerates the early paths (no rounds counted yet)", () => {
  // infra and invalid-verdict page BEFORE commits are fetched: failedRounds is
  // null and must not render as "null of 3".
  const md = renderGuardSummary({ decision: "page", reason: "infra", detail: "quota exceeded" });
  assert.match(md, /PAGED \(infra\)/);
  assert.ok(!md.includes("null"));
  // An uncounted round budget must not render as a confident "0 of 3".
  assert.ok(!/Failed fix rounds/.test(md));
  assert.match(md, /> quota exceeded/);
});

test("page summary includes the round count when it WAS measured", () => {
  const md = renderGuardSummary({ decision: "page", reason: "round-cap", failedRounds: 3, max: 3 });
  assert.match(md, /Failed fix rounds so far: 3 of 3/);
});

test("proceed summary carries every decision input", () => {
  const md = renderGuardSummary({
    decision: "proceed",
    failedRounds: 0,
    max: 3,
    stall: { reason: "too-few-rounds", stalls: 0, rounds: 1 },
    standstillCount: 0,
    rebuttalLimit: 2,
    infra: "",
    heldByRerun: false,
    rerunAt: null,
    requiredCheckNames: ["agent-review-correctness"],
  });
  assert.match(md, /PROCEED/);
  assert.match(md, /0 of 3/);
  assert.match(md, /`too-few-rounds`/);
  assert.match(md, /2-uphold rebuttal limit/);
  assert.match(md, /Infra: none/);
  assert.match(md, /agent-review-correctness/);
});

test("rerun hand-back is stated when it holds the softer pages", () => {
  const md = renderGuardSummary({
    decision: "proceed",
    failedRounds: 0,
    max: 3,
    heldByRerun: true,
    standstillCount: 0,
  });
  assert.match(md, /held for this one attempt/);
});
