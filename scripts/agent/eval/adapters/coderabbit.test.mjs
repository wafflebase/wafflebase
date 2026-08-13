// Every CodeRabbit body below is VERBATIM from this repository's API, pinned with
// its pull request and its comment or review id so anyone can re-fetch and diff it.
// Truncated at the end only — never edited. A hand-written header only proves the
// mapping matches its author's idea of the format, which is how the three-field-only
// parser shipped in the first place.
//
// Re-fetch any of them with:
//   GH_REPO=wafflebase/wafflebase gh api repos/{owner}/{repo}/pulls/comments/<id>
//   GH_REPO=wafflebase/wafflebase gh api repos/{owner}/{repo}/pulls/<pr>/reviews
//
// The inline fixtures keep the fields this adapter READS plus the verbatim body;
// the ~30 other fields a real comment object carries are unread and omitted. Which
// fields those are is itself asserted — see "reads the line from the same snapshot".
//
// Nothing here calls a model, spawns a panel or touches the network: the only
// function in the module that does is `fetchCodeRabbitPr`, and the tests inject an
// `api` in its place.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { KNOWN } from "../../vendor/pipeline/severity.mjs";
import { buildItemMeta } from "../extract-corpus.mjs";
import { EvalStore } from "../store.mjs";
import { ARM_ONLY_FIELDS, gatingCensus, validateFindingRecord } from "../finding-record.mjs";
import {
  SEVERITY_BASIS,
  TIER_SEVERITY,
  UNSTATED_SEVERITY,
  WINDOW,
  WINDOW_BASIS,
  checkArmFields,
  codeRabbitItemId,
  codeRabbitRecords,
  corpusRecords,
  fetchCodeRabbitPr,
  inlineFinding,
  placeInWindow,
  reviewBodyFindings,
  severityOf,
} from "./coderabbit.mjs";

const BOT = { login: "coderabbitai[bot]" };

// --- inline comments, one per header vintage --------------------------------

// comment 3566343388 (PR #471, 2026-07-12) — three-field, CHILL vocabulary, and a
// PILOT ITEM: its `original_commit_id` IS pr-471's frozen `review_commit`, which
// makes it one of the three in-window findings in the whole pilot.
const CR_THREE_FIELD = {
  id: 3566343388,
  path: "docs/tasks/active/20260712-checkbox-validation-bugfix-todo.md",
  line: null,
  original_line: 26,
  start_line: null,
  original_start_line: 25,
  commit_id: "e8e729031dae38a8ea612f5305729d2f78bd69d5",
  original_commit_id: "42d17c8d81b9fa0bac6be942d06c3e1e455b1a94",
  pull_request_review_id: 4680080028,
  created_at: "2026-07-12T12:59:36Z",
  html_url: "https://github.com/wafflebase/wafflebase/pull/471#discussion_r3566343388",
  user: BOT,
  body:
    "_📐 Maintainability & Code Quality_ | _🟡 Minor_ | _⚡ Quick win_\n\n" +
    "**Mark the old scope note as superseded.**\n\n" +
    "The “no custom `checkedValue`” wording is narrower than the implemented contract.\n",
};

// comment 3474296159 (PR #415, 2026-06-25) — TWO-field, and the force-push case:
// `51c01826a` is not on PR #415 any more, which has exactly one commit.
const CR_TWO_FIELD = {
  id: 3474296159,
  path: "packages/backend/src/datasource/datasource.service.ts",
  line: null,
  original_line: 145,
  start_line: null,
  original_start_line: 143,
  commit_id: "51c01826aa9f05e4cef9ee498668e3f2321b3602",
  original_commit_id: "51c01826aa9f05e4cef9ee498668e3f2321b3602",
  pull_request_review_id: 4570809619,
  created_at: "2026-06-25T12:20:55Z",
  html_url: "https://github.com/wafflebase/wafflebase/pull/415#discussion_r3474296159",
  user: BOT,
  body:
    "_🎯 Functional Correctness_ | _🟠 Major_\n\n" +
    "**Avoid using `SET DateStyle` to normalize output**\n\n" +
    "This session setting alters input parsing semantics, not just output formatting.\n",
};

// comment 2041100249 (PR #11, 2025-04-13) — ONE italic field, and it is a CATEGORY.
// This vintage has no severity field at all, which is the `unstated` case.
const CR_SINGLE_ITALIC = {
  id: 2041100249,
  path: "packages/backend/src/auth/github-auth.guard.ts",
  line: null,
  original_line: 15,
  start_line: null,
  original_start_line: 6,
  commit_id: "142ee281ebd48bafba42322d5f206e032976a7c4",
  original_commit_id: "d04070191ad1dd73215230a6809545a12b1c783a",
  pull_request_review_id: 2762735943,
  created_at: "2025-04-13T11:05:56Z",
  html_url: "https://github.com/wafflebase/wafflebase/pull/11#discussion_r2041100249",
  user: BOT,
  body:
    "_⚠️ Potential issue_\n\n" +
    "**Potential security risk with unvalidated returnTo parameter.**\n\n" +
    "The `returnTo` parameter from the query string is stored directly in the session without validation.\n",
};

// comment 1702452902 (PR #6, 2024-08-03) — no header at all, straight to the bolded
// title. The only vintage where `line` is populated rather than null.
const CR_BOLD_TITLE = {
  id: 1702452902,
  path: "src/worksheet/sheet.ts",
  line: 175,
  original_line: 175,
  start_line: 163,
  original_start_line: 163,
  commit_id: "3b90daf77a3ac7f85ceae5bc76a060cc0c9ad21b",
  original_commit_id: "3b90daf77a3ac7f85ceae5bc76a060cc0c9ad21b",
  pull_request_review_id: 2216686007,
  created_at: "2024-08-03T04:21:40Z",
  html_url: "https://github.com/wafflebase/wafflebase/pull/6#discussion_r1702452902",
  user: BOT,
  body:
    "**Consider optimizing the `hasContents` method.**\n\n" +
    "The current implementation iterates through each reference in the range and checks the store.\n",
};

