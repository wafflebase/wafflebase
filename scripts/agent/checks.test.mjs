import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkPassed, allRequiredPassed, ciRunDecision, ciConclusion, ciRunsFor, ciRunsToRerun, CI_WORKFLOW_PATH, DEFAULT_REVIEW_CHECKS } from "./checks.mjs";

// `DEFAULT_REVIEW_CHECKS` is the ONE lens list in the repo that does not derive
// itself from lenses.json, so it is the one that silently rots when a lens is
// added. Assert it against the REAL manifest — this test is the reason the
// constant lives in checks.mjs at all (mark-ready.mjs is a CLI with top-level
// process.exit and cannot be imported).
test("DEFAULT_REVIEW_CHECKS covers every ALWAYS-APPLICABLE blocking lens", () => {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const lenses = JSON.parse(readFileSync(path.join(HERE, "lenses", "lenses.json"), "utf8"));
  const isBlocking = (l) => String(l.gating ?? "blocking") === "blocking";
  const alwaysOn = (l) => {
    const g = l.appliesWhen ?? ["**"];
    return g.length === 0 || g.includes("**");
  };
  // This used to require EVERY blocking lens, which made the default gate
  // unsatisfiable for any PR that legitimately skipped a path-scoped one: a
  // skipped lens posts `neutral`, and checkPassed only accepts `success`. So a
  // docs-only PR could never satisfy agent-review-test-adequacy, and once a
  // `docs` lens existed, a code-only PR could never satisfy agent-review-docs
  // either. Only the always-on lenses belong here.
  assert.deepEqual(
    [...DEFAULT_REVIEW_CHECKS].sort(),
    lenses.filter((l) => isBlocking(l) && alwaysOn(l)).map((l) => `agent-review-${l.id}`).sort(),
    "DEFAULT_REVIEW_CHECKS must list exactly the blocking lenses whose appliesWhen is '**'",
  );
  // A path-scoped lens here would reintroduce the unsatisfiable-gate bug.
  for (const l of lenses.filter((x) => isBlocking(x) && !alwaysOn(x))) {
    assert.ok(
      !DEFAULT_REVIEW_CHECKS.includes(`agent-review-${l.id}`),
      `path-scoped lens ${l.id} must not be a default required check — it is neutral whenever it does not apply`,
    );
  }
  assert.ok(DEFAULT_REVIEW_CHECKS.length > 0, "mark-ready fails closed on an empty required set");
  // Advisory lenses must NOT be required — the ready gate would wait forever on
  // a check that is posted as `neutral` and never `success`.
  for (const l of lenses.filter((x) => String(x.gating ?? "blocking") !== "blocking")) {
    assert.ok(
      !DEFAULT_REVIEW_CHECKS.includes(`agent-review-${l.id}`),
      `advisory lens ${l.id} must not be a required default check`,
    );
  }
});

const succ = (name, t = "2026-07-21T10:00:00Z") => ({ name, conclusion: "success", started_at: t });
const fail = (name, t = "2026-07-21T10:00:00Z") => ({ name, conclusion: "failure", started_at: t });

test("checkPassed: missing check → false; latest run wins", () => {
  assert.equal(checkPassed([], "a"), false);
  assert.equal(checkPassed([succ("a")], "a"), true);
  assert.equal(checkPassed([fail("a")], "a"), false);
  // fail then success (newer) → passed
  assert.equal(checkPassed([fail("a", "2026-07-21T10:00:00Z"), succ("a", "2026-07-21T11:00:00Z")], "a"), true);
  // success then fail (newer) → not passed
  assert.equal(checkPassed([succ("a", "2026-07-21T10:00:00Z"), fail("a", "2026-07-21T11:00:00Z")], "a"), false);
});

test("allRequiredPassed: all present+success → pass; any failing or MISSING → block", () => {
  const req = ["x", "y", "z"];
  assert.equal(allRequiredPassed([succ("x"), succ("y"), succ("z")], req).allPassed, true);
  assert.equal(allRequiredPassed([succ("x"), fail("y"), succ("z")], req).allPassed, false);
  // partial set: 'z' never posted → block
  const partial = allRequiredPassed([succ("x"), succ("y")], req);
  assert.equal(partial.allPassed, false);
  assert.equal(partial.perCheck.z, false);
});

