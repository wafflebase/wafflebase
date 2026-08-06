// Sticky "agent loop status" dashboard — ONE PR comment, updated in place,
// that answers "which round are we on, what did the panel say per round, and
// why did the loop continue or stop" without opening a single workflow log.
//
// Design constraints, in order:
//
//   - PROJECTION, NEVER A GATE. Like the agent:* labels (set-state.mjs), this
//     comment is derived from the unforgeable signals — commits, check runs,
//     the paged latch — and re-derived IN FULL on every update. Nothing may
//     read it back to make a decision, and a missed update self-heals on the
//     next one because the table is recomputed, not appended to.
//   - FAIL-SAFE. Every entry point exits 0 on error (mirroring set-state.mjs's
//     bail): a status comment must never fail a pipeline job. The workflow
//     steps that call this are additionally continue-on-error.
//   - CHEAP READS ONLY. The per-round panel cells come from lens check-run
//     CONCLUSIONS (always present in the list response), deliberately NOT from
//     `output.text` — the list endpoint omits that field, and back-filling it
//     per check run (as review-round-guard.mjs must) would spend rounds×lenses
//     API calls on a display surface. The checks themselves remain the verdict
//     of record; this table only summarizes them.
//   - AUTHOR-CHECKED UPSERT. This repo is public, so "the first comment
//     containing the marker" is attacker-plantable. We only update a marker
//     comment written by our own bot identities or a write-access human, and
//     otherwise post a fresh one — same trust rule as the paged latch
//     (rounds.mjs::isPagedLatchComment).
//
// Usage (GH_TOKEN must be set; all flags optional):
//   node ./scripts/agent/loop-status.mjs update <pr>
//     [--event panel|fix-dispatched|fix-pushed|held|promoted|not-promoted|paged|ci-paged|ci-fix-pushed]
//     [--note "<one-line explanation of the latest decision>"]
//     [--run-url <url>] [--max-rounds N] [--lenses <path>] [--dry-run]

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  countFailedReviewRounds,
  isPagedLatchComment,
  rerunPointFrom,
  PAGE_AUTHOR_LOGINS,
} from "./rounds.mjs";
import {
  gh,
  ghJson,
  listAllComments,
  parseMetricComment,
  parseSummaryData,
  dedupRecords,
  formatUsd,
  formatMinutes,
} from "./metrics.mjs";

export const LOOP_STATUS_MARKER = "<!-- agent-loop-status -->";

/** Keep the table bounded — GitHub caps comment bodies at 65,536 chars. */
export const MAX_ROUND_ROWS = 15;

const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

/**
 * Is this an update-able status comment of OURS? Marker alone is not enough on
 * a public repo — same reasoning as isPagedLatchComment, which see.
 */
export function isOwnStatusComment(comment) {
  const c = comment && typeof comment === "object" ? comment : {};
  if (!String(c.body ?? "").includes(LOOP_STATUS_MARKER)) return false;
  const user = c.user && typeof c.user === "object" ? c.user : {};
  if (user.type === "Bot" && PAGE_AUTHOR_LOGINS.includes(user.login)) return true;
  return TRUSTED_ASSOCIATIONS.has(String(c.author_association ?? ""));
}

/** conclusion values that read as "red" for the non-lens checks cell. */
const RED_CONCLUSIONS = new Set(["failure", "timed_out", "cancelled", "action_required"]);

/**
 * Group a PR's commits into panel rounds for display: one row per commit that
 * carries at least one of our lens check runs (latest run per lens wins, same
 * rule as rounds.mjs::groupReviewRounds), oldest first. Pure.
 *
 * `commits`: Array<{ sha, commit?, checkRuns: Array<{name, app, status, conclusion, started_at, completed_at}> }>
 */
export function buildRounds(commits, lensCheckNames) {
  const names = new Set(lensCheckNames ?? []);
  const rounds = [];
  for (const c of Array.isArray(commits) ? commits : []) {
    const runs = (c?.checkRuns ?? []).filter((r) => r && r.app?.slug === "github-actions");
    const lensRuns = runs.filter((r) => names.has(r.name));
    if (lensRuns.length === 0) continue; // no panel verdict here → not a round
    const latest = new Map();
    for (const r of lensRuns) {
      const t = new Date(r.completed_at || r.started_at || 0).getTime();
      const cur = latest.get(r.name);
      if (!cur || t >= cur.t) latest.set(r.name, { run: r, t });
    }
    const lenses = [...latest.entries()].map(([name, { run }]) => ({
      lens: name.replace(/^agent-review-/, ""),
      status: run.status,
      conclusion: run.conclusion ?? null,
    }));
    // Everything that is not a lens check — CI's own job checks, mostly.
    const others = runs.filter((r) => !names.has(r.name));
    let checks = "none";
    if (others.length > 0) {
      if (others.some((r) => RED_CONCLUSIONS.has(String(r.conclusion)))) checks = "failure";
      else if (others.some((r) => r.status !== "completed")) checks = "pending";
      else checks = "success";
    }
    rounds.push({ sha: String(c.sha ?? ""), lenses, checks });
  }
  return rounds;
}

