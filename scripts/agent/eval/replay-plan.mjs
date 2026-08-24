// Decide, for FREE, everything a paid replay dispatch is going to do — and refuse
// before a single model call if any of it does not add up.
//
// WHY THIS EXISTS AS A SEPARATE STEP. `eval-replay.yml` is the one workflow in this
// repository that spends money, and nobody is watching a terminal while it does.
// Every question this module answers — is the cap a number, does the corpus version
// exist, does every item name a pull request whose commits can be fetched, does the
// worst case fit inside the job's own ceiling, does the lens configuration it names
// exist inside this checkout and build — is answerable from committed files in a
// couple of seconds. Answering them in a preflight job means a mistyped dispatch
// costs one runner-minute; answering them by observing the replay fail means it
// costs whatever was spent before the failure.
//
// It is also the only place that can see the whole dispatch. The runner bounds ONE
// run: `--max-cost-usd` is per `--run-id`, and a K-replicate dispatch is K run ids,
// so the ceiling a human types into the form is multiplied by K before it becomes a
// bill. Nothing inside `run.mjs` can say that, because nothing inside `run.mjs`
// knows there are siblings. `exposureUsd` is that multiplication, printed loudly, in
// the one place that has both numbers.
//
// THE REFS PROBLEM, WHICH IS THE PART MOST LIKELY TO BITE. A corpus item's
// `review_commit` is a PULL REQUEST HEAD (or an ancestor of one). `wafflebase`
// squash-merges, so it is never reachable from `main` — measured on all seven pilot
// items against a fresh clone carrying 19 branches and 27 tags: every one ABSENT.
// A CI checkout therefore cannot materialise the review tree, however deep it is,
// and `--require-repo-context` (default ON since #716) would refuse all seven for
// free while the operator watched a green-ish run replay nothing. The fix is one
// fetch of `refs/pull/<n>/head` per item, and this module computes the refspecs from
// the manifest rather than leaving them to be typed.
//
// `refs/pull/<n>/head` and not the bare commit: fetching a bare sha requires
// `uploadpack.allowReachableSHA1InWant` on the server, which GitHub does not enable,
// while the pull ref is always present for as long as the pull request is and always
// reaches the head. Verified for all seven: the frozen `review_commit` is an
// ancestor of its pull ref's tip in every case, including the four where the PR was
// pushed to after review opened.
//
// The counterpart fact, also measured: every item's `review_base` IS an ancestor of
// `main`, so `fetch-depth: 0` is what supplies those and no extra fetch is needed.
// The two halves fail differently and are worth keeping apart — a missing base is
// #716's `base-unresolved`, a missing head is `no-repo-context`.

import { writeFileSync, mkdirSync, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EvalStore } from "./store.mjs";
import { buildConfig } from "./config-build.mjs";
import { parseArgs } from "../gh-checks.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * The checked-out tree, derived from this module's own location the way
 * `config-build.mjs` derives it — `scripts/agent/eval/` is three levels down. It is
 * the boundary `lenses_dir` is required to stay inside.
 */
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");

/**
 * How a leg's run id is built from the stem a human typed.
 *
 * `__k<n>` mirrors the runner's own default id (`<timestamp>__<config-id>`), which
 * already uses `__` as its field separator, so a leg id reads as one more field
 * rather than as a new convention.
 *
 * ONE RUN ID PER REPLICATE, and that is the whole reason the shard is by replicate
 * rather than by item. `run_id` already means "which replicate this is" — it exists
 * so K replicates stay distinguishable, and reliability is defined over the K of
 * them. Sharding by item instead would give 21 run ids for 21 replays, dissolving
 * the grouping every reliability number is computed over, and it would quietly
 * remove the cost cap's subject: a cap per run would then bound ONE item.
 */
export const LEG_SUFFIX = "__k";

/**
 * What a dry run's ids are prefixed with, and it is a CORRECTNESS guard rather than
 * a label.
 *
 * Runs are resumable by design: `hasItem` keys on `envelope.json`, so a second
 * invocation with the same run id SKIPS every item already stored. That is what
 * makes a mid-run crash cost one item. It also means that if a dry run wrote to the
 * run id a paid dispatch later uses, the paid dispatch would find seven stub items
 * already present, skip all of them, spend nothing, and report a complete run — a
 * store full of canned output filed under the pilot's own name, with `run.json`
 * saying `complete`. That is the worst failure available to this whole design,
 * because it is the one that produces confident numbers from nothing.
 *
 * A separate id space makes it unrepresentable rather than unlikely.
 */
