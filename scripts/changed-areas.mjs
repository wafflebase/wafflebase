// Which parts of CI a change can possibly affect.
//
// One resolver, two consumers: `ci.yml`'s `changes` job gates `verify-browser`
// and `verify-integration` on it, and `verify-self.mjs` selects lanes from it.
// They read the SAME mapping (`harness.config.json`'s `ci` key) because two
// copies of a mapping like this drift, and a drifted copy fails silently — the
// run goes green having tested less than it claimed.
//
// WHY NOT `dorny/paths-filter`. Three reasons, in order of weight. The mapping
// has to be shared with `verify-self.mjs`, and an action's outputs only exist
// inside a workflow. The fail-safe below has to be *provable* — five unrelated
// conditions collapse to "run everything", and each one is a test in
// `changed-areas.test.mjs` rather than a claim about a third party's behaviour.
// And its `merge_group` support would be a dependency on undocumented-to-us
// semantics for the one event where being wrong strands a queue entry.
//
// THE SAFETY PROPERTY, stated once: the `inert` list is an ALLOW-LIST, and
// anything unmatched means "run everything". A path nobody classified, a new
// package, a new top-level directory — all default to the full suite. This file
// contains no catch-all rule for that case because it does not need one; it is
// what happens when nothing matches. Inverting it into "these paths trigger
// these areas" would make every future directory silently unguarded, which is
// the failure this shape exists to prevent.
//
// WHY IT DOES NOT FILTER `push` TO `main`. That run is what
// `publish-ghpage.yml` / `docker-publish.yml` wait on, so it is the only
// evidence that what is about to be deployed passed a full suite. A filtered
// main run would make the deploy gate a formality. See
// docs/design/harness-engineering.md#deploy-gate.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { repoScopedEnv } from "./agent/git-env.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");

/**
 * Glob → RegExp, supporting exactly what the config uses: `*` within a path
 * segment and `**` across segments.
 *
 * Hand-rolled rather than `path.matchesGlob`, which is still experimental and
 * prints a runtime warning — this file runs in every CI job, and a warning on
 * stdout is noise in the one place people read logs carefully. Also rather than
 * a dependency: `scripts/` has no package.json of its own, so `minimatch` here
 * would mean a root dependency for 15 lines of code.
 *
 * A doubled star deliberately consumes a following separator, so `docs/**`
 * matches `docs/a.md` via the `.*` tail, and a mid-pattern doubled star followed
 * by a separator still matches zero intermediate directories — the case a naive
 * `.*` plus a literal separator would miss.
 */
export function globToRegExp(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        if (glob[i + 1] === "/") {
          i++;
          out += "(?:.*/)?";
        } else {
          out += ".*";
        }
      } else {
        // A single star stops at a separator. This is load-bearing for `*.md`,
        // which must match README.md and must NOT match packages/README.md —
        // the latter falls through to a full run, which is the safe answer.
        out += "[^/]*";
      }
    } else if ("\\^$.|?+()[]{}".includes(c)) {
      out += `\\${c}`;
    } else {
      out += c;
    }
  }
  return new RegExp(`^${out}$`);
}

const matchesAny = (file, globs) =>
  globs.some((g) => globToRegExp(g).test(file));

/** The `ci` block of harness.config.json. */
export function readCiConfig(repoRoot = REPO_ROOT) {
  const raw = readFileSync(path.join(repoRoot, "harness.config.json"), "utf8");
  const { ci } = JSON.parse(raw);
  if (!ci || !Array.isArray(ci.inert) || !Array.isArray(ci.ciConfig)) {
    throw new Error("harness.config.json is missing a usable `ci` block");
  }
  return ci;
}

/**
 * The pnpm workspace graph, read from each package's own package.json:
 * `{ [dirName]: string[] }` mapping a package to the workspace packages it
 * depends on.
 *
 * Directory names are the ids because paths are what we match against, and
 * every `@wafflebase/x` currently lives at `packages/x`. A package whose name
 * does not follow that is simply absent from the graph, so anything depending
 * on it resolves to no edge — and `reverseClosure` callers treat an unknown
 * package as a full run, not as a leaf.
 */
