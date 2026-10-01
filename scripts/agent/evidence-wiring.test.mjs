// Removed-test evidence and the keep-it-as-a-failing-test rule take effect only
// through the workflows: a trusted job must post the removal record, and both
// fixer prompts must carry the rule. Ported from yorkie-js-sdk, where the record
// is posted from its `fix-report` / `report` jobs; here it is a `fix-evidence`
// job in each workflow, never a step after the agent in the agent's own job.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WF = (n) => readFileSync(path.join(HERE, "..", "..", ".github", "workflows", n), "utf8");

/** One job's text, from its header to the next job header. */
function job(src, name) {
  const start = src.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `no job ${name}`);
  const next = src.slice(start + 1).search(/\n {2}[A-Za-z0-9_-]+:\n/);
  return next < 0 ? src.slice(start) : src.slice(start, start + 1 + next);
}

for (const file of ["agent-review-panel.yml", "agent-fix.yml"]) {
  test(`${file}: the fix-evidence job records removed tests as github-actions[bot]`, () => {
    const src = WF(file);
    const evidence = job(src, "fix-evidence");
    const at = evidence.indexOf("- name: Record tests the fix round removed\n");
    assert.ok(at > 0, "no removal step in fix-evidence");
    const end = evidence.indexOf("\n      - ", at + 1);
    const block = evidence.slice(at, end < 0 ? undefined : end);
    assert.match(block, /GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
    assert.match(block, /node scripts\/agent\/test-removals\.mjs post "\$PR" --before "\$BEFORE" --after "\$AFTER" --head "\$HEAD_SHA"/);
    assert.match(block, /continue-on-error: true/, "evidence is best-effort; it must never red the job");
    // From trusted main on a fresh runner, not the agent's runner.
    assert.match(evidence, /ref: main\s+sparse-checkout: scripts\/agent/);
    assert.ok(!job(src, "fix").includes("test-removals.mjs"), "the record must not be posted after the agent in its own job");
  });

  test(`${file}: the fixer is told not to delete a test that still reproduces`, () => {
    assert.match(WF(file), /NEVER DELETE OR DISABLE A TEST THAT SHOWS A FINDING STILL REPRODUCES\./);
    assert.match(WF(file), /Vitest: `it\.fails\(\.\.\.\)`/);
    // This repo's backend runs Jest, where the same thing is spelled differently.
    assert.match(WF(file), /`test\.failing\(\.\.\.\)`/);
    // node:test files (scripts/**/*.test.mjs, the frontend's *.integration.ts)
    // have neither, and either one crashes the file there.
    assert.match(WF(file), /node:test[\s\S]{0,200}\{ todo: 'still reproduces: <finding>' \}/);
  });
}

for (const file of ["agent-review-panel.yml", "agent-review-on-demand.yml"]) {
  test(`${file}: an unreadable issue is recorded, and the panel is told`, () => {
    const src = WF(file);
    assert.match(src, /fs\.writeFileSync\('\/tmp\/issue\.state', 'unreadable'\);/);
    assert.match(src, /--issue-file \/tmp\/issue\.txt\n\s+--issue-state \/tmp\/issue\.state/);
    // The swallow-everything catch this replaced must not come back beside it.
    assert.doesNotMatch(src, /issues\.get\([\s\S]{0,900}?\} catch \{\}/);
  });
}
