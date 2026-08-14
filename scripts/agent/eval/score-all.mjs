#!/usr/bin/env node
// Run the five merged scorers and the renderer over one stored comparison, as one
// command.
//
// WHY THIS IS A MODULE AND NOT SIX STEPS IN A YAML FILE. The sequence itself is not
// interesting — five CLIs and a renderer, in order, with each payload filed through
// `report.mjs --persist`. What is interesting is everything AROUND it, and none of it
// can live in a workflow's `run:` block:
//
//   * The five scorers disagree about how to name a replicate. `volume-mix.mjs` takes
//     `--run` and scores ONE, `complementarity.mjs` / `reliability.mjs` /
//     `segmentation.mjs` take a repeatable `--run-id`, and `cost-latency.mjs` takes a
//     comma-separated `--runs` because `runs/` is never globbed (decision 6). A lane
//     input is one string; translating it five ways is exactly the kind of fan-out that
//     rots when it is copied into shell.
//   * Every degradation available here is SILENT, and the whole value of the lane is the
//     assertions that make it loud (see `DEGRADATION_MARKERS`, `CAPABILITIES`,
//     `assertPanelLatency`). Assertions need tests. `scripts/agent/**` has a test lane;
//     a `run:` block has none, and an untested assertion is decoration — lesson 3.
//   * The same sequence has to be runnable on a laptop. A lane whose steps exist only
//     inside a workflow file is reproducible by GitHub and by nobody else, which is the
//     opposite of what this PR is for.
//
// So `eval-score.yml` is thin on purpose and this file carries the argument. It is the
// same split `eval-replay.yml` already makes with `replay-plan.mjs`, for the same reason.
//
// FAIL DIRECTION, and it is the reverse of every other read path in this directory.
// The scorers degrade to fewer records and never throw, which is correct for a scorer:
// one unanswered endpoint must not zero the rest. But a LANE that files a thinner score
// than the laptop did is worse than no lane, because the number it files is believed and
// nothing on the page says it is short. So this driver refuses on any doubt — an
// unanswered endpoint, a missing capability flag, an emptied latency figure, an API
// budget that cannot cover the run — and files nothing rather than filing four scores
// out of five.
//
// IT SPENDS NOTHING. No model call, no worktree, no clone: the scorers read stored JSON
// plus read-only GitHub API. MEASURED rather than assumed — see the task doc — a full
// pass runs against a store COPY with no `.git` at all, from a shallow checkout carrying
// zero `refs/eval/*` refs, and nothing reaches for a commit.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EvalStore, REPORTS_DIR, SCORES_DIR, SCORE_SCOPE_DIRS, byConfigSegment } from "./store.mjs";
import { comparisonIdFor } from "./report.mjs";
import { parseArgs } from "../vendor/pipeline/gh-checks.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Refuse loudly. Same shape as every other CLI in this directory. */
function refuse(message) {
  throw new Error(message);
}

/**
 * A real number, and NOT `Number.isFinite(Number(x))`.
 *
 * ⟳ Corrected while building, after three tests went red at once on one cause:
 * **`Number(null)` is `0`**, which is finite. Every absence in this file arrives as
 * `null` — a header that was not sent, a payload field a scorer left empty — so the
 * coercing form answered "yes, a number" for all of them. The consequences were one
 * misleading message, one epoch date, and one silent hole exactly where it mattered most:
 * `assertCapability` accepted `coderabbit.latency.wall_ms: null` from a scorer that had
 * been passed the flag, which is the rename case the capability system exists to catch.
 *
 * `""` and `"6.8"` are refused too, deliberately. A latency that arrives as a string is a
 * payload shape nobody declared, and coercing it here would hide that.
 */
function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * The six steps, as DATA rather than as six copies of a spawn.
 *
 * `scorer_id` and `scope` are the keys `report.mjs --persist` files under, and they are
 * taken from `report.mjs`'s own `SECTIONS` vocabulary rather than restated: a typo here
 * would write a file the renderer never reads and leave its section "not computed" —
 * a silent no-op with a zero exit code, which `report.mjs` already refuses at the flag.
 * This list is checked against that vocabulary by a test rather than by trust.
 *
 * `per_replicate` is the one structural difference between them: `volume-mix.mjs` scores
 * ONE replicate and does not aggregate, so it runs K times and files K per-run scores.
 */
