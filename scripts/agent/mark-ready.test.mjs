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
import { DEFAULT_REVIEW_CHECKS } from "./checks.mjs";
import { HANDOFF_MARKER } from "./disclosure.mjs";

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

if ((cfg.fail || []).some((p) => joined.startsWith(p))) {
  process.stderr.write("stub gh: forced failure for '" + joined + "'\\n");
  process.exit(1);
}

if (argv[0] === "pr" && argv[1] === "view") {
  // The label re-read just before the PUT asks for labels alone.
  const only = joined.endsWith("--json labels");
  process.stdout.write(JSON.stringify(only ? { labels: cfg.pr.labels || [] } : cfg.pr));
} else if (argv[0] === "api" && joined.includes("actions/runs")) {
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
    workflowRuns: [{ name: "CI", conclusion: "success", created_at: AT }],
    checkRuns: DEFAULT_REVIEW_CHECKS.map((name) => ({ name, conclusion: "success", started_at: AT })),
    fail: [],
    ...over,
  };
}

function run(argv, cfg = okConfig()) {
  const dir = mkdtempSync(path.join(tmpdir(), "mark-ready-"));
  const cfgPath = path.join(dir, "config.json");
  const logPath = path.join(dir, "calls.log");
  writeFileSync(path.join(dir, "gh"), STUB_GH, { mode: 0o755 });
  writeFileSync(cfgPath, JSON.stringify(cfg));
  writeFileSync(logPath, "");
  const res = spawnSync(process.execPath, [CLI, ...argv], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${dir}${path.delimiter}${process.env.PATH}`,
      GH_STUB_CONFIG: cfgPath,
      GH_STUB_LOG: logPath,
      GH_MUTATION_TOKEN: "stub-app-token",
    },
  });
  return {
    code: res.status,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    calls: readFileSync(logPath, "utf8").split("\n").filter(Boolean),
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
    [{ name: "CI", conclusion: "failure", created_at: AT }],
    [{ name: "CI", conclusion: null, created_at: AT }], // still running
  ]) {
    const { code, stdout, calls } = run(["7", "--promote"], okConfig({ workflowRuns }));
    assert.equal(code, 1, `CI runs ${JSON.stringify(workflowRuns)} must exit 1, never 0`);
    assert.match(stdout, /Not promoting: one or more gates are not satisfied/);
    assert.ok(!promoted(calls), "a failed gate must never flip the PR to ready");
  }
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

test("mark-ready uses no exit code outside {0,1,2,3}", () => {
  // The workflow's `if [ "$code" -eq N ]` chain handles exactly these four; any
  // fifth code would fall through the chain and SUCCEED silently.
  const used = new Set([...SOURCE.matchAll(/process\.exit\((\d+)\)/g)].map((m) => Number(m[1])));
  assert.ok(used.size > 0, "the CLI must still signal through process.exit");
  for (const code of used) {
    assert.ok([0, 1, 2, 3].includes(code), `unhandled exit code ${code}: teach the promote job about it`);
  }
});

test("agent-review-panel.yml still branches on every mark-ready code", () => {
  const yml = readFileSync(PANEL_YML, "utf8");
  // `-1` explicitly: `slice(-1)` is the LAST CHARACTER, not the empty string, so
  // a length check would pass on a workflow that no longer calls mark-ready at
  // all and the failure would surface as four confusing regex misses instead.
  const at = yml.indexOf("node ./scripts/agent/mark-ready.mjs");
  assert.notEqual(at, -1, "the promote job must still invoke mark-ready.mjs");
  // The whole `if` chain sits immediately below the invocation; bounding the
  // window keeps an unrelated `-eq 2` elsewhere in the file out of the match.
  const window = yml.slice(at, at + 1200);
  assert.match(window, /code=\$\?/);
  assert.match(window, /"\$code" -eq 2 \]; then .*exit 2/, "2 → tooling error, fail the job");
  assert.match(window, /"\$code" -eq 3 \]; then .*exit 3/, "3 → promotion failed, page a human");
  assert.match(window, /"\$code" -eq 1 \]; then echo "Not all ready-gates satisfied/, "1 → draft, job succeeds");
  assert.match(window, /"\$code" -eq 0 \]; then echo "ready=true"/, "0 → promoted");
});
