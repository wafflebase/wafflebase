// Sticky "agent loop status" dashboard — ONE PR comment, updated in place,
// that answers "which round are we on, what did the panel say per round, and
// why did the loop continue or stop" without opening a single workflow log.
//
// Design constraints, in order:
//
//   - PROJECTION, NEVER A GATE. Like the agent:* labels (set-state.mjs), this
//     comment is derived from the unforgeable signals — commits, check runs,
//     the paged latches — and re-derived IN FULL on every update. Nothing may
//     read it back to make a decision, and a missed update self-heals on the
//     next one because the table is recomputed, not appended to.
//   - UNTRUSTED INPUT STAYS OUT OF THE BODY. This repo is PUBLIC and this
//     script writes a comment AUTHORED BY OUR OWN BOT — the identity the paged
//     latch trusts. So no string that an arbitrary account could have planted
//     may reach the rendered body: metric-ledger records are parsed only from
//     trusted-author comments (below), and nothing from a record but NUMBERS
//     is ever rendered. Without the author gate, a stranger could post a fake
//     `<!-- agent-metric {"kind":"<!-- agent-review-paged -->"} -->` and have
//     this script launder the trusted latch into a bot-authored comment,
//     permanently stopping the panel and the fixer.
//   - FAIL-SAFE. Every entry point exits 0 on error (mirroring set-state.mjs's
//     bail): a status comment must never fail a pipeline job. The workflow
//     steps that call this are additionally continue-on-error.
//   - CHEAP READS ONLY. The per-round panel cells come from lens check-run
//     CONCLUSIONS (always present in the list response), deliberately NOT from
//     `output.text` — the list endpoint omits that field, and back-filling it
//     per check run (as review-round-guard.mjs must) would spend rounds×lenses
//     API calls on a display surface. Check-run fetches are further capped to
//     the newest MAX_COMMITS_SCANNED commits, because this runs up to a handful
//     of times per round: on a very long PR the display may under-count old
//     rounds, and the round guard — not this table — remains the authority.
//   - AUTHOR-CHECKED UPSERT. "The first comment containing the marker" is
//     attacker-plantable on a public repo. We only update a marker comment
//     written by our own bot identities or a write-access human, and otherwise
//     post a fresh one — same trust rule as the paged latch
//     (rounds.mjs::isPagedLatchComment). Two racing first updates (the panel
//     arm and the CI arm share no concurrency group) can still create two
//     comments; every later update PATCHes the oldest and deletes the extras,
//     so a duplicate survives at most until the next update.
//
// Usage (GH_TOKEN must be set; all flags optional):
//   node ./scripts/agent/loop-status.mjs update <pr>
//     [--event panel|fix-dispatched|fix-pushed|held|promoted|not-promoted|paged|ci-paged|ci-fix-pushed|on-demand-fix|rerun]
//     [--note "<one-line explanation of the latest decision>"]
//     [--required-checks "agent-review-a,agent-review-b"]  (the round-count set;
//        pass the panel's required_checks so the displayed budget counts the
//        same checks the guard counts — defaults to the full lens manifest)
//     [--run-url <url>] [--max-rounds N] [--lenses <path>] [--dry-run]

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { countFailedReviewRounds, rerunPointFrom, PAGED_LATCH, PAGE_AUTHOR_LOGINS } from "./rounds.mjs";
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

/**
 * The CI arm's paged latch (agent-iterate-ci.yml), distinct from rounds.mjs's
 * review-side PAGED_LATCH. The projection must recognise BOTH — a PR the CI-fix
 * loop paged is just as handed-to-a-human as one the review guard paged.
 * agent-iterate-ci.yml carries the literal; loop-status.test.mjs pins this copy.
 */
export const CI_PAGED_LATCH = "<!-- agent-paged -->";

/** Keep the table bounded — GitHub caps comment bodies at 65,536 chars. */
export const MAX_ROUND_ROWS = 15;

/** Newest commits whose check runs are fetched (one API call each; see header). */
export const MAX_COMMITS_SCANNED = 40;

const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

