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

/** Assemble the per-item meta.json from a PR view + diff. */
export function buildItemMeta(view, diff, issueSpec) {
  const changedFiles = (view.files ?? []).map((f) => f.path).filter(Boolean);
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
    changed_files: changedFiles,
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
  };
}

// --- gh-backed fetch --------------------------------------------------------

function gh(args) { return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 }); }
function ghJson(args) { return JSON.parse(gh(args)); }

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

function fetchPr(repo, n) {
  const view = ghJson([
    "pr", "view", n, "-R", repo, "--json",
    "number,title,author,mergedAt,baseRefName,baseRefOid,headRefOid,files,closingIssuesReferences",
  ]);
  const diff = gh(["pr", "diff", n, "-R", repo, "--patch"]);
  const issueSpec = fetchIssueSpec(repo, view);
  return { view, diff, issueSpec };
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
  const numbers = resolvePrNumbers(args);
  console.log(`extract-corpus: ${numbers.length} PR(s) from ${args.repo} → corpus "${corpusVersion}"${args["dry-run"] ? " (dry-run)" : ""}`);

  const items = [];
  let skipped = 0;
  for (const n of numbers) {
    try {
      const { view, diff, issueSpec } = fetchPr(args.repo, n);
      if (!diff || diff.trim() === "") { console.error(`  skip PR #${n}: empty diff`); skipped++; continue; }
      const meta = buildItemMeta(view, diff, issueSpec);
      if (!args["dry-run"]) {
        store.putCorpusItem(meta.id, { meta, diff, changedFiles: meta.changed_files, issueSpec });
      }
      items.push(manifestItem(meta));
      console.log(`  + ${meta.id} (${meta.changed_files.length} files, issue_spec=${meta.has_issue_spec})`);
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
