// Invariants of THIS repository's `.github/workflows/agent-*.yml`.
//
// WHY THIS FILE EXISTS, still. These guards were split out of
// `scripts/agent/checks.test.mjs` when the pipeline mirror was deleted, because a
// test about wafflebase's own workflows should not live in a directory that had
// stopped being wafflebase's. The pipeline is back, so that argument has expired —
// but the guards stay here anyway: `scripts/test/` is where this repository's own
// suites live, and `checks.test.mjs` is worth keeping as a restorable file rather
// than a merge of two histories.
//
// Each assertion corresponds to a failure that actually happened:
//
//   * GH_REPO absent  -> the whole autonomous loop died repo-wide for a day. `gh`
//     expands `{owner}/{repo}` by shelling out to git, and every step running
//     before the repo is checked out failed with "not a git repository". Fixed in
//     #790; nothing stopped it recurring, so this does.
//
//   * pipeline code read from the WORKSPACE after the PR's own branch was checked
//     out -> the PR author supplies the code, and the job is holding a token with
//     write access. This existed here for months before the extraction found it,
//     and restoring the pre-split workflows brought all eight sites back at once:
//     six in `agent-iterate-ci.yml`, two in `agent-review-panel.yml`'s `fix` job.
//     The fix is to read from `$RUNNER_TEMP/agent-tools/`, staged from trusted main
//     and outside the workspace, which `actions/checkout` therefore cannot wipe.
//
// The sha-pin and adapter-ordering guards that used to sit here were deleted with
// the revert: both keyed on `wafflebase/agent-pipeline` checkouts and adapter
// steps, of which there are now none, so they asserted nothing.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WORKFLOWS = path.join(REPO, ".github", "workflows");

const agentWorkflows = readdirSync(WORKFLOWS)
  .filter((f) => f.startsWith("agent-") && f.endsWith(".yml"))
  .sort();

test("there are agent workflows to check, so a rename cannot vacuously pass", () => {
  // Without this the whole file no-ops the moment the glob stops matching.
  assert.ok(agentWorkflows.length >= 9, `found only ${agentWorkflows.length} agent-*.yml`);
});

test("every agent workflow sets GH_REPO at WORKFLOW level", () => {
  // Workflow level, not job level: the outage reached jobs nobody had thought about,
  // and a per-job block only covers the jobs someone remembered. `gh` needs it in
  // every step that runs before the repo is checked out — present and future.
  for (const f of agentWorkflows) {
    const lines = readFileSync(path.join(WORKFLOWS, f), "utf8").split("\n");
    const start = lines.findIndex((l) => l === "env:");
    assert.notEqual(start, -1, `${f} has no workflow-level env: block`);
    let found = false;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^[^\s#]/.test(lines[i])) break; // dedented to a new top-level key
      if (/^\s+GH_REPO:\s*\$\{\{\s*github\.repository\s*\}\}/.test(lines[i])) { found = true; break; }
    }
    assert.ok(found, `${f} does not set GH_REPO: \${{ github.repository }} at workflow level`);
  }
});

/** Steps of one job, as [start, end) line bounds. Splits on the `- ` entries that
 *  sit at the step-list indent, so a nested `- ` inside a `with:` block or a
 *  script body cannot be mistaken for a new step. */
function stepBounds(lines, from, to) {
  const stepsAt = lines.findIndex((l, i) => i >= from && i < to && /^\s*steps:\s*$/.test(l));
  if (stepsAt === -1) return [];
  const firstAt = lines.slice(stepsAt + 1, to).findIndex((l) => /^\s*- /.test(l));
  if (firstAt === -1) return [];
  const indent = lines[stepsAt + 1 + firstAt].match(/^(\s*)- /)[1].length;
  const starts = [];
  for (let i = stepsAt + 1; i < to; i++) {
    const m = lines[i].match(/^(\s*)- /);
    if (m && m[1].length === indent) starts.push(i);
  }
  return starts.map((s, k) => [s, starts[k + 1] ?? to]);
}

