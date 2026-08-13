// What these tests are FOR. This module contains almost no arithmetic — it spawns six
// CLIs in order — so a test that proves the sequence runs proves nothing anybody doubted.
// Everything worth testing here is a REFUSAL, and every refusal exists because the
// corresponding degradation is silent: a lane that files four scores out of five, or an
// arm shortened by a rate limit, or a capability flag that stopped working, all produce a
// plausible smaller number with a zero exit code.
//
// So these concentrate on five things:
//
//   1. The vocabulary is BORROWED, not restated. A scorer id typed twice is a score filed
//      where the renderer will not look for it, and `report.mjs` already owns the list.
//   2. Every flag the driver passes is a flag the target module mentions. This is the
//      assertion `replay-plan.test.mjs` makes for `run.mjs`, and it is the one that
//      catches a rename — `parseArgs` ignores flags it does not know, so a renamed flag
//      is a silent no-op rather than an error.
//   3. The degradation markers still match the ADAPTER'S SOURCE. A reword in
//      `coderabbit.mjs` would leave them matching nothing and the lane silently back to
//      trusting an exit code.
//   4. The capability obligations fire in BOTH directions — flag present and empty, flag
//      absent and gap undeclared.
//   5. The workflow gains this repository no write scope and cannot become a gate.
//
// Nothing here reads a network, spawns a scorer, calls a model or needs an API key. The
// orchestrator's own tests drive it with an injected `run` that records calls.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUDGET_HEADROOM,
  CALLS_PER_ITEM_READ,
  CAPABILITIES,
  DEGRADATION_MARKERS,
  RATE_LIMIT_PROBE_ENDPOINT,
  STEPS,
  assertBudget,
  assertCapability,
  assertNoDegradation,
  assertPanelLatency,
  degradationsIn,
  estimateApiCalls,
  parseRateLimit,
  persistArgs,
  probeCapability,
  renderArgs,
  resetAt,
  scoreAll,
  scorerArgs,
  summarise,
  writtenPaths,
} from "./score-all.mjs";
import { SCORER_IDS, SECTIONS, comparisonIdFor } from "./report.mjs";
import { EvalStore } from "./store.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW = path.join(HERE, "..", "..", "..", ".github", "workflows", "eval-score.yml");

const CONFIG_HASH = "sha256:1c7853debf4edf92646d2299b0c924cb48cca89d6bb68b81648c57508a762f01";
const CORPUS_VERSION = "2026-08-10-pilot-reviewed";
const RUNS = ["pilot-01__k1", "pilot-01__k2", "pilot-01__k3"];

/** The workflow with every comment line stripped.
 *
 *  Stripped FIRST, for the reason `replay-plan.test.mjs` and `collect-captures.test.mjs`
 *  both document: this file explains its own permission model in prose and names
 *  `contents: write` and `git add -A` while asserting it has neither. A whole-file grep
 *  would answer out of the explanation.
 */
function yamlOnly() {
  return readFileSync(WORKFLOW, "utf8")
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
}

