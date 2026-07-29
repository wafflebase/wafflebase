// Agent effort/cost metrics for the autonomous issue→PR pipeline.
//
// Each agent session (kickoff `implement` / `ci-fix` / `review-fix`) appends a
// machine-readable record to a hidden LEDGER comment on the PR. When the PR is
// promoted to ready-for-review, the promote job renders one aggregated,
// human-readable SUMMARY comment:
//
//   - Total-cost: $1.23 (code-fix $1.10 + review $0.13)
//   - Total-tokens: ~120K weighted (~1.0M raw)
//   ...
//   - Cost: $1.10
//   - Tokens: ~110K weighted (~950K raw)
//
// Data source: `claude-execution-output.json` (the claude-code-action transcript)
// — its final `result` message carries num_turns / duration_ms / usage /
// modelUsage / total_cost_usd.
//
// Cost = model-reported `total_cost_usd`, the truest measure of how
// resource-intensive a run was: it already prices cache reads at ~1/10 of fresh
// input and the review panel's pricier/other models correctly. Raw tokens =
// input+output+cache (total processed) — but raw over-counts, since cache-read
// reprocessing is billed at ~1/10 yet summed at full weight. Weighted tokens
// re-weight the fields toward spend (see `weightedTokensFor`). Scope-size = PR
// diff lines.
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

/**
 * Per-token weights relative to fresh input, so a token total tracks spend
 * rather than raw throughput. `cache_read_input_tokens` (re-processing an
 * already-cached prefix) is billed at ~1/10 of fresh input but is otherwise
 * summed at full weight, which inflates the raw total; cache creation carries a
 * ~1.25x write premium. Output stays at 1x here — weighting it accurately needs
 * per-model pricing, which the model-reported `total_cost_usd` (kept as
 * `costUsd`) already applies exactly, so cost is the authoritative measure.
 */
export const TOKEN_WEIGHTS = { input: 1, output: 1, cacheCreation: 1.25, cacheRead: 0.1 };

/** Weighted (spend-representative) token count from a usage object. */
export function weightedTokensFor(usage) {
  const u = usage || {};
  return Math.round(
    (u.input_tokens || 0) * TOKEN_WEIGHTS.input +
      (u.output_tokens || 0) * TOKEN_WEIGHTS.output +
      (u.cache_creation_input_tokens || 0) * TOKEN_WEIGHTS.cacheCreation +
      (u.cache_read_input_tokens || 0) * TOKEN_WEIGHTS.cacheRead,
  );
}

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
    weightedTokens: weightedTokensFor(u),
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
  let turns = 0, tokens = 0, weightedTokens = 0, durationMs = 0, costUsd = 0;
  for (const r of results) {
    const u = r.usage || {};
    tokens +=
      (u.input_tokens || 0) +
      (u.output_tokens || 0) +
      (u.cache_creation_input_tokens || 0) +
      (u.cache_read_input_tokens || 0);
    weightedTokens += weightedTokensFor(u);
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
    weightedTokens,
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
    // Records written before weighted tokens existed have no `weightedTokens`;
    // fall back to raw `tokens` for those so an in-flight PR's total isn't
    // silently under-counted mid-rollout.
    weightedTokens: list.reduce(
      (s, r) => s + (Number(r.weightedTokens) || Number(r.tokens) || 0),
      0,
    ),
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
  // Confidence of what each lens RAISED. Entries written before the field
  // existed contribute nothing at all — not even to `unknown` — so an all-zero
  // row means "no data yet", which is the honest reading for a PR whose rounds
  // predate the change. Within a round that does carry the field, `unknown`
  // counts findings the lens declined to rate.
  const raisedConfidence = { high: 0, medium: 0, low: 0, unknown: 0 };
  // `dropped` is absent from ledger entries written before the grounded-refute
  // change; those coerce to 0, which reads correctly — under the old rule the
  // drop count WAS `refutedHighConfidence`, so a mixed-history PR shows the
  // grounded drops it can actually account for rather than an inflated total.
  let sentToVerifier = 0, refuted = 0, refutedHighConfidence = 0, dropped = 0;
  // Novelty gate. Absent from entries written before it existed, which coerce to
  // 0 — an all-zero row reads as "the gate never fired", the honest reading for
  // both a pre-instrumentation round and a round where it ran inert.
  // `unknownOrigin` is the one that matters: it is how often git could not place
  // a finding, so `backlog: 0` with a high `unknownOrigin` means the gate is
  // blind (no --base-sha, a shallow clone, findings with no line) rather than
  // that nothing was relocated.
  let laneBlocking = 0, laneBacklog = 0, laneUnknownOrigin = 0;
  for (const e of list) {
    if (!e || typeof e !== "object") continue;
    if (Object.prototype.hasOwnProperty.call(agreementCounts, e.agreement)) agreementCounts[e.agreement]++;
    for (const sev of ["critical", "major", "minor", "nit"]) {
      raised[sev] += Number(e.raised && e.raised[sev]) || 0;
      kept[sev] += Number(e.kept && e.kept[sev]) || 0;
    }
    for (const c of ["high", "medium", "low", "unknown"]) {
      raisedConfidence[c] += Number(e.raisedConfidence && e.raisedConfidence[c]) || 0;
    }
    sentToVerifier += Number(e.verifier && e.verifier.sentToVerifier) || 0;
    refuted += Number(e.verifier && e.verifier.refuted) || 0;
    refutedHighConfidence += Number(e.verifier && e.verifier.refutedHighConfidence) || 0;
    dropped += Number(e.verifier && e.verifier.dropped) || 0;
    laneBlocking += Number(e.lanes && e.lanes.blocking) || 0;
    laneBacklog += Number(e.lanes && e.lanes.backlog) || 0;
    laneUnknownOrigin += Number(e.lanes && e.lanes.unknownOrigin) || 0;
  }
  return {
    agreementCounts, raised, raisedConfidence, kept,
    verifier: { sentToVerifier, refuted, refutedHighConfidence, dropped },
    lanes: { blocking: laneBlocking, backlog: laneBacklog, unknownOrigin: laneUnknownOrigin },
  };
}

