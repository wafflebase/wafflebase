// Replay one frozen corpus item through the review panel, and record an immutable
// envelope of what happened.
//
// THE PROBLEM THIS SOLVES, WITH NO BENCHMARK IN SIGHT. The review panel is a
// non-deterministic judge and there is currently no way to ask it the same question
// twice: a check run records a verdict, the diff behind it moves, and "did that
// tuning change help?" is unanswerable because the input never held still. Freeze a
// pull request into a corpus item (#677) and this runs the real panel over it,
// offline, as many times as you like — and writes down, per lens, what each one
// actually did.
//
// WHAT IS ROLE-AGNOSTIC AND WHAT IS NOT. The loop below knows only: corpus items, a
// config, run ids, envelopes and the store. Everything that knows what a "lens" or
// a "diff" is lives behind the target-adapter seam in `adapters/reviewer.mjs`. The
// one deliberate exception is the gate and diff-content assertions: they are
// review-panel-specific facts, they are the reason this PR exists, and burying them
// in a generic classifier would make the vocabulary lie about what it can detect.
//
// FAIL DIRECTION, WHICH IS THE WHOLE DESIGN. Four separate defects in the version
// this replaces all failed in the SAME direction — a panel that exited non-zero, a
// panel that never wrote `panel.json`, a novelty gate that silently did not run,
// and a capture missing the routed diff each lens read. Every one of them produced
// an envelope saying the panel looked and found nothing, indistinguishable from a
// genuinely clean pull request. That is not noise. In a precision metric a false
// clean review is a PERFECT SCORE: it inflates precision, deflates recall, and
// nothing about it looks wrong in any log.
//
// So: when in doubt, ABORT. A run that refuses to record itself costs one replay. A
// run that records a lie costs every number computed from it afterwards, and nobody
// finds out. Two of the failures are further treated as FATAL to the whole run
// rather than to one item, because they are misconfigurations that will be
// identical for the next nineteen items and each of those costs money.
//
// THIS RUN SPENDS MONEY. It spawns the panel, which calls models. Tests drive it
// with `adapters/stub-panel.mjs` instead, which is why `--panel-script` exists.

import { mkdtempSync, mkdirSync, existsSync, writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EvalStore } from "./store.mjs";
import { buildConfig, materializeLenses, pinnedSdkVersion } from "./config-build.mjs";
import { reviewerAdapter, GATE_STATES } from "./adapters/reviewer.mjs";
import { sumExecutions } from "../metrics.mjs";
import { sampleCountFor } from "../review-panel.mjs";
import { parseArgs } from "../gh-checks.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHA40 = /^[0-9a-f]{40}$/;
const nowIso = () => new Date().toISOString();

/** The panel this runner replays. Resolved as its own SIBLING, which is exactly
 *  why `panel_sha` is not optional — see `resolvePanelSha`. */
export const DEFAULT_PANEL_SCRIPT = path.join(HERE, "..", "review-panel.mjs");

/**
 * Every way an item can fail to be a real verdict, as a closed list.
 *
 * A single `error` status with a free-text message would have been simpler and
 * would have hidden the thing this PR is about: a non-zero exit, a missing
 * `panel.json` and an infra error are THREE different failures with three
 * different responses, and the version this replaces collapsed all of them into
 * `status: "ok"`.
 *
 *   panel-exit       the panel exited non-zero (or could not be spawned)
 *   no-panel-json    it exited 0 and wrote no usable `panel.json`
 *   gate-degraded    the novelty gate's state disagrees with what we asked for
 *   gate-unreported  the panel printed no gate line at all
 *   no-lens-diff     the capture omits the routed diff each lens read
 *   infra            a lens hit auth/quota — the reviewer never ran
 *   no-output        the panel made no SDK calls
 *   no-repo-context  `--require-repo-context` and the tree would not materialise
 *   exception        the runner itself threw on this item
 *
 * `run.test.mjs` asserts the classifier emits nothing outside this list, so a new
 * failure mode cannot be added as an unlabelled string.
 */
export const ITEM_REASONS = Object.freeze([
  "panel-exit",
  "no-panel-json",
  "gate-degraded",
  "gate-unreported",
  "no-lens-diff",
  "infra",
  "no-output",
  "no-repo-context",
  "exception",
]);

/** The failures that stop the whole run rather than one item — see the header. */
export const FATAL_REASONS = Object.freeze(["gate-degraded", "gate-unreported", "no-lens-diff"]);