export const STEPS = Object.freeze([
  { key: "volume", module: "volume-mix.mjs", scorer_id: "volume-mix-v1", scope: "per-run", per_replicate: true, reads_api: true },
  { key: "complementarity", module: "complementarity.mjs", scorer_id: "complementarity-v1", scope: "cross-run", per_replicate: false, reads_api: true },
  { key: "reliability", module: "reliability.mjs", scorer_id: "reliability-v1", scope: "cross-run", per_replicate: false, reads_api: false },
  { key: "cost_latency", module: "cost-latency.mjs", scorer_id: "cost-latency-v1", scope: "cross-run", per_replicate: false, reads_api: false },
  { key: "segmentation", module: "segmentation.mjs", scorer_id: "segmentation-v1", scope: "cross-run", per_replicate: false, reads_api: true },
]);

/**
 * The log lines that mean an arm just got SMALLER, turned into failures.
 *
 * This is lesson 1 applied to somebody else's code. `fetchCodeRabbitPr` catches each
 * endpoint separately and degrades to `null` — correct for a scorer, because "the
 * endpoint did not answer" and "CodeRabbit wrote nothing" are different facts and one
 * bad response must not zero the other six items. But it says so on stderr and returns
 * a complete, plausible, smaller population, and a 403 or a 429 lands here: a
 * rate-limited pass over three replicates files a score computed from an arm that is
 * missing findings, with nothing in the payload recording it. The capture upload logged
 * "No files were found" for five rounds for exactly this reason.
 *
 * MATCHED AGAINST THE ADAPTER'S SOURCE BY A TEST, not only against its output. A reword
 * in `coderabbit.mjs` would otherwise leave these regexes matching nothing and the lane
 * silently back to trusting the exit code; the test fails instead, and updating a regex
 * is the cheap half of that trade.
 */
export const DEGRADATION_MARKERS = Object.freeze([
  {
    id: "coderabbit-endpoint-absent",
    re: /could not list .*absent, not empty/,
    why: "one of CodeRabbit's endpoints did not answer, so that item's findings are missing from this arm",
  },
  {
    id: "coderabbit-check-runs-absent",
    re: /could not read check runs .*absent, not zero/,
    why: "the push-time timing proxy could not be read for a commit",
  },
]);

/**
 * A rate limit is the failure this lane will actually meet, and it arrives INSIDE the
 * markers above — `err.message` is interpolated into them — so it is detected
 * separately only to say the one thing those lines cannot: when it clears.
 */
export const RATE_LIMIT_SIGNATURE = /rate limit|HTTP 429|HTTP 403/i;

/**
 * Opt-in scorer flags this lane must not silently drop.
 *
 * 🔴 THE FAILURE THIS EXISTS FOR. An opt-in flag is the right design for the one network
 * call in a scorer that otherwise promises to read nothing — but `parseArgs` accepts any
 * `--flag value` pair and ignores the ones it does not know, so passing a flag to a
 * scorer that has since renamed it is a SILENT no-op. The lane then files a payload with
 * an empty half and a plausible reason string, and nothing distinguishes it from a lane
 * that never asked.
 *
 * So the flag is not passed on faith. It is PROBED out of the scorer's own usage text,
 * and each outcome carries an obligation that fails loudly when it is not met:
 *
 *   supported   → pass it, and REQUIRE the field it fills. A flag that exists and
 *                 produces nothing is the rename case, one level in.
 *   unsupported → REQUIRE the scorer to still declare the gap. This is the honest state
 *                 on a tree where the flag has not landed; what it must never become is
 *                 an absence nobody declared, which is why the obligation is not "do
 *                 nothing".
 *
 * ⟳ THE FLAG LANDED MID-REVIEW, in #827, and the interlock did its job: this lane's own
 * test for the absent state went red on CI the day it merged, with a message saying what
 * to change. What that revealed is that the payload SHAPE moved too, so the accessors
 * below are #827's rather than the pre-merge ones — `coderabbit.latency.wall_ms` is gone
 * and `self_timed`/`push_proxy` replace it, each with its own interval name and `n`.
 *
 * MEASURED on `main` at bb07acd, with and without the flag:
 *
 *   with     requested true  · measured true  · self_timed.ms {n: 7, median: 409000}
 *            declared_gaps: cost_per_real_finding
 *   without  requested false · measured false · self_timed.ms {n: 0, median: null}
 *            declared_gaps: cost_per_real_finding, coderabbit_latency_ms
 *
 * So the scorer declares the gap **iff** the flag was not passed, which keeps both
 * branches below honest, and it states `requested` and `measured` SEPARATELY. That second
 * pair is a better detector than any value check: `requested: false` on a pass that
 * passed the flag is precisely "`parseArgs` accepted an unknown flag and dropped it",
 * which is the rename case, said by the payload itself instead of inferred from an empty
 * figure.
 */