const CHECKS_CELL = { success: "✅", failure: "❌", pending: "⏳", none: "—" };

/** One table cell summarizing a round's lens conclusions. Pure. */
export function lensCell(lenses) {
  const list = Array.isArray(lenses) ? lenses : [];
  if (list.length === 0) return "—";
  const failed = list.filter((l) => l.status === "completed" && l.conclusion === "failure");
  const pending = list.filter((l) => l.status !== "completed");
  const passed = list.filter((l) => l.status === "completed" && l.conclusion === "success");
  if (failed.length > 0) {
    const namesTxt = failed.map((l) => l.lens).sort().join(", ");
    const rest = pending.length > 0 ? `, ${pending.length} ⏳` : passed.length > 0 ? ` (${passed.length} ✅)` : "";
    return `❌ ${namesTxt}${rest}`;
  }
  if (pending.length > 0) return `⏳ running (${pending.length} of ${list.length})`;
  if (passed.length === list.length) return `✅ all ${list.length}`;
  return `➖ ${passed.length} ✅ / ${list.length - passed.length} neutral`;
}

/**
 * Totals from the hidden metric ledger, by kind. Records folded into the
 * summary's data block carry no timestamp, which is fine here: totals only.
 * Pure.
 */
export function summarizeEffort(records) {
  const byKind = new Map();
  let totalUsd = 0;
  let totalMs = 0;
  let sessions = 0;
  for (const r of Array.isArray(records) ? records : []) {
    if (!r || typeof r !== "object") continue;
    const kind = String(r.kind ?? "unknown");
    const usd = Number(r.costUsd) || 0;
    const ms = Number(r.durationMs) || 0;
    const cur = byKind.get(kind) ?? { usd: 0, ms: 0, n: 0 };
    cur.usd += usd;
    cur.ms += ms;
    cur.n += 1;
    byKind.set(kind, cur);
    totalUsd += usd;
    totalMs += ms;
    sessions += 1;
  }
  return { totalUsd, totalMs, sessions, byKind };
}

const EVENT_HEADLINE = {
  panel: "review panel finished",
  "fix-dispatched": "fix round in progress",
  "fix-pushed": "fix pushed — next round starts with CI",
  held: "holding — see the latest note",
  promoted: "ready for human review",
  "not-promoted": "approved, but not promoted — see the run",
  paged: "🛑 paged to a human",
  "ci-paged": "🛑 paged to a human",
  "ci-fix-pushed": "CI fix pushed — CI re-running",
};

/**
 * Render the full comment body. Pure; `now` injected for testability.
 * State precedence: a trusted paged latch beats everything (a paged PR must
 * never read as "in progress"), then ready (non-draft), then the caller's event.
 */
export function renderLoopStatus({
  rounds = [],
  failedRounds = null,
  maxRounds = null,
  paged = false,
  ready = false,
  rerunAt = null,
  effort = null,
  event = "",
  note = "",
  runUrl = "",
  now = "",
} = {}) {
  const headline = paged
    ? "🛑 paged to a human"
    : ready
      ? "ready for human review"
      : EVENT_HEADLINE[event] ?? "running";
  const lines = [LOOP_STATUS_MARKER, `## 🔄 Agent loop status — ${headline}`, ""];

  if (Number.isFinite(Number(failedRounds)) && Number.isFinite(Number(maxRounds))) {
    lines.push(
      `**Fix rounds used:** ${Number(failedRounds)} of ${Number(maxRounds)}` +
        (rerunAt ? ` (counted since the last \`@claude rerun\`)` : ""),
    );
  }
  if (note) lines.push(`**Latest:** ${String(note).replace(/\r?\n/g, " ").slice(0, 600)}`);
  lines.push("");

  if (rounds.length === 0) {
    lines.push("_No panel rounds yet — the review panel runs alongside the first CI run._", "");
  } else {
    const shown = rounds.slice(-MAX_ROUND_ROWS);
    const omitted = rounds.length - shown.length;
    lines.push("| Round | Head | Other checks | Review panel | Then |", "|---|---|---|---|---|");
    // Newest first: the row a reader wants is the current one.
    for (let i = shown.length - 1; i >= 0; i--) {
      const r = shown[i];
      const roundNo = rounds.length - shown.length + i + 1;
      const isNewest = roundNo === rounds.length;
      const next = isNewest ? null : (i + 1 < shown.length ? shown[i + 1] : null);
      const then = isNewest
        ? paged
          ? "🛑 paged"
          : ready
            ? "🤝 promoted"
            : event === "fix-dispatched"
              ? "🔧 fixer running…"
              : event === "fix-pushed" || event === "ci-fix-pushed"
                ? "🔧 fix pushed"
                : "…"
        : next
          ? `→ \`${next.sha.slice(0, 9)}\``
          : "→ (omitted row)";
      lines.push(
        `| ${roundNo} | \`${r.sha.slice(0, 9)}\` | ${CHECKS_CELL[r.checks] ?? "—"} | ${lensCell(r.lenses)} | ${then} |`,
      );
    }
    if (omitted > 0) lines.push("", `_(${omitted} earlier round(s) omitted — see the check runs on older commits.)_`);
    lines.push("");
  }

  if (effort && effort.sessions > 0) {
    const kinds = [...effort.byKind.entries()]
      .map(([k, v]) => `${k} ${formatUsd(v.usd)}×${v.n}`)
      .join(" · ");
    lines.push(
      `**Agent effort so far:** ${formatUsd(effort.totalUsd)} · ~${formatMinutes(effort.totalMs)} across ${effort.sessions} session(s) (${kinds})`,
      "",
    );
  }

  lines.push(
    `<sub>Verdicts of record are the \`agent-review-*\` check runs on each commit — this table only summarizes their conclusions. A "round" is a commit that received panel verdicts, oldest = 1. Updated ${now}${runUrl ? ` · [latest run](${runUrl})` : ""}</sub>`,
  );
  return lines.join("\n");
}