// A real threaded reply — CodeRabbit acknowledging a fix. Not a finding, and 6 of
// the 22 CodeRabbit inline comments on the pilot items are of this shape.
// comment 3563051576 (PR #465, 2026-07-11).
const CR_REPLY = {
  id: 3563051576,
  path: "docs/design/documents-last-modified.md",
  original_line: 71,
  original_start_line: 71,
  commit_id: "d0894e281b8b6b3d0e3a9d2a9e2b8e7d9c1a2b3c",
  original_commit_id: "49f4fc822d0a0e5b6c7d8e9f0a1b2c3d4e5f6a7b",
  created_at: "2026-07-11T03:32:35Z",
  user: BOT,
  body: "`@hackerwins` Thanks for confirming — that resolves the MD040 warning.\n",
};

// --- review bodies, one per tier --------------------------------------------

const rv = (id, commit, at, lines) => ({
  id,
  commit_id: commit,
  submitted_at: at,
  html_url: `https://github.com/wafflebase/wafflebase/pull/0#pullrequestreview-${id}`,
  user: BOT,
  body: lines.join("\n"),
});

// review 4689753702 (PR #476, 2026-07-13). Nitpick, with the severity CodeRabbit
// states for that tier: `Trivial`, which `harvest.mjs` maps to `nit`.
const RV_NITPICK_STATED = rv(4689753702, "a".repeat(40), "2026-07-13T23:42:45Z", [
  "<details>",
  "<summary>🧹 Nitpick comments (1)</summary><blockquote>",
  "",
  "<details>",
  "<summary>packages/frontend/src/app/slides/mobile-slides-view.tsx (1)</summary><blockquote>",
  "",
  "`271-276`: _📐 Maintainability & Code Quality_ | _🔵 Trivial_ | _⚡ Quick win_",
  "",
  "**Add the explicit `: void` return annotation.**",
  "",
  "The new named TypeScript function should follow the repository guideline.",
  "",
  "</blockquote></details>",
  "",
  "</blockquote></details>",
]);

// review 2796737621 (PR #11, 2025-04-27). Two tiers in one body, NEITHER stating a
// severity: nitpick (which the tier heading answers) and additional (which nothing
// answers). The 2025 vintage puts the bolded title on the locator line.
const RV_NITPICK_AND_ADDITIONAL_UNSTATED = rv(2796737621, "b".repeat(40), "2025-04-27T00:34:52Z", [
  "<details>",
  "<summary>🧹 Nitpick comments (1)</summary><blockquote>",
  "",
  "<details>",
  "<summary>packages/frontend/package.json (1)</summary><blockquote>",
  "",
  "`7-12`: **Add a type-check script**  ",
  "Since this is a TypeScript project, consider adding a `\"type-check\": \"tsc --noEmit\"` script.  ",
  "",
  "</blockquote></details>",
  "",
  "</blockquote></details>",
  "",
  "<details>",
  "<summary>🔇 Additional comments (2)</summary><blockquote>",
  "",
  "<details>",
  "<summary>packages/frontend/package.json (2)</summary>",
  "",
  "`1-6`: **Validate package metadata**  ",
  "Top-level fields are correctly configured for a private monorepo package.",
  "",
  "---",
  "",
  "`13-52`: **Dependencies look solid**  ",
  "The declared runtime dependencies align with the project's needs.",
  "",
  "</details>",
  "",
  "</blockquote></details>",
]);

// review 4050275857 (PR #103, 2026-04-02). ♻️ Duplicate — the same defect said
// twice, which double-counts any volume metric, so the tier rides on the record.
const RV_DUPLICATE = rv(4050275857, "c".repeat(40), "2026-04-02T12:18:30Z", [
  "<details>",
  "<summary>♻️ Duplicate comments (1)</summary><blockquote>",
  "",
  "<details>",
  "<summary>docs/design/docs-intent-preserving-edits.md (1)</summary><blockquote>",
  "",
  "`268-269`: _⚠️ Potential issue_ | _🟡 Minor_",
  "",
  "**The `normalizeInlines` signature still shows `Block → Block`.**",
  "",
  "This was flagged in a previous review as incorrect.",
  "",
  "</blockquote></details>",
  "",
  "</blockquote></details>",
]);

// review 4733724175 (PR #501, 2026-07-20). ⚠️ Outside diff range — a finding about
// code the pull request did not touch, and the whole section is `> `-quoted.
const RV_OUTSIDE_DIFF = rv(4733724175, "d".repeat(40), "2026-07-20T09:32:40Z", [
  "<details>",
  "> <summary>⚠️ Outside diff range comments (1)</summary><blockquote>",
  "> ",
  "> <details>",
  "> <summary>.github/workflows/agent-review-reply.yml (1)</summary><blockquote>",
  "> ",
  "> `81-92`: _🎯 Functional Correctness_ | _🟠 Major_ | _⚡ Quick win_",
  "> ",
  "> **Pin `anthropics/claude-code-action` to an immutable commit SHA.** `@v1` is mutable.",
  "> ",
  "> </blockquote></details>",
  "> ",
  "> </blockquote></details>",
]);

// review 4090620442 (PR #114, 2026-04-10). 🟡 Minor comments — the other tier whose
// heading names a severity. TRUNCATED after its first file sub-section, so the
// section still declares 8; the assertions below read the record, not the count.
const RV_MINOR = rv(4090620442, "e".repeat(40), "2026-04-10T15:14:44Z", [
  "<details>",
  "<summary>🟡 Minor comments (8)</summary><blockquote>",
  "",
  "<details>",
  "<summary>docs/design/docs/docs-docx-import-export.md-441-443 (1)</summary><blockquote>",
  "",
  "`441-443`: _⚠️ Potential issue_ | _🟡 Minor_",
  "",
  "**Update file-structure docs to match the implemented exporter helper file.**",
  "",
  "The table lists `docx-builder.ts`, but this PR’s export helper is `docx-templates.ts`.",
  "",
  "</blockquote></details>",
  "",
  "</blockquote></details>",
]);

