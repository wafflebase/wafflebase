import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SCHEMA,
  LABELS,
  SOURCES,
  MISSES_PATH,
  isAgentPr,
  handoffTime,
  isHumanFollowupCommit,
  interestingFiles,
  fileClassesOf,
  classifyCodeRabbitComment,
  toMissRecord,
  candidateId,
  parseJsonl,
  serializeJsonl,
  dedupeById,
  panelVerdictAt,
  harvestPr,
  listCandidatePrs,
} from "./harvest.mjs";
import { HANDOFF_MARKER } from "./disclosure.mjs";
import { ORIGINS } from "./novelty.mjs";

const NAMES = ["agent-review-correctness", "agent-review-test-adequacy"];

// --- isAgentPr ---------------------------------------------------------------

test("isAgentPr: accepts both shapes GitHub returns for the same fact", () => {
  // REST
  assert.equal(isAgentPr({ user: { login: "yorkie-agent[bot]" }, head: { ref: "whatever" } }), true);
  // `gh --json author`
  assert.equal(isAgentPr({ author: { login: "app/yorkie-agent" }, headRefName: "whatever" }), true);
  // branch prefix alone is sufficient — covers a human re-pushing the agent's work
  assert.equal(isAgentPr({ user: { login: "harrykim8672" }, head: { ref: "agent/482-docs-viewer" } }), true);
  assert.equal(isAgentPr({ author: { login: "harrykim8672" }, headRefName: "agent/1-x" }), true);
});

test("isAgentPr: a human PR on a non-agent branch is not one; junk never throws", () => {
  assert.equal(isAgentPr({ user: { login: "harrykim8672" }, head: { ref: "harness/feedback-corpus" } }), false);
  // "agent" must be the branch NAMESPACE, not a substring anywhere in the name
  assert.equal(isAgentPr({ headRefName: "feat/user-agent-header" }), false);
  assert.equal(isAgentPr({ author: { login: "coderabbitai[bot]" }, headRefName: "x" }), false);
  for (const bad of [null, undefined, "x", 7, []]) assert.equal(isAgentPr(bad), false);
});

// --- handoffTime -------------------------------------------------------------

test("handoffTime: the FIRST marker comment wins", () => {
  const comments = [
    { body: `${HANDOFF_MARKER}\n## re-promoted`, created_at: "2026-07-26T00:00:00Z" },
    { body: "unrelated chatter", created_at: "2026-07-24T00:00:00Z" },
    { body: `${HANDOFF_MARKER}\n## Ready for human review`, created_at: "2026-07-24T15:48:28Z" },
  ];
  // A PR that is un-readied and re-promoted has two markers. The human work this
  // corpus is looking for starts at the first one.
  assert.equal(handoffTime({ comments }), "2026-07-24T15:48:28Z");
});

test("handoffTime: falls back to ready_for_review when the marker comment is missing", () => {
  // NOT belt-and-braces. mark-ready.mjs posts the hand-off comment inside a
  // try/catch AFTER flipping the PR to ready, so a genuinely promoted PR can carry
  // no marker at all — and a PR the harvester cannot see is a miss nothing can
  // recover later. On #548 the two timestamps were 3 seconds apart.
  assert.equal(
    handoffTime({ comments: [{ body: "no marker here", created_at: "2026-07-24T00:00:00Z" }], readyForReviewAt: "2026-07-24T15:48:25Z" }),
    "2026-07-24T15:48:25Z",
  );
  // marker present → it wins over the event
  assert.equal(
    handoffTime({ comments: [{ body: HANDOFF_MARKER, created_at: "2026-07-24T15:48:28Z" }], readyForReviewAt: "2026-07-24T15:48:25Z" }),
    "2026-07-24T15:48:28Z",
  );
});

test("handoffTime: null when there is no handoff at all, and on unusable timestamps", () => {
  assert.equal(handoffTime({}), null);
  assert.equal(handoffTime(), null);
  assert.equal(handoffTime({ comments: [{ body: HANDOFF_MARKER, created_at: "not a date" }] }), null);
  assert.equal(handoffTime({ comments: [{ body: HANDOFF_MARKER }] }), null);
  assert.equal(handoffTime({ readyForReviewAt: "nonsense" }), null);
  for (const bad of [null, "x", 7]) assert.equal(handoffTime({ comments: bad }), null);
});

