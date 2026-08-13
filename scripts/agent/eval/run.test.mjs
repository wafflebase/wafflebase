// The runner's decisions, and one end-to-end replay — all free, all offline.
//
// Two kinds of test here and the split is deliberate. The pure ones drive
// `classifyItemOutcome` / `resolveRunOptions` / `resolvePanelSha` / `summarizeRun`
// directly, because each is a decision with a fail direction that has to be
// asserted in isolation. The end-to-end ones run `main()` over a real store with
// `--panel-script` pointed at `adapters/stub-panel.mjs`, because idempotence,
// abort-on-fatal and "the lane reaches the stored envelope" are properties of the
// whole lane and not of any one function in it.
//
// Nothing here calls a model, and nothing here needs an API key.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { fixtureGitEnv } from "../vendor/pipeline/git-env.mjs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EvalStore, contentSha256 } from "./store.mjs";
import {
  DEFAULT_PANEL_SCRIPT,
  DEFAULT_PANEL_TIMEOUT_S,
  FATAL_REASONS,
  GATE_NOT_RUN,
  ITEM_REASONS,
  RUN_STATUSES,
  classifyItemOutcome,
  cleanupRepoCache,
  main,
  materializeRepoAt,
  panelEnv,
  resolvePanelSha,
  resolveRunOptions,
  summarizeRun,
} from "./run.mjs";
import { GATE_STATES } from "./adapters/reviewer.mjs";
// THE REAL PREDICATES THE PANEL CALLS, not a stub's canned gate line. A stub that
// prints `novelty gate: on` because its spec said so proves nothing about whether
// the tree this runner builds can actually be blamed, which is the entire fidelity
// claim of the worktree. `routeFinding` is the gate's own router, so the three
// together answer the question end to end — does a replay of this tree produce the
// lane the shipped gate would? All free: no model, no network.
import { baseResolves, noveltyOf } from "../vendor/pipeline/novelty.mjs";
import { routeFinding } from "../vendor/pipeline/review-panel.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STUB = path.join(HERE, "adapters", "stub-panel.mjs");
const LENSES = path.join(HERE, "..", "vendor", "pipeline", "lenses");
const PANEL_SHA = "0".repeat(39) + "1";
const SHA40 = /^[0-9a-f]{40}$/;

const DIFF = [
  "diff --git a/scripts/agent/x.mjs b/scripts/agent/x.mjs",
  "--- a/scripts/agent/x.mjs",
  "+++ b/scripts/agent/x.mjs",
  "@@ -1,2 +1,2 @@",
  "-const a = 1;",
  "+const a = 2;",
  "",
].join("\n");

/** A healthy capture, as `classifyItemOutcome` sees one. */
const OK = Object.freeze({
  exitCode: 0,
  panelState: "present",
  panel: [{ id: "correctness", applicable: true }],
  calls: 3,
  gate: { state: "off-no-base-sha", line: "novelty gate: OFF (no --base-sha) — every finding routes as before" },
  baseShaPassed: false,
  diffContent: { state: "complete", lensesWithDetail: 1, lensesWithDiff: 1 },
  diffContentRequested: true,
});

/**
 * A store rooted in a throwaway directory, holding `count` frozen corpus items.
 *
 * More than one only matters to the cost cap, whose whole claim is about the item
 * it did NOT spawn — a property no single-item fixture can express.
 */
