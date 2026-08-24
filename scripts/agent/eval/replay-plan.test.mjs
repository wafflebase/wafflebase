import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_LENSES_DIR,
  DRY_RUN_PANEL_SHA,
  DRY_RUN_PREFIX,
  LEG_SUFFIX,
  PANEL_MODES,
  isStoreSegment,
  legRunId,
  planLensConfig,
  planReplay,
  planSummary,
} from "./replay-plan.mjs";
import { EvalStore } from "./store.mjs";
import { buildConfig } from "./config-build.mjs";
import { resolveRunOptions } from "./run.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW = path.join(HERE, "..", "..", "..", ".github", "workflows", "eval-replay.yml");

/** The workflow with every comment line stripped.
 *
 *  Stripped FIRST, and for the reason `collect-captures.test.mjs` documents: this
 *  file explains its own permission model in prose and names `contents: write`
 *  several times while asserting it does not have it. A whole-file grep would answer
 *  out of the explanation. Same trap #630, #640 and #651 each hit.
 */
function yamlOnly() {
  return readFileSync(WORKFLOW, "utf8")
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
}

/**
 * One named step's `run:` body.
 *
 * Added after mutation testing: two assertions here were scoped to the WHOLE file and
 * so were satisfied by a matching line in some other step. Breaking the fetch step's
 * `exit 1` left the staging step's `exit 1` to answer for it, and breaking the commit
 * step's dry-run gate left the replay step's identical gate to answer for it. Both
 * mutations went unnoticed. A per-step slice is what makes those assertions about the
 * step they name.
 */
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

const ITEMS = [
  { id: "pr-415", source_pr: 415, review_commit: "eeda30c751a4d215924bd8ecd379f769b869be6b" },
  { id: "pr-524", source_pr: 524, review_commit: "4d3e827f5edb1ca16b0958a77e85ff6b3af66bf9" },
];

/** A dispatch that is valid in every respect, so a test can break exactly one thing. */
const OK = Object.freeze({
  manifestItems: ITEMS,
  sourceRepo: "wafflebase/wafflebase",
  corpusVersion: "2026-08-07-pilot",
  runId: "pilot",
  items: "",
  replicates: "3",
  maxCostUsd: "8",
  panel: "real",
  panelTimeoutS: "1800",
  jobTimeoutMin: "240",
  overheadMin: "25",
});

const plan = (patch = {}) => planReplay({ ...OK, ...patch });

// --- the cost cap ------------------------------------------------------------

test("planReplay: the cost cap is REQUIRED, and a K-replicate dispatch multiplies it", () => {
  // The whole reason this module exists. `--max-cost-usd` bounds ONE run id, and a
  // dispatch is K run ids, so the number a human types is not the number they are
  // exposed to. Nothing inside run.mjs can say this — it does not know it has
  // siblings.
  const p = plan({ maxCostUsd: "8", replicates: "3" });
  assert.deepEqual(p.errors, []);
  assert.equal(p.perLegCapUsd, 8);
  assert.equal(p.exposureUsd, 24, "3 legs capped at $8 each is $24 of exposure, not $8");

  // Absent, empty and non-numeric are all refusals, and the message has to say the
  // cap is per replicate or the multiplication above is a trap rather than a guard.
  for (const bad of [undefined, "", "   ", "eight", "0", "-5", "NaN"]) {
    const q = plan({ maxCostUsd: bad });
    assert.ok(q.errors.length > 0, `max_cost_usd ${JSON.stringify(bad)} was accepted`);
    assert.match(q.errors.join(" "), /max_cost_usd/);
  }
  assert.match(plan({ maxCostUsd: "" }).errors.join(" "), /required and has no default/);
  // Infinity is finite-checked, not merely non-empty: `Number("Infinity")` is a
  // number and would otherwise pass as "a cap".
  assert.ok(plan({ maxCostUsd: "Infinity" }).errors.length > 0, "Infinity is not a ceiling");
});

test("planReplay: the run id is required, and must be a usable path segment", () => {
  // Required because of RESUMABILITY and not tidiness: run.mjs will invent a
  // clock-derived id, and an invented id cannot be named by a later dispatch, so the
  // "a crash costs one item" property silently becomes "a crash costs the run".
  assert.match(plan({ runId: "" }).errors.join(" "), /run_id is required/);
  assert.match(plan({ runId: "   " }).errors.join(" "), /run_id is required/);
  for (const bad of ["a/b", "../escape", ".hidden", "-leading", "has space", "x\u0000y"]) {
    assert.ok(plan({ runId: bad }).errors.length > 0, `run_id ${JSON.stringify(bad)} was accepted`);
  }
  assert.deepEqual(plan({ runId: "2026-08-07-pilot.a_b" }).errors, []);
});