// --- isHumanFollowupCommit ---------------------------------------------------

const HANDOFF = "2026-07-24T15:48:28Z";
const human = (over = {}) => ({
  sha: "a".repeat(40),
  parents: [{ sha: "b".repeat(40) }],
  author: { login: "harrykim8672", type: "User" },
  commit: { message: "Fix the paste guard", committer: { date: "2026-07-25T10:00:00Z" }, author: { date: "2026-07-25T10:00:00Z" } },
  ...over,
});

test("isHumanFollowupCommit: a human commit after handoff is a candidate", () => {
  assert.equal(isHumanFollowupCommit(human(), HANDOFF), true);
});

test("isHumanFollowupCommit: excludes each non-miss for its own reason", () => {
  // before the handoff — the panel had not spoken yet
  assert.equal(
    isHumanFollowupCommit(human({ commit: { message: "x", committer: { date: "2026-07-24T09:00:00Z" } } }), HANDOFF),
    false,
  );
  // a merge commit drags in every unrelated file on main and is not a fix
  assert.equal(isHumanFollowupCommit(human({ parents: [{ sha: "b" }, { sha: "c" }] }), HANDOFF), false);
  // the review-fix loop's own commits land after handoff on a re-opened round —
  // that is the panel WORKING, not the panel missing something
  assert.equal(
    isHumanFollowupCommit(
      human({ commit: { message: "Fix it\n\nAssisted-by: Claude Code (autonomous)", committer: { date: "2026-07-25T10:00:00Z" } } }),
      HANDOFF,
    ),
    false,
  );
  assert.equal(isHumanFollowupCommit(human({ author: { login: "yorkie-agent[bot]", type: "Bot" } }), HANDOFF), false);
  // exactly at the handoff instant is not "after" it
  assert.equal(isHumanFollowupCommit(human({ commit: { message: "x", committer: { date: HANDOFF } } }), HANDOFF), false);
});

test("isHumanFollowupCommit: no handoff means CANNOT CLASSIFY, never 'everything counts'", () => {
  // The dangerous reading of a missing handoff is "handed off at time zero",
  // which would make every commit on the PR a candidate and flood the corpus.
  for (const bad of [null, undefined, "", "not a date"]) {
    assert.equal(isHumanFollowupCommit(human(), bad), false);
  }
});

test("isHumanFollowupCommit: uses the COMMITTER date, and unattributed counts as human", () => {
  // A rebased commit keeps its original author date, which can predate a handoff
  // it plainly followed. Keying on author date would drop it.
  const rebased = human({
    commit: { message: "x", author: { date: "2026-07-20T00:00:00Z" }, committer: { date: "2026-07-25T10:00:00Z" } },
  });
  assert.equal(isHumanFollowupCommit(rebased, HANDOFF), true);
  // No linked GitHub account. Over-including costs a moment's curation; treating
  // unknown as Bot would drop a real miss with nothing to notice it.
  assert.equal(isHumanFollowupCommit(human({ author: null }), HANDOFF), true);
});

// --- interestingFiles / fileClassesOf ----------------------------------------

test("interestingFiles: keeps reviewable code, drops prose, policy and design-spec", () => {
  const files = [
    "packages/docs/src/view/text-editor.ts", // code
    "packages/docs/test/view/editor-read-only.test.ts", // code-adjacent
    "docs/tasks/active/20260724-x-lessons.md", // prose
    "README.md", // prose
    ".github/workflows/ci.yml", // policy
    "CLAUDE.md", // policy
    "docs/design/sharing.md", // design-spec
    "scripts/agent/lenses/correctness.md", // policy — editing the REVIEWER, a different event
  ];
  assert.deepEqual(interestingFiles(files), [
    "packages/docs/src/view/text-editor.ts",
    "packages/docs/test/view/editor-read-only.test.ts",
  ]);
});

