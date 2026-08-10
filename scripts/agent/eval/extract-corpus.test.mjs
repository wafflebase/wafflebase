import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { EvalStore, contentSha256 } from "./store.mjs";
import {
  DIFF_METHODS,
  REVIEW_POINTS,
  REVIEW_POINT_PINNED,
  REVIEW_POINT_VALUES,
  assertPinnedCommitsResolve,
  assertPinsAreRequested,
  buildItemMeta,
  buildManifest,
  changedFilesFromDiff,
  classifyProvenance,
  corpusItemDrift,
  diffLineCounts,
  extractCorpus,
  extractItem,
  fetchDiff,
  fetchIssueSpec,
  headAtOpen,
  issueNumberOf,
  main,
  manifestItem,
  parseReviewCommitPins,
  resolveReviewPoint,
  summarize,
} from "./extract-corpus.mjs";

// Real shas from wafflebase/wafflebase#664.
const BASE = "35206e5859788062cfddfd0fc12b0a5754655a8d";
const HEAD = "61101a1bdbdffb9acb88772cae4c9347c69f413b";
const FORK = "5f9b7f86e0000000000000000000000000000000";
// Real, and the reason the pin exists: the commit CodeRabbit reviewed on #415,
// which a force-push removed from that PR's commit list.
const PINNED = "51c01826aa9f05e4cef9ee498668e3f2321b3602";

const DIFF = [
  "diff --git a/scripts/agent/x.mjs b/scripts/agent/x.mjs",
  "--- a/scripts/agent/x.mjs",
  "+++ b/scripts/agent/x.mjs",
  "@@ -1,2 +1,2 @@",
  "-const a = 1;",
  "+const a = 2;",
  "",
].join("\n");

const VIEW = {
  number: 664,
  title: "Route the capture out of the runner",
  author: { login: "dlgpdmsly2" },
  createdAt: "2026-08-04T06:10:34Z",
  mergedAt: "2026-08-04T08:00:00Z",
  baseRefName: "main",
  baseRefOid: BASE,
  headRefOid: HEAD,
  headRefName: "harness/stage-detail-upload-parity",
  files: [{ path: "scripts/agent/x.mjs" }, { path: "docs/only-in-the-merged-pr.md" }],
  additions: 120,
  deletions: 8,
  commits: [{ oid: HEAD, committedDate: "2026-08-04T06:00:00Z" }],
  closingIssuesReferences: [],
};

/** Every outside call the extractor can make, faked. No network, no git, no fs. */
function fakeIo(over = {}) {
  const calls = [];
  const io = {
    repo: "wafflebase/wafflebase",
    repoSource: "/nowhere",
    calls,
    prView(n) {
      calls.push(`prView:${n}`);
      return JSON.parse(JSON.stringify(VIEW));
    },
    prNumbers() {
      calls.push("prNumbers");
      return ["664"];
    },
    issueView(n) {
      calls.push(`issueView:${n}`);
      return { title: "Broken thing", body: "It is broken." };
    },
    fetchPrRefs(n) {
      calls.push(`fetchPrRefs:${n}`);
      return { head: true, base: true };
    },
    fetchPinnedCommit(n, sha) {
      calls.push(`fetchPinnedCommit:${n}:${sha}`);
      return true;
    },
    hasCommit() {
      calls.push("hasCommit");
      return true;
    },
    mergeBase() {
      calls.push("mergeBase");
      return FORK;
    },
    diffRange(range) {
      calls.push(`diffRange:${range}`);
      return DIFF;
    },
    prDiff(n) {
      calls.push(`prDiff:${n}`);
      return DIFF;
    },
    ...over,
  };
  return io;
}