function tempCorpus({
  itemId = "pr-664",
  diff = DIFF,
  reviewCommit = "61101a1bdbdffb9acb88772cae4c9347c69f413b",
  reviewBase = "35206e5859788062cfddfd0fc12b0a5754655a8d",
  count = 1,
} = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "eval-run-test-"));
  const store = new EvalStore(root);
  const ids = [itemId, ...Array.from({ length: count - 1 }, (_, i) => `${itemId}-x${i + 1}`)];
  for (const id of ids) {
    const meta = {
      id,
      source_pr: 664,
      review_commit: reviewCommit,
      review_base: reviewBase,
      review_point: "pr-open",
      diff_method: "fork-point",
      changed_files: ["scripts/agent/x.mjs"],
      additions: 1,
      deletions: 1,
      scope: "S",
      has_issue_spec: false,
      sha256_diff: contentSha256(diff),
    };
    store.putCorpusItem(id, { meta, diff, changedFiles: meta.changed_files, issueSpec: "" });
  }
  store.putCorpusManifest("v-test", { corpus_version: "v-test", item_count: ids.length, items: ids.map((id) => ({ id })) });
  return { root, store, itemId, itemIds: ids, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/**
 * A throwaway git repository with two real commits, and the shas a novelty probe
 * needs: `base` is the first, `head` the second.
 *
 * The second commit RELOCATES a distinctive line as well as adding one — moved
 * from `src/a.mjs` to `src/moved.mjs` — because `relocated` is the only
 * origin `DEMOTING_ORIGINS` holds, and therefore the only way a finding reaches
 * `lane: "backlog"`. That lane is the one this whole change makes reachable, so
 * the fixture has to be able to produce it.
 *
 * `fixtureGitEnv`, never the ambient environment: `cwd` alone does not scope git,
 * and under a hook — `pre-push` runs `verify:self`, so the whole suite inherits
 * `GIT_DIR` and `GIT_INDEX_FILE` — a helper like this one already once committed
 * its fixture files into the developer's real repository.
 */
function tempGitRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), "eval-src-repo-"));
  const git = (...a) =>
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...a], {
      cwd: dir,
      env: fixtureGitEnv(dir),
      stdio: "pipe",
      encoding: "utf8",
    });
  const MOVED = "export const distinctiveHelperForNoveltyProbe = () => 42;";
  git("init", "--quiet");
  mkdirSync(path.join(dir, "src"), { recursive: true });
  writeFileSync(path.join(dir, "src", "a.mjs"), `export const a = 1;\nexport const b = 2;\n${MOVED}\n`);
  writeFileSync(path.join(dir, "README.md"), "# fixture\n");
  git("add", "src/a.mjs", "README.md");
  git("commit", "--quiet", "-m", "base");
  const base = git("rev-parse", "HEAD").trim();

  // A line the change genuinely ADDED, and the same distinctive line MOVED to a
  // new file. `introduced` and `relocated` from one commit, which is what lets
  // one fixture drive both lanes.
  writeFileSync(path.join(dir, "src", "a.mjs"), "export const a = 1;\nexport const b = 2;\nexport const addedByTheChange = 3;\n");
  writeFileSync(path.join(dir, "src", "moved.mjs"), `${MOVED}\n`);
  git("add", "src/a.mjs", "src/moved.mjs");
  git("commit", "--quiet", "-m", "the change");
  const head = git("rev-parse", "HEAD").trim();
  return { dir, base, head, git, movedLine: MOVED, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * Run the CLI end to end against a stub panel.
 *
 * `--no-repo-context` by default because materialising the tree is not what most of
 * these tests are about — the repo-context guard's own test passes
 * `noRepoContext: false` to reach it. And `--panel-sha` because `--panel-script`
 * points at the stub: a run that replayed a different script while stamping the real
 * panel's commit is exactly the mislabelling `panel_sha` exists to prevent, so the
 * runner insists on being told.
 */
// --- reaping what the stub spawned ------------------------------------------
//
// `hang` mode's stub never exits and, with `spawnGrandchild`, starts a child that
// IGNORES SIGTERM. `reviewer.mjs` kills that group on its way out of `runAgent`,
// but only along paths that reach its own settle — and this file spawns those
// processes and, until now, asserted on the promise and walked away. Reaping what
// you spawn is this file's obligation whether or not anything downstream also
// does it: the assertion is about the timeout's REASON, not about who cleans up.
//
// `stub-panel.mjs` writes `stub-pids.json` with `{ panel, grandchild }` for
// exactly this, and nothing had ever read it.
const stubPids = new Set();

// Only POSIX has process groups; on win32 a negative pid is not "the group", it
// is an invalid pid. Same reasoning, and same guard, as `reviewer.mjs`.
const IS_POSIX = process.platform !== "win32";

// `process.kill(-0, …)` signals THE CALLER'S OWN PROCESS GROUP. Under the lane
// that group is the test runner and every sibling test file, so a zero reaching
// the kill below would take down the whole suite — a far worse failure than the
// orphan it was reaping. Hence a whitelist of what may be signalled, not a
// blacklist of what may not: `> 1` also refuses pid 1.
const isReapablePid = (pid) => Number.isInteger(pid) && pid > 1;

// `kill` is injected so the guard can be tested without signalling anything.
function reapPid(pid, kill = process.kill) {
  if (!isReapablePid(pid)) return false;
  // Group first, because the grandchild ignores SIGTERM and is only reachable
  // through the group its parent leads; then the bare pid, in its OWN try, so a
  // group kill that throws does not skip the process itself. SIGKILL rather than
  // SIGTERM for the same reason the fixture exists: SIGTERM is what it ignores.
  // `ESRCH` — already gone — is the normal case, not a failure.
  try { if (IS_POSIX) kill(-pid, "SIGKILL"); } catch { /* group already gone */ }
  try { kill(pid, "SIGKILL"); } catch { /* already gone */ }
  return true;
}

// WHERE THE FILE IS, AND WHY IT IS NOT UNDER `root`. The stub writes
// `stub-pids.json` into the ITEM's scratch directory, which `run.mjs` makes under
// `tmpdir()` and deletes itself — except for a FAILED item, whose directory it
// keeps because that holds the only copy of what the panel wrote, printing the
// path as it goes. A hang is a failed item, so that line is how this file learns
// where to look, and `runCli` already captures it.
//
// Parsed from the log rather than found by scanning `tmpdir()` for
// `eval-item-*`: sibling test FILES run concurrently and have scratch
// directories of their own, so a scan would reap a stub another file is still
// timing out against — turning a leak into a cross-file flake.
const KEPT_OUTPUT = /raw panel output kept at (.+)$/;

function collectStubPids(logs, into = stubPids) {
  let found = 0;
  for (const line of logs) {
    const kept = KEPT_OUTPUT.exec(line);
    if (kept === null) continue;
    try {
      const pids = JSON.parse(readFileSync(path.join(kept[1].trim(), "stub-pids.json"), "utf8"));
      // A missing or half-written value is not an error: a failed item that never
      // hung has no `stub-pids.json` at all, and the only thing an unreadable one
      // costs is a reap of a process that is already gone.
      for (const pid of [pids.panel, pids.grandchild]) {
        if (isReapablePid(pid)) { into.add(pid); found += 1; }
      }
    } catch { /* no pids file, or unreadable: nothing to reap */ }
  }
  return found;
}

// File-scoped, not per-test: `afterEach` would kill a stub that a later test is
// still legitimately timing out against, which would change what the timeout
// tests measure rather than clean up after them.
after(() => {
  for (const pid of stubPids) reapPid(pid);
  stubPids.clear();
});

async function runCli(root, spec = {}, extra = [], { noRepoContext = true } = {}) {
  // The cost cap is REQUIRED, so every invocation has to answer it. A stub panel
  // reports a fixed cost and spends nothing, so the honest answer for a test that
  // is not about the cap is `--no-cost-cap` — and the tests that ARE about it pass
  // their own flag in `extra`, which this must not then contradict.
  const capAnswered = extra.some((a) => a === "--max-cost-usd" || a === "--no-cost-cap");
  const specPath = path.join(root, `spec-${extra.join("_").replace(/[^a-z0-9]/gi, "") || "default"}.json`);
  writeFileSync(specPath, JSON.stringify(spec));
  const prev = process.env.STUB_PANEL_SPEC;
  process.env.STUB_PANEL_SPEC = specPath;
  const logs = [];
  const realLog = console.log, realErr = console.error;
  console.log = (...a) => logs.push(a.join(" "));
  console.error = (...a) => logs.push(a.join(" "));
  try {
    const code = await main([
      "node", "run.mjs",
      "--root", root,
      "--corpus-version", "v-test",
      "--lenses-dir", LENSES,
      "--panel-script", STUB,
      "--panel-sha", PANEL_SHA,
      ...(noRepoContext ? ["--no-repo-context"] : []),
      ...(capAnswered ? [] : ["--no-cost-cap"]),
      ...extra,
    ]);
    return { code, logs };
  } finally {
    console.log = realLog;
    console.error = realErr;
    if (prev === undefined) delete process.env.STUB_PANEL_SPEC; else process.env.STUB_PANEL_SPEC = prev;
    // Unconditionally, including when `main` threw: that is exactly the run most
    // likely to have left something alive.
    collectStubPids(logs);
  }
}

const runIdOf = (root) => readdirSync(path.join(root, "runs")).sort()[0];

// --- the reason vocabulary ---------------------------------------------------

test("every reason the classifier can emit is in the declared vocabulary", () => {
  // A closed list is the point: a new failure mode added as an unlabelled string
  // would be indistinguishable, to a scorer, from one of the existing ones.
  const cases = [
    { ...OK, exitCode: 1 },
    { ...OK, panelState: "absent", panel: null },
    { ...OK, panelState: "unreadable", panel: null },
    { ...OK, gate: { state: "unreported", line: null } },
    { ...OK, gate: { state: "off-base-sha-unresolved", line: "x" }, baseShaPassed: true },
    { ...OK, gate: { state: "on", line: "x" } },
    { ...OK, diffContent: { state: "absent", lensesWithDetail: 2, lensesWithDiff: 0 } },
    { ...OK, panel: [{ id: "a", applicable: true, infraError: "429" }] },
    { ...OK, calls: 0 },
    { ...OK, gate: { state: "not-a-state" } },
  ];
  for (const c of cases) {
    const out = classifyItemOutcome(c);
    assert.ok(ITEM_REASONS.includes(out.reason), `${out.reason} is not in ITEM_REASONS`);
    assert.equal(out.status, "error");
    assert.ok(out.error.message.length > 10, `reason ${out.reason} has no usable message`);
    assert.equal(out.error.kind, out.reason);
  }
  for (const r of FATAL_REASONS) assert.ok(ITEM_REASONS.includes(r), `${r} is fatal but not a reason`);
});

test("a healthy capture is ok, and ok carries no reason", () => {
  const out = classifyItemOutcome(OK);
  assert.deepEqual(out, { status: "ok", reason: null, error: null, fatal: false });
});

// --- the five defects, at the classifier ------------------------------------

test("DEFECT 2: a non-zero exit can never be an ok item, whatever the panel wrote", () => {
  const out = classifyItemOutcome({ ...OK, exitCode: 1 });
  assert.equal(out.status, "error");
  assert.equal(out.reason, "panel-exit");
  // Not fatal: a panel can crash for reasons specific to one item (an enormous
  // diff, a transient API failure), so the run continues.
  assert.equal(out.fatal, false);
});

test("DEFECT 4: a missing panel.json is its own reason, not 'no-output'", () => {
  // The order is the point. A crashed panel satisfies several checks at once, and
  // the recorded reason must name the CAUSE. A run of envelopes all saying
  // `no-output` gives nobody anything to fix.
  assert.equal(classifyItemOutcome({ ...OK, panelState: "absent", panel: null, calls: 0 }).reason, "no-panel-json");
  assert.equal(classifyItemOutcome({ ...OK, exitCode: 2, panelState: "absent", panel: null, calls: 0 }).reason, "panel-exit");
});

test("DEFECT 3: the gate assertion is soft where OFF is expected and hard where it is degradation", () => {
  // No --base-sha → gate OFF is expected TODAY (the runner materialises an archive,
  // which has no .git). Recorded, not failed on. A naive hard assert here would fail
  // every run until PR 6 lands.
  assert.equal(classifyItemOutcome({ ...OK, baseShaPassed: false, gate: { state: "off-no-base-sha", line: "x" } }).status, "ok");
  // --base-sha passed and the gate is off → the silent-degradation case, and a hard
  // error. An inert gate is safe but looks identical to "nothing was relocated".
  for (const state of ["off-base-sha-unresolved", "off-no-base-sha"]) {
    const out = classifyItemOutcome({ ...OK, baseShaPassed: true, gate: { state, line: "l" } });
    assert.equal(out.reason, "gate-degraded", `base-sha passed with gate ${state} was not a hard error`);
    assert.equal(out.fatal, true, "a misconfigured gate must stop the run, not cost 19 more items");
  }
  // The inverse cannot happen in the panel, so seeing it means the plumbing is not
  // what this module believes it is and every recorded gate state is suspect.
  assert.equal(classifyItemOutcome({ ...OK, baseShaPassed: false, gate: { state: "on", line: "l" } }).reason, "gate-degraded");
  // And silence about the gate is a drifted contract, not a passing run.
  const silent = classifyItemOutcome({ ...OK, gate: { state: "unreported", line: null } });
  assert.equal(silent.reason, "gate-unreported");
  assert.equal(silent.fatal, true);
  for (const s of GATE_STATES) assert.ok(typeof s === "string");
});

test("the gate is checked before the findings are — a gate that did not run measures nothing", () => {
  // If the gate did not run, this item is not a measurement of the shipped reviewer
  // at all, so which findings it produced is beside the point.
  const out = classifyItemOutcome({ ...OK, gate: { state: "unreported" }, calls: 0, panel: [{ id: "a", applicable: true, infraError: "429" }] });
  assert.equal(out.reason, "gate-unreported");
});

test("the routed per-lens diff is asserted, not assumed from the flag", () => {
  for (const state of ["absent", "partial"]) {
    const out = classifyItemOutcome({ ...OK, diffContent: { state, lensesWithDetail: 3, lensesWithDiff: state === "absent" ? 0 : 1 } });
    assert.equal(out.reason, "no-lens-diff");
    assert.equal(out.fatal, true, "an env misconfiguration is identical for every remaining item");
  }
  // No capture at all: nothing to over-read, so nothing to fail.
  assert.equal(classifyItemOutcome({ ...OK, diffContent: { state: "no-capture", lensesWithDetail: 0, lensesWithDiff: 0 } }).status, "ok");
  // And not asked for → not asserted.
  assert.equal(classifyItemOutcome({ ...OK, diffContentRequested: false, diffContent: { state: "absent", lensesWithDetail: 2, lensesWithDiff: 0 } }).status, "ok");
});

test("infra and no-output stay distinguishable, and infra outranks the call count", () => {
  assert.equal(classifyItemOutcome({ ...OK, panel: [{ id: "a", applicable: true, infraError: "429 quota" }], calls: 0 }).reason, "infra");
  // An inapplicable lens's infra error is not the item's: it never had to run.
  assert.equal(classifyItemOutcome({ ...OK, panel: [{ id: "a", applicable: false, infraError: "429" }] }).status, "ok");
  assert.equal(classifyItemOutcome({ ...OK, calls: 0 }).reason, "no-output");
});

// --- the flag that costs money ----------------------------------------------

test("STAGE_DETAIL_DIFF_CONTENT is on for replays, and off only when asked", () => {
  assert.equal(panelEnv({ PATH: "/x" }, { diffContent: true }).STAGE_DETAIL_DIFF_CONTENT, "1");
  assert.equal("STAGE_DETAIL_DIFF_CONTENT" in panelEnv({ PATH: "/x" }, { diffContent: false }), false);
  // The base env survives: the panel needs PATH, HOME and its credentials.
  assert.equal(panelEnv({ PATH: "/x" }, { diffContent: true }).PATH, "/x");
});

// --- the options ------------------------------------------------------------

test("--root and --corpus-version have no default, and the refusal names the fork's old flag", () => {
  // #675's rule: git history is permanent, so one forgotten flag that fell back to a
  // path inside this repository would commit run data into `wafflebase` for good.
  const none = resolveRunOptions(["node", "run.mjs"]);
  assert.equal(none.errors.length, 3);
  assert.match(none.errors.join(" "), /--root is required and has no default/);
  assert.match(none.errors.join(" "), /--corpus-version is required/);
  assert.match(resolveRunOptions(["node", "run.mjs", "--out", "/tmp/x"]).errors[0], /the fork harness called this --out/);
  assert.deepEqual(resolveRunOptions(["node", "run.mjs", "--root", "/tmp/x", "--corpus-version", "v1", "--no-cost-cap"]).errors, []);
});

test("the cost cap has no default either, and an unbounded run has to be asked for", () => {
  // THE SAME RULE AS `--root`, applied to the other irreversible thing this CLI
  // does. A forgotten `--root` writes data that cannot be unwritten; a forgotten
  // ceiling spends money that cannot be unspent, and the #521 pilot is what that
  // looks like — $44 for roughly one usable data point. The first draft of this
  // defaulted to no cap on the argument that a cap chosen for someone silently
  // truncates a legitimate run. True, and the wrong trade: a truncated run is
  // resumable under the same `--run-id` and pays for nothing twice.
  const named = ["node", "run.mjs", "--root", "/tmp/x", "--corpus-version", "v1"];
  const forgotten = resolveRunOptions(named);
  assert.equal(forgotten.errors.length, 1, "omitting the cap must be a usage error, not a default");
  assert.match(forgotten.errors[0], /--max-cost-usd <n> is required and has no default/);
  // ...and the refusal names the way out, or it just teaches people to guess.
  assert.match(forgotten.errors[0], /--no-cost-cap/);

  // Both answers are accepted, and only one of them is a number.
  const capped = resolveRunOptions([...named, "--max-cost-usd", "25"]);
  assert.deepEqual(capped.errors, []);
  assert.equal(capped.maxCostUsd, 25);
  const refused = resolveRunOptions([...named, "--no-cost-cap"]);
  assert.deepEqual(refused.errors, []);
  assert.equal(refused.maxCostUsd, null, "an explicit refusal still reads as no ceiling downstream");

  // Saying both is a contradiction, on the same rule the repo-context pair follows.
  assert.match(
    resolveRunOptions([...named, "--max-cost-usd", "25", "--no-cost-cap"]).errors.join(" "),
    /--max-cost-usd and --no-cost-cap contradict each other/,
  );
});

test("the option defaults that decide cost and fidelity are the intended ones", () => {
  const o = resolveRunOptions(["node", "run.mjs", "--root", "/tmp/x", "--corpus-version", "v1", "--no-cost-cap"]);
  // ON, now that a worktree makes it satisfiable. A diff-only replay over-flags,
  // which explodes the verifier fan-out and is what billed $44 on the #521 pilot.
  assert.equal(o.requireRepoContext, true, "an item whose tree will not materialise must not be silently replayed diff-only");
  assert.equal(o.requireRepoContextRelaxed, false);
  assert.equal(o.diffContent, true, "the routed diff must ride along, because its absence is silent");
  // A ceiling always exists. There is no invocation of this CLI that spawns a
  // panel with no upper bound on how long it may run.
  assert.equal(o.panelTimeoutMs, DEFAULT_PANEL_TIMEOUT_S * 1000);
  assert.ok(o.panelTimeoutMs > 0);
  // No ceiling here — but only because this invocation ASKED for none. There is no
  // default; the flag has its own test above.
  assert.equal(o.maxCostUsd, null);
  assert.equal(o.panelScript, path.resolve(DEFAULT_PANEL_SCRIPT));
  assert.equal(o.configId, "baseline");
  // Measured from `scripts/agent/package.json`, never a literal. The version this
  // replaces defaulted to the string "0.3.217" and wrote it into `run.json` as
  // provenance — a wrong recorded SDK version is worse than an absent one, because
  // it attributes a result to a build that never ran it.
  const pkg = JSON.parse(readFileSync(path.join(HERE, "..", "package.json"), "utf8"));
  assert.equal(o.sdkVersion, pkg.dependencies["@anthropic-ai/claude-agent-sdk"]);
  // ...and that comparison ALONE is tautological, because the pin happens to equal
  // the literal the fork hardcoded. So the file is INJECTED: the option must follow
  // what was read, which a re-hardcoded constant cannot do.
  const injected = resolveRunOptions(["node", "run.mjs", "--root", "/x", "--corpus-version", "v"], {
    readFile: () => JSON.stringify({ dependencies: { "@anthropic-ai/claude-agent-sdk": "9.9.9" } }),
  });
  assert.equal(injected.sdkVersion, "9.9.9", "sdk_version is asserted rather than measured");
  assert.equal(resolveRunOptions(["node", "run.mjs", "--root", "/x", "--corpus-version", "v", "--sdk-version", "1.2.3"]).sdkVersion, "1.2.3");
  assert.match(o.runId, /__baseline$/);
  assert.equal(resolveRunOptions(["node", "run.mjs", "--root", "/x", "--corpus-version", "v", "--no-diff-content"]).diffContent, false);
  assert.equal(resolveRunOptions(["node", "run.mjs", "--root", "/x", "--corpus-version", "v", "--no-repo-context"]).repoSource, null);
});

test("two flags about repo context resolve by rule, and contradict LOUDLY", () => {
  const opt = (...extra) => resolveRunOptions(["node", "run.mjs", "--root", "/x", "--corpus-version", "v", "--no-cost-cap", ...extra]);
  // The rule: a DEFAULT may be overridden silently, an EXPLICIT flag may not be
  // contradicted. `--no-repo-context` alone is a narrower request, not a conflict
  // — there is no tree to require — so it turns the guard off and says so.
  const diffOnly = opt("--no-repo-context");
  assert.deepEqual(diffOnly.errors, []);
  assert.equal(diffOnly.requireRepoContext, false);
  assert.equal(diffOnly.noRepoContext, true);

  // The escape hatch the flip would otherwise remove: try for a tree, degrade if
  // it is not there. Recorded on the run, because such a run may MIX fidelities.
  const relaxed = opt("--no-require-repo-context");
  assert.deepEqual(relaxed.errors, []);
  assert.equal(relaxed.requireRepoContext, false);
  assert.equal(relaxed.requireRepoContextRelaxed, true);
  assert.notEqual(relaxed.repoSource, null, "the relaxed run still tries to build the tree");

  // Stating both intentions is a usage error, in both pairs. Resolving it
  // silently either way is how a run measures something nobody asked for.
  assert.match(opt("--require-repo-context", "--no-repo-context").errors.join(" "), /contradict each other/);
  assert.match(opt("--require-repo-context", "--no-require-repo-context").errors.join(" "), /contradict each other/);
  // ...and the redundant-but-consistent case is not an error: saying the default
  // out loud is allowed.
  assert.deepEqual(opt("--require-repo-context").errors, []);
  assert.equal(opt("--require-repo-context").requireRepoContext, true);
});

test("the two spend guards validate their own inputs, and the timeout cannot be switched off", () => {
  const opt = (...extra) =>
    resolveRunOptions([
      "node", "run.mjs", "--root", "/x", "--corpus-version", "v",
      // Only when the case under test does not answer the cap itself, or the two
      // would contradict and every assertion below would pass for the wrong reason.
      ...(extra.includes("--max-cost-usd") ? [] : ["--no-cost-cap"]),
      ...extra,
    ]);
  assert.equal(opt("--panel-timeout", "90").panelTimeoutMs, 90_000);
  assert.equal(opt("--max-cost-usd", "12.5").maxCostUsd, 12.5);
  // Zero is a cap, and a meaningful one: spawn nothing.
  assert.equal(opt("--max-cost-usd", "0").maxCostUsd, 0);
  assert.deepEqual(opt("--max-cost-usd", "0").errors, []);
  // Zero is NOT a timeout. "No ceiling" is the state this guard exists to end, so
  // it is not spellable — and the refusal says why, because otherwise it is the
  // first thing anyone reaches for after one false positive.
  for (const bad of ["0", "-1", "nonsense", ""]) {
    assert.match(opt("--panel-timeout", bad).errors.join(" "), /--panel-timeout must be a positive number/, `--panel-timeout ${bad} was accepted`);
  }
  assert.match(opt("--panel-timeout", "0").errors.join(" "), /no way to disable it/);
  for (const bad of ["-1", "nonsense"]) {
    assert.match(opt("--max-cost-usd", bad).errors.join(" "), /--max-cost-usd must be a non-negative number/, `--max-cost-usd ${bad} was accepted`);
  }
});

// --- which panel ran --------------------------------------------------------

test("panel_sha is read from git, and a dirty panel is refused", () => {
  const calls = [];
  const git = (args) => {
    calls.push(args.join(" "));
    if (args.includes("rev-parse")) return ["a".repeat(40)];
    return [""];
  };
  const clean = resolvePanelSha({ panelScript: DEFAULT_PANEL_SCRIPT, git });
  assert.deepEqual(clean, { panelSha: "a".repeat(40), source: "git" });
  assert.ok(calls.some((c) => c.includes("rev-parse HEAD")));
  assert.ok(calls.some((c) => c.includes("status --porcelain")));

  // A dirty tree is not the commit it claims to be. Recording HEAD anyway is the
  // same "asserted, not measured" failure as the hardcoded sdk_version.
  assert.throws(
    () => resolvePanelSha({
      panelScript: DEFAULT_PANEL_SCRIPT,
      git: (a) => (a.includes("rev-parse") ? ["a".repeat(40)] : [" M scripts/agent/review-panel.mjs"]),
    }),
    /uncommitted change/,
  );
  // ...but the harness is not the reviewer, so editing the runner must not block a
  // replay. This is the same exclusion the README tells a reader to run by hand.
  assert.equal(
    resolvePanelSha({
      panelScript: DEFAULT_PANEL_SCRIPT,
      git: (a) => (a.includes("rev-parse") ? ["b".repeat(40)] : ["?? scripts/agent/eval/run.mjs", " M scripts/agent/eval/store.mjs"]),
    }).panelSha,
    "b".repeat(40),
  );
});

test("a panel script that is not this checkout's cannot borrow this checkout's sha", () => {
  // Replaying the stub while stamping `main`'s commit is precisely the mislabelling
  // `panel_sha` exists to prevent, so the runner insists on being told which panel
  // it is — and records that it was told (`panel_sha_source: "flag"`).
  assert.throws(() => resolvePanelSha({ panelScript: STUB, git: () => ["a".repeat(40)] }), /Pass --panel-sha/);
  assert.deepEqual(resolvePanelSha({ panelScript: STUB, override: PANEL_SHA }), { panelSha: PANEL_SHA, source: "flag" });
  for (const bad of ["abc", "A".repeat(40), "z".repeat(40), 40]) {
    assert.throws(() => resolvePanelSha({ panelScript: STUB, override: bad }), /40 lowercase hex/);
  }
  assert.throws(
    () => resolvePanelSha({ panelScript: DEFAULT_PANEL_SCRIPT, git: () => ["not-a-sha"] }),
    /is not a commit sha/,
  );
  assert.throws(
    () => resolvePanelSha({ panelScript: DEFAULT_PANEL_SCRIPT, git: () => { throw new Error("not a git repository"); } }),
    /cannot read the panel's commit/,
  );
});

// --- repo context -----------------------------------------------------------

test("repo_context_files is the same number on every replicate of one commit", () => {
  const cache = mkdtempSync(path.join(tmpdir(), "eval-repo-cache-test-"));
  const src = mkdtempSync(path.join(tmpdir(), "eval-repo-src-test-"));
  try {
    // The version this replaces wrote its marker INSIDE the tree and counted before
    // the write on first materialisation, after it on every cache hit — so the same
    // commit reported N and then N+1, and a scorer segmenting on the field would
    // split one population in two.
    const commit = "c".repeat(40);
    const dest = path.join(cache, commit);
    mkdirSync(dest, { recursive: true });
    writeFileSync(path.join(dest, "a.txt"), "a");
    writeFileSync(path.join(dest, "b.txt"), "b");
    // The marker says 2. The tree holds THREE files, the third standing in for
    // whatever appears in a cache directory that outlives one run — the fork's own
    // `.materialized` was exactly such a file. A cache hit that re-walked the tree
    // would answer 3 where the first materialisation answered 2, which is the N vs
    // N+1 drift; reading the RECORDED count answers 2 on every replicate.
    writeFileSync(path.join(dest, "c.txt"), "c");
    writeFileSync(`${dest}.materialized`, `${commit} 2\n`);
    const first = materializeRepoAt({ repoSource: src, commit, cacheRoot: cache });
    const second = materializeRepoAt({ repoSource: src, commit, cacheRoot: cache });
    assert.equal(first.files, 2, "the count came from a fresh walk rather than from what the first materialisation recorded");
    assert.equal(second.files, 2, "the cache hit counted a different number of files than the first materialisation");
    // And the marker is not inside the tree the panel reads, so our own bookkeeping
    // cannot be part of the count in the first place.
    assert.equal(existsSync(path.join(dest, ".materialized")), false);
    assert.ok(statSync(`${dest}.materialized`).isFile());
  } finally {
    rmSync(cache, { recursive: true, force: true });
    rmSync(src, { recursive: true, force: true });
  }
});

test("materialising a real commit from an EMPTY cache counts what it extracted", () => {
  // The test above pre-fabricates a cache hit, so the extraction path itself — `git
  // archive` into a tar, `tar -xf` into place, count, record — was never once
  // exercised by the suite. Real git in a temp repo, the same idiom
  // `novelty.test.mjs` and `git-env.test.mjs` already use.
  const cache = mkdtempSync(path.join(tmpdir(), "eval-repo-cache-test-"));
  const src = mkdtempSync(path.join(tmpdir(), "eval-repo-src-test-"));
  // `fixtureGitEnv`, NOT the ambient environment — the same helper
  // `novelty.test.mjs`, `git-env.test.mjs` and `collect-captures.test.mjs` already
  // use for their fixture repos, and this was the only site that did not.
  //
  // `cwd` alone does not scope git. When the suite runs inside a git hook — which is
  // what `pre-push` does — git exports `GIT_DIR` and `GIT_INDEX_FILE` into the
  // environment, and those OVERRIDE `cwd`. So this helper operated on the real
  // repository: it added `a.mjs`/`b.mjs` to the developer's index and committed them
  // as `t <t@t> "two files"`, then the test's `rm -rf` of its temp dir left every
  // tracked file reading as deleted. Observed exactly that on this branch.
  //
  // Two consequences, both bad: `pnpm verify:self` fails from inside any hook, so
  // `git push` is blocked for everyone; and a test suite writes commits into the
  // repository it is testing.
  const git = (...a) =>
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...a], {
      cwd: src,
      env: fixtureGitEnv(src),
      stdio: "pipe",
      encoding: "utf8",
    });
  try {
    git("init", "--quiet");
    writeFileSync(path.join(src, "a.mjs"), "export const a = 1;\n");
    writeFileSync(path.join(src, "b.mjs"), "export const b = 2;\n");
    git("add", "a.mjs", "b.mjs");
    git("commit", "--quiet", "-m", "two files");
    const commit = git("rev-parse", "HEAD").trim();

    const first = materializeRepoAt({ repoSource: src, commit, cacheRoot: cache });
    assert.equal(first.error, null);
    assert.equal(first.files, 2, "the extracted tree did not hold the commit's two files");
    assert.ok(existsSync(path.join(first.path, "a.mjs")));
    // The marker is a SIBLING of the tree, so it is not one of the files counted —
    // which is the whole of the N vs N+1 fix.
    assert.equal(existsSync(path.join(first.path, ".materialized")), false);
    assert.ok(existsSync(`${first.path}.materialized`));
    // And the cache hit answers the same number, on a tree that really was extracted
    // rather than one a test wrote by hand.
    assert.equal(materializeRepoAt({ repoSource: src, commit, cacheRoot: cache }).files, first.files);
  } finally {
    rmSync(cache, { recursive: true, force: true });
    rmSync(src, { recursive: true, force: true });
  }
});