export function readWorkspaceGraph(repoRoot = REPO_ROOT) {
  const pkgDir = path.join(repoRoot, "packages");
  const graph = {};
  for (const dir of readdirSync(pkgDir)) {
    const manifest = path.join(pkgDir, dir, "package.json");
    // design-sdk-style work in progress: a directory with no manifest yet is
    // not a package. It still matches `packages/**`, so a change there is
    // unmapped and forces a full run.
    if (!existsSync(manifest)) continue;
    const pkg = JSON.parse(readFileSync(manifest, "utf8"));
    const deps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies,
    };
    graph[dir] = Object.keys(deps)
      .filter((d) => d.startsWith("@wafflebase/"))
      .map((d) => d.slice("@wafflebase/".length));
  }
  return graph;
}

/**
 * Every package that could be broken by a change to one of `changed`: the
 * packages themselves plus everything that transitively depends on them.
 *
 * This is the answer to "a backend change altered a payload, does the frontend
 * still work" — and the answer runs in the direction people usually get wrong.
 * A change to `core` reaches everything, because everything imports it. A
 * change to `notes` reaches only `frontend`. Deriving that from the manifests
 * rather than hand-listing it is the point: the mapping cannot go stale when
 * someone adds a dependency, because the dependency IS the mapping.
 */
export function reverseClosure(changed, graph) {
  const dependents = new Map();
  for (const [pkg, deps] of Object.entries(graph)) {
    for (const dep of deps) {
      if (!dependents.has(dep)) dependents.set(dep, []);
      dependents.get(dep).push(pkg);
    }
  }
  const out = new Set();
  const queue = [...changed];
  while (queue.length > 0) {
    const pkg = queue.shift();
    if (out.has(pkg)) continue;
    out.add(pkg);
    for (const d of dependents.get(pkg) ?? []) queue.push(d);
  }
  return [...out].sort();
}

/**
 * The two commits to diff, `{ base, head }`, or `null` when either cannot be
 * determined — which every caller must treat as "run everything".
 *
 * `null` is returned rather than thrown, and rather than defaulting to
 * something plausible like `HEAD~1`, because a *wrong* base is worse than no
 * base: it silently produces a short changed-file list, which reads exactly
 * like a small change and skips real coverage.
 *
 * WHY `head` IS RESOLVED AND NOT JUST `HEAD`. On a `pull_request`,
 * `actions/checkout` checks out the MERGE COMMIT (`refs/pull/N/merge`) by
 * default, not the pull request's own head. Diffing the payload's `base.sha`
 * against that merge commit does not describe the pull request: it describes the
 * pull request PLUS whatever the merge brought in, and those are other people's
 * commits.
 *
 * Measured on #805, whose five files are all inert (`docs/**`,
 * `scripts/agent/**`), so it should have skipped both heavy jobs:
 *
 *   git diff base.sha...MERGE_COMMIT   ->  75 files, 18 of them `ciConfig`
 *   git diff base.sha...head.sha       ->   5 files
 *
 * The 75-file answer contains `.github/workflows/ci.yml` and
 * `harness.config.json` from unrelated merged pull requests, which land in
 * `ciConfig` and force `full: true`. #805 therefore ran the entire suite — the
 * safe direction, and useless: ANY branch that is behind its base inherits its
 * base's recent history as "changed", and in an active repository that is most
 * branches. The filter was quietly doing nothing for them.
 *
 * So both ends come from the event payload, which cannot drift from whatever the
 * checkout happens to be.
 */
/**
 * The base branch tip that GitHub built `refs/pull/N/merge` against, read out of
 * the checkout, or `null` when `HEAD` is not that merge ref.
 *
 * WHY THIS EXISTS. `payload.pull_request.base.sha` is stamped when the pull
 * request is created or synchronised and then left alone — it is NOT the base
 * branch's tip, and it drifts further behind with every merge to `main`. That is
 * survivable while the branch is BEHIND its base, because `merge-base(stale_base,
 * head)` is still the true fork point and three-dot excludes the base's own
 * commits. It stops being survivable the moment the branch goes AHEAD of
 * `base.sha` — a rebase, a force-push, or the "Update branch" button — because
 * then `head` contains those commits, `merge-base(stale_base, head)` collapses to
 * `stale_base`, and the base branch's history is attributed to the pull request
 * again. Measured on a rebase onto two unrelated `main` commits:
 *
 *   stale base.sha ... rebased head  ->  feature.txt, harness.config.json, other.txt
 *   real base tip  ... rebased head  ->  feature.txt
 *
 * That is the pre-merge state of nearly every pull request, so leaving it would
 * keep the filter inert exactly when it matters and re-apply `ci-config-changed`
 * to pull requests that never touched CI config.
 *
 * The merge ref's FIRST parent is the base tip GitHub merged against, which is as
 * fresh as the run itself. `actions/checkout` leaves `HEAD` there by default for
 * `pull_request`, and the `changes` job clones at `fetch-depth: 0`, so both
 * parents' histories are present.
 */
