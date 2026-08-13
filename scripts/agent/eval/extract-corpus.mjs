// Freeze a PAST pull request into a replayable corpus item — the diff, the
// changed files, the issue text and the metadata — so the review panel can be
// re-run over the exact input a reviewer first saw.
//
// WHAT THIS IS FOR TODAY. Two things, neither of which needs anything unmerged.
// First, it answers "what would a lens actually have been shown here?" with
// files you can open: freeze a PR, read `changed-files.txt` against a lens's
// `appliesWhen` globs, read `diff.patch` against what the lens said. Second, it
// makes a review REPEATABLE. The panel is a non-deterministic judge, so "did
// that change help?" is unanswerable while the input is also moving; a frozen
// item holds the input still.
//
// THE REVIEW POINT IS THE WHOLE FIDELITY QUESTION. The merged state of a PR is
// the state AFTER review comments were addressed, so freezing that measures a
// reviewer against a diff whose bugs have already been fixed — it skews every
// verdict toward approve. `--review-point` picks the commit instead:
//   pr-open (default) the diff as the PR was OPENED for review (every commit
//                     pushed before `createdAt`) — for an agent that is its
//                     implement commit, for a human what they pushed before
//                     opening, with no partial-WIP risk
//   first             the PR's literal first commit
//   head              the merged state (skews approve; useful for comparison)
//   auto              autonomous → first, everything else → head (the legacy rule)
// and `--review-commit pr-<n>=<sha>` overrides all four FOR ONE ITEM, recording
// `review_point: pinned`. The four modes above are rules for guessing which commit
// a reviewer read; a pin is the answer when that is already known per PR — which
// is the normal case when the diff has to line up with a review that has already
// happened and cannot be re-run. Nothing here learns where the sha came from; see
// the note on `parseReviewCommitPins`.
//
// DETERMINISM IS THE PROPERTY EVERYTHING ELSE RESTS ON, and it fails by looking
// fine. Two extractions of one PR must produce byte-identical files, because a
// comparison between two reviewers is only a comparison if they read the same
// bytes. So a re-extraction over an existing root does not overwrite and does not
// silently skip: it COMPARES against the stored item and reports drift as a
// failure. That is also why `meta.json` carries `sha256_diff` at all, and why
// `diff_method` records HOW the diff was produced — a diff taken from a fallback
// path is a different input, and a field is the only place that fact can survive.
//
// NO MODEL IS INVOKED AND NOTHING IS SPENT. Everything here is `gh` and `git`.
//
// WHERE THE DATA GOES. `--root` is REQUIRED and has no default anywhere, the
// pattern #675 established: the store is the separate eval repo
// (`dlgpdmsly2/wafflebase-agent-eval`), git history is permanent, and a forgotten
// flag must not be able to commit corpus data into `wafflebase`. This writes
// files into that checkout; committing them is a human's separate, deliberate
// act.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../vendor/pipeline/gh-checks.mjs";
import { CORPUS_ITEM_FILES, EvalStore, contentSha256 } from "./store.mjs";
import { scopeSize } from "../vendor/pipeline/metrics.mjs"; // the pipeline's own S/M/L rule, not a second one
import { localizationFromDiff } from "../classify.mjs"; // and the pipeline's own spread rule, likewise

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_REPO = "wafflebase/wafflebase";

/**
 * The `--review-point` modes: the RULES for choosing a commit, and the closed list
 * the CLI validates the flag against.
 */
export const REVIEW_POINTS = Object.freeze(["pr-open", "first", "head", "auto"]);
export const DEFAULT_REVIEW_POINT = "pr-open";

/**
 * What `meta.review_point` says when the commit was pinned per item rather than
 * derived by a rule — so a manifest records WHICH RULE produced its snapshot, and
 * "we picked this deliberately" is distinguishable from all four guesses.
 *
 * Deliberately NOT a member of `REVIEW_POINTS`: it is not selectable. There is no
 * commit `--review-point pinned` could resolve to on its own, so accepting it at
 * the flag would take a run that meant to pin and silently give it a mode with no
 * pin attached — the exact fall-back-to-a-rule failure the pin exists to prevent.
 * The two sets are different vocabularies and `REVIEW_POINT_VALUES` is the union:
 * the modes are what a caller may ASK for, the values are what the field may HOLD.
 */
export const REVIEW_POINT_PINNED = "pinned";
export const REVIEW_POINT_VALUES = Object.freeze([...REVIEW_POINTS, REVIEW_POINT_PINNED]);

/** The `--state` values `gh pr list` accepts. Validated before the list call. */
export const PR_STATES = Object.freeze(["open", "closed", "merged", "all"]);

/**
 * How a diff was produced. Recorded in `meta.diff_method` because these are not
 * interchangeable: the first three are faithful three-dot diffs of the PR's
 * cumulative change, and `single-commit` is a DEGRADATION that holds only the
 * last commit's own change.
 */
export const DIFF_METHODS = Object.freeze({
  ghPrDiff: "gh-pr-diff",
  forkPoint: "fork-point",
  baseTip: "base-tip",
  singleCommit: "single-commit",
});

/**
 * The methods that do NOT produce the reviewable diff, refused unless
 * `--allow-degraded-diff` says otherwise.
 *
 * The fork's extractor took this path with a `console.error` and stored the item
 * anyway. That is the shape of every silent-degradation bug in this project: a
 * line printed once in a log nobody reads, and a corpus item that replays
 * cleanly against the wrong input forever. An item this thin is not a smaller
 * version of the right input, it is a different one.
 */
export const DEGRADED_DIFF_METHODS = new Set([DIFF_METHODS.singleCommit]);

// --- pure helpers -----------------------------------------------------------

/**
 * Provenance of a diff — load-bearing for honest reporting, because these three
 * populations are not interchangeable:
 *   - "autonomous"      : the app/yorkie-agent bot ran issue→PR end to end (the
 *                         real production review target); branch `agent/<issue#>-`
 *   - "local-cli-agent" : a human drove the local Claude CLI on an `agent/*`
 *                         branch (mostly pipeline self-development)
 *   - "human"           : an ordinary human-authored PR
 * Only "autonomous" items back a claim about the panel on real bot output.
 */
