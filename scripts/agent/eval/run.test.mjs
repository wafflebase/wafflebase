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

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EvalStore, contentSha256 } from "./store.mjs";
import {
  DEFAULT_PANEL_SCRIPT,
  FATAL_REASONS,
  GATE_NOT_RUN,
  ITEM_REASONS,
  classifyItemOutcome,
  main,
  materializeRepoAt,
  panelEnv,
  resolvePanelSha,
  resolveRunOptions,
  summarizeRun,
} from "./run.mjs";
import { GATE_STATES } from "./adapters/reviewer.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STUB = path.join(HERE, "adapters", "stub-panel.mjs");
const LENSES = path.join(HERE, "..", "lenses");
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

/** A store rooted in a throwaway directory, holding one frozen corpus item. */
function tempCorpus({ itemId = "pr-664", diff = DIFF, reviewCommit = "61101a1bdbdffb9acb88772cae4c9347c69f413b" } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "eval-run-test-"));
  const store = new EvalStore(root);
  const meta = {
    id: itemId,
    source_pr: 664,
    review_commit: reviewCommit,
    review_base: "35206e5859788062cfddfd0fc12b0a5754655a8d",
    review_point: "pr-open",
    diff_method: "fork-point",
    changed_files: ["scripts/agent/x.mjs"],
    additions: 1,
    deletions: 1,
    scope: "S",
    has_issue_spec: false,
    sha256_diff: contentSha256(diff),
  };
  store.putCorpusItem(itemId, { meta, diff, changedFiles: meta.changed_files, issueSpec: "" });
  store.putCorpusManifest("v-test", { corpus_version: "v-test", item_count: 1, items: [{ id: itemId }] });
  return { root, store, itemId, cleanup: () => rmSync(root, { recursive: true, force: true }) };
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
async function runCli(root, spec = {}, extra = [], { noRepoContext = true } = {}) {
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
      ...extra,
    ]);
    return { code, logs };
  } finally {
    console.log = realLog;
    console.error = realErr;
    if (prev === undefined) delete process.env.STUB_PANEL_SPEC; else process.env.STUB_PANEL_SPEC = prev;
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
  assert.equal(none.errors.length, 2);
  assert.match(none.errors.join(" "), /--root is required and has no default/);
  assert.match(none.errors.join(" "), /--corpus-version is required/);
  assert.match(resolveRunOptions(["node", "run.mjs", "--out", "/tmp/x"]).errors[0], /the fork harness called this --out/);
  assert.deepEqual(resolveRunOptions(["node", "run.mjs", "--root", "/tmp/x", "--corpus-version", "v1"]).errors, []);
});

test("the option defaults that decide cost and fidelity are the intended ones", () => {
  const o = resolveRunOptions(["node", "run.mjs", "--root", "/tmp/x", "--corpus-version", "v1"]);
  // Opposite defaults for opposite reasons — see `resolveRunOptions`.
  assert.equal(o.requireRepoContext, false, "flipping this belongs with PR 6's worktree");
  assert.equal(o.diffContent, true, "the routed diff must ride along, because its absence is silent");
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
  const git = (...a) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...a], { cwd: src, stdio: "pipe", encoding: "utf8" });
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

test("an already-populated cache entry is reused, never deleted out from under a reader", () => {
  // The cache root is shared across processes and keyed only by commit, so two
  // runners can address this exact path at once. The version this replaces `rmSync`ed
  // the destination and rebuilt IN PLACE, which meant a concurrent reader could
  // observe the tree deleted or half-populated — and a lens handed a half-populated
  // tree reasons from code that is genuinely missing and reports it as a finding.
  const cache = mkdtempSync(path.join(tmpdir(), "eval-repo-cache-test-"));
  const src = mkdtempSync(path.join(tmpdir(), "eval-repo-src-test-"));
  const git = (...a) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...a], { cwd: src, stdio: "pipe", encoding: "utf8" });
  try {
    git("init", "--quiet");
    writeFileSync(path.join(src, "a.mjs"), "export const a = 1;\n");
    git("add", "a.mjs");
    git("commit", "--quiet", "-m", "one file");
    const commit = git("rev-parse", "HEAD").trim();

    // A complete tree with NO marker beside it: exactly what a concurrent runner has
    // built but not yet stamped. `sentinel` stands in for the bytes a reader is
    // mid-read of.
    const dest = path.join(cache, commit);
    mkdirSync(dest, { recursive: true });
    writeFileSync(path.join(dest, "sentinel"), "another runner built this");

    const out = materializeRepoAt({ repoSource: src, commit, cacheRoot: cache });
    assert.equal(out.error, null);
    assert.equal(out.path, dest);
    assert.ok(
      existsSync(path.join(dest, "sentinel")),
      "the existing cache tree was destroyed and rebuilt — a concurrent reader would have seen it vanish",
    );
    // And the marker describes the tree the caller was actually handed, not the one
    // this call staged and threw away.
    assert.equal(out.files, 1);
    assert.match(readFileSync(`${dest}.materialized`, "utf8"), /\s1$/m);
  } finally {
    rmSync(cache, { recursive: true, force: true });
    rmSync(src, { recursive: true, force: true });
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