const err = (reason, message) => ({ status: "error", reason, error: { message, kind: reason }, fatal: FATAL_REASONS.includes(reason) });

/**
 * Is this item a real verdict? Pure, and the single place the answer is decided.
 *
 * ORDER IS THE POINT. A crashed panel satisfies several of these at once — non-zero
 * exit, no `panel.json`, zero SDK calls — so the checks run from the most upstream
 * CAUSE to the most downstream SYMPTOM, and the recorded reason names the cause.
 * Getting that backwards produces envelopes that all say `no-output` and give
 * nobody anything to fix.
 *
 * The gate checks sit above the content checks deliberately: if the gate did not
 * run, this item is not a measurement of the shipped reviewer at all, so which
 * findings it produced is beside the point.
 */
export function classifyItemOutcome({
  exitCode,
  panelState,
  panel,
  calls,
  gate,
  baseShaPassed = false,
  diffContent,
  diffContentRequested = false,
} = {}) {
  if (exitCode !== 0) {
    return err("panel-exit", `the panel exited ${exitCode} — its output cannot be pooled as a verdict whatever it managed to write`);
  }
  if (panelState !== "present" || !Array.isArray(panel)) {
    // The `?? []` this replaces made exactly this case read as "the panel found
    // nothing": zero findings, an empty stage detail, and `status: "ok"`.
    return err("no-panel-json", `the panel exited 0 but its panel.json is ${panelState} — that is not the same as finding nothing`);
  }

  const state = gate?.state;
  if (!GATE_STATES.includes(state)) {
    return err("gate-unreported", `the panel reported no recognisable novelty-gate state (got ${JSON.stringify(state)}) — its own self-report is how we know the gate ran`);
  }
  if (state === "unreported") {
    return err("gate-unreported", "the panel printed no `novelty gate:` line — either it died before routing, or the line moved and the contract drifted unnoticed");
  }
  // The silent-degradation case, and the one PR 6 will trip over: we asked for the
  // gate and the panel says it is off. An inert gate is SAFE — every finding keeps
  // gating — which is exactly why it must be loud: the output looks identical to
  // "nothing was relocated", so a misconfigured base would otherwise be invisible
  // for as long as it lasted, and `lane: "backlog"` could never occur.
  if (baseShaPassed && state !== "on") {
    return err(
      "gate-degraded",
      `--base-sha was passed and the panel reports the novelty gate ${state}: ${gate.line ?? "(no line)"} — ` +
        "a replay with the gate off is not a replay of the shipped gate",
    );
  }
  // The inverse: we passed no base and the gate claims to have run. Nothing in the
  // panel can produce this, so seeing it means the flag plumbing or the log line is
  // not what this module believes it is, and every gate state recorded by this run
  // is suspect.
  if (!baseShaPassed && state === "on") {
    return err("gate-degraded", `no --base-sha was passed and the panel reports the novelty gate on: ${gate.line ?? "(no line)"}`);
  }

  // Absence here does not fail anything by itself — it silently substitutes the
  // WHOLE pull-request diff as the stage input downstream, so a fixture records a
  // lens reading bytes it never saw. A flag whose absence is silent is a flag that
  // needs an assertion.
  if (diffContentRequested && (diffContent?.state === "absent" || diffContent?.state === "partial")) {
    return err(
      "no-lens-diff",
      `STAGE_DETAIL_DIFF_CONTENT was requested but ${diffContent.lensesWithDiff}/${diffContent.lensesWithDetail} captured lenses carry lensDiff — ` +
        "the downstream fixture would fall back to the whole PR diff without saying so",
    );
  }

  // A lens that hit auth/quota never actually ran, so the gate verdict is
  // contaminated (it fails closed to "block") and the item is not a real verdict.
  const applicable = panel.filter((p) => p && p.applicable);
  const infra = applicable.find((p) => p.infraError);
  if (infra) {
    // The lens's own string is often just a status code, so it is WRAPPED rather
    // than passed through: `"429"` alone in an envelope tells a reader nothing about
    // why the item is unusable, and the reason this is not a verdict — the reviewer
    // never ran, and the gate failed closed to "block" — is the part worth storing.
    return err("infra", `lens "${infra.id}" hit an infrastructure error, so the reviewer never ran and the gate failed closed: ${infra.infraError}`);
  }

  // Last, because it is the weakest signal: the SDK emits `result` messages even
  // for API/auth/quota errors, so `calls > 0` is not proof the review ran — but
  // `calls === 0` IS proof it did not.
  if (!calls) return err("no-output", "the panel produced no SDK result messages");

  return { status: "ok", reason: null, error: null, fatal: false };
}

