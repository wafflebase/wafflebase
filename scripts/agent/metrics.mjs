// Agent effort/cost metrics for the autonomous issue→PR pipeline.
//
// Each agent session (kickoff `implement` / `ci-fix` / `review-fix`) appends a
// machine-readable record to a hidden LEDGER comment on the PR. When the PR is
// promoted to ready-for-review, the promote job renders one aggregated,
// human-readable SUMMARY comment:
//
//   - Agents: claude-opus-4-8
//   - Scope-size: M
//   - Attempt: 1
//   - Sessions: 1
//   - Total-time: 89m
//   - Turns: 27
//   - Tokens: ~1.0M
//
// Data source: `claude-execution-output.json` (the claude-code-action transcript)
// — its final `result` message carries num_turns / duration_ms / usage / modelUsage.
// Tokens = input+output+cache (total processed). Scope-size = PR diff lines.
//
// Pure helpers are exported and unit-tested (no gh). The CLI (`record` /
// `summarize`) talks to GitHub via the `gh` CLI (GH_TOKEN / GITHUB_TOKEN).
// Recording is FAIL-SAFE: any error exits 0 so metrics can never break the
// pipeline (the workflow steps are also continue-on-error).

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Each session posts its OWN hidden metric comment (append-only) — no shared
// ledger to read-modify-write, so concurrent sessions can't overwrite each
// other's records. SUMMARY is the single aggregated comment, upserted by the
// promote job (one writer, no race).
const METRIC_PREFIX = "<!-- agent-metric ";
export const SUMMARY_MARKER = "<!-- agent-metrics-summary -->";

// --- pure helpers (exported for tests; no gh) ------------------------------

/** Extract one session record from a parsed claude-execution-output.json array. */
export function parseExecution(messages, kind = "implement") {
  const arr = Array.isArray(messages) ? messages : [];
  const result = [...arr].reverse().find((m) => m && m.type === "result");
  if (!result) return null;
  const u = result.usage || {};
  const tokens =
    (u.input_tokens || 0) +
    (u.output_tokens || 0) +
    (u.cache_creation_input_tokens || 0) +
    (u.cache_read_input_tokens || 0);
  return {
    kind,
    models: Object.keys(result.modelUsage || {}),
    turns: result.num_turns || 0,
    tokens,
    durationMs: result.duration_ms || 0,
    costUsd: result.total_cost_usd || 0,
    sessionId: result.session_id || "",
  };
}

/** Aggregate an array of session records into pipeline-wide totals. */
export function aggregate(records) {
  const list = Array.isArray(records) ? records : [];
  const agents = [...new Set(list.flatMap((r) => r.models || []))].sort();
  // Attempt = review cycles: 1 = approved on the first review; +1 per review-fix
  // round. (Distinct from Sessions, which also counts CI-fix runs.)
  const reviewFixes = list.filter((r) => r.kind === "review-fix").length;
  const sum = (f) => list.reduce((s, r) => s + (Number(r[f]) || 0), 0);
  return {
    agents,
    sessions: list.length,
    attempt: reviewFixes + 1,
    turns: sum("turns"),
    tokens: sum("tokens"),
    durationMs: sum("durationMs"),
    costUsd: sum("costUsd"),
  };
}

/** S/M/L from total lines changed in the PR diff. */
export function scopeSize(additions = 0, deletions = 0) {
  const changed = (Number(additions) || 0) + (Number(deletions) || 0);
  if (changed <= 50) return "S";
  if (changed <= 300) return "M";
  return "L";
}