/** Same trust rule as rounds.mjs::isPagedLatchComment, marker-independent. */
function isTrustedAuthor(comment) {
  const c = comment && typeof comment === "object" ? comment : {};
  const user = c.user && typeof c.user === "object" ? c.user : {};
  if (user.type === "Bot" && PAGE_AUTHOR_LOGINS.includes(user.login)) return true;
  return TRUSTED_ASSOCIATIONS.has(String(c.author_association ?? ""));
}

/**
 * Is this PR latched as handed-to-a-human, by EITHER arm's marker? Author-
 * checked for the same reason as rounds.mjs::isPagedLatchComment (public repo).
 */
export function isAnyPagedLatchComment(comment) {
  const body = String((comment ?? {}).body ?? "");
  if (!body.includes(PAGED_LATCH) && !body.includes(CI_PAGED_LATCH)) return false;
  return isTrustedAuthor(comment);
}

/**
 * May this comment's metric-ledger payload be parsed at all? The ledger is
 * written only by our own workflows (GITHUB_TOKEN or the App token), so any
 * marker in an untrusted comment is a plant — see the header's injection note.
 */
export function isTrustedLedgerComment(comment) {
  return isTrustedAuthor(comment);
}

/**
 * Is this an update-able status comment of OURS? Marker alone is not enough on
 * a public repo — same reasoning as isPagedLatchComment, which see.
 */
export function isOwnStatusComment(comment) {
  const c = comment && typeof comment === "object" ? comment : {};
  if (!String(c.body ?? "").includes(LOOP_STATUS_MARKER)) return false;
  return isTrustedAuthor(c);
}

/** conclusion values that read as "red" for the non-lens checks cell. */
const RED_CONCLUSIONS = new Set(["failure", "timed_out", "cancelled", "action_required"]);

/** null/undefined/"" mean "not measured", NOT zero — Number(null) is 0, which
 * once rendered a budget that was never counted as a confident "N of 0". */
const n = (v) =>
  v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null;

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
 * Cost/duration totals from the (trusted-author) metric ledger. Records folded
 * into the summary's data block carry no timestamp, which is fine: totals only.
 * Pure. NOTE: only the numeric totals may be rendered — record STRINGS (kind
 * included) never reach the comment body; see the injection note in the header.
 */
export function summarizeEffort(records) {
  let totalUsd = 0;
  let totalMs = 0;
  let sessions = 0;
  for (const r of Array.isArray(records) ? records : []) {
    if (!r || typeof r !== "object") continue;
    totalUsd += Number(r.costUsd) || 0;
    totalMs += Number(r.durationMs) || 0;
    sessions += 1;
  }
  return { totalUsd, totalMs, sessions };
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
  "on-demand-fix": "on-demand fix finished — see the outcome comment",
  rerun: "loop re-engaged — CI re-running",
};