export function classifyProvenance(view) {
  const author = view?.author?.login ?? "";
  const branch = view?.headRefName ?? "";
  if (author === "app/yorkie-agent") return "autonomous";
  if (branch.startsWith("agent/")) return "local-cli-agent";
  return "human";
}

/** Issue number from an autonomous branch (`agent/<num>-slug`) or a closing ref. */
export function issueNumberOf(view) {
  const m = /^agent\/(\d+)-/.exec(view?.headRefName ?? "");
  if (m) return Number(m[1]);
  return (view?.closingIssuesReferences ?? [])[0]?.number ?? null;
}

/**
 * The commit the PR pointed at WHEN IT WAS OPENED for review: the newest commit
 * pushed before `createdAt`. Commits pushed afterwards are the fix loop
 * responding to review, so including them measures a reviewer against a diff
 * that already answers it. Falls back to the first commit, then the head. ISO
 * timestamps compare correctly as strings.
 */
export function headAtOpen(view) {
  const commits = Array.isArray(view?.commits) ? view.commits : [];
  if (!commits.length) return view?.headRefOid ?? "";
  const createdAt = view?.createdAt;
  const present = commits.filter((c) => c.committedDate && createdAt && c.committedDate <= createdAt);
  const pool = present.length ? present : [commits[0]];
  const latest = pool.reduce((a, b) => ((a.committedDate ?? "") >= (b.committedDate ?? "") ? a : b));
  return latest.oid ?? view?.headRefOid ?? "";
}

/**
 * `{review_commit, review_base, review_point}` for one of the four modes — or for
 * `pinnedCommit`, which overrides every mode.
 *
 * `review_base` is `baseRefOid` in ALL cases, pin included, and that is not an
 * oversight. It is a property of the pull request rather than of our snapshot, and
 * `fetchDiff` never uses it while a base branch is available — it takes
 * `merge-base(base branch, review_commit)`, which follows the pin on its own. The
 * three-dot forms make the two agree anyway (`A...B` is merge-base(A,B)..B), so
 * moving `review_base` would change no diff and would make every already-frozen
 * item drift. If the pin is a merge of the base branch INTO the branch, the fork
 * point moves and `review_base` does not; the fork point is the one the diff is
 * taken from, and it is recorded implicitly by `sha256_diff`.
 */
export function resolveReviewPoint(view, mode = DEFAULT_REVIEW_POINT, pinnedCommit = "") {
  const commits = Array.isArray(view?.commits) ? view.commits : [];
  const head = view?.headRefOid ?? "";
  const base = view?.baseRefOid ?? "";
  const first = commits[0]?.oid ?? head;
  // The pin wins over the mode, and says so in the field. Checked FIRST so no
  // rule can run and quietly produce a different commit alongside it.
  if (pinnedCommit) {
    return { review_commit: String(pinnedCommit), review_base: base, review_point: REVIEW_POINT_PINNED };
  }
  let point = mode;
  if (mode === "auto") point = classifyProvenance(view) === "autonomous" ? "first" : "head";
  let review_commit;
  if (point === "first") review_commit = first;
  else if (point === "pr-open") review_commit = headAtOpen(view);
  else review_commit = head;
  return { review_commit, review_base: base, review_point: point };
}

/** A full git object name. Abbreviations are refused — see `parseReviewCommitPins`. */
const FULL_SHA = /^[0-9a-f]{40}$/;

/**
 * `--review-commit pr-415=<sha>,429=<sha>` → `Map<"415", sha>`.
 *
 * PER ITEM, because the commit a review was written against is a fact about one
 * pull request and there is no batch rule that produces it. Both `pr-415=` and
 * `415=` are accepted: `--prs` speaks in numbers and item ids are `pr-<n>`, so
 * insisting on one spelling only buys a footgun.
 *
 * WHAT THIS DOES NOT DO, and must not learn to. It does not ask GitHub which
 * commit anyone reviewed. This module's headline property is that it is
 * deterministic and invokes nothing — `gh` and `git`, no model, no review API —
 * and a mode that went and looked would make the freezer's output depend on a
 * third party's records at the moment it ran. The caller supplies the sha.
 *
 * THROWS RATHER THAN SKIPS, on anything it cannot read exactly:
 *   - an entry that is not `<pr>=<sha>`
 *   - an abbreviated sha. `git` would resolve `51c0182` today and could resolve it
 *     to something else after the next fetch; a corpus item is forever
 *   - the same PR pinned twice, which has no answer and would otherwise be decided
 *     by iteration order
 * All three are typos, all three are silent if tolerated — the item freezes at the
 * default rule, and a `pr-open` freeze and a pinned freeze look identical.
 */
export function parseReviewCommitPins(spec) {
  const pins = new Map();
  const entries = String(spec ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const entry of entries) {
    const m = /^(?:pr-)?(\d+)=(.+)$/i.exec(entry);
    if (!m) {
      throw new Error(
        `--review-commit entry ${JSON.stringify(entry)} is not <pr>=<sha> (e.g. pr-415=51c01826aa9f05e4cef9ee498668e3f2321b3602)`,
      );
    }
    const [, number, sha] = m;
    const lower = sha.toLowerCase();
    if (!FULL_SHA.test(lower)) {
      throw new Error(
        `--review-commit pr-${number}: ${JSON.stringify(sha)} is not a full 40-character sha — an abbreviation can resolve to a different commit later`,
      );
    }
    if (pins.has(number)) {
      throw new Error(`--review-commit pins PR ${number} twice (${pins.get(number)} and ${lower}) — one item has one review commit`);
    }
    pins.set(number, lower);
  }
  return pins;
}

/**
 * Every pinned PR must be one of the PRs being frozen.
 *
 * A pin naming a PR that is not in `--prs` is a typo, and it is the WORST kind
 * here: the pin is simply never consulted, every requested item freezes at the
 * default rule, and the run exits 0 with a corpus that looks perfectly healthy.
 * Nothing downstream can tell that snapshot from the intended one.
 */
