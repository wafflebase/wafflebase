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
    assert.match(block, /node scripts\/agent\/test-removals\.mjs post "\$PR" --before "\$BEFORE" --branch "\$BRANCH" --actor "\$ACTOR" --since "\$SINCE" --head "\$HEAD_SHA"/);
    // The round is the fixer's PUSHES, not BEFORE..(head when this job runs):
    // a human push after the fixer must not be blamed on it.
    assert.doesNotMatch(block, /--after/);
    assert.match(block, /ACTOR: \$\{\{ needs\.fix\.outputs\.app_slug \}\}\[bot\]/);
    assert.match(block, /SINCE: \$\{\{ needs\.fix\.outputs\.since \}\}/);
    // Both come from fix-job steps that ran BEFORE the agent, so the agent
    // cannot move them: the App token's slug and the before-fix stamp.
    const fix = job(src, "fix");
    assert.match(fix, /app_slug: \$\{\{ steps\.app-token\.outputs\.app-slug \}\}/);
    assert.match(fix, /since: \$\{\{ steps\.before-fix\.outputs\.since \}\}/);
    const agentAt = fix.search(/\n {6}- name: Address panel findings\n/);
    const stampAt = fix.search(/\n {6}- name: Record branch head before fix\n {8}id: before-fix\n/);
    const tokenAt = fix.search(/\n {6}- name: Generate GitHub App token\n {8}id: app-token\n/);
    assert.ok(agentAt > 0 && stampAt > 0 && tokenAt > 0, "agent, stamp and token steps must all exist");
    assert.ok(stampAt < agentAt && tokenAt < agentAt, "the actor and the start time must be fixed before the agent runs");
    assert.match(fix.slice(stampAt, fix.indexOf("\n      - ", stampAt + 1)), /echo "since=\$\(date -u \+%Y-%m-%dT%H:%M:%SZ\)" >> "\$GITHUB_OUTPUT"/);
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

// ghLines JSON.parses every output line, so each --jq it gets must print JSON.
// `.[].sha` printed bare shas, the parse threw, and the record was never
// posted: main() logged "could not read the round's commits" every time.
test("every --jq the removal CLI parses as JSON lines prints JSON", () => {
  const src = readFileSync(path.join(HERE, "test-removals.mjs"), "utf8");
  const jqs = [...src.matchAll(/ghLines\(\[[^\]]*?"--jq",\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(jqs.length >= 3, `found the ghLines calls (${jqs.length})`);
  for (const jq of jqs) assert.match(jq.trim(), /(\}|\[\]|tojson)$/, `--jq ${jq} must print JSON`);
});
