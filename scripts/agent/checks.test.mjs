import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkPassed, allRequiredPassed, ciRunDecision, DEFAULT_REVIEW_CHECKS } from "./checks.mjs";

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
       .replace(/vars\.AGENT_PIPELINE_ENABLED/g, "'true'");
    const admits = new Function("ACTION", "ATTEMPT", `return (${toJs(gateIf)});`);
    const suffix = (group.match(/\$\{\{ ([^}]*'noop'[^}]*) \}\}\s*$/) || [])[1];
    assert.ok(suffix, "the group must carry a noop/active partition suffix");
    const partition = new Function("ACTION", "ATTEMPT", `return (${toJs(suffix)});`);

    for (const [action, attempt] of [["requested", 1], ["requested", 2], ["completed", 1], ["completed", 2]]) {
      const works = Boolean(admits(action, attempt));
      const lane = partition(action, attempt);
      assert.equal(
        lane,
        works ? "active" : "noop",
        `${action}/attempt ${attempt}: gate ${works ? "admits" : "refuses"} but the group says ${lane}`,
      );
    }
    // And prove the partition is not degenerate — a group that always says "active"
    // would pass a same-answer check while restoring the cancellation bug.
    assert.equal(partition("requested", 1), "active");
    assert.equal(partition("completed", 1), "noop");
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

test("agent-fix decides eligibility on TRUSTED main, before the branch checkout", () => {
  // The gate authorises a bot push and the brief becomes the agent's prompt. Both
  // must be computed by main's code — a branch that could supply either would be
  // choosing whether it gets fixed and what the fixer is told to do.
  const wf = WF("agent-fix.yml");
  const trustedCheckout = wf.indexOf("ref: main");
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
