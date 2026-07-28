// Corpus extractor — freeze historical PR diffs from a repo into a corpus
// version in the results store. One item = one PR's net diff (the reviewable
// input). Best-effort per PR: a fetch that fails is logged and skipped, never
// fatal, so a flaky PR can't abort the whole extraction.
//
// Usage:
//   node extract-corpus.mjs --out <results-repo> --corpus-version <name> \
//        [--repo owner/name] [--prs 517,520,530] [--limit 30] [--state merged] [--dry-run]
//
// Pure helpers (buildItemMeta, manifestItem) are exported for tests; the gh-backed
// fetch + CLI run only when executed directly.

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GitFsStore } from "./store.mjs";
import { contentHash } from "./config-hash.mjs";
import { scopeSize } from "../metrics.mjs"; // reuse the pipeline's own S/M/L rule

const HERE = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_REPO = "wafflebase/wafflebase";

// --- pure helpers (exported for tests) --------------------------------------

/**
 * Provenance of a diff — critical for honest reliability reporting:
 *   - "autonomous"      : the app/yorkie-agent bot ran issue→PR end-to-end (the
 *                         real production review target); branch agent/<issue#>-.
 *   - "local-cli-agent" : a human built it via local Claude CLI on an agent/*
 *                         branch (mostly pipeline self-development).
 *   - "human"           : an ordinary human-authored PR.
 * Only "autonomous" items back a claim about the panel on real bot output.
 */
export function classifyProvenance(view) {
  const author = view.author?.login ?? "";
  const branch = view.headRefName ?? "";
  if (author === "app/yorkie-agent") return "autonomous";
  if (branch.startsWith("agent/")) return "local-cli-agent";
  return "human";
}

/** Issue number from an autonomous branch (agent/<num>-slug) or a closing ref. */
export function issueNumberOf(view) {
  const m = /^agent\/(\d+)-/.exec(view.headRefName ?? "");
  if (m) return Number(m[1]);
  return (view.closingIssuesReferences ?? [])[0]?.number ?? null;
}

/**
 * The REVIEW POINT — which commit to review at, so the frozen diff matches what
 * the panel actually reviewed rather than the merged (already-fixed) state.
 *   - "head"  : the PR's final state (== the merged diff). No pre-review context.
 *   - "first" : the PR's FIRST commit (the pre-fix state, where the panel's
 *               blocking findings originate) → gives verdict diversity.
 *   - "auto"  : autonomous PRs → "first" (they went through the fix loop),
 *               everything else → "head" (no meaningful pre-review state).
 * Returns { review_commit, review_base, review_point }.
 */
export function resolveReviewPoint(view, mode = "auto") {
  const commits = Array.isArray(view.commits) ? view.commits : [];
  const head = view.headRefOid ?? "";
  const base = view.baseRefOid ?? "";
  const first = commits[0]?.oid ?? head;
  let point = mode;
  if (mode === "auto") point = classifyProvenance(view) === "autonomous" ? "first" : "head";
  const review_commit = point === "first" ? first : head;
  return { review_commit, review_base: base, review_point: point };
}

/** Changed-file paths parsed from a unified diff (the ACTUAL reviewed files, so
 * lens path-scoping matches the review point). `+++ b/<path>` wins; deletions
 * (`+++ /dev/null`) fall back to the `diff --git a/… b/<path>` header. */
export function changedFilesFromDiff(diff) {
  const files = new Set();
  for (const line of String(diff ?? "").split("\n")) {
    let m = /^\+\+\+ b\/(.+)$/.exec(line);
    if (m && m[1] !== "/dev/null") { files.add(m[1]); continue; }
    m = /^diff --git a\/.+ b\/(.+)$/.exec(line);
    if (m) files.add(m[1]);
  }
  return [...files];
}

/** Assemble the per-item meta.json from a PR view + diff + resolved review point. */
export function buildItemMeta(view, diff, issueSpec, reviewPoint = {}) {
  // Prefer files parsed from the reviewed diff; fall back to the PR's file list.
  const fromDiff = changedFilesFromDiff(diff);
  const changedFiles = fromDiff.length ? fromDiff : (view.files ?? []).map((f) => f.path).filter(Boolean);
  const additions = Number(view.additions) || 0;
  const deletions = Number(view.deletions) || 0;
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
    // The commit the frozen diff/context are taken AT (fidelity: reviewed state,
    // not merged). review_commit is what the adapter checks the repo out at.
    review_commit: reviewPoint.review_commit ?? view.headRefOid ?? "",
    review_base: reviewPoint.review_base ?? view.baseRefOid ?? "",
    review_point: reviewPoint.review_point ?? "head",
    changed_files: changedFiles,
    additions,
    deletions,
    // Scope lets reliability be sliced by diff size (S/M/L) later; same rule the
    // pipeline itself uses for the effort summary.
    scope: scopeSize(additions, deletions),
    has_issue_spec: !!(issueSpec && issueSpec.trim()),
    sha256_diff: contentHash(diff),
    label_status: "unlabeled", // Track B
  };
}

/** The compact index entry that goes in the corpus manifest. */
export function manifestItem(meta) {
  return {
    id: meta.id, source_pr: meta.source_pr, base_ref: meta.base_ref,
    sha256_diff: meta.sha256_diff, has_issue_spec: meta.has_issue_spec,
    scope: meta.scope, provenance: meta.provenance, review_point: meta.review_point,
  };
}

// --- gh-backed fetch --------------------------------------------------------

function gh(args) { return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 }); }
function ghJson(args) { return JSON.parse(gh(args)); }