export function assertPinsAreRequested(pins, numbers) {
  const requested = new Set((Array.isArray(numbers) ? numbers : []).map((n) => String(n).trim()));
  const stray = [...pins.keys()].filter((n) => !requested.has(n));
  if (stray.length > 0) {
    throw new Error(
      `--review-commit pins PR(s) ${stray.map((n) => `pr-${n}`).join(", ")} which are not being frozen ` +
        `(requested: ${[...requested].map((n) => `pr-${n}`).join(", ") || "none"}) — a pin that matches nothing is silently ignored`,
    );
  }
}

/**
 * Changed-file paths parsed FROM THE FROZEN DIFF. `+++ b/<path>` wins; a deletion
 * (`+++ /dev/null`) falls back to the `diff --git a/… b/<path>` header.
 *
 * There is deliberately NO fallback to the PR's own file list. The fork had one,
 * and it substitutes a different fact when the parse comes up empty: `view.files`
 * is the MERGED PR's file set, which includes files touched by the fix loop after
 * the review point. A lens scoped off that list would be shown files that did not
 * exist in the diff beside it. An empty parse means the extraction is broken, and
 * the caller skips the PR loudly instead.
 */
export function changedFilesFromDiff(diff) {
  const files = new Set();
  for (const line of String(diff ?? "").split("\n")) {
    // `+++ b/<path>` — path may be C-quoted (`+++ "b/na\303\257ve.ts"`) when it
    // carries a special or non-ASCII byte and `core.quotePath` is on (the default).
    let m = /^\+\+\+ (.+)$/.exec(line);
    if (m) {
      const p = stripDiffPathPrefix(m[1], "b/");
      if (p !== null && p !== "/dev/null") {
        files.add(p);
        continue;
      }
    }
    // Deletion fallback: `+++ /dev/null`, so take `b/<path>` off the git header.
    // Quoted: `diff --git "a/x" "b/x"`; unquoted: `diff --git a/x b/x`.
    m = /^diff --git (?:"a\/[^"]*" ("b\/.+")|a\/.+ (b\/.+))$/.exec(line);
    if (m) {
      const p = stripDiffPathPrefix(m[1] ?? m[2], "b/");
      if (p !== null) files.add(p);
    }
  }
  return [...files];
}

/**
 * Strip a `b/` (or `a/`) prefix off a diff header token, C-unquoting first if git
 * quoted it. Git wraps a path in double quotes and escapes special/high bytes as
 * `\NNN` (octal) or `\a\b\t\n\v\f\r\"\\` when `core.quotePath` is on. Returns the
 * path without the prefix, or `null` if the token does not carry that prefix.
 */
function stripDiffPathPrefix(token, prefix) {
  const raw = token.startsWith('"') && token.endsWith('"') ? unquoteGitPath(token) : token;
  return raw.startsWith(prefix) ? raw.slice(prefix.length) : null;
}

const C_ESCAPES = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };

/** Decode git's C-style quoting back to a UTF-8 string (quotes already present). */
function unquoteGitPath(quoted) {
  const body = quoted.slice(1, -1);
  const bytes = [];
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== "\\") {
      bytes.push(...Buffer.from(c, "utf8"));
      continue;
    }
    const next = body[++i];
    if (next >= "0" && next <= "7") {
      let oct = next;
      while (oct.length < 3 && body[i + 1] >= "0" && body[i + 1] <= "7") oct += body[++i];
      bytes.push(parseInt(oct, 8));
    } else if (next in C_ESCAPES) {
      bytes.push(C_ESCAPES[next]);
    } else {
      bytes.push(...Buffer.from(next, "utf8"));
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

/**
 * Added and removed lines OF THE FROZEN DIFF.
 *
 * The fork recorded the merged PR's `additions`/`deletions` and derived `scope`
 * from those, and its own README admitted the consequence: `scope` described the
 * merged PR rather than the reviewed diff — a size proxy, on the one field every
 * planned segmentation slices by (spec §4). Counting the diff we actually stored
 * costs two regexes. The PR's own totals are still recorded, as
 * `pr_additions`/`pr_deletions`, because the gap between the two is itself
 * interesting: it is how much the fix loop added after review.
 */
export function diffLineCounts(diff) {
  let additions = 0;
  let deletions = 0;
  for (const line of String(diff ?? "").split("\n")) {
    // File headers are `--- <path>` and `+++ <path>` — the SPACE after the three
    // characters is what separates them from content. Without it, a removed `---`
    // in a markdown/YAML file arrives as `----` and an added `++foo` arrives as
    // `+++foo`; both start with `---`/`+++` and were silently dropped from the
    // count that `scope` is derived from.
    if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
    if (line.startsWith("+")) additions++;
    else if (line.startsWith("-")) deletions++;
  }
  return { additions, deletions };
}

/**
 * The per-item `meta.json`, from a PR view plus the diff that was frozen.
 *
 * `label_status` is deliberately NOT recorded, and the fork's version had it. A
 * corpus item is write-once and a label is human truth that arrives later and
 * gets corrected; a status field stamped into an immutable file is a lie the
 * moment the first label lands. The store computes the status at read time from
 * `labels/` instead (PR 16).
 */
export function buildItemMeta(view, diff, issueSpec, reviewPoint = {}, diffMethod = DIFF_METHODS.ghPrDiff) {
  const changedFiles = changedFilesFromDiff(diff);
  const { additions, deletions } = diffLineCounts(diff);
  return {
    id: `pr-${view.number}`,
    source_pr: view.number,
    title: view.title ?? "",
    author: view.author?.login ?? "",
    provenance: classifyProvenance(view),
    issue_number: issueNumberOf(view),
    merged_at: view.mergedAt ?? null,
    base_ref: view.baseRefOid ?? "",
    base_ref_name: view.baseRefName ?? "",
    head_ref: view.headRefOid ?? "",
    // What a replay checks the tree out at, and what it passes as `--base-sha`.
    // `review_base` is why PR 6 can switch the novelty gate on at all.
    review_commit: reviewPoint.review_commit ?? view.headRefOid ?? "",
    review_base: reviewPoint.review_base ?? view.baseRefOid ?? "",
    review_point: reviewPoint.review_point ?? "head",
    diff_method: diffMethod,
    changed_files: changedFiles,
    // Of the FROZEN DIFF (see diffLineCounts) — this is what to segment on.
    additions,
    deletions,
    scope: scopeSize(additions, deletions),
    // HOW SPREAD OUT the change is, which `scope` and `changed_files` between them
    // cannot express: `scope` says how big, `changed_files` says which paths, and
    // neither says whether a reviewer is reading one hunk or nine modules. Those
    // are different review problems at identical size, so segmentation needs the
    // axis recorded rather than recomputed by each reader off `changed_files` —
    // which could not recover `single_hunk` at all (hunk counts are not in the
    // path list). Taken from the FROZEN DIFF for the same reason additions is:
    // the merged PR's file list spans whatever the post-review fix loop touched.
    localization_scope: localizationFromDiff(diff),
    // Of the MERGED PR, kept as provenance. Not a size proxy for the review.
    pr_additions: Number(view.additions) || 0,
    pr_deletions: Number(view.deletions) || 0,
    has_issue_spec: !!(issueSpec && issueSpec.trim()),
    sha256_diff: contentSha256(diff),
  };
}

/**
 * The compact index entry that goes in a corpus manifest.
 *
 * `localization_scope` rides along beside `scope` because the two are one query:
 * "compare the panel on small-single-hunk items against small-cross-module ones"
 * is answerable off the manifest alone, and without the field here it means
 * opening every item's `meta.json` to re-read a value already computed.
 */
export function manifestItem(meta) {
  return {
    id: meta.id,
    source_pr: meta.source_pr,
    base_ref: meta.base_ref,
    review_commit: meta.review_commit,
    review_base: meta.review_base,
    review_point: meta.review_point,
    diff_method: meta.diff_method,
    sha256_diff: meta.sha256_diff,
    has_issue_spec: meta.has_issue_spec,
    scope: meta.scope,
    localization_scope: meta.localization_scope,
    provenance: meta.provenance,
  };
}

/**
 * Which fields of a freshly extracted item differ from the one already stored —
 * the determinism check, as a pure function so it is unit-tested rather than
 * hoped for.
 *
 * The diff BYTES are compared, not only `sha256_diff`. Comparing the hashes alone
 * would trust the stored hash to describe the stored bytes, and "the hash no
 * longer matches its own file" is one of the states this is looking for.
 */
export function corpusItemDrift(fresh, stored) {
  const drift = [];
  const s = stored ?? {};
  const sMeta = s.meta ?? {};
  if (fresh.diff !== s.diff) drift.push("diff.patch");
  if (fresh.meta.sha256_diff !== sMeta.sha256_diff) drift.push("sha256_diff");
  if (contentSha256(String(s.diff ?? "")) !== sMeta.sha256_diff) drift.push("stored sha256_diff vs stored diff.patch");
  // `localization_scope` is DERIVED from the diff, and a derived field belongs in
  // this list precisely because the diff is already compared. The bytes prove the
  // INPUT is stable; they say nothing about the derivation. Edit
  // `localizationFromDiff` — change what counts as a module, count hunks
  // differently — and a re-extraction produces a different value from identical
  // bytes, which no other entry here can see: the diff matches, the hash matches,
  // only the meaning moved. It also covers the opposite direction, an item frozen
  // BEFORE the field existed: `undefined` against a real value is drift, so such
  // an item is reported and refused instead of being silently re-indexed without
  // the field. That second case is the trap this list has to keep answering,
  // because it reopens for every derived field anyone adds after a freeze — the
  // rule is that a new derived field goes in here in the same commit that adds it,
  // otherwise the only run that could have noticed prints `= unchanged`.
  //
  // `additions`/`deletions`/`scope` are the same class of field and are NOT here
  // yet — a gap, not a distinction, and named so nobody reads their absence as an
  // argument. This one is the urgent case of the three because its derivation is
  // the only one that lives OUTSIDE this module: `localizationFromDiff` belongs to
  // `classify.mjs`, which is maintained for the labelling pipeline's reasons and
  // can be edited by someone who has never heard of the corpus.
  for (const field of ["review_commit", "review_base", "review_point", "diff_method", "localization_scope"]) {
    if (fresh.meta[field] !== sMeta[field]) drift.push(`meta.${field}`);
  }
  const freshFiles = fresh.meta.changed_files ?? [];
  const storedFiles = Array.isArray(sMeta.changed_files) ? sMeta.changed_files : [];
  if (freshFiles.length !== storedFiles.length || freshFiles.some((f, i) => f !== storedFiles[i])) {
    drift.push("meta.changed_files");
  }
  // `null` from the store means "no issue-spec.md"; `""` from an extraction means
  // the same thing. Normalised so an absent spec does not read as drift.
  if ((fresh.issueSpec ?? "") !== (s.issueSpec ?? "")) drift.push(CORPUS_ITEM_FILES.issueSpec);
  return drift;
}

/**
 * The manifest for a corpus version, MERGING the fresh items into whatever the
 * version already indexed.
 *
 * The fork replaced the manifest with only the items from the current run, so
 * `--prs 664` against a 20-item version silently reduced the index to one entry
 * while nineteen items sat on disk unreferenced — data present and invisible,
 * which is the failure mode this project keeps paying for. Merging by id, fresh
 * wins (it has just been proved identical to the stored item, or the run has
 * already failed on drift).
 *
 * A version pinned to one `source_repo` REFUSES a second: "which repo is corpus
 * v1 from?" must have one answer.
 */
export function buildManifest({ corpusVersion, sourceRepo, existing, items }) {
  const prior = Array.isArray(existing?.items) ? existing.items : [];
  if (existing && existing.source_repo && sourceRepo && existing.source_repo !== sourceRepo) {
    throw new Error(
      `extract-corpus: corpus version ${corpusVersion} was extracted from ${existing.source_repo}, ` +
        `not ${sourceRepo} — one corpus version indexes one repository`,
    );
  }
  const byId = new Map(prior.map((it) => [it?.id, it]));
  let added = 0;
  for (const it of items) {
    if (!byId.has(it.id)) added++;
    byId.set(it.id, it);
  }
  // Code-point order, not `localeCompare`: collation depends on the process's
  // ICU locale, and this is the one file the byte-identity check covers whole.
  const merged = [...byId.values()].sort((a, b) => {
    const x = String(a?.id);
    const y = String(b?.id);
    return x < y ? -1 : x > y ? 1 : 0;
  });
  return {
    // No `created` timestamp, and that omission is deliberate. A clock reading
    // inside the manifest makes two extractions of the same corpus differ in
    // bytes, which makes the determinism check above unrunnable on the one file
    // that indexes everything. The eval repo is a git repo; it already records
    // when each version was written, with an author.
    manifest: {
      corpus_version: corpusVersion,
      source_repo: sourceRepo,
      item_count: merged.length,
      items: merged,
    },
    added,
    kept: merged.length - added,
  };
}

// --- the injected side effects ----------------------------------------------

/** Per-subprocess ceiling. A hung `git fetch` against an unreachable network
 *  would otherwise stall the batch, defeating the per-PR skip isolation. */
const IO_TIMEOUT_MS = 5 * 60 * 1000;

/** `gh`/`git`, in one object so a test replaces all of it and touches no network. */
export function ghGitIo({ repo = DEFAULT_REPO, repoSource } = {}) {
  const gh = (args) =>
    execFileSync("gh", args, { encoding: "utf8", maxBuffer: 128 * 1024 * 1024, timeout: IO_TIMEOUT_MS });
  const ghJson = (args) => JSON.parse(gh(args));
  const git = (args, opts = {}) =>
    execFileSync("git", ["-C", repoSource, ...args], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      timeout: IO_TIMEOUT_MS,
      // stderr captured, not inherited: a fallback path is expected here and
      // git's raw `fatal:` lines would read as the tool crashing.
      stdio: ["ignore", "pipe", "pipe"],
      ...opts,
    });

  return {
    repo,
    repoSource,

    prView(n) {
      // The 14 fields, verified live against `gh` 2.96.0 (audit §5-Q2).
      // `headRefName` is load-bearing: `classifyProvenance` and `issueNumberOf`
      // read the branch name, and `gh` omits any field not asked for — without
      // it every `agent/*` PR classified as "human".
      return ghJson([
        "pr", "view", String(n), "-R", repo, "--json",
        "number,title,author,createdAt,mergedAt,baseRefName,baseRefOid,headRefName,headRefOid,files,additions,deletions,commits,closingIssuesReferences",
      ]);
    },

    prNumbers({ state = "merged", limit = 30 }) {
      const list = ghJson(["pr", "list", "-R", repo, "--state", String(state), "--limit", String(limit), "--json", "number"]);
      return (Array.isArray(list) ? list : []).map((p) => String(p.number));
    },

    issueView(n) {
      return ghJson(["issue", "view", String(n), "-R", repo, "--json", "title,body"]);
    },

    /**
     * Fetch the PR's commits and its base branch into the `refs/eval/*` namespace
     * of `repoSource`, so the review-point diff can be computed locally.
     *
     * `refs/pull/N/head` brings the head and every PR commit; the base BRANCH
     * gives a merge-base anchor that survives `baseRefOid` drifting or vanishing
     * after the merge. Best-effort per ref — the caller degrades rather than
     * aborting, and records which path it took.
     *
     * These refs persist in the checkout afterwards. Clean up with:
     *   git for-each-ref --format='%(refname)' refs/eval | xargs -n1 git update-ref -d
     */
    fetchPrRefs(n, baseRefName) {
      const url = `https://github.com/${repo}.git`;
      let base = false;
      if (baseRefName) {
        try {
          git(["fetch", "-q", "-f", url, `refs/heads/${baseRefName}:refs/eval/base/${n}`]);
          base = true;
        } catch {
          // The base branch is optional; the diff falls back without it.
        }
      }
      try {
        git(["fetch", "-q", "-f", url, `refs/pull/${n}/head:refs/eval/pr/${n}`]);
        return { head: true, base };
      } catch (e) {
        return { head: false, base, error: e.message.split("\n")[0] };
      }
    },

    /**
     * Fetch ONE commit by full sha and pin it under `refs/eval/pin/<n>`.
     *
     * `refs/pull/<n>/head` is not enough for a pinned commit, and #415 is why: a
     * force-push removed the reviewed commit from that PR's commit list, so it is
     * absent from `refs/pull/415/head`'s history while still being present on the
     * server and fetchable by full sha. An unreachable object is one `git gc` away
     * from gone, so the fetch is followed by a ref — the same reason the base and
     * head fetches above leave refs behind.
     *
     * Best-effort: fetching a bare sha needs `uploadpack.allowReachableSHA1InWant`
     * (or the object to be reachable), and the caller's assertion is what decides.
     * Returns whether the object is present AFTERWARDS, which is the only question
     * that matters — a commit already in the checkout needs no network at all.
     */
    fetchPinnedCommit(n, sha) {
      const url = `https://github.com/${repo}.git`;
      if (this.hasCommit(sha)) {
        // Still pin it: present-but-unreachable is exactly #415's state, and it is
        // the state that expires.
        try {
          git(["update-ref", `refs/eval/pin/${n}`, sha]);
        } catch {
          // A ref we could not write is a durability loss, not a correctness one.
        }
        return true;
      }
      try {
        git(["fetch", "-q", "--no-tags", url, sha]);
        git(["update-ref", `refs/eval/pin/${n}`, sha]);
      } catch {
        // Falls through to the assertion, which names the item.
      }
      return this.hasCommit(sha);
    },

    /** Does this sha name a commit object in `repoSource`? */
    hasCommit(sha) {
      try {
        return git(["cat-file", "-t", String(sha)]).trim() === "commit";
      } catch {
        return false;
      }
    },

    mergeBase(a, b) {
      return git(["merge-base", a, b]).trim();
    },

    diffRange(range) {
      return git(["diff", range]);
    },

    prDiff(n) {
      return gh(["pr", "diff", String(n), "-R", repo, "--patch"]);
    },
  };
}

