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
// finds out. THREE of the failures are further treated as FATAL to the whole run
// rather than to one item — see `FATAL_REASONS` — because they are misconfigurations
// that will be identical for the next nineteen items and each of those costs money.
//
// FIDELITY: WHAT IS REPLAYED IS THE REVIEWER THAT SHIPS. The review tree is a
// real linked git WORKTREE at `review_commit`, not an archived tree, and the
// item's frozen `review_base` is passed as `--base-sha`. Both halves are needed
// and neither is sufficient: the shipped gate routes blocking findings through a
// novelty lane decided by `git blame` (#668), so an archived tree with no `.git`
// made every replay measure the gate OFF. Findings still carried a lane —
// `routeFinding` defaults to `blocking` when novelty is `unknown` — but
// `lane: "backlog"` was UNREACHABLE, and nothing in the output said so.
//
// THIS RUN SPENDS MONEY. It spawns the panel, which calls models. Tests drive it
// with `adapters/stub-panel.mjs` instead, which is why `--panel-script` exists.
//
// TWO GUARDS BOUND THE SPEND, AND THEY ARE DIFFERENT SHAPES BECAUSE THE FACTS
// ARRIVE AT DIFFERENT TIMES. Cost is only knowable after an item finishes — the
// panel writes `review-execution.json` as it exits — so a `--max-cost-usd` cap
// can stop the NEXT item and can never stop the current one. The only bound on a
// single item is `--panel-timeout`, and it bounds TIME, not dollars. Stating that
// limit is the point: the #521 pilot billed $44 for roughly one usable data point
// with nothing capped and nobody watching, and a guard that overclaimed here
// would be the same failure in a new place.
//
// NEITHER GUARD CAN BE FORGOTTEN. The timeout has a default and cannot be
// switched off. The cap has NO DEFAULT and is not optional either: a run must
// pass `--max-cost-usd <n>` or say `--no-cost-cap` out loud. See
// `resolveRunOptions` for why an unbounded run is a choice rather than a
// fallback.