function gitC(repoSource, args, opts = {}) {
  return execFileSync("git", ["-C", repoSource, ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, ...opts });
}

/** Fetch a PR's commits into the local clone so we can diff/archive at any of
 * them (refs/pull/N/head brings the head + all PR commits). Best-effort. */
function ensurePrCommits(repoSource, repo, n) {
  try {
    gitC(repoSource, ["fetch", "-q", `https://github.com/${repo}.git`, `refs/pull/${n}/head`], { stdio: "pipe" });
    return true;
  } catch (e) {
    console.error(`  (fetch pull/${n}/head failed: ${e.message.split("\n")[0]})`);
    return false;
  }
}

/** The diff to review, taken AT review_commit. Three-dot (merge-base) semantics
 * to match GitHub's PR diff. Falls back to the single review commit's own change
 * if the base isn't locally reachable. */
function diffAtReviewPoint(repoSource, repo, n, reviewPoint) {
  const { review_commit, review_base, review_point } = reviewPoint;
  // "head" == the merged/current PR diff — gh gives it robustly, no local commits needed.
  if (review_point === "head") return gh(["pr", "diff", n, "-R", repo, "--patch"]);
  try {
    return gitC(repoSource, ["diff", `${review_base}...${review_commit}`]);
  } catch {
    return gitC(repoSource, ["diff", `${review_commit}^...${review_commit}`]); // base unreachable → first commit alone
  }
}

function resolvePrNumbers(args) {
  if (args.prs) return String(args.prs).split(",").map((s) => s.trim()).filter(Boolean);
  const limit = String(args.limit ?? 30);
  const state = args.state ?? "merged";
  const list = ghJson(["pr", "list", "-R", args.repo, "--state", state, "--limit", limit, "--json", "number"]);
  return list.map((p) => String(p.number));
}

// Best-effort issue spec: the first closing-issue's title+body, else "".
function fetchIssueSpec(repo, view) {
  const ref = (view.closingIssuesReferences ?? [])[0];
  if (!ref?.number) return "";
  try {
    const issue = ghJson(["issue", "view", String(ref.number), "-R", repo, "--json", "title,body"]);
    return `# ${issue.title ?? ""}\n\n${issue.body ?? ""}`.trim();
  } catch (e) {
    console.error(`  (issue #${ref.number} unavailable: ${e.message})`);
    return "";
  }
}

function fetchPr(repo, n, { reviewPointMode = "auto", repoSource } = {}) {
  const view = ghJson([
    "pr", "view", n, "-R", repo, "--json",
    "number,title,author,mergedAt,baseRefName,baseRefOid,headRefOid,files,additions,deletions,commits,closingIssuesReferences",
  ]);
  const reviewPoint = resolveReviewPoint(view, reviewPointMode);
  // Fetch the PR's commits so review_commit (head OR first) is locally available
  // for BOTH the review-point diff and the runner's repo-context checkout (a).
  ensurePrCommits(repoSource, repo, n);
  const diff = diffAtReviewPoint(repoSource, repo, n, reviewPoint);
  const issueSpec = fetchIssueSpec(repo, view);
  return { view, diff, issueSpec, reviewPoint };
}

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) a[key] = true;
    else { a[key] = next; i++; }
  }
  return a;
}

function main() {
  const args = parseArgs(process.argv);
  args.repo = args.repo ?? DEFAULT_REPO;
  if (!args.out) { console.error("extract-corpus: --out <results-repo> is required"); process.exit(2); }
  if (!args["corpus-version"]) { console.error("extract-corpus: --corpus-version <name> is required"); process.exit(2); }

  const store = new GitFsStore(args.out);
  const corpusVersion = args["corpus-version"];
  // Local clone to fetch PR commits into + diff/archive from (default: this repo).
  const repoSource = path.resolve(args["repo-source"] ?? path.join(HERE, "..", ".."));
  const reviewPointMode = args["review-point"] ?? "auto"; // auto | head | first
  const numbers = resolvePrNumbers(args);
  console.log(`extract-corpus: ${numbers.length} PR(s) from ${args.repo} → corpus "${corpusVersion}" (review-point=${reviewPointMode})${args["dry-run"] ? " (dry-run)" : ""}`);

  const items = [];
  let skipped = 0;
  for (const n of numbers) {
    try {
      const { view, diff, issueSpec, reviewPoint } = fetchPr(args.repo, n, { reviewPointMode, repoSource });
      if (!diff || diff.trim() === "") { console.error(`  skip PR #${n}: empty diff`); skipped++; continue; }
      const meta = buildItemMeta(view, diff, issueSpec, reviewPoint);
      if (!args["dry-run"]) {
        store.putCorpusItem(meta.id, { meta, diff, changedFiles: meta.changed_files, issueSpec });
      }
      items.push(manifestItem(meta));
      console.log(`  + ${meta.id} (${meta.changed_files.length} files, issue_spec=${meta.has_issue_spec}, @${meta.review_point} ${meta.review_commit.slice(0, 8)})`);
    } catch (e) {
      console.error(`  skip PR #${n}: ${e.message}`);
      skipped++;
    }
  }

  const manifest = {
    corpus_version: corpusVersion,
    created: new Date().toISOString(),
    source_repo: args.repo,
    item_count: items.length,
    items,
  };
  if (!args["dry-run"]) store.putCorpusManifest(corpusVersion, manifest);
  console.log(`extract-corpus: wrote ${items.length} item(s), skipped ${skipped}${args["dry-run"] ? " (dry-run, nothing written)" : ""}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