export const CAPABILITIES = Object.freeze([
  {
    id: "coderabbit-latency",
    step: "cost_latency",
    flag: "--coderabbit-latency",
    // Read from the payload rather than from a version number, because a tree is the only
    // thing that can answer which state it is in.
    //
    // `self_timed` and NOT `push_proxy`, deliberately: the self-timed interval is the one
    // #791's declared gap named, it is measured on 7 of 7 items where the proxy manages 5,
    // and the proxy's own field name says it is a proxy. The interval NAME travels with the
    // figure into the summary — decision 28, because "latency" alone is two different
    // measurements here.
    requested: (payload) => payload?.coderabbit?.latency?.requested === true,
    measured: (payload) => payload?.coderabbit?.latency?.measured === true,
    field: (payload) => payload?.coderabbit?.latency?.self_timed?.ms?.median,
    n: (payload) => payload?.coderabbit?.latency?.self_timed?.ms?.n ?? null,
    interval: (payload) => payload?.coderabbit?.latency?.self_timed?.interval ?? null,
    reason: (payload) => String(payload?.coderabbit?.latency?.reason ?? "").slice(0, 200),
    gap_metric: "coderabbit_latency_ms",
    // A NOUN PHRASE, because it is interpolated mid-sentence in three messages. The
    // first version was a two-clause sentence and produced "so CodeRabbit's own review
    // latency. Without it the arm has no measured timing will be a declared gap".
    why: "CodeRabbit's own review latency",
  },
]);

// --- the API budget ---------------------------------------------------------

/**
 * Five reads per item per pass: `fetchCodeRabbitPr` asks for commits, review comments,
 * reviews, issue comments and check runs, and it is called once per item per scorer that
 * reads the API.
 */
export const CALLS_PER_ITEM_READ = 5;

/** 1.5x, because the model below is a model and a paginated item can cost two. */
export const BUDGET_HEADROOM = 1.5;

/**
 * How many core API calls one pass costs.
 *
 * `replicates + 2`: `volume-mix.mjs` reads the arm once PER REPLICATE, and
 * `complementarity.mjs` and `segmentation.mjs` read it once each.
 * `reliability.mjs` and `cost-latency.mjs` read no API at all — they work off stored
 * envelopes — which is why they are not in the count.
 *
 * ⚠ This is a RESOURCE model and not a benchmark figure. Nothing about the numbers the
 * lane reports is pinned anywhere in this file; a lane that asserted an overlap
 * percentage would fail the day the benchmark improved. An API cost is the opposite: it
 * has to be a number, and it was measured — 175 calls for the 7-item pilot at K=3 on
 * 2026-08-13, which is exactly 7 * (3 + 2) * 5.
 */
export function estimateApiCalls({ items, replicates }) {
  const n = Number(items);
  const k = Number(replicates);
  if (!Number.isFinite(n) || n < 0 || !Number.isFinite(k) || k < 0) refuse(`estimateApiCalls needs a finite item and replicate count, got ${JSON.stringify({ items, replicates })}`);
  return n * (k + 2) * CALLS_PER_ITEM_READ;
}

/**
 * The rate limit, out of a real response's headers.
 *
 * 🔴 NOT out of `/rate_limit`, IN EITHER FORM, and this is measured rather than
 * stylistic — the first version of this preflight read that endpoint and reported 5000
 * calls of headroom on a token with 4101.
 *
 * On the GitHub App user-to-server token this project authenticates with, measured
 * 2026-08-13 within the same second:
 *
 *   gh api -i rate_limit                    used 0    remaining 5000   <- BOTH WRONG
 *   gh api -i user                          used 899  remaining 4101
 *   gh api -i repos/{owner}/{repo}          used 900  remaining 4100
 *
 * The endpoint is exempt in both directions: it does not consume core, and it reports the
 * exempt bucket rather than the one real calls draw from. Its body's `resources.core`
 * counters say `used: 0` and — the part that makes it actively misleading rather than
 * merely useless — so do its response headers, under `X-Ratelimit-Resource: core`. There
 * is no way to tell it apart from the truth except by asking something else.
 *
 * So the probe is a real, counting endpoint, and it is the repository one rather than
 * `user` on purpose: it costs the same single call and it also proves this token can read
 * the repository the CodeRabbit arm is about. A token that cannot produces the same
 * corpus-wide emptiness as a rate limit.
 */
export function parseRateLimit(headerText) {
  const get = (name) => {
    const m = new RegExp(`^${name}:[ \\t]*(\\d+)[ \\t]*$`, "im").exec(String(headerText ?? ""));
    return m ? Number(m[1]) : null;
  };
  return {
    limit: get("x-ratelimit-limit"),
    remaining: get("x-ratelimit-remaining"),
    used: get("x-ratelimit-used"),
    reset: get("x-ratelimit-reset"),
  };
}