import { mkdtempSync, mkdirSync, existsSync, writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { repoScopedEnv } from "../vendor/pipeline/git-env.mjs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EvalStore } from "./store.mjs";
import { buildConfig, materializeLenses, pinnedSdkVersion } from "./config-build.mjs";
import { reviewerAdapter, GATE_STATES } from "./adapters/reviewer.mjs";
import { sumExecutions } from "../vendor/pipeline/metrics.mjs";
import { sampleCountFor } from "../vendor/pipeline/review-panel.mjs";
import { baseResolves } from "../vendor/pipeline/novelty.mjs";
import { parseArgs } from "../vendor/pipeline/gh-checks.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHA40 = /^[0-9a-f]{40}$/;
const nowIso = () => new Date().toISOString();

/** The panel this runner replays. Resolved as its own SIBLING, which is exactly
 *  why `panel_sha` is not optional — see `resolvePanelSha`. */
export const DEFAULT_PANEL_SCRIPT = path.join(HERE, "..", "review-panel.mjs");

/**
 * How long one panel gets before its process group is killed, in seconds.
 *
 * A RUNAWAY DETECTOR, NOT A TUNING DIAL, and it is deliberately generous. #669
 * measured a real panel at roughly twelve minutes of wall-clock, so 45 leaves
 * nearly 4× headroom for the largest item in a corpus: a timeout that fires on a
 * slow-but-working panel would discard a paid replay, which is a worse failure
 * than the one it prevents. It is also 15× `--test-timeout`'s 60s, which bounds a
 * hung TEST rather than a hung panel — different guards, different scales.
 *
 * There is deliberately no way to switch it off. A tool that spawns model calls
 * having no ceiling is the state this PR ends, and "off" would be the first thing
 * anyone reached for after one false positive.
 */
export const DEFAULT_PANEL_TIMEOUT_S = 45 * 60;

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
 *   panel-timeout    it never exited and we killed it
 *   no-panel-json    it exited 0 and wrote no usable `panel.json`
 *   gate-degraded    the novelty gate's state disagrees with what we asked for
 *   gate-unreported  the panel printed no gate line at all
 *   no-lens-diff     the capture omits the routed diff each lens read
 *   infra            a lens hit auth/quota — the reviewer never ran
 *   no-output        the panel made no SDK calls
 *   no-repo-context  `--require-repo-context` and the tree would not materialise
 *   no-base-sha      the corpus item carries no usable `review_base`
 *   base-unresolved  it carries one, and the materialised tree does not have it
 *   exception        the runner itself threw on this item
 *
 * `run.test.mjs` asserts the classifier emits nothing outside this list, so a new
 * failure mode cannot be added as an unlabelled string.
 */
export const ITEM_REASONS = Object.freeze([
  "panel-exit",
  "panel-timeout",
  "no-panel-json",
  "gate-degraded",
  "gate-unreported",
  "no-lens-diff",
  "infra",
  "no-output",
  "no-repo-context",
  "no-base-sha",
  "base-unresolved",
  "exception",
]);

/**
 * The failures that stop the whole run rather than one item — see the header.
 *
 * The test for membership is NOT "would the next item fail the same way": it is
 * "would the next item COST MONEY before failing the same way". `no-repo-context`,
 * `no-base-sha` and `base-unresolved` are all run-wide misconfigurations in
 * practice — a shallow clone breaks every item's base — and all three are
 * deliberately absent from this list, because each refuses BEFORE the spawn. A
 * run of seven free refusals costs nothing and names seven remedies instead of
 * one. `no-repo-context` set that precedent in #682; the two new pre-spawn guards
 * follow it rather than inventing a second rule.
 *
 * `panel-timeout` is likewise absent, and that one is a judgement rather than a
 * consequence: a timeout DID cost money, but it is also the failure most likely
 * to be about ONE item, since replay cost tracks diff size and a corpus spans an
 * order of magnitude of it. Bounding the run when timeouts repeat is the cost
 * cap's job, and the cap does it by measuring spend rather than by inferring a
 * bill from a reason string.
 */
export const FATAL_REASONS = Object.freeze(["gate-degraded", "gate-unreported", "no-lens-diff"]);

/**
 * How a run ended, as a closed list — `run.json`'s `status`, which the store does
 * NOT validate (it validates item envelopes only), so the vocabulary is owned and
 * pinned here.
 *
 *   complete  every planned item is stored
 *   partial   some are not, and nothing stopped the run on purpose
 *   aborted   a FATAL_REASON was hit: something is misconfigured, fix it
 *   capped    the run stopped itself at `--max-cost-usd`: nothing is wrong
 *
 * `capped` is separate from `aborted` on the same grounds as the item vocabulary,
 * and this project has the lesson written down twice: absent has more than one
 * cause and pooling them is a scoring bug. A reader deciding whether a corpus run
 * is usable needs "aborted at item 2 because the gate was off" (nothing here is
 * poolable) told apart from "capped after item 5" (five real verdicts, stopped on
 * purpose) — and the responses differ too: fix something, versus raise the cap and
 * resume the same run id. Folding both into `aborted` with the difference in a
 * free-text `notes` is exactly what the item-level closed vocabulary exists to
 * prevent one level down.
 */
export const RUN_STATUSES = Object.freeze(["complete", "partial", "aborted", "capped"]);

/**
 * The gate state for an item whose panel NEVER RAN, and so is the runner's to
 * declare rather than the adapter's.
 *
 * `GATE_STATES` covers what the panel can REPORT; this covers the two paths that
 * never reach a panel at all — the repo-context guard, which refuses before
 * spawning, and an exception in the runner itself. Neither can honestly claim any
 * of the four reported states, and least of all `off-no-base-sha`, which would read
 * as "the gate was asked and answered".
 *
 * Named rather than written twice as a literal: `validateRunEnvelope` only requires
 * `gate.state` to be a non-empty string, so a typo at one of the two sites would
 * store a second, silent gate vocabulary. `run.test.mjs` pins the full declared set.
 */
export const GATE_NOT_RUN = "not-run";

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
  timedOut = false,
  timeoutMs = null,
  panelState,
  panel,
  calls,
  gate,
  baseShaPassed = false,
  diffContent,
  diffContentRequested = false,
} = {}) {
  // ABOVE the exit code, because a killed child reports `code: null` and would
  // otherwise be filed as `panel-exit`. "We stopped it" and "it crashed" are
  // different facts with different responses — raise the timeout, versus find out
  // why the panel died — and the cause is the one that belongs in the envelope.
  if (timedOut) {
    return err(
      "panel-timeout",
      `the panel did not exit within ${timeoutMs ?? "the"}ms and its process group was killed — ` +
        "whatever it had written is a partial review, not a verdict",
    );
  }
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
 *
 * GIT'S OWN BOOKKEEPING IS EXCLUDED, and that is a guard rather than tidiness. A
 * linked worktree's `.git` is a FILE holding a `gitdir:` pointer, so counting it
 * would make an EMPTY checkout report `files: 1` — and `--require-repo-context`
 * fires on `contextFiles === 0`. The guard would still be configured, still be on,
 * and never fire again: satisfiable without being satisfied. The `.git`-prefix
 * test rather than a name test so that a `.git` DIRECTORY, if one ever appears
 * here, does not contribute thousands of objects to a fidelity field either.
 */
function countFiles(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true }).filter(
    (d) => d.isFile() && path.relative(dir, path.join(d.parentPath, d.name)).split(path.sep)[0] !== ".git",
  ).length;
}

/**
 * Undo one worktree this runner created, by path, and never any other.
 *
 * A worktree is REGISTERED in the source repository's `.git`, so cleaning one up
 * is "deregister an entry", not "delete a directory" — and this machine's working
 * clone has eight linked worktrees belonging to real branches, two of them nested
 * inside the repository directory. `git worktree remove` on a wrong path deletes
 * somebody's working directory, and `git worktree prune` deregisters by
 * reachability rather than by ownership. So neither is ever pointed at anything
 * except a path the runner itself made under its own `mkdtemp` root.
 *
 * Best-effort, and never throws: this runs in cleanup positions where the useful
 * work is already stored, and a failure to deregister costs a stale administrative
 * entry, not a result.
 */
export function removeWorktreeAt(repoSource, dir, { git = gitLines } = {}) {
  if (!repoSource || !dir) return false;
  try {
    git(["-C", repoSource, "worktree", "remove", "--force", dir], repoSource);
    return true;
  } catch {
    // Not a registered worktree, or the repo is gone. Either way the directory
    // itself is ours and goes below.
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(`${dir}.materialized`, { force: true });
  }
}

/**
 * Deregister and delete every worktree under `cacheRoot`, then the root itself.
 *
 * Safe to call on a root that holds nothing, and safe to call twice. The root is
 * per-process (`mkdtemp`), which is what makes "everything under it is ours" true
 * rather than hopeful.
 */