// --- the extraction ---------------------------------------------------------

/**
 * The diff to review, taken AT `review_commit`, plus the method that produced it.
 *
 * Layered so a flaky PR degrades rather than aborting the batch, and every layer
 * NAMES itself in the returned `method` — the fallback that fires is recorded in
 * the item, not just logged. `head` is a special case: it IS the merged diff, and
 * `gh pr diff` produces it robustly with no local commits at all.
 */
export function fetchDiff(io, n, reviewPoint, { hasBase = false, log = () => {} } = {}) {
  const { review_commit, review_base, review_point } = reviewPoint;
  if (review_point === "head") {
    return { diff: io.prDiff(n), method: DIFF_METHODS.ghPrDiff };
  }
  if (hasBase) {
    try {
      const fork = io.mergeBase(`refs/eval/base/${n}`, review_commit);
      if (fork) return { diff: io.diffRange(`${fork}..${review_commit}`), method: DIFF_METHODS.forkPoint };
    } catch (e) {
      log(`  PR #${n}: merge-base against the base branch failed (${e.message.split("\n")[0]}) — trying the base tip`);
    }
  }
  try {
    // `A...B` is git's own three-dot: the diff from merge-base(A,B) to B. Same
    // answer as the fork point above whenever the base tip is still an ancestor.
    return { diff: io.diffRange(`${review_base}...${review_commit}`), method: DIFF_METHODS.baseTip };
  } catch (e) {
    log(`  PR #${n}: base history unavailable (${e.message.split("\n")[0]})`);
  }
  return { diff: io.diffRange(`${review_commit}^...${review_commit}`), method: DIFF_METHODS.singleCommit };
}