/**
 * How many files the review tree has, counted ONCE and recorded.
 *
 * `repo_context_files` used to differ between replicates of the same commit: the
 * marker was written INSIDE the archived tree, and the count ran before the write
 * on first materialisation and after it on every cache hit — so the same commit
 * reported `N` and then `N+1`. A fidelity field that disagrees between K
 * replicates of one item is worse than no field, because a scorer segmenting on it
 * would split one population in two.
 *
 * Fixed by putting the marker OUTSIDE the tree and by having the cache hit read
 * the count the first materialisation recorded, rather than re-walking. The count
 * is then provably identical across replicates, and it is also the number a
 * truncated checkout shows up in.
 */
function countFiles(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true }).filter((d) => d.isFile()).length;
}

/**
 * Materialise the repository tree at `commit`, so lenses reason from real
 * surrounding code rather than from the diff alone.
 *
 * Always returns the same SHAPE — `{path, files, error}` with `path: null` on
 * failure — because the version this replaces promised `null` in its docstring and
 * returned an object from its catch branch, so `ctx?.path` was load-bearing in a
 * way nothing stated.
 *
 * `execFileSync` with an argv array and an intermediate tar FILE, never a shell
 * string. The version this replaces interpolated `${repoSource}`, `${commit}` and
 * `${dest}` into `sh -c` — the harness's only shell-out, over a value that arrives
 * from stored corpus metadata.
 *
 * This is a `git archive`, which produces a tree with NO `.git`. That is why
 * nothing passes `--base-sha`: the novelty gate would find no repository to blame
 * against. A real worktree is PR 6.
 */
export function materializeRepoAt({ repoSource, commit, cacheRoot }) {
  if (!commit || !repoSource) return { path: null, files: 0, error: "no repo source or commit" };
  const dest = path.join(cacheRoot, commit);
  // OUTSIDE `dest`, so the tree the panel reads is exactly the commit's tree and
  // the file count cannot include our own bookkeeping.
  const mark = `${dest}.materialized`;
  if (existsSync(mark)) {
    const recorded = Number(readFileSync(mark, "utf8").trim().split(/\s+/)[1]);
    return { path: dest, files: Number.isFinite(recorded) ? recorded : countFiles(dest), error: null };
  }
  const tarPath = `${dest}.tar`;
  try {
    rmSync(dest, { recursive: true, force: true });
    rmSync(tarPath, { force: true });
    mkdirSync(dest, { recursive: true });
    execFileSync("git", ["-C", repoSource, "archive", "--format=tar", "-o", tarPath, commit], { stdio: "pipe" });
    execFileSync("tar", ["-xf", tarPath, "-C", dest], { stdio: "pipe" });
    const files = countFiles(dest);
    writeFileSync(mark, `${commit} ${files}\n`);
    return { path: dest, files, error: null };
  } catch (e) {
    rmSync(dest, { recursive: true, force: true });
    // Surface git's own stderr rather than swallowing it: a silent 0-file checkout
    // is how the #521 pilot billed $44 for a full diff-only run without anyone
    // noticing.
    const why = (e.stderr?.toString?.() || e.message || "").split("\n").find((l) => l.trim()) || "unknown";
    return { path: null, files: 0, error: why };
  } finally {
    rmSync(tarPath, { force: true });
  }
}

