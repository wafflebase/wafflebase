// Pins mark-ready.mjs's EXIT-CODE CONTRACT (issue #852).
//
// mark-ready reports its whole outcome through its exit status, and the
// `promote` job in agent-review-panel.yml branches on every value:
//
//   0 → promoted, or deliberately left alone   (`ready=true` output)
//   1 → a gate said no; job SUCCEEDS           ("leaving as draft")
//   2 → tooling error                          (job exits 2)
//   3 → gates passed, flip-to-ready FAILED     (job exits 3, pages a human)
//
// 0 and 1 both let that job succeed, so collapsing 1 into 0 — or renumbering
// 2/3 — would keep every other test green while a PR that should have merged
// sat as a draft forever. That is what these tests exist to catch.
//
// mark-ready runs its CLI at import time (top-level `process.exit`), so it
// cannot be imported — the same constraint that put DEFAULT_REVIEW_CHECKS in
// checks.mjs and HANDOFF_MARKER in disclosure.mjs. It is therefore tested as a
// PROCESS, with a stub `gh` first on PATH. The stub logs every invocation, so a
// test can assert the mutation as well as the code: "0 means promoted" is false
// if nothing called `gh pr ready`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CI_WORKFLOW_PATH, DEFAULT_REVIEW_CHECKS } from "./checks.mjs";
import { HANDOFF_MARKER } from "./disclosure.mjs";

const CI_PATH = CI_WORKFLOW_PATH;

const CLI = fileURLToPath(new URL("./mark-ready.mjs", import.meta.url));
const SOURCE = readFileSync(CLI, "utf8");
const PANEL_YML = fileURLToPath(
  new URL("../../.github/workflows/agent-review-panel.yml", import.meta.url),
);

// A `gh` that answers from a JSON config and records what it was asked. CommonJS
// on purpose: the file has no extension (it must be named exactly `gh` to be
// found on PATH), and node loads an extensionless file as CJS.
const STUB_GH = `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require("node:fs");
const argv = process.argv.slice(2);
const joined = argv.join(" ");
const cfg = JSON.parse(readFileSync(process.env.GH_STUB_CONFIG, "utf8"));
appendFileSync(process.env.GH_STUB_LOG, joined + "\\n");
// Which credential each call went out with. A SEPARATE log so the call
// assertions above stay string-clean, and one line per call — the hand-off
// comment's body is multi-line, which the log above can afford to be and a
// token-per-call log cannot.
appendFileSync(
  process.env.GH_STUB_TOKEN_LOG,
  (process.env.GH_TOKEN || "<unset>") + "\\t" + joined.split("\\n").join(" ") + "\\n",
);

if ((cfg.fail || []).some((p) => joined.startsWith(p))) {
  process.stderr.write("stub gh: forced failure for '" + joined + "'\\n");
  process.exit(1);
}

if (argv[0] === "pr" && argv[1] === "view") {
  // The label re-read just before the PUT asks for labels alone.
  const only = joined.endsWith("--json labels");
  process.stdout.write(JSON.stringify(only ? { labels: cfg.pr.labels || [] } : cfg.pr));
} else if (argv[0] === "api" && joined.includes("/runs?head_sha=")) {
  process.stdout.write(JSON.stringify({ workflow_runs: cfg.workflowRuns || [] }));
} else if (argv[0] === "api" && joined.includes("check-runs")) {
  process.stdout.write(JSON.stringify({ check_runs: cfg.checkRuns || [] }));
} else {
  process.stdout.write("{}");
}
`;

const DISCLOSED = "Authored autonomously by Claude Code; no human wrote a line.";
const AT = "2026-08-22T00:00:00Z";