// --- gh-backed CLI -----------------------------------------------------------

function bail(msg) {
  console.error(`loop-status: ${msg} (continuing without a status update)`);
  process.exit(0);
}

function lensCheckNamesFrom(lensesPath) {
  const p =
    lensesPath || path.join(path.dirname(fileURLToPath(import.meta.url)), "lenses", "lenses.json");
  const manifest = JSON.parse(readFileSync(p, "utf8"));
  return manifest.map((l) => `agent-review-${l.id}`);
}

// Object-wrapped-array endpoint — --paginate --slurp then flatten, same as
// review-round-guard.mjs::checkRunsFor (see its comment for why).
function checkRunsFor(sha) {
  const pages = ghJson([
    "api",
    `repos/{owner}/{repo}/commits/${sha}/check-runs?per_page=100`,
    "--paginate",
    "--slurp",
  ]);
  return pages.flatMap((p) => p.check_runs ?? []);
}

function parseArgs(argv) {
  const args = { flags: {} };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.flags.dryRun = true;
    else if (a.startsWith("--")) {
      args.flags[a.slice(2)] = argv[++i] ?? "";
    } else positional.push(a);
  }
  args.command = positional[0];
  args.pr = Number(positional[1]);
  return args;
}

function main() {
  const { command, pr, flags } = parseArgs(process.argv.slice(2));
  if (command !== "update" || !Number.isInteger(pr) || pr <= 0) {
    console.error(
      "Usage: node ./scripts/agent/loop-status.mjs update <pr> [--event <e>] [--note <n>] [--run-url <u>] [--max-rounds N] [--lenses <path>] [--dry-run]",
    );
    process.exit(2);
  }

  let body;
  let comments;
  try {
    const lensCheckNames = lensCheckNamesFrom(flags.lenses);
    const prView = ghJson(["pr", "view", String(pr), "--json", "isDraft,state"]);
    comments = listAllComments(pr);

    const commits = ghJson([
      "api",
      `repos/{owner}/{repo}/pulls/${pr}/commits?per_page=100`,
      "--paginate",
    ]);
    for (const c of commits) c.checkRuns = checkRunsFor(c.sha);

    const paged = comments.some(isPagedLatchComment);
    const rerunAt = rerunPointFrom(comments);
    const rounds = buildRounds(commits, lensCheckNames);
    const failedRounds = countFailedReviewRounds(commits, lensCheckNames, { since: rerunAt });

    // The metric ledger: standalone <!-- agent-metric --> comments plus records
    // folded into the summary's hidden data block. Totals only (see docblock).
    const records = dedupRecords(
      comments.flatMap((c) => {
        const one = parseMetricComment(c.body);
        return one ? [one] : parseSummaryData(c.body);
      }),
    );

    body = renderLoopStatus({
      rounds,
      failedRounds,
      maxRounds: Number.isFinite(Number(flags["max-rounds"])) && flags["max-rounds"] !== ""
        ? Number(flags["max-rounds"])
        : null,
      paged,
      ready: prView.isDraft === false,
      rerunAt,
      effort: summarizeEffort(records),
      event: flags.event ?? "",
      note: flags.note ?? "",
      runUrl: flags["run-url"] ?? "",
      now: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    });
  } catch (e) {
    bail(`could not build the status body: ${e.message}`);
  }

  if (flags.dryRun) {
    console.log(body);
    return;
  }

  try {
    const existing = comments.find(isOwnStatusComment);
    if (existing) {
      gh([
        "api",
        "-X",
        "PATCH",
        `repos/{owner}/{repo}/issues/comments/${existing.id}`,
        "-f",
        `body=${body}`,
      ]);
      console.log(`loop-status: updated comment ${existing.id} on PR #${pr}`);
    } else {
      gh(["api", "-X", "POST", `repos/{owner}/{repo}/issues/${pr}/comments`, "-f", `body=${body}`]);
      console.log(`loop-status: posted a new status comment on PR #${pr}`);
    }
  } catch (e) {
    bail(`could not upsert the status comment: ${e.message}`);
  }
}

// Import-safe: only run the CLI when executed directly (so tests can import
// the pure functions without touching gh).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