// --- the worktree, and whether it can actually be blamed ---------------------

test("THE FIDELITY CLAIM: the materialised tree is one the real novelty gate can run in", async () => {
  // The whole of this change, asserted against the REAL functions the panel
  // calls rather than against a stub's canned gate line. `baseResolves` is
  // literally what `review-panel.mjs` calls before printing `novelty gate: on`,
  // and `noveltyOf` is what decides the lane a blocking finding is routed on.
  const src = tempGitRepo();
  const cache = mkdtempSync(path.join(tmpdir(), "eval-worktrees-test-"));
  try {
    const mat = materializeRepoAt({ repoSource: src.dir, commit: src.head, cacheRoot: cache });
    assert.equal(mat.error, null, `the worktree did not materialise: ${mat.error}`);

    // 1. The base resolves. This is the exact predicate, with the exact argument
    //    order, that gates the panel's `novelty gate: on` line.
    assert.equal(await baseResolves(mat.path, src.base), true, "the panel would print `novelty gate: OFF — does not resolve`");

    // 2. And blame answers. This is the part a resolving base does NOT imply.
    const novelty = await noveltyOf({ repo: mat.path, file: "src/a.mjs", line: 3, baseSha: src.base });
    assert.notEqual(novelty.origin, "unknown", `blame answered nothing in the materialised tree: ${JSON.stringify(novelty)}`);
    assert.equal(novelty.addedBy, src.head, "blame attributed the changed line to the wrong commit");

    // 3. THE CONTRAST, which is the mutation baked in: the tree this replaces was
    //    a `git archive`, and in one of those both answers above are negative. So
    //    reverting `materializeRepoAt` to an archive cannot leave this test green.
    const archived = path.join(cache, "as-an-archive");
    mkdirSync(archived, { recursive: true });
    const tar = path.join(cache, "t.tar");
    src.git("archive", "--format=tar", "-o", tar, src.head);
    execFileSync("tar", ["-xf", tar, "-C", archived], { stdio: "pipe" });
    assert.ok(existsSync(path.join(archived, "src", "a.mjs")), "the contrast tree is not a tree");
    assert.equal(existsSync(path.join(archived, ".git")), false, "an archive is supposed to have no .git — that was the whole problem");
    assert.equal(await baseResolves(archived, src.base), false, "an archived tree resolved a base sha, so this test cannot detect the regression it exists for");
    assert.equal((await noveltyOf({ repo: archived, file: "src/a.mjs", line: 3, baseSha: src.base })).origin, "unknown");
  } finally {
    cleanupRepoCache(src.dir, cache);
    src.cleanup();
  }
});