/** A world where all three gates pass and the PR is still a draft. */
function okConfig(over = {}) {
  return {
    pr: {
      number: 7,
      body: DISCLOSED,
      isDraft: true,
      labels: [{ name: "agent:reviewing" }, { name: "enhancement" }],
      headRefName: "agent/852-x",
      headRefOid: "cafe7",
      url: "https://github.com/o/r/pull/7",
    },
    workflowRuns: [{ name: "CI", path: CI_PATH, conclusion: "success", created_at: AT }],
    checkRuns: DEFAULT_REVIEW_CHECKS.map((name) => ({ name, conclusion: "success", started_at: AT })),
    fail: [],
    ...over,
  };
}

// Two DIFFERENT credentials, so "which token was this call made with" is an
// observable rather than a guess: the App token may only appear on the three
// promotion mutations, the read token only on the reads.
const APP_TOKEN = "stub-app-token";
const READ_TOKEN = "stub-default-token";

function run(argv, cfg = okConfig()) {
  const dir = mkdtempSync(path.join(tmpdir(), "mark-ready-"));
  const cfgPath = path.join(dir, "config.json");
  const logPath = path.join(dir, "calls.log");
  const tokenLogPath = path.join(dir, "tokens.log");
  writeFileSync(path.join(dir, "gh"), STUB_GH, { mode: 0o755 });
  writeFileSync(cfgPath, JSON.stringify(cfg));
  writeFileSync(logPath, "");
  writeFileSync(tokenLogPath, "");
  const res = spawnSync(process.execPath, [CLI, ...argv], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${dir}${path.delimiter}${process.env.PATH}`,
      GH_STUB_CONFIG: cfgPath,
      GH_STUB_LOG: logPath,
      GH_STUB_TOKEN_LOG: tokenLogPath,
      GH_TOKEN: READ_TOKEN,
      GH_MUTATION_TOKEN: APP_TOKEN,
    },
  });
  return {
    code: res.status,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    calls: readFileSync(logPath, "utf8").split("\n").filter(Boolean),
    tokenCalls: readFileSync(tokenLogPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const tab = line.indexOf("\t");
        return { token: line.slice(0, tab), call: line.slice(tab + 1) };
      }),
  };
}

const promoted = (calls) => calls.some((c) => c.startsWith("pr ready"));

// ---- exit 2: tooling error (three sites) ----------------------------------

test("exit 2: a missing or non-numeric PR argument is a tooling error", () => {
  for (const argv of [[], ["--promote"], ["abc"], ["7.5"]]) {
    const { code, stderr, calls } = run(argv);
    assert.equal(code, 2, `argv ${JSON.stringify(argv)} must exit 2`);
    assert.match(stderr, /Usage: node \.\/scripts\/agent\/mark-ready\.mjs/);
    assert.deepEqual(calls, [], "must not touch the PR at all");
  }
});

test("exit 2: an empty required-check set fails closed unless opted into", () => {
  const { code, stderr, calls } = run(["7", "--promote", "--require-checks", ""]);
  assert.equal(code, 2);
  assert.match(stderr, /Refusing to promote with an empty required-check set/);
  assert.deepEqual(calls, []);

  // ...and --allow-no-checks is the opt-in, so it is NOT a tooling error.
  const opted = run(["7", "--promote", "--require-checks", "", "--allow-no-checks"]);
  assert.equal(opted.code, 0);
  assert.ok(promoted(opted.calls));
});

test("exit 2: failing to read the PR is a tooling error, not a gate failure", () => {
  const { code, stderr } = run(["7", "--promote"], okConfig({ fail: ["pr view"] }));
  assert.equal(code, 2, "an unreadable PR must not be reported as 'gates not satisfied'");
  assert.match(stderr, /Failed to read PR #7/);
});

// ---- exit 1: a gate said no (job still SUCCEEDS) --------------------------

test("exit 1, not 0: CI not green leaves the PR a draft without promoting", () => {
  for (const workflowRuns of [
    [], // no CI run for this SHA yet
    [{ name: "CI", path: CI_PATH, conclusion: "failure", created_at: AT }],
    [{ name: "CI", path: CI_PATH, conclusion: null, created_at: AT }], // still running
  ]) {
    const { code, stdout, calls } = run(["7", "--promote"], okConfig({ workflowRuns }));
    assert.equal(code, 1, `CI runs ${JSON.stringify(workflowRuns)} must exit 1, never 0`);
    assert.match(stdout, /Not promoting: one or more gates are not satisfied/);
    assert.ok(!promoted(calls), "a failed gate must never flip the PR to ready");
  }
});




test("gate 1 reads the NEWEST CI run for the SHA", () => {
  // `ciConclusion` reads the newest run by id. That is safe because a PR head
  // SHA carries exactly one CI run — `push` is restricted to main and a
  // merge_group run carries the speculative merge commit, an invariant
  // checks.test.mjs pins — and a re-run mutates that run in place rather than
  // adding a second. These fixtures cover the shape anyway, so the rule is
  // asserted rather than merely implied by a one-run fixture.
  const older = { name: "CI", path: CI_PATH, conclusion: "success", created_at: AT, id: 1 };
  const newerRed = { name: "CI", path: CI_PATH, conclusion: "failure", created_at: AT, id: 9 };

  const red = run(["7", "--promote"], okConfig({ workflowRuns: [older, newerRed] }));
  assert.equal(red.code, 1, "the newest CI run is red, so an older green one must not promote");
  assert.ok(!promoted(red.calls), "the PR must stay a draft");

  const green = run(
    ["7", "--promote"],
    okConfig({
      workflowRuns: [
        { name: "CI", path: CI_PATH, conclusion: "failure", created_at: AT, id: 1 },
        { name: "CI", path: CI_PATH, conclusion: "success", created_at: AT, id: 9 },
      ],
    }),
  );
  assert.equal(green.code, 0, "a newer green run supersedes the red one it replaced");
  assert.ok(promoted(green.calls));

  // The newest still running is "not known yet", not a pass.
  const inFlight = run(
    ["7", "--promote"],
    okConfig({ workflowRuns: [older, { name: "CI", path: CI_PATH, conclusion: null, created_at: AT, id: 9 }] }),
  );
  assert.equal(inFlight.code, 1, "an unfinished CI run must not be read as a pass");
  assert.ok(!promoted(inFlight.calls));
});

test("exit 1: a missing review check or a missing disclosure is also code 1", () => {
  const noReview = run(["7", "--promote"], okConfig({ checkRuns: [] }));
  assert.equal(noReview.code, 1);
  assert.ok(!promoted(noReview.calls));

  const noDisclosure = run(
    ["7", "--promote"],
    okConfig({ pr: { ...okConfig().pr, body: "A perfectly ordinary human PR body." } }),
  );
  assert.equal(noDisclosure.code, 1);
  assert.ok(!promoted(noDisclosure.calls));
});

// ---- exit 0: promoted, or deliberately left alone -------------------------

test("exit 0: a dry run reports the gates and mutates nothing", () => {
  const { code, stdout, calls } = run(["7"]);
  assert.equal(code, 0);
  assert.match(stdout, /All gates satisfied\. Re-run with --promote/);
  assert.ok(!promoted(calls), "without --promote nothing may be flipped");
  assert.ok(!calls.some((c) => c.startsWith("pr comment")));
});

test("exit 0: --promote flips the PR, sets one lifecycle label, posts the hand-off", () => {
  const { code, stdout, calls } = run(["7", "--promote"]);
  assert.equal(code, 0);
  assert.match(stdout, /Promoted PR #7 to ready/);
  assert.ok(promoted(calls), "code 0 under --promote must mean the PR was flipped");

  const put = calls.find((c) => c.startsWith("api -X PUT"));
  assert.ok(put, "the label set must be REPLACED, not appended to");
  assert.match(put, /labels\[\]=agent:ready/);
  assert.match(put, /labels\[\]=enhancement/, "non-agent labels survive");
  assert.doesNotMatch(put, /labels\[\]=agent:reviewing/, "the old lifecycle label is dropped");

  const comment = calls.find((c) => c.startsWith("pr comment"));
  assert.ok(comment?.includes(HANDOFF_MARKER), "harvest.mjs finds the hand-off by this marker");
});

test("exit 0: an already-ready PR is a no-op, not a re-promotion", () => {
  const { code, stdout, calls } = run(
    ["7", "--promote"],
    okConfig({ pr: { ...okConfig().pr, isDraft: false } }),
  );
  assert.equal(code, 0);
  assert.match(stdout, /already marked ready/);
  assert.ok(!promoted(calls));
});

test("exit 0: the best-effort label and comment steps cannot change the code", () => {
  // Both run AFTER the flip; a failure there must not be reported as a gate
  // failure (1) or a promotion failure (3) — the PR really is ready.
  for (const fail of [["api -X PUT"], ["pr comment"], ["api -X PUT", "pr comment"]]) {
    const { code, calls, stdout } = run(["7", "--promote"], okConfig({ fail }));
    assert.equal(code, 0, `fail ${JSON.stringify(fail)} must still exit 0`);
    assert.ok(promoted(calls));
    assert.match(stdout, /Promoted PR #7 to ready/);
  }
});

test("the three promotion mutations go out with GH_MUTATION_TOKEN, the reads do not", () => {
  // `ghMutate`'s env override is the fix for "Resource not accessible by
  // integration": the default GITHUB_TOKEN cannot markPullRequestReadyForReview,
  // and dropping the override puts every gate-passing PR back to silently stuck
  // as a draft — with no test failure, because a stub `gh` succeeds either way.
  const { code, tokenCalls } = run(["7", "--promote"]);
  assert.equal(code, 0);

  const tokensFor = (prefix) => tokenCalls.filter((c) => c.call.startsWith(prefix)).map((c) => c.token);
  for (const mutation of ["pr ready", "api -X PUT", "pr comment"]) {
    const seen = tokensFor(mutation);
    assert.ok(seen.length > 0, `${mutation} must have been called`);
    for (const token of seen) {
      assert.equal(token, APP_TOKEN, `'${mutation}' must be sent with GH_MUTATION_TOKEN`);
    }
  }

  const reads = tokenCalls.filter((c) => !/^(pr ready|api -X PUT|pr comment)/.test(c.call));
  assert.ok(reads.length > 0, "the gates must still read the PR, the CI runs and the checks");
  for (const read of reads) {
    assert.equal(read.token, READ_TOKEN, `read '${read.call}' must keep the default token`);
  }
});

// ---- exit 3: gates passed, the flip failed (pages a human) ----------------

test("exit 3, not 1: gates passed but flipping to ready failed", () => {
  const { code, stderr, calls } = run(["7", "--promote"], okConfig({ fail: ["pr ready"] }));
  assert.equal(code, 3, "a permission/tooling failure after the gates is NOT exit 1");
  assert.match(stderr, /All ready-gates passed, but flipping PR #7 to ready FAILED/);
  assert.match(stderr, /GH_MUTATION_TOKEN/);
  // Nothing downstream of the failed flip may run — no label, no hand-off.
  assert.ok(!calls.some((c) => c.startsWith("api -X PUT")));
  assert.ok(!calls.some((c) => c.startsWith("pr comment")));
});

// ---- the contract's other half: the consumer -----------------------------

test("every process.exit in mark-ready is a LITERAL 0, 1, 2 or 3", () => {
  // The promote job's `case` enumerates exactly these four and defaults the
  // rest to a failed job, so a fifth code is now loud rather than silent — but
  // it is still a contract break, and it is still cheapest to catch here.
  //
  // The argument must be a literal, not merely `\d+`: `const c = 5;
  // process.exit(c)` reads as a legal exit site to a `(\d+)` census, and the
  // whole point of the census is that the set of codes is readable from source.
  const args = [...SOURCE.matchAll(/process\.exit\(([^)]*)\)/g)].map((m) => m[1].trim());
  assert.ok(args.length > 0, "the CLI must still signal through process.exit");
  for (const arg of args) {
    assert.match(
      arg,
      /^[0-3]$/,
      `process.exit(${arg}): the promote job branches on the literal codes 0/1/2/3 — ` +
        "a computed or out-of-range status is not part of the contract",
    );
  }
});

