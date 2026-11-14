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
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WORKFLOWS = path.join(REPO, ".github", "workflows");

const WF_TEXT = (file) => readFileSync(path.join(WORKFLOWS, file), "utf8");

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

// ---------------------------------------------------------------------------
// The dependency install of the jobs that hold a token while a pull request's
// branch is in the workspace. `scripts/agent/install-deps.mjs` is what makes
// that install run nothing and stay inside the workspace, and
// `scripts/agent/install-deps.test.mjs` runs it. These guards are the other
// half: that the workflows actually call it, from main's copy staged outside
// the workspace, with a pnpm the branch had no say in — and that nothing
// reintroduces an inline install, a dependency cache, a persisted credential
// or a movable action tag beside it.

/** The ref of a pull request's own branch, in any of the forms the workflows use. */
const BRANCH_REF =
  /^\s*ref:\s*\$\{\{\s*(github\.event\.workflow_run\.head_(branch|sha)|github\.event\.pull_request\.head\.(ref|sha)|steps\.[\w-]+\.outputs\.(head_)?(branch|sha|ref))/;

/**
 * The jobs of a workflow, each as its steps; a step is its lines with comments
 * dropped, so commented-out YAML neither satisfies nor trips a guard.
 */
function jobsOf(file) {
  const lines = readFileSync(path.join(WORKFLOWS, file), "utf8").split("\n");
  const jobsAt = lines.findIndex((l) => l === "jobs:");
  if (jobsAt === -1) return [];
  const starts = lines.reduce((acc, l, i) => (i > jobsAt && /^ {2}[\w-]+:\s*$/.test(l) ? [...acc, i] : acc), []);
  return starts.map((from, k) => {
    const body = lines.slice(from + 1, starts[k + 1] ?? lines.length).filter((l) => !l.trim().startsWith("#"));
    const steps = [];
    for (const line of body) {
      if (/^ {6}- /.test(line)) steps.push([line]);
      else if (steps.length > 0) steps.at(-1).push(line);
    }
    return {
      file,
      name: lines[from].trim().replace(/:$/, ""),
      steps: steps.map((s) => {
        const text = s.join("\n");
        const runAt = s.findIndex((l) => /^\s*(?:- )?run:/.test(l));
        return {
          text,
          name: /^\s*- name:\s*(.*)$/m.exec(text)?.[1] ?? "",
          id: /^\s*id:\s*(\S+)\s*$/m.exec(text)?.[1] ?? null,
          cond: /^\s*if:\s*(.*)$/m.exec(text)?.[1] ?? "",
          usesLine: s.find((l) => /^\s*(?:- )?uses:/.test(l)) ?? null,
          uses: /^\s*(?:- )?uses:\s*(\S+)/m.exec(text)?.[1] ?? null,
          isRun: runAt !== -1,
          // A `run: |` block, dedented; or the one-line command.
          script:
            runAt === -1
              ? null
              : /run:\s*\|\s*$/.test(s[runAt])
                ? s.slice(runAt + 1).map((l) => l.replace(/^ {10}/, "")).join("\n")
                : s[runAt].replace(/^\s*(?:- )?run:\s*/, ""),
          checksOutBranch: s.some((l) => BRANCH_REF.test(l)),
        };
      }),
    };
  });
}

/** The four jobs that install a pull request's branch. */
const INSTALLING_JOBS = [
  ["agent-fix.yml", "fix"],
  ["agent-review-panel.yml", "fix"],
  ["agent-iterate-ci.yml", "iterate"],
  ["agent-review-reply.yml", "reply"],
];
const job = (file, name) => {
  const found = jobsOf(file).find((j) => j.name === name);
  assert.ok(found, `${file} has no job named ${name}`);
  return found;
};
const PNPM_COMMAND = /(^|[\s;&|(])pnpm\s+(install|i|ci|add|exec|dlx|run|rebuild|--filter|-r|-C)\b/m;
const INSTALL = 'node "$RUNNER_TEMP/agent-tools/install-deps.mjs"';
const PINNED = /@[0-9a-f]{40} # v\d+(\.\d+\.\d+)?$/;
const AGENT_ACTION = "anthropics/claude-code-action@";

test("the jobs that install a PR branch's dependencies do it through main's install-deps.mjs, staged outside the workspace", () => {
  for (const [file, name] of INSTALLING_JOBS) {
    const where = `${file} (job ${name})`;
    const { steps } = job(file, name);
    const branchAt = steps.findIndex((s) => s.checksOutBranch);
    assert.notEqual(branchAt, -1, `${where} no longer checks out the PR's branch — is it still an installing job?`);

    const installs = steps.map((s, i) => [s, i]).filter(([s]) => /install-deps\.mjs/.test(s.text));
    assert.equal(installs.length, 1, `${where} must run install-deps.mjs in exactly one step`);
    const [install, installAt] = installs[0];
    assert.ok(installAt > branchAt, `${where} runs the install before the branch is checked out`);
    // The whole command, not a substring: nothing before or after it, no
    // wrapper that could change what it runs — and from the staged copy only.
    // A copy inside the workspace is at a path the branch's own tree can reach.
    assert.equal(install.script, INSTALL, `${where} must run exactly: ${INSTALL}`);
    // The step is handed nothing: no token, no secret, no expression.
    assert.doesNotMatch(install.text, /^\s*env:|\$\{\{(?!\s*steps\.[\w-]+\.outputs\.[\w-]+\s*[!=]=)/m, `${where}: the install step takes an env: or an expression`);
    assert.equal(install.id, "install", `${where}: the install step must be \`id: install\``);

    // The branch checkout leaves no credential in the checkout the install runs in.
    assert.match(steps[branchAt].text, /^\s*persist-credentials:\s*false\s*$/m, `${where} persists the checkout token before the install`);

    // A side directory main is checked out to is a name inside the branch's
    // tree: it must be cleared, checked out from main, copied out and removed
    // again — and nothing may be RUN from it.
    const sideDirs = new Set();
    for (const s of steps) {
      for (const m of s.text.matchAll(/(?:^|[\s"'/])(\.trusted-[\w-]+)/g)) sideDirs.add(m[1]);
    }
    for (const dir of sideDirs) {
      const esc = dir.replace(".", "\\.");
      const checkoutAt = steps.findIndex(
        (s) => s.uses?.startsWith("actions/checkout@") && /^\s*ref:\s*main\s*$/m.test(s.text) && new RegExp(`^\\s*path:\\s*${esc}\\s*$`, "m").test(s.text),
      );
      assert.notEqual(checkoutAt, -1, `${where} reads ${dir} but never checks main out to it`);
      const clearedAt = steps.findIndex((s) => s.script === `rm -rf ${dir}`);
      assert.ok(clearedAt > branchAt && clearedAt < checkoutAt, `${where} must \`rm -rf ${dir}\` after the branch checkout and before main is checked out to it`);
      const stageAt = steps.findIndex((s) => s.script?.includes(`cp -R ${dir}/scripts/agent "\${{ runner.temp }}/agent-tools"`));
      assert.ok(stageAt > checkoutAt && stageAt < installAt, `${where} must stage ${dir} to $RUNNER_TEMP/agent-tools before the install`);
      assert.match(steps[stageAt].script, new RegExp(`\\n\\s*rm -rf ${esc}\\s*$`), `${where} must remove ${dir} once it is staged`);
      for (const [i, s] of steps.entries()) {
        if ([checkoutAt, clearedAt, stageAt].includes(i)) continue;
        assert.doesNotMatch(s.text, new RegExp(esc), `${where}: step "${s.name}" reads ${dir} inside the workspace`);
      }
    }

    // No other step installs, builds or generates with pnpm: after the branch
    // is checked out, the only pnpm this job runs itself is the install above.
    for (const [i, s] of steps.entries()) {
      if (!s.isRun || i === installAt) continue;
      assert.doesNotMatch(s.script, PNPM_COMMAND, `${where} runs pnpm in a step of its own:\n${s.text}`);
    }

    // What the setup no longer does, the agent is told to: every one of these
    // jobs' agent steps carries the instruction to generate the Prisma client.
    const agent = steps.filter((s) => s.uses?.startsWith(AGENT_ACTION));
    assert.equal(agent.length, 1, `${where} must have exactly one agent step`);
    assert.match(agent[0].text, /lifecycle scripts/i, `${where}: the agent is not told the install ran no lifecycle scripts`);
    assert.match(agent[0].text, /pnpm --filter @wafflebase\/backend exec prisma generate/, `${where}: the agent is not told to generate the Prisma client`);
  }
});

test("the staged scripts are fingerprinted before the install and checked right after it", (t) => {
  const scripts = [];
  for (const [file, name] of INSTALLING_JOBS) {
    const where = `${file} (job ${name})`;
    const { steps } = job(file, name);
    const installAt = steps.findIndex((s) => s.id === "install");
    const record = steps[installAt - 1];
    const verify = steps[installAt + 1];
    assert.equal(record?.id, "tools", `${where}: the step before the install must record the digest (id: tools)`);
    assert.match(record.script, /echo "digest=\$digest" >> "\$GITHUB_OUTPUT"/, `${where}: the digest must be a step output`);
    assert.equal(verify?.name, "Verify the staged agent scripts are unchanged", `${where}: the step after the install must verify the digest`);
    // It runs whatever the install did, and before every other `always()` step.
    assert.match(verify.cond, /^always\(\) && steps\.tools\.outputs\.digest != ''$/, `${where}: the verify step must run under always()`);
    assert.match(verify.text, /^\s*EXPECTED: \$\{\{ steps\.tools\.outputs\.digest \}\}\s*$/m, `${where}: the verify step must compare against the recorded output`);
    for (const s of steps.slice(0, installAt + 1)) {
      if (s !== record) assert.doesNotMatch(s.text, /GITHUB_OUTPUT.*digest|digest=.*GITHUB_OUTPUT/, `${where}: another step writes the digest`);
    }
    scripts.push([where, record.script, verify.script]);
  }
  // One pair of scripts, the same in all four jobs.
  for (const [where, record, verify] of scripts) {
    assert.equal(record, scripts[0][1], `${where}: the record step differs from ${scripts[0][0]}'s`);
    assert.equal(verify, scripts[0][2], `${where}: the verify step differs from ${scripts[0][0]}'s`);
  }

  // RUN, not read: the two scripts against a staged directory.
  if (spawnSync("sh", ["-c", "command -v sha256sum"]).status !== 0) {
    t.skip("needs sha256sum");
    return;
  }
  const base = mkdtempSync(path.join(realpathSync(os.tmpdir()), "agent-tools-digest-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const [, record, verify] = scripts[0];
  const tools = path.join(base, "agent-tools");
  const stage = () => {
    rmSync(tools, { recursive: true, force: true });
    mkdirSync(path.join(tools, "lenses"), { recursive: true });
    writeFileSync(path.join(tools, "a.mjs"), "export const a = 1;\n");
    writeFileSync(path.join(tools, "lenses", "b.md"), "b\n");
  };
  const sh = (script, env) => spawnSync("bash", ["--noprofile", "--norc", "-e", "-c", script], { encoding: "utf8", env: { PATH: process.env.PATH, RUNNER_TEMP: base, ...env } });
  const digestOf = () => {
    const out = path.join(base, "output");
    rmSync(out, { force: true });
    const r = sh(record, { GITHUB_OUTPUT: out });
    assert.equal(r.status, 0, r.stderr);
    const digest = /^digest=([0-9a-f]{64})$/m.exec(readFileSync(out, "utf8"))?.[1];
    assert.ok(digest, "the record step wrote no sha256 digest");
    return digest;
  };
  stage();
  const digest = digestOf();
  assert.equal(digestOf(), digest, "the digest is not stable");
  const untouched = sh(verify, { EXPECTED: digest });
  assert.equal(untouched.status, 0, untouched.stderr);
  assert.ok(existsSync(path.join(tools, "a.mjs")));

  const tampering = {
    "a changed file": () => writeFileSync(path.join(tools, "a.mjs"), "export const a = 2;\n"),
    "an added file": () => writeFileSync(path.join(tools, "lenses", "c.mjs"), ""),
    "a removed file": () => rmSync(path.join(tools, "lenses", "b.md")),
    "an added empty directory": () => mkdirSync(path.join(tools, "node_modules")),
    "a file replaced by a link to its twin": () => {
      writeFileSync(path.join(base, "twin"), "export const a = 1;\n");
      rmSync(path.join(tools, "a.mjs"));
      symlinkSync(path.join(base, "twin"), path.join(tools, "a.mjs"));
    },
  };
  for (const [what, tamper] of Object.entries(tampering)) {
    stage();
    assert.equal(digestOf(), digest);
    tamper();
    const r = sh(verify, { EXPECTED: digest });
    assert.notEqual(r.status, 0, `${what}: the verify step passed`);
    assert.match(r.stderr, /^::error::The staged agent scripts changed/m, what);
    assert.equal(existsSync(tools), false, `${what}: the staged directory is still there for later steps to run`);
  }
});

test("a refused install is reported where the job has no other way to say so", () => {
  // `agent-fix` rewrites its placeholder comment ("a setup step failed before
  // it ran"), `agent-iterate-ci` pages from its always() step, and the panel's
  // `fix` job is paged by the `stalled` job. The reply job had nothing: the
  // person who wrote `@claude` got a red job and silence.
  const { steps } = job("agent-review-reply.yml", "reply");
  const installAt = steps.findIndex((s) => s.id === "install");
  const tell = steps.find((s) => /steps\.install\.outcome == 'failure'/.test(s.cond));
  assert.ok(tell, "agent-review-reply.yml has no step reporting a failed install");
  assert.match(tell.cond, /^failure\(\) && /, "the report must run when the job has failed");
  assert.ok(steps.indexOf(tell) > installAt, "the report must come after the install");
  assert.match(tell.script, /^gh pr comment "\$PR" --body /, "the report must be a comment on the pull request");
  assert.match(tell.text, /^\s*working-directory: \$\{\{ runner\.temp \}\}\s*$/m, "the report must not run from the workspace");
  // The other three: the mechanisms named above are still there.
  assert.match(WF_TEXT("agent-fix.yml"), /const neverRan = process\.env\.AGENT === '' \|\| process\.env\.AGENT === 'skipped';/);
  const page = job("agent-iterate-ci.yml", "iterate").steps.find((s) => s.name === "Page if the fix produced no commit");
  assert.match(page.cond, /^always\(\) && steps\.guard\.outputs\.proceed == 'true'$/);
  assert.match(WF_TEXT("agent-review-panel.yml"), /\(needs\.fix\.result == 'failure' && needs\.fix-evidence\.outputs\.infra_paged != 'true'\)/);
});

test("the installing jobs set up pnpm and Node before the branch, pinned, with no cache", () => {
  const manifest = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8"));
  const pnpmVersion = /^pnpm@(\d+\.\d+\.\d+)$/.exec(manifest.packageManager)?.[1];
  assert.ok(pnpmVersion, `package.json's packageManager is not a plain pnpm@x.y.z: ${manifest.packageManager}`);

  for (const [file, name] of INSTALLING_JOBS) {
    const where = `${file} (job ${name})`;
    const { steps } = job(file, name);
    const branchAt = steps.findIndex((s) => s.checksOutBranch);
    for (const action of ["pnpm/action-setup", "actions/setup-node"]) {
      const found = steps.map((s, i) => [s, i]).filter(([s]) => s.uses?.startsWith(`${action}@`));
      assert.equal(found.length, 1, `${where} must use ${action} exactly once`);
      // Before the branch is in the workspace, so nothing in the branch is
      // there for the setup to read.
      assert.ok(found[0][1] < branchAt, `${where} runs ${action} after the PR's branch is checked out`);
    }
    // WHAT IS IN THE WORKSPACE WHEN THE SETUP RUNS. The setup action reads the
    // workspace it runs in, so until it has run the workspace holds main's tree
    // or nothing: every checkout before it names `ref: main` and has no `path:`
    // of its own, and no `run:` step before it writes a file there by name.
    const setupAt = steps.findIndex((s) => s.uses?.startsWith("pnpm/action-setup@"));
    for (const s of steps.slice(0, setupAt)) {
      if (s.uses?.startsWith("actions/checkout@")) {
        assert.match(s.text, /^\s*ref:\s*main\s*$/m, `${where}: a checkout before the pnpm setup does not name main`);
      }
      assert.doesNotMatch(s.text, /\.npmrc|\.pnpmfile/, `${where}: a step before the pnpm setup names a pnpm configuration file`);
    }
    const setup = steps[setupAt];
    assert.match(
      setup.text,
      new RegExp(`^\\s*version:\\s*${pnpmVersion.replaceAll(".", "\\.")}\\s*$`, "m"),
      `${where} must give pnpm/action-setup the version main's packageManager names (${pnpmVersion})`,
    );
  }
});

test("every action in a job that installs dependencies with a token is pinned to a commit", () => {
  // The four installing jobs, and `agent-implement`, which installs main with
  // lifecycle scripts on. A tag can be moved; a job that holds an App token
  // and model credentials runs whatever the tag points at that day.
  let checked = 0;
  for (const [file, name] of [...INSTALLING_JOBS, ["agent-implement.yml", "implement"]]) {
    for (const s of job(file, name).steps) {
      if (!s.uses || s.uses.startsWith("./")) continue;
      checked++;
      assert.match(s.usesLine.trim(), PINNED, `${file} (job ${name}) must pin ${s.uses} to a commit, with the version in a comment`);
    }
  }
  assert.ok(checked >= 40, `inspected only ${checked} uses: lines`);

  // `agent-implement` installs with scripts on, so what it checks out is named.
  const implement = job("agent-implement.yml", "implement").steps;
  const checkouts = implement.filter((s) => s.uses?.startsWith("actions/checkout@"));
  assert.equal(checkouts.length, 1);
  assert.match(checkouts[0].text, /^\s*ref:\s*main\s*$/m, "agent-implement.yml must check out main by name");
  // … so its pnpm setup, which comes after that checkout, runs in main's tree.
  const setupAt = implement.findIndex((s) => s.uses?.startsWith("pnpm/action-setup@"));
  assert.ok(setupAt > implement.indexOf(checkouts[0]));
  assert.equal(existsSync(path.join(REPO, ".npmrc")), false, "main has gained a root .npmrc: the pnpm setup action reads it — look at what it says before this assertion is changed");
});

test("no agent workflow caches dependencies, installs a branch inline, or sets pnpm up from a movable tag", () => {
  const manifest = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8"));
  const pnpmVersion = manifest.packageManager.replace(/^pnpm@/, "");
  let setups = 0;
  for (const f of agentWorkflows) {
    for (const j of jobsOf(f)) {
      const where = `${f} (job ${j.name})`;
      const hasBranch = j.steps.some((s) => s.checksOutBranch);
      const usesPnpm = j.steps.some((s) => s.uses?.startsWith("pnpm/action-setup@"));
      for (const s of j.steps) {
        // Every agent job holds a token or a model credential, and a cache
        // saved by one is saved after the agent ran.
        assert.doesNotMatch(s.text, /^\s*cache:/m, `${where} sets cache: on a setup action`);
        assert.ok(!s.uses?.startsWith("actions/cache"), `${where} uses actions/cache`);
        if (s.isRun && hasBranch) {
          assert.doesNotMatch(s.script, /\bpnpm\s+(install|i)\b/, `${where} installs a PR branch inline instead of through install-deps.mjs`);
        }
        if (s.uses?.startsWith("pnpm/action-setup@")) {
          setups++;
          assert.match(s.uses, /@[0-9a-f]{40}$/, `${where} uses pnpm/action-setup from a tag`);
          assert.match(s.text, new RegExp(`^\\s*version:\\s*${pnpmVersion.replaceAll(".", "\\.")}\\s*$`, "m"), `${where} leaves the pnpm version to the workspace`);
        }
        if (usesPnpm && s.uses?.startsWith("actions/setup-node@")) {
          assert.match(s.uses, /@[0-9a-f]{40}$/, `${where} uses actions/setup-node from a tag beside the pnpm setup`);
        }
      }
    }
  }
  // Anti-vacuity: the four installing jobs and agent-implement.
  assert.ok(setups >= 5, `found only ${setups} pnpm/action-setup steps in agent workflows`);
});