/**
 * Which commit of the panel is about to run, and refuse if that cannot be said.
 *
 * The runner resolves the panel as `<this file>/../review-panel.mjs` — the SIBLING
 * IN WHATEVER CHECKOUT IT IS RUN FROM. Run it on a feature branch and it has
 * measured that branch's panel, not `main`'s, and nothing in the output would say
 * so. The fork's own `capabilities.md` warned about this trap; porting upstream
 * only removes it if the envelope records WHICH commit ran, which is why
 * `validateRunEnvelope` refuses an envelope without it.
 *
 * A DIRTY TREE IS REFUSED. HEAD's sha describes HEAD's bytes, and a modified panel
 * is not the commit it claims to be — recording HEAD anyway is the same
 * "asserted, not measured" failure as the hardcoded `sdk_version` this PR deletes.
 * The dirtiness check is scoped to `scripts/agent/` and EXCLUDES `scripts/agent/eval/`
 * on purpose: the harness is not the reviewer, so editing the runner must not block
 * a replay, and the exclusion is the same one the README's known-limits table
 * already tells a reader to run by hand.
 *
 * `--panel-sha` overrides, and the override is RECORDED as such (`panel_sha_source`)
 * rather than being indistinguishable from a measured one. It is required, not
 * merely allowed, when `--panel-script` points somewhere other than the sibling:
 * replaying a different script while stamping the sibling's sha is precisely the
 * mislabelling this field exists to prevent.
 */
export function resolvePanelSha({ panelScript, override, git = gitLines }) {
  if (override !== undefined && override !== null && override !== "") {
    if (!SHA40.test(String(override))) {
      throw new Error(`run: --panel-sha must be 40 lowercase hex characters, got ${JSON.stringify(override)}`);
    }
    return { panelSha: String(override), source: "flag" };
  }
  if (path.resolve(panelScript) !== path.resolve(DEFAULT_PANEL_SCRIPT)) {
    throw new Error(
      `run: --panel-script points at ${panelScript}, which is not this checkout's review-panel.mjs, so its commit cannot be read. ` +
        "Pass --panel-sha to say which panel this is; a run that cannot name its reviewer is not poolable with any other.",
    );
  }
  const dir = path.dirname(path.resolve(panelScript));
  let head;
  try {
    head = git(["-C", dir, "rev-parse", "HEAD"])[0] ?? "";
  } catch (e) {
    throw new Error(
      `run: cannot read the panel's commit from ${dir} (${e.message}). Pass --panel-sha if you know which panel this is.`,
    );
  }
  if (!SHA40.test(head)) {
    throw new Error(`run: git rev-parse HEAD in ${dir} answered ${JSON.stringify(head)}, which is not a commit sha`);
  }
  const dirty = git(["-C", dir, "status", "--porcelain", "--", "."])
    .filter(Boolean)
    // A porcelain line is `XY <path>`; the path is relative to the repo root.
    .filter((l) => !/\s+scripts\/agent\/eval\//.test(l));
  if (dirty.length > 0) {
    throw new Error(
      `run: ${dir} has ${dirty.length} uncommitted change(s) outside eval/, so ${head.slice(0, 12)} does not describe the panel that would run:\n` +
        `${dirty.slice(0, 10).join("\n")}\n` +
        "Commit them, stash them, or pass --panel-sha to record a sha deliberately.",
    );
  }
  return { panelSha: head, source: "git" };
}

/** The injected side effect `resolvePanelSha` needs, as lines. */
function gitLines(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).split("\n").map((l) => l.trim());
}

/**
 * Recompute a run's totals from the STORED envelopes, so a resumed run and a
 * finished one report the same numbers as what is actually on disk.
 *
 * `duration_ms` is summed only over the items that HAVE one, and `duration_items`
 * carries that `n`. A missing `review-timing.json` means the wall-clock is unknown
 * for that item, and treating unknown as zero would make a run of ten items with
 * three timings look three times as fast as it was. `sdk_duration_ms_sum` is kept
 * beside it and is NOT a duration: it is the flat sum over every SDK call, which
 * overcounts wall-clock by the concurrency factor (#669 measured a ~12-minute
 * panel reported as 36–63). The name is the whole point.
 */
export function summarizeRun(store, runId, plannedIds) {
  const totals = { cost_usd: 0, weighted_tokens: 0, raw_tokens: 0, sdk_duration_ms_sum: 0, turns: 0, calls: 0, duration_ms: 0, duration_items: 0 };
  let ok = 0, error = 0, present = 0;
  for (const itemId of plannedIds) {
    const got = store.getItem(runId, itemId);
    if (!got) continue;
    present++;
    const e = got.envelope;
    if (e.status === "ok") ok++; else error++;
    totals.cost_usd += Number(e.cost_usd) || 0;
    totals.weighted_tokens += Number(e.weighted_tokens) || 0;
    totals.raw_tokens += Number(e.raw_tokens) || 0;
    totals.sdk_duration_ms_sum += Number(e.sdk_duration_ms_sum) || 0;
    totals.turns += Number(e.turns) || 0;
    totals.calls += Number(e.calls) || 0;
    if (Number.isFinite(e.duration_ms)) {
      totals.duration_ms += e.duration_ms;
      totals.duration_items++;
    }
  }
  return { totals, items_ok: ok, items_error: error, items_present: present, complete: present === plannedIds.length };
}