test("allRequiredPassed: an EMPTY required set is vacuously true", () => {
  // `[].every` is true, so a required set of [] "passes" with ZERO evidence.
  // This is the fail-open mark-ready.mjs guards against: it refuses to promote
  // on an empty required-check set unless --allow-no-checks is passed.
  assert.equal(allRequiredPassed([], []).allPassed, true);
  assert.equal(allRequiredPassed([fail("x")], []).allPassed, true);
});

// --- the CI conclusion, read late instead of at trigger time ---------------

test("ciRunDecision: proceed only on a COMPLETED success", () => {
  assert.equal(ciRunDecision({ status: "completed", conclusion: "success" }), "proceed");
  // Still running, in every spelling GitHub uses. `wait` is not `proceed`: a
  // caller that treated it as one would push a review fix while CI is mid-flight
  // and the CI arm might still claim this branch.
  for (const status of ["queued", "in_progress", "requested", "waiting", "pending"]) {
    assert.equal(ciRunDecision({ status, conclusion: null }), "wait", status);
  }
  // A conclusion that arrives before `completed` does not shortcut the wait —
  // status is the authority on whether the run is over.
  assert.equal(ciRunDecision({ status: "in_progress", conclusion: "success" }), "wait");
});

test("ciRunDecision: everything that is not a success is a skip, not a page", () => {
  // The pushing jobs stay out of it, which leaves the PR exactly where the old
  // `conclusion == 'success'` trigger left it. `failure` in particular is NOT a
  // stall — agent-iterate-ci.yml fires on precisely that and owns the branch.
  for (const conclusion of ["failure", "cancelled", "timed_out", "neutral", "action_required", "stale", "skipped", null, undefined, ""]) {
    assert.equal(ciRunDecision({ status: "completed", conclusion }), "skip", String(conclusion));
  }
  // Junk fails CLOSED. This value comes from an API response the workflow does
  // not control, and the expensive, irreversible thing downstream is a push.
  for (const junk of [null, undefined, "completed", 7, [], true]) {
    assert.equal(ciRunDecision(junk), "skip", JSON.stringify(junk) ?? "undefined");
  }
  // An object with nothing on it is not "still running" — no status means no
  // evidence, and no evidence must not become an indefinite poll.
  assert.equal(ciRunDecision({}), "wait");
});

test("ciRunDecision: the three outcomes are exhaustive and disjoint", () => {
  // The YAML mirrors this rule inline (github-script steps cannot import local
  // modules — no checkout in that job), so the contract has to be pinned
  // somewhere runnable. A fourth return value would silently mean "not
  // proceed, not wait" to a caller written against three.
  const seen = new Set();
  for (const status of ["completed", "in_progress", "queued", undefined]) {
    for (const conclusion of ["success", "failure", null, undefined]) {
      seen.add(ciRunDecision({ status, conclusion }));
    }
  }
  seen.add(ciRunDecision(null));
  assert.deepEqual([...seen].sort(), ["proceed", "skip", "wait"]);
});