export const DRY_RUN_PREFIX = "dryrun-";

/**
 * The two panels a dispatch can drive. `stub` is the free one, and it is FIRST
 * because a `type: choice` input defaults to its first option: the fail direction of
 * a forgotten dropdown is then a free run that produced nothing, not a bill.
 */
export const PANEL_MODES = Object.freeze(["stub", "real"]);

/**
 * The panel sha a dry run records, and it is deliberately not a real commit.
 *
 * #716 refuses a `--panel-script` that is not its own sibling unless `--panel-sha`
 * says which panel it is, which already stops the stub from inheriting the real
 * panel's identity. This goes one step further and makes the recorded value
 * self-evidently synthetic: forty zeroes is not a commit in any repository, so an
 * envelope carrying it cannot be misread as a measurement even by something that
 * never looks at `panel_sha_source`.
 */
export const DRY_RUN_PANEL_SHA = "0".repeat(40);

/**
 * `owner/name`, the shape a corpus manifest's `source_repo` must have before it can
 * be turned into a URL. Narrow on purpose: this value is interpolated into a `git
 * fetch` target, so anything that is not two plain path segments is refused rather
 * than escaped.
 */
const SOURCE_REPO = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Where a corpus's pull requests actually live, as a fetchable URL.
 *
 * THE CORPUS SAYS, NOT THE CHECKOUT. Every manifest carries `source_repo`
 * (`"wafflebase/wafflebase"` for the pilot), because a corpus item IS a pull request
 * of a named repository — that is what `source_pr` means. Fetching those refs from
 * `origin` instead silently couples the lane to whichever checkout it happens to be
 * running in, and the coupling is invisible until it bites: **a fork has none of its
 * parent's `refs/pull/*`.** Measured 2026-08-10 — upstream carries all seven pilot
 * refs, `dlgpdmsly2/wafflebase` carries one, its own. So a lane that fetched from
 * `origin` would work when dispatched upstream and refuse every item when dispatched
 * anywhere else, for a reason nothing in the output would name.
 *
 * That matters beyond forks. A replay is a measurement; reading its inputs from
 * "wherever this checkout came from" makes the inputs a property of the runner
 * rather than of the corpus.
 */
export function sourceRepoUrl(sourceRepo) {
  return `https://github.com/${sourceRepo}.git`;
}

/**
 * Mirrors `store.mjs`'s private `SEGMENT`, which is the authority — a run id becomes
 * a path segment and `requireSegment` refuses anything outside this grammar at the
 * store's write path.
 *
 * Duplicated rather than imported because it is not exported, and the duplicate is
 * pinned by a test that compares this predicate against the store's ACTUAL
 * behaviour rather than against this comment. The fail direction if the two ever
 * disagree is safe in one direction and only one: an id this accepts and the store
 * rejects costs a free refusal at the top of `run.mjs`, before any spawn.
 */
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Does the store's id grammar accept this string? */
export function isStoreSegment(value) {
  return typeof value === "string" && SEGMENT.test(value);
}

/** The run id one leg of a dispatch writes under. */
export function legRunId({ runIdStem, k, panel }) {
  const prefix = panel === "real" ? "" : DRY_RUN_PREFIX;
  return `${prefix}${runIdStem}${LEG_SUFFIX}${k}`;
}

// --- which reviewer, and is it a real one ------------------------------------

/**
 * `run.mjs`'s own default lenses directory, duplicated here and PINNED BY A TEST —
 * the same trade `SEGMENT` above makes, and for the same reason: the value is not
 * exported, and a preflight that cannot name the default cannot print the CONTROL
 * arm's `config_hash`, which is the number a two-arm comparison is read against.
 *
 * `replay-plan.test.mjs` holds this against what `resolveRunOptions` actually
 * resolves with no flag, rather than against a re-typed path, so the copy cannot
 * drift in silence. The fail direction is safe: a stale copy makes the preflight
 * print a hash for a directory the replay would not use, and the test goes red
 * before any dispatch can.
 */
export const DEFAULT_LENSES_DIR = path.resolve(HERE, "..", "lenses");

/**
 * `config_id` the preflight builds under. It matches what the replay records
 * (`run.mjs` defaults to `"baseline"` and this lane passes no `--config-id`), and it
 * is COSMETIC in any case — `COSMETIC_CONFIG_FIELDS` excludes it, because "renaming
 * a config does not make it a different reviewer" — so the hash printed here does
 * not depend on getting it right.
 */