const USAGE = `Replay frozen corpus items through the review panel.

  node scripts/agent/eval/run.mjs --root <eval-repo> --corpus-version <v> [options]

THIS SPENDS MONEY: it spawns review-panel.mjs, which calls models.

  --root <dir>            REQUIRED. The eval data repo. No default, ever — a
                          forgotten one would commit run data into whichever
                          repository this code happens to live in, permanently.
  --corpus-version <v>    REQUIRED. Which frozen corpus to replay.
  --run-id <id>           Default: a timestamp + the config id. Re-invoking with
                          the same id RESUMES: items already stored are not re-run.
  --items a,b             Only these item ids (default: the whole corpus).
  --config-id <id>        Default "baseline".
  --lenses-dir <dir>      Default: scripts/agent/lenses.
  --sdk-version <v>       Default: the pin in scripts/agent/package.json.
  --panel-script <f>      Default: this checkout's review-panel.mjs. Anything else
                          requires --panel-sha.
  --panel-sha <sha>       Record this panel commit instead of reading it from git.
  --repo-source <dir>     Clone to materialise the review tree from (default: this
                          repository).
  --no-repo-context       Replay diff-only: hand the panel an empty --repo.
  --require-repo-context  Refuse to spend on an item whose tree will not
                          materialise. Default OFF; PR 6 owns flipping it.
  --no-diff-content       Do not ask the capture for the routed per-lens diff.
  --description <text>    Recorded in the config manifest.

Exit codes: 0 every planned item is stored and ok · 1 an item failed or the run
aborted · 2 usage.`;

/**
 * Resolve the CLI's options. Exported and pure, so the properties that matter are
 * testable without spending anything.
 *
 * `--root` has NO DEFAULT and neither does `--corpus-version`. #675 set that rule
 * for a reason that has not changed: git history is permanent, so one forgotten
 * flag falling back to a path inside this repository would commit benchmark data
 * into `wafflebase` for good, and no later `git rm` shrinks anyone's clone.
 *
 * `requireRepoContext` defaults OFF and `diffContent` defaults ON, and the two
 * defaults are opposite for opposite reasons. The repo-context guard changes what a
 * replay COSTS and what it measures, so flipping it belongs with the worktree that
 * makes it satisfiable (PR 6). The diff-content flag only decides whether the
 * capture carries bytes we already hold in the corpus item, and its absence is
 * SILENT — the downstream fixture builder substitutes the whole pull-request diff —
 * so it defaults on and is asserted rather than trusted.
 */
export function resolveRunOptions(argv, { readFile } = {}) {
  const args = parseArgs(argv, {
    booleans: ["help", "no-repo-context", "require-repo-context", "no-diff-content"],
  });
  const errors = [];
  if (args.root === undefined || String(args.root).trim() === "") {
    // `--out` was the fork's name for it, and `extract-corpus.mjs` answers the same
    // muscle memory the same way.
    errors.push(`--root is required and has no default${args.out !== undefined ? " (the fork harness called this --out)" : ""}.`);
  }
  if (args["corpus-version"] === undefined || String(args["corpus-version"]).trim() === "") {
    errors.push("--corpus-version is required.");
  }
  const configId = args["config-id"] ?? "baseline";
  return {
    help: !!args.help,
    errors,
    root: args.root,
    corpusVersion: args["corpus-version"],
    configId,
    runId: args["run-id"] ?? `${nowIso().replace(/[:.]/g, "-")}__${configId}`,
    items: args.items === undefined ? null : String(args.items).split(",").map((s) => s.trim()).filter(Boolean),
    lensesDir: path.resolve(args["lenses-dir"] ?? path.join(HERE, "..", "lenses")),
    sdkVersion: args["sdk-version"] ?? pinnedSdkVersion(readFile ? { readFile } : {}),
    panelScript: path.resolve(args["panel-script"] ?? DEFAULT_PANEL_SCRIPT),
    panelShaOverride: args["panel-sha"] ?? null,
    repoSource: args["no-repo-context"] ? null : path.resolve(args["repo-source"] ?? path.join(HERE, "..", "..", "..")),
    noRepoContext: !!args["no-repo-context"],
    requireRepoContext: !!args["require-repo-context"],
    diffContent: !args["no-diff-content"],
    description: args.description ?? "",
  };
}