test("the panel starts with CI, admits re-runs, and mirrors ciRunDecision", () => {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const yml = readFileSync(path.join(HERE, "..", "..", ".github", "workflows", "agent-review-panel.yml"), "utf8");
  // Code lines only. The comments around this change quote both the old
  // `types: [completed]` trigger and the `conclusion == 'success'` clause it
  // replaced, to say what moved where — and a whole-file grep would read that
  // explanation as the thing it warns about. Same trap as #630 and #640.
  const code = yml.split("\n").filter((l) => !/^\s*(#|\/\/)/.test(l)).join("\n");

  // `requested` keeps the panel starting when CI STARTS — the latency property.
  assert.match(code, /types: \[requested/, "the panel must start when CI starts");
  // `completed` is subscribed too, and this used to be forbidden here on the
  // grounds that both events fire for every run and the panel costs ~$12. That
  // reasoning held for a FRESH run and missed re-runs entirely: `requested` fires
  // when a run is CREATED, so a re-run emits only `completed` — and `@claude
  // rerun`'s whole mechanism is `reRunWorkflow` on the PR's CI run. With
  // `requested` alone it re-ran CI and re-engaged nothing, twice, on #632 and #648,
  // while reporting that the panel would run again.
  assert.match(code, /types: \[requested, completed\]/, "re-runs emit only `completed`");
  // What actually prevents the doubling is the gate, not the subscription: a fresh
  // run's `completed` carries run_attempt 1 and is refused, so exactly one panel
  // starts per CI run either way.
  assert.match(
    code,
    /github\.event\.action == 'requested' \|\|\s*\n?\s*github\.event\.workflow_run\.run_attempt > 1/,
    "the gate must admit `completed` only for re-runs, or every round doubles",
  );

  // THE CONCURRENCY GROUP MUST AGREE WITH THE GATE, and they are written
  // separately — a suffix expression and a job `if:` — so this evaluates both.
  //
  // Why it matters more than tidiness: `concurrency` is claimed at RUN CREATION,
  // before any `if:` runs. With one undifferentiated group, a fresh CI run's
  // `completed` event creates a second run that cancels the panel the `requested`
  // event started ~13 minutes earlier, mid-review — then refuses the event itself
  // and skips every job. No verdicts, and `stalled` is `!cancelled()` so no page.
  // The review control would stop working, silently, on every PR.
  //
  // So refused runs must land in a DIFFERENT group from working ones, and "refused"
  // has to mean the same thing in both places.
  {
    const gateIf = (yml.match(/^ {2}gate:\n(?:.*\n)*? {4}if: >-\n((?: {6}.*\n)+)/m) || [])[1];
    assert.ok(gateIf, "could not extract the gate's if: expression");
    // `.+` not `\S+`: the group is one folded line containing spaces inside `${{ }}`.
    const group = (yml.match(/group: >-\n\s*(.+)/) || [])[1];
    assert.ok(group, "could not extract the concurrency group");

    const toJs = (s) =>
      s.replace(/github\.event\.workflow_run\.run_attempt/g, "ATTEMPT")
       .replace(/github\.event\.action/g, "ACTION")
       .replace(/github\.event\.workflow_run\.head_repository\.full_name/g, "'r'")
       .replace(/github\.repository/g, "'r'")
       .replace(/github\.event\.workflow_run\.head_branch/g, "'b'")
       .replace(/github\.event\.workflow_run\.path/g, "PATH")
       .replace(/vars\.AGENT_PIPELINE_ENABLED/g, "'true'");
    const admits = new Function("ACTION", "ATTEMPT", "PATH", `return (${toJs(gateIf)});`);
    const suffix = (group.match(/\$\{\{ ([^}]*'noop'[^}]*) \}\}\s*$/) || [])[1];
    assert.ok(suffix, "the group must carry a noop/active partition suffix");
    const partition = new Function("ACTION", "ATTEMPT", "PATH", `return (${toJs(suffix)});`);

    // A run produced by a DIFFERENT file that merely calls itself "CI" is in the
    // matrix too: the trigger's `workflows:` filter matches display names, so
    // such a run reaches this workflow and — because `concurrency` is claimed at
    // run creation, before any `if:` — could otherwise take the `active` group
    // and cancel a legitimate panel mid-review while its own gate refuses it.
    const paths = [CI_WORKFLOW_PATH, ".github/workflows/pwn.yml"];
    for (const wfPath of paths) {
      for (const [action, attempt] of [["requested", 1], ["requested", 2], ["completed", 1], ["completed", 2]]) {
        const works = Boolean(admits(action, attempt, wfPath));
        const lane = partition(action, attempt, wfPath);
        assert.equal(
          lane,
          works ? "active" : "noop",
          `${wfPath} ${action}/attempt ${attempt}: gate ${works ? "admits" : "refuses"} but the group says ${lane}`,
        );
      }
    }
    // ...and the path clause must actually be doing something in both places.
    assert.ok(
      !admits("requested", 1, ".github/workflows/pwn.yml"),
      "the gate must refuse a run from any file other than the CI workflow",
    );
    assert.equal(
      partition("requested", 1, ".github/workflows/pwn.yml"),
      "noop",
      "a forged run must not share the concurrency group that real panels cancel each other in",
    );
    // And prove the partition is not degenerate — a group that always says "active"
    // would pass a same-answer check while restoring the cancellation bug.
    assert.equal(partition("requested", 1, CI_WORKFLOW_PATH), "active");
    assert.equal(partition("completed", 1, CI_WORKFLOW_PATH), "noop");
  }

  // The inline copy of the rule. A `github-script` step has no checkout and
  // cannot import checks.mjs, so this logic necessarily exists twice; pinning
  // the copy is what keeps it ONE rule rather than two that drift.
  assert.match(code, /if \(!run \|\| typeof run !== 'object' \|\| Array\.isArray\(run\)\) return 'skip';/);
  assert.match(code, /if \(run\.status !== 'completed'\) return 'wait';/);
  assert.match(code, /return run\.conclusion === 'success' \? 'proceed' : 'skip';/);

  // Both PUSHING jobs consume it. This is the mutex the old trigger enforced:
  // agent-iterate-ci.yml owns a red CI, these two own a green one, and exactly
  // one of them proceeds per CI run. A job that pushed without this clause could
  // commit to a branch the CI-fix arm is also committing to.
  const gated = code.match(/needs\.ci\.outputs\.conclusion == 'success'/g) || [];
  assert.equal(gated.length, 2, "promote and fix must each require a green CI");
  for (const job of ["promote", "fix"]) {
    assert.match(code, new RegExp(`${job}:\\n(.|\\n)*?needs: \\[review-panel, ci\\]`),
      `${job} must depend on the ci job`);
  }
});

// --- "@claude fix": routing, gate order, and reporting ----------------------

// Workflow text with FULL-LINE `#` comments stripped. These assertions are about
// what the workflow DOES, and every one of them first failed against a header
// comment that merely described the opposite workflow's gate — the same
// false-positive shape as matching prose for code.
const WF = (name) =>
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".github", "workflows", name), "utf8")
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");