/**
 * Render the full comment body. Pure; `now` injected for testability.
 * State precedence: a trusted paged latch beats everything (a paged PR must
 * never read as "in progress"), then ready, then the caller's event. `ready`
 * is the caller's claim that the PR passed the ready gate — computed in main()
 * from "non-draft AND an agent/ branch" (the pipeline only un-drafts via
 * promotion) or an explicit `promoted` event, NOT from bare non-draft-ness:
 * `agent:managed` human PRs are never drafts and must not read as promoted.
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

  // The cap may be unknown (callers outside the panel workflow don't own
  // MAX_REVIEW_ROUNDS) — then render the count alone rather than dropping the
  // line ("N of 0" was the bug; dropping it erased the budget on every CI-arm
  // update).
  const failed = n(failedRounds);
  const max = n(maxRounds);
  if (failed !== null) {
    lines.push(
      `**Fix rounds used:** ${failed}${max !== null ? ` of ${max}` : ""}` +
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
    // Newest first: the row a reader wants is the current one. `shown` is a
    // contiguous suffix of `rounds`, so every non-newest row has a successor.
    for (let i = shown.length - 1; i >= 0; i--) {
      const r = shown[i];
      const roundNo = rounds.length - shown.length + i + 1;
      const isNewest = i === shown.length - 1;
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
        : `→ \`${shown[i + 1].sha.slice(0, 9)}\``;
      lines.push(
        `| ${roundNo} | \`${r.sha.slice(0, 9)}\` | ${CHECKS_CELL[r.checks] ?? "—"} | ${lensCell(r.lenses)} | ${then} |`,
      );
    }
    if (omitted > 0) lines.push("", `_(${omitted} earlier round(s) omitted — see the check runs on older commits.)_`);
    lines.push("");
  }

  // Totals only — the per-kind/per-session breakdown belongs to the metrics
  // effort summary comment, which already owns that surface. Numbers only; no
  // record string is rendered (see the injection note in the header).
  if (effort && effort.sessions > 0) {
    lines.push(
      `**Agent effort so far:** ${formatUsd(effort.totalUsd)} · ~${formatMinutes(effort.totalMs)} across ${effort.sessions} session(s) — breakdown in the effort summary comment.`,
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
      "Usage: node ./scripts/agent/loop-status.mjs update <pr> [--event <e>] [--note <n>] [--required-checks <csv>] [--run-url <u>] [--max-rounds N] [--lenses <path>] [--dry-run]",
    );
    process.exit(2);
  }

  let body;
  try {
    const lensCheckNames = lensCheckNamesFrom(flags.lenses);
    // The round COUNT uses the same check set the guard counts (the panel's
    // required_checks — applicable blocking lenses only) when the caller knows
    // it; the full manifest otherwise. The table always shows every lens run.
    const countCheckNames = String(flags["required-checks"] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const prView = ghJson(["pr", "view", String(pr), "--json", "isDraft,headRefName"]);
    const comments = listAllComments(pr);

    const commits = ghJson([
      "api",
      `repos/{owner}/{repo}/pulls/${pr}/commits?per_page=100`,
      "--paginate",
    ]);
    // Cost cap: one check-runs call per commit, and this script runs several
    // times per round. Older commits keep empty checkRuns, so a >40-commit PR
    // may under-display old rounds/counts — the guard stays authoritative.
    for (const c of commits) c.checkRuns = [];
    for (const c of commits.slice(-MAX_COMMITS_SCANNED)) c.checkRuns = checkRunsFor(c.sha);

    const paged = comments.some(isAnyPagedLatchComment);
    const rerunAt = rerunPointFrom(comments);
    const rounds = buildRounds(commits, lensCheckNames);
    const failedRounds = countFailedReviewRounds(
      commits,
      countCheckNames.length ? countCheckNames : lensCheckNames,
      { since: rerunAt },
    );

    // `ready` means "passed the ready gate", not "is not a draft": the promote
    // job is the only thing that un-drafts an agent/ branch, but an
    // `agent:managed` human PR was never a draft and must not read as promoted.
    const ready =
      flags.event === "promoted" ||
      (prView.isDraft === false && String(prView.headRefName ?? "").startsWith("agent/"));

    // Metric ledger, TRUSTED AUTHORS ONLY — see the injection note in the header.
    const records = dedupRecords(
      comments.filter(isTrustedLedgerComment).flatMap((c) => {
        const one = parseMetricComment(c.body);
        return one ? [one] : parseSummaryData(c.body);
      }),
    );

    body = renderLoopStatus({
      rounds,
      failedRounds,
      maxRounds: n(flags["max-rounds"]),
      paged,
      ready,
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
    // Re-list comments immediately before the write: the build above spends an
    // unbounded number of check-run calls, and deciding create-vs-update on a
    // snapshot that old is how two racing first updates each POST. The window
    // cannot be closed from here (no cross-workflow lock exists), so the
    // fallback is self-healing: PATCH the OLDEST own comment and delete any
    // younger duplicates a race left behind.
    const fresh = listAllComments(pr)
      .filter(isOwnStatusComment)
      .sort((a, b) => Number(a.id) - Number(b.id));
    if (fresh.length > 0) {
      gh([
        "api",
        "-X",
        "PATCH",
        `repos/{owner}/{repo}/issues/comments/${fresh[0].id}`,
        "-f",
        `body=${body}`,
      ]);
      for (const dup of fresh.slice(1)) {
        try {
          gh(["api", "-X", "DELETE", `repos/{owner}/{repo}/issues/comments/${dup.id}`]);
          console.error(`loop-status: deleted duplicate status comment ${dup.id}`);
        } catch {
          /* best-effort — the next update retries */
        }
      }
      console.log(`loop-status: updated comment ${fresh[0].id} on PR #${pr}`);
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