/**
 * The child environment for one panel spawn.
 *
 * `STAGE_DETAIL_DIFF_CONTENT` is turned ON for replays, reversing #644's default,
 * and the reasoning there is worth restating because it was good: the diff body is
 * 76–97% of the capture and is verbatim contributor text from a possibly-forked
 * branch, so in production it should be requested rather than defaulted. A replay
 * is the one consumer that docblock names — "a replay that feeds a lens the bytes
 * it actually saw" — and the bytes in question are already in our own frozen corpus
 * item, so nothing new is exposed by carrying them. Without it the stage fixture
 * records the WHOLE pull-request diff as the input to every lens.
 *
 * Turning it on is not enough, which is the other half of the decision: the flag's
 * absence is silent, so the runner ASSERTS the capture actually came back with
 * `lensDiff` rather than trusting that setting the variable worked.
 */
export function panelEnv(baseEnv, { diffContent }) {
  const env = { ...baseEnv };
  if (diffContent) env.STAGE_DETAIL_DIFF_CONTENT = "1";
  return env;
}

export async function main(argv) {
  const opts = resolveRunOptions(argv);
  if (opts.help) {
    console.log(USAGE);
    return 0;
  }
  if (opts.errors.length > 0) {
    console.error(`run: ${opts.errors.join(" ")}\n${USAGE}`);
    return 2;
  }

  // Before anything is spawned or written: which panel is this? A run that cannot
  // name its reviewer cannot be pooled with any other, so this refusal is free and
  // the alternative is 20 unattributable replays.
  const { panelSha, source: panelShaSource } = resolvePanelSha({
    panelScript: opts.panelScript,
    override: opts.panelShaOverride,
  });

  const store = new EvalStore(opts.root);
  const { manifest, snapshot, config_hash } = buildConfig(opts.lensesDir, {
    configId: opts.configId,
    sdkVersion: opts.sdkVersion,
    description: opts.description,
  });

  const corpus = store.getCorpus(opts.corpusVersion);
  if (!corpus) {
    console.error(`run: no corpus "${opts.corpusVersion}" under ${opts.root}`);
    return 1;
  }
  const plannedIds = opts.items ?? corpus.map((c) => c.id);
  if (plannedIds.length === 0) {
    console.error(`run: corpus "${opts.corpusVersion}" names no items`);
    return 1;
  }

  const runId = opts.runId;
  const runJson = () => ({
    schema_version: 1,
    run_id: runId,
    target: "reviewer",
    config_id: opts.configId,
    config_hash,
    panel_sha: panelSha,
    panel_sha_source: panelShaSource,
    corpus_version: opts.corpusVersion,
    sdk_version: manifest.sdk_version,
    diff_content_requested: opts.diffContent,
    repo_context: opts.noRepoContext ? "diff-only" : "tree",
  });
  const started = nowIso();
  // The partial record and the frozen config land BEFORE the first spawn, so a run
  // that dies on item one still says which reviewer it was going to be.
  store.putRun(runId, {
    runJson: { ...runJson(), started, finished: null, status: "partial", item_count: plannedIds.length, items_ok: 0, items_error: 0, totals: null, notes: "" },
    configSnapshot: snapshot,
  });

  const adapter = reviewerAdapter({ panelScript: opts.panelScript });
  const env = panelEnv(process.env, { diffContent: opts.diffContent });
  const repoCache = path.join(tmpdir(), "eval-repo-cache");
  const matLenses = materializeLenses(snapshot, mkdtempSync(path.join(tmpdir(), "eval-lenses-")));
  const totalSamples = snapshot.lenses.reduce((n, l) => n + sampleCountFor(l), 0);
  console.log(
    `run ${runId}: ${plannedIds.length} item(s) · config_hash=${config_hash} · panel=${panelSha.slice(0, 12)} (${panelShaSource}) · ` +
      `${snapshot.lenses.length} lenses / ${totalSamples} samples`,
  );

  let aborted = null;
  for (const itemId of plannedIds) {
    // Resume, and the only thing it costs is one `existsSync`. `hasItem` keys on
    // `envelope.json`, which `putItem` writes last, so a crash mid-item leaves the
    // item absent and it is retried rather than skipped forever.
    if (store.hasItem(runId, itemId)) {
      console.log(`  = ${itemId}: already stored, not re-run`);
      continue;
    }
    const input = store.getCorpusItemInput(itemId);
    if (!input) {
      // Absent from the corpus is a planning error, not an observation: recording
      // an envelope for it would put an item in the run that was never replayed.
      console.error(`  ! ${itemId}: not in corpus "${opts.corpusVersion}" — nothing to replay`);
      continue;
    }

    const workDir = mkdtempSync(path.join(tmpdir(), "eval-item-"));
    const outDir = path.join(workDir, "out");
    const ctx = materializeRepoAt({ repoSource: opts.repoSource, commit: input.meta?.review_commit, cacheRoot: repoCache });
    const repoDir = ctx.path ?? path.join(workDir, "repo");
    const contextFiles = ctx.files;
    if (opts.repoSource) {
      console.log(`  → ${itemId}: repo context = ${contextFiles ? `${contextFiles} files` : `DIFF-ONLY (unavailable${ctx.error ? `: ${ctx.error}` : ""})`}`);
    }

    let envelope, payload;
    const base = {
      run_id: runId, item_id: itemId, config_hash, panel_sha: panelSha, panel_sha_source: panelShaSource,
      corpus_version: opts.corpusVersion, timestamp: nowIso(),
      // The pointer PR 3's store decided on: a NAMED state, never null and never
      // "". Transcripts are 10–30 MB no metric reads and spec §8 keeps them out of
      // git, so `absent` is the ordinary answer rather than a failure.
      transcript: { state: "absent" },
      payload_ref: "payload.json",
    };
    const zeroCost = { cost_usd: 0, weighted_tokens: 0, raw_tokens: 0, sdk_duration_ms_sum: 0, turns: 0, calls: 0, duration_ms: null, duration_source: "not-run" };

    // The one guard the $44 postmortem produced. Default OFF today: a diff-only
    // replay over-flags, which explodes the verifier fan-out and the bill, but the
    // tree this runner can build is an archive rather than a worktree, so making it
    // mandatory belongs with the thing that makes it satisfiable (PR 6).
    if (opts.requireRepoContext && !opts.noRepoContext && contextFiles === 0) {
      const message = `repo context required but unavailable for ${itemId} at ${String(input.meta?.review_commit).slice(0, 12)}${ctx.error ? `: ${ctx.error}` : ""}`;
      envelope = { ...base, ...zeroCost, status: "error", reason: "no-repo-context", repo_context_files: 0, gate: { state: "not-run", line: null }, error: { message, kind: "no-repo-context" } };
      payload = { adapter: "reviewer", error: message };
      store.putItem(runId, itemId, { envelope, payload });
      console.error(`  ! ${itemId}: no model calls — ${message}`);
      continue;
    }

    try {
      const inputs = adapter.prepareInput(input, workDir);
      // The panel is silent for minutes but writes each lens's `conclusion` file as
      // that lens finishes, so poll for them rather than showing a dead wait.
      const lensIds = snapshot.lenses.map((l) => l.id);
      const t0 = Date.now();
      const tty = process.stdout.isTTY;
      process.stdout.write(`  → ${itemId}: reviewing (${lensIds.length} lenses, ${totalSamples} samples)…${tty ? "" : "\n"}`);
      const hb = setInterval(() => {
        const done = lensIds.filter((id) => existsSync(path.join(outDir, id, "conclusion"))).length;
        const secs = Math.round((Date.now() - t0) / 1000);
        const msg = `  → ${itemId}: ${done}/${lensIds.length} lenses · ${secs}s`;
        if (tty) process.stdout.write(`\r${msg}   `); else if (secs % 30 === 0) process.stdout.write(`${msg}\n`);
      }, tty ? 2000 : 5000);
      let ran;
      try {
        // ASSIGNED, which is the whole of defect 2. `runAgent` resolves rather than
        // rejects by design — a spawn failure and a non-zero exit are the same kind
        // of fact about this item — so dropping the result was the only thing
        // between a crashed panel and `status: "ok"`. `captureArtifacts` takes this
        // value, so it cannot be dropped again without the call failing.
        //
        // `baseSha` is deliberately not passed: see `materializeRepoAt`.
        ran = await adapter.runAgent(inputs, { lensesDir: matLenses, outDir, repoDir, env });
      } finally {
        clearInterval(hb);
        if (tty) process.stdout.write(`\r${" ".repeat(56)}\r`);
      }
      const cap = adapter.captureArtifacts(ran);
      const cost = sumExecutions(cap.executionMessages ?? [], "review");
      const outcome = classifyItemOutcome({
        exitCode: cap.exitCode,
        panelState: cap.panelState,
        panel: cap.payload.panel,
        calls: cost.calls,
        gate: cap.gate,
        baseShaPassed: cap.baseShaPassed,
        diffContent: cap.diffContent,
        diffContentRequested: opts.diffContent,
      });
      payload = { ...cap.payload, exit_code: cap.exitCode, stderr_tail: cap.stderr.split("\n").slice(-20).join("\n") };
      envelope = {
        ...base,
        status: outcome.status,
        reason: outcome.reason,
        error: outcome.error,
        cost_usd: cost.costUsd,
        weighted_tokens: cost.weightedTokens,
        raw_tokens: cost.tokens,
        turns: cost.turns,
        calls: cost.calls,
        // TRUE wall-clock, or `null` and why. Substituting the summed value would
        // report our own arm's latency 3–5× high on a headline axis, against a
        // CodeRabbit number that is real wall-clock from comment timestamps.
        duration_ms: cap.wallMs,
        duration_source: cap.wallMs === null ? "absent" : "review-timing.json",
        // NOT a duration. Kept because it is real data about SDK compute, named so
        // nobody reads it as elapsed time.
        sdk_duration_ms_sum: cost.durationMs,
        exit_code: cap.exitCode,
        gate: cap.gate,
        base_sha_passed: cap.baseShaPassed,
        diff_content: cap.diffContent,
        repo_context_files: contextFiles,
      };
      if (outcome.fatal) aborted = { itemId, reason: outcome.reason, message: outcome.error.message };
    } catch (e) {
      envelope = { ...base, ...zeroCost, status: "error", reason: "exception", repo_context_files: contextFiles, gate: { state: "not-run", line: null }, error: { message: e.message, kind: "exception" } };
      payload = { adapter: "reviewer", error: e.message };
    }
    store.putItem(runId, itemId, { envelope, payload });
    const bytes = Buffer.byteLength(JSON.stringify(payload));
    console.log(
      `  ${envelope.status === "ok" ? "+" : "!"} ${itemId}: ${envelope.status}${envelope.reason ? ` (${envelope.reason})` : ""} · ` +
        `$${(envelope.cost_usd || 0).toFixed(2)} · gate ${envelope.gate.state} · ${(bytes / 1024).toFixed(0)} KiB payload`,
    );
    // ABORT, do not degrade. Both fatal reasons are misconfigurations that will be
    // identical for every remaining item, and each of those items costs money. The
    // failing item is STORED first — the evidence is what makes it fixable — and
    // then the run stops.
    if (aborted) {
      console.error(`run ${runId}: ABORTED at ${aborted.itemId} — ${aborted.reason}: ${aborted.message}`);
      break;
    }
  }

  const s = summarizeRun(store, runId, plannedIds);
  const status = aborted ? "aborted" : s.complete ? "complete" : "partial";
  store.putRun(runId, {
    runJson: {
      ...runJson(), started, finished: nowIso(), status,
      item_count: plannedIds.length, items_ok: s.items_ok, items_error: s.items_error,
      totals: s.totals,
      notes: aborted ? `aborted at ${aborted.itemId}: ${aborted.reason}` : "",
    },
    configSnapshot: snapshot,
  });
  const wall = s.totals.duration_items > 0 ? `${Math.round(s.totals.duration_ms / 1000)}s over ${s.totals.duration_items}/${s.items_present} timed item(s)` : "no timing recorded";
  console.log(`run ${runId}: ${status} — ok=${s.items_ok} error=${s.items_error} · $${s.totals.cost_usd.toFixed(2)} · ${wall}`);
  return aborted || s.items_error > 0 || !s.complete ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv).then(
    (code) => process.exit(code),
    // No prefix added here. Every refusal this can surface already names its own
    // module — `run: …` from the guards above, `eval store: …` from the store — and
    // prefixing again produced `run: run: --panel-script points at …` on the first
    // real invocation.
    (e) => { console.error(e.message); process.exit(1); },
  );
}