test("the `fix` verb reaches exactly one workflow: issues -> implement, PRs -> fix", () => {
  // Both are `issue_comment` workflows keyed on the SAME verb, so the surface
  // predicates must partition rather than merely differ. If either drifted, an
  // "@claude fix" on an issue would also start the on-demand fixer (which would
  // then refuse for having no PR) or, worse, both would run on a PR.
  const implement = WF("agent-implement.yml");
  const fix = WF("agent-fix.yml");
  assert.match(implement, /!github\.event\.issue\.pull_request/, "implement must be ISSUE-only");
  assert.ok(
    /\n\s+github\.event\.issue\.pull_request &&/.test(fix),
    "agent-fix must be PR-only (an unnegated issue.pull_request guard)",
  );
  assert.equal(/!github\.event\.issue\.pull_request/.test(fix), false, "agent-fix must not also claim issues");
  for (const [name, wf] of [["implement", implement], ["fix", fix]]) {
    assert.match(wf, /command\.mjs "\$BODY"/, `${name} must route through the shared command parser`);
    assert.match(wf, /AGENT_PIPELINE_ENABLED == 'true'/, `${name} must honour the pipeline kill switch`);
  }
});

test("every workflow that runs a pipeline script sets GH_REPO", () => {
  // REGRESSION GUARD for an outage this suite did not catch.
  //
  // `gh` expands `{owner}/{repo}` by shelling out to git, so it needs a git
  // remote in the working directory. When the pipeline moved to its own repo,
  // the trusted checkout began landing in a scratch path that is deleted after
  // the move — which removed the only .git in the workspace. Every step running
  // before the PR-branch checkout then failed with:
  //
  //   unable to expand placeholder in path: failed to run git:
  //   fatal: not a git repository (or any of the parent directories): .git
  //
  // That killed the fix job, and would have killed promote too (mark-ready.mjs
  // uses the same placeholder). It was invisible here because the scripts are
  // fine — the missing thing was the ENVIRONMENT they run in, which no unit test
  // observes. Hence a workflow-level assertion.
  //
  // Workflow level, not step level: a new step that shells out to gh is exactly
  // how this comes back, and only a workflow-level default covers steps nobody
  // has written yet.
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const dir = path.join(HERE, "..", "..", ".github", "workflows");
  const offenders = [];
  let checked = 0;
  for (const file of readdirSync(dir).filter((f) => f.startsWith("agent-") && f.endsWith(".yml"))) {
    const text = readFileSync(path.join(dir, file), "utf8");
    // Only workflows that actually invoke pipeline code can hit this.
    if (!text.includes("scripts/agent/") && !text.includes("agent-tools/")) continue;
    checked += 1;
    // A workflow-level `env:` block is at column 0; a job-level one is indented.
    const wfEnv = /^env:\n(?:[ \t]+.*\n|\n)*?[ \t]+GH_REPO:/m.test(text);
    if (!wfEnv) offenders.push(file);
  }
  assert.ok(checked > 0, "expected to find workflows that invoke pipeline scripts");
  assert.deepEqual(
    offenders,
    [],
    `these workflows run pipeline scripts without a workflow-level GH_REPO:\n  ${offenders.join("\n  ")}`,
  );
});