/** Best-effort issue spec: the first closing issue's title + body, else "". */
export function fetchIssueSpec(io, view, { log = () => {} } = {}) {
  const ref = (view?.closingIssuesReferences ?? [])[0];
  if (!ref?.number) return "";
  try {
    const issue = io.issueView(ref.number);
    return `# ${issue.title ?? ""}\n\n${issue.body ?? ""}`.trim();
  } catch (e) {
    // Degrades to "no spec", and says so: `has_issue_spec: false` on an item that
    // does have one silently changes which lenses run (`needsIssueSpec`).
    log(`  issue #${ref.number} unavailable (${e.message.split("\n")[0]}) — freezing without an issue spec`);
    return "";
  }
}

/**
 * Fetch and pin every `--review-commit` sha, and REFUSE THE WHOLE RUN if any of
 * them does not resolve — before one item is extracted or one byte is written.
 *
 * A pre-flight rather than a per-PR skip, which is the opposite of how every other
 * failure in this module is handled, for one reason: the skip path's whole point
 * is that one flaky PR cannot cost the other nineteen, and a pin that does not
 * resolve is not a flaky PR. It is the operator's list being wrong, and the
 * remaining items would be frozen at a review point the operator did not ask for
 * while the run reported a partial success. Failing before anything is written
 * means the fix is "re-run with the right sha", not "work out which items in this
 * version are the ones you meant".
 *
 * The message names every unresolvable item at once — a list of seven shas checked
 * one run at a time is six more round trips than anyone needs.
 */
export function assertPinnedCommitsResolve(io, pins, { log = () => {} } = {}) {
  const missing = [];
  for (const [n, sha] of pins) {
    if (io.fetchPinnedCommit(n, sha)) {
      log(`  pinned pr-${n} @ ${sha.slice(0, 8)} (refs/eval/pin/${n})`);
      continue;
    }
    missing.push(`pr-${n}=${sha}`);
  }
  if (missing.length > 0) {
    throw new Error(
      `extract-corpus: --review-commit named ${missing.length} commit(s) that do not resolve in --repo-source: ` +
        `${missing.join(", ")}. Nothing was frozen. Check the sha, or fetch it first ` +
        `(git fetch --no-tags <remote> <sha>) — a review point that cannot be resolved must never fall back to ` +
        `${DEFAULT_REVIEW_POINT}, because that freeze would look identical to the one you asked for.`,
    );
  }
}

/** One PR → the four files' content, or a throw the caller turns into a skip. */
export function extractItem(io, n, { reviewPointMode = DEFAULT_REVIEW_POINT, pinnedCommit = "", log = () => {} } = {}) {
  const view = io.prView(n);
  const reviewPoint = resolveReviewPoint(view, reviewPointMode, pinnedCommit);
  const refs = reviewPoint.review_point === "head" ? { base: false } : io.fetchPrRefs(n, view.baseRefName);
  if (refs.error) log(`  PR #${n}: could not fetch refs/pull/${n}/head (${refs.error})`);
  const { diff, method } = fetchDiff(io, n, reviewPoint, { hasBase: refs.base, log });
  const issueSpec = fetchIssueSpec(io, view, { log });
  const meta = buildItemMeta(view, diff, issueSpec, reviewPoint, method);
  return { view, meta, diff, issueSpec, changedFiles: meta.changed_files, method };
}

/**
 * Freeze every requested PR, then write (or refresh) the version's manifest.
 *
 * Per-PR isolation: any failure is a counted skip, never a throw, so one flaky PR
 * cannot cost the other nineteen. The three outcomes that are NOT ordinary — a
 * degraded diff, drift against a stored item, an unusable extraction — are each
 * counted and each turn the exit code red, because a run that froze 18 of 20 and
 * exited 0 is a run whose corpus quietly has 18 items in it.
 */