// review 2796737005 (PR #11, 2025-04-27). 🛑 Comments failed to post, with the BARE
// locator — no backticks — and a single italic field.
const RV_FAILED_TO_POST = rv(2796737005, "f".repeat(40), "2025-04-27T00:31:20Z", [
  "<details>",
  "<summary>🛑 Comments failed to post (1)</summary><blockquote>",
  "",
  "<details>",
  "<summary>.github/workflows/publish-ghpage.yml (1)</summary><blockquote>",
  "",
  "36-37: _⚠️ Potential issue_",
  "",
  "**Invalid publish directory path**  ",
  "`publish_dir` is set to `frontend/dist`, but the monorepo layout uses `packages/frontend/dist`.  ",
  "",
  "</blockquote></details>",
  "",
  "</blockquote></details>",
]);

// review 2216686007 (PR #6, 2024-08-03). The COMBINED title, which names three
// tiers at once and is therefore ambiguous about severity by construction.
const RV_COMBINED = rv(2216686007, "0".repeat(40), "2024-08-03T04:21:41Z", [
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
]);

/** A PR commit list, as `pulls/{n}/commits` returns one: chronological. */
const commits = (...shas) => shas.map((sha) => ({ sha }));

const one = (over = {}, opts) => codeRabbitRecords({ pr: 471, ...over }, opts);

// --- the item scoping rule ---------------------------------------------------

test("placeInWindow: every basis, and the value each one means", () => {
  const list = commits("aa", "bb", "cc");
  assert.deepEqual(placeInWindow({ commits: list, reviewCommit: "bb", atCommit: "aa" }), {
    window: "in-window",
    window_basis: "commit-at-or-before-review",
  });
  // AT the review commit is IN the window, not after it: the panel is shown the
  // diff at that commit, so a finding written on it is a finding about code the
  // panel saw. An exclusive bound would drop the two real pilot findings that
  // sit exactly on the frozen commit — which is every in-window finding pr-471 has.
  // Its own basis, because the answer comes from the two shas and not from the
  // list: `commit-at-or-before-review` would be true of it but would claim the
  // list was consulted.
  assert.deepEqual(placeInWindow({ commits: list, reviewCommit: "bb", atCommit: "bb" }), {
    window: "in-window",
    window_basis: "commit-is-review-commit",
  });
  assert.deepEqual(placeInWindow({ commits: list, reviewCommit: "bb", atCommit: "cc" }), {
    window: "after-window",
    window_basis: "commit-after-review",
  });
  assert.deepEqual(placeInWindow({ commits: list, reviewCommit: "bb", atCommit: "zz" }), {
    window: "unplaceable",
    window_basis: "commit-not-on-pr",
  });
  assert.deepEqual(placeInWindow({ commits: list, reviewCommit: "bb", atCommit: "" }), {
    window: "unplaceable",
    window_basis: "commit-absent",
  });
  assert.deepEqual(placeInWindow({ commits: list, reviewCommit: "zz", atCommit: "aa" }), {
    window: "unplaceable",
    window_basis: "review-commit-not-on-pr",
  });
  assert.deepEqual(placeInWindow({ commits: null, reviewCommit: "bb", atCommit: "aa" }), {
    window: "unplaceable",
    window_basis: "commits-unavailable",
  });
  assert.deepEqual(placeInWindow({ commits: [], reviewCommit: "bb", atCommit: "aa" }), {
    window: "unplaceable",
    window_basis: "commits-unavailable",
  });
  assert.deepEqual(placeInWindow({ commits: list, reviewCommit: "", atCommit: "aa" }), {
    window: "no-window",
    window_basis: "no-review-commit",
  });
  assert.deepEqual(placeInWindow(), { window: "no-window", window_basis: "no-review-commit" });
});

test("placeInWindow: the ordering is load-bearing in both directions", () => {
  // No frozen commit wins over an unreadable commit list: an off-corpus call must
  // not report `unplaceable`, which would make "how much could we not place?"
  // scale with how many unfrozen PRs somebody asked about.
  assert.equal(placeInWindow({ commits: null, reviewCommit: "", atCommit: "" }).window, "no-window");
  // An unlocatable WINDOW wins over the finding's own commit. Reporting
  // `after-window` because the review commit resolved to -1 would put every
  // finding on the wrong side of a line that was never drawn.
  assert.equal(
    placeInWindow({ commits: commits("aa"), reviewCommit: "nope", atCommit: "aa" }).window_basis,
    "review-commit-not-on-pr",
  );
  // …including when the FINDING's commit is also unusable. This is the case that
  // actually pins the order: with both broken, the two checks give different
  // answers, and only the window's is right — an unlocatable window invalidates
  // every finding on the item, so blaming the finding names the wrong cause and
  // makes a whole-item failure look like a per-finding one.
  assert.equal(
    placeInWindow({ commits: commits("aa"), reviewCommit: "nope", atCommit: "" }).window_basis,
    "review-commit-not-on-pr",
  );
});

test("placeInWindow: WINDOW and WINDOW_BASIS are one vocabulary, stated twice", () => {
  for (const [basis, value] of Object.entries(WINDOW_BASIS)) {
    assert.ok(WINDOW.includes(value), `basis ${basis} means ${value}, which is not in WINDOW`);
  }
  // Every value is reachable. A value no basis produces is a value nothing can
  // ever mean, which is how a vocabulary rots without a test noticing.
  for (const value of WINDOW) {
    assert.ok(Object.values(WINDOW_BASIS).includes(value), `no basis produces ${value}`);
  }
});

test("placeInWindow: PR #415's real force-pushed commit is unplaceable, not a side", () => {
  // PR #415 has ONE commit, and CodeRabbit's only review sits on `51c01826a`,
  // which is not it. `harvest.mjs` documents this trap; reading it as either side
  // of the line would be a confident answer about a commit nobody has.
  const placed = placeInWindow({
    commits: commits("eeda30c751a4d215924bd8ecd379f769b869be6b"),
    reviewCommit: "eeda30c751a4d215924bd8ecd379f769b869be6b",
    atCommit: CR_TWO_FIELD.original_commit_id,
  });
  assert.deepEqual(placed, { window: "unplaceable", window_basis: "commit-not-on-pr" });
});