/**
 * Detect blocking→clean flips per lens across an ORDERED list of review records
 * (one `kind:"review"` record per round). `listAllComments` returns GitHub issue
 * comments in created_at-ascending order, so the array is already chronological =
 * round order — do NOT re-sort it. A flip is a lens that was blocking (kept
 * critical/major > 0) in one valid round and clean (non-blocking) in a LATER
 * valid round, i.e. it requested changes and then approved. This is the
 * cross-round analogue of the intra-round sample-agreement signal and is exactly
 * the failure PR #521 exhibited (blocking finding silently dropped next round).
 *
 * Rounds where a lens hit an infra/quota error (`infraError` set or
 * `samplesOk === 0`, which carry a synthetic blocking finding) are skipped for
 * that lens — an infra recovery the next round is not a review flip. Only
 * *valid* consecutive rounds of a lens are compared.
 *
 * HONEST LIMITATION: with only per-round severity counts we cannot tell a flip
 * caused by a genuine fix (good) from one caused by judge inconsistency (bad).
 * This is therefore an ADVISORY heads-up flag, not a defect count. Tightening it
 * to "the finding-relevant code did not change" needs per-round diff/line data
 * the ledger does not carry today. (If GitHub's comment ordering ever stopped
 * being chronological, flip direction could invert — accepted risk.)
 *
 * Shape-safe: records without `lensStats` (pre-instrumentation) or a `kept`
 * missing a severity key are tolerated and contribute nothing.
 *
 * @returns {{ flips: {lens: string, fromRound: number, toRound: number}[], byLens: Record<string, number> }}
 */
export function detectFlips(reviewRecords) {
  const list = Array.isArray(reviewRecords) ? reviewRecords : [];
  // Per lens id, the ordered subsequence of that lens's VALID round states
  // (true = blocking, false = clean), tagged with the record index for
  // human-readable r<from>→r<to> traceability.
  const byLensStates = new Map();
  list.forEach((rec, round) => {
    const lensStats = rec && Array.isArray(rec.lensStats) ? rec.lensStats : [];
    for (const e of lensStats) {
      if (!e || typeof e !== "object" || e.id == null) continue;
      // Skip infra/quota rounds — their synthetic blocking finding and next-round
      // recovery are not a review flip.
      if (e.infraError || Number(e.samplesOk) === 0) continue;
      const kept = e.kept || {};
      const blocking = (Number(kept.critical) || 0) + (Number(kept.major) || 0) > 0;
      if (!byLensStates.has(e.id)) byLensStates.set(e.id, []);
      byLensStates.get(e.id).push({ blocking, round });
    }
  });
  const flips = [];
  const byLens = {};
  for (const [lens, seq] of byLensStates) {
    for (let i = 1; i < seq.length; i++) {
      // A flip = an adjacent pair of valid rounds going blocking → clean.
      if (seq[i - 1].blocking && !seq[i].blocking) {
        flips.push({ lens, fromRound: seq[i - 1].round, toRound: seq[i].round });
        byLens[lens] = (byLens[lens] || 0) + 1;
      }
    }
  }
  return { flips, byLens };
}