test("agent-fix decides eligibility on TRUSTED main, before the branch checkout", () => {
  // The gate authorises a bot push and the brief becomes the agent's prompt. Both
  // must be computed by main's code — a branch that could supply either would be
  // choosing whether it gets fixed and what the fixer is told to do.
  const wf = WF("agent-fix.yml");
  // Anchored on the step NAME, not on a ref literal: the trusted source is this
  // repository's own `main`, and a bare `ref: main` is not unique to this step.
  // The step's name is what stays stable, and it is unique to this job — the
  // router's checkout in the `route` job would otherwise match first.
  const trustedCheckout = wf.indexOf("- name: Check out trusted main");
  const gate = wf.indexOf("fix-eligible.mjs");
  const brief = wf.indexOf("fix-brief.mjs");
  const branchCheckout = wf.indexOf("ref: ${{ steps.pr.outputs.branch }}");
  for (const [label, i] of [["trusted checkout", trustedCheckout], ["gate", gate], ["brief", brief], ["branch checkout", branchCheckout]]) {
    assert.ok(i > 0, `agent-fix.yml must contain the ${label} step`);
  }
  assert.ok(trustedCheckout < gate, "eligibility must be decided from the trusted checkout");
  assert.ok(gate < brief, "the brief is only built once eligibility passed");
  assert.ok(brief < branchCheckout, "the prompt must be fixed before untrusted code is on disk");
});