function tempStore() {
  const root = mkdtempSync(path.join(tmpdir(), "extract-corpus-test-"));
  return { root, store: new EvalStore(root), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

// --- provenance and the review point ----------------------------------------

test("classifyProvenance separates the three populations", () => {
  // Only "autonomous" items back a claim about the panel on real bot output.
  assert.equal(classifyProvenance({ author: { login: "app/yorkie-agent" }, headRefName: "agent/280-x" }), "autonomous");
  assert.equal(classifyProvenance({ author: { login: "someone" }, headRefName: "agent/280-x" }), "local-cli-agent");
  assert.equal(classifyProvenance({ author: { login: "someone" }, headRefName: "feature/x" }), "human");
  assert.equal(classifyProvenance({}), "human");
});

test("issueNumberOf: the agent branch first, then a closing reference", () => {
  assert.equal(issueNumberOf({ headRefName: "agent/280-fix-it" }), 280);
  assert.equal(issueNumberOf({ headRefName: "feature/x", closingIssuesReferences: [{ number: 41 }] }), 41);
  assert.equal(issueNumberOf({ headRefName: "feature/x" }), null);
});

test("headAtOpen: the newest commit pushed BEFORE the PR opened", () => {
  // Commits after `createdAt` are the fix loop answering review comments;
  // including them measures a reviewer against a diff that already answers it.
  const view = {
    headRefOid: "H",
    createdAt: "2026-07-22T01:34:18Z",
    commits: [
      { oid: "C1", committedDate: "2026-07-22T01:33:40Z" },
      { oid: "C2", committedDate: "2026-07-22T05:48:04Z" },
      { oid: "C3", committedDate: "2026-07-22T23:44:54Z" },
    ],
  };
  assert.equal(headAtOpen(view), "C1");
  assert.equal(
    headAtOpen({ ...view, createdAt: "2026-07-22T10:00:00Z" }),
    "C2",
    "several pre-open commits → the latest of them",
  );
  assert.equal(headAtOpen({ headRefOid: "H", commits: [] }), "H", "no commits → the head");
});

test("resolveReviewPoint covers all four modes", () => {
  const view = {
    headRefOid: "H",
    baseRefOid: "B",
    createdAt: "2026-07-22T01:34:18Z",
    author: { login: "someone" },
    headRefName: "feature/x",
    commits: [
      { oid: "C1", committedDate: "2026-07-22T01:33:40Z" },
      { oid: "C2", committedDate: "2026-07-22T05:48:04Z" },
    ],
  };
  assert.deepEqual(resolveReviewPoint(view), { review_commit: "C1", review_base: "B", review_point: "pr-open" });
  assert.equal(resolveReviewPoint(view, "first").review_commit, "C1");
  assert.equal(resolveReviewPoint(view, "head").review_commit, "H");
  assert.equal(resolveReviewPoint(view, "auto").review_point, "head");
  const bot = { ...view, author: { login: "app/yorkie-agent" }, headRefName: "agent/280-x" };
  assert.deepEqual(
    [resolveReviewPoint(bot, "auto").review_point, resolveReviewPoint(bot, "auto").review_commit],
    ["first", "C1"],
  );
  assert.deepEqual(REVIEW_POINTS, ["pr-open", "first", "head", "auto"]);
});

// --- pinning the review commit ----------------------------------------------

test("a pinned commit overrides every mode, and the field says a rule did NOT choose it", () => {
  const view = {
    headRefOid: "H",
    baseRefOid: "B",
    createdAt: "2026-07-22T01:34:18Z",
    author: { login: "someone" },
    headRefName: "feature/x",
    commits: [
      { oid: "C1", committedDate: "2026-07-22T01:33:40Z" },
      { oid: "C2", committedDate: "2026-07-22T05:48:04Z" },
    ],
  };
  // Every mode, including the one that would otherwise pick a DIFFERENT commit:
  // the pin must not be a tie-break that only wins when the rule agrees.
  for (const mode of REVIEW_POINTS) {
    assert.deepEqual(
      resolveReviewPoint(view, mode, PINNED),
      { review_commit: PINNED, review_base: "B", review_point: REVIEW_POINT_PINNED },
      `--review-commit must beat --review-point ${mode}`,
    );
  }
  // No pin → the rule still runs. A pin argument that leaked a default would
  // silently freeze every unpinned item at one commit.
  assert.equal(resolveReviewPoint(view, "head", "").review_commit, "H");
  assert.equal(resolveReviewPoint(view, "head").review_point, "head");
  // `pinned` is a value the FIELD holds and never a mode the flag accepts, so the
  // two vocabularies are separate and only the union contains it.
  assert.equal(REVIEW_POINTS.includes(REVIEW_POINT_PINNED), false);
  assert.deepEqual(REVIEW_POINT_VALUES, ["pr-open", "first", "head", "auto", "pinned"]);
});

test("parseReviewCommitPins reads a per-item map, and refuses everything it cannot read exactly", () => {
  // Both spellings: `--prs` speaks in numbers, item ids are `pr-<n>`.
  assert.deepEqual([...parseReviewCommitPins(`pr-415=${PINNED},429=${FORK}`)], [["415", PINNED], ["429", FORK]]);
  // Whitespace around an entry survives a shell-quoted list; a trailing comma is
  // what a generated command line leaves behind.
  assert.deepEqual([...parseReviewCommitPins(` pr-415=${PINNED} , `)], [["415", PINNED]]);
  assert.equal(parseReviewCommitPins("").size, 0, "no flag is no pins, not an error");
  assert.equal(parseReviewCommitPins(undefined).size, 0);
  // Case is normalised — git's object names are lowercase, and `sha !== sha` on
  // case alone would read as drift on the next extraction.
  assert.deepEqual([...parseReviewCommitPins(`pr-415=${PINNED.toUpperCase()}`)], [["415", PINNED]]);

  assert.throws(() => parseReviewCommitPins("51c01826aa9f05e4cef9ee498668e3f2321b3602"), /is not <pr>=<sha>/);
  assert.throws(() => parseReviewCommitPins("pr-415="), /is not <pr>=<sha>/);
  // An abbreviation resolves today and can resolve elsewhere after the next fetch.
  assert.throws(() => parseReviewCommitPins("pr-415=51c01826"), /not a full 40-character sha/);
  assert.throws(() => parseReviewCommitPins(`pr-415=${PINNED.slice(0, 39)}z`), /not a full 40-character sha/);
  // Two answers to one question, otherwise settled by iteration order.
  assert.throws(() => parseReviewCommitPins(`pr-415=${PINNED},415=${FORK}`), /pins PR 415 twice/);
});

test("a pin that names a PR nobody asked for is refused — the silent-ignore case", () => {
  // The worst shape available: the pin is never consulted, every requested item
  // freezes at the default rule, and the run exits 0 looking perfectly healthy.
  assert.throws(
    () => assertPinsAreRequested(parseReviewCommitPins(`pr-416=${PINNED}`), ["415", "429"]),
    /pins PR\(s\) pr-416 which are not being frozen/,
  );
  assert.doesNotThrow(() => assertPinsAreRequested(parseReviewCommitPins(`pr-415=${PINNED}`), ["415", "429"]));
  // `--prs 415, 429` — the CLI splits on comma and the numbers arrive padded.
  assert.doesNotThrow(() => assertPinsAreRequested(parseReviewCommitPins(`pr-415=${PINNED}`), [" 415 "]));
});

test("an unresolvable pinned commit refuses the WHOLE run, naming every bad item", () => {
  // Not a per-PR skip, which is how everything else here fails. A pin that does
  // not resolve is the operator's list being wrong, not a flaky PR, and the other
  // items would be frozen at a review point nobody asked for.
  const io = fakeIo({ fetchPinnedCommit: (_n, sha) => sha !== FORK });
  assert.throws(
    () => assertPinnedCommitsResolve(io, parseReviewCommitPins(`pr-415=${PINNED},429=${FORK}`)),
    (e) => /do not resolve in --repo-source/.test(e.message) && /pr-429=/.test(e.message) && /never fall back to pr-open/.test(e.message),
  );
  const logs = [];
  assertPinnedCommitsResolve(fakeIo(), parseReviewCommitPins(`pr-415=${PINNED}`), { log: (m) => logs.push(m) });
  assert.match(logs.join("\n"), /pinned pr-415 @ 51c01826 \(refs\/eval\/pin\/415\)/);
});

// --- reading the frozen diff -------------------------------------------------

test("changedFilesFromDiff reads the paths out of the diff, deletions included", () => {
  const diff = [
    "diff --git a/keep.ts b/keep.ts",
    "--- a/keep.ts",
    "+++ b/keep.ts",
    "@@ -1 +1 @@",
    "-a",
    "+b",
    "diff --git a/gone.ts b/gone.ts",
    "--- a/gone.ts",
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-a",
  ].join("\n");
  assert.deepEqual(changedFilesFromDiff(diff), ["keep.ts", "gone.ts"]);
  assert.deepEqual(changedFilesFromDiff(""), []);
  assert.deepEqual(changedFilesFromDiff(null), []);
});

test("changedFilesFromDiff decodes git's C-quoted paths (non-ASCII bytes)", () => {
  // With core.quotePath on (the default) git wraps a path with a high byte in
  // quotes and octal-escapes the byte. `naïve.ts` is UTF-8 c3 af → \303\257.
  const diff = [
    'diff --git "a/na\\303\\257ve.ts" "b/na\\303\\257ve.ts"',
    '--- "a/na\\303\\257ve.ts"',
    '+++ "b/na\\303\\257ve.ts"',
    "@@ -1 +1 @@",
    "-a",
    "+b",
    // a deletion whose only header is the quoted diff --git line
    'diff --git "a/caf\\303\\251.ts" "b/caf\\303\\251.ts"',
    '--- "a/caf\\303\\251.ts"',
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-a",
  ].join("\n");
  assert.deepEqual(changedFilesFromDiff(diff), ["naïve.ts", "café.ts"]);
});

test("the changed files come from the DIFF and never from the merged PR's file list", () => {
  // The fork fell back to `view.files` when the parse came up empty. That list is
  // the MERGED PR's file set, so it includes files the fix loop touched after the
  // review point — a lens scoped off it would be shown files that do not exist in
  // the diff beside it. An empty parse must stay empty so the caller can skip.
  const meta = buildItemMeta(VIEW, "not a diff at all\n", "", { review_commit: HEAD, review_base: BASE, review_point: "pr-open" });
  assert.deepEqual(meta.changed_files, []);
  assert.ok(VIEW.files.length > 0, "the PR view does carry a file list — it is deliberately unused");
});

test("diffLineCounts counts content lines, not the +++/--- file headers", () => {
  assert.deepEqual(diffLineCounts(DIFF), { additions: 1, deletions: 1 });
  assert.deepEqual(diffLineCounts(""), { additions: 0, deletions: 0 });
  const big = ["diff --git a/x b/x", "--- a/x", "+++ b/x", ...Array.from({ length: 400 }, (_, i) => `+line ${i}`)].join("\n");
  assert.deepEqual(diffLineCounts(big), { additions: 400, deletions: 0 });

  // Content lines starting with `---`/`+++` (no trailing space) are NOT headers:
  // a removed markdown/YAML `---` arrives as `----`, an added `++x` as `+++x`.
  // Only `--- `/`+++ ` (with the space) are file headers.
  const md = ["diff --git a/x.md b/x.md", "--- a/x.md", "+++ b/x.md", "@@ -1,2 +1,2 @@", "----", "+++x"].join("\n");
  assert.deepEqual(diffLineCounts(md), { additions: 1, deletions: 1 });
});

test("scope describes the FROZEN diff; the merged PR's totals are kept as provenance", () => {
  // The fork derived `scope` from the merged PR's additions/deletions and its own
  // README admitted it was a size proxy — on the one field every planned
  // segmentation slices by (spec §4).
  const meta = buildItemMeta(VIEW, DIFF, "", { review_commit: HEAD, review_base: BASE, review_point: "pr-open" });
  assert.deepEqual([meta.additions, meta.deletions, meta.scope], [1, 1, "S"]);
  assert.deepEqual([meta.pr_additions, meta.pr_deletions], [120, 8], "the PR's own totals survive as provenance");
  const big = ["diff --git a/x b/x", "--- a/x", "+++ b/x", ...Array.from({ length: 400 }, (_, i) => `+line ${i}`)].join("\n");
  assert.equal(buildItemMeta(VIEW, big, "", {}).scope, "L");
});

/** A patch naming `p` with `hunks` hunk headers — the two inputs the spread rule reads. */
function filePatch(p, hunks = 1) {
  const lines = [`diff --git a/${p} b/${p}`, `--- a/${p}`, `+++ b/${p}`];
  for (let i = 0; i < hunks; i++) lines.push(`@@ -${i + 1} +${i + 1} @@`, "-a", "+b");
  return lines.join("\n");
}

/** `localization_scope` as it lands in `meta.json` — through buildItemMeta, never the helper. */
function localizationOf(diff) {
  const point = { review_commit: HEAD, review_base: BASE, review_point: "pr-open" };
  return buildItemMeta(VIEW, diff, "", point).localization_scope;
}

test("localization_scope records how spread out the frozen diff is — all five values", () => {
  // `scope` says how big, `changed_files` says which paths; neither says whether a
  // reviewer is reading one hunk or nine modules, and those are different review
  // problems at identical size. Asserted THROUGH buildItemMeta: localizationFromDiff
  // has its own tests in classify.test.mjs, and what is untested is that the value
  // reaches `meta.json` at all.
  assert.equal(localizationOf(filePatch("scripts/agent/x.mjs", 1)), "single_hunk");
  assert.equal(localizationOf(filePatch("scripts/agent/x.mjs", 2)), "single_file");

  // A "module" is the FIRST TWO path segments, so two files under scripts/agent are
  // one module and scripts/agent + packages/backend are two.
  const sameModule = [filePatch("scripts/agent/a.mjs"), filePatch("scripts/agent/b.mjs")].join("\n");
  assert.equal(localizationOf(sameModule), "multi_file");
  const twoModules = [filePatch("scripts/agent/a.mjs"), filePatch("packages/backend/src/b.ts")].join("\n");
  assert.equal(localizationOf(twoModules), "cross_module");

  // The fifth value is not decoration. A diff that names no path is reachable here
  // — `extractCorpus` skips such a PR as `no-changed-files`, but buildItemMeta runs
  // BEFORE that check, so the field has to be a named state rather than undefined.
  assert.equal(localizationOf("not a diff at all\n"), "unknown");
});

test("localization_scope comes from the FROZEN diff, never the merged PR's file list", () => {
  // Same trap as `changed_files` and `additions`: `view.files` is the MERGED PR's
  // file set, which includes whatever the post-review fix loop touched. Deriving the
  // spread from it would describe a change nobody reviewed — and it would not even
  // fail loudly, because it produces a perfectly plausible value.
  const meta = buildItemMeta(VIEW, DIFF, "", { review_commit: HEAD, review_base: BASE, review_point: "pr-open" });
  assert.equal(meta.localization_scope, "single_hunk");
  const prModules = new Set(VIEW.files.map((f) => f.path.split("/").slice(0, 2).join("/")));
  assert.equal(prModules.size, 2, "the merged PR spans two modules — so it would read cross_module");
});

test("a deleted file counts toward the spread, even though `+++` says /dev/null", () => {
  // A deletion's only path is on the `diff --git` header, and `changed_files`
  // already reads it there. Until PR 687 the spread rule did not, so a
  // deletion-only diff froze as `unknown` however many modules it spanned — a
  // permanent wrong value, because a corpus item is write-once.
  const deleted = (p) => `diff --git a/${p} b/${p}\ndeleted file mode 100644\n--- a/${p}\n+++ /dev/null\n@@ -1 +0,0 @@\n-a`;
  const twoModules = [deleted("scripts/agent/gone.mjs"), deleted("packages/backend/old.ts")].join("\n");
  const meta = buildItemMeta(VIEW, twoModules, "", { review_commit: HEAD, review_base: BASE, review_point: "pr-open" });
  assert.deepEqual(meta.changed_files, ["scripts/agent/gone.mjs", "packages/backend/old.ts"]);
  assert.equal(meta.localization_scope, "cross_module");
  assert.equal(localizationOf(deleted("scripts/agent/gone.mjs")), "single_hunk");
});

test("a mixed diff counts the deleted file, not only its hunks", () => {
  // The sharp case. The deleted file's `@@` was counted while the file was not, so
  // one modified file plus one deletion in another module answered `single_file`:
  // a reviewer reading two modules recorded as reading one file. That is worse than
  // `unknown`, because nothing about it looks wrong.
  const mixed = [
    DIFF.trimEnd(),
    "diff --git a/packages/backend/old.ts b/packages/backend/old.ts",
    "deleted file mode 100644",
    "--- a/packages/backend/old.ts",
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-x",
  ].join("\n");
  const meta = buildItemMeta(VIEW, mixed, "", { review_commit: HEAD, review_base: BASE, review_point: "pr-open" });
  assert.deepEqual(meta.changed_files, ["scripts/agent/x.mjs", "packages/backend/old.ts"]);
  assert.equal(meta.localization_scope, "cross_module");
  // `changed_files` and the spread now agree on how many files there are, which is
  // the invariant that failed: two paths must never read as one file.
  assert.equal(meta.changed_files.length, 2);
});

test("a C-quoted path reads as `unknown` — the remaining gap in the imported helper", () => {
  // The one cause of `unknown` left after the deletion fix above. Git wraps a path
  // carrying a special or non-ASCII byte in quotes (`+++ "b/na\303\257ve.ts"`);
  // `changedFilesFromDiff` decodes that and `localizationFromDiff` matches literal
  // prefixes, so an all-quoted diff freezes with a populated `changed_files` and
  // `unknown` spread. Left as is deliberately: the C-unquoter is private to this
  // module, and copying it into `classify.mjs` would fork the path parser that the
  // deletion bug just showed the cost of. Pinned so a reader of `unknown` on a real
  // item knows this is the cause, and `eval/README.md` says the same.
  const quoted = [
    'diff --git "a/na\\303\\257ve.ts" "b/na\\303\\257ve.ts"',
    '--- "a/na\\303\\257ve.ts"',
    '+++ "b/na\\303\\257ve.ts"',
    "@@ -1 +1 @@",
    "-a",
    "+b",
  ].join("\n");
  const meta = buildItemMeta(VIEW, quoted, "", { review_commit: HEAD, review_base: BASE, review_point: "pr-open" });
  assert.deepEqual(meta.changed_files, ["naïve.ts"], "the path itself parses fine");
  assert.equal(meta.localization_scope, "unknown");
});

test("buildItemMeta carries what a replay needs, and no label_status", () => {
  const meta = buildItemMeta(VIEW, DIFF, "# Broken thing\n\nIt is broken.", {
    review_commit: HEAD,
    review_base: BASE,
    review_point: "pr-open",
  }, DIFF_METHODS.forkPoint);
  assert.equal(meta.id, "pr-664");
  assert.equal(meta.source_pr, 664);
  assert.equal(meta.review_commit, HEAD);
  assert.equal(meta.review_base, BASE);
  assert.equal(meta.review_point, "pr-open");
  assert.equal(meta.diff_method, "fork-point");
  assert.equal(meta.has_issue_spec, true);
  assert.equal(meta.sha256_diff, contentSha256(DIFF));
  assert.deepEqual(meta.changed_files, ["scripts/agent/x.mjs"]);
  // A write-once item may not carry a mutable status: a label arrives later and
  // gets corrected, so the field would be a lie from the first label onward. The
  // store computes it from `labels/` at read time (PR 16).
  assert.equal("label_status" in meta, false);
  assert.equal(buildItemMeta(VIEW, DIFF, "   ", {}).has_issue_spec, false);
});

test("manifestItem carries review_base into the index, not just into the item", () => {
  const meta = buildItemMeta(VIEW, DIFF, "", { review_commit: HEAD, review_base: BASE, review_point: "pr-open" }, DIFF_METHODS.forkPoint);
  assert.deepEqual(manifestItem(meta), {
    id: "pr-664",
    source_pr: 664,
    base_ref: BASE,
    review_commit: HEAD,
    review_base: BASE,
    review_point: "pr-open",
    diff_method: "fork-point",
    sha256_diff: contentSha256(DIFF),
    has_issue_spec: false,
    scope: "S",
    // Beside `scope` on purpose: "small single-hunk items vs small cross-module
    // ones" is one query, and it is answerable off the manifest alone.
    localization_scope: "single_hunk",
    provenance: "human",
  });
});

// --- the determinism check ---------------------------------------------------

test("corpusItemDrift: identical extractions drift in nothing", () => {
  const meta = buildItemMeta(VIEW, DIFF, "", { review_commit: HEAD, review_base: BASE, review_point: "pr-open" }, DIFF_METHODS.forkPoint);
  const fresh = { meta, diff: DIFF, issueSpec: "" };
  // The store hands back `null` for an absent issue spec and an extraction has
  // `""`; both mean "no spec" and neither is drift.
  assert.deepEqual(corpusItemDrift(fresh, { meta, diff: DIFF, issueSpec: null }), []);
});

test("corpusItemDrift names every field that moved", () => {
  const base = { review_commit: HEAD, review_base: BASE, review_point: "pr-open" };
  const meta = buildItemMeta(VIEW, DIFF, "", base, DIFF_METHODS.forkPoint);
  const fresh = { meta, diff: DIFF, issueSpec: "" };

  const otherDiff = DIFF + "+one more line\n";
  const stored = { meta: buildItemMeta(VIEW, otherDiff, "", base, DIFF_METHODS.forkPoint), diff: otherDiff, issueSpec: null };
  assert.deepEqual(corpusItemDrift(fresh, stored), ["diff.patch", "sha256_diff"]);
  // A second file appearing in the diff moves the changed-file list too, which is
  // the drift a lens's path scoping would actually notice — and, because the second
  // file sits outside `scripts/agent`, the spread with it.
  const extraFile = `${DIFF}diff --git a/new.ts b/new.ts\n--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1 @@\n+added\n`;
  const withFile = { meta: buildItemMeta(VIEW, extraFile, "", base, DIFF_METHODS.forkPoint), diff: extraFile, issueSpec: null };
  assert.deepEqual(corpusItemDrift(fresh, withFile), [
    "diff.patch",
    "sha256_diff",
    "meta.localization_scope",
    "meta.changed_files",
  ]);

  for (const [field, over] of [
    ["meta.review_commit", { review_commit: FORK }],
    ["meta.review_base", { review_base: FORK }],
    ["meta.review_point", { review_point: "head" }],
  ]) {
    const s = { meta: buildItemMeta(VIEW, DIFF, "", { ...base, ...over }, DIFF_METHODS.forkPoint), diff: DIFF, issueSpec: null };
    assert.deepEqual(corpusItemDrift(fresh, s), [field]);
  }
  const methodDrift = { meta: buildItemMeta(VIEW, DIFF, "", base, DIFF_METHODS.singleCommit), diff: DIFF, issueSpec: null };
  assert.deepEqual(corpusItemDrift(fresh, methodDrift), ["meta.diff_method"]);
  const specDrift = { meta, diff: DIFF, issueSpec: "# something else" };
  assert.deepEqual(corpusItemDrift(fresh, specDrift), ["issue-spec.md"]);
});

test("corpusItemDrift catches a stored item whose own hash no longer matches its diff", () => {
  // Comparing the two hashes alone would trust the stored hash to describe the
  // stored bytes, and that is one of the states this is looking for.
  const meta = buildItemMeta(VIEW, DIFF, "", { review_commit: HEAD, review_base: BASE, review_point: "pr-open" }, DIFF_METHODS.forkPoint);
  const tampered = { meta, diff: DIFF.replace("const a = 2;", "const a = 3;"), issueSpec: null };
  const drift = corpusItemDrift({ meta, diff: DIFF, issueSpec: "" }, tampered);
  assert.ok(drift.includes("diff.patch"));
  assert.ok(drift.includes("stored sha256_diff vs stored diff.patch"));
});

test("a derived field in the drift list catches a change in the DERIVATION, not the bytes", () => {
  // Why `localization_scope` is compared at all when the diff is already compared
  // byte-for-byte: the bytes prove the INPUT is stable and say nothing about the
  // derivation. Both states below are invisible to every other entry in the list.
  const base = { review_commit: HEAD, review_base: BASE, review_point: "pr-open" };
  const meta = buildItemMeta(VIEW, DIFF, "", base, DIFF_METHODS.forkPoint);
  const fresh = { meta, diff: DIFF, issueSpec: "" };

  // An upstream edit to `localizationFromDiff`, seen from here: same bytes, same
  // hash, different meaning.
  const reDerived = { meta: { ...meta, localization_scope: "single_file" }, diff: DIFF, issueSpec: null };
  assert.deepEqual(corpusItemDrift(fresh, reDerived), ["meta.localization_scope"]);

  // An item frozen BEFORE the field existed. This is the case the field was added
  // early to avoid: absent must be drift, so the item is reported and refused —
  // not re-indexed as `= unchanged` with the field permanently missing.
  const older = { ...meta };
  delete older.localization_scope;
  assert.deepEqual(corpusItemDrift(fresh, { meta: older, diff: DIFF, issueSpec: null }), ["meta.localization_scope"]);
});

// --- the manifest ------------------------------------------------------------

test("buildManifest MERGES into an existing version instead of replacing it", () => {
  // The fork replaced the manifest with only the current run's items, so
  // `--prs 664` against a 20-item version reduced the index to one entry while
  // nineteen items sat on disk unreferenced.
  const existing = {
    corpus_version: "v1",
    source_repo: "wafflebase/wafflebase",
    item_count: 2,
    items: [{ id: "pr-600", sha256_diff: "sha256:aaa" }, { id: "pr-673", sha256_diff: "sha256:bbb" }],
  };
  const { manifest, added, kept } = buildManifest({
    corpusVersion: "v1",
    sourceRepo: "wafflebase/wafflebase",
    existing,
    items: [{ id: "pr-664", sha256_diff: "sha256:ccc" }, { id: "pr-673", sha256_diff: "sha256:REFRESHED" }],
  });
  assert.deepEqual(manifest.items.map((i) => i.id), ["pr-600", "pr-664", "pr-673"], "merged and sorted by id");
  assert.equal(manifest.items.find((i) => i.id === "pr-673").sha256_diff, "sha256:REFRESHED", "a re-extracted entry wins");
  assert.equal(manifest.item_count, 3);
  assert.deepEqual([added, kept], [1, 2]);
});

test("a manifest carries no timestamp, so two extractions of one corpus are byte-identical", () => {
  const a = buildManifest({ corpusVersion: "v1", sourceRepo: "r", existing: null, items: [{ id: "pr-1" }] });
  const b = buildManifest({ corpusVersion: "v1", sourceRepo: "r", existing: null, items: [{ id: "pr-1" }] });
  assert.equal(JSON.stringify(a.manifest), JSON.stringify(b.manifest));
  assert.equal("created" in a.manifest, false, "a clock reading here makes the determinism check unrunnable");
});

test("one corpus version indexes one repository", () => {
  assert.throws(
    () => buildManifest({
      corpusVersion: "v1",
      sourceRepo: "someone/fork",
      existing: { source_repo: "wafflebase/wafflebase", items: [] },
      items: [],
    }),
    /one corpus version indexes one repository/,
  );
});

// --- fetching, with the network injected ------------------------------------

test("fetchDiff: head uses `gh pr diff`, and needs no local commits at all", () => {
  const io = fakeIo();
  const out = fetchDiff(io, 664, { review_commit: HEAD, review_base: BASE, review_point: "head" });
  assert.equal(out.method, DIFF_METHODS.ghPrDiff);
  assert.deepEqual(io.calls, ["prDiff:664"]);
});

test("fetchDiff: the fork point is preferred, and the method is recorded", () => {
  const io = fakeIo();
  const out = fetchDiff(io, 664, { review_commit: HEAD, review_base: BASE, review_point: "pr-open" }, { hasBase: true });
  assert.equal(out.method, DIFF_METHODS.forkPoint);
  assert.deepEqual(io.calls, ["mergeBase", `diffRange:${FORK}..${HEAD}`]);
});

test("fetchDiff: no base branch → the base tip's three-dot diff", () => {
  const io = fakeIo();
  const out = fetchDiff(io, 664, { review_commit: HEAD, review_base: BASE, review_point: "pr-open" }, { hasBase: false });
  assert.equal(out.method, DIFF_METHODS.baseTip);
  assert.deepEqual(io.calls, [`diffRange:${BASE}...${HEAD}`]);
});

test("fetchDiff: an unresolvable merge-base falls through to the base tip, loudly", () => {
  const logs = [];
  const io = fakeIo({ mergeBase() { throw new Error("fatal: Not a valid object name"); } });
  const out = fetchDiff(io, 664, { review_commit: HEAD, review_base: BASE, review_point: "pr-open" }, { hasBase: true, log: (m) => logs.push(m) });
  assert.equal(out.method, DIFF_METHODS.baseTip);
  assert.match(logs.join("\n"), /merge-base against the base branch failed/);
});

test("fetchDiff: with no base history at all the method says single-commit", () => {
  // The fallback that holds only the last commit's own change rather than the PR's
  // cumulative diff. `extractCorpus` refuses it by default; the point here is that
  // it NAMES itself, so the refusal has something to key on.
  const logs = [];
  let firstRange = true;
  const io = fakeIo({
    diffRange(range) {
      if (firstRange) {
        firstRange = false;
        throw new Error("fatal: bad revision");
      }
      return `single ${range}`;
    },
  });
  const out = fetchDiff(io, 664, { review_commit: HEAD, review_base: BASE, review_point: "pr-open" }, { hasBase: false, log: (m) => logs.push(m) });
  assert.equal(out.method, DIFF_METHODS.singleCommit);
  assert.equal(out.diff, `single ${HEAD}^...${HEAD}`);
  assert.match(logs.join("\n"), /base history unavailable/);
});

test("fetchIssueSpec: no closing issue is empty, and an unreachable one degrades loudly", () => {
  const logs = [];
  assert.equal(fetchIssueSpec(fakeIo(), { closingIssuesReferences: [] }), "");
  const io = fakeIo({ issueView() { throw new Error("gh: Not Found (HTTP 404)"); } });
  assert.equal(fetchIssueSpec(io, { closingIssuesReferences: [{ number: 41 }] }, { log: (m) => logs.push(m) }), "");
  // `has_issue_spec: false` on an item that does have one silently changes which
  // lenses run (`needsIssueSpec`), so the degradation is said out loud.
  assert.match(logs.join("\n"), /issue #41 unavailable/);
  const ok = fetchIssueSpec(fakeIo(), { closingIssuesReferences: [{ number: 41 }] });
  assert.equal(ok, "# Broken thing\n\nIt is broken.");
});

test("extractItem assembles one item from the injected io", () => {
  const io = fakeIo();
  const out = extractItem(io, 664, { reviewPointMode: "pr-open" });
  assert.equal(out.meta.id, "pr-664");
  assert.equal(out.meta.review_commit, HEAD);
  assert.equal(out.meta.review_base, BASE);
  assert.equal(out.method, DIFF_METHODS.forkPoint);
  assert.equal(out.diff, DIFF);
  assert.deepEqual(io.calls, ["prView:664", "fetchPrRefs:664", "mergeBase", `diffRange:${FORK}..${HEAD}`]);
});

// --- the whole extraction ----------------------------------------------------

function runExtract(store, over = {}, io = fakeIo()) {
  return extractCorpus({ io, store, numbers: ["664"], corpusVersion: "2026-08-05a", ...over });
}

test("extractCorpus freezes an item, indexes it, and exits 0", () => {
  const { store, cleanup } = tempStore();
  try {
    const result = runExtract(store);
    assert.deepEqual([result.written, result.unchanged, result.skipped, result.drifted], [1, 0, [], []]);
    assert.equal(summarize(result).exitCode, 0);
    assert.equal(store.hasCorpusItem("pr-664"), true);
    assert.deepEqual(store.getCorpus("2026-08-05a").map((i) => i.id), ["pr-664"]);
    assert.equal(store.getCorpusItemInput("pr-664").meta.review_base, BASE);
    // Through the store and back off disk: a corpus item is write-once, so a field
    // that reaches `buildItemMeta` but not `meta.json` is missing forever.
    assert.equal(store.getCorpusItemInput("pr-664").meta.localization_scope, "single_hunk");
    assert.deepEqual(store.getCorpus("2026-08-05a").map((i) => i.localization_scope), ["single_hunk"]);
  } finally {
    cleanup();
  }
});

test("a second extraction is a DETERMINISM CHECK: unchanged, not rewritten", () => {
  const { store, cleanup } = tempStore();
  try {
    runExtract(store);
    const again = runExtract(store);
    assert.deepEqual([again.written, again.unchanged, again.drifted], [0, 1, []]);
    assert.equal(summarize(again).exitCode, 0);
    assert.equal(again.items.length, 1, "an unchanged item stays in the manifest");
  } finally {
    cleanup();
  }
});

test("an extraction that DIFFERS from the stored item is reported and refused", () => {
  // The failure this whole module is exposed to: a corpus item that quietly
  // differs between extractions breaks every comparison downstream, and it fails
  // by looking fine. So it is red, and the stored bytes are left alone.
  const { store, cleanup } = tempStore();
  try {
    runExtract(store);
    const logs = [];
    const moved = fakeIo({ diffRange: () => DIFF + "+a line that was not there before\n" });
    const drifted = runExtract(store, { log: (m) => logs.push(m) }, moved);
    assert.equal(drifted.written, 0);
    assert.deepEqual(drifted.drifted.map((d) => d.id), ["pr-664"]);
    assert.ok(drifted.drifted[0].fields.includes("diff.patch"));
    const summary = summarize(drifted);
    assert.equal(summary.exitCode, 1);
    assert.match(summary.line, /DRIFT on 1 item\(s\)/);
    assert.match(logs.join("\n"), /DRIFT pr-664/);
    assert.equal(store.getCorpusItemInput("pr-664").diff, DIFF, "the stored diff must be untouched");
  } finally {
    cleanup();
  }
});

test("a pinned item reaches meta.json pinned — it cannot silently degrade to pr-open", () => {
  // THE test this flag exists for. A `pr-open` freeze and a pinned freeze produce
  // output of identical shape, so nothing about the wrong one looks wrong: the
  // item, the manifest and the exit code are all healthy. Asserted through the
  // store and back off disk, because a corpus item is write-once.
  const { store, cleanup } = tempStore();
  try {
    const result = extractCorpus({
      io: fakeIo(),
      store,
      numbers: ["664"],
      corpusVersion: "v1",
      reviewCommitPins: new Map([["664", PINNED]]),
    });
    assert.equal(result.written, 1);
    const stored = store.getCorpusItemInput("pr-664").meta;
    assert.equal(stored.review_commit, PINNED, "the pin must win over pr-open, which would give the head");
    assert.notEqual(stored.review_commit, HEAD, "pr-open resolves to the head on this fixture — that is the degradation");
    assert.equal(stored.review_point, REVIEW_POINT_PINNED);
    // And in the index, so a manifest reader can tell which rule produced it
    // without opening seven meta.json files.
    assert.deepEqual(store.getCorpus("v1").map((i) => [i.review_commit, i.review_point]), [[PINNED, REVIEW_POINT_PINNED]]);
  } finally {
    cleanup();
  }
});

test("a padded PR number still finds its pin — the lookup and the guard must agree", () => {
  // `assertPinsAreRequested` trims and the lookup must trim identically, or a
  // caller passing ` 664 ` passes the guard and then MISSES the pin: the item
  // freezes at pr-open, the run exits 0, and nothing anywhere says so. A guard
  // and the code it guards normalising differently is the whole bug class.
  const { store, cleanup } = tempStore();
  try {
    const result = extractCorpus({
      io: fakeIo(),
      store,
      numbers: [" 664 "],
      corpusVersion: "v1",
      reviewCommitPins: new Map([["664", PINNED]]),
    });
    assert.equal(result.written, 1);
    assert.equal(store.getCorpusItemInput("pr-664").meta.review_commit, PINNED);
  } finally {
    cleanup();
  }
});

test("the pinned commit is what the diff is taken at, and it is fetched and pinned first", () => {
  const io = fakeIo();
  const { store, cleanup } = tempStore();
  try {
    extractCorpus({ io, store, numbers: ["664"], corpusVersion: "v1", reviewCommitPins: new Map([["664", PINNED]]) });
    // Order is the assertion: the commit is fetched BEFORE the extraction that
    // needs it, and the merge-base range ends at the pinned sha rather than HEAD.
    assert.deepEqual(io.calls, [
      `fetchPinnedCommit:664:${PINNED}`,
      "prView:664",
      "fetchPrRefs:664",
      "mergeBase",
      `diffRange:${FORK}..${PINNED}`,
    ]);
  } finally {
    cleanup();
  }
});

test("re-pinning to a different commit is DRIFT, not a quiet rewrite", () => {
  // `corpusItemDrift` compares `review_commit` and `review_point`, so moving the
  // snapshot of an already-frozen item is caught by the determinism check rather
  // than overwriting a corpus every downstream number was computed against.
  const { store, cleanup } = tempStore();
  try {
    extractCorpus({ io: fakeIo(), store, numbers: ["664"], corpusVersion: "v1", reviewCommitPins: new Map([["664", PINNED]]) });
    const logs = [];
    const moved = extractCorpus({
      io: fakeIo(),
      store,
      numbers: ["664"],
      corpusVersion: "v1",
      reviewCommitPins: new Map([["664", FORK]]),
      log: (m) => logs.push(m),
    });
    assert.equal(moved.written, 0);
    assert.deepEqual(moved.drifted.map((d) => d.id), ["pr-664"]);
    assert.ok(moved.drifted[0].fields.includes("meta.review_commit"));
    assert.equal(summarize(moved).exitCode, 1);
    assert.equal(store.getCorpusItemInput("pr-664").meta.review_commit, PINNED, "the stored item must be untouched");
    // Dropping the pin entirely is drift too — it moves `review_point` back to a
    // rule, which is the degradation this flag was added to make impossible.
    const unpinned = extractCorpus({ io: fakeIo(), store, numbers: ["664"], corpusVersion: "v1" });
    assert.ok(unpinned.drifted[0].fields.includes("meta.review_point"));
  } finally {
    cleanup();
  }
});

test("extractCorpus refuses a bad pin before it writes anything at all", () => {
  const { root, store, cleanup } = tempStore();
  try {
    // Guards stand in THIS door and not only in the CLI's — a validator only
    // guards the door it stands in.
    assert.throws(
      () => extractCorpus({ io: fakeIo(), store, numbers: ["664"], corpusVersion: "v1", reviewCommitPins: new Map([["665", PINNED]]) }),
      /pins PR\(s\) pr-665 which are not being frozen/,
    );
    assert.throws(
      () =>
        extractCorpus({
          io: fakeIo({ fetchPinnedCommit: () => false }),
          store,
          numbers: ["664"],
          corpusVersion: "v1",
          reviewCommitPins: new Map([["664", PINNED]]),
        }),
      /do not resolve in --repo-source/,
    );
    assert.equal(existsSync(path.join(root, "corpus")), false, "a refused run must write nothing");
  } finally {
    cleanup();
  }
});

test("--dry-run computes everything and writes nothing", () => {
  const { root, store, cleanup } = tempStore();
  try {
    const logs = [];
    const result = runExtract(store, { dryRun: true, log: (m) => logs.push(m) });
    assert.equal(result.written, 1);
    assert.equal(result.manifest.item_count, 1);
    assert.equal(store.hasCorpusItem("pr-664"), false);
    assert.equal(existsSync(path.join(root, "corpus")), false, "not one byte may land under the root");
    assert.match(summarize(result).line, /would freeze 1 item/);
    // The `+` line is the only place a human sees a derived field while the item can
    // still be refused, so `--dry-run` prints the spread beside the size.
    assert.match(logs.join("\n"), /\+ pr-664 \(1 files, \+1\/-1 S, single_hunk,/);
  } finally {
    cleanup();
  }
});

test("a degraded single-commit diff is REFUSED by default and freezable on request", () => {
  const { store, cleanup } = tempStore();
  try {
    let firstRange = true;
    const io = fakeIo({
      diffRange(_range) {
        if (firstRange) {
          firstRange = false;
          throw new Error("fatal: bad revision");
        }
        return DIFF;
      },
      fetchPrRefs: () => ({ head: true, base: false }),
    });
    const logs = [];
    const refused = runExtract(store, { log: (m) => logs.push(m) }, io);
    assert.equal(refused.written, 0);
    assert.deepEqual(refused.degraded.map((d) => d.method), [DIFF_METHODS.singleCommit]);
    assert.equal(summarize(refused).exitCode, 1);
    assert.match(logs.join("\n"), /--allow-degraded-diff/);
    assert.equal(store.hasCorpusItem("pr-664"), false);

    // Explicitly allowed: it is frozen, and the item says how.
    let firstAgain = true;
    const io2 = fakeIo({
      diffRange(_range) {
        if (firstAgain) {
          firstAgain = false;
          throw new Error("fatal: bad revision");
        }
        return DIFF;
      },
      fetchPrRefs: () => ({ head: true, base: false }),
    });
    const allowed = runExtract(store, { allowDegradedDiff: true }, io2);
    assert.equal(allowed.written, 1);
    assert.equal(store.getCorpusItemInput("pr-664").meta.diff_method, DIFF_METHODS.singleCommit);
  } finally {
    cleanup();
  }
});

test("an empty diff, or one that names no files, is a counted skip and never an item", () => {
  const { store, cleanup } = tempStore();
  try {
    const empty = runExtract(store, {}, fakeIo({ diffRange: () => "   \n" }));
    assert.deepEqual(empty.skipped.map((s) => s.reason), ["empty-diff"]);
    assert.equal(summarize(empty).exitCode, 1);

    const unparseable = runExtract(store, {}, fakeIo({ diffRange: () => "this is not a patch\n" }));
    assert.deepEqual(unparseable.skipped.map((s) => s.reason), ["no-changed-files"]);
    assert.equal(store.hasCorpusItem("pr-664"), false);
    assert.equal(unparseable.manifest, null, "nothing to index means no manifest write");
  } finally {
    cleanup();
  }
});

test("one flaky PR costs itself and nothing else", () => {
  const { store, cleanup } = tempStore();
  try {
    const io = fakeIo({
      prView(n) {
        if (String(n) === "665") throw new Error("gh: Could not resolve to a PullRequest");
        return JSON.parse(JSON.stringify({ ...VIEW, number: Number(n) }));
      },
    });
    const result = extractCorpus({ io, store, numbers: ["664", "665", "666"], corpusVersion: "v1" });
    assert.equal(result.written, 2);
    assert.deepEqual(result.skipped.map((s) => [s.pr, s.reason]), [["665", "extract-failed"]]);
    assert.deepEqual(store.listCorpusItems(), ["pr-664", "pr-666"]);
    assert.equal(summarize(result).exitCode, 1, "a corpus with a hole in it must not exit green");
  } finally {
    cleanup();
  }
});

test("the store's refusal is the item's problem, not the batch's", () => {
  const { store, cleanup } = tempStore();
  try {
    // A PR whose base ref never resolved: `review_base` is empty, the store
    // refuses, and the run says so rather than freezing an item PR 6 cannot use.
    const io = fakeIo({ prView: () => ({ ...JSON.parse(JSON.stringify(VIEW)), baseRefOid: "" }) });
    const result = runExtract(store, {}, io);
    assert.deepEqual(result.skipped.map((s) => s.reason), ["store-refused"]);
    assert.match(result.skipped[0].detail, /review_base/);
    assert.equal(summarize(result).exitCode, 1);
  } finally {
    cleanup();
  }
});

test("summarize prints every count even at zero, and only red when something is wrong", () => {
  const clean = summarize({ written: 0, unchanged: 3, skipped: [], drifted: [], items: [1, 2, 3], manifest: { item_count: 3 } });
  assert.match(clean.line, /froze 0 item\(s\) · 3 unchanged · 0 skipped · 3 item\(s\) indexed this run · version now holds 3 item\(s\)/);
  assert.equal(clean.exitCode, 0);
  const dirty = summarize({ written: 1, skipped: [{ reason: "empty-diff" }, { reason: "empty-diff" }, { reason: "degraded-diff" }], drifted: [], items: [1] });
  assert.match(dirty.line, /3 skipped \(2 empty-diff, 1 degraded-diff\)/);
  assert.equal(dirty.exitCode, 1);
  assert.deepEqual(summarize({}).byReason, {});
});

test("a run that indexes fewer items than the version holds says both numbers", () => {
  // The drifted-item case on real data: one PR drifts, so this run contributes one
  // entry while the version still indexes two. Reporting only the run's count reads
  // as a corpus that just halved.
  const line = summarize({ written: 0, unchanged: 1, skipped: [], drifted: [{ id: "pr-664", fields: ["diff.patch"] }], items: [1], manifest: { item_count: 2 } }).line;
  assert.match(line, /1 item\(s\) indexed this run · version now holds 2 item\(s\)/);
  assert.match(line, /DRIFT on 1 item\(s\): pr-664 \(diff\.patch\)/);
});

// --- the CLI -----------------------------------------------------------------

test("the CLI refuses a missing --root before it touches the network", () => {
  // A usage error (2), not an operational one. `--root` has no default anywhere,
  // and the message names the fork's old flag so muscle memory gets an answer.
  const errs = [];
  const realError = console.error;
  console.error = (m) => errs.push(String(m));
  try {
    assert.equal(main(["node", "extract-corpus.mjs", "--corpus-version", "v1"]), 2);
    assert.match(errs.join("\n"), /--root is required and has no default\./);
    errs.length = 0;
    assert.equal(main(["node", "extract-corpus.mjs", "--out", "/tmp/x", "--corpus-version", "v1"]), 2);
    assert.match(errs.join("\n"), /the fork harness called this --out/);
    errs.length = 0;
    assert.equal(main(["node", "extract-corpus.mjs", "--root", "/tmp/x"]), 2);
    assert.match(errs.join("\n"), /--corpus-version is required/);
    errs.length = 0;
    assert.equal(main(["node", "extract-corpus.mjs", "--root", "/tmp/x", "--corpus-version", "v1", "--review-point", "merged"]), 2);
    assert.match(errs.join("\n"), /--review-point must be one of/);
    errs.length = 0;
    // `pinned` is not selectable: there is no commit it could resolve to on its
    // own, so accepting it would give a run that meant to pin a mode with no pin.
    assert.equal(main(["node", "extract-corpus.mjs", "--root", "/tmp/x", "--corpus-version", "v1", "--review-point", "pinned"]), 2);
    assert.match(errs.join("\n"), /--review-point must be one of pr-open, first, head, auto/);
    errs.length = 0;
    // A malformed pin costs a usage error rather than a run — and it is checked
    // before `--prs` is even read, so nothing reaches the network.
    assert.equal(main(["node", "extract-corpus.mjs", "--root", "/tmp/x", "--corpus-version", "v1", "--review-commit", "51c01826"]), 2);
    assert.match(errs.join("\n"), /is not <pr>=<sha>/);
    errs.length = 0;
    assert.equal(main(["node", "extract-corpus.mjs", "--root", "/tmp/x", "--corpus-version", "v1", "--review-commit", "pr-415=51c01826"]), 2);
    assert.match(errs.join("\n"), /not a full 40-character sha/);
    errs.length = 0;
    // The silent-ignore case, at the CLI: pin one PR, freeze another.
    assert.equal(
      main(["node", "extract-corpus.mjs", "--root", "/tmp/x", "--corpus-version", "v1", "--prs", "429", "--review-commit", `pr-415=${PINNED}`]),
      2,
    );
    assert.match(errs.join("\n"), /pins PR\(s\) pr-415 which are not being frozen/);
    errs.length = 0;
    assert.equal(main(["node", "extract-corpus.mjs", "--root", "/tmp/x", "--corpus-version", "v1", "--limit", "0"]), 2);
    assert.match(errs.join("\n"), /--limit takes a positive integer/);
    errs.length = 0;
    // An unknown --state is a usage error, caught before `gh pr list` is called
    // with a value it would reject as an unfriendly subprocess crash.
    assert.equal(main(["node", "extract-corpus.mjs", "--root", "/tmp/x", "--corpus-version", "v1", "--state", "reviewed"]), 2);
    assert.match(errs.join("\n"), /--state must be one of/);
  } finally {
    console.error = realError;
  }
});

test("--help prints the usage and exits 0", () => {
  const out = [];
  const realLog = console.log;
  console.log = (m) => out.push(String(m));
  try {
    assert.equal(main(["node", "extract-corpus.mjs", "--help"]), 0);
  } finally {
    console.log = realLog;
  }
  assert.match(out.join("\n"), /--root\s+REQUIRED, no default/);
  assert.match(out.join("\n"), /COMPARED against a fresh extraction/);
});

test("the module's own usage text stays in step with the four files it writes", () => {
  // A README and a usage line that disagree with the code are how the next person
  // freezes an item and looks for it in the wrong place.
  const src = readFileSync(new URL("./extract-corpus.mjs", import.meta.url), "utf8");
  // Scope to the USAGE template — `src.includes` would also match the import of
  // CORPUS_ITEM_FILES or a comment, so it could pass while the usage text stops
  // naming the files.
  const usage = /const USAGE = `([\s\S]*?)`;/.exec(src);
  assert.ok(usage, "the USAGE template moved — this pin needs re-pointing, not deleting");
  for (const name of ["meta.json", "diff.patch", "changed-files.txt", "issue-spec.md"]) {
    assert.ok(usage[1].includes(name), `the usage text no longer mentions ${name}`);
  }
});