test("THE TRANSITION: `lane: \"backlog\"` is reachable in a replay, and was not before", async () => {
  // The sharpest statement of what changed, and it needs the gate's own router
  // rather than a claim about the gate line. What was NEVER true of a replay is
  // not "findings carried no lane" — `routeFinding` returns `blocking` when
  // novelty is `unknown`, so every replayed finding was labelled `blocking`,
  // which looks exactly like a correct answer. What could not occur is the
  // DEMOTION: `backlog` requires `DEMOTING_ORIGINS` to match, which requires
  // `relocated`, which requires a `git blame` of a tree that has a `.git`.
  //
  // So a replay against an archived tree did not merely lack information — it
  // silently answered the gate's question WRONG, in the one direction that
  // reads as normal, on every relocated finding in the corpus.
  const src = tempGitRepo();
  const cache = mkdtempSync(path.join(tmpdir(), "eval-worktrees-test-"));
  try {
    const mat = materializeRepoAt({ repoSource: src.dir, commit: src.head, cacheRoot: cache });
    const finding = { severity: "major", file: "src/moved.mjs", line: 1, summary: "the moved helper is wrong" };

    // In the WORKTREE: git can see that this line's content predates the base,
    // so the gate demotes it. This is `lane: "backlog"`, produced end to end by
    // the real prober and the real router.
    const inWorktree = await noveltyOf({ repo: mat.path, file: "src/moved.mjs", line: 1, baseSha: src.base });
    assert.equal(inWorktree.origin, "relocated", `the fixture did not produce a relocation: ${JSON.stringify(inWorktree)}`);
    assert.equal(routeFinding(finding, { novelty: inWorktree }), "backlog");

    // In an ARCHIVE — the tree every replay used to get — the same line, the same
    // base and the same router answer `blocking`. Same finding, same code, two
    // different gate decisions, and only one of them is what shipped.
    const archived = path.join(cache, "as-an-archive");
    mkdirSync(archived, { recursive: true });
    const tar = path.join(cache, "t.tar");
    src.git("archive", "--format=tar", "-o", tar, src.head);
    execFileSync("tar", ["-xf", tar, "-C", archived], { stdio: "pipe" });
    const inArchive = await noveltyOf({ repo: archived, file: "src/moved.mjs", line: 1, baseSha: src.base });
    assert.equal(inArchive.origin, "unknown");
    assert.equal(
      routeFinding(finding, { novelty: inArchive }),
      "blocking",
      "the archived tree did not route this to blocking, so the transition this test claims is not the one being measured",
    );
  } finally {
    cleanupRepoCache(src.dir, cache);
    src.cleanup();
  }
});

test("a review_commit that is not a sha is refused BEFORE it becomes a path", () => {
  // `commit` is interpolated into `dest`, and `dest` is later handed to
  // `git worktree remove --force` and to `rmSync(..., { recursive: true })`. The
  // safety argument for that teardown is that it only ever addresses paths under
  // this run's own `mkdtemp` root, and a `..` in the commit is what would break
  // it. `validateCorpusItem` refuses a non-sha `review_commit` at the store's
  // WRITE path — this is the read-path backstop, the same one `review_base` gets,
  // because the corpus is a separate hand-committed repository.
  const src = tempGitRepo();
  const cache = mkdtempSync(path.join(tmpdir(), "eval-worktrees-test-"));
  // A real directory a traversing value would resolve onto. If the guard is
  // removed, `removeWorktreeAt` reaches this with `rmSync` and it stops existing.
  const sibling = path.join(path.dirname(cache), `${path.basename(cache)}-neighbour`);
  mkdirSync(path.join(sibling, "precious"), { recursive: true });
  try {
    for (const bad of [`../${path.basename(sibling)}`, "HEAD", src.head.slice(0, 12), src.head.toUpperCase(), ""]) {
      const mat = materializeRepoAt({ repoSource: src.dir, commit: bad, cacheRoot: cache });
      assert.equal(mat.path, null, `commit ${JSON.stringify(bad)} was materialised`);
      assert.equal(mat.files, 0);
      assert.ok(mat.error, `commit ${JSON.stringify(bad)} produced no error`);
    }
    // Not "an error was returned" — nothing outside the cache root was touched.
    assert.equal(existsSync(path.join(sibling, "precious")), true, "a traversing review_commit reached a path outside the run's own root");
    // ...and a short sha or an uppercase one is refused for FIDELITY, not safety:
    // both resolve in git, and either would key the cache by a string that is not
    // the frozen commit. The message says what to do about it.
    assert.match(
      materializeRepoAt({ repoSource: src.dir, commit: src.head.slice(0, 12), cacheRoot: cache }).error,
      /40 lowercase hex characters/,
    );
    // The real sha still works, so the guard is not simply refusing everything.
    assert.ok(materializeRepoAt({ repoSource: src.dir, commit: src.head, cacheRoot: cache }).path);
  } finally {
    cleanupRepoCache(src.dir, cache);
    rmSync(sibling, { recursive: true, force: true });
    src.cleanup();
  }
});

test("the materialised tree is a REGISTERED worktree, and cleanup deregisters exactly it", () => {
  const src = tempGitRepo();
  const cache = mkdtempSync(path.join(tmpdir(), "eval-worktrees-test-"));
  try {
    const mat = materializeRepoAt({ repoSource: src.dir, commit: src.head, cacheRoot: cache });
    // A linked worktree's `.git` is a FILE holding a `gitdir:` pointer. If this is
    // a directory, something checked out a whole second repository.
    assert.ok(statSync(path.join(mat.path, ".git")).isFile(), ".git is not a worktree pointer file");
    assert.equal(src.git("-C", mat.path, "rev-parse", "HEAD").trim(), src.head, "HEAD is not at the review commit, so blame would date every line against the wrong tree");
    const listed = () => src.git("worktree", "list", "--porcelain");
    assert.ok(listed().includes(mat.path), "the tree is not registered as a worktree in the source repo");

    // Deregistered, not merely deleted. A worktree lives in the SOURCE repo's
    // `.git`, so `rmSync` alone would leave administrative state in somebody
    // else's clone after every run.
    assert.equal(cleanupRepoCache(src.dir, cache), 1);
    assert.equal(existsSync(mat.path), false);
    assert.equal(existsSync(cache), false);
    assert.equal(listed().includes(mat.path), false, "the worktree entry survived cleanup");
    // Idempotent: an aborted run and a normal one both reach this path.
    assert.equal(cleanupRepoCache(src.dir, cache), 0);
  } finally {
    src.cleanup();
  }
});