/** A reset timestamp as something a human can act on, or a stated absence. */
export function resetAt(reset) {
  if (!isNumber(reset)) return "an unknown time (the response carried no x-ratelimit-reset)";
  return new Date(Number(reset) * 1000).toISOString();
}

/**
 * Refuse to start a pass the token cannot pay for.
 *
 * A pass that meets the limit half way through does not fail — it files a score computed
 * from a partial arm. Refusing up front is the only place where the outcome is a clean
 * red instead of a plausible number, and re-dispatching after the reset costs nothing
 * because scoring is idempotent.
 *
 * An UNREADABLE limit is also a refusal. `gh` that cannot authenticate produces the same
 * corpus-wide emptiness as a rate limit, and `assertRepoResolved` closes only the
 * placeholder half of that.
 */
export function assertBudget(rl, { items, replicates, log = console.error } = {}) {
  const need = estimateApiCalls({ items, replicates });
  const floor = Math.ceil(need * BUDGET_HEADROOM);
  if (!isNumber(rl?.remaining)) {
    refuse(
      `could not read x-ratelimit-remaining from a live GitHub response, so the API budget is unknown. A pass that meets ` +
        `the limit files a score computed from a partial CodeRabbit arm, which is indistinguishable from a clean review — ` +
        `so this refuses instead. Check that gh is installed and authenticated (GH_TOKEN) and that GH_REPO is set`,
    );
  }
  log(`score-all: API budget — ${rl.remaining} of ${rl.limit ?? "?"} core call(s) remain, resets ${resetAt(rl.reset)}; this pass needs about ${need} and requires ${floor}`);
  if (Number(rl.remaining) < floor) {
    refuse(
      `only ${rl.remaining} core API call(s) remain and this pass needs about ${need} (floor ${floor}, ${BUDGET_HEADROOM}x). ` +
        `The limit resets at ${resetAt(rl.reset)} — re-dispatch then. Not retried into: a partial read does not fail, it ` +
        `shrinks the CodeRabbit arm, and re-scoring is idempotent so nothing is lost by waiting`,
    );
  }
  return { need, floor };
}

/**
 * One `gh api -i` against a real endpoint, for its headers alone. Costs one core call,
 * which is why it is not repeated per step but re-read only when something has failed and
 * the reset time is about to be printed.
 *
 * `{owner}/{repo}` is expanded by `gh` from `GH_REPO` or the working directory's remote —
 * the same expansion the CodeRabbit adapter depends on, so a probe that succeeds has
 * proved the thing the arm needs.
 */
export const RATE_LIMIT_PROBE_ENDPOINT = "repos/{owner}/{repo}";

export function probeRateLimit({ exec = execFileSync } = {}) {
  return String(exec("gh", ["api", "-i", RATE_LIMIT_PROBE_ENDPOINT], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }));
}

// --- the assertions ---------------------------------------------------------

/** Every degradation marker present in one step's stderr, with its reason. */
export function degradationsIn(stderrText) {
  const text = String(stderrText ?? "");
  const hits = [];
  for (const marker of DEGRADATION_MARKERS) {
    const lines = text.split("\n").filter((l) => marker.re.test(l));
    if (lines.length > 0) hits.push({ id: marker.id, why: marker.why, count: lines.length, sample: lines[0].trim().slice(0, 300) });
  }
  return hits;
}

/**
 * Refuse a step whose own log said it read less than it was asked for.
 *
 * The rate-limit case is separated out only to name the reset time; both refuse.
 *
 * `rateLimit` is a THUNK and not a value, because resolving it costs a core API call and
 * the overwhelmingly common case is that there is nothing to report. An eager version of
 * this argument spent one call per step to print a number nobody ever saw.
 */
export function assertNoDegradation(stderrText, { label, rateLimit = () => null } = {}) {
  const hits = degradationsIn(stderrText);
  if (hits.length === 0) return;
  const rateLimited = RATE_LIMIT_SIGNATURE.test(String(stderrText ?? ""));
  const limit = rateLimited ? rateLimit() : null;
  const detail = hits.map((h) => `  ${h.id} x${h.count} — ${h.why}\n    ${h.sample}`).join("\n");
  refuse(
    `${label} read less than the whole population and said so on stderr:\n${detail}\n` +
      (rateLimited
        ? `This is a RATE LIMIT. It resets at ${resetAt(limit?.reset)} — re-dispatch then, and do not retry into it.`
        : `A score filed from a short read is a smaller number nobody can tell is smaller, so nothing was filed.`),
  );
}