test("no step runs pipeline code from the workspace after untrusted code is checked out into it", () => {
  // ORDER, NOT EXISTENCE. The version of this check that shipped with the extraction
  // asked "is this file absent from `scripts/agent/`?" — true only while the pipeline
  // lived in another repository. With the pipeline back, every file is present, so
  // every invocation was skipped and the check inspected 0 of them while reporting
  // success. Keying on order instead makes it independent of where the code lives.
  //
  // TRUST IS AN ALLOW-LIST, NOT A DENY-LIST, and that is the second lesson from the
  // same failure. The first order-based version armed on an enumeration of UNTRUSTED
  // `ref:` spellings — `github.event.*.head_*`, `steps.*.outputs.(branch|sha)` — and
  // two refs already in this directory were outside it: `agent-review-on-demand.yml`
  // checks out `needs.authorize.outputs.head_sha`, and `agent-review-reply.yml` checks
  // out `steps.pr.outputs.ref`. Neither armed the check, so a workspace read added to
  // either job would have passed silently. An enumeration of the untrusted cases can
  // only ever be as complete as its author's memory; the trusted cases are few, so
  // those are what gets enumerated here.
  //
  // A checkout is TRUSTED iff its `ref:` is absent (the default branch, which is what
  // `workflow_run` and `issue_comment` runs resolve to) or the literal `main`. Adding
  // another trusted spelling means adding it HERE, deliberately, next to this comment.
  //
  // Scoped per job, because that is the boundary a checkout acts on. Only a checkout
  // WITHOUT `path:` counts: it replaces and git-cleans the workspace root, so it both
  // arms (untrusted ref) and disarms (trusted ref) the state. A `path:`-scoped
  // checkout writes a subdirectory and leaves the root's `scripts/agent` alone, which
  // is why `.trusted/scripts/agent/…` reads are correct and are not matched below.
  // `$RUNNER_TEMP/agent-tools/` reads are not matched either — the whole point is that
  // they are outside the workspace and survive the clean.
  const TRUSTED_REF = /^main$/;
  const REF = /^\s*ref:\s*([^\s#]+)/m;
  const HAS_PATH = /^\s*path:\s*[^\s#]/m;
  const IS_CHECKOUT = /uses:\s*actions\/checkout@/;
  // `gh pr checkout` populates the workspace root with the PR's code just as surely
  // as `actions/checkout` does, and exposes no `with:` block for the trust test to
  // read — so it can only ever arm, never disarm.
  const GH_PR_CHECKOUT = /\bgh\s+pr\s+checkout\b/;
  const WORKSPACE_RUN = /\bnode\s+["']?\.?\/?scripts\/agent\/([\w.-]+\.mjs)/;

  const problems = [];
  let inspected = 0;
  let untrustedCheckouts = 0;
  for (const f of agentWorkflows) {
    const lines = readFileSync(path.join(WORKFLOWS, f), "utf8").split("\n");
    const jobsAt = lines.findIndex((l) => l === "jobs:");
    if (jobsAt === -1) continue;
    const starts = lines.reduce((acc, l, i) => (i > jobsAt && /^ {2}[\w-]+:\s*$/.test(l) ? [...acc, i] : acc), []);
    for (let k = 0; k < starts.length; k++) {
      const [from, to] = [starts[k], starts[k + 1] ?? lines.length];
      const job = lines[from].trim().replace(/:$/, "");
      let untrustedAt = null;
      for (const [start, end] of stepBounds(lines, from, to)) {
        // A commented-out checkout must not arm the check, and a commented-out
        // invocation must not trip it.
        const body = lines
          .slice(start, end)
          .filter((l) => !l.trim().startsWith("#"))
          .join("\n");
        const checkout = IS_CHECKOUT.test(body);
        if ((checkout || GH_PR_CHECKOUT.test(body)) && !HAS_PATH.test(body)) {
          // No `ref:` at all means the default branch, which is what a
          // `workflow_run` / `issue_comment` run resolves to — trusted.
          const refMatch = REF.exec(body);
          const ref = refMatch ? refMatch[1] : "main";
          if (checkout && TRUSTED_REF.test(ref)) untrustedAt = null;
          else {
            untrustedAt = start + 1;
            untrustedCheckouts++;
          }
        }
        for (const [offset, line] of body.split("\n").entries()) {
          const run = WORKSPACE_RUN.exec(line);
          if (!run) continue;
          inspected++;
          if (untrustedAt !== null) {
            problems.push(
              `${f}:~${start + 1 + offset} (job ${job}) runs ${run[1]} from the workspace, ` +
                `after untrusted code was checked out over it at line ${untrustedAt}`,
            );
          }
        }
      }
    }
  }

  // The counterpart to the anti-vacuity test above, in BOTH directions: this check is
  // green if it looked at no invocations, and equally green if it recognised no
  // untrusted checkout to order them against. The second is the exact way both
  // previous versions of this guard died, so it is asserted rather than assumed.
  assert.ok(inspected > 0, "found no `node scripts/agent/*.mjs` invocations to inspect");
  assert.ok(
    untrustedCheckouts > 0,
    "found no untrusted workspace checkout to order invocations against — the trust " +
      "predicate above has stopped recognising the PR-branch checkouts, so this guard " +
      "is now vacuous",
  );
  assert.deepEqual(
    problems,
    [],
    `these run author-controlled code while holding a write-scoped token. Stage the ` +
      `pipeline to $RUNNER_TEMP/agent-tools before the branch checkout and read it ` +
      `from there:\n${problems.join("\n")}`,
  );
});
