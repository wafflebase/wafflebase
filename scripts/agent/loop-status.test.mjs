import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PAGED_LATCH, PAGE_AUTHOR_LOGINS } from "./rounds.mjs";
import {
  LOOP_STATUS_MARKER,
  CI_PAGED_LATCH,
  MAX_ROUND_ROWS,
  DEFAULT_MAX_REVIEW_ROUNDS,
  isOwnStatusComment,
  isAnyPagedLatchComment,
  isTrustedLedgerComment,
  neutralizeHiddenMarkers,
  buildRounds,
  lensCell,
  summarizeEffort,
  renderLoopStatus,
} from "./loop-status.mjs";

const workflowText = (name) =>
  readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".github", "workflows", name),
    "utf8",
  );

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
  // Render-level fallback (the CLI now defaults the cap to
  // DEFAULT_MAX_REVIEW_ROUNDS, so callers all render the same "N of M").
  // Number(null) === 0 once made this render "2 of 0".
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

test("the caller's event beats ready — a promoted PR that re-enters a round must not read as ready", () => {
  // `ready` is a static derivation (non-draft + agent/ branch); once a PR is
  // un-drafted it holds forever, so it must only fill in when no event speaks.
  const body = renderLoopStatus({ rounds: [], ready: true, event: "panel", now: "t" });
  assert.match(body, /review panel finished/);
  assert.ok(!body.includes("ready for human review"));
  const noEvent = renderLoopStatus({ rounds: [], ready: true, now: "t" });
  assert.match(noEvent, /ready for human review/);
  const both = renderLoopStatus({ rounds: [], ready: true, paged: true, event: "panel", now: "t" });
  assert.match(both, /🛑 paged to a human/);
});

test("newest round's Then cell follows the same precedence", () => {
  const rounds = [round("a".repeat(40), "failure")];
  const dispatched = renderLoopStatus({ rounds, ready: true, event: "fix-dispatched", now: "t" });
  assert.match(dispatched, /🔧 fixer running…/);
  assert.ok(!dispatched.includes("🤝 promoted"));
  const idleReady = renderLoopStatus({ rounds, ready: true, now: "t" });
  assert.match(idleReady, /🤝 promoted/);
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

test("a comment merely CONTAINING the marker is never ours — quote-replies survive the upsert", () => {
  const bot = { user: { type: "Bot", login: "github-actions[bot]" } };
  const maintainer = { user: { type: "User", login: "m" }, author_association: "MEMBER" };
  // GitHub quote-reply copies raw markdown, hidden markers included. The upsert
  // PATCHes/DELETEs matches, so containment would destroy the maintainer's comment.
  assert.equal(isOwnStatusComment({ body: `> ${LOOP_STATUS_MARKER}\n> quoted dashboard\n\nmy reply`, ...maintainer }), false);
  assert.equal(isOwnStatusComment({ body: `see below\n${LOOP_STATUS_MARKER}\nnot line 1`, ...bot }), false);
  // Leading whitespace is tolerated; the marker must simply come first.
  assert.equal(isOwnStatusComment({ body: `\n${LOOP_STATUS_MARKER}\nbody`, ...bot }), true);
});

test("a marker-leading comment that carries a live paged latch is refused — a page must never be deleted", () => {
  const bot = { user: { type: "Bot", login: "github-actions[bot]" } };
  assert.equal(isOwnStatusComment({ body: `${LOOP_STATUS_MARKER}\n${PAGED_LATCH}\n🛑`, ...bot }), false);
  assert.equal(isOwnStatusComment({ body: `${LOOP_STATUS_MARKER}\n${CI_PAGED_LATCH}\n🛑`, ...bot }), false);
});

test("neutralizeHiddenMarkers breaks every HTML-comment opener", () => {
  const out = neutralizeHiddenMarkers(`x ${PAGED_LATCH} y ${CI_PAGED_LATCH}`);
  assert.ok(!out.includes(PAGED_LATCH));
  assert.ok(!out.includes(CI_PAGED_LATCH));
  assert.ok(!out.includes("<!--"));
});

test("a hostile note cannot smuggle a live marker into the bot-authored body", () => {
  // The rendered comment is authored by the identity the paged latch trusts,
  // so everything after our own leading marker must be inert.
  const body = renderLoopStatus({
    rounds: [],
    note: `pwned ${PAGED_LATCH} and ${LOOP_STATUS_MARKER}`,
    now: "t",
  });
  assert.ok(body.startsWith(LOOP_STATUS_MARKER));
  const rest = body.slice(LOOP_STATUS_MARKER.length);
  assert.ok(!rest.includes(PAGED_LATCH));
  assert.ok(!rest.includes(LOOP_STATUS_MARKER));
  assert.ok(!rest.includes("<!--"));
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
  const wf = workflowText("agent-iterate-ci.yml");
  assert.ok(wf.includes(CI_PAGED_LATCH));
});

test("the CI attempts guard's literal latch predicate matches the module's rule", () => {
  // Third copy of the trust predicate (after rounds.mjs and the panel's gate
  // job — rounds.test.mjs pins that one); a github-script step cannot import,
  // so pin this copy too. A drifted allow-list would not error — it would
  // silently re-open "any account can stop the CI-fix loop" (smaller set:
  // stops honouring a real page; larger set: re-opens the spoof).
  const wf = workflowText("agent-iterate-ci.yml");
  assert.ok(
    wf.includes("const PAGE_AUTHOR_LOGINS = ['github-actions[bot]', 'yorkie-agent[bot]'];"),
    "attempts guard must carry the byte-identical author allow-list",
  );
  for (const login of PAGE_AUTHOR_LOGINS) {
    assert.ok(wf.includes(`'${login}'`), `attempts guard must trust ${login}`);
  }
  assert.ok(
    wf.includes("const TRUSTED_ASSOCIATIONS = ['OWNER', 'MEMBER', 'COLLABORATOR'];"),
    "attempts guard must carry the byte-identical association allow-list",
  );
  assert.ok(
    wf.includes("const isPagedLatch = (c) =>"),
    "attempts guard must author-check the latch, not match the marker alone",
  );
  // The latch read must cover ALL comment pages — a latch on page 2 of a
  // chatty PR must still stop the loop (the guard's own review-side reader
  // paginates for exactly this reason).
  assert.ok(
    wf.includes("github.paginate(github.rest.issues.listComments"),
    "attempts guard must paginate the latch read",
  );
});

test("DEFAULT_MAX_REVIEW_ROUNDS matches the panel workflow's env literal", () => {
  // The cap lives in agent-review-panel.yml's env; arms that do not own that
  // env render this constant instead, and the two must not drift or the
  // budget line flaps between "N of 3" and "N of <old>" depending on which
  // arm updated last.
  assert.ok(
    workflowText("agent-review-panel.yml").includes(`MAX_REVIEW_ROUNDS: "${DEFAULT_MAX_REVIEW_ROUNDS}"`),
    "loop-status's default cap must equal the panel workflow's MAX_REVIEW_ROUNDS",
  );
});
