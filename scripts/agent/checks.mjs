// Pure check-run gate logic, shared by mark-ready.mjs and its tests.
// A required check "passes" iff its LATEST run on the SHA concluded success;
// a required check that never ran counts as NOT passed (fail closed).

/**
 * Review checks the ready gate requires when the caller passes no
 * `--require-checks` — i.e. the local preview `spec-to-pr.mjs` suggests. The
 * promotion path in agent-review-panel.yml always passes the manifest-derived
 * `blocking && applicable` set, so this list cannot let a real promotion through.
 *
 * It holds only the blocking lenses that apply to EVERY diff (`appliesWhen` of
 * `**`). This caller has no panel output, so it cannot know which lenses were
 * applicable, and `checkPassed` counts a `neutral` (skipped) check as NOT
 * passed — so a path-scoped lens listed here makes the gate unsatisfiable for
 * every PR that legitimately skips it (test-adequacy on a docs-only PR, docs on
 * a code-only PR). Requiring the always-on lenses keeps the fallback meaningful
 * while staying satisfiable on ordinary code PRs (mark-ready still fails closed
 * on an empty set).
 *
 * KNOWN GAP, pre-dating file-class routing and not fixed here: "always
 * applicable" is not the same as "always has something to review". A lens can
 * apply and still be skipped when nothing in its `scopeClasses` changed, so a
 * prose-only PR skips correctness and this default gate cannot be satisfied.
 * The same hole existed before routing (test-adequacy on a docs-only PR). The
 * real promotion path is unaffected — agent-review-panel.yml always passes the
 * manifest-derived `blocking && applicable` set. Fixing it properly means
 * teaching this path that a neutral required check is a skip rather than a
 * failure, which is a change to the gate's semantics, not to this list.
 *
 * It lives here rather than in `mark-ready.mjs` for one reason: mark-ready is a
 * CLI with top-level `process.exit`, so a test cannot import it, and this is the
 * ONE lens list that does not derive itself from `lenses/lenses.json`. Drift is
 * silent, so `checks.test.mjs` asserts it against the real manifest.
 */
export const DEFAULT_REVIEW_CHECKS = [
  "agent-review-correctness",
  "agent-review-security",
];

/**
 * The CI workflow's identity, as the Actions API reports it on a run.
 *
 * A run's `name` is only the workflow file's `name:` key, and NOTHING makes it
 * unique — a second file saying `name: CI` produces runs indistinguishable from
 * the real ones. That matters because `mark-ready.mjs` calls gate 1
 * "unforgeable": anyone able to push a branch to the base repo could otherwise
 * add `.github/workflows/anything.yml` with `name: CI` on `push`, get a green
 * run recorded against their own head SHA, and satisfy the one gate that is
 * supposed to mean "the tests passed". (The agent App cannot push workflow
 * files — that is the boundary agent-review-panel.yml's `workflow_run` trigger
 * rests on — but an `agent:managed` human PR is on the same promote path and
 * is not restricted.)
 *
 * `path` cannot be spoofed the same way: only one file can occupy it, so a
 * run's path names the file that produced it. Keep this in step with the
 * filename on disk — `checks.test.mjs` asserts the file exists.
 */
export const CI_WORKFLOW_PATH = ".github/workflows/ci.yml";

/** Every run of the CI workflow for a SHA. Called workflows report `path` with an `@ref` suffix. */
export function ciRunsFor(workflowRuns) {
  return (workflowRuns || []).filter((r) => String(r?.path ?? "").split("@")[0] === CI_WORKFLOW_PATH);
}

/**
 * CI's verdict for a SHA: `"success"`, `"failure"`, or `null` for "not known
 * yet" — no run, or the newest one still in flight.
 *
 * THE NEWEST RUN WINS, and `ci.yml`'s triggers are what make that safe: `push`
 * is restricted to `main`, and a `merge_group` run carries the speculative
 * merge commit rather than the PR head, so a PR head SHA gets exactly one CI
 * run (from `pull_request`) and a re-run mutates that same run in place rather
 * than adding a second. `ciTriggersKeepOneRunPerHeadSha` in `checks.test.mjs`
 * pins that, so adding a trigger that fires on a PR head fails loudly here
 * instead of quietly turning this into a rule that reads one of several runs.
 *
 * An earlier revision required EVERY run to be green, on the theory that
 * newest-wins would fail open if a SHA ever carried two runs. It closed nothing
 * reachable — the invariant above already held — and cost three real defects:
 * `@claude rerun` could no longer clear the gate (it re-ran one run), then
 * re-running all of them eroded agent-iterate-ci's append-only attempt bound
 * (a re-run REPLACES a run's `failure` conclusion) and fanned out into
 * `workflow_run` completions that cancelled the fixer mid-push. Fail-closed on
 * a hole that is not open is not free.
 *
 * Ordered by `id`, not `created_at`: ids are assigned in creation order, are
 * always present, and are integers — `new Date("nonsense")` is NaN, and a NaN
 * comparator does not order at all.
 */