function mergeRefBaseTip(git, headSha, verified) {
  // `[commit, parent1, parent2]` for a merge; shorter for anything else.
  const parents = git(["rev-list", "--parents", "-n", "1", "HEAD"])?.split(/\s+/);
  if (!parents || parents.length !== 3) return null;
  // Only trust it when the SECOND parent is the payload's head. That is the
  // signature of `refs/pull/N/merge`, and it is what makes the first parent the
  // base tip rather than some unrelated merge the branch happens to end on.
  if (parents[2] !== headSha) return null;
  return verified(parents[1]);
}

/**
 * The base branch's tip as a remote-tracking ref, e.g. `origin/main`.
 *
 * The second way to get a fresh base, and the one that does not care what shape
 * the merge ref takes. `mergeRefBaseTip` reads the merge commit's first parent,
 * which is only there if the merge ref actually IS a merge commit — a pull request
 * whose head already contains the base tip is fast-forwardable, and a
 * fast-forwarded ref has one parent and no base to read. Rather than depend on
 * which form GitHub produces, try the branch ref too.
 *
 * Both are fresh, so the order between them does not matter. What matters is that
 * `payload.base.sha` stays LAST: it is the only one of the three that can be
 * stale, and falling back to it over-reports, which merely costs a full run.
 */
function baseBranchTip(git, baseRef, verified) {
  if (!baseRef || !/^[\w./-]+$/.test(baseRef)) return null;
  for (const ref of [`origin/${baseRef}`, `upstream/${baseRef}`, baseRef]) {
    const sha = git(["rev-parse", "--verify", `refs/remotes/${ref}^{commit}`])
      ?? git(["rev-parse", "--verify", `${ref}^{commit}`]);
    if (sha) return verified(sha);
  }
  return null;
}

