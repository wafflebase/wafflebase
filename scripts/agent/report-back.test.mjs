import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOutcome, renderOutcome } from "./report-back.mjs";

const plan = (over = {}) => ({
  sessionId: "s1",
  items: [
    { id: "a", note: "the toolbar is cramped", route: { destination: "appearance" } },
    { id: "b", note: "undo goes one short", route: { destination: "verify" } },
    { id: "c", note: "broken", route: { destination: "thin" } },
    { id: "d", note: "same as before", route: { destination: "duplicate" } },
  ],
  groups: [{ id: "g1", kind: "spacing", itemIds: ["a", "b"], prTitle: "Both" }],
  missingCaptures: [],
  ...over,
});

const assembly = {
  prs: [
    { id: "g1", branch: "report/g1", title: "A", itemIds: ["a"], kind: "spacing", lens: "visual-intent" },
    { id: "solo-b", branch: "report/solo-b", title: "B", itemIds: ["b"], kind: "logic" },
  ],
  queued: [{ id: "g2" }],
  deltas: [{ kind: "split", reason: "a logic change is kept on its own" }],
};

test("the outcome states proposed versus actual, and carries every reason", () => {
  const outcome = buildOutcome({ plan: plan(), assembly, now: () => 1 });
  assert.equal(outcome.sent, 4);
  assert.equal(outcome.proposedPrs, 1);
  assert.equal(outcome.actualPrs, 2);
  assert.equal(outcome.queuedPrs, 1);
  assert.equal(outcome.duplicates, 1);
  assert.equal(outcome.issues, 1);
  assert.equal(outcome.deltas.length, 1);
});

test("a report whose verification failed is recorded as lowered, not as gone", () => {
  const outcome = buildOutcome({
    plan: plan(),
    assembly,
    verified: {
      outcomes: [
        { itemId: "b", verified: false, note: "filed with both the expectation and the failed replay" },
      ],
    },
    now: () => 1,
  });
  assert.equal(outcome.lowered.length, 1);
  assert.equal(outcome.lowered[0].became, "issue");
  // And it counts as an issue, so the numbers add up for the reporter.
  assert.equal(outcome.issues, 2);
});

test("renderOutcome shows the delta when the shape changed", () => {
  const text = renderOutcome(buildOutcome({ plan: plan(), assembly, now: () => 1 }));
  assert.match(text, /proposed 1 PR\(s\) → actual 2/);
  assert.match(text, /a logic change is kept on its own/);
  assert.match(text, /1 queued/);
});

test("renderOutcome does not cry delta when nothing changed", () => {
  const text = renderOutcome(
    buildOutcome({
      plan: plan({ groups: [{ id: "g1", kind: "spacing", itemIds: ["a"], prTitle: "A" }] }),
      assembly: { prs: [assembly.prs[0]], queued: [], deltas: [] },
      now: () => 1,
    }),
  );
  assert.match(text, /1 PR\(s\)/);
  assert.ok(!text.includes("→"));
});

test("a report that travelled without its image is named", () => {
  const text = renderOutcome(
    buildOutcome({
      plan: plan({ missingCaptures: [{ id: "a", note: "the toolbar is cramped", capture: "cap-1" }] }),
      assembly,
      now: () => 1,
    }),
  );
  assert.match(text, /travelled without its image/);
});

test("a scheduled lane with no recorded result is reported, not read as a pass", () => {
  // `verified.json` is written with `outcomes: []` and filled in by whoever runs
  // the lanes, so an empty list cannot tell "nothing failed" from "nobody ran
  // it" — and reading it as the former told the reporter an unverified report
  // shipped as a clean PR.
  const plan = {
    sessionId: "s",
    items: [{ id: "a", note: "the row came back wrong", route: { destination: "verify" } }],
    groups: [],
  };
  const outcome = buildOutcome({
    plan,
    assembly: { prs: [], queued: [], deltas: [] },
    verified: { checks: [{ itemId: "a", lane: "replay-pending-steps" }], outcomes: [] },
    now: () => 0,
  });
  assert.deepEqual(outcome.pendingVerification, [{ itemId: "a", lane: "replay-pending-steps" }]);
  assert.match(renderOutcome(outcome), /no result was recorded/);
});