test("isStoreSegment agrees with the STORE, not with its own comment", () => {
  // The regex in replay-plan.mjs is a copy of a private one in store.mjs, and a copy
  // is a thing that drifts. So this compares the predicate against the store's
  // ACTUAL behaviour — `hasItem` runs the same `requireSegment` the write path does —
  // rather than against a re-typed pattern, which would agree with itself forever.
  const root = mkdtempSync(path.join(tmpdir(), "replay-plan-segment-"));
  try {
    const store = new EvalStore(root);
    const storeAccepts = (id) => {
      try {
        store.hasItem(id, "pr-1");
        return true;
      } catch {
        return false;
      }
    };
    for (const candidate of [
      "pilot", "pilot__k1", "dryrun-pilot__k3", "2026-08-07-pilot", "a", "A.1_2-3",
      "", " ", "a/b", "../x", ".dot", "-dash", "_under", "x y", "x\u0000y", "ünïcode",
    ]) {
      assert.equal(
        isStoreSegment(candidate),
        storeAccepts(candidate),
        `isStoreSegment and the store disagree about ${JSON.stringify(candidate)}`,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- the item subset ---------------------------------------------------------

test("planReplay: an item id that is not in the corpus is REFUSED, not skipped", () => {
  // The fail direction is the point. run.mjs prints "not in corpus" and CONTINUES,
  // so a dispatch that asked for `pr-542` meaning `pr-524` would replay the rest and
  // exit 0 — a quietly smaller run. Refused here, where it is still free.
  const p = plan({ items: "pr-542" });
  assert.ok(p.errors.length > 0);
  assert.match(p.errors.join(" "), /pr-542.*is not in corpus/);
  // And the message lists what IS there, because the next thing the operator does is
  // re-type the id.
  assert.match(p.errors.join(" "), /pr-415, pr-524/);

  const good = plan({ items: "pr-524" });
  assert.deepEqual(good.errors, []);
  assert.deepEqual(good.itemIds, ["pr-524"], "a subset replays only what was asked for");
  assert.deepEqual(good.prs, [524]);
});

test("planReplay: an empty subset means the WHOLE corpus, and whitespace is not a subset", () => {
  assert.deepEqual(plan({ items: "" }).itemIds, ["pr-415", "pr-524"]);
  assert.deepEqual(plan({ items: "   " }).itemIds, ["pr-415", "pr-524"]);
  // A trailing comma is a typo that must not become an empty item id.
  assert.deepEqual(plan({ items: "pr-524," }).itemIds, ["pr-524"]);
  assert.deepEqual(plan({ items: " pr-524 , pr-415 " }).itemIds, ["pr-524", "pr-415"]);
});

// --- the refs ----------------------------------------------------------------

test("planReplay: every planned item becomes a pull-ref refspec and an asserted commit", () => {
  // The failure this prevents is the one most likely to appear only when money is
  // being spent: a squash-merged PR's head is in no clone of this repository, so
  // without these refspecs every item refuses with `no-repo-context` and the run
  // replays nothing while looking tidy.
  const p = plan();
  const pullRefs = p.refspecs.filter((r) => r.startsWith("refs/pull/"));
  assert.deepEqual(pullRefs, [
    "refs/pull/415/head:refs/eval/pr/415",
    "refs/pull/524/head:refs/eval/pr/524",
  ]);
  // `refs/eval/pr/<n>` is extract-corpus.mjs's own destination, so a runner's refs
  // read the same as a laptop's. (The list also carries the source repo's `main`,
  // which the sibling test above owns.)
  for (const r of pullRefs) assert.match(r, /^refs\/pull\/\d+\/head:refs\/eval\/pr\/\d+$/);
  assert.deepEqual(
    p.commits,
    [
      { itemId: "pr-415", commit: ITEMS[0].review_commit, pr: 415 },
      { itemId: "pr-524", commit: ITEMS[1].review_commit, pr: 524 },
    ],
    "each commit is carried with its item, so the post-fetch assertion can name which item is missing",
  );
});

test("planReplay: the refs are fetched from the repo the CORPUS names, never from origin", () => {
  // The bug this closes is a silent one and it only appears off the upstream
  // checkout: a fork does not carry its parent's `refs/pull/*`. Measured 2026-08-10 —
  // `wafflebase/wafflebase` has all seven pilot refs, `dlgpdmsly2/wafflebase` has one,
  // its own. A lane fetching from `origin` therefore works when dispatched upstream
  // and refuses every item anywhere else, naming nothing.
  const p = plan();
  assert.equal(p.sourceRepo, "wafflebase/wafflebase");
  assert.equal(p.sourceRepoUrl, "https://github.com/wafflebase/wafflebase.git");

  // Absent, or not `owner/name`, is a refusal — not a guess at this repository.
  for (const bad of [undefined, null, "", "   ", "wafflebase", "a/b/c", "../evil", "a b/c", "https://github.com/x/y"]) {
    const q = plan({ sourceRepo: bad });
    assert.ok(q.errors.length > 0, `source_repo ${JSON.stringify(bad)} was accepted`);
    assert.match(q.errors.join(" "), /source_repo/);
    assert.equal(q.sourceRepoUrl, null, "a refused source repo must not yield a fetch target");
  }
});

test("planReplay: main is fetched from the source repo too, because a base is not always in its own PR", () => {
  // Measured on the pilot: pr-524's and pr-605's `review_base` ARE ancestors of their
  // pull heads, and **pr-415's is not**. So the pull refs alone do not guarantee the
  // bases, and base resolution would otherwise depend on how complete the running
  // checkout's own history happens to be — which on a stale fork is a real question.
  const p = plan();
  assert.deepEqual(p.refspecs, [
    "refs/pull/415/head:refs/eval/pr/415",
    "refs/pull/524/head:refs/eval/pr/524",
    "refs/heads/main:refs/eval/source-main",
  ]);
  assert.ok(
    p.refspecs.some((r) => r.startsWith("refs/heads/main:")),
    "the source repository's main must be fetched, or a base that is not in its own PR cannot resolve",
  );
});

test("planReplay: an item with no source_pr or no review_commit is refused by NAME", () => {
  // Both are unfetchable-in-CI in different ways, and seven identical
  // `no-repo-context` refusals is a worse report than one sentence naming the item.
  const noPr = plan({ manifestItems: [{ id: "pr-999", review_commit: "a".repeat(40) }] });
  assert.match(noPr.errors.join(" "), /"pr-999" has no usable source_pr/);
  for (const bad of [undefined, null, 0, -1, "abc", 1.5]) {
    const q = plan({ manifestItems: [{ id: "pr-999", source_pr: bad, review_commit: "a".repeat(40) }] });
    assert.ok(q.errors.length > 0, `source_pr ${JSON.stringify(bad)} was accepted`);
  }
  const noCommit = plan({ manifestItems: [{ id: "pr-999", source_pr: 999 }] });
  assert.match(noCommit.errors.join(" "), /"pr-999" has no review_commit/);
});

test("planReplay: an empty or missing corpus is refused rather than replayed as nothing", () => {
  assert.match(plan({ manifestItems: [] }).errors.join(" "), /has no items in the store/);
  assert.match(plan({ manifestItems: null }).errors.join(" "), /has no items in the store/);
});

// --- the two ceilings --------------------------------------------------------

test("planReplay: the per-item timeout and the job timeout must AGREE", () => {
  // Computed rather than commented, because the corpus grows. An eighth item pushes
  // the worst case past a hardcoded `timeout-minutes`, and the symptom is a job
  // killed mid-item with that item's spend unbanked — which is the one failure that
  // costs money and produces nothing.
  const p = plan();
  assert.deepEqual(p.errors, []);
  // 2 items x 1800s = 60min, + 25min overhead = 85min, inside 240.
  assert.equal(p.worstCaseMin, 85);

  // Eight items at 1800s is 240min of panel alone, which does not fit with overhead.
  const many = plan({
    manifestItems: Array.from({ length: 8 }, (_, i) => ({ id: `pr-${i + 1}`, source_pr: i + 1, review_commit: "a".repeat(40) })),
  });
  assert.ok(many.errors.length > 0, "8 items x 30min + overhead must not fit inside 240min");
  assert.match(many.errors.join(" "), /the two ceilings disagree/);
  assert.match(many.errors.join(" "), /loses that item's spend/);

  // Raising the job ceiling is the documented remedy, so it must actually work.
  assert.deepEqual(
    plan({
      manifestItems: Array.from({ length: 8 }, (_, i) => ({ id: `pr-${i + 1}`, source_pr: i + 1, review_commit: "a".repeat(40) })),
      jobTimeoutMin: "300",
    }).errors,
    [],
  );
  for (const bad of [undefined, "", "0", "-1", "soon"]) {
    assert.ok(plan({ panelTimeoutS: bad }).errors.length > 0, `panel timeout ${JSON.stringify(bad)} was accepted`);
  }
});

// --- legs and the dry-run id space -------------------------------------------

test("legRunId: a replicate is a run id, and a DRY RUN lives in its own id space", () => {
  // This is a correctness guard, not a label. Resume keys on stored items, so a dry
  // run that wrote to the paid run id would make the paid dispatch skip all seven
  // items as already-done: a store full of canned stub output filed under the
  // pilot's name, reporting `complete`. The prefix makes that unrepresentable.
  assert.equal(legRunId({ runIdStem: "pilot", k: 2, panel: "real" }), "pilot__k2");
  assert.equal(legRunId({ runIdStem: "pilot", k: 2, panel: "stub" }), "dryrun-pilot__k2");
  assert.notEqual(
    legRunId({ runIdStem: "pilot", k: 1, panel: "stub" }),
    legRunId({ runIdStem: "pilot", k: 1, panel: "real" }),
    "a dry run and a paid run must never share a run id",
  );
  // Anything that is not exactly "real" is treated as a dry run — the fail-safe
  // direction, so a mistyped mode cannot spend.
  assert.ok(legRunId({ runIdStem: "p", k: 1, panel: "REAL" }).startsWith(DRY_RUN_PREFIX));
  assert.ok(legRunId({ runIdStem: "p", k: 1, panel: "" }).startsWith(DRY_RUN_PREFIX));

  const p = plan({ replicates: "3", panel: "stub" });
  assert.deepEqual(p.legs, [
    { k: 1, runId: "dryrun-pilot__k1" },
    { k: 2, runId: "dryrun-pilot__k2" },
    { k: 3, runId: "dryrun-pilot__k3" },
  ]);
  // Every generated id must survive the store's grammar, or the leg fails at its
  // first write having already paid for the item.
  for (const leg of p.legs) assert.ok(isStoreSegment(leg.runId), `${leg.runId} is not a store segment`);
  assert.ok(LEG_SUFFIX.length > 0 && DRY_RUN_PREFIX.length > 0);
});

test("planReplay: replicates must be a positive integer", () => {
  for (const bad of [undefined, "", "0", "-1", "2.5", "three", "1e3"]) {
    const q = plan({ replicates: bad });
    if (bad === "1e3") {
      // `Number("1e3")` is the integer 1000, which is a legitimate — if alarming — K.
      // The cost cap is what bounds it, and the exposure line is what shows it.
      assert.deepEqual(q.errors, [], "1e3 is an integer and the cap is what bounds it");
      assert.equal(q.exposureUsd, 8000, "and the exposure line says so out loud");
      continue;
    }
    assert.ok(q.errors.length > 0, `replicates ${JSON.stringify(bad)} was accepted`);
  }
  assert.deepEqual(plan({ replicates: "1" }).legs, [{ k: 1, runId: "pilot__k1" }]);
});

test("planReplay: the panel mode is a closed set", () => {
  assert.deepEqual(PANEL_MODES, ["stub", "real"]);
  assert.equal(PANEL_MODES[0], "stub", "the first option is what a choice input defaults to, and it must be the free one");
  for (const bad of [undefined, "", "REAL", "Real", "dry", "yes"]) {
    assert.ok(plan({ panel: bad }).errors.length > 0, `panel ${JSON.stringify(bad)} was accepted`);
  }
});

test("planSummary: a dry run says so first, and a real run leads with the EXPOSURE", () => {
  // The banner is the thing an operator reads in the Actions log, and the two failure
  // modes are symmetric: a paid run mistaken for free, and a free run mistaken for
  // paid. Both are named in the first line.
  const dry = planSummary(plan({ panel: "stub" }));
  assert.match(dry[0], /DRY RUN/);
  assert.match(dry[0], /NOTHING IS PUSHED/);
  assert.match(dry.join("\n"), new RegExp(DRY_RUN_PANEL_SHA));

  const real = planSummary(plan({ panel: "real", maxCostUsd: "8", replicates: "3" }));
  assert.match(real[0], /REAL PANEL/);
  assert.match(real[0], /spends money/);
  assert.match(real.join("\n"), /EXPOSURE\s*:\s*\$8\.00 cap PER REPLICATE x 3 = \$24\.00/);
  assert.equal(/DRY RUN/.test(real.join("\n")), false, "a paid run's banner must not mention a dry run");
});

// --- the workflow ------------------------------------------------------------

test("the replay workflow has NO write scope on THIS repository", () => {
  // The load-bearing property, mirroring `collect-captures.test.mjs`'s assertion for
  // the collector. This workflow writes to a DIFFERENT repository through a token
  // scoped to that one repository, so its own GITHUB_TOKEN stays as powerless as it
  // was before the file existed — and a later "it would be simpler if it just
  // committed the results here" has to argue with a test.
  const lines = readFileSync(WORKFLOW, "utf8").split("\n").filter((l) => !/^\s*#/.test(l));
  const at = lines.findIndex((l) => /^permissions:\s*$/.test(l));
  assert.ok(at >= 0, "the workflow must declare a top-level permissions block");
  const block = [];
  for (let i = at + 1; i < lines.length; i++) {
    if (lines[i].trim() === "") continue;
    if (!/^\s+\S/.test(lines[i])) break;
    block.push(lines[i]);
  }
  assert.deepEqual(block.map((l) => l.trim().replace(/\s*#.*$/, "")).sort(), ["actions: read", "contents: read"]);
  // No write scope ANYWHERE, including a job-level block that would override the one
  // above, and no `id-token: write` — there is no cloud credential to mint yet.
  assert.equal(/:\s*write\b/.test(yamlOnly()), false, "a write scope appears in eval-replay.yml");
});

test("the ONLY trigger is workflow_dispatch", () => {
  // Not style, and not negotiable: a paid job that can start without a human press is
  // the failure this whole design is arranged against. A `schedule` here would spend
  // the budget nightly; a `pull_request` would spend it per push; a `workflow_run`
  // would both spend it and consume the last level of GitHub's three-deep chain
  // limit, silently stopping the capture collector from ever firing again.
  const lines = yamlOnly().split("\n");
  const at = lines.findIndex((l) => /^on:\s*$/.test(l));
  assert.ok(at >= 0, "the workflow must declare an `on:` block");
  // The keys at exactly one level of indentation under `on:` — the event names.
  const events = [];
  for (let i = at + 1; i < lines.length; i++) {
    if (lines[i].trim() === "") continue;
    if (!/^\s+\S/.test(lines[i])) break;
    const m = /^ {2}(\S+):/.exec(lines[i]);
    if (m) events.push(m[1]);
  }
  assert.deepEqual(events, ["workflow_dispatch"], `the replay lane must have exactly one trigger, found ${JSON.stringify(events)}`);
  for (const forbidden of ["schedule", "pull_request", "pull_request_target", "push", "workflow_run", "issue_comment", "repository_dispatch"]) {
    assert.equal(events.includes(forbidden), false, `${forbidden} must never trigger a job that spends money`);
  }
});

test("no run: body interpolates a ${{ }} expression, and every input read is DECLARED", () => {
  // Two bugs in one test, both of which cost money here.
  //
  // First: an expression is expanded by the runner before the shell sees it, so a
  // value containing a quote or a `;` becomes script rather than data. Scanned block
  // by block, because a whole-file regex for `run:` matches inside `workflow_run:` —
  // which is how the collector's first version of this assertion passed for the wrong
  // reason.
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

  // Second, and this is the one that would be expensive: a MISTYPED input expression
  // is not an error in Actions, it interpolates to the EMPTY STRING. `inputs.item`
  // for `inputs.items` would silently widen a one-item probe into the whole corpus,
  // and `inputs.max_cost` for `inputs.max_cost_usd` would drop the ceiling. So every
  // `inputs.X` read anywhere in the file must be a declared input.
  const declaredAt = lines.findIndex((l) => /^\s{4}inputs:\s*$/.test(l));
  assert.ok(declaredAt >= 0, "workflow_dispatch must declare an inputs block");
  const declared = new Set();
  for (let i = declaredAt + 1; i < lines.length; i++) {
    if (lines[i].trim() === "") continue;
    const m = /^ {6}(\S+):\s*$/.exec(lines[i]);
    if (m) { declared.add(m[1]); continue; }
    if (/^ {0,5}\S/.test(lines[i])) break;
  }
  assert.ok(declared.size >= 6, `expected the six dispatch inputs, found ${JSON.stringify([...declared])}`);
  const read = [...yaml.matchAll(/inputs\.([A-Za-z0-9_]+)/g)].map((m) => m[1]);
  assert.ok(read.length > 0, "the workflow must read its inputs somewhere");
  for (const name of new Set(read)) {
    assert.ok(declared.has(name), `the workflow reads inputs.${name}, which is not declared — it would interpolate to ""`);
  }
});

test("the store-write token is held by ONE job, and never by a job that runs a model", () => {
  // The addition this lane makes to the collector's permission story, and the reason
  // it is worth a test: a replay job builds a worktree of an arbitrary past pull
  // request and points a model at it. A credential that can write to the store must
  // not be in that environment, because the permissions block cannot help — a secret
  // is not a permission, it is already in the process.
  const yaml = yamlOnly();
  assert.match(yaml, /token:\s*\$\{\{\s*secrets\.EVAL_STORE_TOKEN\s*\}\}/, "the store checkout must use the scoped secret");
  assert.match(yaml, /repository:\s*['"]?dlgpdmsly2\/wafflebase-agent-eval/, "the store checkout must name the other repository");

  // Split the file into jobs and check the two credentials never co-occur.
  const jobsAt = yaml.split("\n").findIndex((l) => /^jobs:\s*$/.test(l));
  assert.ok(jobsAt >= 0);
  const rest = yaml.split("\n").slice(jobsAt + 1);
  const jobs = [];
  for (const line of rest) {
    const m = /^ {2}(\S+):\s*$/.exec(line);
    if (m) { jobs.push({ name: m[1], lines: [] }); continue; }
    if (jobs.length) jobs[jobs.length - 1].lines.push(line);
  }
  assert.ok(jobs.length >= 2, `expected several jobs, found ${JSON.stringify(jobs.map((j) => j.name))}`);
  let writers = 0;
  for (const job of jobs) {
    const body = job.lines.join("\n");
    const holdsStoreToken = /secrets\.EVAL_STORE_TOKEN/.test(body);
    const holdsModelToken = /secrets\.CLAUDE_CODE_OAUTH_TOKEN/.test(body);
    assert.equal(
      holdsStoreToken && holdsModelToken,
      false,
      `job "${job.name}" holds BOTH the model credential and the store-write credential`,
    );
    if (holdsStoreToken) writers++;
    // A job that runs a model must not persist this repository's credentials into a
    // checkout a model can read either.
    if (holdsModelToken) {
      assert.match(body, /persist-credentials:\s*false/, `job "${job.name}" runs a model and must not persist git credentials`);
    }
  }
  assert.equal(writers, 1, "exactly one job may hold the store-write token");
});

test("the cost cap always reaches run.mjs, and an unbounded run is NOT expressible", () => {
  // The workflow layer is deliberately narrower than the CLI layer. #716 lets an
  // operator at a terminal say `--no-cost-cap`; this lane offers no way to say it,
  // because "unbounded" is a choice for somebody who is watching, and nobody is
  // watching this. If that flag ever appears here, the guard is gone.
  const yaml = yamlOnly();
  assert.equal(/--no-cost-cap/.test(yaml), false, "an unbounded run must not be expressible from this workflow");
  // EVERY site that passes the cap reads it from the environment, quoted — never
  // interpolated and never a bare word. Asserted as a property of each occurrence
  // rather than as a count of them, because the count is an implementation detail
  // (the preflight runs in two jobs) and a brittle assertion here would be
  // "corrected" by loosening it.
  const capLines = yaml.split("\n").filter((l) => l.includes("--max-cost-usd"));
  assert.ok(capLines.length >= 2, `the cap must reach both the preflight and the replay, found ${capLines.length} site(s)`);
  for (const l of capLines) assert.match(l, /--max-cost-usd "\$MAX_COST_USD"/, `unquoted or renamed cap: ${l.trim()}`);
  // And it is in the replay's own argument array, unconditionally — not inside an
  // `if` branch that could leave it out.
  const argsBlock = yaml.slice(yaml.indexOf("ARGS=("), yaml.indexOf("run.mjs \"${ARGS[@]}\""));
  assert.match(argsBlock, /--max-cost-usd "\$MAX_COST_USD"/, "the cap must be unconditional, not added in a branch");
});

test("a dry run cannot push, and cannot borrow the paid run's id", () => {
  // The two ways a stub run could do damage: writing canned output into the store's
  // permanent history, and occupying the run id a paid dispatch is about to resume
  // into. Both are closed, and both are closed structurally rather than by remembering.
  const yaml = yamlOnly();
  // The stub is reached only with an explicit sha, so it cannot inherit the real
  // panel's identity — #716 refuses a non-sibling script without one.
  assert.match(yaml, /--panel-script scripts\/agent\/eval\/adapters\/stub-panel\.mjs/);
  assert.match(yaml, new RegExp(`--panel-sha ${DRY_RUN_PANEL_SHA}`), "a dry run records a synthetic panel sha");
  // The push is gated on the mode, and the gate is `!= "real"` so that anything
  // unexpected fails toward NOT pushing.
  //
  // Scoped to the COMMIT step. The replay step carries an identical-looking gate, and
  // a whole-file version of this assertion was satisfied by that one while the commit
  // step's had been inverted to `= "real"` — a mutation that pushes stub output into
  // permanent history, passing every test.
  const commit = stepBody("Commit, and push only for a real run");
  const pushAt = commit.indexOf("git push ||");
  assert.ok(pushAt > 0, "the commit step must contain the push");
  const gateAt = commit.lastIndexOf('if [ "$PANEL" != "real" ]; then', pushAt);
  assert.ok(gateAt > 0, "the push must sit behind a `!= real` panel-mode gate in its own step");
  assert.match(commit.slice(gateAt, pushAt), /exit 0/, "a dry run must leave before reaching the push");
});

test("every run.mjs flag the workflow passes is a flag run.mjs ACCEPTS", () => {
  // The guard against the failure mode this PR is most exposed to: the lane is
  // written against the runner's CLI, and the two files are edited by different
  // people at different times. A flag that does not exist is not a syntax error, it
  // is an exit-2 usage refusal discovered by dispatching — free, but only after
  // somebody has scheduled a paid run and watched it not happen.
  //
  // NOTE ON ORDERING: `--max-cost-usd` and `--panel-timeout` arrive with the runner's
  // cost-and-fidelity guards. Until that change is in `main`, THIS TEST IS THE
  // ORDERING CONSTRAINT and it fails here rather than in production.
  const runner = readFileSync(path.join(HERE, "run.mjs"), "utf8");
  const yaml = yamlOnly();
  // BOUNDED to the argument array and its invocation. Slicing to end-of-file swept up
  // `--cached` and `--name-only` from the git commands in the last job and reported
  // them as runner flags — a test that failed for a reason that was not the one it
  // names is worse than no test, because the next reader deletes it.
  const from = yaml.indexOf("ARGS=(");
  const to = yaml.indexOf('run.mjs "${ARGS[@]}"');
  assert.ok(from > 0 && to > from, "could not locate the replay invocation");
  const invoked = new Set();
  for (const m of yaml.slice(from, to).matchAll(/(--[a-z][a-z0-9-]*)/g)) invoked.add(m[1]);
  assert.ok(invoked.has("--root") && invoked.has("--max-cost-usd"), `did not find the replay invocation's flags, got ${JSON.stringify([...invoked])}`);
  // The dry-run pair is added in a branch, so it must be inside the bounded slice too
  // — otherwise this test would silently stop covering the stub path.
  assert.ok(invoked.has("--panel-script") && invoked.has("--panel-sha"), "the dry-run flags are outside the checked region");
  for (const flag of invoked) {
    assert.ok(
      runner.includes(flag),
      `the workflow passes ${flag} to run.mjs, which does not mention it (arrives with the runner's cost/fidelity guards?)`,
    );
  }
});

test("the fetch step proves the corpus commits arrived, rather than assuming it", () => {
  // The step whose absence is invisible. A squash-merged head is in no clone of this
  // repository, so a lane that fetched nothing would refuse all seven items for free
  // and report a tidy run on a day somebody expected data. Measured on the pilot:
  // all seven ABSENT from a fresh clone with 19 branches and 27 tags.
  // Scoped to the fetch step. A whole-file `exit 1` was answered by the staging step's
  // own `exit 1`, so downgrading this step to a warning passed every test — the exact
  // failure the step exists to prevent, made invisible by the test meant to pin it.
  const fetch = stepBody("Fetch the corpus commits, and prove they arrived");
  assert.match(fetch, /xargs git fetch --no-tags "\$source_url" < "\$RUNNER_TEMP\/plan\/refspecs\.txt"/);
  // NOT `origin`. The remote comes from the corpus manifest, via a file the preflight
  // wrote, so the step cannot derive it differently — and the lane keeps working when
  // dispatched from a fork, which carries none of its parent's pull refs.
  assert.equal(/git fetch[^\n]*\borigin\b/.test(fetch), false, "the corpus refs must not be fetched from origin");
  assert.match(fetch, /source_url="\$\(cat "\$RUNNER_TEMP\/plan\/source-repo-url\.txt"\)"/);
  // Asserted per item, and the failure names the item.
  assert.match(fetch, /git cat-file -e "\$\{commit\}\^\{commit\}"/);
  assert.match(fetch, /^\s*exit 1$/m, "a missing commit must FAIL this step, not warn");

  // THE FALLBACK, and its ORDER. `refs/pull/<n>/head` tracks a pull request's CURRENT
  // head, so a frozen `review_commit` that was later force-pushed away is not in it —
  // measured on pr-415, whose corpus commit and pull-ref tip have diverged. Anything
  // the pull refs did not carry is then asked for by full sha.
  // Deliberately NOT pinned to the exact flag string. A tight match here would fail
  // first on any flag change and mask the two assertions below, which are the ones
  // that carry the real constraints — mutation testing showed the shallow-fetch
  // mutation being caught by this line rather than by the guard that means it.
  assert.match(fetch, /git fetch[^\n]*"\$\{commit\}:refs\/eval\/item\/\$\{item\}"/, "missing commits must be retried by sha");
  const primaryAt = fetch.indexOf("xargs git fetch");
  const retryAt = fetch.indexOf('"${commit}:refs/eval/item/${item}"');
  const assertAt = fetch.indexOf("missing=0");
  assert.ok(primaryAt >= 0 && retryAt > primaryAt, "the pull ref must remain the FIRST attempt");
  assert.ok(assertAt > retryAt, "the retry must come BEFORE the assertion, or it cannot help");

  // NO `--depth` on the retry. A shallow fetch marks the repository shallow, and a
  // shallow tree cannot be blamed — which silently disables the novelty gate that is
  // the whole reason the lane materialises a worktree rather than an archive.
  assert.equal(/--depth/.test(fetch), false, "a shallow fetch would leave a tree the novelty gate cannot blame");
  // The retry goes to the corpus's own source repo, never to a remote of this checkout.
  assert.equal(/git fetch[^\n]*\borigin\b/.test(fetch), false, "the retry must not reach for origin either");

  const yaml = yamlOnly();
  // `fetch-depth: 0` is the other half — the review BASES are ancestors of main and
  // come from the checkout's depth, not from the pull refs.
  assert.match(yaml, /fetch-depth:\s*0/);
});

test("the paid job is bounded in time, and the bound is not the 360-minute default", () => {
  // Every job carries a ceiling: an unbounded paid job is six hours of runner and an
  // unbounded number of model calls. The replay leg's ceiling must also match what
  // the preflight computes against, or the arithmetic that reconciles the two
  // timeouts is checking a number nothing uses.
  const yaml = yamlOnly();
  // Scoped to the `jobs:` block. A two-space key is a job name there and an EVENT
  // name under `on:` — counting the whole file made `workflow_dispatch` a job, and the
  // first version of this assertion failed for that reason rather than a real one.
  const jobsBlock = yaml.slice(yaml.indexOf("\njobs:\n"));
  const timeouts = [...jobsBlock.matchAll(/^\s+timeout-minutes:\s*(\d+)/gm)].map((m) => Number(m[1]));
  const jobs = [...jobsBlock.matchAll(/^ {2}(\S+):\s*$/gm)].map((m) => m[1]);
  assert.deepEqual(jobs, ["plan", "replay", "collect"], "the lane is a preflight, the paid legs, and one committer");
  assert.equal(timeouts.length, jobs.length, `every job needs a timeout-minutes: ${jobs.length} jobs, ${timeouts.length} timeouts`);
  for (const t of timeouts) assert.ok(t > 0 && t < 360, `${t} is not a real bound`);
  assert.match(yaml, /JOB_TIMEOUT_MIN:\s*"(\d+)"/);
  const declared = Number(/JOB_TIMEOUT_MIN:\s*"(\d+)"/.exec(yaml)[1]);
  assert.ok(timeouts.includes(declared), `the replay job's timeout-minutes must be the ${declared} the preflight reconciles against`);
  assert.match(yaml, /PANEL_TIMEOUT_S:\s*"\d+"/);
  assert.match(yaml, /--panel-timeout "\$PANEL_TIMEOUT_S"/, "the per-item ceiling must reach the runner");
});

test("a failing or capped leg still banks its data, and only a real run pushes it", () => {
  // A capped run exits NON-ZERO on purpose — it did not do what it was asked. Without
  // `always()` on the upload, the artifact step would be skipped and the paid items
  // it did store would be thrown away by the guard that reported the cap. The
  // collector shipped the same bug once, with five captures written and none
  // committed.
  const yaml = yamlOnly();
  assert.match(yaml, /if:\s*\$\{\{\s*always\(\)\s*\}\}\s*\n\s*uses:\s*actions\/upload-artifact/);
  // The commit job runs after a failed leg, but not after a cancellation, and not
  // when the replay never ran at all.
  assert.match(yaml, /if:\s*\$\{\{\s*!cancelled\(\)\s*&&\s*needs\.replay\.result\s*!=\s*'skipped'\s*\}\}/);
  // A leg failing must not cancel its paid siblings.
  assert.match(yaml, /fail-fast:\s*false/);
});

// --- the lens configuration ---------------------------------------------------

const REPO_ROOT = path.resolve(HERE, "..", "..", "..");
/** The committed lens config, which the tests below copy rather than imitate. */
const REAL_LENSES = path.join(HERE, "..", "lenses");

/**
 * A throwaway checkout root, so a containment test has a tree to be inside or
 * outside of. `realpathSync` because macOS puts `mkdtemp` behind `/var → /private/var`
 * and a containment check that compared one resolved path against one unresolved one
 * would refuse every temp dir for the wrong reason.
 */
function fakeCheckout() {
  return realpathSync(mkdtempSync(path.join(tmpdir(), "replay-plan-lenses-")));
}

/** A copy of the REAL lens config at `dest`, optionally with its manifest rewritten. */
function copyLenses(dest, rewrite = null) {
  cpSync(REAL_LENSES, dest, { recursive: true });
  if (rewrite) {
    const manifestPath = path.join(dest, "lenses.json");
    writeFileSync(manifestPath, JSON.stringify(rewrite(JSON.parse(readFileSync(manifestPath, "utf8"))), null, 2));
  }
  return dest;
}

test("planLensConfig: the default is run.mjs's OWN default, not a second opinion about it", () => {
  // The one duplicated constant in this module, and the reason `SEGMENT` above is
  // duplicated too: run.mjs does not export it. So it is pinned against the runner's
  // ACTUAL resolution rather than against a re-typed path, which would agree with
  // itself forever. If run.mjs moves its lenses dir, this fails here — free — instead
  // of in a preflight that prints a hash for a directory the replay will not read.
  assert.equal(DEFAULT_LENSES_DIR, resolveRunOptions(["node", "run.mjs"]).lensesDir);

  const lens = planLensConfig({});
  assert.deepEqual(lens.errors, []);
  assert.equal(lens.isDefault, true);
  assert.equal(lens.dir, realpathSync(DEFAULT_LENSES_DIR));
  assert.match(lens.configHash, /^sha256:[0-9a-f]{64}$/);
  assert.ok(lens.lenses.length > 0, "the committed config must declare lenses");
});

test("planLensConfig: a relative path INSIDE the checkout is accepted, an escaping one is refused", () => {
  // Both directions, because a containment check that refuses everything is as broken
  // as one that refuses nothing — and only one of those two failures is loud.
  const ok = planLensConfig({ value: "scripts/agent/lenses", cwd: REPO_ROOT });
  assert.deepEqual(ok.errors, [], "the committed lenses dir, named relatively, must be usable");
  assert.equal(ok.configHash, planLensConfig({}).configHash, "the same directory by two names is the same reviewer");

  // NORMALISED INTO OBEDIENCE is the failure being guarded against: `path.resolve`
  // will happily flatten any of these into a real location on the runner, and a
  // dispatch that can name one can point the panel at anything on the box.
  for (const escape of ["..", "../", "../../../etc", "scripts/../../..", "scripts/agent/lenses/../../../.."]) {
    const bad = planLensConfig({ value: escape, cwd: REPO_ROOT });
    assert.equal(bad.errors.length, 1, `lenses_dir ${JSON.stringify(escape)} was accepted`);
    assert.match(bad.errors[0], /OUTSIDE the checked-out tree/);
  }
});

test("planLensConfig: an ABSOLUTE path is refused by name, even one that lands inside the tree", () => {
  // Refused as a kind of value, not merely because of where it points. An absolute
  // path in a dispatch form describes the runner's layout rather than the branch's
  // contents, and the containment check cannot catch the one that happens to be
  // inside — which is exactly the one that would teach an operator the habit.
  const inside = planLensConfig({ value: REAL_LENSES });
  assert.equal(inside.errors.length, 1, "an absolute path inside the tree was accepted");
  assert.match(inside.errors[0], /ABSOLUTE path/);
  assert.match(planLensConfig({ value: "/etc" }).errors[0], /ABSOLUTE path/);
});

test("planLensConfig: a symlink out of the tree is refused, which no lexical check can see", () => {
  // `git` stores symlinks, so `scripts/agent/lenses-x -> /somewhere` is a thing a
  // branch can carry. The path is lexically innocent and the target is not.
  const root = fakeCheckout();
  const outside = fakeCheckout();
  try {
    // A REAL lens config at the far end, so that removing the realpath check makes
    // this dispatch succeed rather than fail for some other reason.
    copyLenses(path.join(outside, "lenses"));
    symlinkSync(path.join(outside, "lenses"), path.join(root, "lenses-link"), "dir");
    const lens = planLensConfig({ value: "lenses-link", repoRoot: root, cwd: root });
    assert.equal(lens.errors.length, 1, "a symlink out of the checkout was followed");
    assert.match(lens.errors[0], /outside the checked-out tree/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("planLensConfig: a directory that is not in the checkout is refused, not defaulted away", () => {
  const missing = planLensConfig({ value: "scripts/agent/lenses-sonnet", cwd: REPO_ROOT });
  assert.equal(missing.errors.length, 1);
  assert.match(missing.errors[0], /not a directory in this checkout/);
  // And it is NOT quietly the default: a variant that was never committed must fail
  // the dispatch, not run the control arm under the variant's name.
  assert.equal(missing.configHash, null);
});

test("planLensConfig: a directory with no lenses.json is not a lens configuration", () => {
  const root = fakeCheckout();
  try {
    mkdirSync(path.join(root, "empty-dir"));
    const lens = planLensConfig({ value: "empty-dir", repoRoot: root, cwd: root });
    assert.equal(lens.errors.length, 1);
    assert.match(lens.errors[0], /holds no lenses\.json/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("planLensConfig: a manifest declaring ZERO lenses is refused — buildConfig would take it", () => {
  const root = fakeCheckout();
  try {
    const dir = path.join(root, "no-lenses");
    mkdirSync(dir);
    writeFileSync(path.join(dir, "lenses.json"), "[]\n");

    // The reason this guard is not redundant, asserted rather than claimed: the
    // builder maps an empty array to an empty array and hands back a perfectly valid
    // configuration. A replay under it would review nothing, find nothing, and report
    // a complete run — the one failure that produces confident numbers from nothing.
    const built = buildConfig(dir, { configId: "baseline" });
    assert.equal(built.snapshot.lenses.length, 0, "buildConfig is expected to ACCEPT an empty manifest");

    const lens = planLensConfig({ value: "no-lenses", repoRoot: root, cwd: root });
    assert.equal(lens.errors.length, 1);
    assert.match(lens.errors[0], /declares no lenses/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("planLensConfig: buildConfig's own refusals arrive HERE, one runner-minute instead of a paid leg", () => {
  const root = fakeCheckout();
  try {
    // A rubric the manifest names and the directory does not have. The runner would
    // hit this after checkout, npm ci, and a pull-ref fetch, on the way to spending.
    const missingRubric = copyLenses(path.join(root, "lenses-no-rubric"));
    rmSync(path.join(missingRubric, `${JSON.parse(readFileSync(path.join(missingRubric, "lenses.json"), "utf8"))[0].id}.md`));
    const a = planLensConfig({ value: "lenses-no-rubric", repoRoot: root, cwd: root });
    assert.equal(a.errors.length, 1, "a variant missing a rubric was accepted");
    assert.match(a.errors[0], /does not build/);

    // And the cost dial specifically: `assertEffort` exists because an unrecognised
    // effort is dropped silently and the session runs at the SDK default.
    copyLenses(path.join(root, "lenses-bad-effort"), (m) => m.map((l, i) => (i === 0 ? { ...l, effort: "very-high" } : l)));
    const b = planLensConfig({ value: "lenses-bad-effort", repoRoot: root, cwd: root });
    assert.equal(b.errors.length, 1, "a variant with an invalid effort was accepted");
    assert.match(b.errors[0], /does not build/);
    assert.match(b.errors[0], /effort/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("planLensConfig: a model swap MOVES config_hash, which is what makes the arms separable", () => {
  // The property the whole input rests on, taken from the store's key rather than
  // asserted about it: `model` is in HASHED_LENS_FIELDS, so a variant is a different
  // reviewer by construction and needs nothing new to keep its results apart.
  const root = fakeCheckout();
  try {
    copyLenses(path.join(root, "lenses-sonnet"), (m) => m.map((l) => ({ ...l, model: "claude-sonnet-5" })));
    copyLenses(path.join(root, "lenses"));
    const variant = planLensConfig({ value: "lenses-sonnet", repoRoot: root, cwd: root });
    const baseline = planLensConfig({ value: "lenses", repoRoot: root, cwd: root });
    assert.deepEqual(variant.errors, []);
    assert.deepEqual(baseline.errors, []);
    assert.notEqual(variant.configHash, baseline.configHash, "a model swap must not pool with the config it was swapped from");
    assert.ok(variant.lenses.every((l) => l.model === "claude-sonnet-5"));
    assert.equal(variant.isDefault, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("planSummary: says WHICH reviewer is about to be bought, with the whole hash", () => {
  // The operator's last free look at the thing they are paying for. Abbreviated it
  // would be unusable for the only purpose it has, which is being compared against
  // the other arm's.
  const control = planSummary(plan({ panel: "real" }), planLensConfig({})).join("\n");
  assert.match(control, /lens config\s*:.*the committed default/);
  assert.match(control, new RegExp(`config_hash\\s*:\\s*${planLensConfig({}).configHash}`));

  const root = fakeCheckout();
  try {
    copyLenses(path.join(root, "lenses-sonnet"), (m) => m.map((l) => ({ ...l, model: "claude-sonnet-5" })));
    const lens = planLensConfig({ value: "lenses-sonnet", repoRoot: root, cwd: root });
    const variant = planSummary(plan({ panel: "real" }), lens).join("\n");
    assert.match(variant, /lens config\s*:\s*VARIANT/);
    assert.match(variant, /claude-sonnet-5/);
    // The one thing an operator must not miss: a variant is not comparable with a run
    // from another week, because the panel moved in between.
    assert.match(variant, /control arm dispatched today/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }

  // And a plan with no lens result — the shape every existing caller passes — is
  // unchanged rather than carrying an empty heading.
  assert.equal(/lens config/.test(planSummary(plan({ panel: "real" })).join("\n")), false);
});

test("a lens variant reaches run.mjs only when one was ASKED for", () => {
  // `--lenses-dir ""` is not the same as omitting the flag: run.mjs takes its default
  // with `??`, which an empty string satisfies, and `path.resolve("")` is the working
  // directory. Passing it unconditionally would point a paid replay at the workspace
  // root. So the flag is conditional in the ARGS array, exactly as ITEMS is.
  const yaml = yamlOnly();
  assert.match(yaml, /^ {6}lenses_dir:$/m, "the dispatch must declare the input");
  const replay = stepBody("Replay");
  assert.match(replay, /LENSES_DIR: \$\{\{ inputs\.lenses_dir \}\}/, "the replay step must read the input into the environment");
  const guarded = /if \[ -n "\$LENSES_DIR" \]; then\s*\n\s*ARGS\+=\(--lenses-dir "\$LENSES_DIR"\)\s*\n\s*fi/;
  assert.match(replay, guarded, "the lenses dir must be added only when non-empty");
  // It is NOT in the unconditional part of the array, where an empty value would
  // reach the runner.
  const argsBlock = replay.slice(replay.indexOf("ARGS=("), replay.indexOf("if [ -n"));
  assert.equal(/--lenses-dir/.test(argsBlock), false, "the lenses dir must not be an unconditional argument");

  // The preflight, by contrast, takes it ALWAYS — empty included — because an empty
  // value there is a fact it must report on: it is the control arm, and its
  // config_hash is printed too.
  for (const step of ["Preflight the dispatch", "Resolve which pull refs this corpus needs"]) {
    assert.match(stepBody(step), /--lenses-dir "\$LENSES_DIR"/, `${step} must preflight the lens config`);
  }
});