export function resolveRefs(env = process.env, repoRoot = REPO_ROOT) {
  // `repoScopedEnv`, not the ambient environment: `cwd` does NOT decide which
  // repository git reads. An inherited `GIT_DIR` wins over it, and then every
  // `rev-parse --verify` below answers about that repository instead — so a
  // sha genuinely absent from this checkout can verify, and the diff that
  // follows measures a tree nobody is reviewing. Note this is the READ half of
  // the same hazard the fixtures in scripts/test/changed-areas.test.mjs hit on
  // the write side; `scripts/agent/git-env.mjs` documents both.
  const git = (args) => {
    try {
      return execFileSync("git", args, {
        cwd: repoRoot,
        env: repoScopedEnv(repoRoot),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return null;
    }
  };

  const event = env.GITHUB_EVENT_NAME;
  if (event) {
    let payload = {};
    if (env.GITHUB_EVENT_PATH && existsSync(env.GITHUB_EVENT_PATH)) {
      try {
        payload = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
      } catch {
        return null;
      }
    }
    // A ref that is not present in the checkout is as good as unresolvable: the
    // diff would fail anyway, and failing here says so in one place.
    const verified = (sha) =>
      sha && git(["rev-parse", "--verify", `${sha}^{commit}`]) ? sha : null;

    if (event === "pull_request" || event === "pull_request_target") {
      // `head.sha` and NOT `HEAD`. See the note above: `HEAD` is the merge
      // commit, and diffing it against the base attributes the base branch's own
      // recent history to this pull request.
      const head = verified(payload.pull_request?.head?.sha);
      if (!head) return null;
      // Freshest first, `base.sha` last — it is the only one that can be stale,
      // and three-dot then turns whichever base we get into the fork point.
      const base =
        mergeRefBaseTip(git, head, verified) ??
        baseBranchTip(git, payload.pull_request?.base?.ref, verified) ??
        verified(payload.pull_request?.base?.sha);
      return base ? { base, head } : null;
    }
    if (event === "merge_group") {
      const base = verified(payload.merge_group?.base_sha);
      const head = verified(payload.merge_group?.head_sha);
      return base && head ? { base, head } : null;
    }
    if (event === "push") {
      // All-zeroes is how GitHub reports "no previous commit" for a new branch,
      // and a force-push leaves a `before` that is no longer an ancestor. Both
      // are undiffable, so both are `null`.
      if (!payload.before || /^0+$/.test(payload.before)) return null;
      const base = verified(payload.before);
      const head = verified(payload.after) ?? "HEAD";
      return base ? { base, head } : null;
    }
    return null;
  }

  // Local. `upstream` before `origin` on purpose: in a fork checkout `origin`
  // is the fork and its `main` lags, and merge-basing against a stale main
  // over-reports changed files — the safe direction, but the slower one.
  if (env.WAFFLEBASE_CI_BASE) {
    const base = git(["rev-parse", "--verify", `${env.WAFFLEBASE_CI_BASE}^{commit}`]);
    return base ? { base, head: "HEAD" } : null;
  }
  for (const ref of ["upstream/main", "origin/main", "main"]) {
    if (!git(["rev-parse", "--verify", `${ref}^{commit}`])) continue;
    const base = git(["merge-base", "HEAD", ref]);
    if (base) return { base, head: "HEAD" };
  }
  return null;
}

/**
 * Files changed between `base` and `head`, or `null` on any failure.
 *
 * THREE dots, and the distinction is not cosmetic. `base...head` is
 * `merge-base(base, head)..head`: what `head` added since the two diverged, and
 * nothing the base branch has gained in the meantime. Two-dot `base..head`
 * compares the two trees directly, so every commit the base has and the head
 * lacks reads as a change in the opposite direction. Measured on #805, whose
 * real change is five inert files:
 *
 *   base.sha ... head.sha   ->   5 files,  0 ciConfig   (correct)
 *   base.sha ..  head.sha   ->  15 files,  1 ciConfig   (forces a full run)
 *
 * The bug this replaces was never the dot count, though — it was passing the
 * MERGE COMMIT as `head`. `merge-base(base.sha, merge_commit)` is `base.sha`
 * itself whenever the merge already contains it, so three-dot silently collapsed
 * to two-dot and swept in everything the merge brought along: 75 files, 18 of
 * them `ciConfig`. Both ends now come from the payload, so `head` is the pull
 * request's own commit and the derivation cannot collapse.
 */
export function changedPaths(refs, repoRoot = REPO_ROOT) {
  const { base, head = "HEAD" } = refs ?? {};
  if (!base || !head) return null;
  try {
    // Scoped for the same reason as `resolveRefs`: this diff decides which CI
    // lanes run, and an inherited `GIT_DIR` would silently take it against a
    // different repository — the failure mode being a green run that tested
    // the wrong tree.
    const out = execFileSync("git", ["diff", "--name-only", `${base}...${head}`], {
      cwd: repoRoot,
      env: repoScopedEnv(repoRoot),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split("\n").filter((l) => l.length > 0);
  } catch {
    // A shallow clone is the expected cause: `actions/checkout` defaults to
    // fetch-depth 1, so the base commit is simply absent. The `changes` job
    // sets fetch-depth 0 for exactly this reason; anything else that lands
    // here gets a full run.
    return null;
  }
}

/**
 * Classify a changed-file list.
 *
 * Returns `{ full, heavy, packages, tags, ciConfig, reasons }`:
 *   full      every verify:self lane runs (lane selection is off)
 *   heavy     verify-browser and verify-integration run
 *   packages  reverse-dependency closure of the changed workspace packages
 *   tags      area tags from the matched `inert` entries
 *   ciConfig  a gating-surface file changed; drives the label and the warning
 *   reasons   why, in the order decided — rendered on the PR
 *
 * `full` and `heavy` are separate because the two are trusted differently, and
 * v1 is deliberately asymmetric. Lane selection uses the derived closure, where
 * a wrong answer costs a red main-push run. The two heavy jobs get the blunt
 * rule — ANY package change runs both — because `verify-integration` builds
 * core + docs + slides + sheets and its e2e set includes `docs-cli-roundtrip`,
 * `notes-cli-roundtrip` and `slides-pptx-import`, so a package change with no
 * backend file in it can absolutely break that job. Narrowing the heavy jobs to
 * the closure is a later step taken against observed behaviour, not now.
 */
export function classify(files, ci, graph) {
  const reasons = [];
  const ciConfig = files.some((f) => matchesAny(f, ci.ciConfig));
  if (ciConfig) {
    reasons.push(
      "a CI gating file changed, so this PR is measured by the full suite",
    );
    return {
      full: true,
      heavy: true,
      packages: [],
      tags: [],
      ciConfig: true,
      reasons,
    };
  }

  const tags = new Set();
  const changedPkgs = new Set();
  const unmapped = [];

  for (const file of files) {
    const entry = ci.inert.find((e) => matchesAny(file, e.paths));
    if (entry) {
      for (const t of entry.tags ?? []) tags.add(t);
      continue;
    }
    const pkg = /^packages\/([^/]+)\//.exec(file)?.[1];
    if (pkg && Object.hasOwn(graph, pkg)) {
      changedPkgs.add(pkg);
      continue;
    }
    unmapped.push(file);
  }

  if (unmapped.length > 0) {
    reasons.push(
      `${unmapped.length} changed path(s) are not classified as inert, ` +
        `starting with \`${unmapped[0]}\``,
    );
    return {
      full: true,
      heavy: true,
      packages: [],
      tags: [],
      ciConfig: false,
      reasons,
    };
  }

  const packages = reverseClosure([...changedPkgs], graph);
  if (packages.length > 0) {
    reasons.push(
      `workspace packages changed (${[...changedPkgs].sort().join(", ")}); ` +
        `dependents: ${packages.join(", ")}`,
    );
  }
  if (tags.size > 0) {
    reasons.push(`inert areas changed: ${[...tags].sort().join(", ")}`);
  }
  if (files.length === 0) {
    // An empty diff is not a reason to skip anything. It usually means the base
    // resolved to HEAD itself, which is a resolution bug wearing a small change
    // as a disguise.
    reasons.push("empty diff — treating as a full run");
    return {
      full: true,
      heavy: true,
      packages: [],
      tags: [],
      ciConfig: false,
      reasons,
    };
  }

  return {
    full: false,
    heavy: packages.length > 0,
    packages,
    tags: [...tags].sort(),
    ciConfig: false,
    reasons,
  };
}

const FULL = (reason) => ({
  full: true,
  heavy: true,
  packages: [],
  tags: [],
  ciConfig: false,
  reasons: [reason],
});

/**
 * Is `value` shaped like something `selectLaneNames` and the `ci.yml` gates can
 * safely consume?
 *
 * Checks the three fields whose absence is unsafe rather than merely untidy:
 * `full` decides whether filtering happens at all, and `packages`/`tags` are
 * dereferenced per lane. `heavy`, `ciConfig` and `reasons` are read defensively
 * elsewhere, so a hand-off missing them degrades to "no reasons shown" rather
 * than to a wrong selection.
 */
export function isResolution(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof value.full === "boolean" &&
    Array.isArray(value.packages) &&
    Array.isArray(value.tags)
  );
}

/**
 * The whole decision, from the environment.
 *
 * `WAFFLEBASE_CHANGED_AREAS` short-circuits everything: `ci.yml`'s `changes`
 * job resolves once with a deep checkout and passes the result down, so the
 * `verify-self` job needs neither a deep clone nor git history, and both jobs
 * are guaranteed to have decided from the same list rather than from two
 * independent computations that could disagree.
 */
export function resolve(env = process.env, repoRoot = REPO_ROOT) {
  if (env.WAFFLEBASE_CHANGED_AREAS) {
    let parsed;
    try {
      parsed = JSON.parse(env.WAFFLEBASE_CHANGED_AREAS);
    } catch {
      return FULL("WAFFLEBASE_CHANGED_AREAS was not valid JSON");
    }
    // Valid JSON is not the same as a valid resolution, and the difference is
    // dangerous rather than untidy. `null`, `[]`, `7` and `{"full":false}` all
    // parse. Returned unchecked, the last one gives `packages: undefined`, which
    // `laneSelected` dereferences — and `{"full":false,"packages":[],"tags":[]}`
    // is worse, because it selects ZERO lanes and reports a green run that tested
    // nothing. Same failure the empty-string case is guarded against; only the
    // route in differs, so it gets the same answer.
    if (!isResolution(parsed)) {
      return FULL("WAFFLEBASE_CHANGED_AREAS was not a resolution object");
    }
    return parsed;
  }

  if (env.GITHUB_EVENT_NAME === "push" && env.GITHUB_REF_NAME === "main") {
    return FULL(
      "push to main — this run is the deploy gate and is never filtered",
    );
  }

  let ci;
  let graph;
  try {
    ci = readCiConfig(repoRoot);
    graph = readWorkspaceGraph(repoRoot);
  } catch (error) {
    return FULL(`could not read the CI mapping: ${error.message}`);
  }

  const refs = resolveRefs(env, repoRoot);
  if (!refs) return FULL("no diff base could be resolved");

  const files = changedPaths(refs, repoRoot);
  if (files === null) {
    return FULL(`could not diff ${refs.base.slice(0, 9)}...${refs.head.slice(0, 9)}`);
  }

  return classify(files, ci, graph);
}

/**
 * True when `lane` is selected on its own merits. Prerequisites are NOT
 * considered here — `selectLaneNames` closes over those.
 *
 * `pkgs` names the packages a lane is *about*, not everything it can be broken
 * by: the resolution's `packages` is already a reverse closure, so a lane about
 * `frontend` is selected by a change to `core` without listing `core` here.
 */
export function laneSelected(lane, resolved) {
  if (resolved.full) return true;
  if ((lane.pkgs ?? []).some((p) => resolved.packages.includes(p))) return true;
  if (lane.anyPkg && resolved.packages.length > 0) return true;
  return (lane.tags ?? []).some((t) => resolved.tags.includes(t));
}

/**
 * The set of lane names to run: everything selected on its own merits, plus the
 * transitive closure of their `needs`.
 *
 * The closure is the part that is easy to leave out and expensive to leave out.
 * `frontend:test` resolves `@wafflebase/core` through that package's `exports`
 * to its gitignored `dist/`, so selecting it without `core:build` does not run a
 * smaller suite — it runs a broken one, and the failure looks like a bug in the
 * change under test rather than in the selection.
 */
export function selectLaneNames(lanes, resolved) {
  if (resolved.full) return new Set(lanes.map((l) => l.name));

  const byName = new Map(lanes.map((l) => [l.name, l]));
  const selected = new Set();
  const add = (name) => {
    if (selected.has(name)) return;
    selected.add(name);
    for (const need of byName.get(name)?.needs ?? []) add(need);
  };
  for (const lane of lanes) {
    if (laneSelected(lane, resolved)) add(lane.name);
  }
  return selected;
}

/**
 * Every `needs` edge that points at an unknown lane, or at one declared LATER in
 * the array.
 *
 * The runner executes `lanes` in array order, so a forward edge is a lane whose
 * prerequisite has not been built yet. Nothing about the selection logic catches
 * that — the closure would happily select both and then run them in the wrong
 * order — so it is asserted instead, and asserted over the real array by
 * `scripts/test/verify-self-lanes.test.mjs`.
 */
export function laneOrderViolations(lanes) {
  const seen = new Set();
  const bad = [];
  for (const lane of lanes) {
    for (const need of lane.needs ?? []) {
      if (!lanes.some((l) => l.name === need)) {
        bad.push(`${lane.name} needs unknown lane ${need}`);
      } else if (!seen.has(need)) {
        bad.push(`${lane.name} needs ${need}, which is declared later`);
      }
    }
    seen.add(lane.name);
  }
  return bad;
}

// --- CLI: write the resolution to GITHUB_OUTPUT (and stdout for humans) ---

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const resolved = resolve();
  const lines = [
    `full=${resolved.full}`,
    `heavy=${resolved.heavy}`,
    `ci_config=${resolved.ciConfig}`,
    // The blob the verify-self job reads back as WAFFLEBASE_CHANGED_AREAS. One
    // resolution per run, so no two jobs can disagree about what changed.
    `areas=${JSON.stringify(resolved)}`,
  ];
  if (process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.GITHUB_OUTPUT, lines.join("\n") + "\n");
  }
  console.log(`full=${resolved.full}  heavy=${resolved.heavy}  ciConfig=${resolved.ciConfig}`);
  if (resolved.packages.length > 0) console.log(`packages: ${resolved.packages.join(", ")}`);
  if (resolved.tags.length > 0) console.log(`tags: ${resolved.tags.join(", ")}`);
  for (const r of resolved.reasons) console.log(`- ${r}`);
}