/**
 * Severity weights for collapsing a {critical,major,minor,nit} vector into one
 * scalar. Mirrors the report's DoorDash-style scheme mapped onto this scale.
 * A critical finding is worth 8× a nit, so a lens that catches real problems
 * isn't scored like one that only flags style.
 */
export const SEVERITY_WEIGHTS = { critical: 4, major: 2, minor: 1, nit: 0.5 };

/**
 * Weighted scalar for a severity-count vector. This is an EFFORT/NOISE proxy
 * (how much reviewer attention the lens generated), NOT recall — recall needs
 * ground truth, which this per-PR layer deliberately does not have. Always
 * reported alongside the raw per-severity vector, never as a replacement for it.
 * Null/shape-safe: a missing object and missing keys count as 0.
 */
export function weightSeverity(counts) {
  const c = counts || {};
  return (
    (Number(c.critical) || 0) * SEVERITY_WEIGHTS.critical +
    (Number(c.major) || 0) * SEVERITY_WEIGHTS.major +
    (Number(c.minor) || 0) * SEVERITY_WEIGHTS.minor +
    (Number(c.nit) || 0) * SEVERITY_WEIGHTS.nit
  );
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

export function formatUsd(n) {
  const v = Number(n) || 0;
  if (v > 0 && v < 0.01) return "<$0.01";
  return `$${v.toFixed(2)}`;
}

/** Render the human-readable summary comment body. `panelAgg`/`panelStats`
 * are omitted when the PR has no review-panel ledger records yet (kept
 * separate from the code-fix agent's numbers — review-fix, the agent that
 * responds to what the panel found, and review, the panel's own compute, are
 * easy to conflate by name, so their costs are rendered in separate sections
 * rather than folded into one set of totals). */
export function renderSummary({ agg, panelAgg, panelStats, flips, scope }) {
  const hasPanel = !!panelAgg && panelAgg.sessions > 0;
  const panelTokens = hasPanel ? panelAgg.tokens : 0;
  const panelWeighted = hasPanel ? panelAgg.weightedTokens : 0;
  const panelCost = hasPanel ? panelAgg.costUsd : 0;
  const totalWeighted = agg.weightedTokens + panelWeighted;
  const totalRaw = agg.tokens + panelTokens;
  const totalCost = agg.costUsd + panelCost;
  // Cost leads (it prices cache reads and pricier panel models correctly);
  // tokens are shown weighted with the raw total in parens. Per-section cost
  // and tokens carry the code-fix vs review split.
  const lines = [
    SUMMARY_MARKER,
    "## 🤖 Agent effort",
    "",
    `- Total-cost: ${formatUsd(totalCost)} (code-fix ${formatUsd(agg.costUsd)} + review ${formatUsd(panelCost)})`,
    `- Total-tokens: ${formatTokens(totalWeighted)} weighted (${formatTokens(totalRaw)} raw)`,
    "",
    "### Code-fix agent",
    "",
    `- Cost: ${formatUsd(agg.costUsd)}`,
    `- Tokens: ${formatTokens(agg.weightedTokens)} weighted (${formatTokens(agg.tokens)} raw)`,
    `- Agents: ${agg.agents.length ? agg.agents.join(", ") : "unknown"}`,
    `- Scope-size: ${scope}`,
    `- Attempt: ${agg.attempt}`,
    `- Sessions: ${agg.sessions}`,
    `- Total-time: ${formatMinutes(agg.durationMs)}`,
    `- Turns: ${agg.turns}`,
  ];
  if (hasPanel) {
    const ac = panelStats?.agreementCounts || {};
    const r = panelStats?.raised || {};
    const rc = panelStats?.raisedConfidence || {};
    const k = panelStats?.kept || {};
    const v = panelStats?.verifier || {};
    const l = panelStats?.lanes || {};
    const sampledRounds = (ac.identical || 0) + (ac.partial || 0) + (ac.disjoint || 0);
    lines.push(
      "",
      "### Review panel",
      "",
      `- Cost: ${formatUsd(panelAgg.costUsd)}`,
      `- Tokens: ${formatTokens(panelAgg.weightedTokens)} weighted (${formatTokens(panelAgg.tokens)} raw)`,
      `- Agents: ${panelAgg.agents.length ? panelAgg.agents.join(", ") : "unknown"}`,
      `- Rounds: ${panelAgg.sessions}`,
      `- Total-time: ${formatMinutes(panelAgg.durationMs)}`,
      `- Turns: ${panelAgg.turns}`,
      // Reliability = whether the judge agrees with ITSELF across the N samples
      // of a single round (intra-round self-consistency), NOT whether it agrees
      // with the truth. High agreement here means a stable judge, not a correct
      // one — see the meta-eval's reliability≠validity finding.
      `- Reliability (intra-round self-consistency, not correctness): ${ac.identical || 0} identical, ${ac.partial || 0} partial, ${ac.disjoint || 0} disjoint across ${sampledRounds} lens-rounds`,
      `- Findings raised: ${r.critical || 0} critical, ${r.major || 0} major, ${r.minor || 0} minor, ${r.nit || 0} nit`,
      // Severity and confidence are separate axes; this row is the check that
      // the lenses are actually USING the second one. All-`high` (or all
      // `unknown`) means doubt has nowhere to go but severity, which is the
      // clamp the coverage-first rubrics exist to remove. Confidence gates
      // nothing — a low-confidence `critical` blocks exactly like any other.
      `- Confidence of raised (does NOT gate): ${rc.high || 0} high, ${rc.medium || 0} medium, ${rc.low || 0} low, ${rc.unknown || 0} unrated`,
      // Weighted scalar companion to the raw vector above — an effort/noise
      // proxy, not recall (no ground truth here). Shown alongside, not instead.
      `- Weighted raised (effort proxy, not recall): ${weightSeverity(r)}`,
      `- Sent to verifier: ${v.sentToVerifier || 0}`,
      // `dropped` ≤ `refutedHighConfidence`: a confident refutation only drops
      // the finding when it names a ground and cites what it read. The GAP is
      // the signal — it counts refutations the gate declined to act on.
      `- Refuted: ${v.refuted || 0} (${v.refutedHighConfidence || 0} high-confidence, ${v.dropped || 0} dropped)`,
      // All four severities shown (critical/major lead as the blocking ones)
      // so the raw counts reconcile with the weighted scalar below, which
      // weights every severity — mirrors the "Findings raised" pair above.
      `- Survived to gate: ${k.critical || 0} critical, ${k.major || 0} major, ${k.minor || 0} minor, ${k.nit || 0} nit`,
      `- Weighted survived-to-gate: ${weightSeverity(k)}`,
      // Novelty gate. Read `unknownOrigin` FIRST: it counts blockers git could
      // not place, so a zero `relocated` next to a high `unknownOrigin` means
      // the gate ran blind (no --base-sha, a shallow clone, findings with no
      // line), not that nothing was moved. Only `relocated` demotes.
      `- Novelty gate: ${l.backlog || 0} relocated (demoted), ${l.blocking || 0} gating, ${l.unknownOrigin || 0} unplaceable`,
    );
    // Advisory heads-up (NOT a verdict): a lens that blocked then approved across
    // rounds — the PR #521 pattern. Can't distinguish a genuine fix from judge
    // inconsistency here (see detectFlips), so the wording says "review manually".
    const flipList = flips?.flips || [];
    lines.push(
      `- ⚠️ Cross-round flips (blocking→clean; advisory, review manually): ${flipList.length}` +
        (flipList.length ? ` — ${flipList.map((f) => `${f.lens} r${f.fromRound}→r${f.toRound}`).join(", ")}` : ""),
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

export function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8" });
}
export function ghJson(args) {
  return JSON.parse(gh(args));
}

export function resolvePrByIssue(issue) {
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
export function listAllComments(pr) {
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
  // `panelRecords` is in ledger (chronological = round) order — detectFlips
  // relies on that, so pass it as-is without re-sorting.
  const flips = panelRecords.length ? detectFlips(panelRecords) : null;
  const scope = scopeSize(prInfo.additions, prInfo.deletions);
  try {
    // Post the summary FRESH (not upsert-in-place): a prior summary was pinned at
    // its original creation point (often an early paged hand-off), so editing it
    // leaves the up-to-date summary buried mid-thread. Posting new lands it at the
    // BOTTOM where a human looks; the old one is deleted just below.
    postComment(pr, renderSummary({ agg, panelAgg, panelStats, flips, scope }));
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