test("placeInWindow: the finding's own commit IS the frozen one, on a PR that no longer lists it", () => {
  // The same pull request as the test above, frozen at the OTHER commit — which is
  // the shape that broke the function. #415's review sits on `51c01826a`; freeze
  // the item there and the finding is in-window BY CONSTRUCTION, because the frozen
  // commit and the finding's commit are the same object. The pull request's commit
  // list still does not contain it — the force-push that removed it happened after
  // CodeRabbit reviewed, and `51c01826a` compares as `diverged` against the head,
  // ahead 3 / behind 1 — and that is exactly the input the old order got wrong:
  // it asked for the frozen commit's POSITION first, found none, and answered
  // `unplaceable` about a finding it was looking straight at.
  const placed = placeInWindow({
    commits: commits("eeda30c751a4d215924bd8ecd379f769b869be6b"),
    reviewCommit: CR_TWO_FIELD.original_commit_id,
    atCommit: CR_TWO_FIELD.original_commit_id,
  });
  assert.deepEqual(placed, { window: "in-window", window_basis: "commit-is-review-commit" });
  // End to end, because this is an ITEM-shaped failure rather than a function-shaped
  // one: every one of pr-415's findings names this same commit, so the whole item
  // moved from `unplaceable` to `in-window` on this one comparison.
  const { records } = codeRabbitRecords({
    pr: 415,
    reviewCommit: CR_TWO_FIELD.original_commit_id,
    commits: commits("eeda30c751a4d215924bd8ecd379f769b869be6b"),
    comments: [CR_TWO_FIELD],
    reviews: [],
  });
  assert.equal(records[0].coderabbit.window, "in-window");
  assert.equal(records[0].coderabbit.window_basis, "commit-is-review-commit");
  assert.equal(records[0].coderabbit.review_commit, CR_TWO_FIELD.original_commit_id);
});

test("placeInWindow: identity answers ONLY identity — every unplaceable cause still fires", () => {
  // The test that matters. Widening a placement rule moves findings from "excluded,
  // and counted" into a comparison, which is the direction that flatters whichever
  // arm gains records — and nothing downstream would complain. So the case to pin is
  // not that the new branch fires, it is that the old ones still do.
  const list = commits("aa", "bb", "cc");
  // The window is unlocatable and the finding is on a DIFFERENT commit: still the
  // whole-item failure, still named as such. Note that NONE of the assertions in
  // this test can catch a mutation that moves the identity check back after the
  // bail — that is the previous test's job, and this one's is the opposite one.
  assert.deepEqual(placeInWindow({ commits: list, reviewCommit: "zz", atCommit: "aa" }), {
    window: "unplaceable",
    window_basis: "review-commit-not-on-pr",
  });
  // …including when the finding names no commit at all. Identity must not read
  // `""` as "the same as the frozen commit" for a frozen commit that is also
  // missing — the `no-review-commit` check above it is what guarantees that, so
  // both empty is `no-window`, never `in-window`.
  assert.deepEqual(placeInWindow({ commits: list, reviewCommit: "zz", atCommit: "" }), {
    window: "unplaceable",
    window_basis: "review-commit-not-on-pr",
  });
  assert.deepEqual(placeInWindow({ commits: list, reviewCommit: "", atCommit: "" }), {
    window: "no-window",
    window_basis: "no-review-commit",
  });
  // A finding on a commit that is neither the frozen one nor on the pull request.
  assert.deepEqual(placeInWindow({ commits: list, reviewCommit: "bb", atCommit: "zz" }), {
    window: "unplaceable",
    window_basis: "commit-not-on-pr",
  });
  // Still ordered, and still on the after side, for a commit that is not the
  // frozen one. Identity is an equality, not a widening of the bound.
  assert.deepEqual(placeInWindow({ commits: list, reviewCommit: "bb", atCommit: "cc" }), {
    window: "after-window",
    window_basis: "commit-after-review",
  });
  // An unreadable commit list wins over identity, deliberately: it is OUR failure
  // and it costs the whole item's placement, which the CLI reports in those words.
  assert.deepEqual(placeInWindow({ commits: null, reviewCommit: "bb", atCommit: "bb" }), {
    window: "unplaceable",
    window_basis: "commits-unavailable",
  });
  // Near-misses are not identity. `commitIndex` compares full shas exactly, and so
  // does this: a prefix that placed a finding would be a guess, and the fail
  // direction here is `unplaceable`.
  const sha = "51c01826aa9f05e4cef9ee498668e3f2321b3602";
  for (const near of [sha.slice(0, 7), sha.slice(0, 39), `${sha}0`, sha.toUpperCase()]) {
    assert.deepEqual(placeInWindow({ commits: commits(sha), reviewCommit: sha, atCommit: near }), {
      window: "unplaceable",
      window_basis: "commit-not-on-pr",
    }, `${near} was read as ${sha}`);
  }
});

// --- the severity translation ------------------------------------------------

test("severityOf: a stated severity passes through, with CodeRabbit's own word kept", () => {
  for (const s of KNOWN) {
    assert.deepEqual(severityOf({ severity: s, severityRaw: s }), {
      severity: s,
      stated_severity: s,
      severity_basis: "header-field",
    });
  }
  // `trivial` arrives ALREADY translated — `harvest.mjs` owns that table and this
  // module does not duplicate it — and the original word survives beside it.
  assert.deepEqual(severityOf({ severity: "nit", severityRaw: "trivial", tier: "nitpick" }), {
    severity: "nit",
    stated_severity: "trivial",
    severity_basis: "header-field",
  });
});

test("severityOf: REFUSES a foreign severity rather than letting normalizeSeverity see it", () => {
  // This is the guard that matters. `buildFindingRecord` runs `normalizeSeverity`,
  // whose unknown → `major` fail-safe is right for our gate and catastrophic here:
  // it would file CodeRabbit's lowest tier as a gate-blocking defect. If a fifth
  // vintage teaches the parser a word this module has not seen, it stops here.
  assert.throws(() => severityOf({ severity: "trivial", severityRaw: "trivial" }), /outside critical \| major \| minor \| nit/);
  assert.throws(() => severityOf({ severity: "blocker" }), /must not reach\s+buildFindingRecord/);
  assert.throws(() => severityOf({ severity: "trivial" }), /normalizeSeverity would read it as a blocking major/);
});