test("interestingFiles: accepts GitHub's {filename} objects, dedupes, sorts, never throws", () => {
  assert.deepEqual(
    interestingFiles([{ filename: "b.ts" }, { path: "a.ts" }, "b.ts", "", null, { filename: "" }]),
    ["a.ts", "b.ts"],
  );
  for (const bad of [null, undefined, "x", 7]) assert.deepEqual(interestingFiles(bad), []);
});

test("fileClassesOf: a fix plus its regression test keeps BOTH classes", () => {
  // Collapsing this to one scalar ("mixed") would lose the slice the corpus is for.
  assert.deepEqual(
    fileClassesOf(["packages/docs/src/view/text-editor.ts", "packages/docs/test/view/editor-read-only.test.ts"]),
    ["code", "code-adjacent"],
  );
  assert.deepEqual(fileClassesOf([]), []);
});

// --- classifyCodeRabbitComment -----------------------------------------------

// Verbatim header shapes taken from this repository's own PRs, not from
// CodeRabbit's upstream docs. The plan for this module specified the upstream
// vocabulary ("Potential issue" / "Refactor suggestion" / "Nitpick"), which has
// never appeared here — a classifier keyed on it would match zero comments and
// report an empty corpus as a clean bill of health.
const CR_MAJOR_CORRECTNESS =
  "_🎯 Functional Correctness_ | _🟠 Major_ | _🏗️ Heavy lift_\n\n**Guard public mutation APIs at the read-only boundary.**\n\nThis flag only protects event handlers.";
const CR_MINOR_MAINTAIN =
  "_📐 Maintainability & Code Quality_ | _🟡 Minor_ | _⚡ Quick win_\n\n**Restore the global test shims after each test.**\n\nInstallCanvasShim replaces…";
const CR_MAJOR_SECURITY =
  "_🔒 Security & Privacy_ | _🟠 Major_ | _⚡ Quick win_\n\n**Missing `persist-credentials: false`.**\n\nThe checkout leaves a token on disk.";
const CR_MAJOR_STABILITY =
  "_🩺 Stability & Availability_ | _🟠 Major_ | _⚡ Quick win_\n\n**Missing `if: always()`.**\n\nThe step is skipped on failure.";
const CR_REPLY = "`@dlgpdmsly2`, thanks for the thorough fix and verification. The revised distinction is correct.";

test("classifyCodeRabbitComment: reads the header this repo actually emits", () => {
  assert.deepEqual(classifyCodeRabbitComment(CR_MAJOR_CORRECTNESS), {
    category: "functional correctness",
    severity: "major",
    lens: "correctness",
    summary: "Guard public mutation APIs at the read-only boundary.",
  });
  assert.equal(classifyCodeRabbitComment(CR_MAJOR_SECURITY).lens, "security");
});

test("classifyCodeRabbitComment: only unambiguous categories get a lens", () => {
  // Stability & Availability plausibly belongs to correctness OR blast-radius. A
  // guessed mapping would corrupt the per-lens miss count the corpus exists to
  // produce, so it is left blank for the curator.
  const stability = classifyCodeRabbitComment(CR_MAJOR_STABILITY);
  assert.equal(stability.severity, "major");
  assert.equal(stability.lens, "");
});

test("classifyCodeRabbitComment: non-findings are null, NOT default-severity findings", () => {
  // This is why severity is read only AFTER a header matched. normalizeSeverity
  // maps anything unknown to `major` (fail-safe for a gate), so running a threaded
  // reply through it would file every "thanks for the fix" as a blocking candidate
  // and bury the real ones.
  assert.equal(classifyCodeRabbitComment(CR_REPLY), null);
  assert.equal(classifyCodeRabbitComment("<!-- walkthrough --> ## Summary by CodeRabbit"), null);
  for (const bad of [null, undefined, "", 7, {}]) assert.equal(classifyCodeRabbitComment(bad), null);
});