export function formatTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1e6) return `~${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `~${Math.round(v / 1e3)}K`;
  return `~${v}`;
}

export function formatMinutes(ms) {
  return `${Math.max(1, Math.round((Number(ms) || 0) / 60000))}m`;
}

/** Render the human-readable summary comment body. */
export function renderSummary({ agg, scope }) {
  return [
    SUMMARY_MARKER,
    "## 🤖 Agent effort",
    "",
    `- Agents: ${agg.agents.length ? agg.agents.join(", ") : "unknown"}`,
    `- Scope-size: ${scope}`,
    `- Attempt: ${agg.attempt}`,
    `- Sessions: ${agg.sessions}`,
    `- Total-time: ${formatMinutes(agg.durationMs)}`,
    `- Turns: ${agg.turns}`,
    `- Tokens: ${formatTokens(agg.tokens)}`,
  ].join("\n");
}

/** One session's record as a self-contained HIDDEN comment (renders invisibly).
 * The record fields are machine-generated (no free text), so the JSON never
 * contains the ` -->` terminator the parser splits on. */
export function serializeRecord(rec) {
  return `${METRIC_PREFIX}${JSON.stringify(rec)} -->`;
}

/** Recover the record from a single metric comment body; null if not one. */
export function parseMetricComment(body) {
  const m = /<!-- agent-metric ([\s\S]*?) -->/.exec(body || "");
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

// --- gh-backed CLI ---------------------------------------------------------

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8" });
}
function ghJson(args) {
  return JSON.parse(gh(args));
}

function resolvePrByIssue(issue) {
  // The kickoff creates a branch `agent/<issue>-<slug>`; find the open PR for it.
  // --limit well above the default 30 so a busy repo's PR list isn't truncated
  // before ours is seen.
  const prs = ghJson(["pr", "list", "--state", "open", "--limit", "500", "--json", "number,headRefName"]);
  const prefix = `agent/${issue}-`;
  const hit = prs.find((p) => (p.headRefName || "").startsWith(prefix));
  return hit ? String(hit.number) : "";
}

// ALL comment pages, not just the first 100 — a chatty PR exceeds one page, and
// missing pages would drop metric records or the summary marker. `--slurp` wraps
// the paginated responses in a JSON array of pages, which we flatten.
function listAllComments(pr) {
  const pages = ghJson(["api", "--paginate", "--slurp", `repos/{owner}/{repo}/issues/${pr}/comments?per_page=100`]);
  return Array.isArray(pages) ? pages.flat() : [];
}

function findComment(pr, marker) {
  return listAllComments(pr).find((c) => (c.body || "").includes(marker));
}

function upsertComment(pr, marker, body) {
  const existing = findComment(pr, marker);
  if (existing) {
    gh(["api", "-X", "PATCH", `repos/{owner}/{repo}/issues/comments/${existing.id}`, "-f", `body=${body}`]);
  } else {
    gh(["api", "-X", "POST", `repos/{owner}/{repo}/issues/${pr}/comments`, "-f", `body=${body}`]);
  }
}

function parseArgs(argv) {
  const a = {};
  for (let i = 3; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      a[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return a;
}

// Metrics must NEVER fail the pipeline: log and exit 0 on any problem.
function bail(msg) {
  console.error(`metrics: ${msg}`);
  process.exit(0);
}

function cmdRecord(args) {
  const pr = args.pr || (args.issue ? resolvePrByIssue(args.issue) : "");
  if (!pr) return bail("no PR resolved (need --pr, or --issue with an open agent/<issue>- PR)");
  let messages;
  try {
    messages = JSON.parse(readFileSync(args.execution, "utf8"));
  } catch (e) {
    return bail(`cannot read execution log ${args.execution}: ${e.message}`);
  }
  const rec = parseExecution(messages, args.kind || "implement");
  if (!rec) return bail("no result message in the execution log");
  try {
    // Append-only: POST this session's own metric comment. No read-modify-write,
    // so concurrent sessions can't clobber each other's records.
    gh(["api", "-X", "POST", `repos/{owner}/{repo}/issues/${pr}/comments`, "-f", `body=${serializeRecord(rec)}`]);
  } catch (e) {
    return bail(`could not record metrics for PR #${pr}: ${e.message}`);
  }
  console.log(`recorded ${rec.kind} for PR #${pr}: turns=${rec.turns} tokens=${rec.tokens} ${formatMinutes(rec.durationMs)}`);
}

function cmdSummarize(args) {
  const pr = args.pr;
  if (!pr) return bail("summarize needs --pr");
  let records, prInfo;
  try {
    records = listAllComments(pr).map((c) => parseMetricComment(c.body || "")).filter(Boolean);
    if (records.length === 0) return bail(`no metrics recorded for PR #${pr}; skipping summary`);
    prInfo = ghJson(["pr", "view", pr, "--json", "additions,deletions"]);
  } catch (e) {
    return bail(`could not read metrics/PR for #${pr}: ${e.message}`);
  }
  const agg = aggregate(records);
  const scope = scopeSize(prInfo.additions, prInfo.deletions);
  try {
    upsertComment(pr, SUMMARY_MARKER, renderSummary({ agg, scope }));
  } catch (e) {
    return bail(`could not post summary for PR #${pr}: ${e.message}`);
  }
  console.log(`posted agent-effort summary for PR #${pr} (sessions=${agg.sessions} turns=${agg.turns} tokens=${agg.tokens})`);
}

// Only run the CLI when executed directly (not when imported for tests).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2];
  const args = parseArgs(process.argv);
  if (cmd === "record") cmdRecord(args);
  else if (cmd === "summarize") cmdSummarize(args);
  else {
    console.error("usage: metrics.mjs <record|summarize> [--pr N | --issue N] [--execution PATH] [--kind implement|ci-fix|review-fix]");
    process.exit(2);
  }
}
