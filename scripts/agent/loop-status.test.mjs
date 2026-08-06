import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PAGED_LATCH } from "./rounds.mjs";
import {
  LOOP_STATUS_MARKER,
  CI_PAGED_LATCH,
  MAX_ROUND_ROWS,
  isOwnStatusComment,
  isAnyPagedLatchComment,
  isTrustedLedgerComment,
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

test("effort totals sum sessions, cost and duration", () => {
  const e = summarizeEffort([
    { kind: "implement", costUsd: 10, durationMs: 60_000 },
    { kind: "review", costUsd: 5, durationMs: 30_000 },
    { kind: "review", costUsd: 5, durationMs: 30_000 },
    null,
  ]);
  assert.equal(e.sessions, 3);
  assert.equal(e.totalUsd, 20);
  assert.equal(e.totalMs, 120_000);
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

test("an unknown round cap renders the count alone — never 'of 0', never dropped", () => {
  // maxRounds is null when the caller does not own MAX_REVIEW_ROUNDS (the
  // CI-arm call sites). Number(null) === 0 once made this render "2 of 0".
  const body = renderLoopStatus({ rounds: [], failedRounds: 2, maxRounds: null, now: "t" });
  const line = body.split("\n").find((l) => l.includes("Fix rounds used"));
  assert.equal(line, "**Fix rounds used:** 2");
  assert.ok(!body.includes("of 0"));
});

test("an unmeasured round count drops the budget line entirely", () => {
  const body = renderLoopStatus({ rounds: [], failedRounds: null, maxRounds: 3, now: "t" });
  assert.ok(!body.includes("Fix rounds used"));
});

test("a trusted paged latch beats the event headline", () => {
  const body = renderLoopStatus({ rounds: [], paged: true, event: "fix-dispatched", now: "t" });
  assert.match(body, /🛑 paged to a human/);
  assert.ok(!body.includes("fix round in progress"));
});

test("ready beats the event headline but not paged", () => {
  const body = renderLoopStatus({ rounds: [], ready: true, event: "panel", now: "t" });
  assert.match(body, /ready for human review/);
  const both = renderLoopStatus({ rounds: [], ready: true, paged: true, now: "t" });
  assert.match(both, /🛑 paged to a human/);
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

test("effort renders numeric totals only — no ledger strings reach the body", () => {
  // Records are attacker-shaped JSON when the author gate fails; the render
  // must never interpolate a record string (kind included) into the body.
  const body = renderLoopStatus({
    rounds: [],
    effort: summarizeEffort([{ kind: "<!-- agent-review-paged -->", costUsd: 1, durationMs: 60000 }]),
    now: "t",
  });
  assert.match(body, /\*\*Agent effort so far:\*\* \$1\.00/);
  assert.ok(!body.includes("agent-review-paged"));
});

// --- trust predicates ------------------------------------------------------------

test("marker alone is not enough on a public repo (status upsert)", () => {
  const body = `${LOOP_STATUS_MARKER}\nhello`;
  assert.equal(isOwnStatusComment({ body, user: { type: "User", login: "rando" }, author_association: "NONE" }), false);
  assert.equal(isOwnStatusComment({ body, user: { type: "Bot", login: "github-actions[bot]" } }), true);
  assert.equal(isOwnStatusComment({ body, user: { type: "Bot", login: "yorkie-agent[bot]" } }), true);
  assert.equal(isOwnStatusComment({ body, user: { type: "User", login: "maintainer" }, author_association: "MEMBER" }), true);
  assert.equal(isOwnStatusComment({ body: "no marker", user: { type: "Bot", login: "github-actions[bot]" } }), false);
});

test("paged projection recognises BOTH arms' latches, author-checked", () => {
  const bot = { user: { type: "Bot", login: "github-actions[bot]" } };
  const rando = { user: { type: "User", login: "rando" }, author_association: "NONE" };
  assert.equal(isAnyPagedLatchComment({ body: PAGED_LATCH, ...bot }), true);
  assert.equal(isAnyPagedLatchComment({ body: CI_PAGED_LATCH, ...bot }), true);
  assert.equal(isAnyPagedLatchComment({ body: PAGED_LATCH, ...rando }), false);
  assert.equal(isAnyPagedLatchComment({ body: CI_PAGED_LATCH, ...rando }), false);
  assert.equal(isAnyPagedLatchComment({ body: "no latch here", ...bot }), false);
});

test("metric-ledger records are only read from trusted authors", () => {
  // Without this gate, a stranger's fake <!-- agent-metric --> comment feeds
  // the totals — and worse, once fed anything string-shaped it could smuggle
  // trusted markers into a bot-authored comment.
  assert.equal(isTrustedLedgerComment({ user: { type: "Bot", login: "github-actions[bot]" } }), true);
  assert.equal(isTrustedLedgerComment({ user: { type: "Bot", login: "yorkie-agent[bot]" } }), true);
  assert.equal(isTrustedLedgerComment({ user: { type: "User", login: "m" }, author_association: "COLLABORATOR" }), true);
  assert.equal(isTrustedLedgerComment({ user: { type: "User", login: "rando" }, author_association: "NONE" }), false);
  assert.equal(isTrustedLedgerComment({ user: { type: "Bot", login: "evil[bot]" } }), false);
});

// --- literal-copy pins ----------------------------------------------------------

test("CI_PAGED_LATCH matches the literal agent-iterate-ci.yml writes", () => {
  // Same discipline as rounds.test.mjs's PAGED_LATCH pin: the workflow cannot
  // import this module, so it carries the literal; a drifted copy would not
  // error, it would silently stop the paged projection from seeing CI pages.
  const wf = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".github", "workflows", "agent-iterate-ci.yml"),
    "utf8",
  );
  assert.ok(wf.includes(CI_PAGED_LATCH));
});