test("classifyCodeRabbitComment: non-blocking severities are dropped", () => {
  // The corpus measures the GATE. A minor maintainability note our panel also did
  // not raise is not a gate failure.
  assert.equal(classifyCodeRabbitComment(CR_MINOR_MAINTAIN), null);
  assert.equal(classifyCodeRabbitComment("_🎯 Functional Correctness_ | _⚪ Nit_ | _⚡ Quick win_\n\n**x**"), null);
});

// --- toMissRecord ------------------------------------------------------------

const FIELD_ORDER = [
  "schema", "id", "label", "source", "pr", "handoffAt", "evidence", "files", "fileClasses",
  "lens", "severity", "origin", "summary", "panelSaw", "verifiedBy", "notes",
];

test("toMissRecord: field order is stable, because the corpus is read in diffs", () => {
  assert.deepEqual(Object.keys(toMissRecord({})), FIELD_ORDER);
  assert.deepEqual(Object.keys(toMissRecord({ id: "x", pr: 1, files: ["a.ts"] })), FIELD_ORDER);
  assert.deepEqual(Object.keys(toMissRecord({}).evidence), ["commitSha", "commentId", "url"]);
  assert.deepEqual(Object.keys(toMissRecord({}).panelSaw), ["reviewedSha", "conclusion", "blockingFindings"]);
});

test("toMissRecord: junk coerces to safe defaults rather than throwing", () => {
  const r = toMissRecord({ label: "wat", source: "wat", origin: "wat", pr: "nope", files: "nope", panelSaw: 7 });
  assert.equal(r.schema, SCHEMA);
  assert.equal(r.label, "miss");
  assert.equal(r.source, "manual");
  assert.equal(r.origin, "unknown");
  assert.equal(r.pr, 0);
  assert.deepEqual(r.files, []);
  assert.deepEqual(r.panelSaw, { reviewedSha: "", conclusion: "", blockingFindings: 0 });
  for (const bad of [null, undefined, "x", 7]) assert.equal(toMissRecord(bad).schema, SCHEMA);
});

test("toMissRecord: an empty severity stays empty; a stated one is normalized", () => {
  // normalizeSeverity turns unknown into `major`, which is right for a gate and
  // wrong for "the curator has not decided yet". Empty must survive as empty.
  assert.equal(toMissRecord({}).severity, "");
  assert.equal(toMissRecord({ severity: "Major" }).severity, "major");
  assert.equal(toMissRecord({ severity: "showstopper" }).severity, "major");
});

test("candidateId: stable, so re-harvesting the same window is idempotent", () => {
  assert.equal(candidateId("human-fix", 548, "abc"), "human-fix:548:abc");
  assert.equal(candidateId("coderabbit", "548", 3650043440), "coderabbit:548:3650043440");
});

// --- JSONL -------------------------------------------------------------------

test("parseJsonl: a corrupt line is REPORTED, not swallowed", () => {
  // Silently dropping a curated record makes every measurement taken against the
  // corpus quietly wrong — strictly worse than a loud tool.
  const logged = [];
  const { records, bad } = parseJsonl('{"id":"a"}\n{oops\n\n{"id":"b"}\n', { log: (m) => logged.push(m) });
  assert.deepEqual(records, [{ id: "a" }, { id: "b" }]);
  assert.equal(bad, 1);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /line 2/);
});

test("parseJsonl: blank input is empty; valid JSON that is not a record is BAD", () => {
  for (const empty of [null, undefined, "", "\n\n\n"]) {
    assert.deepEqual(parseJsonl(empty), { records: [], bad: 0 });
  }
  // `7`, `"x"` and `[…]` are all valid JSON and none of them is a record. Keeping
  // them would put a number in the corpus for every consumer to defend against.
  assert.deepEqual(parseJsonl('7\n"x"\n[]\nnull'), { records: [], bad: 4 });
  assert.deepEqual(parseJsonl(7), { records: [], bad: 1 });
});

