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
// other's records. `summarize` aggregates them into one human-readable SUMMARY,
// posted FRESH at the bottom of the thread (the old summary is deleted, not
// edited in place, so the up-to-date one isn't buried mid-thread). On the
// terminal promote (`--final`) it also sweeps the hidden per-session records,
// whose totals are now captured in the summary and which otherwise render as
// empty comment boxes.
export const METRIC_PREFIX = "<!-- agent-metric ";
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

/** Sum turns/tokens/duration/cost across EVERY result message in a parsed
 * execution log — NOT last-wins like `parseExecution`. One review-panel round
 * makes many small SDK calls (lens samples + verifier calls) inside a single
 * process, so its total compute is a sum of every call, not "the last call's
 * numbers". `calls` is the count of result messages actually summed, so a
 * caller can tell "0 calls" (nothing to record) from "1 call, cheap round". */
export function sumExecutions(messages, kind = "review") {
  const arr = Array.isArray(messages) ? messages : [];
  const results = arr.filter((m) => m && m.type === "result");
  const models = new Set();
  let turns = 0, tokens = 0, durationMs = 0, costUsd = 0;
  for (const r of results) {
    const u = r.usage || {};
    tokens +=
      (u.input_tokens || 0) +
      (u.output_tokens || 0) +
      (u.cache_creation_input_tokens || 0) +
      (u.cache_read_input_tokens || 0);
    turns += r.num_turns || 0;
    durationMs += r.duration_ms || 0;
    costUsd += r.total_cost_usd || 0;
    for (const m of Object.keys(r.modelUsage || {})) models.add(m);
  }
  return {
    kind,
    models: [...models].sort(),
    turns,
    tokens,
    durationMs,
    costUsd,
    sessionId: results.length ? results[results.length - 1].session_id || "" : "",
    calls: results.length,
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

/**
 * Roll up review-panel `lensStats` entries (one per lens per round, from
 * `review-panel.mjs`'s `kind:"review"` records) into PR-wide totals: sample
 * agreement, severity-weighted raised/kept counts, verifier confirm/refute
 * outcomes. Summed across every round on the PR, not just the latest — a
 * finding that persists across rounds is raised/verified again each round
 * (mirrors how `aggregate()` sums Sessions/Turns/Tokens across every session
 * rather than reporting only the last one).
 */
export function aggregatePanelStats(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const agreementCounts = { identical: 0, partial: 0, disjoint: 0, single: 0 };
  const raised = { critical: 0, major: 0, minor: 0, nit: 0 };
  const kept = { critical: 0, major: 0, minor: 0, nit: 0 };
  let sentToVerifier = 0, refuted = 0, refutedHighConfidence = 0;
  for (const e of list) {
    if (!e || typeof e !== "object") continue;
    if (Object.prototype.hasOwnProperty.call(agreementCounts, e.agreement)) agreementCounts[e.agreement]++;
    for (const sev of ["critical", "major", "minor", "nit"]) {
      raised[sev] += Number(e.raised && e.raised[sev]) || 0;
      kept[sev] += Number(e.kept && e.kept[sev]) || 0;
    }
    sentToVerifier += Number(e.verifier && e.verifier.sentToVerifier) || 0;
    refuted += Number(e.verifier && e.verifier.refuted) || 0;
    refutedHighConfidence += Number(e.verifier && e.verifier.refutedHighConfidence) || 0;
  }
  return { agreementCounts, raised, kept, verifier: { sentToVerifier, refuted, refutedHighConfidence } };
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

/** Render the human-readable summary comment body. `panelAgg`/`panelStats`
 * are omitted when the PR has no review-panel ledger records yet (kept
 * separate from the code-fix agent's numbers — review-fix, the agent that
 * responds to what the panel found, and review, the panel's own compute, are
 * easy to conflate by name, so their costs are rendered in separate sections
 * rather than folded into one set of totals). */
export function renderSummary({ agg, panelAgg, panelStats, scope }) {
  const hasPanel = !!panelAgg && panelAgg.sessions > 0;
  const totalTokens = agg.tokens + (hasPanel ? panelAgg.tokens : 0);
  const lines = [
    SUMMARY_MARKER,
    "## 🤖 Agent effort",
    "",
    `- Total-tokens: ${formatTokens(totalTokens)} (code-fix ${formatTokens(agg.tokens)} + review ${formatTokens(hasPanel ? panelAgg.tokens : 0)})`,
    "",
    "### Code-fix agent",
    "",
    `- Agents: ${agg.agents.length ? agg.agents.join(", ") : "unknown"}`,
    `- Scope-size: ${scope}`,
    `- Attempt: ${agg.attempt}`,
    `- Sessions: ${agg.sessions}`,
    `- Total-time: ${formatMinutes(agg.durationMs)}`,
    `- Turns: ${agg.turns}`,
    `- Tokens: ${formatTokens(agg.tokens)}`,
  ];
  if (hasPanel) {
    const ac = panelStats?.agreementCounts || {};
    const r = panelStats?.raised || {};
    const k = panelStats?.kept || {};
    const v = panelStats?.verifier || {};
    const sampledRounds = (ac.identical || 0) + (ac.partial || 0) + (ac.disjoint || 0);
    lines.push(
      "",
      "### Review panel",
      "",
      `- Agents: ${panelAgg.agents.length ? panelAgg.agents.join(", ") : "unknown"}`,
      `- Rounds: ${panelAgg.sessions}`,
      `- Total-time: ${formatMinutes(panelAgg.durationMs)}`,
      `- Turns: ${panelAgg.turns}`,
      `- Tokens: ${formatTokens(panelAgg.tokens)}`,
      `- Sample-agreement: ${ac.identical || 0} identical, ${ac.partial || 0} partial, ${ac.disjoint || 0} disjoint (${sampledRounds} lens-round samples)`,
      `- Findings raised: ${r.critical || 0} critical, ${r.major || 0} major, ${r.minor || 0} minor, ${r.nit || 0} nit`,
      `- Sent to verifier: ${v.sentToVerifier || 0}`,
      `- Refuted: ${v.refuted || 0} (${v.refutedHighConfidence || 0} high-confidence)`,
      `- Survived to gate: ${k.critical || 0} critical, ${k.major || 0} major`,
    );
  }
  return lines.join("\n");
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

function postComment(pr, body) {
  gh(["api", "-X", "POST", `repos/{owner}/{repo}/issues/${pr}/comments`, "-f", `body=${body}`]);
}

// Best-effort delete: metrics must never fail the pipeline, so a comment we
// can't remove (already gone, permission) is logged and skipped, not fatal.
function safeDeleteComment(id) {
  try {
    gh(["api", "-X", "DELETE", `repos/{owner}/{repo}/issues/comments/${id}`]);
  } catch (e) {
    console.error(`metrics: could not delete comment ${id}: ${e.message}`);
  }
}

function parseArgs(argv) {
  const a = {};
  for (let i = 3; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      a[key] = true; // boolean flag (e.g. --final)
    } else {
      a[key] = next;
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
  const kind = args.kind || "implement";
  let messages;
  try {
    messages = JSON.parse(readFileSync(args.execution, "utf8"));
  } catch (e) {
    return bail(`cannot read execution log ${args.execution}: ${e.message}`);
  }
  let rec;
  if (kind === "review") {
    // review-panel.mjs is one process making MANY internal SDK calls — sum
    // every result message, don't take the last (parseExecution's contract).
    rec = sumExecutions(messages, kind);
    if (rec.calls === 0) return bail("no result messages in the review execution log");
    delete rec.calls;
    // Sample-agreement/verifier-outcome data is optional and best-effort: a
    // missing/malformed file must never block recording the cost that WAS
    // captured, so log and move on rather than bail.
    if (args["lens-stats"]) {
      try {
        rec.lensStats = JSON.parse(readFileSync(args["lens-stats"], "utf8"));
      } catch (e) {
        console.error(`metrics: could not read lens-stats ${args["lens-stats"]}: ${e.message}`);
      }
    }
  } else {
    rec = parseExecution(messages, kind);
    if (!rec) return bail("no result message in the execution log");
  }
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
  let comments, prInfo;
  try {
    comments = listAllComments(pr);
    prInfo = ghJson(["pr", "view", pr, "--json", "additions,deletions"]);
  } catch (e) {
    return bail(`could not read metrics/PR for #${pr}: ${e.message}`);
  }
  const records = comments.map((c) => parseMetricComment(c.body || "")).filter(Boolean);
  if (records.length === 0) return bail(`no metrics recorded for PR #${pr}; skipping summary`);
  // Code-fix agent (implement/ci-fix/review-fix) and review panel (review) are
  // kept as separate aggregates — see renderSummary's doc comment for why.
  const codeFixRecords = records.filter((r) => r.kind !== "review");
  const panelRecords = records.filter((r) => r.kind === "review");
  const agg = aggregate(codeFixRecords);
  const panelAgg = panelRecords.length ? aggregate(panelRecords) : null;
  const panelStats = panelRecords.length
    ? aggregatePanelStats(panelRecords.flatMap((r) => (Array.isArray(r.lensStats) ? r.lensStats : [])))
    : null;
  const scope = scopeSize(prInfo.additions, prInfo.deletions);
  try {
    // Post the summary FRESH (not upsert-in-place): a prior summary was pinned at
    // its original creation point (often an early paged hand-off), so editing it
    // leaves the up-to-date summary buried mid-thread. Posting new lands it at the
    // BOTTOM where a human looks; the old one is deleted just below.
    postComment(pr, renderSummary({ agg, panelAgg, panelStats, scope }));
  } catch (e) {
    return bail(`could not post summary for PR #${pr}: ${e.message}`);
  }
  // Cleanup is best-effort (never fail the pipeline). Delete the OLD summary
  // comment(s) so only the fresh bottom one remains.
  for (const c of comments) {
    if ((c.body || "").includes(SUMMARY_MARKER)) safeDeleteComment(c.id);
  }
  // On the TERMINAL promote (--final), sweep the hidden per-session agent-metric
  // records: their totals are now captured in the summary, and each renders as an
  // empty comment box that clutters the thread. Only on --final — a paged /
  // non-terminal summary keeps them so a later re-run still aggregates the full
  // history. (SUMMARY_MARKER never matches METRIC_PREFIX — "agent-metrics-" vs
  // "agent-metric " — so this can't delete the summary we just posted.)
  if (args.final) {
    for (const c of comments) {
      if ((c.body || "").includes(METRIC_PREFIX)) safeDeleteComment(c.id);
    }
  }
  console.log(
    `posted agent-effort summary for PR #${pr} (sessions=${agg.sessions} turns=${agg.turns} tokens=${agg.tokens})` +
      (args.final ? " [final: reposted at bottom, swept per-session records]" : ""),
  );
}

// Only run the CLI when executed directly (not when imported for tests).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2];
  const args = parseArgs(process.argv);
  if (cmd === "record") cmdRecord(args);
  else if (cmd === "summarize") cmdSummarize(args);
  else {
    console.error(
      "usage: metrics.mjs <record|summarize> [--pr N | --issue N] [--execution PATH] " +
        "[--kind implement|ci-fix|review-fix|review] [--lens-stats PATH] [--final]",
    );
    process.exit(2);
  }
}