/**
 * The panel's latency figure must be in the payload.
 *
 * The unconditional half of the latency assertion, and the half that is implementable on
 * `main` today. `cost-latency.mjs` carries the panel's wall clock at
 * `panel.per_item[].wall_ms` with its own `n`, and `panel.duration_source` counts which
 * envelopes were timed. Shape and presence only — never a value, because the figures
 * move whenever a replicate is added or a matcher changes and a lane that pinned one
 * would fail the day the benchmark improved.
 */
export function assertPanelLatency(payload) {
  const items = payload?.panel?.per_item;
  if (!Array.isArray(items) || items.length === 0) {
    refuse(`the cost-latency payload carries no panel.per_item, so the section has no latency figure at all (keys: ${Object.keys(payload?.panel ?? {}).join(", ") || "none"})`);
  }
  const untimed = items.filter((it) => !isNumber(it?.wall_ms?.n) || it.wall_ms.n < 1);
  if (untimed.length > 0) {
    refuse(
      `${untimed.length} of ${items.length} item(s) in the cost-latency payload carry no wall_ms n>=1 (${untimed.map((it) => it?.item_id ?? "?").join(", ")}) — ` +
        `the latency half of the section would render empty, which is what an unmeasured lane also renders`,
    );
  }
  const counts = payload?.panel?.duration_source?.counts;
  const timed = Object.entries(counts ?? {}).filter(([k]) => k !== "absent" && k !== "not-run").reduce((a, [, v]) => a + (Number(v) || 0), 0);
  if (timed < 1) {
    refuse(`the cost-latency payload's duration_source census counts no timed envelope (${JSON.stringify(counts ?? null)}) — every wall clock in it is derived from nothing`);
  }
  return { items: items.length, timed };
}

/** Does the scorer this capability belongs to accept its flag? Read from its own usage. */
export function probeCapability(cap, usageText) {
  return String(usageText ?? "").includes(cap.flag);
}

/**
 * The obligation each probe outcome carries. Returns what happened; refuses when neither
 * the field nor the declared gap is there.
 */
export function assertCapability(cap, { supported, payload }) {
  const value = cap.field(payload);
  if (supported) {
    // THREE distinct failures, and they are worth separating because they have three
    // different causes and only the payload can tell them apart.
    //
    // `requested: false` after the lane passed the flag is the RENAME case, stated rather
    // than inferred: `parseArgs` accepts any `--flag value` pair and drops the ones it does
    // not know, so a renamed flag leaves the scorer never asked. This is the check the
    // pre-#827 version had to fake by testing for an empty figure.
    if (!cap.requested(payload)) {
      refuse(
        `the lane passed ${cap.flag} and ${cap.step}'s payload reports requested=false — so the flag was accepted and ` +
          `IGNORED. parseArgs drops flags it does not know, which means it has been renamed and this pass asked for ` +
          `nothing; ${cap.why} is missing and the payload does not say so. Update CAPABILITIES to the new flag name`,
      );
    }
    // Asked for and NOT obtained. A real failure of the read — no timing records, an
    // endpoint that did not answer — and the scorer explains itself, so the reason travels
    // into the refusal instead of being looked up afterwards.
    if (!cap.measured(payload)) {
      refuse(
        `${cap.step} was asked for ${cap.why} and could not measure it: ${cap.reason(payload) || "the payload gives no reason"}. ` +
          `A payload that requested a figure and did not get one is not the same as one that never asked, and neither is a zero`,
      );
    }
    if (!isNumber(value)) {
      refuse(
        `${cap.step} reports ${cap.why} as measured, and the figure itself is ${JSON.stringify(value ?? null)} — ` +
          `measured=true over an absent value is the worst of the three states, because every reader downstream trusts the flag`,
      );
    }
    // The INTERVAL travels with the figure. "latency" names two different measurements in
    // this payload (a self-timed interval and a check-run proxy) and they differ in `n`,
    // so a summary line saying only "measured" would be decision 28 all over again.
    return { id: cap.id, state: "measured", interval: cap.interval(payload), n: cap.n(payload) };
  }
  const gaps = Array.isArray(payload?.declared_gaps) ? payload.declared_gaps : [];
  const gap = gaps.find((g) => g?.metric === cap.gap_metric);
  if (!gap) {
    refuse(
      `${cap.step} does not accept ${cap.flag} and does not declare ${cap.gap_metric} as a gap either, so ${cap.why} is ` +
        `absent with nothing on the page saying so. If the flag was renamed, update CAPABILITIES; if the metric is now ` +
        `measured by default, this obligation is what should have caught the rename`,
    );
  }
  return { id: cap.id, state: "declared-gap", reason: String(gap.reason ?? "").slice(0, 200) };
}

// --- what gets written, by explicit path ------------------------------------