export function extractCorpus({
  io,
  store,
  numbers,
  corpusVersion,
  reviewPointMode = DEFAULT_REVIEW_POINT,
  reviewCommitPins = new Map(),
  dryRun = false,
  allowDegradedDiff = false,
  log = () => {},
}) {
  const items = [];
  const skipped = [];
  const drifted = [];
  const degraded = [];
  let written = 0;
  let unchanged = 0;

  // Both guards stand HERE and not only in `main`, because this is the door every
  // caller walks through — the CLI, a test, and whatever runs the next freeze.
  // A validator only guards the door it stands in (the `assertEffort` lesson).
  assertPinsAreRequested(reviewCommitPins, numbers);
  assertPinnedCommitsResolve(io, reviewCommitPins, { log });

  for (const n of numbers) {
    let extracted;
    try {
      extracted = extractItem(io, n, { reviewPointMode, pinnedCommit: reviewCommitPins.get(String(n).trim()) ?? "", log });
    } catch (e) {
      skipped.push({ pr: String(n), reason: "extract-failed", detail: e.message.split("\n")[0] });
      log(`  skip PR #${n}: ${e.message.split("\n")[0]}`);
      continue;
    }

    const { meta, diff, issueSpec, method } = extracted;
    if (!diff || diff.trim() === "") {
      skipped.push({ pr: String(n), reason: "empty-diff", detail: `method ${method}` });
      log(`  skip PR #${n}: empty diff (method ${method})`);
      continue;
    }
    if (meta.changed_files.length === 0) {
      // A non-empty diff that names no files is a broken patch, not a small one.
      skipped.push({ pr: String(n), reason: "no-changed-files", detail: `${diff.length} bytes of diff, 0 paths parsed` });
      log(`  skip PR #${n}: ${diff.length} bytes of diff parsed to 0 file paths`);
      continue;
    }
    if (DEGRADED_DIFF_METHODS.has(method) && !allowDegradedDiff) {
      degraded.push({ pr: String(n), id: meta.id, method });
      skipped.push({ pr: String(n), reason: "degraded-diff", detail: method });
      log(
        `  skip PR #${n}: diff came from the ${method} fallback, which holds only the last commit's own change ` +
          `rather than the PR's cumulative diff. Fetch the base branch into --repo-source, or pass ` +
          `--allow-degraded-diff to freeze it anyway (the method is recorded in meta.diff_method).`,
      );
      continue;
    }

    // An item already frozen is a DETERMINISM CHECK, not a skip. This is the one
    // place the byte-identical property is actually enforced rather than assumed.
    if (store.hasCorpusItem(meta.id)) {
      const stored = store.getCorpusItemInput(meta.id);
      const fields = corpusItemDrift({ meta, diff, issueSpec }, stored);
      if (fields.length > 0) {
        drifted.push({ id: meta.id, fields });
        log(`  DRIFT ${meta.id}: re-extraction differs from the stored item in ${fields.join(", ")} — NOT overwritten`);
        continue;
      }
      unchanged++;
      items.push(manifestItem(stored.meta));
      log(`  = ${meta.id} unchanged (${meta.changed_files.length} files, ${meta.scope}, @${meta.review_point} ${meta.review_commit.slice(0, 8)})`);
      continue;
    }

    if (!dryRun) {
      try {
        store.putCorpusItem(meta.id, { meta, diff, changedFiles: meta.changed_files, issueSpec });
      } catch (e) {
        // The store refuses on any doubt (a sha that does not match its diff, a
        // missing `review_base`). That refusal is the item's problem, not the
        // batch's.
        skipped.push({ pr: String(n), reason: "store-refused", detail: e.message });
        log(`  skip PR #${n}: ${e.message}`);
        continue;
      }
    }
    written++;
    items.push(manifestItem(meta));
    // `localization_scope` prints on THIS line and not on the `= unchanged` one:
    // the `+` line is what `--dry-run` shows a human before they freeze anything,
    // and a derived field is only checkable while the item can still be refused.
    // The `=` line reports an item that is already immutable, and the drift list
    // above is what guards that path.
    log(
      `  + ${meta.id} (${meta.changed_files.length} files, +${meta.additions}/-${meta.deletions} ${meta.scope}, ` +
        `${meta.localization_scope}, issue_spec=${meta.has_issue_spec}, @${meta.review_point} ` +
        `${meta.review_commit.slice(0, 8)}, ${method})`,
    );
  }

  let manifest = null;
  let merge = null;
  if (items.length > 0) {
    merge = buildManifest({
      corpusVersion,
      sourceRepo: io.repo,
      existing: store.getCorpusManifest(corpusVersion),
      items,
    });
    manifest = merge.manifest;
    if (!dryRun) store.putCorpusManifest(corpusVersion, manifest);
  }

  return { items, written, unchanged, skipped, drifted, degraded, manifest, merge, dryRun };
}

/**
 * The one-line report and the exit code, in one function because they are one
 * decision: what the run says and whether it is red must not be able to disagree.
 * Every count is printed even at zero — "0 frozen" is either fine or an
 * emergency, and printing the number is what makes the question askable.
 */
export function summarize(result) {
  const r = result ?? {};
  const skipped = Array.isArray(r.skipped) ? r.skipped : [];
  const drifted = Array.isArray(r.drifted) ? r.drifted : [];
  const byReason = new Map();
  for (const s of skipped) byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1);
  const reasons = [...byReason.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const parts = [
    `${r.dryRun ? "would freeze" : "froze"} ${Number(r.written) || 0} item(s)`,
    `${Number(r.unchanged) || 0} unchanged`,
    skipped.length === 0 ? "0 skipped" : `${skipped.length} skipped (${reasons.map(([reason, n]) => `${n} ${reason}`).join(", ")})`,
    // This run's contribution and the version's total, kept apart on purpose. They
    // differ whenever a PR was skipped or drifted, and the manifest MERGES, so
    // reporting only one of them makes a partial run read as a shrinking corpus
    // (or a shrinking corpus read as a partial run).
    `${Array.isArray(r.items) ? r.items.length : 0} item(s) indexed this run`,
    `version now holds ${r.manifest ? Number(r.manifest.item_count) || 0 : "no"} item(s)`,
  ];
  if (drifted.length > 0) {
    parts.push(`DRIFT on ${drifted.length} item(s): ${drifted.map((d) => `${d.id} (${d.fields.join("/")})`).join(", ")}`);
  }

  return {
    line: `extract-corpus: ${parts.join(" · ")}`,
    // Drift is red because two extractions of one PR disagreeing breaks every
    // comparison downstream. A skip is red because a corpus with holes in it
    // still gets scored, and the holes do not announce themselves later.
    exitCode: drifted.length > 0 || skipped.length > 0 ? 1 : 0,
    byReason: Object.fromEntries(reasons),
  };
}

// --- CLI --------------------------------------------------------------------

