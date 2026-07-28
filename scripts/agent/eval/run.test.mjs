import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyItemOutcome } from "./run.mjs";

test("all-infra panel → error/infra (not ok, even with calls > 0)", () => {
  // Regression: 24 errored SDK calls (auth failure) must NOT count as a run.
  const panel = [
    { id: "correctness", applicable: true, infraError: "Not logged in · Please run /login" },
    { id: "security", applicable: true, infraError: "Not logged in · Please run /login" },
  ];
  const o = classifyItemOutcome(panel, 24);
  assert.equal(o.status, "error");
  assert.equal(o.reason, "infra");
  assert.match(o.error.message, /Not logged in/);
});

test("one infra lens among healthy ones → still error (contaminated verdict)", () => {
  const panel = [
    { id: "correctness", applicable: true },
    { id: "security", applicable: true, infraError: "quota" },
  ];
  assert.equal(classifyItemOutcome(panel, 10).status, "error");
});

test("healthy panel with calls → ok", () => {
  const panel = [
    { id: "correctness", applicable: true, conclusion: "success" },
    { id: "security", applicable: true, conclusion: "failure" },
    { id: "design-fit", applicable: false, conclusion: "skipped" },
  ];
  const o = classifyItemOutcome(panel, 12);
  assert.equal(o.status, "ok");
  assert.equal(o.error, null);
});

test("no calls, no infra → error/no-output", () => {
  const o = classifyItemOutcome([{ id: "correctness", applicable: true }], 0);
  assert.equal(o.status, "error");
  assert.equal(o.reason, "no-output");
});

test("skipped-only lenses (none applicable) with calls → ok", () => {
  assert.equal(classifyItemOutcome([{ id: "x", applicable: false }], 5).status, "ok");
});