test("agent-review-panel.yml handles every mark-ready code, defaults the rest", () => {
  const yml = readFileSync(PANEL_YML, "utf8");
  // `-1` explicitly: `slice(-1)` is the LAST CHARACTER, not the empty string, so
  // a length check would pass on a workflow that no longer calls mark-ready at
  // all and the failure would surface as confusing regex misses instead.
  const at = yml.indexOf("node ./scripts/agent/mark-ready.mjs");
  assert.notEqual(at, -1, "the promote job must still invoke mark-ready.mjs");
  // Bound the window at the step that FOLLOWS, not at a character count. The
  // block is allowed to grow; a count only a little larger than it would keep
  // passing while quietly reading the next step's script instead.
  const nextStep = yml.slice(at).search(/\n {6}- name:/);
  assert.notEqual(nextStep, -1, "the promote step must still be followed by another step");
  const window = yml.slice(at, at + nextStep);

  // The invocation. `--promote` is what makes this a promotion at all — without
  // it mark-ready is a dry run that exits 0 on a satisfied gate and flips
  // nothing, so the job would export ready=true for a PR still sitting as a draft.
  assert.match(
    window,
    /mark-ready\.mjs "\$PR" --promote --require-checks "\$REQUIRED"/,
    "the gate must run with --promote and the panel's required checks",
  );
  // A REDIRECT, not a pipe: `| tee` makes `$?` the status of the last pipeline
  // element and the script's code — the only thing this block reads — is lost.
  //
  // `code=$?` is asserted BEFORE it is used as a slice bound, for the reason the
  // `-1` above exists: a missing needle makes `indexOf` return -1, `slice(0, -1)`
  // is the whole window minus its last character rather than the empty string,
  // and the `||` inside the `1)` branch would then trip the no-pipe check —
  // reporting a deleted `code=$?` as a pipe that isn't there.
  const codeCapture = window.indexOf("code=$?");
  assert.notEqual(codeCapture, -1, "the step must still capture mark-ready's status into $code");
  const invocation = window.slice(0, codeCapture);
  assert.match(invocation, />\s*"\$RUNNER_TEMP\/mark-ready\.log" 2>&1/, "output must be redirected to a log");
  assert.ok(!invocation.includes("|"), "the capture must not be a pipe, or $? is not mark-ready's");

  // The chain itself: a `case` with a default, not bare `if`s that fall through.
  const caseBlock = window.match(/case "\$code" in\n([\s\S]*?)\n\s*esac\b/);
  assert.ok(caseBlock, "branch with a closed `case`, so an unhandled status has somewhere to land");
  // A branch label is a line whose first non-space character starts the pattern,
  // which no comment line can be, running to that branch's `;;`.
  const branches = new Map([...caseBlock[1].matchAll(/^\s*([0-3]|\*)\)([\s\S]*?);;/gm)].map((m) => [m[1], m[2]]));
  assert.deepEqual(
    [...branches.keys()].sort(),
    ["*", "0", "1", "2", "3"],
    "each code mark-ready emits needs a branch, and everything else needs `*)`",
  );

  // What each branch has to DO. Asserted as behavior rather than as the exact
  // echo text, so reflowing a message — or reindenting the block — cannot fail
  // a test that is about exit-code handling.
  //
  // `exit` in command position, with quoted text blanked first: a message that
  // says "exit 1" is prose, not a branch that exits.
  const exits = (branch) =>
    [...branch.replace(/"[^"]*"/g, '""').matchAll(/(?:^|[;{&|(]\s*)exit\s+(\d+)/gm)].map((m) => Number(m[1]));

  assert.match(branches.get("0"), /ready=true.*>>\s*"\$GITHUB_OUTPUT"/, "0 → promoted");
  assert.deepEqual(exits(branches.get("0")), [], "0 → promoted, so the job succeeds");
  assert.deepEqual(exits(branches.get("2")), [2], "2 → tooling error, fail the job");
  assert.deepEqual(exits(branches.get("3")), [3], "3 → promotion failed, page a human");
  assert.deepEqual(
    exits(branches.get("*")),
    [2],
    "an unenumerated status (127, 128+signal) must fail the job, not fall through it",
  );

  // The `1` branch is the one branch that lets the job SUCCEED, so its body is
  // the load-bearing part. 1 is also node's own crash code, so it must
  // corroborate against the script's verdict, and the gates-said-no path — the
  // one that reaches the end of the branch — must not exit at all.
  const one = branches.get("1");
  assert.match(one, /grep -qF "([^"]+)" "\$RUNNER_TEMP\/mark-ready\.log"/, "a bare exit 1 must not be believed");
  assert.match(one, /\|\|\s*\{[^}]*exit 2;\s*\}/, "an exit 1 with no verdict line is a crash → fail the job");
  assert.deepEqual(exits(one), [2], "the crash guard is the branch's only exit; a real verdict leaves it a draft");

  // The `outcome` vocabulary is a contract BETWEEN TWO STEPS of the same file:
  // the gate writes it, and the loop-status step branches on it to name why a
  // PR was not promoted. A rename on either side degrades silently to the
  // "cancelled, killed, or never ran" default — the exact mis-attribution the
  // outcome output exists to remove — so assert both sides agree.
  const written = new Set([...window.matchAll(/outcome=([a-z-]+)/g)].map((m) => m[1]));
  assert.ok(written.has("promoted"), "the promoted branch must record its outcome too");
  // `promoted` is the one outcome loop-status does NOT read off `$OUTCOME` — it
  // takes the `ready=true` arm above the case. Every other one must be named.
  const notPromoted = [...written].filter((o) => o !== "promoted");
  assert.ok(notPromoted.length >= 4, `every non-promoting branch needs an outcome, saw ${notPromoted}`);

  const status = yml.slice(yml.indexOf("- name: Update loop status (promotion)"));
  const caseAt = status.indexOf('case "$OUTCOME" in');
  assert.notEqual(caseAt, -1, "loop-status must branch on the gate's outcome");
  const readCase = status.slice(caseAt, status.indexOf("esac", caseAt));
  const read = new Set([...readCase.matchAll(/^\s+([a-z-]+)\)/gm)].map((m) => m[1]));
  for (const outcome of notPromoted) {
    assert.ok(read.has(outcome), `the gate writes outcome=${outcome}, which loop-status does not name`);
  }
  for (const outcome of read) {
    assert.ok(written.has(outcome), `loop-status names ${outcome}, which no gate branch writes`);
  }
  assert.match(readCase, /^\s+\*\)/m, "an unrecorded outcome (cancelled, killed) needs its own note");

  // CROSS-FILE CONTRACT: the string the workflow greps for has to be a string
  // mark-ready actually prints, or every exit 1 reads as a crash and every
  // legitimately-unready PR reds the job.
  const needle = one.match(/grep -qF "([^"]+)"/)[1];
  const gateSaidNo = run(["7", "--promote"], okConfig({ workflowRuns: [] }));
  assert.equal(gateSaidNo.code, 1);
  assert.ok(
    gateSaidNo.stdout.includes(needle),
    `the promote job greps for ${JSON.stringify(needle)}, which mark-ready no longer prints`,
  );
});