test("serializeJsonl: round-trips through parseJsonl; empty yields no stray newline", () => {
  const recs = [toMissRecord({ id: "a", pr: 1 }), toMissRecord({ id: "b", pr: 2 })];
  assert.deepEqual(parseJsonl(serializeJsonl(recs)).records, recs);
  assert.equal(serializeJsonl([]), "");
  assert.equal(serializeJsonl([null, 7, "x"]), "");
  assert.equal(serializeJsonl(null), "");
});

test("dedupeById: FIRST wins, so a re-harvest cannot blank a human's verifiedBy", () => {
  const curated = toMissRecord({ id: "coderabbit:548:1", verifiedBy: "harrykim8672", notes: "confirmed" });
  const candidate = toMissRecord({ id: "coderabbit:548:1" });
  assert.equal(candidate.verifiedBy, "");
  const out = dedupeById([curated, candidate]);
  assert.equal(out.length, 1);
  assert.equal(out[0].verifiedBy, "harrykim8672");
});

test("dedupeById: keeps id-less rows, because hand-written curation has no id", () => {
  const rows = [{ id: "" }, { id: "" }, { id: "a" }, { id: "a" }];
  assert.deepEqual(dedupeById(rows), [{ id: "" }, { id: "" }, { id: "a" }]);
  for (const bad of [null, undefined, "x", 7]) assert.deepEqual(dedupeById(bad), []);
});

// --- panelVerdictAt ----------------------------------------------------------

test("panelVerdictAt: one failing lens means the panel did NOT let it through", () => {
  const runs = new Map([
    ["agent-review-correctness", { conclusion: "success", output: { text: "[]" } }],
    ["agent-review-test-adequacy", { conclusion: "failure", output: { text: '[{"severity":"major","summary":"vacuous test"}]' } }],
  ]);
  assert.deepEqual(panelVerdictAt(runs), { reviewedSha: "", conclusion: "failure", blockingFindings: 1 });
});

test("panelVerdictAt: reviewedSha comes from external_id, not the commit it hangs off", () => {
  // On a narrowed round the run is attached to the head commit while the verdict
  // covers only the delta, so the two genuinely differ.
  const sha = "c".repeat(40);
  const runs = new Map([
    ["agent-review-correctness", { conclusion: "success", external_id: JSON.stringify({ v: 1, reviewed: sha, base: "", since: "", mode: "incremental" }) }],
  ]);
  assert.equal(panelVerdictAt(runs).reviewedSha, sha);
  // Routed through parseReviewState, so an ill-formed state is REJECTED rather
  // than half-read. A corpus field that is wrong is worse than one that is empty.
  const rejected = [
    "{oops", // not JSON
    JSON.stringify({ v: 1, reviewed: "main", mode: "full" }), // not a 40-hex sha
    JSON.stringify({ v: 99, reviewed: sha, mode: "full" }), // unknown version
    JSON.stringify({ v: 1, reviewed: sha, mode: "sideways" }), // unknown mode
  ];
  for (const external_id of rejected) {
    assert.equal(panelVerdictAt(new Map([["agent-review-correctness", { conclusion: "success", external_id }]])).reviewedSha, "");
  }
});

test("panelVerdictAt: no lens runs is '', which is not the same as success", () => {
  assert.deepEqual(panelVerdictAt(new Map()), { reviewedSha: "", conclusion: "", blockingFindings: 0 });
  for (const bad of [null, undefined, {}]) assert.equal(panelVerdictAt(bad).conclusion, "");
});

// --- harvestPr (injected api) ------------------------------------------------

const SHA_BASE = "1".repeat(40);
const SHA_FIX = "2".repeat(40);