test("git's own pointer file is NOT counted, or an empty checkout would satisfy the guard", () => {
  // `--require-repo-context` fires on `contextFiles === 0`. A worktree's `.git`
  // pointer is a real file in the tree, so counting it would make an empty
  // checkout report 1 and the guard would never fire again — configured, on, and
  // inert. That is the exact shape of failure `assertEffort` already shipped.
  const src = tempGitRepo();
  const cache = mkdtempSync(path.join(tmpdir(), "eval-worktrees-test-"));
  try {
    const mat = materializeRepoAt({ repoSource: src.dir, commit: src.head, cacheRoot: cache });
    assert.ok(existsSync(path.join(mat.path, ".git")), "there is no pointer file to exclude, so this test proves nothing");
    // The fixture's second commit holds exactly three files.
    assert.equal(mat.files, 3, "the count includes git's bookkeeping");
  } finally {
    cleanupRepoCache(src.dir, cache);
    src.cleanup();
  }
});

test("the same commit materialised twice gives an identical path and an identical count", () => {
  // K replicates of one item must not disagree about a fidelity field: a scorer
  // segmenting on `repo_context_files` would split one population in two.
  const src = tempGitRepo();
  const cache = mkdtempSync(path.join(tmpdir(), "eval-worktrees-test-"));
  try {
    const first = materializeRepoAt({ repoSource: src.dir, commit: src.head, cacheRoot: cache });
    const second = materializeRepoAt({ repoSource: src.dir, commit: src.head, cacheRoot: cache });
    assert.equal(first.error, null);
    assert.equal(second.error, null);
    assert.equal(second.path, first.path, "two items at one commit built two different trees");
    assert.equal(second.files, first.files);
    // And the second call is a CACHE HIT rather than a second `worktree add`,
    // which would have failed on an existing directory.
    assert.equal(src.git("worktree", "list", "--porcelain").split(/\n/).filter((l) => l.startsWith("worktree ")).length, 2);
  } finally {
    cleanupRepoCache(src.dir, cache);
    src.cleanup();
  }
});

test("a review commit the clone does not have is refused with the fetch that fixes it", () => {
  // The normal state, not an edge case: `wafflebase` squash-merges so a PR head is
  // never reachable from `main`, `extract-corpus` fetches it to `refs/eval/pr/<n>`
  // to freeze the item, and the freeze plan's cleanup step deletes those refs.
  const src = tempGitRepo();
  const cache = mkdtempSync(path.join(tmpdir(), "eval-worktrees-test-"));
  try {
    const gone = materializeRepoAt({ repoSource: src.dir, commit: "f".repeat(40), cacheRoot: cache, sourcePr: 471 });
    assert.equal(gone.path, null);
    assert.equal(gone.files, 0);
    assert.match(gone.error, /is not in /);
    // The remedy is the point. A refusal a reader cannot act on is a refusal that
    // gets worked around by turning the guard off.
    assert.match(gone.error, /refs\/pull\/471\/head:refs\/eval\/pr\/471/, "the refusal does not name the fetch that fixes it");
    // Nothing was built, and nothing was registered, on the way to finding out.
    assert.equal(existsSync(path.join(cache, "f".repeat(40))), false);
    assert.equal(src.git("worktree", "list", "--porcelain").split(/\n/).filter((l) => l.startsWith("worktree ")).length, 1);
    // With no PR number the message still names a runnable command.
    const anon = materializeRepoAt({ repoSource: src.dir, commit: "e".repeat(40), cacheRoot: cache });
    assert.match(anon.error, /git -C .* fetch origin e{40}/);
  } finally {
    cleanupRepoCache(src.dir, cache);
    src.cleanup();
  }
});