test("severityOf: an unstated severity is read off CodeRabbit's own tier heading", () => {
  assert.deepEqual(severityOf({ severity: "", severityRaw: "", tier: "nitpick" }), {
    severity: "nit",
    stated_severity: "",
    severity_basis: "tier-heading",
  });
  assert.deepEqual(severityOf({ severity: "", severityRaw: "", tier: "minor" }), {
    severity: "minor",
    stated_severity: "",
    severity_basis: "tier-heading",
  });
});

test("severityOf: TIER_SEVERITY holds ONLY the tiers whose heading names a severity", () => {
  // Two entries, and both are corroborated rather than assumed: wherever a
  // nitpick-tier finding also carries a header severity it is `trivial`, on all
  // 274 of them, and `minor`-tier findings state `minor` on all 95. Measured
  // 2026-08-07 over every CodeRabbit review body in the repository.
  assert.deepEqual(TIER_SEVERITY, { nitpick: "nit", minor: "minor" });
  for (const value of Object.values(TIER_SEVERITY)) assert.ok(KNOWN.includes(value));
  // The tiers that carry MIXED severities must not be in here — their heading
  // demonstrably does not determine the severity, so reading one off it would be
  // inventing a number for the arm we are comparing ourselves against.
  for (const tier of ["duplicate", "outside-diff-range", "additional", "combined", "failed-to-post"]) {
    assert.equal(TIER_SEVERITY[tier], undefined, `${tier}'s heading does not state a severity`);
    assert.deepEqual(severityOf({ severity: "", tier }), {
      severity: UNSTATED_SEVERITY,
      stated_severity: "",
      severity_basis: "unstated",
    });
  }
});

test("severityOf: the unstated floor is non-blocking, and SAYS it is a floor", () => {
  // `nit` rather than `normalizeSeverity`'s `major`: 389 of CodeRabbit's 3001
  // findings state no severity anywhere, and filing them as blocking would put
  // 296 findings from a tier titled "Additional comments" on the gate.
  assert.equal(UNSTATED_SEVERITY, "nit");
  assert.ok(KNOWN.includes(UNSTATED_SEVERITY));
  const out = severityOf({ severity: "", severityRaw: "", tier: "" });
  assert.equal(out.severity, UNSTATED_SEVERITY);
  // The floor is only honest if it is distinguishable from a measurement.
  assert.equal(out.severity_basis, "unstated");
  assert.deepEqual([...SEVERITY_BASIS], ["header-field", "tier-heading", "unstated"]);
});

// --- the item id -------------------------------------------------------------

test("codeRabbitItemId: agrees with buildItemMeta, which is where the id is really built", () => {
  // Asserted against the SOURCE rather than against this function's own output.
  // `pr-<n>` is built inline inside `buildItemMeta` and exported from nowhere, so
  // this is the one string this module re-types — and a round trip through the
  // duplicate would be invisible to itself.
  for (const n of [6, 471, 1234]) {
    const meta = buildItemMeta({ number: n }, "", null);
    assert.equal(codeRabbitItemId(n), meta.id);
    assert.equal(codeRabbitItemId(String(n)), meta.id);
  }
});

test("codeRabbitItemId: refuses anything that is not a pull request number", () => {
  for (const bad of ["", "pr-471", "abc", null, undefined, {}]) {
    assert.throws(() => codeRabbitItemId(bad), /a pull request number is required/);
  }
});

// --- inline comments → records ----------------------------------------------

test("inlineFinding: reads the line from the SAME snapshot as the commit", () => {
  // GitHub leaves `line` null once a comment goes outdated, which is most of them,
  // and `original_line` describes the commit the comment was written on. Taking the
  // line from one and the commit from the other names a position in neither tree.
  // The START of the range, so `line` means the same thing as on the review-body
  // path, which reads the start out of its `97-114` locator.
  assert.equal(inlineFinding(CR_THREE_FIELD).line, 25);
  assert.equal(inlineFinding(CR_TWO_FIELD).line, 143);
  assert.equal(inlineFinding(CR_SINGLE_ITALIC).line, 6);
  assert.equal(inlineFinding(CR_BOLD_TITLE).line, 163);
  // With no `original_commit_id` the current pair is the consistent one.
  assert.equal(inlineFinding({ ...CR_BOLD_TITLE, original_commit_id: "", start_line: 12, line: 20 }).line, 12);
  // A comment with no usable line at all is `null`, never 0 — `line` is 1-based
  // and `validateFindingRecord` refuses anything else.
  assert.equal(inlineFinding({ ...CR_BOLD_TITLE, original_start_line: null, original_line: null }).line, null);
});

test("inlineFinding: WIDENS the parsed comment instead of rebuilding it", () => {
  const f = inlineFinding(CR_THREE_FIELD);
  // Everything the parser annotates survives, including the fields this module
  // never names. Upstream fixed this exact bug once in `normalizeFindings` and
  // three copies of it outlived the fix.
  for (const k of ["category", "vocabulary", "severity", "severityRaw", "effort", "vintage", "lens", "summary", "detail"]) {
    assert.ok(Object.hasOwn(f, k), `${k} was dropped`);
  }
  assert.equal(f.file, CR_THREE_FIELD.path);
  assert.equal(f.evidence, CR_THREE_FIELD.body);
  // A threaded reply is not a finding and must not become one by defaulting.
  assert.equal(inlineFinding(CR_REPLY), null);
});

test("a record is produced from EVERY header vintage, from real bodies", () => {
  const { records, dropped } = one({
    reviewCommit: "42d17c8d81b9fa0bac6be942d06c3e1e455b1a94",
    commits: commits("42d17c8d81b9fa0bac6be942d06c3e1e455b1a94"),
    comments: [CR_THREE_FIELD, CR_TWO_FIELD, CR_SINGLE_ITALIC, CR_BOLD_TITLE, CR_REPLY],
    reviews: [],
  });
  assert.equal(records.length, 4);
  assert.deepEqual(records.map((r) => r.coderabbit.vintage), ["three-field", "two-field", "single-italic", "bold-title"]);
  // The two live vintages state a severity; the two retired ones state none
  // anywhere — 75 findings repo-wide — so they carry the floor and say so. The
  // alternative, withholding them, would delete both eras from the other arm.
  assert.deepEqual(records.map((r) => r.coderabbit.severity_basis), ["header-field", "header-field", "unstated", "unstated"]);
  assert.deepEqual(records.map((r) => r.severity), ["minor", "major", "nit", "nit"]);
  // The reply is COUNTED, not silently skipped.
  assert.deepEqual(dropped, [{ source: "inline-comment", id: "3563051576", reason: "not-a-finding" }]);
  for (const r of records) validateFindingRecord(r);
});