export function cleanupRepoCache(repoSource, cacheRoot, { git = gitLines } = {}) {
  if (!cacheRoot || !existsSync(cacheRoot)) return 0;
  let removed = 0;
  for (const entry of readdirSync(cacheRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (removeWorktreeAt(repoSource, path.join(cacheRoot, entry.name), { git })) removed++;
  }
  rmSync(cacheRoot, { recursive: true, force: true });
  return removed;
}

/**
 * Materialise the repository tree at `commit` as a REAL LINKED GIT WORKTREE, so
 * lenses reason from real surrounding code AND the novelty gate can blame against
 * it.
 *
 * WHY A WORKTREE AND NOT AN ARCHIVE. The version this replaces ran `git archive |
 * tar -x`, which produces a tree with no `.git` at all. The shipped gate routes
 * blocking findings through a novelty lane decided by `git blame` (#668), so an
 * archived tree cannot be blamed, a `--base-sha` could not resolve in it, and every
 * replay measured the gate OFF — `lane: "backlog"` unreachable, with nothing in the
 * output saying so. A worktree costs ~44 MB per commit here, shares the source
 * repository's object store, and puts `HEAD` at `commit`, which is what `noveltyOf`
 * blames.
 *
 * Always returns the same SHAPE — `{path, files, error}` with `path: null` on
 * failure — because the version before last promised `null` in its docstring and
 * returned an object from its catch branch, so `ctx?.path` was load-bearing in a
 * way nothing stated.
 *
 * THE COMMIT IS CHECKED FOR BEFORE ANYTHING IS BUILT, and the refusal names the
 * fetch that fixes it. This is not defensive padding: `wafflebase` SQUASH-merges,
 * so a pull request's head commit is never reachable from `main`; `extract-corpus`
 * fetches it to `refs/eval/pr/<n>` to freeze the item; and the freeze plan's own
 * cleanup step deletes those refs. What is left is an unreachable object alive only
 * until `git gc` prunes it. The runner does NOT fetch it back itself — see the task
 * doc, decision 2 — so this message is the whole remedy and has to carry the
 * command.
 *
 * ONE CACHE ROOT PER PROCESS, which is how the race the version this replaces
 * documented is answered. That root is `mkdtemp`ed by `main`, so nothing outside
 * this run can observe a half-built tree, and no staging-plus-rename is needed —
 * the version of that fix written during PR 5 broke CI twice and was reverted.
 * Keyed by commit inside the root, so two items (or two replicates) at one commit
 * share one worktree; the gate only reads, so sharing is safe.
 *
 * HOOKS ARE DISABLED for the checkout. `git worktree add` runs `post-checkout`, and
 * `git archive` ran nothing — so switching to a worktree would otherwise start
 * executing hook scripts out of the repository under review, on every item. Pointed
 * at a path that does not exist rather than trusting that none are installed.
 */
export function materializeRepoAt({ repoSource, commit, cacheRoot, sourcePr = null }) {
  if (!commit || !repoSource) return { path: null, files: 0, error: "no repo source or commit" };
  // THE SAME READ-PATH BACKSTOP `review_base` GETS, and for the same reason:
  // `validateCorpusItem` refuses a non-SHA `review_commit` at the store's WRITE
  // path, but the corpus is a separate hand-committed repository and
  // `getCorpusItemInput` does not re-validate what it reads. Guarding only the
  // write door is how `assertEffort` came to be inert.
  //
  // Here the fail direction is worse than a low-fidelity replay, which is why it
  // is checked BEFORE `dest` exists rather than alongside the other item guards
  // in `main`. This value is interpolated into a path that is later handed to
  // `git worktree remove` and to `rmSync(..., { recursive: true })`, so one
  // containing `..` would put `dest` outside this run's own `mkdtemp` root — and
  // the whole safety argument for that teardown is that it only ever addresses
  // paths inside it.
  if (!SHA40.test(String(commit))) {
    return {
      path: null,
      files: 0,
      error: `review_commit must be 40 lowercase hex characters, got ${JSON.stringify(commit)} — re-freeze the item with extract-corpus.mjs`,
    };
  }
  const dest = path.join(cacheRoot, commit);
  // OUTSIDE `dest`, so the tree the panel reads is exactly the commit's tree and
  // the file count cannot include our own bookkeeping.
  const mark = `${dest}.materialized`;
  if (existsSync(mark)) {
    const recorded = Number(readFileSync(mark, "utf8").trim().split(/\s+/)[1]);
    return { path: dest, files: Number.isFinite(recorded) ? recorded : countFiles(dest), error: null };
  }
  // `repoScopedEnv`, because `-C` DOES NOT SCOPE GIT ON ITS OWN.
  //
  // `GIT_DIR` in the environment overrides both `-C` and `cwd`. Anything running
  // inside a git hook has it set — `pre-push` runs `verify:self`, so the whole
  // suite inherits it — and these calls would then read the AMBIENT repository
  // instead of `repoSource`. Silently: git succeeds and the panel reviews a tree
  // from the wrong repository. Verified upstream to be worktree-safe: the
  // `gitdir:` pointer is still followed, because the ceiling this sets constrains
  // directory discovery, not pointer resolution.
  const env = repoScopedEnv(repoSource);
  const run = (args) => execFileSync("git", args, { stdio: "pipe", env });
  try {
    run(["-C", repoSource, "cat-file", "-e", `${commit}^{commit}`]);
  } catch {
    const fetch = sourcePr
      ? `git -C ${repoSource} fetch origin refs/pull/${sourcePr}/head:refs/eval/pr/${sourcePr}`
      : `git -C ${repoSource} fetch origin ${commit}`;
    return {
      path: null,
      files: 0,
      error: `commit ${String(commit).slice(0, 12)} is not in ${repoSource} — the item was frozen against a ref that has since been deleted or pruned. Fetch it: ${fetch}`,
    };
  }
  try {
    // A leftover `dest` can only come from this run crashing mid-add, but it would
    // also be a REGISTERED worktree, so it is deregistered rather than deleted.
    removeWorktreeAt(repoSource, dest);
    mkdirSync(cacheRoot, { recursive: true });
    run([
      "-c", `core.hooksPath=${path.join(cacheRoot, "no-hooks")}`,
      "-C", repoSource,
      "worktree", "add", "--detach", "--quiet", dest, commit,
    ]);
    const files = countFiles(dest);
    writeFileSync(mark, `${commit} ${files}\n`);
    return { path: dest, files, error: null };
  } catch (e) {
    removeWorktreeAt(repoSource, dest);
    // Surface git's own stderr rather than swallowing it: a silent 0-file checkout
    // is how the #521 pilot billed $44 for a full diff-only run without anyone
    // noticing.
    const why = (e.stderr?.toString?.() || e.message || "").split("\n").find((l) => l.trim()) || "unknown";
    return { path: null, files: 0, error: why };
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

/**
 * The injected side effect `resolvePanelSha` and the worktree cleanup need, as
 * lines.
 *
 * `envRoot` is optional because the two callers differ: `resolvePanelSha` reads
 * THIS checkout and wants whatever environment it is running under, while the
 * worktree calls address `repoSource` and must be scoped to it for the reason
 * written at `materializeRepoAt`.
 */
function gitLines(args, envRoot) {
  return execFileSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...(envRoot ? { env: repoScopedEnv(envRoot) } : {}),
  }).split("\n").map((l) => l.trim());
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

  node scripts/agent/eval/run.mjs --root <eval-repo> --corpus-version <v> \\
                                  (--max-cost-usd <n> | --no-cost-cap) [options]

THIS SPENDS MONEY: it spawns review-panel.mjs, which calls models. That is why
the ceiling is in the synopsis and not in the option list: it has no default.

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
  --repo-source <dir>     Clone to materialise the review worktree from (default:
                          this repository). Must hold each item's review_commit.
  --no-repo-context       Replay diff-only: hand the panel an empty --repo, and
                          pass no --base-sha. LOWER FIDELITY — the novelty gate
                          cannot run, and a diff-only replay over-flags.
  --require-repo-context  Refuse to spend on an item whose tree will not
                          materialise. DEFAULT ON.
  --no-require-repo-context
                          Let an item whose tree will not materialise fall back to
                          diff-only instead of being refused. A run may then mix
                          fidelities, and says so: repo_context = "tree-optional".
  --panel-timeout <s>     Kill the panel's process group after this many seconds.
                          Default ${DEFAULT_PANEL_TIMEOUT_S}. Cannot be disabled.
  --max-cost-usd <n>      Stop the run before the next item once this much has
                          been spent. Bounds the RUN, not an item — cost is only
                          known after an item finishes. REQUIRED, no default;
                          pass --no-cost-cap to run unbounded on purpose.
  --no-cost-cap           Run with no cost ceiling. An explicit choice, never a
                          fallback: spend is then bounded only by the per-item
                          --panel-timeout and by the number of items.
  --no-diff-content       Do not ask the capture for the routed per-lens diff.
  --description <text>    Recorded in the config manifest.

Exit codes: 0 every planned item is stored and ok · 1 an item failed, the run
aborted, or it stopped at the cost cap · 2 usage.`;

/**
 * Resolve the CLI's options. Exported and pure, so the properties that matter are
 * testable without spending anything.
 *
 * `--root` has NO DEFAULT and neither does `--corpus-version`. #675 set that rule
 * for a reason that has not changed: git history is permanent, so one forgotten
 * flag falling back to a path inside this repository would commit benchmark data
 * into `wafflebase` for good, and no later `git rm` shrinks anyone's clone.
 *
 * THE COST CAP IS THE SAME SHAPE, AND IT IS NOT A DEFAULT-OFF FLAG. A run must
 * state a ceiling — `--max-cost-usd <n>` — or state that it wants none —
 * `--no-cost-cap`. The first draft of this defaulted to no cap, reasoning that a
 * cap picked for someone silently truncates a legitimate run, which is true and
 * is the wrong trade: the failure it guards against is the #521 pilot, $44 for
 * roughly one usable data point with nobody watching, and an operator who
 * forgets a flag is precisely the operator in that postmortem. A truncated run
 * is recoverable — raise the cap, resume the same `--run-id`, pay for nothing
 * twice. Money already spent is not. So the unbounded run stays available and
 * stops being the thing you get by omission, which is the same rule `--root`
 * follows: an irreversible default is not a convenience.
 *
 * `--no-cost-cap` is a NEGATION WITH NOTHING TO NEGATE, unlike
 * `--no-require-repo-context` — there is no default for it to turn off. It reads
 * that way because a reviewer scanning a command line for what bounds it should
 * find either a number or an explicit refusal of one, never silence.
 *
 * `requireRepoContext` and `diffContent` both default ON, and the reasons are
 * different rather than shared. The diff-content flag decides whether the capture
 * carries bytes we already hold in the corpus item, and its absence is SILENT —
 * the downstream fixture builder substitutes the whole pull-request diff — so it
 * defaults on and is asserted rather than trusted. The repo-context guard changes
 * what a replay costs and what it measures, and it defaults on now because the
 * worktree finally makes it satisfiable: a replay without the tree cannot run the
 * novelty gate, and a diff-only one over-flags, which is what exploded the #521
 * pilot's verifier fan-out into $44 for roughly one usable data point.
 *
 * A DEFAULT MAY BE OVERRIDDEN SILENTLY; AN EXPLICIT FLAG MAY NOT BE CONTRADICTED.
 * That is the whole rule behind the two conflicts below. `--no-repo-context` on
 * its own is a deliberate low-fidelity run and turns the guard off, because there
 * is no tree to require — no contradiction, just a narrower request. Passing it
 * TOGETHER with `--require-repo-context` states two incompatible intentions, and
 * resolving that silently in either direction is how a run ends up measuring
 * something nobody asked for. Same for `--require-repo-context` with its own
 * negation. Both are usage errors, and the CLI says which pair.
 */
export function resolveRunOptions(argv, { readFile } = {}) {
  const args = parseArgs(argv, {
    booleans: ["help", "no-repo-context", "require-repo-context", "no-require-repo-context", "no-cost-cap", "no-diff-content"],
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
  const noRepoContext = !!args["no-repo-context"];
  const requireExplicit = !!args["require-repo-context"];
  const requireNegated = !!args["no-require-repo-context"];
  if (requireExplicit && noRepoContext) {
    errors.push("--require-repo-context and --no-repo-context contradict each other: one demands the review tree, the other refuses to build it. Pass neither for the default (tree required), or --no-repo-context alone for a deliberate diff-only replay.");
  }
  if (requireExplicit && requireNegated) {
    errors.push("--require-repo-context and --no-require-repo-context contradict each other.");
  }
  // Seconds in, milliseconds out — the flag is human-facing and the timer is not.
  const timeoutS = args["panel-timeout"] === undefined ? DEFAULT_PANEL_TIMEOUT_S : Number(args["panel-timeout"]);
  if (!Number.isFinite(timeoutS) || timeoutS <= 0) {
    errors.push(`--panel-timeout must be a positive number of seconds, got ${JSON.stringify(args["panel-timeout"])}. There is no way to disable it: a runner that spawns model calls with no ceiling is the thing this guard exists to prevent.`);
  }
  const capGiven = args["max-cost-usd"] !== undefined;
  const capRefused = !!args["no-cost-cap"];
  const maxCost = capGiven ? Number(args["max-cost-usd"]) : null;
  if (capGiven && capRefused) {
    errors.push("--max-cost-usd and --no-cost-cap contradict each other: one sets a ceiling, the other refuses to have one. Pass exactly one.");
  } else if (!capGiven && !capRefused) {
    errors.push("--max-cost-usd <n> is required and has no default. A replay spends real money and the #521 pilot billed $44 for roughly one usable data point, so an unbounded run has to be asked for: pass --no-cost-cap to run with no ceiling.");
  } else if (capGiven && (!Number.isFinite(maxCost) || maxCost < 0)) {
    errors.push(`--max-cost-usd must be a non-negative number, got ${JSON.stringify(args["max-cost-usd"])}.`);
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
    repoSource: noRepoContext ? null : path.resolve(args["repo-source"] ?? path.join(HERE, "..", "..", "..")),
    noRepoContext,
    // Default ON. `--no-repo-context` is not a contradiction of it, it removes the
    // subject — there is no tree to require — and the guard's own condition keeps
    // that explicit rather than relying on this line.
    requireRepoContext: !requireNegated && !noRepoContext,
    requireRepoContextRelaxed: requireNegated,
    panelTimeoutMs: Number.isFinite(timeoutS) && timeoutS > 0 ? Math.round(timeoutS * 1000) : null,
    // `null` means "asked for no ceiling", never "forgot to say" — the error above
    // is what makes those two distinguishable downstream, including in `run.json`.
    maxCostUsd: capRefused ? null : maxCost,
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
    // THREE values, not two. `tree` is now a promise the run kept — every item
    // was replayed against a worktree or was refused — which is only true because
    // the guard defaults on. `tree-optional` is the relaxed run, where items may
    // differ in fidelity from each other; a scorer that pooled those with `tree`
    // would be averaging two reviewers. Naming it is cheaper than detecting it
    // from `repo_context_files` after the fact.
    repo_context: opts.noRepoContext ? "diff-only" : opts.requireRepoContextRelaxed ? "tree-optional" : "tree",
    panel_timeout_ms: opts.panelTimeoutMs,
    max_cost_usd: opts.maxCostUsd,
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
  // PER PROCESS, not the shared `tmpdir()/eval-repo-cache` this replaces. A
  // worktree is registered in the source repository's `.git`, so a root shared
  // between runners would have them deregistering each other's entries — and the
  // cross-process race the archived version documented (rmSync-then-rebuild, with
  // a concurrent reader able to see a half-built tree) disappears rather than
  // needing the staging-plus-rename that broke CI twice during PR 5.
  const repoCache = mkdtempSync(path.join(tmpdir(), "eval-worktrees-"));
  const matLenses = materializeLenses(snapshot, mkdtempSync(path.join(tmpdir(), "eval-lenses-")));
  const totalSamples = snapshot.lenses.reduce((n, l) => n + sampleCountFor(l), 0);
  console.log(
    `run ${runId}: ${plannedIds.length} item(s) · config_hash=${config_hash} · panel=${panelSha.slice(0, 12)} (${panelShaSource}) · ` +
      `${snapshot.lenses.length} lenses / ${totalSamples} samples`,
  );
  // An absent cap is a fact about this run, and it is said out loud for the same
  // reason the gate's OFF line is: the two runs are indistinguishable in the
  // output afterwards, and only one of them was bounded. It can no longer be an
  // absent-mindedly absent cap — `--no-cost-cap` had to be typed — so the line
  // names the flag that produced it rather than the one that was missing.
  console.log(
    opts.maxCostUsd === null
      ? `run ${runId}: NO COST CAP (--no-cost-cap) — spend is bounded only by the ${Math.round(opts.panelTimeoutMs / 1000)}s per-item timeout and by ${plannedIds.length} item(s)`
      : `run ${runId}: cost cap $${opts.maxCostUsd.toFixed(2)} — the run stops before the item that would exceed it`,
  );

  let aborted = null;
  let capped = null;
  // Seeded from what is ALREADY STORED, so resuming a run id resumes its budget
  // too. A cap that reset to zero on resume would let three resumes of a $20 run
  // spend $60 while every one of them reported staying inside the cap.
  let spentUsd = summarizeRun(store, runId, plannedIds).totals.cost_usd;
  const notReplayed = [];
  // EVERYTHING FROM HERE IS INSIDE A try/finally, and the finally is the point.
  // A worktree is registered in the SOURCE repository's `.git`, so skipping the
  // teardown does not leak a directory, it leaves administrative state in
  // somebody's working clone. Anything in the loop can throw — `getCorpusItemInput`
  // on a malformed item, `putItem` on a write-once collision, `putRun` on a full
  // disk — and the per-item `catch` below covers only the panel call, so before
  // this the ordinary failure path skipped cleanup entirely.
  try {
    for (const itemId of plannedIds) {
      // Resume, and the only thing it costs is one `existsSync`. `hasItem` keys on
      // `envelope.json`, which `putItem` writes last, so a crash mid-item leaves the
      // item absent and it is retried rather than skipped forever.
      if (store.hasItem(runId, itemId)) {
        console.log(`  = ${itemId}: already stored, not re-run`);
        continue;
      }
      // THE CAP STOPS THE NEXT ITEM, AND IT CANNOT STOP THIS ONE. Cost arrives in
      // `review-execution.json`, which the panel writes as it finishes, so there is
      // no moment during an item at which the runner knows what it is spending. A
      // cap is therefore a bound on the RUN and the per-item bound is the timeout,
      // which bounds time and not dollars. Saying that plainly is the honest limit
      // of what a `--max-cost-usd` claims.
      //
      // Checked here rather than after the previous item so that `--max-cost-usd 0`
      // spawns nothing at all, and so that a resumed run over its budget stops
      // before spending again.
      if (opts.maxCostUsd !== null && spentUsd >= opts.maxCostUsd) {
        capped = { itemId, spentUsd, cap: opts.maxCostUsd };
        notReplayed.push(...plannedIds.slice(plannedIds.indexOf(itemId)).filter((id) => !store.hasItem(runId, id)));
        break;
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
      const ctx = materializeRepoAt({
        repoSource: opts.repoSource,
        commit: input.meta?.review_commit,
        cacheRoot: repoCache,
        sourcePr: input.meta?.source_pr ?? null,
      });
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

      // The three PRE-SPAWN refusals, in the order the facts become available:
      // is there a tree, does the item name a base, does that base exist in the
      // tree. Every one of them stores a zero-cost error item and moves on, and none
      // is fatal — see `FATAL_REASONS` for why "free" and not "run-wide" is the test.
      //
      // The shared shape is deliberate. Each refuses BEFORE the money is spent, each
      // records `GATE_NOT_RUN` because no panel ran and no reported gate state could
      // honestly be claimed, and each names the remedy in its message rather than
      // leaving a reader to derive it from a reason string.
      const refuseItem = (reason, message) => {
        envelope = { ...base, ...zeroCost, status: "error", reason, repo_context_files: contextFiles, gate: { state: GATE_NOT_RUN, line: null }, error: { message, kind: reason } };
        payload = { adapter: "reviewer", error: message };
        store.putItem(runId, itemId, { envelope, payload });
        console.error(`  ! ${itemId}: no model calls — ${message}`);
        // AND THE SCRATCH DIRECTORY GOES, which is not a contradiction of the
        // keep-the-evidence rule below. That rule keeps a FAILED item's directory
        // because it holds the only copy of what a crashed panel wrote. A refusal
        // happens before `prepareInput`, so nothing has been written into it and
        // there is nothing to keep — the remedy is in the message, not on disk.
        // Left behind, one `eval-item-*` per refusal accumulates in `tmpdir()`,
        // and a run of seven free refusals is exactly the case this PR added.
        rmSync(workDir, { recursive: true, force: true });
      };

      // The guard the $44 postmortem produced, and DEFAULT ON as of this change: a
      // diff-only replay over-flags, which explodes the verifier fan-out and the
      // bill. It was opt-in only because the tree the runner could build was an
      // archive; now that it is a worktree, the guard is satisfiable and refusing is
      // the honest default. `--no-require-repo-context` restores the old degrade.
      if (opts.requireRepoContext && !opts.noRepoContext && contextFiles === 0) {
        refuseItem("no-repo-context", `repo context required but unavailable for ${itemId} at ${String(input.meta?.review_commit).slice(0, 12)}${ctx.error ? `: ${ctx.error}` : ""}`);
        continue;
      }

      // WHICH BASE, AND WHAT IF THERE ISN'T ONE. The base comes from the item's own
      // frozen `review_base` and from nowhere else — no flag, because a base is a
      // property of the pull request being replayed, and one supplied per run would
      // be wrong for six items out of seven.
      //
      // The fail direction is the point. An item with no usable `review_base` must
      // NOT fall back to "pass no --base-sha": that is a silent return to the
      // gate-off replay this change exists to end, and `gate-degraded` cannot catch
      // it, because it fires on a base that was PASSED and did not take. Nothing was
      // passed, so nothing is wrong, so the run would look clean. Hence a refusal
      // with its own reason.
      //
      // Skipped whenever there is NO TREE to blame against, which is two cases and
      // not one: a deliberate `--no-repo-context` run, and a `--no-require-repo-
      // context` run whose item degraded to diff-only. In both, `off-no-base-sha`
      // is the honest state and demanding a base would refuse an item the operator
      // explicitly accepted at lower fidelity. `contextFiles` rather than the flags
      // is what is tested, because it is the fact — the tree either materialised or
      // it did not.
      let baseSha = null;
      if (!opts.noRepoContext && contextFiles > 0) {
        const declared = input.meta?.review_base;
        // `validateCorpusItem` ALREADY refuses this at the store's WRITE path, and
        // its message already names this PR. This is not a duplicate: the corpus is
        // a separate, hand-committed repository and `getCorpusItemInput` does not
        // re-validate what it reads, so an item written by an older extractor or
        // edited by hand reaches here unchecked. Guarding only the write door is
        // how `assertEffort` came to be inert.
        if (!SHA40.test(String(declared ?? ""))) {
          refuseItem("no-base-sha", `${itemId} has no usable review_base (got ${JSON.stringify(declared)}) — without it the novelty gate cannot run, and replaying anyway would measure a different reviewer than the one that ships. Re-freeze the item with extract-corpus.mjs.`);
          continue;
        }
        // A base that does not resolve reaches `gate-degraded` on its own, which is
        // fatal and correct — but only AFTER a full panel spawn has been paid for.
        // This is the same question asked for free, against the same predicate the
        // panel uses, in the same tree. It is an optimisation and a better message,
        // never a replacement: the panel remains the authority, and the fatal
        // assertion downstream is untouched.
        //
        // The case it is really for is a SHALLOW clone, where `review_commit` is
        // present and its base is not — which is CI's default checkout, and would
        // otherwise turn PR 22's first lane run into a paid abort.
        if (!(await baseResolves(repoDir, declared))) {
          refuseItem("base-unresolved", `${itemId}: review_base ${String(declared).slice(0, 12)} does not resolve in the materialised tree at ${repoDir} — the novelty gate would report OFF. A shallow clone is the usual cause; deepen it (git fetch --unshallow) and re-run.`);
          continue;
        }
        baseSha = declared;
      }

      try {
        const inputs = adapter.prepareInput(input, workDir);
        // The panel is silent for minutes but writes each lens's `conclusion` file as
        // that lens finishes, so poll for them rather than showing a dead wait.
        const lensIds = snapshot.lenses.map((l) => l.id);
        const t0 = Date.now();
        // THE HEARTBEAT GOES TO STDERR, AND THAT IS NOT COSMETIC. `run.test.mjs`
        // drives `main` IN-PROCESS, so under `node --test` these writes leave the
        // TEST FILE'S OWN stdout — which is not a terminal but the runner's result
        // channel, carrying v8-serialized frames (`0xFF 0x0F`, 4-byte big-endian
        // length, payload) that `#processRawBuffer` parses in the parent.
        //
        // That parser looks for the header only at the TOP of a call. Having
        // consumed one frame it treats whatever follows in the same read chunk as
        // the next frame's header and length WITHOUT re-checking for the magic
        // bytes, so plain text sitting behind a frame is read as a length: a big
        // one stalls the stream, a small one deserializes garbage and throws
        // `Unable to deserialize cloned data due to invalid or unsupported
        // version` in the parent, killing every result that file had left. That is
        // the `agent:tests` flake #772, #774 and #781 circled: captured from a real
        // `run.test.mjs` child, its 285 frames plus these 931 bytes of progress
        // text fail 30/30 under randomized chunk boundaries, and the same frames
        // with the text removed fail 0/30. Whether a given run corrupts
        // depends on where the socket splits its reads, which is why it tracked
        // load and why #774's isolation reduced it without explaining it.
        //
        // stderr is the channel node's runner reads as lines and reports as
        // `test:stderr`, so it cannot desynchronize anything. `console.log` here is
        // safe for the same reason it always was — `runCli` redirects it — but that
        // is a property of the caller, and stdout is not this process's to write to
        // whenever it might be a test file. Progress on stderr is also the right
        // answer for the plain CLI, where stdout is the part worth redirecting.
        const tty = process.stderr.isTTY;
        process.stderr.write(`  → ${itemId}: reviewing (${lensIds.length} lenses, ${totalSamples} samples)…${tty ? "" : "\n"}`);
        const hb = setInterval(() => {
          const done = lensIds.filter((id) => existsSync(path.join(outDir, id, "conclusion"))).length;
          const secs = Math.round((Date.now() - t0) / 1000);
          const msg = `  → ${itemId}: ${done}/${lensIds.length} lenses · ${secs}s`;
          if (tty) process.stderr.write(`\r${msg}   `); else if (secs % 30 === 0) process.stderr.write(`${msg}\n`);
        }, tty ? 2000 : 5000);
        let ran;
        try {
          // ASSIGNED, which is the whole of defect 2. `runAgent` resolves rather than
          // rejects by design — a spawn failure and a non-zero exit are the same kind
          // of fact about this item — so dropping the result was the only thing
          // between a crashed panel and `status: "ok"`. `captureArtifacts` takes this
          // value, so it cannot be dropped again without the call failing.
          //
          // `baseSha` IS passed now, from the item's frozen `review_base`, against
          // a worktree it resolves in. That is what makes this a replay of the
          // shipped gate — and it also arms #682's `gate-degraded` assertion, which
          // has been live and unreachable until this line existed.
          ran = await adapter.runAgent(inputs, { lensesDir: matLenses, outDir, repoDir, env, baseSha, timeoutMs: opts.panelTimeoutMs });
        } finally {
          clearInterval(hb);
          if (tty) process.stderr.write(`\r${" ".repeat(56)}\r`);
        }
        const cap = adapter.captureArtifacts(ran);
        const cost = sumExecutions(cap.executionMessages ?? [], "review");
        const outcome = classifyItemOutcome({
          exitCode: cap.exitCode,
          timedOut: cap.timedOut,
          timeoutMs: opts.panelTimeoutMs,
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
        envelope = { ...base, ...zeroCost, status: "error", reason: "exception", repo_context_files: contextFiles, gate: { state: GATE_NOT_RUN, line: null }, error: { message: e.message, kind: "exception" } };
        payload = { adapter: "reviewer", error: e.message };
      }
      store.putItem(runId, itemId, { envelope, payload });
      spentUsd += Number(envelope.cost_usd) || 0;
      const bytes = Buffer.byteLength(JSON.stringify(payload));
      console.log(
        `  ${envelope.status === "ok" ? "+" : "!"} ${itemId}: ${envelope.status}${envelope.reason ? ` (${envelope.reason})` : ""} · ` +
          `$${(envelope.cost_usd || 0).toFixed(2)} · gate ${envelope.gate.state} · ${(bytes / 1024).toFixed(0)} KiB payload`,
      );
      // The item's scratch directory goes ONLY when the item is `ok`, and the
      // asymmetry is the point. For an `ok` item everything in there is already in
      // `payload.json`, so it is 20 redundant copies of the panel's output by the end
      // of a corpus run. For a FAILED one it is the only place the raw evidence
      // exists — a partial `panel.json`, whatever a crashed lens managed to write —
      // and `payload.json` records the parsed STATES, not the bytes. Deleting that
      // would be the same fail direction this whole module exists to correct, so the
      // path is printed instead. `repoDir` is deliberately untouched: it usually
      // points into the shared commit cache, which the next item and the next
      // replicate both reuse.
      if (envelope.status === "ok") {
        rmSync(workDir, { recursive: true, force: true });
      } else {
        console.error(`  ! ${itemId}: raw panel output kept at ${outDir}`);
      }
      // ABORT, do not degrade. Every fatal reason is a misconfiguration that will be
      // identical for every remaining item, and each of those items costs money. The
      // failing item is STORED first — the evidence is what makes it fixable — and
      // then the run stops.
      if (aborted) {
        console.error(`run ${runId}: ABORTED at ${aborted.itemId} — ${aborted.reason}: ${aborted.message}`);
        break;
      }
    }

    if (capped) {
      // NO SILENT TRUNCATION. A cap that dropped items without naming them would
      // leave a five-item run looking like a five-item corpus, which is the shape of
      // every bad number this project has already shipped once.
      console.error(
        `run ${runId}: STOPPED AT THE COST CAP before ${capped.itemId} — $${capped.spentUsd.toFixed(2)} spent of $${capped.cap.toFixed(2)}. ` +
          `${notReplayed.length} item(s) not replayed: ${notReplayed.join(", ")}`,
      );
      console.error(`run ${runId}: resume with --run-id ${runId} and a higher --max-cost-usd; the stored items are not re-run.`);
    }
    const s = summarizeRun(store, runId, plannedIds);
    // `capped` before `aborted` cannot happen — the loop breaks on either — but the
    // order still states which fact wins if both were ever set: a misconfiguration
    // is a worse thing to know than a budget, so `aborted` is checked first.
    const status = aborted ? "aborted" : capped ? "capped" : s.complete ? "complete" : "partial";
    store.putRun(runId, {
      runJson: {
        ...runJson(), started, finished: nowIso(), status,
        item_count: plannedIds.length, items_ok: s.items_ok, items_error: s.items_error,
        totals: s.totals,
        notes: aborted
          ? `aborted at ${aborted.itemId}: ${aborted.reason}`
          : capped
            ? `stopped at the cost cap before ${capped.itemId}: $${capped.spentUsd.toFixed(2)} of $${capped.cap.toFixed(2)}; not replayed: ${notReplayed.join(", ")}`
            : "",
      },
      configSnapshot: snapshot,
    });
    const wall = s.totals.duration_items > 0 ? `${Math.round(s.totals.duration_ms / 1000)}s over ${s.totals.duration_items}/${s.items_present} timed item(s)` : "no timing recorded";
    console.log(`run ${runId}: ${status} — ok=${s.items_ok} error=${s.items_error} · $${s.totals.cost_usd.toFixed(2)} · ${wall}`);
    // A capped run is INCOMPLETE, and exits non-zero on that ground alone: it did
    // not do what it was asked to do, even though it stopped on purpose.
    return aborted || capped || s.items_error > 0 || !s.complete ? 1 : 0;
  } finally {
    // The worktrees go LAST and unconditionally. Each is registered in the source
    // repository's `.git`, so leaving one behind is administrative state in somebody
    // else's clone rather than a stray directory — and only paths under this run's
    // own `mkdtemp` root are ever touched, because this machine's working clone has
    // eight linked worktrees that belong to real branches.
    const removed = cleanupRepoCache(opts.repoSource, repoCache);
    if (removed > 0) console.log(`run ${runId}: removed ${removed} worktree(s)`);
    // The materialised lenses dir has served its purpose once the last item is
    // stored, and unlike an item's scratch directory it holds no evidence: it is a
    // byte-for-byte rebuild of `config.snapshot.json`, which the FIRST `putRun`
    // already wrote — before any item ran — and which is write-once. So removing it
    // on the throwing path too costs nothing that is not already in the store.
    rmSync(matLenses, { recursive: true, force: true });
  }
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