function fakeApi(overrides = {}) {
  const routes = {
    [`repos/{owner}/{repo}/pulls/548`]: { user: { login: "yorkie-agent[bot]" }, head: { ref: "agent/482-x" } },
    [`repos/{owner}/{repo}/issues/548/comments?per_page=100`]: [{ body: HANDOFF_MARKER, created_at: HANDOFF }],
    [`repos/{owner}/{repo}/issues/548/timeline?per_page=100`]: [],
    [`repos/{owner}/{repo}/pulls/548/commits?per_page=100`]: [
      { sha: SHA_BASE, parents: [{ sha: "0" }], author: { type: "Bot" }, commit: { message: "agent work", committer: { date: "2026-07-24T15:00:00Z" } } },
      { sha: SHA_FIX, parents: [{ sha: SHA_BASE }], author: { login: "harrykim8672", type: "User" }, html_url: "https://x/commit", commit: { message: "Guard EditorAPI.paste()\n\nmore", committer: { date: "2026-07-25T10:00:00Z" } } },
    ],
    [`repos/{owner}/{repo}/commits/${SHA_FIX}`]: { files: [{ filename: "packages/docs/src/view/text-editor.ts" }, { filename: "docs/tasks/active/x-lessons.md" }] },
    [`repos/{owner}/{repo}/commits/${SHA_BASE}/check-runs?per_page=100`]: [{ check_runs: [{ id: 1, name: "agent-review-correctness", app: { slug: "github-actions" }, status: "completed", conclusion: "success", completed_at: "2026-07-24T15:40:00Z", output: { text: "[]" } }] }],
    [`repos/{owner}/{repo}/commits/${SHA_FIX}/check-runs?per_page=100`]: [{ check_runs: [] }],
    [`repos/{owner}/{repo}/check-runs/1`]: { id: 1, name: "agent-review-correctness", conclusion: "success", output: { text: "[]" } },
    [`repos/{owner}/{repo}/pulls/548/comments?per_page=100`]: [
      { id: 3650043440, user: { login: "coderabbitai[bot]" }, path: "packages/docs/src/view/text-editor.ts", original_commit_id: SHA_BASE, html_url: "https://x/discussion", body: CR_MAJOR_CORRECTNESS },
      { id: 2, user: { login: "coderabbitai[bot]" }, path: "packages/docs/src/view/text-editor.ts", body: CR_REPLY },
      { id: 3, user: { login: "harrykim8672" }, path: "packages/docs/src/view/text-editor.ts", body: CR_MAJOR_CORRECTNESS },
    ],
    ...overrides,
  };
  return (argv) => {
    const p = argv.find((a) => typeof a === "string" && a.startsWith("repos/"));
    if (p in routes) {
      const v = routes[p];
      if (v instanceof Error) throw v;
      return v;
    }
    throw new Error(`unrouted: ${p}`);
  };
}

test("harvestPr: proposes both signatures, and only from reviewable code", () => {
  const { records, skipped } = harvestPr(548, { api: fakeApi(), log: () => {}, names: NAMES });
  assert.equal(skipped, "");
  assert.deepEqual(records.map((r) => r.id).sort(), ["coderabbit:548:3650043440", "human-fix:548:" + SHA_FIX]);

  const fix = records.find((r) => r.source === "human-fix");
  // the lessons doc in the same commit is dropped; the source file is kept
  assert.deepEqual(fix.files, ["packages/docs/src/view/text-editor.ts"]);
  assert.deepEqual(fix.fileClasses, ["code"]);
  assert.equal(fix.summary, "Guard EditorAPI.paste()"); // first line only
  assert.equal(fix.handoffAt, HANDOFF);
  // the verdict that LET THE PR THROUGH — the runs on the head commit at handoff
  assert.deepEqual(fix.panelSaw, { reviewedSha: SHA_BASE, conclusion: "success", blockingFindings: 0 });

  const cr = records.find((r) => r.source === "coderabbit");
  assert.equal(cr.lens, "correctness");
  assert.equal(cr.severity, "major");
  assert.equal(cr.evidence.commentId, "3650043440");
});

test("harvestPr: EVERY harvested candidate is unverified", () => {
  // The one field that decides whether a record counts. The harvester must not be
  // able to set it, even by accident — an auto-harvested, auto-trusted corpus is a
  // corpus of noise, and harvester noise is systematic.
  const { records } = harvestPr(548, { api: fakeApi(), log: () => {}, names: NAMES });
  assert.ok(records.length > 0);
  for (const r of records) assert.equal(r.verifiedBy, "");
});

