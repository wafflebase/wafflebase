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

test("no step runs pipeline code from the workspace after the PR's branch is checked out", () => {
  // ORDER, NOT EXISTENCE. The version of this check that shipped with the extraction
  // asked "is this file absent from `scripts/agent/`?" — true only while the pipeline
  // lived in another repository. With the pipeline back, every file is present, so
  // every invocation was skipped and the check inspected 0 of them while reporting
  // success. Keying on order instead makes it independent of where the code lives:
  // it inspects 28 invocations here, and it is what catches the eight-site
  // regression described at the top of this file.
  //
  // Scoped per job, because that is the boundary a checkout acts on — one job's
  // checkout says nothing about another's, and jobs in the same file may legitimately
  // differ. `$RUNNER_TEMP/agent-tools/` reads are not matched at all: the whole point
  // is that they are outside the workspace and survive `actions/checkout`'s clean.
  const UNTRUSTED_REF =
    /^\s*ref:\s*\$\{\{\s*(github\.event\.workflow_run\.head_(branch|sha)|github\.event\.pull_request\.head\.(ref|sha)|steps\.[\w-]+\.outputs\.(head_)?(branch|sha))/;
  const WORKSPACE_RUN = /\bnode\s+["']?\.?\/?scripts\/agent\/([\w.-]+\.mjs)/;

  const problems = [];
  let inspected = 0;
  for (const f of agentWorkflows) {
    const lines = readFileSync(path.join(WORKFLOWS, f), "utf8").split("\n");
    const jobsAt = lines.findIndex((l) => l === "jobs:");
    if (jobsAt === -1) continue;
    const starts = lines.reduce((acc, l, i) => (i > jobsAt && /^ {2}[\w-]+:\s*$/.test(l) ? [...acc, i] : acc), []);
    for (let k = 0; k < starts.length; k++) {
      const [from, to] = [starts[k], starts[k + 1] ?? lines.length];
      const job = lines[from].trim().replace(/:$/, "");
      let checkedOutAt = null;
      for (let i = from; i < to; i++) {
        const line = lines[i];
        // A commented-out checkout must not arm the check, and a commented-out
        // invocation must not trip it.
        if (line.trim().startsWith("#")) continue;
        if (UNTRUSTED_REF.test(line)) checkedOutAt = i + 1;
        const run = WORKSPACE_RUN.exec(line);
        if (!run) continue;
        inspected++;
        if (checkedOutAt !== null) {
          problems.push(
            `${f}:${i + 1} (job ${job}) runs ${run[1]} from the workspace, ` +
              `after the PR's own ref was checked out at line ${checkedOutAt}`,
          );
        }
      }
    }
  }

  // The counterpart to the anti-vacuity test above: if the invocations stop being
  // found at all, this check is green because it looked at nothing.
  assert.ok(inspected > 0, "found no `node scripts/agent/*.mjs` invocations to inspect");
  assert.deepEqual(
    problems,
    [],
    `these run author-controlled code while holding a write-scoped token. Stage the ` +
      `pipeline to $RUNNER_TEMP/agent-tools before the branch checkout and read it ` +
      `from there:\n${problems.join("\n")}`,
  );
});

test("the staged agent-tools copy is itself populated from trusted code", () => {
  // THE HOLE THE CHECK ABOVE LEAVES. That one only reads invocation paths, so it is
  // satisfied the moment a step says `$RUNNER_TEMP/agent-tools/…` — it cannot tell
  // whether what was copied there is main's code or the PR author's. Move a
  // `cp -R ./scripts/agent` one step later, past the branch checkout, and every
  // invocation still looks trusted while all of them now run the branch's code.
  // That is the worse failure of the two, because nothing about it reads wrong.
  //
  // Two legitimate sources, and they are the two the workflows use:
  //
  //   * the WORKSPACE (`./scripts/agent`) while it still holds trusted main — i.e.
  //     before any checkout of the PR's own ref in that job. `agent-fix` and the
  //     panel's `fix` job both stage this way.
  //   * a `path:`-scoped checkout pinned to `ref: main` (`.trusted-agent/…`), which
  //     is trusted whenever it happens — `agent-iterate-ci` stages AFTER the branch
  //     checkout and is correct precisely because its source is not the workspace.
  const UNTRUSTED_REF =
    /^\s*ref:\s*\$\{\{\s*(github\.event\.workflow_run\.head_(branch|sha)|github\.event\.pull_request\.head\.(ref|sha)|steps\.[\w-]+\.outputs\.(head_)?(branch|sha))/;
  const STAGE =
    /\b(?:cp -R|mv)\s+(\S+)\s+["']?(?:\$\{\{\s*runner\.temp\s*\}\}|\$\{?RUNNER_TEMP\}?)\/agent-tools/;

  const problems = [];
  let staged = 0;
  for (const f of agentWorkflows) {
    const lines = readFileSync(path.join(WORKFLOWS, f), "utf8").split("\n");
    const jobsAt = lines.findIndex((l) => l === "jobs:");
    if (jobsAt === -1) continue;
    const starts = lines.reduce((acc, l, i) => (i > jobsAt && /^ {2}[\w-]+:\s*$/.test(l) ? [...acc, i] : acc), []);
    for (let k = 0; k < starts.length; k++) {
      const [from, to] = [starts[k], starts[k + 1] ?? lines.length];
      const job = lines[from].trim().replace(/:$/, "");
      let checkedOutAt = null;
      const trusted = new Set(); // `path:` dirs written by a `ref: main` checkout
      for (let i = from; i < to; i++) {
        const line = lines[i];
        if (line.trim().startsWith("#")) continue;
        if (UNTRUSTED_REF.test(line)) checkedOutAt = i + 1;
        // A checkout block: pair its `ref:` with its `path:`, both within the `with:`.
        if (/^\s*-?\s*uses:\s*actions\/checkout@/.test(line)) {
          const win = lines.slice(i + 1, i + 12);
          const end = win.findIndex((b) => /^\s*- /.test(b));
          const body = end === -1 ? win : win.slice(0, end);
          const isMain = body.some((b) => /^\s*ref:\s*main\s*$/.test(b));
          const dir = body.find((b) => /^\s*path:\s*/.test(b));
          if (isMain && dir) trusted.add(dir.replace(/^\s*path:\s*/, "").trim().replace(/^\.\//, ""));
        }
        const stage = STAGE.exec(line);
        if (!stage) continue;
        staged++;
        const src = stage[1].replace(/^\.\//, "");
        if ([...trusted].some((t) => src === t || src.startsWith(`${t}/`))) continue;
        if (src.startsWith("scripts/agent") && checkedOutAt === null) continue; // workspace is still main
        problems.push(
          `${f}:${i + 1} (job ${job}) stages agent-tools from ${stage[1]}, which is not ` +
            (checkedOutAt !== null
              ? `trusted here: the PR's own ref was checked out at line ${checkedOutAt}`
              : "a `ref: main` checkout nor the pre-checkout workspace"),
        );
      }
    }
  }

  assert.ok(staged > 0, "found no step staging $RUNNER_TEMP/agent-tools");
  assert.deepEqual(
    problems,
    [],
    `agent-tools would hold author-controlled code, and every read of it would still ` +
      `look trusted:\n${problems.join("\n")}`,
  );
});