test("a record is produced from EVERY review-body tier, from real bodies", () => {
  const { records, declared } = one({
    reviews: [RV_NITPICK_STATED, RV_NITPICK_AND_ADDITIONAL_UNSTATED, RV_DUPLICATE, RV_OUTSIDE_DIFF, RV_MINOR, RV_FAILED_TO_POST, RV_COMBINED],
    comments: [],
  });
  const byTier = new Map();
  for (const r of records) if (!byTier.has(r.coderabbit.tier)) byTier.set(r.coderabbit.tier, r);
  assert.deepEqual(
    [...byTier.keys()].sort(),
    ["additional", "combined", "duplicate", "failed-to-post", "minor", "nitpick", "outside-diff-range"],
  );
  // The tier decides how the severity was got, and each answer is different.
  assert.equal(byTier.get("nitpick").severity, "nit");
  assert.equal(byTier.get("nitpick").coderabbit.stated_severity, "trivial");
  assert.equal(byTier.get("nitpick").coderabbit.severity_basis, "header-field");
  assert.equal(byTier.get("minor").severity, "minor");
  assert.equal(byTier.get("duplicate").severity, "minor");
  assert.equal(byTier.get("outside-diff-range").severity, "major");
  assert.equal(byTier.get("additional").severity, UNSTATED_SEVERITY);
  assert.equal(byTier.get("additional").coderabbit.severity_basis, "unstated");
  assert.equal(byTier.get("combined").coderabbit.severity_basis, "unstated");
  assert.equal(byTier.get("failed-to-post").coderabbit.severity_basis, "unstated");
  // The 2025 nitpick body states nothing, so the tier HEADING answers — the case
  // that rescues 635 findings from the floor without inventing a number.
  const heading = records.find((r) => r.coderabbit.severity_basis === "tier-heading");
  assert.equal(heading.coderabbit.tier, "nitpick");
  assert.equal(heading.severity, "nit");
  // Every review-body record carries a line read off its own locator.
  for (const r of records) assert.ok(Number.isInteger(r.line) && r.line >= 1, `${r.finding_key} has line ${r.line}`);
  assert.equal(byTier.get("failed-to-post").line, 36); // the BARE locator, no backticks
  assert.equal(byTier.get("combined").line, 120);
  // CodeRabbit's own declared totals travel with the count.
  assert.ok(declared.review_body > 0);
  for (const r of records) validateFindingRecord(r);
});

test("reviewBodyFindings: a non-numeric locator yields null rather than a coerced 0", () => {
  const body = rv(1, "a".repeat(40), "2026-01-01T00:00:00Z", [
    "<details>",
    "<summary>🧹 Nitpick comments (1)</summary><blockquote>",
    "",
    "<details>",
    "<summary>a.ts (1)</summary><blockquote>",
    "",
    "`some-anchor`: _📐 Maintainability & Code Quality_ | _🔵 Trivial_ | _⚡ Quick win_",
    "",
    "**A title.**",
    "",
    "</blockquote></details>",
    "",
    "</blockquote></details>",
  ]);
  const { findings } = reviewBodyFindings(body);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].line, null);
});

// --- the record's shape ------------------------------------------------------

test("the arm namespace holds exactly ARM_ONLY_FIELDS.coderabbit, and no top-level leak", () => {
  const { records } = one({ comments: [CR_THREE_FIELD], reviews: [] });
  const r = records[0];
  assert.deepEqual(Object.keys(r.coderabbit).filter((k) => k !== "raw").sort(), [...ARM_ONLY_FIELDS.coderabbit].sort());
  // A coderabbit record must not carry a `panel` namespace: one finding has one
  // author, and `validateFindingRecord` refuses a record that claims two.
  assert.equal(Object.hasOwn(r, "panel"), false);
  // None of our arm's fields at the top level either — the top level stays
  // meaningful for a reviewer with no lenses, no lane and no verifier.
  for (const k of ARM_ONLY_FIELDS.panel) assert.equal(Object.hasOwn(r, k), false, `${k} leaked to the top level`);
});

test("checkArmFields refuses a namespace that has drifted from the schema's list", () => {
  // The guard is against a FUTURE edit, so asserting the keys of a correct record
  // does not exercise it — delete the check and every such assertion still passes.
  // Tested against a drifted object instead, which is the only thing that can.
  const good = Object.fromEntries(ARM_ONLY_FIELDS.coderabbit.map((k) => [k, null]));
  assert.equal(checkArmFields(good), good);
  assert.throws(() => checkArmFields({ ...good, lane: "blocking" }), /emitted but not named: lane/);
  // The failure that really happened: a TOP-LEVEL record field spread into the
  // namespace, where nothing validates it.
  assert.throws(() => checkArmFields({ ...good, severity: "nit" }), /emitted but not named: severity/);
  const { tier, ...missingTier } = good;
  assert.equal(tier, null);
  assert.throws(() => checkArmFields(missingTier), /named but not emitted: tier/);
  assert.throws(() => checkArmFields({}), /named but not emitted: source, tier/);
});

test("the whole parsed comment survives verbatim at coderabbit.raw", () => {
  const { records } = one({ comments: [CR_THREE_FIELD], reviews: [] });
  const raw = records[0].coderabbit.raw;
  // The fields a field-list rebuild would have dropped, which is the bug this
  // convention exists to prevent.
  assert.equal(raw.severityRaw, "minor");
  assert.equal(raw.effort, "quick win");
  assert.equal(raw.category, "maintainability & code quality");
  assert.equal(raw.vocabulary, "chill");
  assert.ok(raw.detail.includes("Mark the old scope note as superseded."));
  // `detail` is spread BEFORE `raw` in the builder, so no caller can shadow it.
  assert.equal(typeof raw, "object");
});