test("harvestPr: ignores CodeRabbit replies and non-CodeRabbit authors", () => {
  const { records } = harvestPr(548, { api: fakeApi(), log: () => {}, names: NAMES });
  // comment 2 is a threaded reply; comment 3 quotes a CodeRabbit header but is
  // posted by a human, which is a review conversation and not a second opinion
  assert.equal(records.filter((r) => r.source === "coderabbit").length, 1);
});

test("harvestPr: the CodeRabbit login is matched EXACTLY, not by prefix", () => {
  // Anyone can register `coderabbitai-x` and comment on a public PR. Curation is
  // the real defence, but the matcher deciding whose text gets archived into the
  // corpus should not be the loose one.
  const { records } = harvestPr(548, {
    api: fakeApi({
      "repos/{owner}/{repo}/pulls/548/comments?per_page=100": [
        { id: 9, user: { login: "coderabbitai-impostor" }, path: "packages/docs/src/view/text-editor.ts", body: CR_MAJOR_CORRECTNESS },
        { id: 10, user: { login: "coderabbitai[bot]" }, path: "packages/docs/src/view/text-editor.ts", body: CR_MAJOR_SECURITY },
      ],
    }),
    log: () => {},
    names: NAMES,
  });
  assert.deepEqual(records.filter((r) => r.source === "coderabbit").map((r) => r.evidence.commentId), ["10"]);
});

test("harvestPr: every commit after the handoff leaves panelSaw EMPTY, not wrong", () => {
  // A force-push or rebase after promotion rewrites committer dates, so no commit
  // predates the handoff. The old fallback took the PR's LAST commit — one the
  // panel saw only after the human's fix — and recorded its verdict as what let
  // the PR through. An empty panelSaw says "we could not establish it", which is
  // true; a post-handoff sha is a wrong measurement that reads as a right one.
  const { records } = harvestPr(548, {
    api: fakeApi({
      "repos/{owner}/{repo}/pulls/548/commits?per_page=100": [
        { sha: SHA_FIX, parents: [{ sha: SHA_BASE }], author: { login: "harrykim8672", type: "User" }, commit: { message: "Late fix", committer: { date: "2026-07-25T10:00:00Z" } } },
      ],
    }),
    log: () => {},
    names: NAMES,
  });
  const fix = records.find((r) => r.source === "human-fix");
  assert.ok(fix, "the candidate is still proposed");
  assert.deepEqual(fix.panelSaw, { reviewedSha: "", conclusion: "", blockingFindings: 0 });
});

test("harvestPr: 'could not look' never reads the same as 'nothing found'", () => {
  const notAgent = harvestPr(548, {
    api: fakeApi({ "repos/{owner}/{repo}/pulls/548": { user: { login: "harrykim8672" }, head: { ref: "feat/x" } } }),
    log: () => {},
    names: NAMES,
  });
  assert.deepEqual(notAgent.records, []);
  assert.match(notAgent.skipped, /not an agent PR/);

  const noHandoff = harvestPr(548, {
    api: fakeApi({ "repos/{owner}/{repo}/issues/548/comments?per_page=100": [] }),
    log: () => {},
    names: NAMES,
  });
  assert.deepEqual(noHandoff.records, []);
  assert.match(noHandoff.skipped, /no hand-off marker/);

  const unreadable = harvestPr(548, {
    api: fakeApi({ "repos/{owner}/{repo}/pulls/548": new Error("502") }),
    log: () => {},
    names: NAMES,
  });
  assert.match(unreadable.skipped, /could not read PR #548/);
});

test("harvestPr: one failed sub-request costs its own candidates, not the PR's", () => {
  // Review comments unreadable → the human-fix candidate must still be proposed.
  const { records } = harvestPr(548, {
    api: fakeApi({ "repos/{owner}/{repo}/pulls/548/comments?per_page=100": new Error("502") }),
    log: () => {},
    names: NAMES,
  });
  assert.deepEqual(records.map((r) => r.source), ["human-fix"]);

  // Check runs unreadable → candidates still land, with panelSaw honestly unknown
  // rather than fabricated as "success".
  const noRuns = harvestPr(548, {
    api: fakeApi({ [`repos/{owner}/{repo}/commits/${SHA_BASE}/check-runs?per_page=100`]: new Error("502") }),
    log: () => {},
    names: NAMES,
  });
  const fix = noRuns.records.find((r) => r.source === "human-fix");
  assert.equal(fix.panelSaw.conclusion, "");
  assert.equal(fix.panelSaw.reviewedSha, SHA_BASE);
});

// --- listCandidatePrs --------------------------------------------------------

test("listCandidatePrs: a capped list is REPORTED, never passed off as complete", () => {
  // "We found no misses in that window" is exactly the conclusion this corpus must
  // never reach by accident, and a silently truncated PR list produces it.
  const full = Array.from({ length: 200 }, (_, i) => ({ number: i + 1, headRefName: "agent/x", author: { login: "x" } }));
  const logged = [];
  assert.equal(listCandidatePrs({ api: () => full, log: (m) => logged.push(m) }).length, 200);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /cap.*NOT examined/s);

  // Under the cap, nothing is said.
  const quiet = [];
  listCandidatePrs({ api: () => full.slice(0, 199), log: (m) => quiet.push(m) });
  assert.deepEqual(quiet, []);
});