const USAGE = `Usage:
  extract-corpus.mjs --root <eval-repo> --corpus-version <name>
                     [--prs 664,673 | --limit <n> --state merged]
                     [--repo owner/name] [--repo-source <path>]
                     [--review-point ${REVIEW_POINTS.join("|")}]
                     [--review-commit pr-<n>=<sha>,...]
                     [--dry-run] [--allow-degraded-diff]

  Freezes each PR into <root>/corpus/items/pr-<n>/{meta.json, diff.patch,
  changed-files.txt, issue-spec.md} and indexes them in
  <root>/corpus/manifests/<corpus-version>.json. No model is invoked.

  --root         REQUIRED, no default. The eval repo checkout, NOT this repository
                 — git history is permanent (see capture-store.mjs).
  --repo-source  a local clone to fetch PR commits into and diff from
                 (default: this repository). Leaves refs under refs/eval/.
  --review-point which commit to freeze the diff at (default ${DEFAULT_REVIEW_POINT}).
  --review-commit
                 pin the review commit for individual PRs, overriding
                 --review-point for those items and recording
                 review_point=${REVIEW_POINT_PINNED}. Full 40-character shas only.
                 A sha that does not resolve, or that names a PR not being
                 frozen, refuses the whole run before anything is written —
                 it never falls back to ${DEFAULT_REVIEW_POINT}.
  --dry-run      compute and report everything, write nothing.

Re-running over an existing root does not overwrite: each already-frozen item is
COMPARED against a fresh extraction and any difference is reported as DRIFT.

Exit codes: 0 every requested PR is frozen and unchanged · 1 something was
skipped or drifted · 2 usage.`;

export function main(argv) {
  const args = parseArgs(argv, { booleans: ["dry-run", "allow-degraded-diff", "help"] });
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  // A usage error (2), before any request is made, so a missing flag costs
  // nothing. `store.mjs` refuses too; this is the same refusal in the CLI's
  // vocabulary, because a stack trace is a worse first experience than a usage line.
  if (args.root === undefined || String(args.root).trim() === "") {
    // `--out` was the fork's name for it. Named explicitly so muscle memory gets
    // an answer rather than a bare "required".
    const wasOut = args.out !== undefined ? " (the fork harness called this --out)" : "";
    console.error(`extract-corpus: --root is required and has no default${wasOut}.\n${USAGE}`);
    return 2;
  }
  if (args["corpus-version"] === undefined || String(args["corpus-version"]).trim() === "") {
    console.error(`extract-corpus: --corpus-version is required.\n${USAGE}`);
    return 2;
  }
  const reviewPointMode = args["review-point"] ?? DEFAULT_REVIEW_POINT;
  // `pinned` is rejected here along with everything else outside the four modes:
  // it is a value the FIELD holds, never a mode the flag may ask for.
  if (!REVIEW_POINTS.includes(reviewPointMode)) {
    console.error(`extract-corpus: --review-point must be one of ${REVIEW_POINTS.join(", ")}, got ${JSON.stringify(reviewPointMode)}`);
    return 2;
  }
  let reviewCommitPins;
  try {
    reviewCommitPins = parseReviewCommitPins(args["review-commit"]);
  } catch (e) {
    console.error(`extract-corpus: ${e.message}`);
    return 2;
  }
  if (args.limit !== undefined) {
    const n = Number(args.limit);
    if (!Number.isInteger(n) || n <= 0) {
      console.error(`extract-corpus: --limit takes a positive integer`);
      return 2;
    }
  }
  if (args.state !== undefined && !PR_STATES.includes(String(args.state))) {
    console.error(`extract-corpus: --state must be one of ${PR_STATES.join(", ")}, got ${JSON.stringify(args.state)}`);
    return 2;
  }

  const repo = args.repo ?? DEFAULT_REPO;
  const repoSource = path.resolve(args["repo-source"] ?? path.join(HERE, "..", "..", ".."));
  const io = ghGitIo({ repo, repoSource });
  const store = new EvalStore(args.root);
  const corpusVersion = String(args["corpus-version"]);

  let numbers;
  if (args.prs !== undefined) {
    numbers = String(args.prs).split(",").map((s) => s.trim()).filter(Boolean);
  } else {
    // `gh pr list` reaches the network and can fail (gh missing, unauthenticated).
    // This one call is outside the per-PR skip isolation, so a raw throw here would
    // escape `main` as a Node stack trace instead of a usage-shaped CLI error.
    try {
      numbers = io.prNumbers({ state: args.state ?? "merged", limit: args.limit ?? 30 });
    } catch (err) {
      console.error(`extract-corpus: could not list PRs (is 'gh' installed and authenticated?): ${err?.message ?? err}`);
      return 1;
    }
  }
  if (numbers.length === 0) {
    console.error(`extract-corpus: no PRs to freeze — --prs was empty and the list returned nothing`);
    return 1;
  }
  // A pin that names nothing is a typo, and it costs a usage error rather than a
  // run, because the run it would produce exits 0 and looks right.
  try {
    assertPinsAreRequested(reviewCommitPins, numbers);
  } catch (e) {
    console.error(`extract-corpus: ${e.message}`);
    return 2;
  }

  console.log(
    `extract-corpus: ${numbers.length} PR(s) from ${repo} → corpus "${corpusVersion}" in ${args.root} ` +
      `(review-point=${reviewPointMode}${reviewCommitPins.size ? `, ${reviewCommitPins.size} pinned` : ""}` +
      `${args["dry-run"] ? ", dry-run" : ""})`,
  );
  let result;
  try {
    result = extractCorpus({
      io,
      store,
      numbers,
      corpusVersion,
      reviewPointMode,
      reviewCommitPins,
      dryRun: !!args["dry-run"],
      allowDegradedDiff: !!args["allow-degraded-diff"],
      log: (m) => console.error(m),
    });
  } catch (e) {
    // The pre-flight pin check is the only thing that throws out of here, and it
    // throws precisely so that nothing was written. Operational (1), not usage (2):
    // the flag was well-formed, the repository could not supply the commit.
    console.error(e.message);
    return 1;
  }
  const summary = summarize(result);
  console.log(summary.line);
  if (args["dry-run"]) console.log(`extract-corpus: DRY RUN — nothing was written to ${args.root}.`);
  return summary.exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv));
}