test("the top-level severity_raw cannot carry CodeRabbit's word, and the namespace does", () => {
  // A LIMITATION OF THE RECORD, pinned so it is not mistaken for a bug in here.
  // `buildFindingRecord` derives `severity` and `severity_raw` from the one input
  // `finding.severity`, and `validateFindingRecord` refuses anything outside
  // `KNOWN` — so `trivial` must be translated BEFORE the builder sees it, and
  // `severity_raw` then reads the translated value too. #713's docblock claimed
  // this field would keep CodeRabbit's `trivial` distinguishable from a real
  // `major`; on this arm it cannot.
  const { records } = one({ comments: [], reviews: [RV_NITPICK_STATED] });
  const r = records[0];
  assert.equal(r.severity, "nit");
  assert.equal(r.severity_raw, "nit"); // NOT "trivial" — the field cannot see it
  // The original survives in two places instead, and both are in the namespace.
  assert.equal(r.coderabbit.stated_severity, "trivial");
  assert.equal(r.coderabbit.raw.severityRaw, "trivial");
  // Which is why `stated_severity` is named separately rather than shadowing
  // `severity_raw` inside the namespace: one fact, one readable place.
  assert.equal(ARM_ONLY_FIELDS.coderabbit.includes("severity_raw"), false);
  assert.equal(ARM_ONLY_FIELDS.coderabbit.includes("stated_severity"), true);
});

test("file and summary are carried VERBATIM — the matchable pair is not reshaped", () => {
  const { records } = one({ comments: [CR_THREE_FIELD], reviews: [] });
  const r = records[0];
  assert.equal(r.file, "docs/tasks/active/20260712-checkbox-validation-bugfix-todo.md");
  // CodeRabbit's bolded title, exactly as written. Normalising it toward our
  // lenses' phrasing would silently improve one arm's match rate against the
  // other, and it would be invisible in every number downstream.
  assert.equal(r.summary, "Mark the old scope note as superseded.");
  assert.equal(r.finding_key, `${r.file}::${r.summary.toLowerCase()}`);
});

test("run_id is null on every record, and the provenance is in the namespace", () => {
  const { records } = one({ comments: [CR_THREE_FIELD], reviews: [RV_DUPLICATE] });
  for (const r of records) assert.equal(r.run_id, null);
  const inline = records.find((r) => r.coderabbit.source === "inline-comment");
  assert.equal(inline.coderabbit.comment_id, "3566343388");
  assert.equal(inline.coderabbit.review_id, "4680080028");
  assert.equal(inline.coderabbit.posted_at, "2026-07-12T12:59:36Z");
  assert.ok(inline.coderabbit.url.endsWith("#discussion_r3566343388"));
  const body = records.find((r) => r.coderabbit.source === "review-body");
  assert.equal(body.coderabbit.comment_id, null);
  assert.equal(body.coderabbit.review_id, "4050275857");
  assert.equal(body.coderabbit.posted_at, "2026-04-02T12:18:30Z");
});

test("both commit ids ride on the record, so a scorer can re-place a finding", () => {
  const { records } = one({
    reviewCommit: "42d17c8d81b9fa0bac6be942d06c3e1e455b1a94",
    commits: commits("42d17c8d81b9fa0bac6be942d06c3e1e455b1a94", "e8e729031dae38a8ea612f5305729d2f78bd69d5"),
    comments: [CR_THREE_FIELD],
    reviews: [],
  });
  const cr = records[0].coderabbit;
  // The choice of key MOVES THE NUMBERS: over the pilot's 16 inline findings,
  // `original_commit_id` first gives 3 in-window / 11 after / 2 unplaceable and
  // `commit_id` first gives 1 / 14 / 1. This record is in-window under the first
  // and after-window under the second, so both are on it.
  assert.equal(cr.at_commit, CR_THREE_FIELD.original_commit_id);
  assert.equal(cr.current_commit, CR_THREE_FIELD.commit_id);
  assert.equal(cr.window, "in-window");
  assert.equal(cr.review_commit, "42d17c8d81b9fa0bac6be942d06c3e1e455b1a94");
  assert.equal(
    placeInWindow({
      commits: commits("42d17c8d81b9fa0bac6be942d06c3e1e455b1a94", "e8e729031dae38a8ea612f5305729d2f78bd69d5"),
      reviewCommit: cr.review_commit,
      atCommit: cr.current_commit,
    }).window,
    "after-window",
  );
});

test("gating is not-applicable on every record, and never computed here", () => {
  const { records } = one({ comments: [CR_THREE_FIELD, CR_TWO_FIELD], reviews: [RV_OUTSIDE_DIFF] });
  const census = gatingCensus(records);
  // CodeRabbit does not gate anything, ever. `gatingOf` answers this on its first
  // line for any non-panel arm, so the boring answer is the correct one — and a
  // `major` from this arm reading `gates` would be the interesting kind of wrong.
  assert.equal(census.n, records.length);
  assert.deepEqual(census.gating, { gates: 0, "does-not-gate": 0, unknown: 0, "not-applicable": census.n });
  assert.deepEqual(census.basis, { "no-gate-in-arm": census.n });
  assert.ok(records.some((r) => r.severity === "major"), "a blocking severity is present and still does not gate");
});

// --- the caller's errors, and the read path's degradations -------------------

test("codeRabbitRecords: the sampled population does not exist in this arm", () => {
  assert.throws(() => one({ comments: [], reviews: [] }, { population: "sampled" }), /does not exist in this arm/);
  assert.throws(() => one({ comments: [], reviews: [] }, { population: "nope" }), /population must be one of/);
  assert.throws(() => codeRabbitRecords({ comments: [], reviews: [] }), /a pull request number is required/);
});

test("population_state is present only when BOTH endpoints answered", () => {
  // Half of CodeRabbit's output reported as all of it is the defect this series
  // keeps finding, so one readable endpoint is not the population.
  assert.equal(one({ comments: [], reviews: [] }).population_state, "present");
  assert.equal(one({ comments: [], reviews: null }).population_state, "absent");
  assert.equal(one({ comments: null, reviews: [] }).population_state, "absent");
  assert.deepEqual(one({ comments: null, reviews: [] }).sources, { inline: "absent", review_body: "present", commits: "absent" });
  // EMPTY is `present`, and that is a real answer: a pull request CodeRabbit
  // reviewed cleanly genuinely has no findings, and a true negative treated as a
  // failure deletes the other arm's clean reviews.
  const clean = one({ comments: [], reviews: [] });
  assert.equal(clean.records.length, 0);
  assert.equal(clean.population_state, "present");
});