/**
 * Every path this pass writes, relative to the store root, in the order it writes them.
 *
 * 🔴 THE POINT IS THE COMMIT STEP, and it is not tidiness. `scores/` already holds
 * `by-config/sha256-7470...__smoke/reliability-v1.json`, a fork-era artifact that
 * predates this corpus and must not be committed. `git add scores/` would take it, and
 * `git add -A` is forbidden outright. So the lane stages the paths this function names
 * and nothing else: the set is derived from the comparison's own key, so a file no pass
 * wrote cannot appear in it however long it has been sitting there.
 *
 * Derived through `byConfigSegment` and `comparisonIdFor` rather than by string-joining
 * the same shapes a second time — two implementations of one path is how the second one
 * drifts and files a score the renderer cannot find.
 */
export function writtenPaths({ configHash, corpusVersion, runIds }) {
  const out = [];
  const segment = byConfigSegment(configHash, corpusVersion);
  for (const step of STEPS) {
    if (step.per_replicate) {
      for (const runId of runIds) out.push(path.posix.join(SCORES_DIR, SCORE_SCOPE_DIRS["per-run"], runId, `${step.scorer_id}.json`));
    } else {
      out.push(path.posix.join(SCORES_DIR, SCORE_SCOPE_DIRS["cross-run"], segment, `${step.scorer_id}.json`));
    }
  }
  out.push(path.posix.join(REPORTS_DIR, `${comparisonIdFor({ configHash, corpusVersion })}.md`));
  return out;
}

// --- argument fan-out -------------------------------------------------------

/**
 * One scorer's argv. This is the fan-out the five CLIs' differing conventions force, and
 * the reason it is one function with a test rather than five shell lines.
 */
export function scorerArgs(step, { root, corpusVersion, runIds, capabilityFlags = [] }) {
  const args = [path.join("eval", step.module), "--root", root, "--corpus-version", corpusVersion];
  if (step.per_replicate) {
    if (runIds.length !== 1) refuse(`${step.module} scores ONE replicate and does not aggregate, so it needs exactly one run id, got ${runIds.length}`);
    args.push("--run", runIds[0]);
  } else if (step.key === "cost_latency") {
    args.push("--runs", runIds.join(","));
  } else {
    for (const runId of runIds) args.push("--run-id", runId);
  }
  args.push(...capabilityFlags, "--json");
  return args;
}

/** `report.mjs --persist`'s argv for one payload. */
export function persistArgs(step, { root, corpusVersion, configHash, from, runId = null }) {
  const args = [path.join("eval", "report.mjs"), "--root", root, "--persist", "--scorer-id", step.scorer_id, "--scope", step.scope, "--from", from, "--corpus-version", corpusVersion, "--config-hash", configHash];
  if (runId) args.push("--run-id", runId);
  return args;
}

/** `report.mjs`'s render argv. */
export function renderArgs({ root, corpusVersion, configHash, runIds }) {
  const args = [path.join("eval", "report.mjs"), "--root", root, "--corpus-version", corpusVersion, "--config-hash", configHash];
  for (const runId of runIds) args.push("--run-id", runId);
  return args;
}

// --- the pass ---------------------------------------------------------------

