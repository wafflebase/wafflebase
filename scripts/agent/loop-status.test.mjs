import test from "node:test";
import assert from "node:assert/strict";
import {
  LOOP_STATUS_MARKER,
  MAX_ROUND_ROWS,
  isOwnStatusComment,
  buildRounds,
  lensCell,
  summarizeEffort,
  renderLoopStatus,
} from "./loop-status.mjs";

const LENSES = ["agent-review-correctness", "agent-review-security"];

const run = (name, conclusion, extra = {}) => ({
  name,
  app: { slug: "github-actions" },
  status: "completed",
  conclusion,
  completed_at: "2026-08-06T10:00:00Z",
  ...extra,
});

// --- buildRounds ---------------------------------------------------------------

test("a commit with no lens runs is not a round", () => {
  const rounds = buildRounds(
    [{ sha: "a".repeat(40), checkRuns: [run("verify-self (22.x)", "success")] }],
    LENSES,
  );
  assert.equal(rounds.length, 0);
});

test("latest run per lens wins (a re-run supersedes)", () => {
  const rounds = buildRounds(
    [
      {
        sha: "a".repeat(40),
        checkRuns: [
          run("agent-review-correctness", "failure", { completed_at: "2026-08-06T10:00:00Z" }),
          run("agent-review-correctness", "success", { completed_at: "2026-08-06T11:00:00Z" }),
        ],
      },
    ],
    LENSES,
  );
  assert.equal(rounds.length, 1);
  assert.deepEqual(rounds[0].lenses.map((l) => l.conclusion), ["success"]);
});

test("a same-named check from another app never counts", () => {
  const rounds = buildRounds(
    [
      {
        sha: "a".repeat(40),
        checkRuns: [{ name: "agent-review-correctness", app: { slug: "other-app" }, status: "completed", conclusion: "failure" }],
      },
    ],
    LENSES,
  );
  assert.equal(rounds.length, 0);
});

test("non-lens checks summarize to failure > pending > success", () => {
  const mk = (others) =>
    buildRounds(
      [{ sha: "a".repeat(40), checkRuns: [run("agent-review-security", "success"), ...others] }],
      LENSES,
    )[0].checks;
  assert.equal(mk([run("ci-job", "success")]), "success");
  assert.equal(mk([run("ci-job", "success"), { ...run("ci-2", null), status: "in_progress" }]), "pending");
  assert.equal(mk([run("ci-job", "failure"), { ...run("ci-2", null), status: "in_progress" }]), "failure");
  assert.equal(mk([]), "none");
});

// --- lensCell ------------------------------------------------------------------

test("lens cell names failing lenses and counts the rest", () => {
  assert.equal(
    lensCell([
      { lens: "correctness", status: "completed", conclusion: "failure" },
      { lens: "security", status: "completed", conclusion: "success" },
    ]),
    "❌ correctness (1 ✅)",
  );
  assert.equal(
    lensCell([
      { lens: "correctness", status: "completed", conclusion: "success" },
      { lens: "security", status: "completed", conclusion: "success" },
    ]),
    "✅ all 2",
  );
  assert.match(lensCell([{ lens: "correctness", status: "in_progress", conclusion: null }]), /⏳ running/);
});

// --- summarizeEffort -----------------------------------------------------------

test("effort totals sum by kind and overall", () => {
  const e = summarizeEffort([
    { kind: "implement", costUsd: 10, durationMs: 60_000 },
    { kind: "review", costUsd: 5, durationMs: 30_000 },
    { kind: "review", costUsd: 5, durationMs: 30_000 },
    null,
  ]);
  assert.equal(e.sessions, 3);
  assert.equal(e.totalUsd, 20);
  assert.equal(e.byKind.get("review").n, 2);
  assert.equal(e.byKind.get("review").usd, 10);
});

// --- renderLoopStatus ----------------------------------------------------------

const round = (sha, conclusion) => ({
  sha,
  checks: "success",
  lenses: [{ lens: "correctness", status: "completed", conclusion }],
});

test("body starts with the marker and shows rounds newest-first", () => {
  const body = renderLoopStatus({
    rounds: [round("a".repeat(40), "failure"), round("b".repeat(40), "success")],
    failedRounds: 1,
    maxRounds: 3,
    event: "panel",
    now: "2026-08-06T12:00Z",
  });
  assert.ok(body.startsWith(LOOP_STATUS_MARKER));
  assert.match(body, /\*\*Fix rounds used:\*\* 1 of 3/);
  const rowB = body.indexOf("`bbbbbbbbb`");
  const rowA = body.indexOf("`aaaaaaaaa`");
  assert.ok(rowB !== -1 && rowA !== -1 && rowB < rowA, "newest round renders first");
  // The older round links forward to the commit that superseded it.
  assert.match(body, /→ `bbbbbbbbb`/);
});

test("a trusted paged latch beats the event headline", () => {
  const body = renderLoopStatus({ rounds: [], paged: true, event: "fix-dispatched", now: "t" });
  assert.match(body, /🛑 paged to a human/);
  assert.ok(!body.includes("fix round in progress"));
});

test("ready (non-draft) beats the event headline but not paged", () => {
  const body = renderLoopStatus({ rounds: [], ready: true, event: "panel", now: "t" });
  assert.match(body, /ready for human review/);
});

test("older rounds beyond the cap are omitted with a note", () => {
  const rounds = Array.from({ length: MAX_ROUND_ROWS + 4 }, (_, i) =>
    round(String(i).padStart(40, "0"), "success"),
  );
  const body = renderLoopStatus({ rounds, now: "t" });
  assert.match(body, /4 earlier round\(s\) omitted/);
});

test("note is flattened to one line and bounded", () => {
  const body = renderLoopStatus({ rounds: [], note: "line1\nline2", now: "t" });
  assert.match(body, /\*\*Latest:\*\* line1 line2/);
});

// --- isOwnStatusComment ---------------------------------------------------------

test("marker alone is not enough on a public repo", () => {
  const body = `${LOOP_STATUS_MARKER}\nhello`;
  assert.equal(isOwnStatusComment({ body, user: { type: "User", login: "rando" }, author_association: "NONE" }), false);
  assert.equal(isOwnStatusComment({ body, user: { type: "Bot", login: "github-actions[bot]" } }), true);
  assert.equal(isOwnStatusComment({ body, user: { type: "Bot", login: "yorkie-agent[bot]" } }), true);
  assert.equal(isOwnStatusComment({ body, user: { type: "User", login: "maintainer" }, author_association: "MEMBER" }), true);
  assert.equal(isOwnStatusComment({ body: "no marker", user: { type: "Bot", login: "github-actions[bot]" } }), false);
});
