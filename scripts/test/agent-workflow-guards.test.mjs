// Invariants of THIS repository's `.github/workflows/agent-*.yml`.
//
// WHY THIS FILE EXISTS. These guards used to live in `scripts/agent/checks.test.mjs`,
// which was part of the pipeline mirror and was deleted with it. The workflows they
// guard did NOT move — they are wafflebase's own, and after the deletion nothing
// checked them at all. That is the trap the extraction keeps setting: a test can be
// about this repo while sitting in a directory that belongs to another one.
//
// Each assertion here corresponds to a failure that actually happened:
//
//   * GH_REPO absent  -> the whole autonomous loop died repo-wide for a day. `gh`
//     expands `{owner}/{repo}` by shelling out to git, the adapter deletes the only
//     .git in the workspace, and every step running before the PR checkout failed
//     with "not a git repository". Fixed in #790; nothing stopped it recurring.
//
//   * adapter out of order -> the pipeline is read before it has been placed, so a
//     step runs the consumer's own copy or nothing at all.
//
// The sha-pin shape that `checks.test.mjs` also guarded now lives in `readPins`
// (see verify-pipeline-drift.test.mjs), which reports a loose ref instead of
// silently dropping it.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
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

test("the pipeline is PLACED before anything reads it", () => {
  // Anchored on the step name rather than a line number, so reordering unrelated
  // steps cannot silently retarget the assertion.
  for (const f of agentWorkflows) {
    const src = readFileSync(path.join(WORKFLOWS, f), "utf8");
    const lines = src.split("\n");
    const place = lines.findIndex((l) => l.includes("Place the trusted pipeline"));
    if (place === -1) continue; // this workflow does not adapt; nothing to order
    const checkout = lines.findIndex((l) => /repository:\s*wafflebase\/agent-pipeline/.test(l));
    assert.notEqual(checkout, -1, `${f} places the pipeline but never checks it out`);
    assert.ok(checkout < place, `${f} places the pipeline before checking it out`);
    // The mv must name the scratch path the checkout wrote to.
    const mv = lines.slice(place, place + 8).find((l) => l.includes("mv .pipeline-src/packages/pipeline"));
    assert.ok(mv, `${f}'s placement step does not move .pipeline-src/packages/pipeline`);
  }
});

test("no agent workflow checks the pipeline out to a MUTABLE ref", () => {
  // Belt to readPins' braces, stated where a workflow author will see it: in this
  // phase nothing re-verifies the fetched code, so the pin is the entire guard.
  for (const f of agentWorkflows) {
    const lines = readFileSync(path.join(WORKFLOWS, f), "utf8").split("\n");
    lines.forEach((line, i) => {
      if (!/^\s*repository:\s*wafflebase\/agent-pipeline\s*(#.*)?$/.test(line)) return;
      const ref = lines.slice(i + 1, i + 4).find((l) => /^\s*ref:/.test(l));
      assert.ok(ref, `${f}:${i + 1} checks out the pipeline with no ref:`);
      assert.match(
        ref,
        /^\s*ref:\s*[0-9a-f]{40}\s*(#.*)?$/,
        `${f}:${i + 2} must pin a 40-character commit (tag in a trailing comment), got: ${ref.trim()}`,
      );
    });
  }
});

test("no step runs pipeline code out of a PR-controlled workspace", () => {
  // The trusted-code property, as a test — and it has to be ORDER-AWARE, which is
  // the whole difficulty. `./scripts/agent/X.mjs` is trusted or not depending on what
  // the workspace held when that step ran:
  //
  //   * after `mv .pipeline-src/packages/pipeline scripts/agent` -> the pinned copy
  //   * after `checkout` of the PR's head_branch                 -> the PR AUTHOR'S copy
  //
  // The `fix` job in agent-review-panel.yml legitimately does both, in that order,
  // and stages `$RUNNER_TEMP/agent-tools` before the PR checkout precisely so later
  // steps have a trusted source. Two steps still used the workspace path after that
  // point; a file-scoped check either misses them or condemns the 23 correct sites
  // beside them, so this walks each job in order and tracks the state.
  const untrusted = [];
  for (const f of agentWorkflows) {
    const lines = readFileSync(path.join(WORKFLOWS, f), "utf8").split("\n");
    const jobsAt = lines.findIndex((l) => l === "jobs:");
    if (jobsAt === -1) continue;
    const starts = lines.reduce((acc, l, i) => (i > jobsAt && /^ {2}[\w-]+:\s*$/.test(l) ? [...acc, i] : acc), []);
    for (let k = 0; k < starts.length; k++) {
      const [from, to] = [starts[k], starts[k + 1] ?? lines.length];
      let state = "none";
      for (let i = from; i < to; i++) {
        const line = lines[i];
        if (line.includes("mv .pipeline-src/packages/pipeline scripts/agent")) state = "trusted";
        else if (/ref:\s*\$\{\{[^}]*head_(branch|sha)/.test(line)) state = "pr";
        if (line.trim().startsWith("#")) continue;
        const m = /\bnode\s+"?\.?\/?scripts\/agent\/([\w.-]+\.mjs)/.exec(line);
        if (!m || line.includes("vendor/pipeline")) continue;
        // A file that EXISTS under scripts/agent is measurement — `classify.mjs`,
        // the hunters — and the workspace is its home, so reading it there is right.
        // One that does not exist can only be arriving from the adapter, and then
        // the workspace state is the whole question. This keeps the rule offline:
        // no need for the pipeline's file list, just the absence of the file.
        if (existsSync(path.join(REPO, "scripts", "agent", m[1]))) continue;
        if (state !== "trusted") untrusted.push(`${f}:${i + 1} (${state}) ${m[1]}`);
      }
    }
  }
  assert.deepEqual(
    untrusted,
    [],
    `these run pipeline code from a workspace the PR author controls — use ` +
      `$RUNNER_TEMP/agent-tools/, staged from the adapted copy before the PR checkout:\n${untrusted.join("\n")}`,
  );
});
