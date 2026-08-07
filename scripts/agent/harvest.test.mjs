import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderSummaryMd, BLOCKING, normalizeSeverity } from "./severity.mjs";
import {
  SCHEMA,
  LABELS,
  SOURCES,
  MISSES_PATH,
  isAgentPr,
  markerHandoffAt,
  panelApprovedAt,
  commitIndex,
  panelRounds,
  roundsUpTo,
  commentRounds,
  panelRoundAt,
  isHumanFollowupCommit,
  interestingFiles,
  fileClassesOf,
  classifyCodeRabbitComment,
  classifyCodeRabbitHeader,
  parseCodeRabbitReview,
  codeRabbitDetail,
  attributeToPanel,
  parsePanelComment,
  panelFindingsFromComments,
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

// --- markerHandoffAt / panelApprovedAt ---------------------------------------

const round = (over = {}) => ({
  sha: "a".repeat(40), index: 0, conclusion: "success", reviewedSha: "", completedAt: "2026-07-24T15:40:00Z", ...over,
});

test("markerHandoffAt: the FIRST marker comment wins", () => {
  const comments = [
    { body: `${HANDOFF_MARKER}\n## re-promoted`, created_at: "2026-07-26T00:00:00Z" },
    { body: "unrelated chatter", created_at: "2026-07-24T00:00:00Z" },
    { body: `${HANDOFF_MARKER}\n## Ready for human review`, created_at: "2026-07-24T15:48:28Z" },
  ];
  // A PR that is un-readied and re-promoted has two markers. The human work this
  // corpus is looking for starts at the first one.
  assert.equal(markerHandoffAt(comments), "2026-07-24T15:48:28Z");
});

test("markerHandoffAt: null with no usable marker; junk never throws", () => {
  assert.equal(markerHandoffAt([]), null);
  assert.equal(markerHandoffAt(), null);
  assert.equal(markerHandoffAt([{ body: HANDOFF_MARKER, created_at: "not a date" }]), null);
  assert.equal(markerHandoffAt([{ body: HANDOFF_MARKER }]), null);
  for (const bad of [null, "x", 7]) assert.equal(markerHandoffAt(bad), null);
});

test("panelApprovedAt: the panel's own check run beats the marker comment", () => {
  // The check run is the primary source because it is the only signal present
  // WHENEVER the panel ran. The marker is posted in a try/catch after the PR is
  // already flipped ready, so a genuinely promoted PR can carry none.
  assert.equal(
    panelApprovedAt([round({ completedAt: "2026-07-24T15:40:00Z" })], "2026-07-24T15:48:28Z"),
    "2026-07-24T15:40:00Z",
  );
});

test("panelApprovedAt: the FIRST approval, because the newest one is self-defeating", () => {
  // The trap this exists to avoid. Every human fix pushed after an approval opens a
  // new round, and that round approves too — so a newest-approval cutoff moves PAST
  // the very commits the signature is looking for.
  //
  // Measured on #548: newest-approval lands on 2026-07-28, four days after the three
  // human fixes of 2026-07-25, and loses all three — including rows already curated
  // into misses.jsonl. Same rule as markerHandoffAt's "FIRST marker, not the last":
  // a later re-approval does not un-say the first one.
  const rounds = [
    round({ index: 0, completedAt: "2026-07-24T15:40:00Z" }),
    round({ index: 1, completedAt: "2026-07-28T01:00:56Z" }),
  ];
  assert.equal(panelApprovedAt(rounds), "2026-07-24T15:40:00Z");
  // Order in the array must not matter — it is the timestamps that decide.
  assert.equal(panelApprovedAt([...rounds].reverse()), "2026-07-24T15:40:00Z");
});

test("panelApprovedAt: only success is an approval — failure, unread and ADVISORY are not", () => {
  assert.equal(panelApprovedAt([round({ conclusion: "failure" })]), null);
  assert.equal(panelApprovedAt([round({ conclusion: "" })]), null);
  // An `@claude review` round carries conclusion "" precisely so it can never
  // become signature 1's cutoff: it is advice, not a gate decision.
  assert.equal(panelApprovedAt(commentRounds([], [])), null);
  // …and a failing round does not suppress an earlier real approval.
  assert.equal(
    panelApprovedAt([round({ index: 0, completedAt: "2026-07-24T15:40:00Z" }), round({ index: 1, conclusion: "failure", completedAt: "2026-07-26T09:00:00Z" })]),
    "2026-07-24T15:40:00Z",
  );
});

test("panelApprovedAt: falls back to the marker, and to null; junk never throws", () => {
  assert.equal(panelApprovedAt([], "2026-07-24T15:48:28Z"), "2026-07-24T15:48:28Z");
  assert.equal(panelApprovedAt([]), null);
  assert.equal(panelApprovedAt([], "nonsense"), null);
  assert.equal(panelApprovedAt([round({ completedAt: "not a date" })], null), null);
  for (const bad of [null, "x", 7]) assert.equal(panelApprovedAt(bad), null);
});

// --- panelRoundAt / panelRounds / commitIndex / roundsUpTo -------------------

const lensRun = (over = {}) => ({
  name: "agent-review-correctness", app: { slug: "github-actions" }, status: "completed",
  conclusion: "success", completed_at: "2026-07-24T15:40:00Z", ...over,
});

test("panelRoundAt: completedAt is the LATEST lens, because the round is not over until its last one", () => {
  const runs = new Map([
    ["agent-review-correctness", lensRun({ completed_at: "2026-07-24T15:38:00Z" })],
    ["agent-review-test-adequacy", lensRun({ completed_at: "2026-07-24T15:41:00Z" })],
  ]);
  assert.equal(panelRoundAt(runs).completedAt, "2026-07-24T15:41:00Z");
  // started_at is the per-run fallback latestLensRuns itself orders by
  assert.equal(panelRoundAt(new Map([["x", { conclusion: "success", started_at: "2026-07-24T15:00:00Z" }]])).completedAt, "2026-07-24T15:00:00Z");
  // unusable timestamps degrade to "", never to NaN or a throw
  assert.equal(panelRoundAt(new Map([["x", { conclusion: "success", completed_at: "nope" }]])).completedAt, "");
  assert.equal(panelRoundAt(null).completedAt, "");
  // Ordered by PARSED TIME, not lexicographically. These two strings sort the wrong
  // way as text and the right way as instants, so a string comparison fails here.
  const offsets = new Map([
    ["a", { conclusion: "success", completed_at: "2026-07-24T09:00:00-06:00" }], // 15:00Z
    ["b", { conclusion: "success", completed_at: "2026-07-24T14:00:00Z" }],
  ]);
  assert.equal(panelRoundAt(offsets).completedAt, "2026-07-24T09:00:00-06:00");
  assert.equal(
    panelApprovedAt([round({ completedAt: "2026-07-24T14:00:00Z" }), round({ completedAt: "2026-07-24T09:00:00-06:00" })]),
    "2026-07-24T14:00:00Z", // the earlier INSTANT, though it sorts later as text
  );
});

test("panelRoundAt: shares the aggregate conclusion rule rather than copying it", () => {
  // One failing lens means the panel did not let it through — the same rule
  // panelVerdictAt reports, from the same function, so the cheap path used to
  // establish rounds can never disagree with the expensive one used to read them.
  const runs = new Map([["a", lensRun()], ["b", lensRun({ conclusion: "failure" })]]);
  assert.equal(panelRoundAt(runs).conclusion, "failure");
  assert.equal(panelVerdictAt(runs).conclusion, "failure");
  assert.equal(panelRoundAt(new Map()).conclusion, "");
  assert.equal(panelVerdictAt(new Map()).conclusion, "");
});

test("commitIndex: position on the PR, and -1 for a commit that is not on it", () => {
  const commits = [{ sha: "a".repeat(40) }, { sha: "b".repeat(40) }];
  assert.equal(commitIndex(commits, "b".repeat(40)), 1);
  // A force-push leaves a CodeRabbit comment's original_commit_id pointing at a
  // commit no longer reachable from the branch. That is a real state, not junk.
  assert.equal(commitIndex(commits, "c".repeat(40)), -1);
  assert.equal(commitIndex(commits, ""), -1);
  for (const bad of [null, "x", 7]) assert.equal(commitIndex(bad, "a".repeat(40)), -1);
});

test("panelRounds: only commits the panel CONCLUDED on become rounds", () => {
  const commits = [{ sha: "a".repeat(40) }, { sha: "b".repeat(40) }, { sha: "c".repeat(40) }];
  const rounds = panelRounds(commits, (sha) => {
    if (sha === "a".repeat(40)) return new Map([["agent-review-correctness", lensRun()]]);
    if (sha === "b".repeat(40)) return new Map(); // no lens runs at all → not a round
    return new Map([["agent-review-correctness", lensRun({ conclusion: "failure", completed_at: "2026-07-25T10:00:00Z" })]]);
  });
  assert.deepEqual(rounds.map((r) => [r.index, r.conclusion]), [[0, "success"], [2, "failure"]]);
});

test("panelRounds: an unreadable commit keeps its SHA but is never evidence", () => {
  // Two directions at once. The round must not count as "the panel reviewed this" —
  // so conclusion "" keeps it out of panelApprovedAt and `unreadable` makes the
  // comparison set refuse it — but the sha is a fact we hold either way, and it is
  // what tells an API hiccup apart from a PR the panel never touched.
  const commits = [{ sha: "a".repeat(40) }, { sha: "b".repeat(40) }];
  const logged = [];
  const rounds = panelRounds(commits, (sha) => {
    if (sha === "a".repeat(40)) throw new Error("502");
    return new Map([["agent-review-correctness", lensRun()]]);
  }, { log: (m) => logged.push(m) });
  assert.deepEqual(rounds.map((r) => [r.index, r.conclusion, r.unreadable ?? false]), [[0, "", true], [1, "success", false]]);
  assert.equal(rounds[0].sha, "a".repeat(40));
  assert.ok(logged.some((m) => /could not read the panel's verdict at a{40} \(502\)/.test(m)));
  // It is not an approval, and the readable round beside it still is.
  assert.equal(panelApprovedAt([rounds[0]]), null);
  assert.equal(panelApprovedAt(rounds), "2026-07-24T15:40:00Z");
});

test("roundsUpTo: what cannot be PLACED cannot be EXCLUDED", () => {
  const rounds = [round({ index: 0 }), round({ index: 2 }), round({ index: -1, sha: "z".repeat(40) })];
  // A finding on commit 1 sees round 0 — and the unplaceable round, which cannot be
  // ruled out on evidence — but NOT round 2, which the panel reached afterwards.
  assert.deepEqual(roundsUpTo(rounds, 1).map((r) => r.index), [0, -1]);
  // An unplaceable finding sees everything.
  assert.deepEqual(roundsUpTo(rounds, -1).map((r) => r.index), [0, 2, -1]);
  // Both directions widen: narrowing on a guess would file a miss against a
  // reviewer that did raise it, which is the unrecoverable error.
  assert.deepEqual(roundsUpTo(rounds, 5).map((r) => r.index), [0, 2, -1]);
  for (const bad of [null, "x", 7]) assert.deepEqual(roundsUpTo(bad, 0), []);
});

test("commentRounds: an advisory review is a round, with conclusion \"\"", () => {
  const sha = "a".repeat(40);
  const body = `<!-- agent-review:${sha} -->\ncorrectness review: **changes requested**\n\n### Major (1)\n\n- \`pkg/x.ts:10\` — a real defect\n`;
  const rounds = commentRounds([{ user: { login: "yorkie-agent[bot]" }, body, created_at: "2026-07-24T16:00:00Z" }], [{ sha }]);
  assert.equal(rounds.length, 1);
  assert.equal(rounds[0].index, 0);
  assert.equal(rounds[0].conclusion, ""); // advisory: reached no gate conclusion
  assert.equal(rounds[0].advisory, true);
  assert.equal(rounds[0].blockers.length, 1); // findings already parsed — no second request
  // Author-gated before anything is parsed: these findings can suppress a candidate.
  assert.deepEqual(commentRounds([{ user: { login: "harrykim8672" }, body }], [{ sha }]), []);
  // Reviewed a commit no longer on the PR → unplaceable, which roundsUpTo handles.
  assert.equal(commentRounds([{ user: { login: "yorkie-agent[bot]" }, body }], [{ sha: "b".repeat(40) }])[0].index, -1);
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

// The other three vintages, each VERBATIM from this repository's API. They are
// pinned with their PR and comment id so anyone can re-fetch and diff them; a
// hand-written header only proves the regex matches its author's idea of the
// format, which is how the three-field-only version shipped in the first place.
//
// `repos/wafflebase/wafflebase/pulls/comments` → comment 3733719133 (PR #692,
// 2026-08-07). NOTE THE DATE: the two-field header is not a retired vintage, it
// is current output with the effort field omitted.
const CR_TWO_FIELD_LIVE =
  "_🩺 Stability & Availability_ | _🟠 Major_\n\n**Reap the process group on `exit`, not only on `close`.**\n\nA leaked descendant can retain `proc.stdout` or `proc.stderr` after the shell exits.";
// comment 2837785711 (PR #15, 2026-02-22) — two fields, UPSTREAM vocabulary.
const CR_TWO_FIELD_UPSTREAM =
  "_⚠️ Potential issue_ | _🟠 Major_\n\n**No timeout on `fetch` calls — requests can hang indefinitely.**\n\n`sendSignedRequest` delegates to `fetch` (Line 262) without an `AbortSignal` timeout.";
// comment 2041141880 (PR #11, 2025-04-13) — ONE italic field, and it is a
// CATEGORY.
const CR_SINGLE_ITALIC =
  "_🛠️ Refactor suggestion_\n\n**Add error handling to the useMe hook.**\n\nCurrently, errors from `fetchMe()` are handled within that function via toast messages.";
// comment 1702452902 (PR #6, 2024-08-03) — no header at all, straight to the
// bolded title.
const CR_BOLD_TITLE =
  "**Consider optimizing the `hasContents` method.**\n\nThe current implementation iterates through each reference in the range and checks the store.";
// comment 3457646724 (PR #407, 2026-06-23T06:56:21Z) — the FIRST comment in the
// CHILL vocabulary, three fields.
const CR_THREE_FIELD_CHILL =
  "_🔒 Security & Privacy_ | _🟠 Major_ | _⚡ Quick win_\n\n**Validate `srgb` input before embedding it into XML.**\n\n`colorChildXml` currently interpolates raw `c.value` into `val=\"...\"`.";

test("classifyCodeRabbitComment: reads the header this repo actually emits", () => {
  assert.deepEqual(classifyCodeRabbitComment(CR_MAJOR_CORRECTNESS), {
    category: "functional correctness",
    vocabulary: "chill",
    severity: "major",
    severityRaw: "major",
    effort: "heavy lift",
    vintage: "three-field",
    lens: "correctness",
    summary: "Guard public mutation APIs at the read-only boundary.",
    detail:
      "**Guard public mutation APIs at the read-only boundary.** This flag only protects event handlers.",
  });
  assert.equal(classifyCodeRabbitComment(CR_MAJOR_SECURITY).lens, "security");
});

test("classifyCodeRabbitComment: reads all FOUR header vintages, from real bodies", () => {
  // The regex this replaces required three italic fields, so eras 1 and 2 —
  // 550 of the 1485 inline findings in this repo, measured 2026-08-07 — returned
  // null and read as "CodeRabbit said nothing here".
  const live = classifyCodeRabbitComment(CR_TWO_FIELD_LIVE);
  assert.equal(live.vintage, "two-field");
  assert.equal(live.category, "stability & availability");
  assert.equal(live.vocabulary, "chill");
  assert.equal(live.severity, "major");
  assert.equal(live.effort, ""); // the field the two-field vintage omits

  const upstream = classifyCodeRabbitComment(CR_TWO_FIELD_UPSTREAM);
  assert.equal(upstream.vintage, "two-field");
  assert.equal(upstream.category, "potential issue");
  assert.equal(upstream.vocabulary, "upstream");
  assert.equal(upstream.severity, "major");

  const single = classifyCodeRabbitComment(CR_SINGLE_ITALIC);
  assert.equal(single.vintage, "single-italic");
  assert.equal(single.category, "refactor suggestion");
  assert.equal(single.severity, ""); // this vintage states no severity at all

  const bold = classifyCodeRabbitComment(CR_BOLD_TITLE);
  assert.equal(bold.vintage, "bold-title");
  assert.equal(bold.category, "");
  assert.equal(bold.severity, "");
  assert.equal(bold.summary, "Consider optimizing the `hasContents` method.");

  assert.equal(classifyCodeRabbitComment(CR_THREE_FIELD_CHILL).vintage, "three-field");
});

test("classifyCodeRabbitComment: WHICH vocabulary the category came from is kept", () => {
  // The switch was sharp — last upstream-vocabulary comment 2026-06-22T00:20:46Z,
  // first CHILL one 2026-06-23T06:56:21Z — so era is a real confound in any count
  // taken across it. A parser that normalised both into one shape would make "did
  // the format change?" unanswerable from the output.
  assert.equal(classifyCodeRabbitComment(CR_THREE_FIELD_CHILL).vocabulary, "chill");
  assert.equal(classifyCodeRabbitComment(CR_TWO_FIELD_UPSTREAM).vocabulary, "upstream");
});

test("classifyCodeRabbitComment: a lone italic field is a category OR an effort", () => {
  // 212 of the 226 single-field headers in this repo's review bodies are EFFORTS
  // (`_⚡ Quick win_`), not categories. Reading position 1 as "the category" would
  // file "quick win" as a CodeRabbit category on every one of them.
  const effort = classifyCodeRabbitComment("_⚡ Quick win_\n\n**Coverage gap.**\n\nprose");
  assert.equal(effort.effort, "quick win");
  assert.equal(effort.category, "");
  assert.equal(classifyCodeRabbitComment(CR_SINGLE_ITALIC).category, "refactor suggestion");
  assert.equal(classifyCodeRabbitComment(CR_SINGLE_ITALIC).effort, "");
});

test("classifyCodeRabbitComment: the `_` delimiter also occurs INSIDE a field", () => {
  // GitHub emoji shortcodes contain underscores. A `_([^_]+)_` field regex stops
  // at the first inner underscore and drops the finding — this is real, from
  // review 2526885510 on PR #10 (2025-01-01).
  const f = classifyCodeRabbitComment("_:hammer_and_wrench: Refactor suggestion_\n\n**Update the action version**\n\nprose");
  assert.equal(f.category, "refactor suggestion");
  assert.equal(f.vintage, "single-italic");
});

test("classifyCodeRabbitComment: non-findings are null, NOT default-severity findings", () => {
  // This is why severity is read only AFTER a header matched. normalizeSeverity
  // maps anything unknown to `major` (fail-safe for a gate), so running a threaded
  // reply through it would file every "thanks for the fix" as a blocking candidate
  // and bury the real ones.
  assert.equal(classifyCodeRabbitComment(CR_REPLY), null);
  assert.equal(classifyCodeRabbitComment("<!-- walkthrough --> ## Summary by CodeRabbit"), null);
  for (const bad of [null, undefined, "", 7, {}]) assert.equal(classifyCodeRabbitComment(bad), null);
  // An italic line recognised in NO vocabulary is a caption, not a header.
  assert.equal(classifyCodeRabbitComment("_see the diagram below_\n\nprose"), null);
});

test("classifyCodeRabbitComment: non-blocking severities are RETURNED, not dropped", () => {
  // They used to be dropped HERE, which made "what CodeRabbit wrote" and "what
  // this corpus files" the same function. The blocking-only rule is the corpus's
  // policy and now lives at the caller — see the harvestPr test below, which is
  // what actually holds that behaviour in place.
  const minor = classifyCodeRabbitComment(CR_MINOR_MAINTAIN);
  assert.equal(minor.severity, "minor");
  assert.equal(classifyCodeRabbitComment("_🎯 Functional Correctness_ | _⚪ Nit_ | _⚡ Quick win_\n\n**x**").severity, "nit");
});

test("classifyCodeRabbitComment: `trivial` becomes `nit`, and never reaches normalizeSeverity", () => {
  // CodeRabbit's below-minor tier. `severity.mjs`'s KNOWN has no `trivial` and maps
  // anything unknown to `major` as a fail-safe for OUR gate, so routing it through
  // normalizeSeverity files 307 lowest-tier nits as BLOCKING majors. Translated at
  // the arm boundary instead: KNOWN is the shared source of truth for what blocks a
  // PR in our panel, and our lenses never emit `trivial`.
  const f = classifyCodeRabbitComment("_📐 Maintainability & Code Quality_ | _🔵 Trivial_ | _⚡ Quick win_\n\n**Reuse the shared type.**\n\nprose");
  assert.equal(f.severity, "nit");
  assert.equal(f.severityRaw, "trivial");
  assert.ok(!BLOCKING.has(f.severity), "a trivial nit must never be blocking");
  assert.equal(normalizeSeverity("trivial"), "major"); // the trap this avoids, still live
});

test("classifyCodeRabbitComment: an UNRECOGNISED severity is empty, not guessed", () => {
  // The decision here is the default, not the mapping. `major` files nits as
  // blockers; `nit` silently demotes a real blocker the day CodeRabbit adds a
  // word. Both are silent. Empty is not: BLOCKING.has("") is false, so the finding
  // is withheld rather than guessed into the corpus, and severityRaw names the gap.
  const f = classifyCodeRabbitComment("_🎯 Functional Correctness_ | _🟣 Catastrophic_ | _⚡ Quick win_\n\n**x**\n\nprose");
  assert.equal(f.severity, "");
  assert.equal(f.severityRaw, "");
  assert.equal(f.category, "functional correctness");
  assert.ok(!BLOCKING.has(f.severity));
});

test("classifyCodeRabbitHeader: fields are assigned by VOCABULARY, not by position", () => {
  // Position is not stable across vintages — the same slot holds a category in
  // one and an effort in another — so one function reads all three arities by
  // asking which vocabulary each field belongs to.
  assert.deepEqual(classifyCodeRabbitHeader("_🎯 Functional Correctness_ | _🟠 Major_ | _⚡ Quick win_"), {
    vintage: "three-field",
    category: "functional correctness",
    vocabulary: "chill",
    severity: "major",
    severityRaw: "major",
    effort: "quick win",
    unrecognised: [],
  });
  assert.equal(classifyCodeRabbitHeader("_🟠 Major_").severity, "major");
  assert.equal(classifyCodeRabbitHeader("_🟠 Major_").category, "");
  // A word in no vocabulary is CARRIED, not dropped and not guessed at.
  assert.deepEqual(classifyCodeRabbitHeader("_🎯 Functional Correctness_ | _🟣 Catastrophic_").unrecognised, ["catastrophic"]);
  // Not a header at all.
  assert.equal(classifyCodeRabbitHeader("**A bolded title.**"), null);
  assert.equal(classifyCodeRabbitHeader("_a_ | _b_ | _c_ | _d_"), null);
  assert.equal(classifyCodeRabbitHeader(""), null);
});

test("classifyCodeRabbitComment: only unambiguous categories get a lens", () => {
  // Stability & Availability plausibly belongs to correctness OR blast-radius. A
  // guessed mapping would corrupt the per-lens miss count the corpus exists to
  // produce, so it is left blank for the curator.
  const stability = classifyCodeRabbitComment(CR_MAJOR_STABILITY);
  assert.equal(stability.severity, "major");
  assert.equal(stability.lens, "");
});

// --- parseCodeRabbitReview ---------------------------------------------------
//
// Every fixture below is a VERBATIM slice of a real `pulls/{n}/reviews` response,
// pinned with its PR and review id. Truncated at the end only — never edited.

// review 4628429920 (PR #435, 2026-07-03). The modern shape: a tier section
// wrapping one file sub-section per file, each declaring its own count.
const RV_NITPICK = [
  "<details>",
  "<summary>🧹 Nitpick comments (2)</summary><blockquote>",
  "",
  "<details>",
  "<summary>packages/slides/src/import/pptx/text.ts (1)</summary><blockquote>",
  "",
  "`97-114`: _📐 Maintainability & Code Quality_ | _🔵 Trivial_ | _⚡ Quick win_",
  "",
  "**Reuse the shared `TextInset` type instead of an inline duplicate.**",
  "",
  "The return type here structurally duplicates `TextInset` from `../../model/element`.",
  "",
  "</blockquote></details>",
  "<details>",
  "<summary>packages/slides/src/view/canvas/text-renderer.ts (1)</summary><blockquote>",
  "",
  "`185-222`: _📐 Maintainability & Code Quality_ | _🔵 Trivial_ | _⚡ Quick win_",
  "",
  "**Add a direct regression test for the `body.inset` fallback**",
  "",
  "A small case here would lock that precedence in.",
  "",
  "</blockquote></details>",
  "",
  "</blockquote></details>",
].join("\n");

// review 2216686007 (PR #6, 2024-08-03). The COMBINED title, which names three
// tiers at once, and the `Line range hint` locator.
const RV_COMBINED_2024 = [
  "<details>",
  "<summary>Outside diff range, codebase verification and nitpick comments (1)</summary><blockquote>",
  "",
  "<details>",
  "<summary>src/worksheet/coordinates.ts (1)</summary><blockquote>",
  "",
  "`120-155`: **LGTM! Consider adding inline comments for clarity.**",
  "",
  "The `toBorderRanges` function correctly calculates and returns the border ranges.",
  "",
  "</blockquote></details>",
  "",
  "</blockquote></details>",
].join("\n");

// review 4698770133 (PR #477, 2026-07-14). The BARE locator — no backticks.
const RV_FAILED_TO_POST = [
  "<details>",
  "<summary>🛑 Comments failed to post (1)</summary><blockquote>",
  "",
  "<details>",
  "<summary>docs/design/design-system-unification.md (1)</summary><blockquote>",
  "",
  "62-75: _📐 Maintainability & Code Quality_ | _🟡 Minor_ | _⚡ Quick win_",
  "",
  "**Update the remaining CSS import example.**",
  "",
  "Change it to `@wafflebase/core/tokens.css`.",
  "",
  "</blockquote></details>",
  "",
  "</blockquote></details>",
].join("\n");

// review 2216686007 (PR #6). `Line range hint` prefixes the locator, and the
// header is a bolded title on the NEXT line.
const RV_LINE_RANGE_HINT = [
  "<details>",
  "<summary>Additional comments not posted (2)</summary><blockquote>",
  "",
  "<details>",
  "<summary>test/sheet/sheet.test.ts (2)</summary><blockquote>",
  "",
  "Line range hint `4-15`: ",
  "**LGTM! The test case is well-structured and covers the basic functionality.**",
  "",
  "The test case for setting and getting data in the `Sheet` class correctly validates.",
  "",
  "---",
  "",
  "Line range hint `17-22`: ",
  "**LGTM! The test case is well-structured and covers the expected behavior.**",
  "",
  "The test case for updating the selection correctly validates the expected behavior.",
  "",
  "</blockquote></details>",
  "",
  "</blockquote></details>",
].join("\n");

test("parseCodeRabbitReview: reads the tier the inline endpoint cannot see", () => {
  // `pulls/{n}/comments` does not return these. They are nested in the REVIEW
  // body, an endpoint this module never called: 1626 findings across 638 PRs,
  // against 436 the inline path returned. Measured 2026-08-07.
  const { findings, declared, shortfall } = parseCodeRabbitReview(RV_NITPICK);
  assert.equal(declared, 2);
  assert.equal(findings.length, 2);
  assert.equal(shortfall, 0);
  assert.equal(findings[0].tier, "nitpick");
  assert.equal(findings[0].file, "packages/slides/src/import/pptx/text.ts");
  assert.equal(findings[0].locator, "97-114");
  assert.equal(findings[0].severity, "nit"); // `Trivial`, translated
  assert.equal(findings[0].summary, "Reuse the shared `TextInset` type instead of an inline duplicate.");
  // The SECOND file's finding, which a non-counting blockquote scan loses: the
  // tier section would end at the first inner `</blockquote>`.
  assert.equal(findings[1].file, "packages/slides/src/view/canvas/text-renderer.ts");
});

test("parseCodeRabbitReview: the count travels with its DENOMINATOR", () => {
  // Every defect this parser has had was a smaller-than-truth count that looked
  // like a working one. `declared` is CodeRabbit's own section total, so "no
  // nitpicks" and "could not read the nitpicks" stop being the same number.
  const { declared, findings, shortfall } = parseCodeRabbitReview(
    RV_NITPICK.replace("🧹 Nitpick comments (2)", "🧹 Nitpick comments (5)"),
  );
  assert.equal(declared, 5);
  assert.equal(findings.length, 2);
  assert.equal(shortfall, 3);
});

test("parseCodeRabbitReview: all three section-title vintages, and all three locators", () => {
  // The 2024 title names three tiers at once, so a keyword match on "Nitpick
  // comments" misses it — and an unmatched section contributes neither findings
  // NOR its declared count, so the shortfall check reports a clean 0 of 0.
  const combined = parseCodeRabbitReview(RV_COMBINED_2024);
  assert.equal(combined.declared, 1);
  assert.equal(combined.findings.length, 1);
  assert.equal(combined.findings[0].tier, "combined");
  assert.equal(combined.findings[0].vintage, "bold-title");

  // Bare locator, no backticks.
  const failed = parseCodeRabbitReview(RV_FAILED_TO_POST);
  assert.equal(failed.findings.length, 1);
  assert.equal(failed.findings[0].tier, "failed-to-post");
  assert.equal(failed.findings[0].locator, "62-75");
  assert.equal(failed.findings[0].severity, "minor");

  // `Line range hint` prefix, with the title on the following line.
  const hinted = parseCodeRabbitReview(RV_LINE_RANGE_HINT);
  assert.equal(hinted.declared, 2);
  assert.equal(hinted.findings.length, 2);
  assert.equal(hinted.findings[0].locator, "4-15");
  assert.equal(hinted.findings[0].file, "test/sheet/sheet.test.ts");
});

test("parseCodeRabbitReview: the TIER is kept on every finding, never pooled", () => {
  // They are different claims. A ♻️ Duplicate is the same defect said twice and
  // double-counts any volume metric; ⚠️ Outside diff range is about code the PR
  // did not touch, which is a different comparison entirely. A scorer can pool
  // later; it cannot unpool.
  const dup = parseCodeRabbitReview(RV_NITPICK.replace("🧹 Nitpick comments (2)", "♻️ Duplicate comments (2)"));
  assert.deepEqual([...new Set(dup.findings.map((f) => f.tier))], ["duplicate"]);
  const odr = parseCodeRabbitReview(RV_NITPICK.replace("🧹 Nitpick comments (2)", "⚠️ Outside diff range comments (2)"));
  assert.deepEqual([...new Set(odr.findings.map((f) => f.tier))], ["outside-diff-range"]);
});

test("parseCodeRabbitReview: a tier it does not know is REPORTED, not skipped", () => {
  // CodeRabbit has introduced four tier names on this repo already. An unknown one
  // is indistinguishable, from the outside, from a review that found nothing —
  // which is the one conclusion this module must never reach by accident.
  const { findings, declared, unrecognised } = parseCodeRabbitReview(
    RV_NITPICK.replace("🧹 Nitpick comments (2)", "🆕 Speculative comments (2)"),
  );
  assert.equal(findings.length, 0);
  assert.equal(declared, 0);
  assert.deepEqual(unrecognised, [{ title: "🆕 Speculative comments", declared: 2 }]);
  // File sub-sections and the housekeeping sections are NOT reported as unknown.
  assert.deepEqual(parseCodeRabbitReview(RV_NITPICK).unrecognised, []);
  assert.deepEqual(
    parseCodeRabbitReview("<details><summary>📒 Files selected for processing (4)</summary></details>").unrecognised,
    [],
  );
});

test("parseCodeRabbitReview: never throws, and degrades to fewer findings", () => {
  for (const bad of [null, undefined, "", 7, {}, "<details><summary>🧹 Nitpick comments (2)</summary>"]) {
    const out = parseCodeRabbitReview(bad);
    assert.ok(Array.isArray(out.findings));
  }
});

// --- toMissRecord ------------------------------------------------------------

const FIELD_ORDER = [
  "schema", "id", "label", "source", "pr", "handoffAt", "evidence", "files", "fileClasses",
  "lens", "severity", "origin", "summary", "panelSaw", "verifiedBy", "notes",
];

/** `panelSaw` with nothing established and no attribution attempted. */
const EMPTY_PANEL_SAW = {
  reviewedSha: "", conclusion: "", blockingFindings: 0,
  matchVerdict: "", matchScore: 0, matchedSummary: "",
};

test("toMissRecord: field order is stable, because the corpus is read in diffs", () => {
  assert.deepEqual(Object.keys(toMissRecord({})), FIELD_ORDER);
  assert.deepEqual(Object.keys(toMissRecord({ id: "x", pr: 1, files: ["a.ts"] })), FIELD_ORDER);
  assert.deepEqual(Object.keys(toMissRecord({}).evidence), ["commitSha", "commentId", "url"]);
  assert.deepEqual(Object.keys(toMissRecord({}).panelSaw), [
    "reviewedSha", "conclusion", "blockingFindings", "matchVerdict", "matchScore", "matchedSummary",
  ]);
});

test("toMissRecord: junk coerces to safe defaults rather than throwing", () => {
  const r = toMissRecord({ label: "wat", source: "wat", origin: "wat", pr: "nope", files: "nope", panelSaw: 7 });
  assert.equal(r.schema, SCHEMA);
  assert.equal(r.label, "miss");
  assert.equal(r.source, "manual");
  assert.equal(r.origin, "unknown");
  assert.equal(r.pr, 0);
  assert.deepEqual(r.files, []);
  assert.deepEqual(r.panelSaw, EMPTY_PANEL_SAW);
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
  assert.deepEqual(panelVerdictAt(runs), {
    reviewedSha: "", conclusion: "failure", blockingFindings: 1,
    // `normalizeFindings` keeps every field it was handed and names the four it
    // knows, so an absent file/evidence surfaces as undefined rather than "".
    blockers: [{ severity: "major", summary: "vacuous test", file: undefined, evidence: undefined, lens: "test-adequacy" }],
  });
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
  assert.deepEqual(panelVerdictAt(new Map()), {
    reviewedSha: "", conclusion: "", blockingFindings: 0, blockers: [],
  });
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
  // The CHECK RUN's completed_at, not the marker comment's created_at (15:48:28Z).
  // The panel's own run is the primary source now; the marker is a fallback for a
  // PR that has no readable round at all.
  assert.equal(fix.handoffAt, "2026-07-24T15:40:00Z");
  // the verdict that LET THE PR THROUGH — the round that approved
  assert.deepEqual(fix.panelSaw, { ...EMPTY_PANEL_SAW, reviewedSha: SHA_BASE, conclusion: "success" });

  const cr = records.find((r) => r.source === "coderabbit");
  assert.equal(cr.lens, "correctness");
  assert.equal(cr.severity, "major");
  assert.equal(cr.evidence.commentId, "3650043440");
});

test("harvestPr: keeps ONLY blocking CodeRabbit findings — the filter the parser gave up", () => {
  // This test is the one that holds the corpus policy in place now. It used to
  // live inside `classifyCodeRabbitComment` ("non-blocking severities are
  // dropped"), which meant widening the parser to read the vintages it was blind
  // to would have flooded this corpus with nits. The parser returns everything
  // CodeRabbit wrote; the caller decides what the corpus files.
  const api = fakeApi({
    [`repos/{owner}/{repo}/pulls/548/comments?per_page=100`]: [
      { id: 10, user: { login: "coderabbitai[bot]" }, path: "packages/docs/src/view/text-editor.ts", original_commit_id: SHA_BASE, body: CR_MINOR_MAINTAIN },
      { id: 11, user: { login: "coderabbitai[bot]" }, path: "packages/docs/src/view/text-editor.ts", original_commit_id: SHA_BASE, body: "_🎯 Functional Correctness_ | _🔵 Trivial_ | _⚡ Quick win_\n\n**A trivial nit.**\n\nprose" },
      // A severity in no vocabulary we know: withheld, NOT defaulted to major.
      { id: 12, user: { login: "coderabbitai[bot]" }, path: "packages/docs/src/view/text-editor.ts", original_commit_id: SHA_BASE, body: "_🎯 Functional Correctness_ | _🟣 Catastrophic_ | _⚡ Quick win_\n\n**Unknown severity.**\n\nprose" },
    ],
  });
  const { records } = harvestPr(548, { api, log: () => {}, names: NAMES });
  assert.deepEqual(records.filter((r) => r.source === "coderabbit"), []);
  // …and every severity the parser DID hand it was readable, so this is a filter
  // rather than a parse failure.
  assert.equal(classifyCodeRabbitComment(CR_MINOR_MAINTAIN).severity, "minor");
});

test("harvestPr: a two-field header now reaches the corpus — the widening, end to end", () => {
  // The header on #692, posted 2026-08-07. `classifyCodeRabbitComment` returned
  // null for it before this change, so a Major finding from CodeRabbit on a PR the
  // panel had reviewed was filed as nothing at all.
  const api = fakeApi({
    [`repos/{owner}/{repo}/pulls/548/comments?per_page=100`]: [
      { id: 3733719133, user: { login: "coderabbitai[bot]" }, path: "packages/docs/src/view/text-editor.ts", original_commit_id: SHA_BASE, html_url: "https://x/d", body: CR_TWO_FIELD_LIVE },
    ],
  });
  const { records } = harvestPr(548, { api, log: () => {}, names: NAMES });
  const cr = records.filter((r) => r.source === "coderabbit");
  assert.equal(cr.length, 1);
  assert.equal(cr[0].severity, "major");
  assert.equal(cr[0].evidence.commentId, "3733719133");
});

test("harvestPr: EVERY harvested candidate is unverified", () => {
  // The one field that decides whether a record counts. The harvester must not be
  // able to set it, even by accident — an auto-harvested, auto-trusted corpus is a
  // corpus of noise, and harvester noise is systematic.
  const { records } = harvestPr(548, { api: fakeApi(), log: () => {}, names: NAMES });
  assert.ok(records.length > 0);
  for (const r of records) assert.equal(r.verifiedBy, "");
});

// --- finding-level attribution (signature 2) ---------------------------------

test("codeRabbitDetail: title + prose, stopping at the first structured block", () => {
  // Verified against the real bodies on #548/#594/#639: header → bolded title →
  // prose → blocks, and prose never resumes afterwards.
  const body = [
    "_🎯 Functional Correctness_ | _🟠 Major_ | _⚡ Quick win_",
    "",
    "**Guard the read-only boundary.**",
    "",
    "`EditorAPI.paste()` mutates the store regardless of the flag.",
    "",
    "<details>",
    "<summary>🤖 Prompt for AI Agents</summary>",
    "",
    "```",
    "Verify each finding against current code. Fix only still-valid issues.",
    "```",
    "</details>",
    "",
    "<!-- This is an auto-generated comment by CodeRabbit -->",
  ].join("\n");
  const detail = codeRabbitDetail(body);
  assert.match(detail, /Guard the read-only boundary/);
  assert.match(detail, /EditorAPI\.paste/);
  // The boilerplate every comment repeats must NOT reach the token comparison —
  // it would contribute `code`, `fix`, `issues`, `validate` to every pair.
  assert.doesNotMatch(detail, /Verify each finding/);
  assert.doesNotMatch(detail, /Functional Correctness/); // the header line is dropped
});

/** A panel check-run whose findings are `findings`. */
const panelRun = (findings) => ({
  [`repos/{owner}/{repo}/commits/${SHA_BASE}/check-runs?per_page=100`]: [
    { check_runs: [{ id: 1, name: "agent-review-correctness", app: { slug: "github-actions" }, status: "completed", conclusion: "failure", completed_at: "2026-07-24T15:40:00Z", output: { text: JSON.stringify(findings) } }] },
  ],
  [`repos/{owner}/{repo}/check-runs/1`]: { id: 1, name: "agent-review-correctness", conclusion: "failure", output: { text: JSON.stringify(findings) } },
});

/** One CodeRabbit review comment on #548. */
const crComment = (body, path = "packages/docs/src/view/text-editor.ts") => ({
  [`repos/{owner}/{repo}/pulls/548/comments?per_page=100`]: [
    { id: 999, user: { login: "coderabbitai[bot]" }, path, original_commit_id: SHA_BASE, html_url: "https://x/d", body },
  ],
});

test("harvestPr: a CodeRabbit finding the panel already raised is SUPPRESSED, and said so", () => {
  // The whole point of the matcher. Before it, this comment was filed as a miss
  // because the only thing known about the panel was a count.
  const logged = [];
  const api = fakeApi({
    ...panelRun([{ severity: "major", file: "packages/docs/src/view/text-editor.ts", summary: "Public mutation APIs are not guarded at the read-only boundary, so EditorAPI.paste() still mutates the store" }]),
    ...crComment(CR_MAJOR_CORRECTNESS),
  });
  const { records, suppressed } = harvestPr(548, { api, log: (m) => logged.push(m), names: NAMES });
  assert.equal(suppressed, 1);
  assert.equal(records.filter((r) => r.source === "coderabbit").length, 0);
  // Visible, not silent: the log names the panel finding it was attributed to.
  assert.ok(logged.some((m) => /restates a panel finding/.test(m) && /Public mutation APIs/.test(m)));
});

test("harvestPr: a CodeRabbit finding the panel did NOT raise still emits, unflagged", () => {
  // The panel's only blocker is in a different file and shares no vocabulary:
  // no location tie and no shared anchor, which is the one shape L2 calls `no`.
  const api = fakeApi({
    ...panelRun([{ severity: "major", file: "packages/sheets/src/formula/calculator.ts", summary: "Pagination recomputes every page on each keystroke, which stalls long documents" }]),
    ...crComment(CR_MAJOR_CORRECTNESS),
  });
  const { records, suppressed } = harvestPr(548, { api, log: () => {}, names: NAMES });
  assert.equal(suppressed, 0);
  const cr = records.find((r) => r.source === "coderabbit");
  assert.equal(cr.panelSaw.matchVerdict, "no");
  assert.equal(cr.panelSaw.matchedSummary, "");
  assert.doesNotMatch(cr.notes, /MAYBE/);
});

test("harvestPr: same file, unrelated defect → emitted as `maybe`, never suppressed", () => {
  // A known and deliberate property: co-location in one file is partial evidence,
  // so it reaches `maybe` rather than `no`. Both verdicts EMIT — the difference is
  // only whether a curator is asked to look — so the cost of the conservative call
  // is one line of reading, and the cost of the other direction is a lost miss.
  const api = fakeApi({
    ...panelRun([{ severity: "major", file: "packages/docs/src/view/text-editor.ts", summary: "Pagination recomputes every page on each keystroke, which stalls long documents" }]),
    ...crComment(CR_MAJOR_CORRECTNESS),
  });
  const { records, suppressed } = harvestPr(548, { api, log: () => {}, names: NAMES });
  assert.equal(suppressed, 0);
  const cr = records.find((r) => r.source === "coderabbit");
  assert.equal(cr.panelSaw.matchVerdict, "maybe");
});

test("harvestPr: an ambiguous CodeRabbit finding emits FLAGGED for the curator", () => {
  // Same file and a shared symbol, but the summaries share almost no vocabulary.
  // Location is necessary and never sufficient, so this is a `maybe` — emitted,
  // because suppressing it could lose a real miss.
  const api = fakeApi({
    ...panelRun([{ severity: "major", file: "packages/docs/src/view/text-editor.ts", summary: "Pagination recomputes every page on each keystroke", evidence: "`pasteContent` is on that path" }]),
    ...crComment("_🎯 Functional Correctness_ | _🟠 Major_ | _⚡ Quick win_\n\n**Unrelated wording entirely.**\n\nSomething about `pasteContent` here."),
  });
  const { records, suppressed } = harvestPr(548, { api, log: () => {}, names: NAMES });
  assert.equal(suppressed, 0);
  const cr = records.find((r) => r.source === "coderabbit");
  assert.equal(cr.panelSaw.matchVerdict, "maybe");
  assert.match(cr.notes, /MAYBE already raised by the panel/);
});

test("harvestPr: an unreadable panel verdict WITHHOLDS, because it is recoverable", () => {
  // `blockers` stays null when the check runs could not be read, so there is no
  // evidence the panel reviewed this PR and no basis for the claim "the panel did
  // not raise this". Withholding writes no row, so a later harvest re-proposes the
  // candidate once the evidence exists — whereas a wrong row, once curated, stays.
  const api = fakeApi({
    [`repos/{owner}/{repo}/commits/${SHA_BASE}/check-runs?per_page=100`]: new Error("502"),
    ...crComment(CR_MAJOR_CORRECTNESS),
  });
  const logged = [];
  const { records } = harvestPr(548, { api, log: (m) => logged.push(m), names: NAMES });
  assert.equal(records.filter((r) => r.source === "coderabbit").length, 0);
  assert.ok(logged.some((m) => /could not read the panel's verdict/.test(m)));
  assert.ok(logged.some((m) => /no evidence the panel ever reviewed/.test(m)));
});

test("harvestPr: agent authorship is NOT evidence that the panel reviewed the PR", () => {
  // Measured: of 11 agent PRs carrying CodeRabbit blockers, 9 have no
  // `agent-review-*` check run on any commit — they match `isAgentPr` by branch
  // prefix but never went through the panel. Trusting authorship would have filed
  // 15 rows about a reviewer that never looked.
  const api = fakeApi({
    "repos/{owner}/{repo}/pulls/548": { user: { login: "yorkie-agent[bot]" }, head: { ref: "agent/482-x" } },
    [`repos/{owner}/{repo}/commits/${SHA_BASE}/check-runs?per_page=100`]: [
      { check_runs: [{ id: 7, name: "verify-self (22.x)", app: { slug: "github-actions" }, status: "completed", conclusion: "success" }] },
    ],
    ...crComment(CR_MAJOR_CORRECTNESS),
  });
  const { records } = harvestPr(548, { api, log: () => {}, names: NAMES });
  assert.equal(records.filter((r) => r.source === "coderabbit").length, 0);
});

test("attributeToPanel: a matcher failure resolves to `maybe` — never a throw, never a suppression", () => {
  // The fail direction, and it is deliberately in the middle. Suppressing on
  // error would silently drop a real miss; emitting unflagged would restore the
  // noise the matcher exists to remove.
  const exploding = [{ get summary() { throw new Error("boom"); } }];
  const r = attributeToPanel({ file: "a.ts", summary: "anything", evidence: "" }, exploding);
  assert.equal(r.verdict, "maybe");
  assert.equal(r.error, "boom");
});

test("attributeToPanel: null blockers is 'not asked'; an empty array is a real answer", () => {
  const finding = { file: "a.ts", summary: "the guard is missing on the paste path", evidence: "" };
  assert.equal(attributeToPanel(finding, null).verdict, "");
  assert.equal(attributeToPanel(finding, []).verdict, "no");
});

test("attributeToPanel: compares LENS-NEUTRAL, so a lens mismatch cannot fake a miss", () => {
  // CodeRabbit's lens is a category guess and is often "". `findingSimilarity`
  // scores any lens mismatch 0 outright, so comparing on the raw lens would file
  // every CodeRabbit blocker the panel raised under a different lens as a miss.
  const cr = { lens: "", file: "a.ts", summary: "Blank skip in Arguments.iterate makes MIN and MAX return the wrong aggregate", evidence: "" };
  const panel = [{ lens: "test-adequacy", severity: "major", file: "a.ts", summary: "Blank skip in Arguments.iterate makes MIN and MAX return the wrong aggregate", evidence: "" }];
  assert.equal(attributeToPanel(cr, panel).verdict, "match");
});

// --- the on-demand panel's findings, read from its comment --------------------

const PANEL_SHA = "7".repeat(40);
const PANEL_BODY = [
  `<!-- agent-review:${PANEL_SHA} -->`,
  "### 🔴 Review panel: changes suggested",
  "",
  "❌ Correctness review: **changes requested** — 2 blocking (critical/major) finding(s) (1 critical, 1 major, 1 minor, 0 nit).",
  "",
  "Some prose the lens wrote.",
  "### Critical (1)",
  "- `scripts/agent/lenses/lenses.json:69` — `maxTurns: 3` with `samples: 1` makes turn exhaustion a hard blocking failure",
  "",
  "### Major (1)",
  "- `scripts/agent/review-panel.mjs:817-822` — The empty-slice early return skips the prior-round re-check _(verifier could not settle this)_",
  "",
  "### Minor (non-blocking) (1)",
  "- `scripts/agent/checks.mjs:18` — a minor note nobody should match against",
  "",
  "❌ Security review: **changes requested** — 1 blocking (critical/major) finding(s) (0 critical, 1 major, 0 minor, 0 nit).",
  "",
  "### Major (1)",
  "- `scripts/agent/lenses/lenses.json:18` — security's scopeClasses omit `design-spec`, so design docs get no security reviewer",
  "",
  "### Demoted — real, but not caused by this change (1)",
  "- `scripts/agent/ask.mjs:4` — pre-existing, must not be read as a finding",
].join("\n");

test("parsePanelComment: blocking findings only, across every lens section", () => {
  const p = parsePanelComment(PANEL_BODY);
  assert.equal(p.reviewedSha, PANEL_SHA);
  assert.equal(p.findings.length, 3); // 1 critical + 2 major, from two lenses
  assert.deepEqual(p.findings.map((f) => f.severity).sort(), ["critical", "major", "major"]);
  // Minor, nit and DEMOTED rows are not findings to match against. Demoted
  // especially: it is the panel saying "real, but not caused by this change", so
  // suppressing a CodeRabbit blocker against it would be plainly wrong.
  const summaries = p.findings.map((f) => f.summary).join(" ");
  assert.doesNotMatch(summaries, /minor note nobody/);
  assert.doesNotMatch(summaries, /pre-existing/);
});

test("parsePanelComment: the :line suffix leaves `file` but survives in `evidence`", () => {
  // The line numbers are the sharpest location signal in the row, and extractAnchor
  // reads summary+evidence — so they must not be discarded with the suffix.
  const p = parsePanelComment(PANEL_BODY);
  const f = p.findings.find((x) => /empty-slice/.test(x.summary));
  assert.equal(f.file, "scripts/agent/review-panel.mjs");
  assert.match(f.evidence, /817-822/);
});

test("parsePanelComment: rows enriched by the Phase 2 renderer still round-trip", () => {
  // Cross-module contract with severity.mjs's renderSummaryMd: the corpus
  // reader parses the RENDERED body, so every enrichment (a `file:line`
  // locator, a verifier-outcome marker, an indented adjudication sub-bullet,
  // the Author-reported skips section) must leave the row parseable and must
  // not add phantom findings. Uses the real renderer, not a hand-typed copy of
  // its output, so a drift fails here instead of in the corpus.
  const body = [
    `<!-- agent-review:${PANEL_SHA} -->`,
    "### 🔴 Review panel: changes suggested",
    "",
    renderSummaryMd("Correctness review", [
      { severity: "major", file: "a.mjs", line: 214, summary: "redo misses the guard",
        verification: "confirmed-high",
        adjudication: { upheld: 1, verdict: "upheld", reason: "covers undo only" } },
      { severity: "major", file: "b.mjs", summary: "skipped one",
        adjudication: { upheld: 1, verdict: "skipped-by-author", reason: "tracked in #701" } },
    ], "prose"),
  ].join("\n");
  const p = parsePanelComment(body);
  // Two blocking rows — the adjudication sub-bullets, the author-note bullet
  // and the skips-section rows must not parse as additional findings.
  assert.equal(p.findings.length, 2);
  const [f, g] = p.findings;
  assert.equal(f.file, "a.mjs"); // :214 stripped from `file`…
  assert.match(f.evidence, /a\.mjs:214/); // …but kept in `evidence` for extractAnchor
  assert.match(f.summary, /redo misses the guard/);
  assert.equal(g.file, "b.mjs");
});

test("parsePanelComment: not a panel comment → null, not an empty finding set", () => {
  assert.equal(parsePanelComment("### Critical (1)\n- `a.ts` — forged"), null);
  assert.equal(parsePanelComment("<!-- agent-metrics-summary -->\n### Critical (1)\n- `a.ts` — x"), null);
  assert.equal(parsePanelComment("<!-- agent-review:nothex -->"), null);
  for (const bad of [null, undefined, 7, {}]) assert.equal(parsePanelComment(bad), null);
});

test("panelFindingsFromComments: ONLY the App may author panel findings", () => {
  // A security gate, not tidiness. These findings can SUPPRESS a CodeRabbit
  // candidate, so anyone who could forge a panel comment could silence real misses
  // with no trace in the corpus. The marker alone is not enough — any user can type
  // it. On #578 a real CodeRabbit comment contains "Review panel", so a
  // content-only match already mis-fires before anyone tries.
  const forged = [{ user: { login: "attacker" }, body: PANEL_BODY }];
  assert.equal(panelFindingsFromComments(forged), null);
  const real = [{ user: { login: "yorkie-agent[bot]" }, body: PANEL_BODY }];
  assert.equal(panelFindingsFromComments(real).findings.length, 3);
  assert.equal(panelFindingsFromComments([{ user: { login: "app/yorkie-agent" }, body: PANEL_BODY }]).findings.length, 3);
});

test("panelFindingsFromComments: the UNION of every review, not the newest", () => {
  // The record claims "the panel did not raise this". A finding raised in an
  // earlier review is one the panel raised, so keying on the newest review would
  // write a false row into an eval corpus.
  const second = PANEL_BODY.replace("empty-slice early return skips the prior-round re-check", "a different defect entirely here");
  const got = panelFindingsFromComments([
    { user: { login: "yorkie-agent[bot]" }, body: PANEL_BODY },
    { user: { login: "yorkie-agent[bot]" }, body: second },
  ]);
  assert.equal(got.findings.length, 6);
  assert.equal(got.reviewedSha, PANEL_SHA); // first established sha wins
});

test("panelFindingsFromComments: never reviewed on demand → null", () => {
  assert.equal(panelFindingsFromComments([{ user: { login: "yorkie-agent[bot]" }, body: "## 🤝 Ready for human review" }]), null);
  for (const bad of [null, undefined, "x", 7]) assert.equal(panelFindingsFromComments(bad), null);
});

test("harvestPr: with no check runs, the on-demand comment becomes the comparison set", () => {
  // The population this unlocks: a human PR reviewed via `@claude review`, where the
  // panel records no check runs at all, so the count-based harvester filed every
  // CodeRabbit blocker as a miss.
  const crBody = [
    "_🎯 Functional Correctness_ | _🟠 Major_ | _⚡ Quick win_",
    "",
    "**Security lens scopeClasses is missing `design-spec`.**",
    "",
    "security's scopeClasses omit `design-spec`, so design docs get no security reviewer at all.",
  ].join("\n");
  const api = fakeApi({
    "repos/{owner}/{repo}/issues/548/comments?per_page=100": [
      { body: HANDOFF_MARKER, created_at: HANDOFF },
      { user: { login: "yorkie-agent[bot]" }, body: PANEL_BODY },
    ],
    [`repos/{owner}/{repo}/commits/${SHA_BASE}/check-runs?per_page=100`]: [{ check_runs: [] }],
    "repos/{owner}/{repo}/pulls/548/comments?per_page=100": [
      { id: 42, user: { login: "coderabbitai[bot]" }, path: "scripts/agent/lenses/lenses.json", body: crBody },
    ],
  });
  const logged = [];
  const { records, suppressed } = harvestPr(548, { api, log: (m) => logged.push(m), names: NAMES });
  assert.equal(suppressed, 1);
  assert.equal(records.filter((r) => r.source === "coderabbit").length, 0);
  assert.ok(logged.some((m) => /restates a panel finding/.test(m)));
  // No "using the on-demand comment as a fallback" line any more, and its absence is
  // the point: an advisory review is now a ROUND like any other rather than a
  // whole-PR substitute reached only when check runs are missing. There is nothing to
  // announce, because nothing was substituted.
  assert.ok(!logged.some((m) => /using the on-demand panel comment/.test(m)));
});

test("harvestPr: real check runs WIN over the comment", () => {
  // Check runs are the structured record; the comment is a rendering of one. An
  // autonomous panel that genuinely raised nothing has already answered the
  // question, and a comment from a different review would answer a different one.
  const api = fakeApi({
    "repos/{owner}/{repo}/issues/548/comments?per_page=100": [
      { body: HANDOFF_MARKER, created_at: HANDOFF },
      { user: { login: "yorkie-agent[bot]" }, body: PANEL_BODY },
    ],
    ...crComment(CR_MAJOR_CORRECTNESS),
  });
  const logged = [];
  const { records, suppressed } = harvestPr(548, { api, log: (m) => logged.push(m), names: NAMES });
  // fakeApi's default check run is a clean `[]` — a real, empty answer.
  assert.equal(suppressed, 0);
  assert.equal(records.find((r) => r.source === "coderabbit").panelSaw.matchVerdict, "no");
  assert.ok(!logged.some((m) => /using the on-demand panel comment/.test(m)));
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
  assert.deepEqual(fix.panelSaw, EMPTY_PANEL_SAW);
});

test("harvestPr: 'could not look' never reads the same as 'nothing found'", () => {
  // Nothing examinable: NO PANEL ROUND (so there is no approval for signature 1 and
  // nothing for signature 2 to compare against) and no review comments. Only this
  // shape sets `skipped`.
  //
  // Dropping the check runs is now part of the fixture, and that is the change: with
  // them present this PR IS examinable — a successful round is an approval, and the
  // human commit after it is a candidate — even with no marker comment anywhere. That
  // is the 18-of-33 agent PRs the old marker-only cutoff could not see.
  const nothing = harvestPr(548, {
    api: fakeApi({
      "repos/{owner}/{repo}/issues/548/comments?per_page=100": [],
      "repos/{owner}/{repo}/pulls/548/comments?per_page=100": [],
      [`repos/{owner}/{repo}/commits/${SHA_BASE}/check-runs?per_page=100`]: [{ check_runs: [] }],
    }),
    log: () => {},
    names: NAMES,
  });
  assert.deepEqual(nothing.records, []);
  assert.match(nothing.skipped, /nothing to examine/);

  // The same PR WITH its check runs: no marker, no ready_for_review, still harvested.
  const noMarker = harvestPr(548, {
    api: fakeApi({
      "repos/{owner}/{repo}/issues/548/comments?per_page=100": [],
      "repos/{owner}/{repo}/pulls/548/comments?per_page=100": [],
    }),
    log: () => {},
    names: NAMES,
  });
  assert.equal(noMarker.skipped, "");
  assert.equal(noMarker.records.filter((r) => r.source === "human-fix").length, 1);
  assert.equal(noMarker.records[0].handoffAt, "2026-07-24T15:40:00Z");

  // An ADVISORY review and nothing else: signature 1 is silently inapplicable —
  // `@claude review` is not an approval — signature 2 runs against the comment round,
  // and the record carries handoffAt "" rather than a guess. This is the shape the
  // relaxation exists for, and it is now expressed by the absence of a SUCCESS round
  // rather than the absence of a marker comment.
  const advisoryOnly = harvestPr(548, {
    api: fakeApi({
      "repos/{owner}/{repo}/issues/548/comments?per_page=100": [
        { user: { login: "yorkie-agent[bot]" }, body: PANEL_BODY },
      ],
      [`repos/{owner}/{repo}/commits/${SHA_BASE}/check-runs?per_page=100`]: [{ check_runs: [] }],
      ...crComment(CR_MAJOR_CORRECTNESS),
    }),
    log: () => {},
    names: NAMES,
  });
  assert.equal(advisoryOnly.skipped, "");
  assert.equal(advisoryOnly.records.filter((r) => r.source === "human-fix").length, 0);
  assert.equal(advisoryOnly.records.filter((r) => r.source === "coderabbit").length, 1);
  assert.equal(advisoryOnly.records[0].handoffAt, "");
  assert.equal(advisoryOnly.records[0].panelSaw.matchVerdict, "no");

  // THE LIMITATION THIS CHANGE REMOVES, now asserted in the opposite direction.
  // It used to read: "without a hand-off there is no `headAtHandoff`, so lens CHECK
  // RUNS are never read — only the comment path reaches signature 2 here." That was
  // signature 2 depending on signature 1's cutoff, and it withheld every CodeRabbit
  // candidate on a PR whose check runs were readable the whole time.
  const noMarkerNoComment = harvestPr(548, {
    api: fakeApi({ "repos/{owner}/{repo}/issues/548/comments?per_page=100": [] }),
    log: () => {},
    names: NAMES,
  });
  assert.equal(noMarkerNoComment.records.filter((r) => r.source === "coderabbit").length, 1);
  // …and it is compared against the CHECK RUNS, not a comment there is none of.
  const fromRuns = noMarkerNoComment.records.find((r) => r.source === "coderabbit");
  assert.equal(fromRuns.panelSaw.conclusion, "success");
  assert.equal(fromRuns.panelSaw.reviewedSha, SHA_BASE);

  // An unreadable COMMITS list costs the check-run path — rounds are walked over it —
  // so the panel cannot be established and signature 2 withholds too. Documented
  // rather than worked around: it is the recoverable direction, and a re-harvest
  // re-proposes the candidate.
  const noCommits = harvestPr(548, {
    api: fakeApi({ "repos/{owner}/{repo}/pulls/548/commits?per_page=100": new Error("502") }),
    log: () => {},
    names: NAMES,
  });
  assert.equal(noCommits.records.length, 0);

  // But the COMMENT path needs no commits at all, so the same outage on a PR with an
  // on-demand review still yields its CodeRabbit candidate. The two sources fail
  // independently, which is the point of having two.
  const noCommitsWithPanel = harvestPr(548, {
    api: fakeApi({
      "repos/{owner}/{repo}/pulls/548/commits?per_page=100": new Error("502"),
      "repos/{owner}/{repo}/issues/548/comments?per_page=100": [
        { body: HANDOFF_MARKER, created_at: HANDOFF },
        { user: { login: "yorkie-agent[bot]" }, body: PANEL_BODY },
      ],
    }),
    log: () => {},
    names: NAMES,
  });
  assert.equal(noCommitsWithPanel.records.filter((r) => r.source === "coderabbit").length, 1);
});

// --- the four cutoff bugs, one test each ------------------------------------
//
// Each of these FAILS on the marker-based cutoff this replaces. They are the reason
// the change exists, so they are named after the failure rather than the mechanism.

test("cutoff bug 1: no marker anywhere still harvests, from the check runs", () => {
  // Measured population: 18 of 33 agent PRs were opened ready rather than promoted,
  // so they carry neither a hand-off marker nor a `ready_for_review` event. The old
  // cutoff had nothing to key on, which silenced signature 1 AND — because signature
  // 2 read the panel through signature 1's commit — every CodeRabbit candidate too.
  const api = fakeApi({
    "repos/{owner}/{repo}/issues/548/comments?per_page=100": [],
    "repos/{owner}/{repo}/issues/548/timeline?per_page=100": [],
    ...crComment(CR_MAJOR_CORRECTNESS),
  });
  const { records, skipped } = harvestPr(548, { api, log: () => {}, names: NAMES });
  assert.equal(skipped, "");
  assert.deepEqual(records.map((r) => r.source).sort(), ["coderabbit", "human-fix"]);
  assert.equal(records.find((r) => r.source === "human-fix").handoffAt, "2026-07-24T15:40:00Z");
});

test("cutoff bug 2: a manually-readied PR the panel never approved harvests NOTHING", () => {
  // `ready_for_review` fires whether or not the panel ever spoke, so keying the
  // cutoff off it made every later human commit a candidate on a PR no reviewer had
  // passed. The signal is gone; the absence of a SUCCESS round is now what decides.
  const api = fakeApi({
    "repos/{owner}/{repo}/issues/548/comments?per_page=100": [],
    // The event that used to be the fallback cutoff, now ignored entirely.
    "repos/{owner}/{repo}/issues/548/timeline?per_page=100": [
      { event: "ready_for_review", created_at: "2026-07-24T15:48:25Z" },
    ],
    [`repos/{owner}/{repo}/commits/${SHA_BASE}/check-runs?per_page=100`]: [{ check_runs: [] }],
    "repos/{owner}/{repo}/pulls/548/comments?per_page=100": [],
  });
  const { records, skipped } = harvestPr(548, { api, log: () => {}, names: NAMES });
  assert.deepEqual(records, []);
  assert.match(skipped, /no panel approval/);
});

test("cutoff bug 3: a rebase after approval no longer erases the comparison set", () => {
  // The sharpest one. A force-push rewrites every committer date on the PR, so with a
  // comment-based cutoff EVERY commit post-dated it, `beforeHandoff` emptied, and the
  // check runs were never read — leaving signature 2 with no comparison set on a PR
  // whose verdict was sitting right there. `completed_at` is stamped by GitHub on the
  // check run and a rebase cannot move it.
  const rebased = [
    { sha: SHA_BASE, parents: [{ sha: "0" }], author: { type: "Bot" }, commit: { message: "agent work", committer: { date: "2026-07-30T00:00:00Z" } } },
    { sha: SHA_FIX, parents: [{ sha: SHA_BASE }], author: { login: "harrykim8672", type: "User" }, html_url: "https://x/commit", commit: { message: "Guard EditorAPI.paste()", committer: { date: "2026-07-30T00:01:00Z" } } },
  ];
  const api = fakeApi({
    "repos/{owner}/{repo}/pulls/548/commits?per_page=100": rebased,
    ...crComment(CR_MAJOR_CORRECTNESS),
  });
  const { records } = harvestPr(548, { api, log: () => {}, names: NAMES });
  // The CodeRabbit candidate is compared against the real verdict, not withheld.
  const cr = records.find((r) => r.source === "coderabbit");
  assert.ok(cr, "the CodeRabbit candidate must survive a rebase");
  assert.equal(cr.panelSaw.conclusion, "success");
  assert.equal(cr.panelSaw.reviewedSha, SHA_BASE);
});

test("cutoff bug 4: a finding is compared against what the panel knew BY THEN", () => {
  // The comparison set used to be ONE set per PR, read from whichever commit was head
  // at hand-off, and applied to every CodeRabbit finding regardless of which commit it
  // was about. That is wrong in both directions, and which one you get depends only on
  // where the hand-off commit happens to sit:
  //
  //   - hand-off commit EARLIER than the finding → the set misses rounds the panel had
  //     already reached, so a genuine restatement is filed as a miss. Measured: that is
  //     what this fixture produced before the change (`suppressed: 0` on 4b).
  //   - hand-off commit LATER than the finding → the set includes rounds that did not
  //     exist yet, so a real miss is suppressed by a finding from the future.
  //
  // The first costs a false row, the second costs a real one. Anchoring per comment
  // removes both, and the two halves below pin the boundary from either side: the panel
  // raises the defect only at SHA_FIX, so the same comment must be a miss on SHA_BASE
  // and a restatement on SHA_FIX.
  //
  // 4a is a REGRESSION GUARD rather than a fixed bug — the old code also left it
  // unsuppressed, for the wrong reason. It is here because the new per-comment logic is
  // the thing that could newly over-suppress it.
  const laterRound = {
    [`repos/{owner}/{repo}/commits/${SHA_BASE}/check-runs?per_page=100`]: [{ check_runs: [
      { id: 1, name: "agent-review-correctness", app: { slug: "github-actions" }, status: "completed", conclusion: "success", completed_at: "2026-07-24T15:40:00Z", output: { text: "[]" } },
    ] }],
    [`repos/{owner}/{repo}/commits/${SHA_FIX}/check-runs?per_page=100`]: [{ check_runs: [
      { id: 2, name: "agent-review-correctness", app: { slug: "github-actions" }, status: "completed", conclusion: "failure", completed_at: "2026-07-26T09:00:00Z" },
    ] }],
    "repos/{owner}/{repo}/check-runs/1": { id: 1, name: "agent-review-correctness", conclusion: "success", output: { text: "[]" } },
    "repos/{owner}/{repo}/check-runs/2": { id: 2, name: "agent-review-correctness", conclusion: "failure", output: { text: JSON.stringify([{ severity: "major", file: "packages/docs/src/view/text-editor.ts", summary: "Guard public mutation APIs at the read-only boundary: EditorAPI.paste() reaches TextEditor.pasteContent() unguarded and mutates a viewer-mode document.", evidence: "" }]) } },
  };
  const onEarly = harvestPr(548, {
    api: fakeApi({ ...laterRound, ...crComment(CR_MAJOR_CORRECTNESS) }),
    log: () => {}, names: NAMES,
  });
  assert.equal(onEarly.suppressed, 0, "a later round cannot suppress an earlier finding");
  assert.equal(onEarly.records.filter((r) => r.source === "coderabbit").length, 1);

  // The identical comment, moved onto the commit the panel raised it at.
  const onLate = harvestPr(548, {
    api: fakeApi({
      ...laterRound,
      "repos/{owner}/{repo}/pulls/548/comments?per_page=100": [
        { id: 999, user: { login: "coderabbitai[bot]" }, path: "packages/docs/src/view/text-editor.ts", original_commit_id: SHA_FIX, html_url: "https://x/d", body: CR_MAJOR_CORRECTNESS },
      ],
    }),
    log: () => {}, names: NAMES,
  });
  assert.equal(onLate.suppressed, 1, "at or after the round that raised it, it IS a restatement");
  assert.equal(onLate.records.filter((r) => r.source === "coderabbit").length, 0);
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
  // The on-demand search is routed to a clean empty result so this test speaks only
  // about the PR-list cap.
  const apiFor = (list) => (argv) =>
    argv.includes("nameWithOwner")
      ? { nameWithOwner: "wafflebase/wafflebase" }
      : argv.includes("search/issues")
        ? { total_count: 0, items: [] }
        : list;
  const logged = [];
  assert.equal(listCandidatePrs({ api: apiFor(full), log: (m) => logged.push(m) }).length, 200);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /cap.*NOT examined/s);

  // Under the cap, nothing is said.
  const quiet = [];
  listCandidatePrs({ api: apiFor(full.slice(0, 199)), log: (m) => quiet.push(m) });
  assert.deepEqual(quiet, []);
});

test("listCandidatePrs: agent PRs from the list, on-demand-reviewed PRs from search", () => {
  let listArgv = null, searchArgv = null;
  const api = (argv) => {
    if (argv.includes("nameWithOwner")) return { nameWithOwner: "wafflebase/wafflebase" };
    if (argv.includes("search/issues")) { searchArgv = argv; return { total_count: 1, items: [{ number: 9 }] }; }
    listArgv = argv;
    return [
      { number: 1, headRefName: "agent/1-x", author: { login: "harrykim8672" } },
      { number: 2, headRefName: "feat/y", author: { login: "harrykim8672" } },
      { number: 3, headRefName: "feat/z", author: { login: "app/yorkie-agent" } },
    ];
  };
  // 1 and 3 are agent PRs; 2 is not, but 9 was reviewed on demand — which is the
  // right question for signature 2 and one authorship cannot answer.
  assert.deepEqual(listCandidatePrs({ since: "2026-07-01", api, log: () => {} }), [1, 3, 9]);
  assert.ok(listArgv.includes("--search") && listArgv.includes("merged:>=2026-07-01"));
  assert.ok(searchArgv.some((a) => String(a).includes("agent-review:")));
  assert.ok(searchArgv.some((a) => String(a).includes("merged:>=2026-07-01")));

  // No --since → no search term at all, rather than an empty one.
  listCandidatePrs({ api, log: () => {} });
  assert.ok(!listArgv.includes("--search"));

  for (const junk of [null, "x", 7, {}]) {
    assert.deepEqual(listCandidatePrs({ api: () => junk, log: () => {} }), []);
  }
});

test("listCandidatePrs: a search outage costs the on-demand PRs, never the agent ones", () => {
  // Same fail direction as every other read: degrade to fewer candidates.
  const api = (argv) => {
    if (argv.includes("nameWithOwner")) return { nameWithOwner: "wafflebase/wafflebase" };
    if (argv.includes("search/issues")) throw new Error("422 rate limited");
    return [{ number: 1, headRefName: "agent/1-x", author: { login: "harrykim8672" } }];
  };
  const logged = [];
  assert.deepEqual(listCandidatePrs({ api, log: (m) => logged.push(m) }), [1]);
  assert.ok(logged.some((m) => /could not search for on-demand-reviewed PRs/.test(m)));
});

test("listCandidatePrs: a capped search is REPORTED, not silently truncated", () => {
  const api = (argv) =>
    argv.includes("nameWithOwner")
      ? { nameWithOwner: "wafflebase/wafflebase" }
      : argv.includes("search/issues")
        ? { total_count: 500, items: [{ number: 9 }] }
        : [];
  const logged = [];
  listCandidatePrs({ api, log: (m) => logged.push(m) });
  assert.ok(logged.some((m) => /500 on-demand-reviewed PR\(s\) matched but only 1/.test(m)));
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