const PREFLIGHT_CONFIG_ID = "baseline";

/** Is `dir` the tree at `root`, or somewhere inside it? */
function insideTree(root, dir) {
  const rel = path.relative(root, dir);
  // `rel.startsWith("..")` is the tempting version and it is wrong: it also rejects
  // a legitimate child whose name happens to begin with two dots (`lenses/..old`).
  // The SEPARATOR is what marks a climb, so that is what is matched.
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/**
 * Which reviewer this dispatch is about to buy, resolved from `lenses_dir` and
 * PROVED before anything spends.
 *
 * WHY A DIRECTORY AND NOT A MODEL NAME. `model` is already inside the config
 * identity — `HASHED_LENS_FIELDS` carries it — so a lens variant lands under its own
 * `config_hash` by construction, while `panel_digest` (ten `.mjs` modules, none of
 * them a lens file) stays put. The store's key was built for exactly that
 * discrimination, so nothing downstream has to learn anything. A `model` string
 * would instead need a new flag on the runner and would mutate a committed config in
 * memory; a DIRECTORY needs no runner change at all, and it makes the variant a
 * reviewable artefact in git rather than a value typed into a form.
 *
 * THE PATH IS THE DANGEROUS PART. Whatever this names is read file by file and fed
 * to a model. An absolute path, or a `../` climb, would let one dispatch point the
 * panel at anything on the runner. So containment is ASSERTED and never arranged: a
 * string that escapes is refused by name rather than normalised into obedience, and
 * the check is made again after `realpath`, because a committed symlink is a
 * lexically innocent path that lands outside the tree.
 *
 * AND THEN `buildConfig` IS ACTUALLY RUN. It is free, deterministic, and it is the
 * same call the runner makes, so a variant with a mistyped `effort` or a missing
 * rubric costs one runner-minute here instead of being discovered by a paid leg. The
 * `config_hash` it returns is printed, because "which reviewer am I buying" is the
 * one question the dispatch form cannot answer and this is the last free place to
 * ask it.
 *
 * ONE ERROR AT A TIME, which is not a departure from this module's accumulate rule:
 * the steps below are stages of resolving ONE value and each depends on the one
 * before it. `main` concatenates whatever comes back with `planReplay`'s list, so a
 * dispatch with a bad cap AND a bad lenses dir still names both.
 */
export function planLensConfig({ value = "", repoRoot = REPO_ROOT, cwd = process.cwd() } = {}) {
  const asked = typeof value === "string" ? value.trim() : "";
  const isDefault = asked === "";
  const fail = (message) => ({ errors: [message], dir: null, isDefault, configHash: null, lenses: [] });

  if (!isDefault && path.isAbsolute(asked)) {
    return fail(
      `lenses_dir ${JSON.stringify(asked)} is an ABSOLUTE path. It names a location on the runner rather than a directory in this ` +
        "checkout, and the whole point of committing a variant is that a reviewer can read it. Give a path relative to the repository root.",
    );
  }
  // Resolved exactly as `run.mjs` resolves it — `path.resolve` against the process's
  // own directory — so the path proved here is the path the replay will open. Both
  // jobs in this lane run at the workspace root, and the containment check below is
  // what catches it if one ever does not.
  const dir = isDefault ? DEFAULT_LENSES_DIR : path.resolve(cwd, asked);
  if (!insideTree(repoRoot, dir)) {
    return fail(
      `lenses_dir ${JSON.stringify(asked)} resolves to ${dir}, which is OUTSIDE the checked-out tree (${repoRoot}). ` +
        "A lens configuration is read and handed to a model; it has to be something this repository committed.",
    );
  }
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return fail(
      `lenses_dir ${JSON.stringify(asked)} resolves to ${dir}, which is not a directory in this checkout. ` +
        "Commit the variant to the branch being dispatched, or check the spelling.",
    );
  }
  // Again, after the links are followed. `git` stores symlinks, so
  // `scripts/agent/lenses-x -> /etc` is a thing a branch can carry, and it passes
  // every lexical test above.
  const real = realpathSync(dir);
  if (!insideTree(realpathSync(repoRoot), real)) {
    return fail(`lenses_dir ${JSON.stringify(asked)} is a link to ${real}, which is outside the checked-out tree (${repoRoot}).`);
  }

  const manifestPath = path.join(real, "lenses.json");
  if (!existsSync(manifestPath)) {
    return fail(
      `lenses_dir ${JSON.stringify(asked)} holds no lenses.json, so it is not a lens configuration — one is that manifest plus an ` +
        "<id>.md rubric per lens it declares.",
    );
  }
  let declared;
  try {
    declared = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (e) {
    return fail(`${manifestPath} is not readable JSON: ${e.message}`);
  }
  // ZERO LENSES IS THE ONE `buildConfig` WOULD ACCEPT. An empty array maps to an
  // empty array, the hash computes, and the replay buys a panel that reviews
  // nothing, finds nothing, and reports a complete run — a result indistinguishable
  // from a reviewer that had nothing to say. Refused here because nothing downstream
  // will refuse it.
  if (!Array.isArray(declared) || declared.length === 0) {
    return fail(
      `${manifestPath} declares no lenses. A panel with an empty manifest reviews nothing and still reports a complete run, ` +
        "which is the one outcome that looks like a measurement and is not.",
    );
  }

  let built;
  try {
    built = buildConfig(real, { configId: PREFLIGHT_CONFIG_ID });
  } catch (e) {
    return fail(`the lens configuration at ${path.relative(repoRoot, real) || real} does not build: ${e.message}`);
  }
  return {
    errors: [],
    dir: real,
    isDefault,
    configHash: built.config_hash,
    lenses: built.snapshot.lenses.map((l) => ({ id: l.id, model: l.model })),
  };
}

/**
 * Turn one dispatch's inputs plus the frozen manifest into the whole plan, or into a
 * list of reasons it will not run.
 *
 * PURE, and everything that reaches it is a string, because everything that reaches
 * the workflow is a string — `workflow_dispatch` inputs have no numeric type, so
 * "8" and "eight" and "" all arrive the same way and the coercion is this function's
 * job rather than the shell's. The fork's version of this lane interpolated those
 * strings straight into a command line, where `--max-cost-usd ''` becomes a missing
 * flag rather than an error.
 *
 * ERRORS ACCUMULATE. A dispatch with three things wrong should name three things:
 * this is a preflight a human reads once and re-dispatches from, and reporting one
 * fault per attempt turns a single correction into three round trips.
 */
export function planReplay({
  manifestItems,
  sourceRepo,
  corpusVersion,
  runId,
  items = "",
  replicates,
  maxCostUsd,
  panel,
  panelTimeoutS,
  jobTimeoutMin,
  overheadMin,
} = {}) {
  const errors = [];

  if (!PANEL_MODES.includes(panel)) {
    errors.push(`panel must be one of ${PANEL_MODES.join(" | ")}, got ${JSON.stringify(panel)}.`);
  }

  // The run id is REQUIRED and has no default, and the reason is resumability rather
  // than tidiness. `run.mjs` will happily invent one from the clock, and an invented
  // id is unguessable — so a run that dies half way through cannot be resumed,
  // because nobody can name it. The whole "a crash costs one item" property depends
  // on a human having chosen the id up front.
  const stem = typeof runId === "string" ? runId.trim() : "";
  if (stem === "") {
    errors.push("run_id is required and has no default: a clock-derived id cannot be resumed, because a later dispatch cannot name it.");
  } else if (!isStoreSegment(stem)) {
    errors.push(`run_id ${JSON.stringify(stem)} is not a usable path segment (${SEGMENT.source}).`);
  }

  const k = Number(replicates);
  if (!Number.isInteger(k) || k < 1) {
    errors.push(`replicates must be a positive integer, got ${JSON.stringify(replicates)}.`);
  }

  // THE CAP IS REQUIRED HERE EVEN THOUGH #716 ALSO REQUIRES IT, and the duplication
  // is deliberate. `run.mjs` requires `--max-cost-usd` OR an explicit
  // `--no-cost-cap`; this lane offers no way to express the second, because
  // "unbounded" is a choice for an operator watching a terminal and this job has
  // nobody watching it. So the workflow layer is strictly narrower than the CLI
  // layer, on purpose, and says so rather than relying on the CLI's refusal.
  const cap = Number(maxCostUsd);
  if (typeof maxCostUsd !== "string" || maxCostUsd.trim() === "") {
    errors.push("max_cost_usd is required and has no default. It bounds ONE replicate; the dispatch's exposure is that number times the replicate count.");
  } else if (!Number.isFinite(cap) || cap <= 0) {
    errors.push(`max_cost_usd must be a positive number of dollars, got ${JSON.stringify(maxCostUsd)}.`);
  }

  // Refused rather than defaulted to this repository's name. A corpus whose manifest
  // does not say where its pull requests live cannot be fetched correctly by
  // guessing, and guessing wrong means every item refuses for free — which reads
  // exactly like a panel that found nothing.
  if (!SOURCE_REPO.test(String(sourceRepo ?? ""))) {
    errors.push(
      `corpus ${JSON.stringify(corpusVersion)} has no usable source_repo (got ${JSON.stringify(sourceRepo)}). ` +
        "It names the repository whose pull requests the items were frozen from, and the lane fetches their refs from there rather than from whatever remote this checkout has.",
    );
  }

  // --- which items -----------------------------------------------------------
  const all = Array.isArray(manifestItems) ? manifestItems : [];
  if (all.length === 0) {
    errors.push(`corpus version ${JSON.stringify(corpusVersion)} has no items in the store — wrong version, or the store checkout is stale.`);
  }
  const asked = String(items ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const byId = new Map(all.map((it) => [it.id, it]));
  // An item id in the subset that is not in the manifest is a TYPO, and the fail
  // direction matters: `run.mjs` prints "not in corpus" and carries on, so a
  // dispatch asking for `pr-542` when it meant `pr-524` would replay six items and
  // exit 0. Named and refused here, where it is still free.
  for (const id of asked) {
    if (!byId.has(id)) {
      errors.push(`item ${JSON.stringify(id)} is not in corpus ${JSON.stringify(corpusVersion)} (have: ${all.map((it) => it.id).join(", ")}).`);
    }
  }
  const planned = asked.length ? asked.filter((id) => byId.has(id)).map((id) => byId.get(id)) : all;

  // --- the refs every planned item needs -------------------------------------
  // `source_pr` is what turns an item into a fetchable ref. An item without one
  // cannot have its tree materialised in CI at all, and the failure would arrive as
  // seven identical `no-repo-context` refusals rather than as one sentence.
  const prs = [];
  const commits = [];
  for (const it of planned) {
    const pr = Number(it?.source_pr);
    if (!Number.isInteger(pr) || pr <= 0) {
      errors.push(`item ${JSON.stringify(it?.id)} has no usable source_pr (got ${JSON.stringify(it?.source_pr)}), so its commits cannot be fetched in CI.`);
      continue;
    }
    if (typeof it?.review_commit !== "string" || it.review_commit === "") {
      errors.push(`item ${JSON.stringify(it?.id)} has no review_commit, so there is nothing to check the review tree out at.`);
      continue;
    }
    if (!prs.includes(pr)) prs.push(pr);
    commits.push({ itemId: it.id, commit: it.review_commit, pr });
  }

  // --- do the two ceilings agree? --------------------------------------------
  // `--panel-timeout` bounds ONE item and `timeout-minutes` bounds the whole job, so
  // one of them is redundant unless the second is strictly larger than what the
  // first permits. Computed rather than asserted in a comment, because the corpus
  // grows: an eighth item silently pushes the worst case past a hardcoded ceiling,
  // and the symptom would be a job killed mid-replay with the last item's spend
  // unbanked.
  const perItemS = Number(panelTimeoutS);
  const jobMin = Number(jobTimeoutMin);
  const overhead = Number(overheadMin);
  let worstCaseMin = null;
  if ([perItemS, jobMin, overhead].every((n) => Number.isFinite(n) && n > 0)) {
    worstCaseMin = Math.ceil((planned.length * perItemS) / 60) + overhead;
    if (worstCaseMin > jobMin) {
      errors.push(
        `the two ceilings disagree: ${planned.length} item(s) x ${perItemS}s per item plus ${overhead}min overhead is ${worstCaseMin}min, ` +
          `which exceeds the job's timeout-minutes of ${jobMin}. Raise the job timeout or lower --panel-timeout; a job killed mid-item ` +
          `loses that item's spend.`,
      );
    }
  } else {
    errors.push("panel_timeout_s, job_timeout_min and overhead_min must all be positive numbers.");
  }

  const legs = [];
  if (Number.isInteger(k) && k >= 1 && stem !== "" && PANEL_MODES.includes(panel)) {
    for (let i = 1; i <= k; i++) legs.push({ k: i, runId: legRunId({ runIdStem: stem, k: i, panel }) });
  }

  const validSource = SOURCE_REPO.test(String(sourceRepo ?? ""));
  return {
    errors,
    panel,
    runIdStem: stem,
    legs,
    itemIds: planned.map((it) => it.id),
    prs,
    commits,
    sourceRepo: validSource ? String(sourceRepo) : null,
    sourceRepoUrl: validSource ? sourceRepoUrl(String(sourceRepo)) : null,
    // One refspec per pull request, landing on the same `refs/eval/pr/<n>` name
    // `extract-corpus.mjs` uses, so a runner's refs read the same as a laptop's.
    //
    // Plus the source repository's `main`, and that one is not belt-and-braces.
    // A `review_base` is NOT reliably an ancestor of its own pull-request head —
    // measured on the pilot, pr-524 and pr-605 carry theirs and **pr-415 does not** —
    // so the bases come from main's history rather than from the pull refs. Fetching
    // main from the SOURCE repository too is what makes that independent of how
    // fresh, or how complete, the checkout this job is running in happens to be.
    refspecs: [
      ...prs.map((pr) => `refs/pull/${pr}/head:refs/eval/pr/${pr}`),
      "refs/heads/main:refs/eval/source-main",
    ],
    // K times the per-run cap. The number a human should be looking at before
    // pressing the button, and the one neither the form nor the CLI can show.
    exposureUsd: Number.isFinite(cap) && Number.isInteger(k) && k >= 1 ? cap * k : null,
    perLegCapUsd: Number.isFinite(cap) ? cap : null,
    worstCaseMin,
  };
}

/**
 * The human-facing summary, as lines.
 *
 * Separate from `planReplay` so the numbers can be asserted without matching prose,
 * and so the banner is a value rather than a pile of `console.log`s: the dry-run
 * banner in particular is a thing a test should be able to look at directly.
 *
 * `lens` is `planLensConfig`'s result and is optional only because `planReplay` is
 * pure and this is not — the lens lines need a filesystem. When it is present the
 * banner names the reviewer and its `config_hash`, which is the identity every
 * comparison across two dispatches is made on.
 */
export function planSummary(plan, lens = null) {
  const lines = [];
  const dry = plan.panel !== "real";
  lines.push(
    dry
      ? "eval-replay: DRY RUN — the STUB panel. No model is called, nothing is spent, and NOTHING IS PUSHED to the store."
      : "eval-replay: REAL PANEL — this run calls models and spends money.",
  );
  lines.push(`  corpus items : ${plan.itemIds.length} (${plan.itemIds.join(", ") || "none"})`);
  lines.push(`  replicates   : ${plan.legs.length} — ${plan.legs.map((l) => l.runId).join(", ") || "none"}`);
  // Printed because it is the one input that does NOT come from the dispatch form,
  // and because "which repository were these pull requests read from" is the first
  // question to ask of a replay that refused everything.
  lines.push(`  source repo  : ${plan.sourceRepo ?? "(none)"} — refs fetched from ${plan.sourceRepoUrl ?? "(none)"}`);
  lines.push(`  pull refs    : ${plan.prs.join(", ") || "none"}`);
  if (lens && lens.configHash) {
    const where = path.relative(REPO_ROOT, lens.dir) || lens.dir;
    lines.push(
      `  lens config  : ${lens.isDefault ? `${where} (the committed default)` : `VARIANT ${where}`} — ` +
        lens.lenses.map((l) => `${l.id}=${l.model}`).join(" "),
    );
    // The full hash, never an abbreviation. It exists to be compared against another
    // dispatch's, and a truncated identity is one somebody eventually eyeballs.
    lines.push(
      `  config_hash  : ${lens.configHash}` +
        (lens.isDefault
          ? " — a result pools only with other runs under this same hash"
          : " — NOT the committed default's. A comparison needs the control arm dispatched today as well, under the same panel."),
    );
  }
  if (dry) {
    lines.push(`  spend        : $0.00 — the cap is still enforced, against the stub's canned cost, so the guard is exercised`);
    lines.push(`  panel_sha    : ${DRY_RUN_PANEL_SHA} (synthetic, source "flag")`);
  } else {
    lines.push(
      `  EXPOSURE     : $${plan.perLegCapUsd.toFixed(2)} cap PER REPLICATE x ${plan.legs.length} = ` +
        `$${plan.exposureUsd.toFixed(2)} maximum for this dispatch`,
    );
  }
  lines.push(`  worst case   : ${plan.worstCaseMin}min per replicate before the job's own ceiling stops it`);
  return lines;
}

// --- CLI ---------------------------------------------------------------------

const USAGE = `Preflight one eval-replay dispatch: validate it, and emit the plan.

  node scripts/agent/eval/replay-plan.mjs --root <eval-repo> --corpus-version <v> \\
       --run-id <id> --replicates <k> --max-cost-usd <n> --panel stub|real \\
       --panel-timeout <s> --job-timeout <min> --overhead <min> [--items a,b] \\
       [--lenses-dir <dir>] [--emit-dir <dir>] [--github-output <file>]

--lenses-dir is empty or absent for the committed panel config, or a path INSIDE
this checkout naming a variant. Either way the resulting config_hash is printed.

Costs nothing and calls no model. Exit 2 if the dispatch would not run correctly.`;

/**
 * `--emit-dir` gets `refspecs.txt` and `commits.txt`; `--github-output` gets the
 * `matrix` / `item_ids` step outputs.
 *
 * Files rather than stdout because the consumer is `xargs git fetch` and a shell
 * loop, and because a value passed through a file cannot be re-split by the shell
 * on its way there — which is the same reason every value in this lane reaches a
 * `run:` body through the environment instead of through `${{ }}`.
 */
export function main(argv, { env = process.env, write = writeFileSync, log = console.log, error = console.error } = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    log(USAGE);
    return 0;
  }
  if (args.root === undefined || String(args.root).trim() === "") {
    error(`replay-plan: --root is required and has no default.\n${USAGE}`);
    return 2;
  }
  const corpusVersion = args["corpus-version"];
  const store = new EvalStore(args.root);
  const manifest = corpusVersion ? store.getCorpusManifest(String(corpusVersion)) : null;

  const plan = planReplay({
    manifestItems: Array.isArray(manifest?.items) ? manifest.items : [],
    // From the manifest, never from a flag: which repository a corpus was frozen
    // from is a property of the corpus, and an operator who could override it could
    // silently replay one repository's diffs against another's trees.
    sourceRepo: manifest?.source_repo,
    corpusVersion,
    runId: args["run-id"],
    items: args.items ?? "",
    replicates: args.replicates,
    maxCostUsd: args["max-cost-usd"],
    panel: args.panel,
    panelTimeoutS: args["panel-timeout"],
    jobTimeoutMin: args["job-timeout"],
    overheadMin: args.overhead,
  });

  // The reviewer, resolved and built. Kept out of `planReplay` because that function
  // is pure and this touches the disk — and concatenated with its errors rather than
  // reported after them, so one re-dispatch fixes everything that is wrong.
  const lens = planLensConfig({ value: args["lenses-dir"] ?? "" });

  const errors = [...plan.errors, ...lens.errors];
  if (errors.length) {
    error("replay-plan: this dispatch will not run:");
    for (const e of errors) error(`  - ${e}`);
    return 2;
  }

  for (const line of planSummary(plan, lens)) log(line);

  const emitDir = args["emit-dir"];
  if (emitDir) {
    mkdirSync(emitDir, { recursive: true });
    // Trailing newline on both: `xargs` and `read` both treat a final unterminated
    // line as a line, but a file that ends mid-line is the kind of thing that
    // silently loses its last entry when something else concatenates it.
    write(path.join(emitDir, "refspecs.txt"), plan.refspecs.map((r) => `${r}\n`).join(""));
    write(path.join(emitDir, "commits.txt"), plan.commits.map((c) => `${c.commit} ${c.itemId}\n`).join(""));
    // The fetch target, as a file rather than as a shell variable the workflow
    // assembles: the URL is derived from the corpus, and the step that uses it
    // should not be able to derive it differently.
    write(path.join(emitDir, "source-repo-url.txt"), `${plan.sourceRepoUrl}\n`);
  }
  const out = args["github-output"] ?? env.GITHUB_OUTPUT;
  if (out) {
    // Only what a later job actually reads. An earlier version also emitted the
    // dry-run panel sha here, which nothing consumed and which printed a synthetic
    // sha into the log of a REAL dispatch — a value that says "this was a dry run"
    // sitting in the output of one that was not.
    write(
      out,
      [`matrix=${JSON.stringify({ include: plan.legs })}`, `item_ids=${plan.itemIds.join(",")}`, ""].join("\n"),
      { flag: "a" },
    );
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv));
}