export function ciConclusion(workflowRuns) {
  const run = newestRun(ciRunsFor(workflowRuns));
  if (!run || run.conclusion == null) return null;
  return run.conclusion === "success" ? "success" : "failure";
}

/** Newest by run id (creation order), or null. */
function newestRun(runs) {
  if (!runs.length) return null;
  return runs.reduce((newest, r) => ((r.id ?? 0) > (newest.id ?? 0) ? r : newest));
}

/**
 * The run `@claude rerun` / `@claude loop` must re-run for a head SHA, or null.
 *
 * Exactly one — the newest COMPLETED run — for the reason `ciConclusion` reads
 * only the newest: that is the run whose conclusion gate 1 will read, and a
 * re-run bumps its `run_attempt`, which is the only thing agent-review-panel's
 * gate admits a `completed` event for. Re-running more would erode
 * agent-iterate-ci's attempt bound (which counts current `failure` conclusions,
 * and a re-run replaces one) and emit a completion per run into a
 * `cancel-in-progress` group, cancelling the fixer mid-push.
 *
 * COMPLETED because the API answers 422 for a run still in flight — and an
 * in-flight run emits its own completion event, so there is nothing to trigger.
 *
 * `workflowRuns` is expected to be already scoped to the CI workflow file by
 * the caller's `workflow_id: 'ci.yml'`, so this does not re-filter by path.
 *
 * MIRRORED INLINE at both call sites, because neither can import this file:
 * they are github-script steps in `.github/workflows/agent-rerun.yml` and
 * `.github/workflows/agent-loop.yml` that run before any checkout — the same
 * constraint that makes `agent-review-panel.yml` mirror `ciRunDecision` inline.
 * `checks.test.mjs` pins the copies against each other. Editing this function
 * means editing both mirrors, which only a maintainer can push.
 */
export function ciRunToRerun(workflowRuns) {
  return newestRun((workflowRuns || []).filter((r) => r?.status === "completed"));
}

/** Latest run of `name` concluded success? Missing → false. */
export function checkPassed(checkRuns, name) {
  const runs = (checkRuns || []).filter((r) => r.name === name);
  if (runs.length === 0) return false;
  runs.sort((a, b) => new Date(b.started_at ?? 0) - new Date(a.started_at ?? 0));
  return runs[0].conclusion === "success";
}

/** { allPassed, perCheck } for a list of required check names. */
export function allRequiredPassed(checkRuns, requiredNames) {
  const perCheck = Object.fromEntries(requiredNames.map((n) => [n, checkPassed(checkRuns, n)]));
  return { allPassed: requiredNames.every((n) => perCheck[n]), perCheck };
}

/**
 * What should the panel's PUSHING jobs do with the CI run this round rode in on?
 *
 * The panel is triggered by `workflow_run: requested`, so it starts WHEN CI
 * starts rather than after it — that is where the ~13.5 min per round comes
 * from. The CI conclusion is still load-bearing, and it is read here instead.
 *
 * WHAT THIS PRESERVES. Two agent arms watch the same CI run and split on its
 * outcome: `agent-iterate-ci.yml` fires on `failure` and pushes a CI fix, the
 * review `fix` job runs on `success` and pushes a review fix. BOTH push to the
 * same branch, so the conclusion is a MUTEX, not merely a quality gate. Moving
 * the panel to `requested` does not weaken it — the discriminator is the same
 * one, on the same run, read later. For any given CI run exactly one arm still
 * proceeds, which is why no extra `concurrency` group is needed to make that
 * true.
 *
 * `wait` is not `proceed` and must never be treated as one. It means the run is
 * still going, and the caller polls. Everything else — a missing run, a junk
 * payload, a `cancelled`/`timed_out`/`neutral` conclusion — is `skip`: the
 * pushing jobs do not run, which leaves the PR exactly where the old
 * `conclusion == 'success'` trigger would have left it (untouched), and lets
 * `agent-iterate-ci` own the red-CI case as it already does.
 *
 * A `skip` is deliberately NOT a page. CI red is a state the pipeline has a
 * handler for; paging on it would fire on every ordinary CI failure. Only the
 * caller's own timeout — "we never found out" — pages, because that is the
 * state nothing else is watching.
 */
export function ciRunDecision(run) {
  // `Array.isArray` explicitly: `typeof [] === "object"`, so a list-shaped
  // response would otherwise read as a run with no `status` and be polled until
  // the deadline. Nothing that is not an object can BECOME one, so re-asking is
  // pointless — that is the line between this and the `{}` case below.
  if (!run || typeof run !== "object" || Array.isArray(run)) return "skip";
  // An object that is merely missing fields gets another poll: a partial or
  // rate-limited response is transient, and the caller's own deadline bounds
  // how long "no status yet" can go on before it pages.
  if (run.status !== "completed") return "wait";
  return run.conclusion === "success" ? "proceed" : "skip";
}