/** One `node <module> …`, captured AND echoed: a lane whose log is empty is unreadable. */
function nodeRun(args, { cwd, env, out = process.stderr }) {
  const r = spawnSync(process.execPath, args, { cwd, env, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.error) refuse(`could not spawn ${args[0]}: ${r.error.message}`);
  if (r.stderr) out.write(r.stderr);
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/**
 * Score one comparison end to end, and refuse rather than file a short answer.
 *
 * Side effects are INJECTED — `run` spawns, `probe` reads the rate limit, `log` writes —
 * so the tests drive the whole sequence with no network, no scorers and no store.
 */
export async function scoreAll({
  root,
  corpusVersion,
  configHash,
  runIds,
  out,
  agentDir = HERE.replace(/\/eval$/, ""),
  env = process.env,
  run = null,
  probe = probeRateLimit,
  log = console.error,
} = {}) {
  if (!root) refuse("--root is required (no default: a scorer that fell back to a path inside this repository would commit benchmark data into wafflebase for good)");
  if (!corpusVersion) refuse("--corpus-version is required");
  if (!configHash) refuse("--config-hash is required — a score filed under the wrong reviewer pair is unpoolable (decision 13) and there is no way to tell afterwards");
  const ids = [...(runIds ?? [])];
  if (new Set(ids).size !== ids.length) refuse(`--runs names the same replicate twice (${ids.join(", ")}) — K would be overstated and every agreement figure computed against a copy of itself`);
  // TWO, not one, and refused HERE rather than at step 3. `reliability.mjs` refuses fewer
  // than two runs by design, and meeting that refusal after volume-mix and
  // complementarity have already spent 100-odd API calls wastes the budget to learn
  // something knowable for free.
  if (ids.length < 2) refuse(`agreement is defined over replicates, so this needs at least two run ids; got ${ids.length}. reliability.mjs refuses fewer, and it would refuse after the API reads rather than before them`);

  const store = new EvalStore(root);
  const corpus = store.getCorpus(corpusVersion);
  if (corpus === null) refuse(`corpus version ${JSON.stringify(corpusVersion)} does not exist under ${root}`);
  for (const runId of ids) {
    if (store.getRun(runId) === null) refuse(`run ${JSON.stringify(runId)} does not exist under ${root} — every scorer below would refuse it, one API budget later`);
  }
  // The same refusal `assertRepoResolved` makes per-call, made once and before anything
  // is read: `gh` expands {owner}/{repo} from the working directory's remote, and this
  // driver runs from the harness checkout whose remote is the right one only by accident.
  if (!String(env.GH_REPO ?? "").includes("/")) {
    refuse("GH_REPO must name the repository (e.g. wafflebase/wafflebase): gh expands {owner}/{repo} from git, and without it every CodeRabbit read fails identically and the arm reports a corpus-wide absence that reads exactly like a repository CodeRabbit never reviewed");
  }

  log(`score-all: ${corpus.length} corpus item(s), ${ids.length} replicate(s) — ${corpusVersion} @ ${configHash}`);
  const budget = assertBudget(parseRateLimit(probe()), { items: corpus.length, replicates: ids.length, log });

  const doRun = run ?? ((args) => nodeRun(args, { cwd: agentDir, env }));
  const outDir = out ?? path.join(root, ".score-all");
  mkdirSync(outDir, { recursive: true });

  const capabilities = [];
  const filed = [];
  for (const step of STEPS) {
    // The capability probe, before the step it belongs to: the flag has to be in the
    // argv, and whether it is supported changes what the payload must then contain.
    const mine = CAPABILITIES.filter((c) => c.step === step.key);
    const supported = new Map(mine.map((c) => [c.id, probeCapability(c, doRun([path.join("eval", step.module), "--help"]).stdout)]));
    for (const c of mine) {
      if (!supported.get(c.id)) log(`score-all: ${step.module} does NOT accept ${c.flag} on this tree, so ${c.why} will be a declared gap rather than a figure`);
    }
    const flags = mine.filter((c) => supported.get(c.id)).map((c) => c.flag);

    const legs = step.per_replicate ? ids.map((id) => [id]) : [ids];
    for (const leg of legs) {
      const label = step.per_replicate ? `${step.module} (${leg[0]})` : step.module;
      const payloadFile = path.join(outDir, step.per_replicate ? `${step.key}-${leg[0]}.json` : `${step.key}.json`);
      log(`score-all: ${label}`);
      const r = doRun(scorerArgs(step, { root, corpusVersion, runIds: leg, capabilityFlags: flags }));
      // The exit code FIRST, then the log lines. Both are refusals, and a step that
      // exited non-zero has already said why.
      if (r.status !== 0) refuse(`${label} exited ${r.status}. Nothing was filed`);
      assertNoDegradation(r.stderr, { label, rateLimit: () => parseRateLimit(probe()) });
      let payload;
      try {
        payload = JSON.parse(r.stdout);
      } catch (e) {
        refuse(`${label} exited 0 but its --json output does not parse (${e.message}) — ${r.stdout.length} byte(s) on stdout`);
      }
      writeFileSync(payloadFile, JSON.stringify(payload, null, 2) + "\n");

      if (step.key === "cost_latency") assertPanelLatency(payload);
      for (const c of mine) capabilities.push(assertCapability(c, { supported: supported.get(c.id), payload }));

      const p = doRun(persistArgs(step, { root, corpusVersion, configHash, from: payloadFile, runId: step.per_replicate ? leg[0] : null }));
      if (p.status !== 0) refuse(`filing ${step.scorer_id} exited ${p.status}`);
      // The ROUND TRIP, against the store rather than against the log line the persist
      // step just printed. A bug at both ends of a round trip is invisible to the round
      // trip, so what is checked is that the renderer's own reader can find it.
      const back = store.getScore({ scorerId: step.scorer_id, scope: step.scope, runId: step.per_replicate ? leg[0] : null, configHash: step.per_replicate ? null : configHash, corpusVersion: step.per_replicate ? null : corpusVersion });
      if (back === null) refuse(`${step.scorer_id} was filed with exit 0 and getScore cannot read it back — the renderer would print "not computed" over a score that is sitting there`);
      filed.push(step.per_replicate ? `${step.scorer_id}@${leg[0]}` : step.scorer_id);
    }
  }

  log("score-all: report.mjs");
  const rendered = doRun(renderArgs({ root, corpusVersion, configHash, runIds: ids }));
  // 🔴 PROPAGATED, not swallowed. `report.mjs` exits 1 when any section's score file is
  // absent, which is the one check that catches a scorer this driver does not know about
  // yet — and it is also what an unmerged scorer looks like. A lane that ignored it
  // would publish a report with a section reading "not computed" and call it a success.
  if (rendered.status !== 0) refuse(`report.mjs exited ${rendered.status} — at least one section's score is missing, so the rendered comparison is not the whole comparison`);

  const paths = writtenPaths({ configHash, corpusVersion, runIds: ids });
  const absent = paths.filter((p) => !existsSync(path.join(root, p)));
  if (absent.length > 0) refuse(`the pass reported success and ${absent.length} of the ${paths.length} path(s) it names are not on disk: ${absent.join(", ")}`);

  return {
    corpus_version: corpusVersion,
    config_hash: configHash,
    run_ids: ids,
    corpus_items: corpus.length,
    filed,
    capabilities,
    api_budget: budget,
    written_paths: paths,
    report_path: paths[paths.length - 1],
  };
}

/** The one-screen version, for a job log and for a human. */
export function summarise(result) {
  // The interval and its `n` ride along when there is one. A line reading
  // `coderabbit-latency=measured` would be a figure with no unit and no denominator, and
  // this payload holds two different latencies measured over different numbers of items.
  const caps =
    result.capabilities
      .map((c) => `${c.id}=${c.state}${c.interval ? ` [${c.interval}${isNumber(c.n) ? `, n=${c.n}` : ""}]` : ""}`)
      .join(" · ") || "none";
  return [
    `scored ${result.corpus_version} @ ${result.config_hash}`,
    `  replicates   ${result.run_ids.join(" · ")}`,
    `  corpus items ${result.corpus_items}`,
    `  filed        ${result.filed.length} score(s): ${result.filed.join(" · ")}`,
    `  capabilities ${caps}`,
    `  report       ${result.report_path}`,
  ].join("\n");
}

// --- CLI --------------------------------------------------------------------

const USAGE =
  "usage: score-all.mjs --root <eval-data-root> --corpus-version <v> --config-hash <sha256:...>\n" +
  "                    --runs <id,id,id> [--out <dir>] [--emit-dir <dir>] [--json]\n" +
  "\n" +
  "Runs the five merged scorers over one stored comparison, files each payload through\n" +
  "report.mjs --persist, and renders the report. Reads the store and read-only GitHub\n" +
  "API; spawns no model, builds no worktree and costs nothing.\n" +
  "\n" +
  "It REFUSES rather than filing a short answer: an unanswered CodeRabbit endpoint, an\n" +
  "API budget too small for the pass, an opt-in capability flag that produced nothing,\n" +
  "an emptied latency figure, or a section whose score did not land.\n" +
  "\n" +
  "--runs takes EVERY replicate of one reviewer, comma-separated, matching\n" +
  "cost-latency.mjs. At least two: agreement is defined over replicates.\n" +
  "--emit-dir writes written-paths.txt, which is what a commit step stages BY PATH.\n" +
  "--root is REQUIRED and has no default; there is no --dry-run, because the only\n" +
  "irreversible step is a git commit and that belongs to the caller.\n" +
  "\n" +
  "GH_REPO must name the repository: gh expands {owner}/{repo} from git, and this\n" +
  "refuses rather than reporting a corpus-wide absence that reads like a clean review.";

async function main() {
  const args = parseArgs(process.argv, { booleans: ["help", "json"] });
  if (args.help) {
    console.log(USAGE);
    return;
  }
  if (!args.root || !args["corpus-version"] || !args["config-hash"] || !args.runs) {
    console.error("--root, --corpus-version, --config-hash and --runs are all required\n");
    console.error(USAGE);
    process.exit(2);
  }
  const result = await scoreAll({
    root: args.root,
    corpusVersion: args["corpus-version"],
    configHash: args["config-hash"],
    runIds: String(args.runs).split(",").map((s) => s.trim()).filter(Boolean),
    out: args.out ?? null,
  });
  if (args["emit-dir"]) {
    mkdirSync(args["emit-dir"], { recursive: true });
    // One path per line, for `xargs git add`. The report is in the list: it is written
    // by the same pass and belongs in the same commit as the scores behind it.
    writeFileSync(path.join(args["emit-dir"], "written-paths.txt"), result.written_paths.join("\n") + "\n");
  }
  if (args.json) console.log(JSON.stringify(result, null, 2));
  console.error(summarise(result));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`score-all: ${e.message}`);
    process.exit(1);
  });
}