test("listCandidatePrs: --since goes to GitHub's search, and non-agent PRs drop out", () => {
  let seen = null;
  const api = (argv) => {
    seen = argv;
    return [
      { number: 1, headRefName: "agent/1-x", author: { login: "harrykim8672" } },
      { number: 2, headRefName: "feat/y", author: { login: "harrykim8672" } },
      { number: 3, headRefName: "feat/z", author: { login: "app/yorkie-agent" } },
    ];
  };
  assert.deepEqual(listCandidatePrs({ since: "2026-07-01", api, log: () => {} }), [1, 3]);
  assert.ok(seen.includes("--search") && seen.includes("merged:>=2026-07-01"));
  // No --since → no search term at all, rather than an empty one.
  listCandidatePrs({ api, log: () => {} });
  assert.ok(!seen.includes("--search"));
  for (const junk of [null, "x", 7, {}]) {
    assert.deepEqual(listCandidatePrs({ api: () => junk, log: () => {} }), []);
  }
});

// --- the corpus file itself --------------------------------------------------

test("misses.jsonl: every line parses, and every record is well-formed", () => {
  // The data file is as load-bearing as the code that reads it: a record that
  // silently fails to parse is a measurement quietly taken against a smaller
  // corpus than the one people believe they have.
  const { records, bad } = parseJsonl(readFileSync(MISSES_PATH, "utf8"), { log: (m) => assert.fail(m) });
  assert.equal(bad, 0);
  assert.ok(records.length >= 2, "the backfilled misses must survive");
  for (const r of records) {
    assert.deepEqual(Object.keys(r), FIELD_ORDER, `field order drifted on ${r.id}`);
    assert.equal(r.schema, SCHEMA);
    assert.ok(LABELS.has(r.label), `unknown label on ${r.id}`);
    assert.ok(SOURCES.has(r.source), `unknown source on ${r.id}`);
    assert.ok(Number.isInteger(r.pr) && r.pr > 0, `missing PR number on ${r.id}`);
    assert.ok(r.summary !== "", `a record with no summary teaches nothing (${r.id})`);
    assert.ok(r.evidence.url !== "", `a record with no evidence cannot be curated (${r.id})`);
    // origin and fileClasses are the two SLICING fields. A hand-written record is
    // not built by toMissRecord, so nothing else stops them drifting — and a wrong
    // slice is worse than a missing one, because it still produces a number.
    assert.ok(ORIGINS.includes(r.origin), `unknown origin "${r.origin}" on ${r.id}`);
    assert.deepEqual(r.fileClasses, fileClassesOf(r.files), `fileClasses drifted from files on ${r.id}`);
  }
  // Ids are what dedupe keys on; a duplicate would double-count forever.
  assert.equal(new Set(records.map((r) => r.id)).size, records.length);
});