test("agent-fix reports cost and outcome even when the agent step fails", () => {
  // A fix run that dies at turn 1 on a 429 is precisely the run whose cost and
  // reason a maintainer needs. `continue-on-error` on the agent is what lets the
  // reporting steps run, so the final step has to re-red the job.
  const wf = WF("agent-fix.yml");
  // Path-agnostic: the CLI is invoked from the staged trusted copy, so the match
  // is on the subcommand, not on where the script happens to live.
  assert.match(wf, /metrics\.mjs"? effort/, "the separate fix-effort comment must be posted");
  const effortStep = wf.slice(wf.indexOf("Post fix-agent effort comment"));
  assert.match(effortStep.slice(0, 200), /if: always\(\)/, "the effort comment must survive a failed agent");
  assert.match(wf, /core\.setFailed\('The fix agent failed/, "a swallowed agent failure must still red the job");
  // A push FOLLOWED by a failure (e.g. the agent dies during `fix-report.mjs post`)
  // makes both flags true and reds the job. Without an explicit combined branch the
  // `advanced`-first message would claim "✅ pushed" next to that red X and point at
  // a report comment that was never filed. The combined case must be handled first.
  assert.match(wf, /else if \(advanced && failed\)/, "the partial push-then-fail outcome must be its own branch");
  assert.ok(
    wf.indexOf("advanced && failed") < wf.indexOf("} else if (advanced) {"),
    "the combined branch must precede the advanced-only branch, or it can never be reached",
  );
});

test("agent-fix installs the untrusted branch without running its lifecycle scripts", () => {
  // This job checks out the PR branch (untrusted) with an App token already in the
  // environment, so the branch's own install scripts must not run. `--ignore-scripts`
  // blocks every dependency + workspace postinstall; the one first-party script the
  // workspace genuinely needs — backend `prisma generate`, used by verify:fast — is
  // re-run explicitly, off the code but not off the scripts.
  const wf = WF("agent-fix.yml");
  assert.match(wf, /pnpm install --frozen-lockfile --ignore-scripts/, "install must skip lifecycle scripts");
  assert.match(wf, /pnpm --filter @wafflebase\/backend exec prisma generate/, "the skipped prisma client must be regenerated");
  // The setup action is SHA-pinned here specifically because it runs after the
  // untrusted checkout with the token present.
  assert.match(wf, /uses: pnpm\/action-setup@[0-9a-f]{40}/, "pnpm/action-setup must be SHA-pinned in this token-bearing job");
});

test("agent-fix is maintainers-only and refuses bot-authored comments", () => {
  const wf = WF("agent-fix.yml");
  // Structural, not a marker string: `user.type` is set by GitHub and cannot be
  // chosen by the commenter, unlike author_association which is only a hint.
  assert.match(wf, /github\.event\.comment\.user\.type != 'Bot'/);
  assert.match(wf, /getCollaboratorPermissionLevel/);
  assert.match(wf, /\['admin', 'maintain', 'write'\]\.includes\(data\.permission\)/);
});

test("both fixers read from the SAME brief builder and write the SAME report format", () => {
  // The duplicate-prompt-input rot this extraction exists to prevent: if either
  // workflow grows its own copy, the two fixers silently diverge.
  const panel = WF("agent-review-panel.yml");
  const fix = WF("agent-fix.yml");
  assert.match(panel, /fix-brief\.mjs/, "the autonomous loop must use the shared brief builder");
  assert.match(fix, /steps\.brief\.outputs\.checklist/);
  assert.equal(/core\.setOutput\('checklist'/.test(panel), false, "the inline checklist builder must be gone");
  for (const [name, wf] of [["panel", panel], ["fix", fix]]) {
    assert.match(wf, /fix-report\.mjs post/, `the ${name} fixer must be told to file a report`);
  }
  // ...and the panel must actually READ them back, or the loop half is inert.
  assert.match(panel, /fix-report\.mjs read/);
  assert.match(panel, /--fix-reports/);

  // The ADVISORY panel too, or it reaches a different verdict than the gating one
  // for the same code — and a maintainer reading it is told something the merge
  // gate disagrees with.
  const onDemand = WF("agent-review-on-demand.yml");
  assert.match(onDemand, /fix-report\.mjs read/);
  assert.match(onDemand, /--fix-reports/);
});

test("the on-demand reader uses THIS workflow's PR output, not the panel's", () => {
  // The reader was copied from agent-review-panel.yml, where the number comes from
  // a `pr` STEP. This workflow has no such step: `steps.pr.outputs.number`
  // evaluated to "" so the `if` was permanently false and the step never ran —
  // fail-safe and completely invisible. Every `PR:` binding in the review job must
  // resolve to something this workflow actually produces.
  const wf = WF("agent-review-on-demand.yml");
  assert.equal(/steps\.pr\.outputs\.number/.test(wf), false, "no reference to a step this workflow lacks");
  const reader = wf.slice(wf.indexOf("Read fix-agent reports"), wf.indexOf("Run review panel"));
  assert.match(reader, /PR: \$\{\{ needs\.authorize\.outputs\.pr \}\}/);
  // And it must not be gated on an expression that can never be true.
  assert.equal(/if: steps\.pr\.outputs/.test(reader), false);
});

test("agent-fix re-verifies the commit AFTER checkout, closing the eligibility TOCTOU", () => {
  // The gate proves sha H carries the verdict; the checkout takes the branch TIP,
  // minutes later (app token, placeholder, brief, pnpm install). Without a
  // re-check, an author pushing in that window has the fixer edit and push on top
  // of a commit the panel never reviewed — the exact thing the precondition exists
  // to prevent.
  const wf = WF("agent-fix.yml");
  const checkout = wf.indexOf("ref: ${{ steps.pr.outputs.branch }}");
  const recheck = wf.indexOf("Re-verify the checked-out commit");
  const agent = wf.indexOf("Address panel findings");
  assert.ok(recheck > checkout, "the re-check must run after the branch checkout");
  assert.ok(recheck < agent, "and before the agent edits anything");
  const step = wf.slice(recheck, agent);
  assert.match(step, /steps\.eligible\.outputs\.head/, "it must compare against the GATED sha");
  assert.match(step, /git rev-parse HEAD/);
  assert.match(step, /exit 1/, "a moved branch must refuse, not warn");
});

test("agent-fix always answers the commenter, even when the gate step itself fails", () => {
  // fix-eligible.mjs exits 2 on a broken invocation. Under the implicit success()
  // the refusal step was skipped along with everything downstream, stranding
  // "🤖 Working on @claude fix…" beside a red X forever.
  const wf = WF("agent-fix.yml");
  const refusal = wf.slice(wf.indexOf("- name: Explain the refusal"));
  assert.match(refusal.slice(0, 200), /if: always\(\) && steps\.eligible\.outputs\.eligible != 'true'/);
  assert.match(refusal.slice(0, 2000), /eligibility check could not complete/, "an empty reason must still say something");
});

test("CI_WORKFLOW_PATH names a workflow file that actually exists", () => {
  // The gate matches CI runs on this path instead of on the run's display name,
  // which is what makes gate 1 unforgeable — a second file cannot claim the
  // path. The cost is that a typo, or renaming ci.yml, silently makes the gate
  // unsatisfiable for every PR: `ciRunsFor` would find nothing and read as
  // "CI has not run". Assert the file is there, and that it is the one whose
  // runs are named "CI".
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const abs = path.join(HERE, "..", "..", CI_WORKFLOW_PATH);
  const src = readFileSync(abs, "utf8"); // throws if the path is wrong
  assert.match(src, /^name:\s*CI\s*$/m, "ci.yml must still be the workflow whose runs are named CI");
});

test("ciConclusion: EVERY CI run must be green, and an unfinished one is 'not yet'", () => {
  const real = (conclusion) => ({ name: "CI", path: CI_WORKFLOW_PATH, conclusion });

  assert.equal(ciConclusion([]), null, "no runs at all");
  assert.equal(ciConclusion(undefined), null, "a missing list is not a crash");
  assert.equal(
    ciConclusion([{ name: "CI", path: ".github/workflows/pwn.yml", conclusion: "success" }]),
    null,
    "a second file calling itself CI is not the CI workflow",
  );
  assert.equal(ciConclusion([{ name: "CI" }]), null, "a run with no path cannot be matched to the file");

  assert.equal(ciConclusion([real("success")]), "success");
  assert.equal(ciConclusion([real("failure")]), "failure");

  // The point of the rule. A re-run does not create a second run — GitHub adds
  // a run_attempt to the existing one — so two runs for a SHA means CI was
  // TRIGGERED twice, and a green one must not excuse a red one. "Newest wins"
  // failed open here, in whichever order the API happened to return them.
  assert.equal(ciConclusion([real("success"), real("failure")]), "failure");
  assert.equal(ciConclusion([real("failure"), real("success")]), "failure");

  // Still running → not known yet, so the caller waits rather than reading a
  // verdict off whichever runs have finished. No timestamps are consulted at
  // all, so a missing or unparseable `created_at` cannot reorder anything.
  assert.equal(ciConclusion([real("success"), real(null)]), null);
  assert.equal(ciConclusion([real(null)]), null);
  assert.equal(ciConclusion([real("failure"), real(null)]), null);

  // A called workflow reports `<path>@<ref>` and is still the CI file.
  assert.equal(
    ciConclusion([{ name: "CI", path: `${CI_WORKFLOW_PATH}@refs/heads/main`, conclusion: "success" }]),
    "success",
  );
  assert.equal(ciRunsFor([real("success"), { name: "x", path: ".github/workflows/x.yml" }]).length, 1);
});

test("ciRunsToRerun: every red run, or one green one just to fire the event", () => {
  const run = (id, status, conclusion) => ({ id, status, conclusion });

  assert.deepEqual(ciRunsToRerun([]), [], "nothing to re-run");
  assert.deepEqual(ciRunsToRerun(undefined), [], "a missing list is not a crash");

  // THE RULE THIS EXISTS FOR. `ciConclusion` requires EVERY run for the SHA to
  // be green, so re-running only the newest can never clear gate 1 while an
  // older run for the same SHA is red — `@claude rerun` would re-run CI, the
  // panel would review again, and promote would refuse forever while the verb
  // reported that the panel "can promote or fix this PR".
  assert.deepEqual(
    ciRunsToRerun([run(3, "completed", "success"), run(2, "completed", "failure"), run(1, "completed", "cancelled")]).map((r) => r.id),
    [2, 1],
    "both non-success runs must be re-run, not just the newest run",
  );

  // All green: nothing needs turning green, but the re-run is still what emits
  // the `workflow_run` event (run_attempt > 1) the panel re-engages on — so
  // exactly one, not zero and not all of them.
  assert.deepEqual(
    ciRunsToRerun([run(3, "completed", "success"), run(2, "completed", "success")]).map((r) => r.id),
    [3],
  );

  // An in-flight run cannot be re-run (422) and emits its own completion event.
  assert.deepEqual(ciRunsToRerun([run(2, "in_progress", null), run(1, "completed", "success")]).map((r) => r.id), [1]);
  assert.deepEqual(ciRunsToRerun([run(2, "queued", null)]), [], "nothing completed yet");
});

test("agent-rerun / agent-loop mirror ciRunsToRerun inline, and the copies agree", () => {
  // Both re-run steps run BEFORE any checkout (agent-rerun's is at :246, and
  // agent-loop's `loop` job has none), so they cannot import checks.mjs — the
  // same constraint that makes agent-review-panel.yml mirror `ciRunDecision`
  // inline. The rule therefore exists twice, and pinning the copy is what keeps
  // it ONE rule: the previous version asked for `per_page: 1` and re-ran only
  // `workflow_runs[0]`, which cannot clear a gate that wants every run green.
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  for (const file of ["agent-rerun.yml", "agent-loop.yml"]) {
    const yml = readFileSync(path.join(HERE, "..", "..", ".github", "workflows", file), "utf8");
    const at = yml.indexOf("workflow_id: 'ci.yml'");
    assert.notEqual(at, -1, `${file} must still re-run CI by workflow id`);
    const block = yml.slice(at - 200, at + 900);

    assert.ok(!/per_page: 1,/.test(block), `${file}: one run cannot clear a SHA whose older CI run is red`);
    assert.match(block, /github\.paginate\(/, `${file} must read every run for the SHA, not one page's first entry`);
    assert.match(block, /r\.status === 'completed'/, `${file}: an in-flight run is not re-runnable (422)`);
    assert.match(block, /r\.conclusion !== 'success'/, `${file} must select the runs that are not green`);
    // The all-green fallback: zero re-runs would emit no `workflow_run` event,
    // so the panel — which admits `completed` only for run_attempt > 1 — would
    // never re-engage, and the verb's own comment would be wrong again.
    assert.match(
      block,
      /red\.length \? red : completed\.slice\(0, 1\)/,
      `${file}: all-green must still re-run exactly one, or the panel never re-engages`,
    );
    assert.match(block, /for \(const run of/, `${file} must re-run every selected run`);
  }

  // And the inline rule must agree with the exported one on the cases that
  // distinguish it, so a future edit to either copy is caught here.
  const run = (id, status, conclusion) => ({ id, status, conclusion });
  const inline = (runs) => {
    const completed = runs.filter((r) => r.status === "completed");
    const red = completed.filter((r) => r.conclusion !== "success");
    return red.length ? red : completed.slice(0, 1);
  };
  for (const fixture of [
    [],
    [run(1, "completed", "success")],
    [run(2, "completed", "failure"), run(1, "completed", "success")],
    [run(3, "completed", "success"), run(2, "completed", "cancelled")],
    [run(2, "in_progress", null), run(1, "completed", "success")],
    [run(1, "queued", null)],
  ]) {
    assert.deepEqual(
      ciRunsToRerun(fixture).map((r) => r.id),
      inline(fixture).map((r) => r.id),
      `the inline mirror disagrees with ciRunsToRerun on ${JSON.stringify(fixture)}`,
    );
  }
});