test("an unreadable commit list is a DIFFERENT unplaceable from a force-push", () => {
  // Found by the CLI's first live run: a network timeout on pr-415's commits call
  // printed `window unplaceable=3`, which was the right answer for the wrong
  // reason — that item's findings really are unplaceable, for a force-push. The
  // window VALUE cannot tell the two apart; the basis can, and the third input's
  // state is reported beside the two endpoints rather than folded into them.
  const withCommits = one({
    reviewCommit: "42d17c8d81b9fa0bac6be942d06c3e1e455b1a94",
    commits: commits("42d17c8d81b9fa0bac6be942d06c3e1e455b1a94"),
    comments: [CR_TWO_FIELD],
    reviews: [],
  });
  const without = one({
    reviewCommit: "42d17c8d81b9fa0bac6be942d06c3e1e455b1a94",
    commits: null,
    comments: [CR_TWO_FIELD],
    reviews: [],
  });
  assert.equal(withCommits.records[0].coderabbit.window, "unplaceable");
  assert.equal(without.records[0].coderabbit.window, "unplaceable");
  // Same value, different cause — and OUR failure is the second one.
  assert.equal(withCommits.records[0].coderabbit.window_basis, "commit-not-on-pr");
  assert.equal(without.records[0].coderabbit.window_basis, "commits-unavailable");
  assert.equal(withCommits.sources.commits, "present");
  assert.equal(without.sources.commits, "absent");
  // An EMPTY commit list is not a readable one either: `pulls/{n}/commits` never
  // legitimately returns zero commits for a pull request.
  assert.equal(one({ commits: [], comments: [], reviews: [] }).sources.commits, "absent");
});

test("only CodeRabbit's exact logins are read as CodeRabbit", () => {
  // A security gate, not tidiness: `arm: "coderabbit"` is a claim about who found
  // the defect, and anyone can register `coderabbitai-x` and comment on a public
  // pull request. The set is `harvest.mjs`'s own rather than a second copy.
  for (const login of ["coderabbitai-x", "coderabbitai", "hackerwins", "", "CodeRabbitAI[bot]"]) {
    const { records } = one({ comments: [{ ...CR_THREE_FIELD, user: { login } }], reviews: [{ ...RV_DUPLICATE, user: { login } }] });
    assert.equal(records.length, 0, `${JSON.stringify(login)} was read as CodeRabbit`);
  }
  assert.equal(one({ comments: [CR_THREE_FIELD], reviews: [] }).records.length, 1);
  assert.equal(one({ comments: [{ ...CR_THREE_FIELD, user: { login: "app/coderabbitai" } }], reviews: [] }).records.length, 1);
});

test("an unrecognised review section is reported rather than read as 'no findings'", () => {
  const body = rv(9, "a".repeat(40), "2026-01-01T00:00:00Z", [
    "<details>",
    "<summary>🆕 Some brand new tier (3)</summary><blockquote>",
    "",
    "`1-2`: _🎯 Functional Correctness_ | _🟠 Major_",
    "",
    "**A title.**",
    "",
    "</blockquote></details>",
  ]);
  const out = one({ comments: [], reviews: [body] });
  assert.equal(out.records.length, 0);
  // The whole point of surfacing it: a tier this parser does not know is
  // indistinguishable, from the outside, from a review that found nothing.
  assert.deepEqual(out.declared.unrecognised, [{ review_id: "9", title: "🆕 Some brand new tier", declared: 3 }]);
});

// --- end to end, over the frozen pilot corpus -------------------------------

test("END TO END: a real corpus item through a real EvalStore, no network", () => {
  const root = mkdtempSync(path.join(tmpdir(), "cr-adapter-"));
  try {
    const store = new EvalStore(root);
    store.putCorpusManifest("pilot", {
      corpus_version: "pilot",
      items: [{ id: "pr-471", source_pr: 471, review_commit: "42d17c8d81b9fa0bac6be942d06c3e1e455b1a94" }],
    });
    // The API is INJECTED, so this drives the real store and the real mapping and
    // still needs no token, no network and no money.
    const api = (argv) => {
      const ep = argv[argv.length - 1];
      if (ep.includes("/commits")) return commits("42d17c8d81b9fa0bac6be942d06c3e1e455b1a94", "e8e729031dae38a8ea612f5305729d2f78bd69d5");
      if (ep.includes("/reviews")) return [RV_NITPICK_STATED];
      return [CR_THREE_FIELD, CR_REPLY];
    };
    const perItem = corpusRecords(store, "pilot", { api, log: () => {} });
    assert.equal(perItem.length, 1);
    assert.equal(perItem[0].item_id, "pr-471");
    assert.equal(perItem[0].records.length, 2);
    // The manifest is what supplies the frozen commit; without it every record
    // would read `no-window` and the comparison would have no scope at all.
    assert.equal(perItem[0].records[0].coderabbit.window, "in-window");
    assert.equal(perItem[0].records[0].item_id, "pr-471");
    assert.equal(perItem[0].dropped.length, 1);
    for (const r of perItem[0].records) validateFindingRecord(r);
    assert.throws(() => corpusRecords(store, "nope", { api }), /does not exist under this root/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fetchCodeRabbitPr: an endpoint that fails is absent, not empty", () => {
  const logged = [];
  const out = fetchCodeRabbitPr(471, {
    api: (argv) => {
      if (String(argv.at(-1)).includes("/reviews")) throw new Error("HTTP 502");
      return [];
    },
    log: (m) => logged.push(m),
  });
  assert.deepEqual(out.comments, []);
  assert.equal(out.reviews, null);
  // `null` rather than `[]`, because `codeRabbitRecords` reads the difference and
  // "the endpoint did not answer" is not "CodeRabbit wrote nothing".
  assert.equal(codeRabbitRecords({ pr: 471, ...out }).population_state, "absent");
  assert.match(logged.join("\n"), /could not list reviews \(HTTP 502\); that half of CodeRabbit's output is absent, not empty/);
});