/** One named step's body, so an assertion is about the step it names. */
function stepBody(name) {
  const lines = yamlOnly().split("\n");
  const at = lines.findIndex((l) => l.trim() === `- name: ${name}`);
  assert.ok(at >= 0, `no step named ${JSON.stringify(name)}`);
  const out = [];
  for (let i = at + 1; i < lines.length; i++) {
    if (/^\s*- (name|uses):/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join("\n");
}

const source = (mod) => readFileSync(path.join(HERE, mod), "utf8");

/**
 * Does `text` mention `flag` as a WHOLE flag?
 *
 * ⟳ Added after mutation testing, where two mutations survived for one reason: a plain
 * `includes` is a substring test, and `--corpus` is a substring of `--corpus-version`.
 * So renaming `--corpus-version` to `--corpus` in the driver passed both flag tests
 * while sending every scorer a flag none of them read. `--scorer-id` to `--scorer` was
 * the same. The lookahead is what makes these tests about a flag rather than a prefix.
 */
function mentionsFlag(text, flag) {
  return new RegExp(`${flag}(?![A-Za-z0-9-])`).test(text);
}

/**
 * A `cost-latency-v1` payload cut down to the fields this driver asserts on.
 *
 * ⟳ The `coderabbit.latency` half is #827's shape, not the pre-merge one. Both figures are
 * REAL, from a live run on `main` at bb07acd over the pilot at K=3: the self-timed median
 * is 409000 ms over n=7, the push proxy 402000 over n=5. The two differing `n` values are
 * the reason the interval name travels with the figure.
 */
function costLatencyPayload({ wallN = 3, timed = 21, requested = false, measured = false, median = null, n = 0, gaps = ["coderabbit_latency_ms"], reason = "no timing records" } = {}) {
  return {
    scorer_id: "cost-latency-v1",
    panel: {
      per_item: [
        { item_id: "pr-415", wall_ms: { n: wallN, median: 506264 } },
        { item_id: "pr-524", wall_ms: { n: wallN, median: 574000 } },
      ],
      duration_source: { n: timed, counts: { "review-timing.json": timed, absent: 0, "not-run": 0 } },
    },
    coderabbit: {
      latency: {
        requested,
        measured,
        n_items: measured ? 7 : 0,
        self_timed: { interval: "coderabbit-start-marker-to-first-finding", ms: { n, median }, n, n_measured: n },
        push_proxy: { interval: "earliest-check-run-start-to-first-finding", ms: { n: 5, median: 402000 }, n: 5 },
        reason,
      },
    },
    declared_gaps: gaps.map((metric) => ({ metric, value: null, reason: `${metric} is measurable and not from anything this scorer reads` })),
  };
}

/** The measured state, as a live run produces it. */
const MEASURED = { requested: true, measured: true, median: 409000, n: 7, gaps: ["cost_per_real_finding"] };

// --- the vocabulary is borrowed ---------------------------------------------

test("STEPS names exactly report.mjs's sections, with the same ids and scopes", () => {
  // 🔴 The load-bearing coupling. `report.mjs --persist` refuses a scorer id outside its
  // own list, so a typo here is caught at the flag — but a step whose SCOPE disagrees is
  // not: it files a cross-run score under a per-run key, the renderer looks in the other
  // place, and the section reads "not computed" over a score that is sitting there.
  assert.deepEqual(
    STEPS.map((s) => `${s.scorer_id}/${s.scope}`),
    SECTIONS.map((s) => `${s.scorer_id}/${s.scope}`),
    "the driver's steps must be report.mjs's sections, in order and with matching scopes",
  );
  for (const step of STEPS) assert.ok(SCORER_IDS.includes(step.scorer_id), `${step.scorer_id} is not a scorer id report.mjs reads`);
});

test("every step names a module that exists, and exactly one is per-replicate", () => {
  for (const step of STEPS) assert.ok(existsSync(path.join(HERE, step.module)), `${step.module} does not exist`);
  // `volume-mix.mjs` is the only scorer that does not aggregate over K. If a second one
  // ever is, the fan-out below needs a second branch and this is where it says so.
  assert.deepEqual(STEPS.filter((s) => s.per_replicate).map((s) => s.module), ["volume-mix.mjs"]);
});

test("the API-cost model counts exactly the scorers that read the API", () => {
  // `reads_api` is documentation unless something checks it against the model, and the
  // model's `replicates + 2` is precisely "the per-replicate reader once per replicate,
  // plus each cross-run reader once".
  const perReplicate = STEPS.filter((s) => s.reads_api && s.per_replicate).length;
  const crossRun = STEPS.filter((s) => s.reads_api && !s.per_replicate).length;
  assert.equal(perReplicate, 1);
  assert.equal(crossRun, 2);
  assert.equal(estimateApiCalls({ items: 7, replicates: 3 }), 7 * (3 * perReplicate + crossRun) * CALLS_PER_ITEM_READ);
  // MEASURED 2026-08-13 against the real API: a full pass over the 7-item pilot at K=3
  // moved x-ratelimit-used by 175. This is a resource figure and not a benchmark one —
  // no number the lane REPORTS is pinned anywhere in this file.
  assert.equal(estimateApiCalls({ items: 7, replicates: 3 }), 175);
});

// --- the flags the driver passes exist ---------------------------------------

test("every flag scorerArgs passes is a flag that scorer's source MENTIONS", () => {
  // The assertion `replay-plan.test.mjs` makes for `run.mjs`, here for six modules. It
  // matters more in this direction: `parseArgs` accepts any `--flag value` pair and drops
  // the ones it does not know, so a renamed `--corpus-version` would not error — the
  // scorer would run against a different corpus, or refuse for a reason naming the wrong
  // thing.
  for (const step of STEPS) {
    const args = scorerArgs(step, { root: "/tmp/root", corpusVersion: CORPUS_VERSION, runIds: step.per_replicate ? [RUNS[0]] : RUNS });
    const text = source(step.module);
    for (const flag of args.filter((a) => a.startsWith("--"))) {
      assert.ok(mentionsFlag(text, flag), `scorerArgs passes ${flag} to ${step.module}, which never mentions it`);
    }
  }
});

test("every flag persistArgs and renderArgs pass is a flag report.mjs mentions", () => {
  const text = source("report.mjs");
  const all = [
    ...persistArgs(STEPS[0], { root: "/tmp/root", corpusVersion: CORPUS_VERSION, configHash: CONFIG_HASH, from: "/tmp/p.json", runId: RUNS[0] }),
    ...renderArgs({ root: "/tmp/root", corpusVersion: CORPUS_VERSION, configHash: CONFIG_HASH, runIds: RUNS }),
  ];
  for (const flag of all.filter((a) => a.startsWith("--"))) {
    assert.ok(mentionsFlag(text, flag), `report.mjs never mentions ${flag}`);
  }
});

test("each scorer gets its replicates in the convention IT accepts, not one shared shape", () => {
  const byKey = Object.fromEntries(STEPS.map((s) => [s.key, s]));
  const of = (key, ids) => scorerArgs(byKey[key], { root: "/r", corpusVersion: CORPUS_VERSION, runIds: ids });

  // volume-mix scores ONE replicate: `--run`, singular, and it does not aggregate.
  assert.deepEqual(of("volume", [RUNS[0]]).slice(-3), ["--run", RUNS[0], "--json"]);
  // cost-latency takes every replicate at once, comma-separated, because runs/ is never
  // globbed (decision 6).
  assert.ok(of("cost_latency", RUNS).includes("--runs"));
  assert.ok(of("cost_latency", RUNS).includes(RUNS.join(",")));
  assert.equal(of("cost_latency", RUNS).includes("--run-id"), false);
  // The other three take a REPEATABLE --run-id. Repeated, not joined: `parseArgs` is
  // single-valued, so a comma-joined value would be one unknown run id.
  for (const key of ["complementarity", "reliability", "segmentation"]) {
    const args = of(key, RUNS);
    assert.equal(args.filter((a) => a === "--run-id").length, 3, `${key} must get three --run-id flags`);
    for (const id of RUNS) assert.ok(args.includes(id));
    assert.equal(args.includes(RUNS.join(",")), false, `${key} must not get a comma-joined run list`);
  }
});

test("volume-mix refuses more than one replicate rather than scoring the first", () => {
  // The failure this prevents is a filed score: with three ids it would take one and file
  // it under a per-run key, and the report would render a replicate's number as if it had
  // been asked for.
  const volume = STEPS.find((s) => s.per_replicate);
  assert.throws(() => scorerArgs(volume, { root: "/r", corpusVersion: CORPUS_VERSION, runIds: RUNS }), /does not aggregate/);
  assert.throws(() => scorerArgs(volume, { root: "/r", corpusVersion: CORPUS_VERSION, runIds: [] }), /exactly one run id/);
});

// --- the paths the commit step stages ---------------------------------------

test("writtenPaths names one path per replicate for the per-run score and one per cross-run score", () => {
  const paths = writtenPaths({ configHash: CONFIG_HASH, corpusVersion: CORPUS_VERSION, runIds: RUNS });
  assert.equal(paths.length, RUNS.length + 4 + 1, "three volume-mix files, four cross-run scores, one report");
  for (const id of RUNS) assert.ok(paths.includes(`scores/per-run/${id}/volume-mix-v1.json`));
  assert.equal(paths[paths.length - 1], `reports/${comparisonIdFor({ configHash: CONFIG_HASH, corpusVersion: CORPUS_VERSION })}.md`);
});

test("writtenPaths cannot name the fork-era __smoke artifact, whatever it is asked for", () => {
  // 🔴 THE REASON THIS FUNCTION EXISTS. `scores/by-config/sha256-7470…__smoke/` predates
  // this corpus and must never be committed. `git add scores/` would take it; the lane
  // stages this list instead. Every cross-run path is keyed by the comparison's OWN
  // segment, so a directory belonging to another config hash is unreachable from here —
  // not filtered out, but never generated.
  const smoke = "sha256-74703c8840d3f326b65e69966bf0efa896912c5f9906e21eab746ee722677674__smoke";
  const paths = writtenPaths({ configHash: CONFIG_HASH, corpusVersion: CORPUS_VERSION, runIds: RUNS });
  for (const p of paths) assert.equal(p.includes("__smoke"), false, `${p} reaches into another comparison's directory`);
  for (const p of paths) assert.equal(p.includes(smoke), false);
  // And the segment it DOES name is this comparison's, so the two cannot be confused.
  assert.ok(paths.some((p) => p.includes(`sha256-${CONFIG_HASH.slice("sha256:".length)}__${CORPUS_VERSION}`)));
});

test("writtenPaths agrees with the store's own writer, not with a second copy of the layout", () => {
  // The round trip against the real source of truth. Two derivations of one path is how
  // the second one drifts, and a score filed one directory away from where the renderer
  // reads is invisible: the section renders "not computed" and the file is right there.
  const root = mkdtempSync(path.join(tmpdir(), "score-all-paths-"));
  try {
    const store = new EvalStore(root);
    const paths = writtenPaths({ configHash: CONFIG_HASH, corpusVersion: CORPUS_VERSION, runIds: [RUNS[0]] });
    for (const step of STEPS) {
      const key = step.per_replicate
        ? { scorerId: step.scorer_id, scope: step.scope, runId: RUNS[0] }
        : { scorerId: step.scorer_id, scope: step.scope, configHash: CONFIG_HASH, corpusVersion: CORPUS_VERSION };
      const abs = store.putScore(key, { scorer_id: step.scorer_id, scope: step.scope });
      const relative = path.relative(root, abs);
      assert.ok(paths.includes(relative), `the store wrote ${relative}, which writtenPaths does not name`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- the API budget ---------------------------------------------------------

test("parseRateLimit reads the headers of a real response, CRLF included", () => {
  const headers = "HTTP/2.0 200 OK\r\nX-Ratelimit-Limit: 5000\r\nX-Ratelimit-Remaining: 4455\r\nX-Ratelimit-Reset: 1786606948\r\nX-Ratelimit-Used: 545\r\n";
  assert.deepEqual(parseRateLimit(headers), { limit: 5000, remaining: 4455, used: 545, reset: 1786606948 });
  assert.deepEqual(parseRateLimit(""), { limit: null, remaining: null, used: null, reset: null });
});

test("the budget probe is NOT the rate_limit endpoint, which reports a bucket real calls do not draw from", () => {
  // 🔴 MEASURED 2026-08-13, and the first version of this preflight got it wrong. On this
  // project's GitHub App user-to-server token, within the same second:
  //   gh api -i rate_limit           used 0    remaining 5000
  //   gh api -i repos/{owner}/{repo} used 900  remaining 4100
  // The endpoint is exempt in both directions and its headers claim
  // `X-Ratelimit-Resource: core` anyway, so there is no way to tell it from the truth
  // except by asking something else. A preflight on it declares full headroom on an
  // exhausted token — a guard that reads a field answering a different question, which is
  // lesson 7's exact shape.
  assert.equal(RATE_LIMIT_PROBE_ENDPOINT, "repos/{owner}/{repo}");
  assert.doesNotMatch(RATE_LIMIT_PROBE_ENDPOINT, /rate_limit/);
});

test("assertBudget refuses a pass the token cannot pay for, and names the reset time", () => {
  const need = estimateApiCalls({ items: 7, replicates: 3 });
  const floor = Math.ceil(need * BUDGET_HEADROOM);
  const reset = 1786606948;
  // ⟳ THE RELATIONSHIP, not a recomputation. Mutation testing caught this test passing
  // with the headroom removed: it derived `floor` from `BUDGET_HEADROOM` and then checked
  // the code against its own derivation, so setting the constant to 1 moved both sides
  // together. What the headroom is FOR is that a budget exactly equal to the estimate is
  // not enough — the estimate is a model and a paginated item can cost two calls — so
  // that is what is asserted.
  assert.ok(BUDGET_HEADROOM > 1, "a floor equal to the estimate is no headroom at all");
  assert.ok(floor > need, `the floor (${floor}) must exceed the estimate (${need})`);
  assert.throws(
    () => assertBudget({ limit: 5000, remaining: need, used: 1, reset }, { items: 7, replicates: 3, log: () => {} }),
    /remain and this pass needs/,
    "a budget exactly equal to the estimate must be refused",
  );
  assert.throws(
    () => assertBudget({ limit: 5000, remaining: floor - 1, used: 1, reset }, { items: 7, replicates: 3, log: () => {} }),
    (e) => {
      assert.match(e.message, new RegExp(String(floor)), "the refusal must state the floor it applied");
      assert.match(e.message, new RegExp(new Date(reset * 1000).toISOString()), "the refusal must say when the limit resets");
      assert.match(e.message, /idempotent/, "and that waiting costs nothing, so nobody retries into the limit");
      return true;
    },
  );
  // Exactly at the floor is enough.
  assert.deepEqual(assertBudget({ limit: 5000, remaining: floor, used: 1, reset }, { items: 7, replicates: 3, log: () => {} }), { need, floor });
});

test("assertBudget refuses an UNREADABLE limit rather than assuming headroom", () => {
  // `gh` that cannot authenticate produces the same corpus-wide emptiness as a rate
  // limit, and `assertRepoResolved` closes only the placeholder half of that. Asking what
  // happens when the check's INPUT never arrives is lesson 7.
  for (const rl of [{}, { remaining: null }, { remaining: "lots" }]) {
    assert.throws(() => assertBudget(rl, { items: 7, replicates: 3, log: () => {} }), /budget is unknown/);
  }
});

test("resetAt states an absence rather than printing an epoch or an Invalid Date", () => {
  assert.equal(resetAt(1786606948), "2026-08-13T07:42:28.000Z");
  assert.match(resetAt(null), /unknown time/);
  assert.match(resetAt("soon"), /unknown time/);
});

// --- the degradation markers ------------------------------------------------

test("every degradation marker still matches a line in the CodeRabbit adapter's SOURCE", () => {
  // 🔴 The assertion that survives a reword. These regexes are matched against another
  // module's log strings, so `coderabbit.mjs` changing its wording would leave them
  // matching nothing and this lane silently back to trusting an exit code — the same
  // class of failure as an upload glob that stopped matching for five rounds. This test
  // goes red instead, and updating a regex is the cheap half of that trade.
  const adapter = source(path.join("adapters", "coderabbit.mjs"));
  for (const marker of DEGRADATION_MARKERS) {
    const hit = adapter.split("\n").some((line) => marker.re.test(line));
    assert.ok(hit, `no line in adapters/coderabbit.mjs matches ${marker.id} (${marker.re}) — the adapter's wording moved and this marker now catches nothing`);
  }
});

test("degradationsIn finds the adapter's real lines and counts them", () => {
  const stderr = [
    "volume & mix · corpus 2026-08-10-pilot-reviewed · COMPLETE",
    "#415: could not list review comments (HTTP 403: API rate limit exceeded); that half of CodeRabbit's output is absent, not empty.",
    "#429: could not list commits (HTTP 403: API rate limit exceeded); that half of CodeRabbit's output is absent, not empty.",
    "abc123: could not read check runs (HTTP 429); the push-time proxy is absent, not zero.",
  ].join("\n");
  const hits = degradationsIn(stderr);
  assert.deepEqual(hits.map((h) => h.id).sort(), ["coderabbit-check-runs-absent", "coderabbit-endpoint-absent"]);
  assert.equal(hits.find((h) => h.id === "coderabbit-endpoint-absent").count, 2);
  // A clean run has none, so the lane is not red on every pass.
  assert.deepEqual(degradationsIn("volume & mix · COMPLETE\nlocalised 113/142=0.796"), []);
});

test("assertNoDegradation refuses a short read, and resolves the reset time ONLY when rate-limited", () => {
  const limited = "#415: could not list commits (HTTP 403: API rate limit exceeded); that half of CodeRabbit's output is absent, not empty.";
  let probes = 0;
  assert.throws(
    () => assertNoDegradation(limited, { label: "volume-mix.mjs (k1)", rateLimit: () => { probes++; return { reset: 1786606948 }; } }),
    (e) => {
      assert.match(e.message, /volume-mix\.mjs \(k1\)/);
      assert.match(e.message, /RATE LIMIT/);
      assert.match(e.message, /2026-08-13T07:42:28\.000Z/);
      assert.match(e.message, /do not retry into it/);
      return true;
    },
  );
  assert.equal(probes, 1, "the reset time is read once, when it is about to be printed");

  // A degradation that is NOT a rate limit still refuses, and does NOT spend a call
  // resolving a reset time it will not print. The thunk exists for that reason.
  probes = 0;
  const other = "#415: could not list commits (HTTP 502: Bad gateway); that half of CodeRabbit's output is absent, not empty.";
  assert.throws(
    () => assertNoDegradation(other, { label: "x", rateLimit: () => { probes++; return { reset: 1 }; } }),
    /smaller number nobody can tell is smaller/,
  );
  assert.equal(probes, 0, "a non-rate-limit degradation must not cost an API call");

  // And a clean step neither throws nor probes.
  probes = 0;
  assertNoDegradation("all good", { label: "x", rateLimit: () => { probes++; return null; } });
  assert.equal(probes, 0);
});

// --- the capability obligations ---------------------------------------------

test("probeCapability reads the scorer's OWN usage rather than a version number", () => {
  const cap = CAPABILITIES[0];
  assert.equal(probeCapability(cap, `usage: cost-latency.mjs --root <r> [${cap.flag}] [--json]`), true);
  assert.equal(probeCapability(cap, "usage: cost-latency.mjs --root <r> [--coderabbit-usd-per-month <n>] [--json]"), false);
  assert.equal(probeCapability(cap, ""), false);
});

test("a supported flag the scorer IGNORED is the rename case, and the payload says so", () => {
  // 🔴 `parseArgs` accepts any `--flag value` pair and drops the ones it does not know, so a
  // renamed flag leaves the scorer never asked — and files a payload byte-for-byte
  // identical to one from a lane that never asked. #827 states `requested` separately,
  // which turns that inference into a fact the payload reports.
  const cap = CAPABILITIES[0];
  assert.throws(
    () => assertCapability(cap, { supported: true, payload: costLatencyPayload({ requested: false }) }),
    (e) => {
      assert.match(e.message, /--coderabbit-latency/);
      assert.match(e.message, /accepted and\s+IGNORED|requested=false/);
      assert.match(e.message, /renamed/);
      return true;
    },
  );
});

test("asked-for-and-not-measured is a DIFFERENT refusal, and it quotes the scorer's reason", () => {
  // Three states, three causes, and pooling them would be lesson 6: "never asked",
  // "asked and the read failed" and "asked, measured, no figure" are not one absence.
  const cap = CAPABILITIES[0];
  assert.throws(
    () => assertCapability(cap, { supported: true, payload: costLatencyPayload({ requested: true, measured: false, reason: "no timing records for any item" }) }),
    (e) => {
      assert.match(e.message, /no timing records for any item/, "the scorer's own reason must reach the refusal");
      assert.match(e.message, /never asked/);
      return true;
    },
  );
  // measured=true over an absent figure is the worst state: every reader downstream
  // trusts the flag.
  assert.throws(
    () => assertCapability(cap, { supported: true, payload: costLatencyPayload({ ...MEASURED, median: null }) }),
    /measured=true over an absent value/,
  );
});

test("the measured state carries the INTERVAL and its n, not just the word measured", () => {
  // Decision 28. This payload holds two latencies — a self-timed interval over n=7 and a
  // check-run proxy over n=5 — so `state: "measured"` alone is a figure with no unit.
  const cap = CAPABILITIES[0];
  assert.deepEqual(assertCapability(cap, { supported: true, payload: costLatencyPayload(MEASURED) }), {
    id: cap.id,
    state: "measured",
    interval: "coderabbit-start-marker-to-first-finding",
    n: 7,
  });
  // The SELF-TIMED interval, not the proxy: it is the one #791's declared gap named and it
  // is measured on more items. Reading the proxy would silently swap the measurement.
  assert.notEqual(cap.field(costLatencyPayload(MEASURED)), 402000, "the accessor must not read push_proxy");
  assert.equal(cap.field(costLatencyPayload(MEASURED)), 409000);
});

test("an unsupported capability must still be a DECLARED gap, or the lane refuses", () => {
  // The honest state on a tree where the flag has not landed is "declared gap", and what
  // it must never become is an absence nobody declared. That is what makes the
  // unsupported branch an obligation rather than a shrug — and it is what catches a
  // rename that also deletes the gap, on the theory that the metric is now measured.
  const cap = CAPABILITIES[0];
  const ok = assertCapability(cap, { supported: false, payload: costLatencyPayload({ gaps: ["coderabbit_latency_ms"] }) });
  assert.equal(ok.id, cap.id);
  assert.equal(ok.state, "declared-gap");
  assert.match(ok.reason, /measurable/);
  assert.throws(
    () => assertCapability(cap, { supported: false, payload: costLatencyPayload({ gaps: ["cost_per_real_finding"] }) }),
    /does not declare coderabbit_latency_ms as a gap/,
  );
  assert.throws(() => assertCapability(cap, { supported: false, payload: { panel: {} } }), /does not declare/);
});

test("the capability's field and gap metric are BOTH names the live scorer uses", () => {
  // Neither half is guesswork: the payload field is read out of a real payload shape and
  // the gap metric is a string `cost-latency.mjs` itself emits. If a rename lands, this
  // goes red beside the marker test rather than the lane going quietly thin.
  const cap = CAPABILITIES[0];
  const text = source("cost-latency.mjs");
  assert.ok(text.includes(cap.gap_metric), `cost-latency.mjs never mentions ${cap.gap_metric}`);
  assert.equal(cap.field(costLatencyPayload({ ...MEASURED, median: 123 })), 123, "the accessor must read the field it documents");
  assert.equal(cap.field({}), undefined);
  // Every accessor tolerates a payload that has none of this, because a scorer whose shape
  // moved again must produce a refusal rather than a TypeError.
  for (const key of ["requested", "measured", "n", "interval", "reason"]) {
    assert.doesNotThrow(() => cap[key]({}), `cap.${key} must not throw on an empty payload`);
  }
  assert.equal(CAPABILITIES.every((c) => STEPS.some((s) => s.key === c.step)), true, "every capability must belong to a step that runs");
});

// --- the latency assertion --------------------------------------------------

test("assertPanelLatency refuses a payload whose latency figure has been emptied", () => {
  // 🔴 SHAPE AND PRESENCE, NEVER A VALUE. The figures move whenever a replicate is added
  // or a matcher changes, so a lane that pinned one would fail the day the benchmark
  // improved. What is pinned is that there IS one.
  assert.deepEqual(assertPanelLatency(costLatencyPayload()), { items: 2, timed: 21 });

  assert.throws(() => assertPanelLatency({ panel: { per_item: [] } }), /no panel\.per_item/);
  assert.throws(() => assertPanelLatency({}), /no panel\.per_item/);
  // One untimed item is enough: a section that renders a wall clock for six items and a
  // blank for the seventh is not the measurement anybody quoted.
  const holed = costLatencyPayload();
  holed.panel.per_item[1].wall_ms = { n: 0 };
  assert.throws(() => assertPanelLatency(holed), (e) => {
    assert.match(e.message, /1 of 2 item\(s\)/);
    assert.match(e.message, /pr-524/, "the refusal must name which item lost its figure");
    return true;
  });
  // And a census that counts no timed envelope: every wall clock in the payload would be
  // derived from nothing, which is a different failure from a missing field.
  assert.throws(() => assertPanelLatency(costLatencyPayload({ timed: 0 })), /counts no timed envelope/);
});

test("the live tree's capability state is what the lane reports it to be", () => {
  // ⟳ FLIPPED 2026-08-13, and the flip is the interlock working. This test asserted that
  // `cost-latency.mjs` did NOT accept the flag, which was true at ba944f3 — and it went red
  // on CI the day #827 merged, with a message naming what to change. That is the whole
  // point of pinning a state rather than tolerating either: the alternative is a lane that
  // keeps reporting "declared gap" after the gap is filled and nobody notices.
  //
  // What the red test also caught, which no expectation-tolerant version would have: the
  // payload SHAPE moved. `coderabbit.latency.wall_ms` is gone, replaced by
  // `self_timed`/`push_proxy`, so the accessor needed updating too — and the lane would
  // otherwise have refused every pass with "measured over an absent value".
  const cap = CAPABILITIES[0];
  const usage = source("cost-latency.mjs");
  assert.ok(
    usage.includes(cap.flag),
    `cost-latency.mjs no longer accepts ${cap.flag}. If it was renamed, update CAPABILITIES and this expectation together; the lane's own refusal for the rename case is the requested=false branch`,
  );
  // And the shape the accessors read is the shape that file writes.
  for (const name of ["self_timed", "requested", "measured", cap.gap_metric]) {
    assert.ok(usage.includes(name), `cost-latency.mjs never mentions ${name}, which this capability reads`);
  }
});

// --- the orchestrator's cheap refusals --------------------------------------

/** A `run` that records every argv and answers nothing, so a test can prove it was never called. */
function spy() {
  const calls = [];
  return { calls, run: (args) => { calls.push(args); return { status: 0, stdout: "{}", stderr: "" }; } };
}

test("scoreAll refuses fewer than two replicates BEFORE it spends an API budget", () => {
  // `reliability.mjs` refuses fewer than two runs by design. Meeting that refusal at step
  // three, after volume-mix and complementarity have spent a hundred-odd API calls, is
  // paying to learn something knowable for free.
  const s = spy();
  return Promise.all([
    assert.rejects(
      () => scoreAll({ root: "/nope", corpusVersion: CORPUS_VERSION, configHash: CONFIG_HASH, runIds: [RUNS[0]], run: s.run, probe: () => { throw new Error("probed"); }, log: () => {} }),
      /at least two run ids/,
    ),
    assert.rejects(
      () => scoreAll({ root: "/nope", corpusVersion: CORPUS_VERSION, configHash: CONFIG_HASH, runIds: [], run: s.run, probe: () => { throw new Error("probed"); }, log: () => {} }),
      /at least two run ids/,
    ),
  ]).then(() => {
    assert.deepEqual(s.calls, [], "nothing may be spawned before the argument shape is accepted");
  });
});

test("scoreAll refuses a repeated replicate, which would overstate K", () => {
  // Agreement over a copy of one run is 1.000 by construction, and a duplicate is a
  // plausible typo in a comma-separated list.
  const s = spy();
  return assert.rejects(
    () => scoreAll({ root: "/nope", corpusVersion: CORPUS_VERSION, configHash: CONFIG_HASH, runIds: [RUNS[0], RUNS[1], RUNS[0]], run: s.run, probe: () => { throw new Error("probed"); }, log: () => {} }),
    /names the same replicate twice/,
  ).then(() => assert.deepEqual(s.calls, []));
});

test("scoreAll requires --root, --corpus-version and --config-hash, each for its own reason", async () => {
  const base = { corpusVersion: CORPUS_VERSION, configHash: CONFIG_HASH, runIds: RUNS, run: spy().run, probe: () => "", log: () => {} };
  await assert.rejects(() => scoreAll({ ...base, root: "" }), /--root is required/);
  await assert.rejects(() => scoreAll({ ...base, root: "/r", corpusVersion: "" }), /--corpus-version is required/);
  await assert.rejects(() => scoreAll({ ...base, root: "/r", configHash: "" }), /--config-hash is required/);
});

test("summarise states what was filed and which capabilities were measured", () => {
  const text = summarise({
    corpus_version: CORPUS_VERSION,
    config_hash: CONFIG_HASH,
    run_ids: RUNS,
    corpus_items: 7,
    filed: ["volume-mix-v1@pilot-01__k1", "complementarity-v1"],
    capabilities: [{ id: "coderabbit-latency", state: "declared-gap" }],
    api_budget: { need: 175, floor: 263 },
    written_paths: ["reports/x.md"],
    report_path: "reports/x.md",
  });
  assert.match(text, /2 score\(s\)/);
  assert.match(text, /coderabbit-latency=declared-gap/, "a capability that was NOT measured must be visible in the summary, not only in a log line");
  assert.match(text, /reports\/x\.md/);
});

// --- the workflow -----------------------------------------------------------

test("the scoring workflow has NO write scope on THIS repository", () => {
  // Out of scope, always: granting a job here any write it does not have. This lane's
  // writes go to the separate eval data repo through a token scoped to it, exactly as
  // `eval-replay.yml` and `capture-collect.yml` do — so a later "it would be simpler if
  // it just committed the results here" has to argue with a test.
  const yaml = yamlOnly();
  assert.match(yaml, /^permissions: \{\}$/m, "the workflow must deny every scope by default");
  assert.equal(/:\s*write\b/.test(yaml), false, "a write scope appears in eval-score.yml");
  for (const forbidden of ["contents: write", "checks: write", "pull-requests: write", "id-token: write", "statuses: write"]) {
    assert.equal(yaml.includes(forbidden), false, `${forbidden} must never appear here`);
  }
  // The job's own scopes: four reads, each because a named endpoint needs it.
  const lines = yaml.split("\n");
  const at = lines.findIndex((l) => /^\s{4}permissions:\s*$/.test(l));
  assert.ok(at >= 0, "the job must declare its own permissions block");
  const block = [];
  for (let i = at + 1; i < lines.length; i++) {
    if (!/^\s{6}\S/.test(lines[i])) break;
    block.push(lines[i].trim().replace(/\s*#.*$/, ""));
  }
  assert.deepEqual(block.sort(), ["checks: read", "contents: read", "issues: read", "pull-requests: read"]);
});

test("the scoring lane CANNOT gate a pull request", () => {
  // The mirror of `eval-replay.yml`'s trigger assertion, for the opposite reason: there it
  // stops a paid job firing itself, here it stops a free job becoming a required check.
  // Neither `workflow_dispatch` nor `schedule` is attached to a commit, so this lane
  // produces no status check and a merge has nothing to block on.
  const lines = yamlOnly().split("\n");
  const at = lines.findIndex((l) => /^on:\s*$/.test(l));
  assert.ok(at >= 0, "the workflow must declare an `on:` block");
  const events = [];
  for (let i = at + 1; i < lines.length; i++) {
    if (lines[i].trim() === "") continue;
    if (!/^\s+\S/.test(lines[i])) break;
    const m = /^ {2}(\S+):/.exec(lines[i]);
    if (m) events.push(m[1]);
  }
  assert.deepEqual(events.sort(), ["schedule", "workflow_dispatch"]);
  for (const forbidden of ["pull_request", "pull_request_target", "push", "workflow_run", "issue_comment", "repository_dispatch", "check_run", "status"]) {
    assert.equal(events.includes(forbidden), false, `${forbidden} would attach this lane to a commit and let it gate a merge`);
  }
});

test("no run: body interpolates an expression, and every input read is DECLARED", () => {
  // Two bugs in one test, both `replay-plan.test.mjs`'s. An expression is expanded before
  // the shell sees it, so a value with a quote becomes script; and a MISTYPED input
  // expression is not an error in Actions, it interpolates to the empty string — which
  // here would silently swap a dispatch's corpus for the scheduled default and score the
  // wrong pull requests under the right-looking name.
  const yaml = yamlOnly();
  const lines = yaml.split("\n");
  let indent = null;
  for (const line of lines) {
    const opens = /^(\s*)run:\s*\|/.exec(line);
    if (opens) { indent = opens[1].length; continue; }
    if (indent === null) continue;
    if (line.trim() === "") continue;
    if (/^\s*/.exec(line)[0].length <= indent) { indent = null; continue; }
    assert.equal(/\$\{\{/.test(line), false, `a run: body interpolates an expression: ${line.trim()}`);
  }
  const declaredAt = lines.findIndex((l) => /^\s{4}inputs:\s*$/.test(l));
  assert.ok(declaredAt >= 0, "workflow_dispatch must declare an inputs block");
  const declared = new Set();
  for (let i = declaredAt + 1; i < lines.length; i++) {
    if (lines[i].trim() === "") continue;
    const m = /^ {6}(\S+):\s*$/.exec(lines[i]);
    if (m) { declared.add(m[1]); continue; }
    if (/^ {0,5}\S/.test(lines[i])) break;
  }
  const read = [...yaml.matchAll(/inputs\.([A-Za-z0-9_]+)/g)].map((m) => m[1]);
  assert.ok(read.length > 0, "the workflow must read its inputs somewhere");
  for (const name of new Set(read)) {
    assert.ok(declared.has(name), `the workflow reads inputs.${name}, which is not declared — it would interpolate to ""`);
  }
});

test("the commit step stages BY EXPLICIT PATH and never a directory", () => {
  // 🔴 `scores/` holds a fork-era `__smoke` artifact from another config hash, so
  // `git add scores/` would commit it as though this pass produced it. Asserted on the
  // step's own body, not the whole file: a per-step slice is what makes this about the
  // step it names.
  const body = stepBody("Commit the scores and the report");
  assert.match(body, /xargs git add -- < "\$RUNNER_TEMP\/emit\/written-paths\.txt"/, "the staged set must come from the driver's emitted path list");
  assert.equal(/git add -A/.test(body), false);
  assert.equal(/git add \.(\s|$)/.test(body), false);
  assert.equal(/git add scores/.test(body), false);
  assert.equal(/git add reports/.test(body), false);
  // And the staged set is checked BACK against the list, because "I staged the right
  // paths" and "only the right paths are staged" are different claims.
  assert.match(body, /comm -13/);
  assert.match(body, /did not write/);
});

test("an empty diff is a SUCCESS, and it is reported rather than hidden", () => {
  // `report.mjs` carries no timestamp on purpose, so two renders of one dataset are
  // byte-identical and the ordinary outcome of a weekly tick is an empty index. A step
  // that assumed a change would either redden every Monday or file empty commits.
  const body = stepBody("Commit the scores and the report");
  assert.match(body, /if git diff --cached --quiet; then/);
  assert.match(body, /nothing moved/);
  assert.match(body, /successful re-score, not a no-op/);
  // Exit 0 on that path, and it comes BEFORE the commit.
  const quietAt = body.indexOf("git diff --cached --quiet");
  const commitAt = body.indexOf("git commit -m");
  assert.ok(quietAt >= 0 && commitAt > quietAt, "the no-diff check must precede the commit");
});

test("the dry run stops before the commit, not before the work", () => {
  const body = stepBody("Commit the scores and the report");
  const gateAt = body.indexOf('if [ "$DRY_RUN" != "no" ]; then');
  const commitAt = body.indexOf("git commit -m");
  const pushAt = body.indexOf("git push");
  assert.ok(gateAt >= 0, "the commit step must carry a dry-run gate");
  assert.ok(gateAt < commitAt, "the gate must precede the commit, so a dry run creates no commit at all");
  assert.ok(commitAt < pushAt);
  assert.match(body, /Nothing was committed and nothing was pushed/);
  // The gate is the LAST step's business only. Nothing earlier may branch on it, because
  // a dry run whose scorers did not run proves nothing about the real one.
  for (const step of ["Score and render", "Print the rendered report"]) {
    assert.equal(/DRY_RUN/.test(stepBody(step)), false, `${step} must run identically in a dry run`);
  }
});

test("a SCHEDULED tick commits, and a dispatch defaults to a dry run", () => {
  // The default is inverted by trigger rather than by input, and both halves matter: a
  // schedule reads no inputs at all, so an input default of "yes" would make every tick a
  // dry run and the lane would never once update the store.
  const body = stepBody("Resolve what to score");
  assert.match(body, /if \[ "\$GITHUB_EVENT_NAME" = "schedule" \]; then/);
  assert.match(body, /dry_run="no"/);
  assert.match(yamlOnly(), /default: "yes"/, "a dispatch must default to the safe side");
});

test("every flag the workflow passes to score-all.mjs is a flag score-all.mjs accepts", () => {
  // `parseArgs` ignores flags it does not know, so a renamed driver flag would leave the
  // workflow passing a value nothing reads — and the driver would refuse for a reason
  // naming a missing argument rather than a typo.
  const body = stepBody("Score and render");
  const flags = [...body.matchAll(/^\s*(--[a-z-]+)/gm)].map((m) => m[1]);
  assert.ok(flags.length >= 5, `expected the driver's flags in the step body, found ${JSON.stringify(flags)}`);
  const driver = source("score-all.mjs");
  for (const flag of flags) assert.ok(mentionsFlag(driver, flag), `the workflow passes ${flag}, which score-all.mjs never mentions`);
});

test("the workflow's scheduled target is a corpus identity, and it is the one the driver would refuse to invent", () => {
  // `inputs.*` are empty on a schedule, so the target is written down — and it is written
  // down HERE rather than defaulted inside the driver, where a stale value would be
  // invisible. The driver has no default for any of the three.
  const yaml = yamlOnly();
  for (const key of ["SCHEDULED_CORPUS_VERSION", "SCHEDULED_CONFIG_HASH", "SCHEDULED_RUNS"]) {
    assert.match(yaml, new RegExp(`${key}: "`), `${key} must be declared in env`);
  }
  const driver = source("score-all.mjs");
  assert.equal(/2026-08-10-pilot-reviewed/.test(driver), false, "the driver must not carry a corpus default; a lane pointed at the wrong corpus must refuse, not guess");
  assert.equal(/pilot-01__k/.test(driver), false, "nor a run id default");
});

test("the lane needs no deep checkout and no npm install, and says so", () => {
  // MEASURED, not assumed (see the task doc): a full pass ran against a store copy with
  // no `.git` at all, from a shallow checkout carrying zero `refs/eval/*` refs, in a tree
  // with no `node_modules`. `eval-replay.yml` needs all three and its header explains
  // why; inheriting that ceremony here would cost 44 MB per item for nothing.
  const yaml = yamlOnly();
  assert.equal(/fetch-depth:/.test(yaml), false, "scoring reads stored JSON, so a deep or unshallowed checkout buys nothing");
  assert.equal(/npm ci/.test(yaml), false, "the scorers import node: builtins and their own siblings only");
  assert.equal(/refs\/(eval|pull)/.test(yaml), false, "no corpus commit is fetched, because none is read");
  assert.equal(/CLAUDE_CODE_OAUTH_TOKEN/.test(yaml), false, "this lane must hold no model credential");
});