test("a tree that will not materialise degrades to a named failure, never to a bare null", () => {
  const cache = mkdtempSync(path.join(tmpdir(), "eval-repo-cache-test-"));
  try {
    // The docstring of the version this replaces promised `null`; its catch branch
    // returned an object, so `ctx?.path` was load-bearing in a way nothing stated.
    for (const args of [{ commit: null, repoSource: "/x" }, { commit: "d".repeat(40), repoSource: null }]) {
      const out = materializeRepoAt({ ...args, cacheRoot: cache });
      assert.equal(out.path, null);
      assert.equal(out.files, 0);
      assert.ok(out.error);
    }
    const bad = materializeRepoAt({ repoSource: cache, commit: "e".repeat(40), cacheRoot: cache });
    assert.equal(bad.path, null);
    assert.ok(bad.error, "git's own stderr must survive — a silent 0-file checkout is how the pilot billed $44");
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
});

// --- run totals -------------------------------------------------------------

test("a run's duration is summed only over the items that HAVE one, and carries its n", () => {
  const stub = {
    getItem: (_r, id) => ({
      "a": { envelope: { status: "ok", cost_usd: 1, duration_ms: 1000, sdk_duration_ms_sum: 5000, calls: 2, turns: 1 } },
      "b": { envelope: { status: "ok", cost_usd: 2, duration_ms: null, sdk_duration_ms_sum: 9000, calls: 3, turns: 1 } },
      "c": { envelope: { status: "error", reason: "panel-exit", cost_usd: 0, duration_ms: null, sdk_duration_ms_sum: 0, calls: 0, turns: 0 } },
      "d": null,
    }[id]),
  };
  const s = summarizeRun(stub, "r", ["a", "b", "c", "d"]);
  // Treating an unknown wall-clock as zero would make a run of ten items with three
  // timings look three times as fast as it was.
  assert.equal(s.totals.duration_ms, 1000);
  assert.equal(s.totals.duration_items, 1);
  assert.equal(s.totals.sdk_duration_ms_sum, 14000, "the flat SDK sum is kept, under a name that is not a duration");
  assert.equal(s.items_ok, 2);
  assert.equal(s.items_error, 1);
  assert.equal(s.items_present, 3);
  assert.equal(s.complete, false);
});

// --- end to end -------------------------------------------------------------

test("END TO END: a lane and a novelty on a verdict finding reach the stored envelope intact", async () => {
  const c = tempCorpus();
  try {
    const { code } = await runCli(c.root, {
      lenses: [{
        id: "correctness",
        lensDiff: DIFF,
        stageDetail: { samples: [[]], verifications: [] },
        findings: [{
          severity: "major",
          file: "scripts/agent/x.mjs",
          summary: "the retry loop can spin forever",
          evidence: "x.mjs:41",
          lane: "backlog",
          novelty: { origin: "relocated", basis: "blame" },
        }],
      }],
    });
    assert.equal(code, 0);
    const runId = runIdOf(c.root);
    const got = c.store.getItem(runId, c.itemId);
    assert.equal(got.envelope.status, "ok");
    assert.equal(got.envelope.reason, null);
    // The pair (config_hash, panel_sha) is what "same reviewer" means.
    assert.match(got.envelope.panel_sha, SHA40);
    assert.equal(got.envelope.panel_sha, PANEL_SHA);
    assert.equal(got.envelope.panel_sha_source, "flag");
    assert.match(got.envelope.config_hash, /^sha256:[0-9a-f]{64}$/);
    // The gate state is recorded even though it is OFF, which is the whole point:
    // a scorer that cannot tell a run that had the gate from one that did not
    // will pool them.
    assert.equal(got.envelope.gate.state, "off-no-base-sha");
    assert.equal(got.envelope.base_sha_passed, false);
    assert.equal(got.envelope.duration_source, "review-timing.json");
    assert.equal(got.envelope.duration_ms, 30000);
    assert.equal(got.envelope.transcript.state, "absent");
    const f = got.payload.findings[0];
    assert.equal(f.lane, "backlog", "the lane did not survive the lane");
    assert.deepEqual(f.novelty, { origin: "relocated", basis: "blame" });
    assert.equal(f.lens, "correctness");
    // The routed diff the lens read is in the capture, asserted rather than assumed.
    assert.equal(got.payload.stageDetail.correctness.lensDiff, DIFF);
    assert.equal(got.envelope.diff_content.state, "complete");
    const run = c.store.getRun(runId);
    assert.equal(run.runJson.status, "complete");
    assert.equal(run.runJson.items_ok, 1);
    assert.equal(run.runJson.panel_sha, PANEL_SHA);
    assert.ok(run.configSnapshot.lenses.length > 0);
  } finally {
    c.cleanup();
  }
});

test("END TO END: running twice re-runs nothing and changes not one byte", async () => {
  const c = tempCorpus();
  try {
    const first = await runCli(c.root, {}, ["--run-id", "fixed-run"]);
    assert.equal(first.code, 0);
    const dir = path.join(c.root, "runs", "fixed-run", "items", c.itemId);
    const before = readdirSync(dir).sort().map((f) => [f, readFileSync(path.join(dir, f), "utf8")]);
    const second = await runCli(c.root, {}, ["--run-id", "fixed-run"]);
    assert.equal(second.code, 0);
    assert.ok(second.logs.some((l) => l.includes("already stored, not re-run")), second.logs.join("\n"));
    const after = readdirSync(dir).sort().map((f) => [f, readFileSync(path.join(dir, f), "utf8")]);
    assert.deepEqual(after, before, "a resumed run rewrote a stored item — every replay is money and every envelope is immutable");
  } finally {
    c.cleanup();
  }
});

test("END TO END: a panel that exits 1 is stored as an error and the run exits non-zero", async () => {
  const c = tempCorpus();
  try {
    const { code } = await runCli(c.root, { exitCode: 1 });
    assert.equal(code, 1);
    const got = c.store.getItem(runIdOf(c.root), c.itemId);
    assert.equal(got.envelope.status, "error");
    assert.equal(got.envelope.reason, "panel-exit");
    assert.equal(got.envelope.exit_code, 1);
    // Recorded, not thrown away: the evidence is what makes it fixable.
    assert.equal(got.payload.exit_code, 1);
  } finally {
    c.cleanup();
  }
});

test("END TO END: a panel that writes no panel.json is an error, not a clean review", async () => {
  const c = tempCorpus();
  try {
    const { code } = await runCli(c.root, { omit: ["panel.json"] });
    assert.equal(code, 1);
    const got = c.store.getItem(runIdOf(c.root), c.itemId);
    assert.equal(got.envelope.status, "error");
    assert.equal(got.envelope.reason, "no-panel-json");
    assert.equal(got.payload.findings, null, "zero findings and no findings must not share a shape");
  } finally {
    c.cleanup();
  }
});

test("END TO END: a run whose gate silently did not run aborts instead of spending on the rest", async () => {
  const c = tempCorpus();
  try {
    const { code, logs } = await runCli(c.root, { gate: "none" });
    assert.equal(code, 1);
    const runId = runIdOf(c.root);
    const got = c.store.getItem(runId, c.itemId);
    assert.equal(got.envelope.reason, "gate-unreported");
    // The failing item is STORED and THEN the run stops — one replay's worth of
    // evidence, and no money spent on nineteen more items that would fail the same way.
    assert.ok(logs.some((l) => l.includes("ABORTED")), logs.join("\n"));
    assert.equal(c.store.getRun(runId).runJson.status, "aborted");
    assert.match(c.store.getRun(runId).runJson.notes, /gate-unreported/);
  } finally {
    c.cleanup();
  }
});

test("END TO END: a capture missing the routed per-lens diff aborts the run", async () => {
  const c = tempCorpus();
  try {
    // Not ASKING for the routed diff is not the same as asking and not getting it —
    // the first is a deliberate choice, the second is the silent substitution.
    const { code } = await runCli(c.root, {}, ["--no-diff-content"]);
    assert.equal(code, 0);
    const c2 = tempCorpus();
    try {
      // `lensDiffMode: "never"` is a panel that does not write `lensDiff` whatever
      // the flag says — a pre-#644 panel, or an env that did not propagate. The
      // runner set the flag and the capture came back without it, which is exactly
      // the case a flag whose absence is silent has to be asserted against.
      const r = await runCli(c2.root, { lensDiffMode: "never" });
      assert.equal(r.code, 1);
      assert.equal(c2.store.getItem(runIdOf(c2.root), c2.itemId).envelope.reason, "no-lens-diff");
      assert.equal(c2.store.getRun(runIdOf(c2.root)).runJson.status, "aborted");
    } finally {
      c2.cleanup();
    }
  } finally {
    c.cleanup();
  }
});

test("END TO END: --require-repo-context stores a zero-cost error and spawns nothing", async () => {
  // The one guard the $44 postmortem produced, and the only path that reaches
  // `GATE_NOT_RUN`: the panel is never spawned, so no reported gate state could be
  // honest. `review_commit` is a real-shaped sha that resolves in no repository.
  // A sha no repository can hold, because `materializeRepoAt`'s commit cache lives
  // under `tmpdir()` and is SHARED across runs and processes: reusing the fixture's
  // usual `review_commit` made this test pass or fail depending on whether some
  // earlier run had already materialised it. A test whose result depends on another
  // process's leftovers is not testing what it says.
  const c = tempCorpus({ reviewCommit: "d".repeat(40) });
  try {
    const { code, logs } = await runCli(c.root, {}, [
      "--require-repo-context",
      "--repo-source", c.root,
    ], { noRepoContext: false });
    assert.equal(code, 1);
    const got = c.store.getItem(runIdOf(c.root), c.itemId);
    assert.equal(got.envelope.status, "error");
    assert.equal(got.envelope.reason, "no-repo-context");
    assert.equal(got.envelope.repo_context_files, 0);
    assert.equal(got.envelope.gate.state, GATE_NOT_RUN);
    // Zero cost is the point: the guard refuses BEFORE the money is spent.
    assert.equal(got.envelope.cost_usd, 0);
    assert.equal(got.envelope.calls, 0);
    assert.equal(got.envelope.duration_ms, null);
    assert.equal(got.envelope.duration_source, "not-run");
    assert.ok(logs.some((l) => l.includes("no model calls")), logs.join("\n"));
  } finally {
    c.cleanup();
  }
});

// --- the gate, end to end, against a tree that can answer --------------------

test("END TO END: a real worktree, --base-sha from the item, and a gate that is ON", async () => {
  // The whole change in one run: a frozen corpus item, a worktree at its
  // `review_commit`, its `review_base` passed as `--base-sha`, and an envelope
  // that records the gate as `on`. Before this, every replay recorded
  // `off-no-base-sha`.
  const src = tempGitRepo();
  const c = tempCorpus({ reviewCommit: src.head, reviewBase: src.base });
  try {
    const { code, logs } = await runCli(c.root, {}, ["--repo-source", src.dir], { noRepoContext: false });
    assert.equal(code, 0, logs.join("\n"));
    const got = c.store.getItem(runIdOf(c.root), c.itemId);
    assert.equal(got.envelope.status, "ok", JSON.stringify(got.envelope.error));
    assert.equal(got.envelope.gate.state, "on", "the replayed gate is still not the shipped gate");
    assert.equal(got.envelope.base_sha_passed, true);
    // The panel ECHOED the base it was given, so this asserts the VALUE survived
    // the argv round trip into the child — stronger than reading back the array
    // the adapter built, which an audit could re-derive without a subprocess.
    assert.ok(got.envelope.gate.line.includes(src.base), `the panel was given a different base: ${got.envelope.gate.line}`);
    assert.equal(got.envelope.repo_context_files, 3, "the lens read no surrounding code");
    // A `backlog` finding survives the whole lane into the stored payload. The
    // stub supplies the lane rather than computing it — only the real panel can
    // do that — but the lane's SURVIVAL is this harness's job, and it is the
    // field that cannot be recovered later, because the tree is gone after merge.
    assert.equal(got.payload.findings[0].lane, "backlog");
    const run = c.store.getRun(runIdOf(c.root));
    assert.equal(run.runJson.repo_context, "tree");
    assert.equal(run.runJson.status, "complete");
    // And the worktree does not outlive the run: it was registered in the source
    // repository, so leaving it is administrative state in someone else's clone.
    assert.equal(src.git("worktree", "list", "--porcelain").split(/\n/).filter((l) => l.startsWith("worktree ")).length, 1);
  } finally {
    c.cleanup();
    src.cleanup();
  }
});

test("END TO END: --base-sha reaches the panel's argv, and dropping it is what gate-degraded catches", async () => {
  // The two halves of #682's assertion, now that both are reachable. `baseResolves:
  // false` is a panel that was handed a base and could not use it — the silent
  // degradation case — and it must ABORT rather than record a gate-off replay.
  const src = tempGitRepo();
  const c = tempCorpus({ reviewCommit: src.head, reviewBase: src.base });
  try {
    const { code, logs } = await runCli(c.root, { baseResolves: false }, ["--repo-source", src.dir], { noRepoContext: false });
    assert.equal(code, 1);
    const runId = runIdOf(c.root);
    const got = c.store.getItem(runId, c.itemId);
    assert.equal(got.envelope.reason, "gate-degraded");
    assert.equal(got.envelope.gate.state, "off-base-sha-unresolved");
    assert.ok(logs.some((l) => l.includes("ABORTED")), logs.join("\n"));
    assert.equal(c.store.getRun(runId).runJson.status, "aborted");

    // The failed item keeps its raw output, and that is where the child's own
    // record of what it was told lives. Asserting the FLAG against the stub's
    // `stub-argv.json` turns "the runner passes --base-sha" from an intention
    // into a contract observed from the other side of a subprocess boundary.
    const line = logs.find((l) => l.includes("raw panel output kept at"));
    assert.ok(line, logs.join("\n"));
    const outDir = line.slice(line.indexOf("kept at ") + "kept at ".length).trim();
    const argv = JSON.parse(readFileSync(path.join(outDir, "stub-argv.json"), "utf8"));
    assert.ok(argv.includes("--base-sha"), `the panel was never given --base-sha: ${argv.join(" ")}`);
    assert.equal(argv[argv.indexOf("--base-sha") + 1], src.base, "the base passed was not the item's frozen review_base");
    rmSync(path.dirname(outDir), { recursive: true, force: true });
  } finally {
    c.cleanup();
    src.cleanup();
  }
});

test("END TO END: an item with no usable review_base is refused, NOT replayed with the gate off", async () => {
  // The failure mode `gate-degraded` cannot see, because it fires on a base that
  // was PASSED and did not take. With nothing passed there is nothing to
  // disagree with, so a fallback here would look clean forever — and would be a
  // silent return to exactly the gate-off replay this change ends.
  //
  // THE FIXTURE WRITES `meta.json` BY HAND, and that is the scenario rather than
  // a shortcut: `validateCorpusItem` already refuses this at the store's WRITE
  // path — `putCorpusItem` would throw before the runner ever saw it — while
  // `getCorpusItemInput` does not re-validate what it READS. The corpus is a
  // separate, hand-committed repository, so the read door is a real door. This
  // test only exists because the write-path validator does not stand in it.
  const src = tempGitRepo();
  for (const bad of ["", null, "not-a-sha", "F".repeat(40)]) {
    const c = tempCorpus({ reviewCommit: src.head });
    try {
      const metaPath = path.join(c.root, "corpus", "items", c.itemId, "meta.json");
      const meta = JSON.parse(readFileSync(metaPath, "utf8"));
      assert.match(meta.review_base, SHA40, "the store accepted an invalid review_base, so this fixture is not the case it claims");
      writeFileSync(metaPath, JSON.stringify({ ...meta, review_base: bad }, null, 2));

      const { code, logs } = await runCli(c.root, {}, ["--repo-source", src.dir], { noRepoContext: false });
      assert.equal(code, 1);
      const got = c.store.getItem(runIdOf(c.root), c.itemId);
      assert.equal(got.envelope.reason, "no-base-sha", `review_base ${JSON.stringify(bad)} was accepted`);
      assert.equal(got.envelope.gate.state, GATE_NOT_RUN, "no panel ran, so no reported gate state could be honest");
      // Zero cost: refused BEFORE the spawn, which is the only kind of guard that
      // is worth anything on a tool that spends money.
      assert.equal(got.envelope.cost_usd, 0);
      assert.equal(got.envelope.calls, 0);
      assert.ok(logs.some((l) => l.includes("no model calls")), logs.join("\n"));
    } finally {
      c.cleanup();
    }
  }
  src.cleanup();
});

test("END TO END: a base that does not resolve in the tree is refused for free, before the spawn", async () => {
  // A base sha shaped correctly and absent from the clone. `gate-degraded` would
  // catch this too — after a full panel spawn has been paid for. This asks the
  // same question with the same predicate for nothing, and the case it is really
  // for is a SHALLOW clone, which is CI's default checkout.
  const src = tempGitRepo();
  const c = tempCorpus({ reviewCommit: src.head, reviewBase: "a".repeat(40) });
  try {
    const { code, logs } = await runCli(c.root, {}, ["--repo-source", src.dir], { noRepoContext: false });
    assert.equal(code, 1);
    const got = c.store.getItem(runIdOf(c.root), c.itemId);
    assert.equal(got.envelope.reason, "base-unresolved");
    assert.equal(got.envelope.cost_usd, 0);
    assert.equal(got.envelope.calls, 0);
    assert.equal(got.envelope.gate.state, GATE_NOT_RUN);
    assert.match(got.envelope.error.message, /unshallow/, "the refusal does not name the usual cause or its remedy");
    assert.ok(logs.some((l) => l.includes("no model calls")), logs.join("\n"));
  } finally {
    c.cleanup();
    src.cleanup();
  }
});

test("END TO END: a deliberate diff-only run passes no base, and that is not a degradation", async () => {
  // The one place `off-no-base-sha` is still the honest answer. It must not
  // become `no-base-sha`: the operator asked for a lower-fidelity replay and got
  // one, and the run records which it was. The item's `review_base` is perfectly
  // good here — it is simply not asked for, because there is no tree to use it in.
  const c = tempCorpus();
  try {
    const { code } = await runCli(c.root, {});
    assert.equal(code, 0);
    const got = c.store.getItem(runIdOf(c.root), c.itemId);
    assert.equal(got.envelope.status, "ok");
    assert.equal(got.envelope.gate.state, "off-no-base-sha");
    assert.equal(got.envelope.base_sha_passed, false);
    assert.equal(c.store.getRun(runIdOf(c.root)).runJson.repo_context, "diff-only");
  } finally {
    c.cleanup();
  }
});

test("END TO END: --no-require-repo-context degrades instead of refusing, and the run SAYS it may be mixed", async () => {
  // The escape hatch, and the reason it is recorded: such a run can hold items of
  // two different fidelities, and pooling those is averaging two reviewers.
  const c = tempCorpus({ reviewCommit: "d".repeat(40) });
  try {
    const { code } = await runCli(c.root, {}, ["--no-require-repo-context", "--repo-source", c.root], { noRepoContext: false });
    // The item still replays — diff-only, because the tree is not there.
    const got = c.store.getItem(runIdOf(c.root), c.itemId);
    assert.equal(got.envelope.reason, null, "the relaxed run refused an item anyway");
    assert.equal(got.envelope.status, "ok");
    assert.equal(got.envelope.repo_context_files, 0);
    assert.equal(code, 0);
    assert.equal(c.store.getRun(runIdOf(c.root)).runJson.repo_context, "tree-optional");
  } finally {
    c.cleanup();
  }
});

// --- the result channel ------------------------------------------------------

test("END TO END: the progress heartbeat reaches stderr and NOTHING reaches stdout", async () => {
  // This file drives `main` in-process, so under `node --test` this process's
  // stdout is the runner's result channel: v8-serialized frames the parent parses
  // in `#processRawBuffer`. That parser re-checks for the `0xFF 0x0F` magic only
  // at the top of a call, so plain text sitting behind a frame in the same read
  // chunk is read as the next frame's 4-byte length — a large one stalls the
  // stream and loses this file's remaining results, a small one deserializes
  // garbage and throws `Unable to deserialize cloned data` in the parent. That is
  // the `agent:tests` flake, and `run.mjs`'s heartbeat was its only source: the
  // captured stream of this file carried 931 bytes of it, and nothing else.
  //
  // BOTH directions are asserted on purpose. Deleting the heartbeat would satisfy
  // "stdout is clean" while removing the progress a minutes-long run exists to
  // show, so the stderr assertion is what stops the cheap way out. `logs` is not
  // the check: `runCli` redirects `console.log`, which the heartbeat never used.
  const c = tempCorpus();
  const seen = [];
  const realOut = process.stdout.write;
  const realErr = process.stderr.write;
  // stdout is TEED, never swallowed — a patch that dropped writes here would
  // discard the runner's own frames and corrupt the very stream this defends.
  // stderr is swallowed, because the heartbeat is noise in a test lane.
  process.stdout.write = function (chunk, ...rest) {
    seen.push({ fd: 1, text: typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8") });
    return realOut.call(this, chunk, ...rest);
  };
  process.stderr.write = function (chunk) {
    seen.push({ fd: 2, text: typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8") });
    return true;
  };
  try {
    const { code } = await runCli(c.root, {});
    process.stdout.write = realOut;
    process.stderr.write = realErr;
    assert.equal(code, 0);
    const heartbeat = /→ .*: reviewing \(\d+ lenses/;
    assert.ok(
      seen.some((w) => w.fd === 2 && heartbeat.test(w.text)),
      "the heartbeat must still report progress, on stderr",
    );
    // Scoped to the heartbeat rather than "stdout saw no bytes at all", because
    // the runner's own frames legitimately travel this fd while a test runs.
    const leaked = seen.filter((w) => w.fd === 1 && heartbeat.test(w.text));
    assert.deepEqual(
      leaked.map((w) => w.text),
      [],
      "stdout carries the test runner's v8 result frames; plain text there desynchronizes them",
    );
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
    c.cleanup();
  }
});

// --- the two spend guards ----------------------------------------------------

test("END TO END: a panel that never exits is a panel-timeout, with its own reason", async () => {
  // Not `panel-exit`. A killed child reports `code: null`, so without a check
  // above the exit code a runaway panel would be filed under the same reason as
  // one that crashed on a large diff — and only one of those is a reason to
  // change the timeout.
  const c = tempCorpus();
  try {
    const { code, logs } = await runCli(c.root, { hang: true, spawnGrandchild: true }, ["--panel-timeout", "1"]);
    assert.equal(code, 1);
    const got = c.store.getItem(runIdOf(c.root), c.itemId);
    assert.equal(got.envelope.status, "error");
    assert.equal(got.envelope.reason, "panel-timeout", logs.join("\n"));
    assert.match(got.envelope.error.message, /did not exit within 1000ms/);
    // Not fatal: the run may continue, because a timeout is the failure most
    // likely to be about one item. Bounding a run of them is the cost cap's job.
    assert.equal(c.store.getRun(runIdOf(c.root)).runJson.status, "complete");
  } finally {
    c.cleanup();
  }
});

test("END TO END: the cost cap stops the run, and the item it stopped was never spawned", async () => {
  // The assertion is on what did NOT run. One item costs $0.42 in the stub's
  // execution log, so a $0.30 cap admits the first and must refuse the second.
  const c = tempCorpus({ count: 2 });
  try {
    const { code, logs } = await runCli(c.root, {}, ["--max-cost-usd", "0.30"]);
    assert.equal(code, 1, "a capped run is incomplete and must not report success");
    const runId = runIdOf(c.root);
    assert.deepEqual(c.store.listItems(runId), [c.itemIds[0]], "the second item has an envelope, so it was replayed");
    const run = c.store.getRun(runId);
    // `capped`, not `aborted`. Nothing is misconfigured: the run did what it was
    // told and stopped at the budget, and the two need different responses.
    assert.equal(run.runJson.status, "capped");
    assert.ok(RUN_STATUSES.includes(run.runJson.status));
    assert.match(run.runJson.notes, /cost cap/);
    // NO SILENT TRUNCATION: the skipped item is named, in the notes and the log.
    assert.match(run.runJson.notes, new RegExp(c.itemIds[1]));
    assert.ok(logs.some((l) => l.includes("STOPPED AT THE COST CAP")), logs.join("\n"));
    assert.ok(logs.some((l) => l.includes("not replayed") && l.includes(c.itemIds[1])), logs.join("\n"));
    assert.equal(run.runJson.max_cost_usd, 0.3);
  } finally {
    c.cleanup();
  }
});

test("END TO END: a cap of zero spawns nothing at all, and a resumed run resumes its budget", async () => {
  // `--max-cost-usd 0` is the degenerate case that proves the check runs BEFORE
  // the spawn rather than after the first item.
  const c = tempCorpus({ count: 2 });
  try {
    const zero = await runCli(c.root, {}, ["--run-id", "capped-run", "--max-cost-usd", "0"]);
    assert.equal(zero.code, 1);
    assert.deepEqual(c.store.listItems("capped-run"), [], "an item was replayed under a zero cap");

    // Resume with room for exactly one item ($0.42 each), then resume AGAIN with
    // the same cap: the second resume must count what the first already spent. A
    // budget that reset per invocation would let three resumes of a $0.40 run
    // spend $1.26 while every one of them reported staying inside the cap.
    const one = await runCli(c.root, {}, ["--run-id", "capped-run", "--max-cost-usd", "0.40"]);
    assert.equal(one.code, 1);
    assert.deepEqual(c.store.listItems("capped-run"), [c.itemIds[0]]);
    const again = await runCli(c.root, {}, ["--run-id", "capped-run", "--max-cost-usd", "0.40"]);
    assert.equal(again.code, 1);
    assert.deepEqual(c.store.listItems("capped-run"), [c.itemIds[0]], "the resumed run spent past the cap it was given");
    assert.equal(c.store.getRun("capped-run").runJson.status, "capped");
  } finally {
    c.cleanup();
  }
});

test("a run's status comes from a closed vocabulary, like an item's reason does", () => {
  // `run.json.status` is NOT validated by the store — `validateRunEnvelope`
  // checks item envelopes only — so the vocabulary is owned here, and a fifth
  // value appearing as a bare literal would reach disk unnoticed.
  assert.deepEqual([...RUN_STATUSES].sort(), ["aborted", "capped", "complete", "partial"]);
  const src = readFileSync(path.join(HERE, "run.mjs"), "utf8");
  const assigned = /const status = ([^;]+);/.exec(src);
  assert.ok(assigned, "run.mjs no longer decides the run status in one place");
  for (const m of assigned[1].matchAll(/"([^"]+)"/g)) {
    assert.ok(RUN_STATUSES.includes(m[1]), `run.mjs writes the run status ${JSON.stringify(m[1])}, which is not in RUN_STATUSES`);
  }
});

test("every gate state an envelope can carry is declared somewhere", () => {
  // `GATE_STATES` is what the panel can REPORT; `GATE_NOT_RUN` is what the runner
  // writes when no panel ran. Together they are the closed set, and a third value
  // appearing as a bare literal at one of the two envelope sites would pass
  // `validateRunEnvelope` (which only demands a non-empty string) unnoticed.
  const declared = new Set([...GATE_STATES, GATE_NOT_RUN]);
  assert.equal(declared.size, GATE_STATES.length + 1, "GATE_NOT_RUN collides with a reported state");
  const src = readFileSync(path.join(HERE, "run.mjs"), "utf8");
  for (const m of src.matchAll(/gate: \{ state: ([^,]+),/g)) {
    const expr = m[1].trim();
    assert.ok(
      expr === "GATE_NOT_RUN" || expr === "cap.gate" || expr === "GATE_STATES",
      `run.mjs builds an envelope gate from ${expr} — use GATE_NOT_RUN or the adapter's parsed state`,
    );
  }
});

test("END TO END: a failed item KEEPS its raw panel output; an ok item does not", async () => {
  // Asymmetric on purpose. For an `ok` item the scratch directory is 20 redundant
  // copies of the panel's output by the end of a corpus run, because `payload.json`
  // already has all of it. For a FAILED one it is the only place the raw bytes exist
  // — `payload.json` records the parsed STATES — so deleting it would be the same
  // fail direction this whole module exists to correct.
  const scratchDirs = () => new Set(readdirSync(tmpdir()).filter((d) => d.startsWith("eval-item-")));

  const ok = tempCorpus();
  try {
    const before = scratchDirs();
    const r = await runCli(ok.root, {});
    assert.equal(r.code, 0);
    const left = [...scratchDirs()].filter((d) => !before.has(d));
    assert.deepEqual(left, [], `an ok item left its scratch directory behind: ${left.join(", ")}`);
  } finally {
    ok.cleanup();
  }

  const bad = tempCorpus();
  try {
    const before = scratchDirs();
    const r = await runCli(bad.root, { exitCode: 1 });
    assert.equal(r.code, 1);
    const kept = [...scratchDirs()].filter((d) => !before.has(d));
    assert.equal(kept.length, 1, `a failed item's evidence was not kept: ${kept.join(", ")}`);
    // Named in the log, or nobody can find it.
    const line = r.logs.find((l) => l.includes("raw panel output kept at"));
    assert.ok(line, r.logs.join("\n"));
    const outDir = line.slice(line.indexOf("kept at ") + "kept at ".length).trim();
    assert.ok(existsSync(path.join(outDir, "panel.json")), `${outDir} does not hold the panel's output`);
    rmSync(path.join(tmpdir(), kept[0]), { recursive: true, force: true });
  } finally {
    bad.cleanup();
  }
});

test("END TO END: a PRE-SPAWN refusal keeps no scratch directory, because it has no evidence to keep", async () => {
  // The keep-the-evidence rule above is about a panel that ran and failed. A
  // refusal happens before `prepareInput`, so its `eval-item-*` directory is
  // empty — and this PR added three reasons that refuse, over a run that is
  // MEANT to produce seven of them at once. Kept, that is seven empty
  // directories per run in `tmpdir()`, indistinguishable from real evidence.
  const scratchDirs = () => new Set(readdirSync(tmpdir()).filter((d) => d.startsWith("eval-item-")));
  const c = tempCorpus();
  try {
    const before = scratchDirs();
    // `--require-repo-context` with a `--repo-source` that has no such commit:
    // the first of the three refusals, and the cheapest to reach.
    const { code, logs } = await runCli(c.root, {}, ["--repo-source", c.root], { noRepoContext: false });
    assert.equal(code, 1);
    assert.ok(logs.some((l) => l.includes("no model calls")), logs.join("\n"));
    const left = [...scratchDirs()].filter((d) => !before.has(d));
    assert.deepEqual(left, [], `a refusal left an empty scratch directory behind: ${left.join(", ")}`);
  } finally {
    c.cleanup();
  }
});

test("END TO END: a throw inside the item loop still deregisters the worktree", async () => {
  // The teardown is not a tidy-up. A worktree is registered in the SOURCE
  // repository's `.git`, so skipping it leaves administrative state in a
  // developer's own clone — and everything in the loop can throw. This drives the
  // reachable one: a corpus item whose `meta.json` is not JSON, which the store
  // refuses by throwing from `getCorpusItemInput`, outside the per-item `catch`
  // that covers only the panel call.
  const src = tempGitRepo();
  const c = tempCorpus({ reviewCommit: src.head, reviewBase: src.base, count: 2 });
  const listed = () => src.git("worktree", "list", "--porcelain");
  const lensDirs = () => new Set(readdirSync(tmpdir()).filter((d) => d.startsWith("eval-lenses-")));
  try {
    const beforeLenses = lensDirs();
    writeFileSync(path.join(c.root, "corpus", "items", c.itemIds[1], "meta.json"), "{ not json");
    await assert.rejects(
      () => runCli(c.root, {}, ["--repo-source", src.dir], { noRepoContext: false }),
      /unreadable meta\.json/,
    );
    // The first item DID materialise a worktree before the second item threw, so
    // there is something real to have leaked.
    assert.equal(listed().includes("eval-worktrees-"), false, "a worktree survived the throw, registered in the source repository");
    assert.deepEqual([...lensDirs()].filter((d) => !beforeLenses.has(d)), [], "the materialised lenses dir survived the throw");
  } finally {
    c.cleanup();
    src.cleanup();
  }
});

test("END TO END: an item absent from the corpus is not recorded as a replay of it", async () => {
  const c = tempCorpus();
  try {
    const { code, logs } = await runCli(c.root, {}, ["--items", "pr-999"]);
    assert.equal(code, 1);
    assert.ok(logs.some((l) => l.includes("not in corpus")), logs.join("\n"));
    assert.deepEqual(c.store.listItems(runIdOf(c.root)), [], "an item that was never replayed must not have an envelope");
  } finally {
    c.cleanup();
  }
});

test("resuming a run id after editing lenses.json is refused, not silently mixed", async () => {
  const c = tempCorpus();
  // A real edited lenses dir, because that is the scenario: someone tunes a lens
  // between two replicates and reuses the run id.
  const edited = mkdtempSync(path.join(tmpdir(), "eval-lenses-edited-"));
  try {
    await runCli(c.root, {}, ["--run-id", "fixed-run"]);
    for (const f of readdirSync(LENSES)) writeFileSync(path.join(edited, f), readFileSync(path.join(LENSES, f)));
    const manifest = JSON.parse(readFileSync(path.join(edited, "lenses.json"), "utf8"));
    manifest[0].samples = (manifest[0].samples ?? 2) + 3;
    writeFileSync(path.join(edited, "lenses.json"), JSON.stringify(manifest, null, 2));
    // `run.json` names ONE config_hash for the whole run, so half the items produced
    // by a different reviewer would be unattributable — and the fork's store IGNORED
    // the second snapshot, which permitted exactly that.
    await assert.rejects(
      () => runCli(c.root, {}, ["--run-id", "fixed-run", "--lenses-dir", edited]),
      /already holds a DIFFERENT config snapshot/,
    );
    // A different `--config-id` over the SAME lenses is allowed on purpose:
    // `config_hash` is configuration identity and a config id is a human label, so
    // relabelling is not a change of reviewer. #680 owns that distinction.
    const relabelled = await runCli(c.root, {}, ["--run-id", "fixed-run", "--config-id", "relabelled"]);
    assert.equal(relabelled.code, 0);
  } finally {
    c.cleanup();
    rmSync(edited, { recursive: true, force: true });
  }
});

// --- reaping what the stub spawned -------------------------------------------

test("reapPid REFUSES every pid that is not a real process, and signals nothing", () => {
  // The one that matters is 0. `process.kill(-0, …)` signals the caller's own
  // process group, which under the lane is the test runner and every sibling test
  // file — so a zero reaching the kill turns a cleanup into a suite-wide SIGKILL.
  // The rest are the shapes a half-written `stub-pids.json` actually produces:
  // `null` is the value the stub writes when it spawned no grandchild.
  const calls = [];
  const spy = (pid, sig) => { calls.push([pid, sig]); };
  for (const bad of [0, -0, 1, -1, null, undefined, NaN, Infinity, 1.5, "4242", "", false, {}, []]) {
    assert.equal(reapPid(bad, spy), false, `reapPid accepted ${JSON.stringify(bad)}`);
  }
  assert.deepEqual(calls, [], "a rejected pid must not reach process.kill at all");
});

test("reapPid kills the GROUP and then the pid, and a throwing group kill does not skip the pid", () => {
  // Two tries, not one: the grandchild ignores SIGTERM and is reachable only
  // through its parent's group, while the group kill is the one most likely to
  // throw ESRCH first. Sharing a `try` would let that throw skip the process the
  // reap is actually for.
  const calls = [];
  assert.equal(reapPid(4242, (pid, sig) => { calls.push([pid, sig]); }), true);
  assert.deepEqual(calls, IS_POSIX ? [[-4242, "SIGKILL"], [4242, "SIGKILL"]] : [[4242, "SIGKILL"]]);

  const afterThrow = [];
  reapPid(4242, (pid, sig) => {
    if (pid < 0) throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
    afterThrow.push([pid, sig]);
  });
  assert.deepEqual(afterThrow, [[4242, "SIGKILL"]], "the bare pid must still be signalled");
});

test("collectStubPids reads the path run.mjs PRINTS, and ignores what it cannot use", () => {
  // The contract is two-part: the log line `run.mjs` emits for a kept scratch
  // directory, and the `stub-pids.json` `stub-panel.mjs` wrote inside it. Not a
  // scan of `tmpdir()` and not a scan of the process table — either would also
  // match a concurrent sibling test file's live stub.
  const dir = mkdtempSync(path.join(tmpdir(), "eval-reap-"));
  const noPids = mkdtempSync(path.join(tmpdir(), "eval-reap-none-"));
  const broken = mkdtempSync(path.join(tmpdir(), "eval-reap-broken-"));
  try {
    writeFileSync(path.join(dir, "stub-pids.json"), JSON.stringify({ panel: 4242, grandchild: 4243 }));
    // What the stub writes with no `spawnGrandchild`, what a failed-but-not-hung
    // item leaves (no file at all), and what a killed stub leaves half-written.
    // None may throw, and none may contribute a pid.
    writeFileSync(path.join(broken, "stub-pids.json"), '{"panel": 42');
    const into = new Set();
    const logs = [
      `  ! pr-1: raw panel output kept at ${dir}`,
      `  ! pr-2: raw panel output kept at ${noPids}`,
      `  ! pr-3: raw panel output kept at ${broken}`,
      "  → pr-4: reviewing (6 lenses, 6 samples)…",
    ];
    assert.equal(collectStubPids(logs, into), 2);
    assert.deepEqual([...into].sort((a, b) => a - b), [4242, 4243]);

    // A run that kept nothing records nothing — the reaper must not invent pids
    // from lines that are not about a kept directory.
    const empty = new Set();
    assert.equal(collectStubPids(["  → pr-9: reviewing (1 lenses, 1 samples)…"], empty), 0);
    assert.equal(empty.size, 0);
  } finally {
    for (const d of [dir, noPids, broken]) rmSync(d, { recursive: true, force: true });
  }
});

test("reapPid actually kills a process that IGNORES SIGTERM, which is the fixture's shape", () => {
  // The end-to-end claim, on a process this test owns: the grandchild's defining
  // property is that SIGTERM does nothing to it, so a reaper that sent SIGTERM
  // would pass every assertion above and still leak on the runner.
  const child = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"], {
    stdio: "ignore",
    detached: IS_POSIX,
  });
  assert.ok(isReapablePid(child.pid), "spawn gave no usable pid");
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  assert.equal(alive(child.pid), true);
  assert.equal(reapPid(child.pid), true);
  return new Promise((resolve) => {
    child.on("exit", () => { assert.equal(alive(child.pid), false); resolve(); });
  });
});

test("the reaper is WIRED UP: a hang run leaves its pids recorded for `after` to kill", async () => {
  // The mutation this exists for: delete `collectStubPids(root)` from `runCli` and
  // every assertion above still passes, because they all test the reaper in
  // isolation. What is asserted here is the connection — that a real hang run
  // hands its pids to the set `after()` drains. Reaping is not asserted here: the
  // pids are still alive on purpose at this point, because `after` has not run.
  const c = tempCorpus();
  const before = stubPids.size;
  try {
    await runCli(c.root, { hang: true, spawnGrandchild: true }, ["--panel-timeout", "1"]);
    assert.ok(
      stubPids.size >= before + 2,
      `expected the stub's panel AND grandchild to be recorded, set grew by ${stubPids.size - before}`,
    );
  } finally {
    c.cleanup();
  }
});
