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
 * Lines with YAML comments dropped, so commented-out YAML neither satisfies nor
 * trips a guard — but not inside a block scalar (`run: |`, `script: |`), where
 * a line starting with `#` is part of the script. Dropping one there would
 * change what the guard reads: a quote closed on such a line would open
 * instead.
 */
function dropComments(lines) {
  const kept = [];
  let blockIndent = null; // indentation a line needs to stay inside the scalar
  for (const line of lines) {
    const indent = line.length - line.trimStart().length;
    if (blockIndent !== null && (line.trim() === "" || indent >= blockIndent)) {
      kept.push(line);
      continue;
    }
    blockIndent = null;
    if (line.trim().startsWith("#")) continue;
    kept.push(line);
    const block = /^(\s*)(- )?[\w-]+:\s*[|>][-+]?\s*$/.exec(line);
    if (block) blockIndent = block[1].length + (block[2] ? 2 : 0) + 1;
  }
  return kept;
}

/**
 * The entries of the `env:` mapping that sits at `indent` among `lines` (the
 * key may also open a step: `- env:`). A mapping it cannot read — a flow
 * mapping, a non-key line — comes back as one entry named `<unreadable>`, so an
 * allow-list of names refuses it.
 */
function envEntries(lines, indent) {
  const entries = [];
  const pad = " ".repeat(indent);
  for (let i = 0; i < lines.length; i++) {
    const head = new RegExp(`^(?:${pad}|${" ".repeat(Math.max(indent - 2, 0))}- )env:(.*)$`).exec(lines[i]);
    if (!head) continue;
    if (head[1].trim() !== "") entries.push({ key: "<unreadable>", value: head[1].trim() });
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (l.trim() === "") continue;
      const at = l.length - l.trimStart().length;
      if (at <= indent) break;
      if (at > indent + 2) continue; // the continuation of a value
      const kv = /^\s*([A-Za-z_][A-Za-z0-9_]*):(?:\s(.*))?$/.exec(l);
      entries.push(kv ? { key: kv[1], value: (kv[2] ?? "").trim() } : { key: "<unreadable>", value: l.trim() });
    }
  }
  return entries;
}

/** The value of a step's own `key:` (not one inside its `with:` or `env:`), block scalars folded. */
function stepValue(s, key) {
  const re = new RegExp(`^(?: {6}- | {8})${key}:(.*)$`);
  const at = s.findIndex((l) => re.test(l));
  if (at === -1) return null;
  const v = re.exec(s[at])[1].trim();
  if (!/^[>|][-+]?$/.test(v)) return v;
  const more = [];
  for (let i = at + 1; i < s.length && (s[i].trim() === "" || /^ {10}/.test(s[i])); i++) more.push(s[i].trim());
  return more.join(" ").trim();
}

/**
 * A workflow's text, read into what the guards need: its workflow-level `env:`
 * and `defaults:`, and its jobs — each with its header (the lines before
 * `steps:`) and its steps.
 */
function parseWorkflow(text, file) {
  const lines = dropComments(text.split("\n"));
  const jobsAt = lines.findIndex((l) => l === "jobs:");
  const top = jobsAt === -1 ? lines : lines.slice(0, jobsAt);
  const starts = jobsAt === -1 ? [] : lines.reduce((acc, l, i) => (i > jobsAt && /^ {2}[\w-]+:\s*$/.test(l) ? [...acc, i] : acc), []);
  return {
    file,
    env: envEntries(top, 0),
    defaults: top.some((l) => /^defaults:/.test(l)),
    jobs: starts.map((from, k) => {
      const body = lines.slice(from + 1, starts[k + 1] ?? lines.length);
      const stepsAt = body.findIndex((l) => /^ {4}steps:\s*$/.test(l));
      const header = stepsAt === -1 ? body : body.slice(0, stepsAt);
      const steps = [];
      for (const line of stepsAt === -1 ? [] : body.slice(stepsAt + 1)) {
        if (/^ {6}- /.test(line)) steps.push([line]);
        else if (steps.length > 0) steps.at(-1).push(line);
      }
      return {
        file,
        name: lines[from].trim().replace(/:$/, ""),
        env: envEntries(header, 4),
        defaults: header.some((l) => /^ {4}defaults:/.test(l)),
        steps: steps.map((s) => {
          const text = s.join("\n");
          const runAt = s.findIndex((l) => /^(?: {6}- | {8})run:/.test(l));
          return {
            lines: s,
            text,
            name: stepValue(s, "name") ?? "",
            id: stepValue(s, "id"),
            cond: stepValue(s, "if") ?? "",
            env: envEntries(s, 8),
            // The step's own `uses:` only: a line of a `run:` block that reads
            // `uses: …` must not turn the step into an action.
            usesLine: s.find((l) => /^(?: {6}- | {8})uses:/.test(l)) ?? null,
            uses: stepValue(s, "uses")?.split(/\s/)[0] || null,
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
    }),
  };
}

/** The jobs of a workflow file, each as its steps. */
const jobsOf = (file) => parseWorkflow(readFileSync(path.join(WORKFLOWS, file), "utf8"), file).jobs;

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
    assert.match(r.stderr, /^::error::The staged agent scripts are not what was staged/m, what);
    assert.equal(existsSync(tools), false, `${what}: the staged directory is still there for later steps to run`);
  }
});

/**
 * The simple commands of a shell script, for checking against an allow-list.
 * A small reading of POSIX shell: words with their quoting kept as written,
 * command substitutions `$( … )` read as scripts of their own, assignments,
 * redirections with their targets, and the separators and reserved words that
 * end or open a command. Whatever it does not read — a backtick, an arithmetic
 * expansion or command, ANSI-C or locale quoting, a parameter expansion other
 * than `${NAME}` / `${NAME:-literal}`, a comment inside a command
 * substitution, a GitHub expression in the script, a here-document, an
 * unterminated quote — is reported as a problem rather than guessed at.
 *
 * @returns {{ commands: { words: string[], assigns: string[], redirects: { op: string, target: string }[] }[], problems: string[] }}
 */
function shellCommands(script) {
  const problems = [];
  const subscripts = [];
  const tokens = []; // { word } | { op }
  let word = null;
  const end = () => {
    if (word !== null) tokens.push({ word });
    word = null;
  };
  const add = (text) => {
    word = (word ?? "") + text;
  };
  // `$'…'` reads `\'` as an escaped quote, so where it ends is not where a
  // plain single quote would; `$"…"` is translated through the locale. Both
  // are refused anywhere in the script, even where a quote makes them literal:
  // a refusal that was not needed costs a rewrite, a misreading costs the guard.
  if (script.includes("$'")) problems.push("ANSI-C quoting ($'…')");
  if (script.includes('$"')) problems.push('locale quoting ($"…")');
  // `${x@P}` runs command substitutions held in x, `${a[…]}` evaluates its
  // subscript as arithmetic (which runs them too), `${!x}` reads a name from x.
  // Only the two forms the workflows use are read.
  const PARAM = /^\$\{[A-Za-z_][A-Za-z0-9_]*(?::-[^$`'"\\{}]*)?\}/;
  const param = (i) => {
    const m = PARAM.exec(script.slice(i));
    if (m) return m[0].length;
    problems.push(`a parameter expansion this guard does not read (${script.slice(i, i + 16)})`);
    return 2;
  };
  /** From `$(` at `i`, the index just past the matching `)`. */
  const substitution = (i) => {
    let depth = 0;
    for (let j = i + 1; j < script.length; j++) {
      const c = script[j];
      if (c === "\\") j++;
      else if (c === "#") {
        // A comment in there runs to the end of its line, past any `)` this
        // scan would have stopped at.
        problems.push("a # inside a command substitution");
      } else if (c === "'") {
        j = script.indexOf("'", j + 1);
        if (j === -1) break;
      } else if (c === '"') {
        for (j++; j < script.length && script[j] !== '"'; j++) {
          if (script[j] === "\\") j++;
          else if (script[j] === "$" && script[j + 1] === "(") j = substitution(j) - 1;
        }
      } else if (c === "(") depth++;
      else if (c === ")" && --depth === 0) {
        subscripts.push(script.slice(i + 2, j));
        return j + 1;
      }
    }
    problems.push("an unterminated command substitution");
    return script.length;
  };
  for (let i = 0; i < script.length; ) {
    const c = script[i];
    const rest = script.slice(i);
    if (rest.startsWith("${{")) {
      problems.push("a GitHub expression inside the script");
      i += 3;
    } else if (rest.startsWith("$((") || c === "`") {
      problems.push(`an expansion this guard does not read (${rest.slice(0, 3)})`);
      i++;
    } else if (rest.startsWith("$[")) {
      problems.push("an arithmetic expansion ($[…])");
      i += 2;
    } else if (rest.startsWith("((")) {
      problems.push("an arithmetic command ((…))");
      i += 2;
    } else if (c === "$" && script[i + 1] === "{") {
      const n = param(i);
      add(script.slice(i, i + n));
      i += n;
    } else if (rest.startsWith("\\\n")) {
      i += 2;
    } else if (c === " " || c === "\t") {
      end();
      i++;
    } else if (c === "\n") {
      end();
      tokens.push({ op: "\n" });
      i++;
    } else if (c === "#" && word === null) {
      while (i < script.length && script[i] !== "\n") i++;
    } else if (c === "\\") {
      add(script.slice(i, i + 2));
      i += 2;
    } else if (c === "'") {
      const close = script.indexOf("'", i + 1);
      if (close === -1) {
        problems.push("an unterminated single quote");
        break;
      }
      add(script.slice(i, close + 1));
      i = close + 1;
    } else if (c === '"') {
      let j = i + 1;
      for (; j < script.length && script[j] !== '"'; j++) {
        if (script[j] === "\\") j++;
        else if (script[j] === "`") problems.push("a backtick inside double quotes");
        else if (script[j] === "$" && script[j + 1] === "{" && script[j + 2] === "{") problems.push("a GitHub expression inside the script");
        else if (script[j] === "$" && script[j + 1] === "{") j += param(j) - 1;
        else if (script[j] === "$" && script[j + 1] === "[") problems.push("an arithmetic expansion ($[…])");
        else if (script[j] === "$" && script[j + 1] === "(" && script[j + 2] === "(") problems.push("an arithmetic expansion");
        else if (script[j] === "$" && script[j + 1] === "(") j = substitution(j) - 1;
      }
      if (j >= script.length) {
        problems.push("an unterminated double quote");
        break;
      }
      add(script.slice(i, j + 1));
      i = j + 1;
    } else if (c === "$" && script[i + 1] === "(") {
      const j = substitution(i);
      add(script.slice(i, j));
      i = j;
    } else if (c === ">" || c === "<") {
      // An all-digit word just before is a file descriptor, part of the operator.
      if (word !== null && /^\d+$/.test(word)) word = null;
      end();
      const op = /^(>>|>&|>\||<<-?|<&|<>|>|<)/.exec(rest)[1];
      if (op.startsWith("<<")) problems.push("a here-document");
      tokens.push({ op, redirect: true });
      i += op.length;
    } else if (/^(&&|\|\||;;|[;&|()])/.test(rest)) {
      end();
      const op = /^(&&|\|\||;;|[;&|()])/.exec(rest)[1];
      if (op === "&" && script[i + 1] === ">") problems.push("an &> redirection");
      tokens.push({ op });
      i += op.length;
    } else {
      add(c);
      i++;
    }
  }
  end();

  const commands = [];
  let current = { words: [], assigns: [], redirects: [] };
  const finish = () => {
    if (current.words.length > 0 || current.assigns.length > 0 || current.redirects.length > 0) commands.push(current);
    current = { words: [], assigns: [], redirects: [] };
  };
  const RESERVED = new Set(["if", "then", "else", "elif", "fi", "!"]);
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.redirect) {
      const target = tokens[k + 1];
      if (!target || target.word === undefined) {
        problems.push(`a ${t.op} redirection with no target`);
        continue;
      }
      current.redirects.push({ op: t.op, target: target.word });
      k++;
    } else if (t.op !== undefined) {
      finish();
    } else if (current.words.length === 0 && (t.word === "{" || t.word === "}")) {
      finish();
    } else if (current.words.length === 0 && RESERVED.has(t.word)) {
      // Opens or closes a compound command; what follows is a command.
    } else if (current.words.length === 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(t.word)) {
      // An assignment, alone or before the command; kept for the caller to
      // judge, and its substitutions are read below.
      current.assigns.push(t.word);
    } else {
      current.words.push(t.word);
    }
  }
  finish();
  for (const sub of subscripts) {
    const inner = shellCommands(sub);
    commands.push(...inner.commands);
    problems.push(...inner.problems);
  }
  return { commands, problems };
}

test("shellCommands reads the commands a script runs, and says what it cannot read", () => {
  const read = (script) => shellCommands(script);
  const words = (script) => read(script).commands.filter((c) => c.words.length > 0).map((c) => c.words.join(" "));
  assert.deepEqual(words('A="$(git rev-parse HEAD)"\nif [ "$A" != x ]; then\n  echo "y $(date -u)"\n  exit 1\nfi'), ["[ \"$A\" != x ]", "echo \"y $(date -u)\"", "exit 1", "git rev-parse HEAD", "date -u"]);
  assert.deepEqual(read('A="$(git rev-parse HEAD)"').commands[0].assigns, ['A="$(git rev-parse HEAD)"']);
  assert.deepEqual(read('N=1 node x').commands[0], { words: ["node", "x"], assigns: ["N=1"], redirects: [] });
  assert.deepEqual(words('[ -f "$F" ] || {\n  echo no\n  exit 0\n}\nnode "$F"'), ['[ -f "$F" ]', "echo no", "exit 0", 'node "$F"']);
  assert.deepEqual(read('{\n  printf x\n} > "$RUNNER_TEMP/a.md"').commands.at(-1).redirects, [{ op: ">", target: '"$RUNNER_TEMP/a.md"' }]);
  assert.deepEqual(read('echo "a" >&2 2>/dev/null').commands[0].redirects, [{ op: ">&", target: "2" }, { op: ">", target: "/dev/null" }]);
  assert.deepEqual(words("printf '%s' 'it'\"'\"'s' | cut -f1"), ["printf '%s' 'it'\"'\"'s'", "cut -f1"]);
  assert.deepEqual(words('echo "$(git ls-remote o "r/$B" | cut -f1)"'), ['echo "$(git ls-remote o "r/$B" | cut -f1)"', 'git ls-remote o "r/$B"', "cut -f1"]);
  assert.deepEqual(read('echo "${A:-x y}" ${B}').problems, []);
  for (const bad of [
    "echo `id`",
    "echo $((1+1))",
    "echo ${{ github.ref }}",
    'echo "a',
    "echo 'a",
    "cat <<EOF\nx\nEOF",
    "echo $(id",
    "echo $'\\'' ; cp a b #'",
    'echo $"x"',
    'echo "${x@P}"',
    "echo ${x@P}",
    'echo "${a[$(id)]}"',
    "echo ${!x}",
    "echo ${x:=y}",
    "echo $[1+1]",
    "((x = 1))",
    'echo "$(# )\ncp a b\n)"',
  ]) {
    assert.ok(read(bad).problems.length > 0, `read without a problem: ${bad}`);
  }
});

/**
 * What a `github-script` step's code does that this guard does not allow. A
 * small tokenizer and a few rules over its tokens: every call is one of the
 * calls the workflows make today, every read of `github`, `core`, `context`
 * and `process` is one they make today, and nothing reaches past those — no
 * bracket access but `[<integer>]`, no `constructor`, `Function`, `eval`,
 * `require`, `import`, no tagged template, no assignment but a `const`/`let`
 * declaration's own. What the tokenizer cannot read is a problem.
 *
 * @returns {string[]}
 */
function githubScriptProblems(code) {
  const problems = [];
  const toks = []; // { t: "id"|"num"|"str"|"p"|"tmpl"|"tmplend"|"tmplopen"|"tmplclose", v, line }
  let line = 1;
  const push = (t, v) => toks.push({ t, v, line });
  const KEYWORDS = new Set(["const", "let", "if", "else", "return", "await", "async", "try", "catch", "true", "false", "null"]);
  const PUNCT = ["===", "!==", "**=", "...", "&&=", "||=", "??=", ">>>", "=>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "++", "--", "+=", "-=", "*=", "%=", "**", "<<", ">>", "{", "}", "(", ")", "[", "]", ";", ",", ".", ":", "?", "=", "<", ">", "!", "+", "-", "*", "%"];
  // GitHub substitutes these into the code before it runs, so the code that
  // runs is not the code read here.
  if (code.includes("${{")) problems.push("a GitHub expression inside the script");
  const valueEnd = (t) => t && ((t.t === "id" && !KEYWORDS.has(t.v)) || t.t === "num" || t.t === "str" || t.t === "tmplend" || t.v === ")" || t.v === "]");

  function lex(i, inTemplate) {
    let depth = 0;
    while (i < code.length) {
      const c = code[i];
      const rest = code.slice(i, i + 4);
      if (c === "\n") {
        line++;
        i++;
      } else if (c === " " || c === "\t" || c === "\r") {
        i++;
      } else if (rest.startsWith("${{")) {
        problems.push("a GitHub expression inside the script");
        i += 3;
      } else if (rest.startsWith("//")) {
        while (i < code.length && code[i] !== "\n") i++;
      } else if (rest.startsWith("/*")) {
        const e = code.indexOf("*/", i + 2);
        if (e === -1) {
          problems.push("an unterminated comment");
          return code.length;
        }
        line += (code.slice(i, e).match(/\n/g) ?? []).length;
        i = e + 2;
      } else if (c === "'" || c === '"') {
        let j = i + 1;
        for (; j < code.length && code[j] !== c && code[j] !== "\n"; j++) if (code[j] === "\\") j++;
        if (code[j] !== c) {
          problems.push("an unterminated string");
          return code.length;
        }
        push("str", code.slice(i, j + 1));
        i = j + 1;
      } else if (c === "`") {
        if (valueEnd(toks.at(-1))) problems.push(`a tagged template (${toks.at(-1).v ?? toks.at(-1).t}\`…\`)`);
        push("tmpl");
        i = template(i + 1);
        push("tmplend");
      } else if (/[A-Za-z_]/.test(c)) {
        const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(code.slice(i))[0];
        push("id", m);
        i += m.length;
      } else if (/[0-9]/.test(c)) {
        const m = /^[0-9]+(?:\.[0-9]+)?(?![A-Za-z0-9_$])/.exec(code.slice(i));
        if (!m) {
          problems.push("a number this guard does not read");
          return code.length;
        }
        push("num", m[0]);
        i += m[0].length;
      } else {
        const p = PUNCT.find((q) => code.startsWith(q, i));
        if (!p) {
          problems.push(`a character this guard does not read (${JSON.stringify(c)})`);
          return code.length;
        }
        if (p === "{") depth++;
        if (p === "}") {
          if (depth === 0 && inTemplate) return i + 1;
          depth--;
        }
        push("p", p);
        i += p.length;
      }
    }
    if (inTemplate) problems.push("an unterminated template expression");
    return i;
  }
  function template(i) {
    for (; i < code.length; i++) {
      const c = code[i];
      if (c === "\\") {
        if (code[i + 1] === "\n") line++;
        i++;
      } else if (c === "\n") line++;
      else if (c === "`") return i + 1;
      else if (c === "$" && code[i + 1] === "{") {
        if (code[i + 2] === "{") problems.push("a GitHub expression inside the script");
        push("tmplopen");
        i = lex(i + 2, true) - 1;
        push("tmplclose");
      }
    }
    problems.push("an unterminated template literal");
    return code.length;
  }
  lex(0, false);
  if (problems.length > 0) return problems;

  // Names that reach past what a step should touch, wherever they appear —
  // as a name, a property or a key.
  const FORBIDDEN = new Set(["constructor", "prototype", "__proto__", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__", "Function", "eval", "require", "import", "export", "globalThis", "global", "window", "self", "module", "exports", "this", "new", "with", "function", "class", "var", "delete", "arguments", "Reflect", "Proxy", "call", "apply", "bind", "mainModule", "binding", "dlopen", "addPath", "exportVariable"]);
  // The calls and reads the workflows make in this stretch today.
  const API_CALLS = new Set(["github.rest.pulls.list", "github.rest.issues.createComment", "github.paginate", "core.setOutput", "core.info", "core.warning", "core.summary.addRaw"]);
  const API_READS = new Set(["context.repo.owner", "context.repo.repo", "context.serverUrl", "context.runId", "github.rest.actions.listWorkflowRuns", "github.rest.issues.listComments"]);
  const apiRead = (p) => API_READS.has(p) || /^context\.payload(\.[A-Za-z_]\w*)+$/.test(p) || /^process\.env\.[A-Z][A-Z0-9_]*$/.test(p);
  const API_ROOTS = new Set(["github", "core", "context", "process"]);
  const GLOBAL_CALLS = new Set(["String", "parseInt"]);
  const VALUE_METHODS = new Set(["filter", "some", "includes"]);
  const OPEN = new Set(["(", "[", "{"]);
  const CLOSE = new Set([")", "]", "}"]);
  const isOpen = (t) => (t.t === "p" && OPEN.has(t.v)) || t.t === "tmplopen";
  const isClose = (t) => (t.t === "p" && CLOSE.has(t.v)) || t.t === "tmplclose";
  const matching = (k) => {
    for (let d = 0, j = k; j < toks.length; j++) {
      if (isOpen(toks[j])) d++;
      else if (isClose(toks[j]) && --d === 0) return j;
    }
    return toks.length;
  };

  // Pass 1: the names the script declares, and which of them are functions.
  const declared = new Set();
  const declaredAt = new Set(); // token indices of declared names
  const arrows = new Set();
  const declare = (k, why) => {
    const t = toks[k];
    if (t?.t !== "id" || KEYWORDS.has(t.v)) {
      problems.push(`${why} this guard does not read`);
      return;
    }
    if (API_ROOTS.has(t.v) || GLOBAL_CALLS.has(t.v)) problems.push(`declares ${t.v}, a name this guard reads as the runtime's own`);
    declared.add(t.v);
    declaredAt.add(k);
  };
  const arrowAfter = (k) => {
    // `= async? (…) =>` or `= async? x =>` from token k (the `=`).
    let j = k + 1;
    if (toks[j]?.v === "async") j++;
    if (toks[j]?.t === "id" && toks[j + 1]?.v === "=>") return true;
    return toks[j]?.v === "(" && toks[matching(j) + 1]?.v === "=>";
  };
  let decl = null;
  let depth = 0;
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (decl && depth === decl.depth && (t.v === ";" || t.line > toks[k - 1].line)) decl = null;
    if (t.t === "id" && (t.v === "const" || t.v === "let")) {
      declare(k + 1, "a declaration");
      decl = { depth };
      if (toks[k + 2]?.v === "=" && arrowAfter(k + 2)) arrows.add(toks[k + 1].v);
    } else if (decl && depth === decl.depth && t.v === ",") {
      declare(k + 1, "a declaration");
      if (toks[k + 2]?.v === "=" && arrowAfter(k + 2)) arrows.add(toks[k + 1].v);
    } else if (t.v === "=>") {
      if (toks[k - 1]?.t === "id") declare(k - 1, "an arrow parameter");
      else if (toks[k - 1]?.v === ")") {
        let j = k - 2;
        while (j >= 0 && toks[j].v !== "(") {
          if (toks[j].t === "id") declare(j, "an arrow parameter");
          else if (toks[j].v !== ",") problems.push("arrow parameters this guard does not read");
          j--;
        }
      } else problems.push("arrow parameters this guard does not read");
    } else if (t.v === "catch" && toks[k + 1]?.v === "(") {
      declare(k + 2, "a catch parameter");
    }
    if (isOpen(t)) depth++;
    else if (isClose(t)) depth--;
  }

  // Pass 2: every name, call, access and assignment against the lists.
  const writeOk = new Set(); // `.write` right after `core.summary.addRaw(…)`
  const stack = [];
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    const prev = toks[k - 1];
    const next = toks[k + 1];
    if (isOpen(t)) stack.push(t.v ?? t.t);
    else if (isClose(t)) stack.pop();
    if (t.t === "p") {
      if (["?.", "...", "++", "--", "+=", "-=", "*=", "%=", "**", "**=", "&&=", "||=", "??=", "<<", ">>", ">>>"].includes(t.v)) problems.push(`the operator ${t.v}`);
      if (t.v === "=" && !declaredAt.has(k - 1)) problems.push(`an assignment to ${prev?.v ?? prev?.t} outside a declaration`);
      if (t.v === "[" && valueEnd(prev) && !(next?.t === "num" && /^\d+$/.test(next.v) && toks[k + 2]?.v === "]")) problems.push(`a bracket access (${prev.v ?? prev.t}[…])`);
      continue;
    }
    if (t.t !== "id") continue;
    if (FORBIDDEN.has(t.v)) {
      problems.push(`the name ${t.v}`);
      continue;
    }
    if (KEYWORDS.has(t.v)) continue;
    if (prev?.v === ".") {
      // A property of a value. API chains are consumed whole below, so what is
      // left is a property of something the script itself holds.
      if (next?.v === "(" && !VALUE_METHODS.has(t.v) && !writeOk.has(k)) problems.push(`a call of .${t.v}()`);
      continue;
    }
    if ((prev?.v === "{" || prev?.v === ",") && next?.v === ":" && stack.at(-1) === "{") continue; // an object key
    if (declaredAt.has(k)) continue;
    if (API_ROOTS.has(t.v)) {
      let j = k;
      const chain = [t.v];
      while (toks[j + 1]?.v === "." && toks[j + 2]?.t === "id") {
        chain.push(toks[j + 2].v);
        j += 2;
      }
      const p = chain.join(".");
      for (const name of chain) if (FORBIDDEN.has(name)) problems.push(`the name ${name}`);
      if (toks[j + 1]?.v === "(") {
        if (!API_CALLS.has(p)) problems.push(`a call of ${p}(), which is not one of the calls this stretch makes`);
        else if (p === "core.summary.addRaw") {
          const close = matching(j + 1);
          if (toks[close + 1]?.v === "." && toks[close + 2]?.v === "write" && toks[close + 3]?.v === "(") writeOk.add(close + 2);
        }
      } else if (!apiRead(p)) problems.push(`a use of ${p}, which is not one of the reads this stretch makes`);
      k = j;
      continue;
    }
    if (GLOBAL_CALLS.has(t.v)) {
      if (next?.v !== "(") problems.push(`a use of ${t.v} other than a call`);
      continue;
    }
    if (!declared.has(t.v)) problems.push(`the name ${t.v}, which the script does not declare`);
    else if (next?.v === "(" && !arrows.has(t.v)) problems.push(`a call of ${t.v}, which the script does not define as a function`);
  }
  return problems;
}

test("githubScriptProblems reads today's github-script code and refuses what reaches past it", () => {
  const ok = [
    "const owner = context.repo.owner, repo = context.repo.repo;\nconst prs = await github.rest.pulls.list({ owner, repo, head: `${owner}:x` });\nconst pr = prs.data[0];\nif (!pr) { core.setOutput('proceed', 'false'); return; }",
    "const max = parseInt(process.env.MAX_ATTEMPTS, 10);\nconst runs = await github.paginate(github.rest.actions.listWorkflowRuns, { owner: 1, per_page: 100 });\nconst n = runs.filter(r => r.conclusion === 'failure').length;",
    "const s = async (md) => {\n  try { await core.summary.addRaw(md).write(); }\n  catch (e) { core.warning(`failed: ${e.message}`); }\n};\nawait s('x');",
    "const L = ['a[bot]'];\nconst f = (c) => {\n  const user = (c || {}).user || {};\n  return L.includes(user.login) || String((c || {}).body ?? '').includes('x');\n};",
  ];
  for (const code of ok) assert.deepEqual(githubScriptProblems(code), [], code);
  for (const bad of [
    "core.addPath('/x');",
    "core.exportVariable('BASH_ENV', '/x');",
    "core.setSecret('x');",
    "const P = [].constructor.constructor('return pro'+'cess')();",
    "core['addPath']('x');",
    "const c = core; c.info('x');",
    "const f = core.info; f('x');",
    "process.env.PATH = '/x';",
    "const x = process;",
    "process.chdir('/');",
    "eval('1');",
    "require('fs');",
    "await import('fs');",
    "new Function('x')();",
    "globalThis.x = 1;",
    "x = 1;",
    "const a = 1;\na = 2;",
    "String.raw`x`;",
    "const t = (s) => s; t`x`;",
    "core.info('${{ github.workspace }}');",
    "const o = {}; o.x = 1;",
    "const a = [1]; a[0] = 2;",
    "const a = [1]; a?.[0];",
    "const s = 'x'; s.replace(/x/, 'y');",
    "const s = 'x'; s.at(0);",
    "github.request('GET /');",
    "context.repo.owner();",
  ]) {
    assert.ok(githubScriptProblems(bad).length > 0, `read without a problem: ${bad}`);
  }
});

// ---------------------------------------------------------------------------
// From the branch checkout to the agent. Every trusted step in that stretch
// runs with the branch's tree in the workspace, so whatever it writes there,
// runs from there, or lets steer the steps after it, follows that tree.

const VERIFY = "Verify the staged agent scripts are unchanged";
const FIRST_COND = "always() && steps.tools.outputs.digest != ''";
const LATER_COND = "steps.tools.outputs.digest != ''";
const DIGEST = "{ find . -print | LC_ALL=C sort; find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum; } | sha256sum | cut -d' ' -f1";
// The record and verify steps, pinned to their text: they run `cd`, `find`,
// `sort`, `xargs` and `rm`, which nothing else here may, and the digest test
// above runs exactly this text.
const RECORD_SCRIPT = ['cd "$RUNNER_TEMP/agent-tools"', `digest="$(${DIGEST})"`, 'echo "digest=$digest" >> "$GITHUB_OUTPUT"'].join("\n");
const VERIFY_SCRIPT = [
  'cd "$RUNNER_TEMP/agent-tools"',
  `actual="$(${DIGEST})"`,
  'if [ "$actual" != "$EXPECTED" ]; then',
  '  cd "$RUNNER_TEMP"',
  '  rm -rf "$RUNNER_TEMP/agent-tools"',
  '  echo "::error::The staged agent scripts are not what was staged. They were removed; no later step of this job runs them." >&2',
  "  exit 1",
  "fi",
].join("\n");
const STAGED = /^"\$RUNNER_TEMP\/agent-tools\/[a-z][a-z0-9-]*\.mjs"$/;
const STEP_KEYS = new Set(["name", "id", "if", "env", "run", "uses", "with", "continue-on-error", "working-directory", "timeout-minutes"]);
// The `env:` names these jobs use today, by level. Anything else is refused,
// and these never: each steers how a later command is found or what it loads.
const STEP_ENV = new Set(["GH_TOKEN", "PR", "BRANCH", "EXPECTED", "CAPACITY", "CRED_REASON", "RUN_URL", "DISPATCH_FILE", "ATTEMPTS", "MAX", "CLAUDE_CODE_OAUTH_TOKEN", ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `CLAUDE_CODE_OAUTH_TOKEN_${n}`)]);
const JOB_ENV = new Set(["WAFFLEBASE_AGENT_AUTONOMOUS"]);
const WORKFLOW_ENV = new Set(["GH_REPO", "MAX_REVIEW_ROUNDS", "MAX_ATTEMPTS"]);
const NEVER_SET = /^(PATH|BASH_ENV|ENV|HOME|IFS|CDPATH|SHELLOPTS|BASHOPTS|PS4|NODE_\w*|RUNNER_\w*|GITHUB_\w*|ACTIONS_\w*|LD_\w*|DYLD_\w*|GIT_\w*|npm_config_\w*|NPM_CONFIG_\w*|PNPM_\w*)$/;
// The shell variables the stretch's scripts assign today, outside the pinned
// record and verify steps. Bare assignments only; never as a command prefix.
const SHELL_LOCALS = new Set(["ACTUAL", "DIAG"]);
/** A `$RUNNER_TEMP/<name>` the job writes: a plain name, directly under it. */
const TEMP_FILE = /^"\$RUNNER_TEMP\/([\w-][\w.-]*)"$/;
const STATUS_FN = /\b(always|failure|cancelled|success)\s*\(/;
/** A plain condition: `steps.<x>.outputs.<y> ==/!= '<literal>'`, joined by `&&`, on neither the record nor the install. */
const PLAIN_COND = /^steps\.(?!tools\.|install\.)[\w-]+\.outputs\.[\w-]+ (==|!=) '[\w-]*'( && steps\.(?!tools\.|install\.)[\w-]+\.outputs\.[\w-]+ (==|!=) '[\w-]*')*$/;

/** The word with its quotes removed, or null when it expands anything. */
const literalOf = (w) => (/[$`\\]/.test(w.replace(/'[^']*'/g, "")) ? null : w.replace(/'([^']*)'|"([^"]*)"/g, (_, a, b) => a ?? b));
const singleQuotedRuns = (w) => /'[^']*(\$\(|`)[^']*'/.test(w);

/**
 * What each allowed command may be given. Each returns why its words are
 * refused, or null. `ctx` carries what the step has written so far and its env.
 */
const ARGUMENTS = {
  echo: () => null,
  true: (w) => (w.length > 1 ? "takes no arguments" : null),
  exit: (w) => (w.length > 2 || (w[1] !== undefined && !/^\d+$/.test(w[1])) ? "takes one literal status" : null),
  // printf has one option, -v, which assigns — and an array subscript in its
  // name is evaluated as arithmetic, which runs any `$( … )` in it. The format
  // must be a literal that is not an option. (Its integer conversions do not
  // evaluate arithmetic: checked against bash 5.2.)
  printf: (w) => {
    const fmt = w[1] === undefined ? null : literalOf(w[1]);
    if (fmt === null) return "takes a literal format first";
    if (fmt.startsWith("-")) return `takes no option (${w[1]})`;
    return null;
  },
  // `test -v` / `[ -v` evaluate an array subscript as arithmetic, and `-R`
  // reads a name the same way. Only the shapes used here, with the operator
  // written literally — `[ "$X" "$Y" ]` makes $X the operator, and an
  // operator that comes from a variable can be -v.
  test: (w) => testShape(w.slice(1)),
  "[": (w) => (w.at(-1) !== "]" ? "has no closing ]" : testShape(w.slice(1, -1))),
  // Standard input only: a file operand is a file read.
  cut: (w) => {
    for (const a of w.slice(1)) if (!/^-f[0-9,-]+$/.test(a) && !/^-d(.|'.'|".")$/.test(a)) return `the operand ${a}: cut reads standard input only`;
    return null;
  },
  date: (w) => {
    for (const a of w.slice(1)) {
      const v = literalOf(a);
      if (v !== "-u" && !(v !== null && v.startsWith("+"))) return `the operand ${a}: date takes -u and a +format only`;
    }
    return null;
  },
  // `rev-parse <ref>` and `ls-remote <origin|github.com URL> <pattern>`, with
  // no option: `--upload-pack`, `-u`, `--exec`, `-c` and `--config` each run a
  // program, and a remote that is a local path runs one by itself.
  git: (w) => {
    const sub = w[1];
    if (sub === "rev-parse") {
      if (w.length < 3) return "rev-parse takes a ref";
      for (const a of w.slice(2)) if (!/^[A-Za-z0-9_][A-Za-z0-9_./^~@-]*$/.test(a)) return `the rev-parse argument ${a}`;
      return null;
    }
    if (sub === "ls-remote") {
      const remote = w[2];
      if (remote !== "origin" && !/^(["']?)https:\/\/github\.com\/[\w.-]+\/[\w.-]+\1$/.test(remote ?? "")) return `the remote ${remote}: only origin or a github.com URL`;
      for (const a of w.slice(3)) if (!/^"?[A-Za-z0-9_/]/.test(a)) return `the ls-remote argument ${a}: patterns start with a literal`;
      return null;
    }
    return `the subcommand ${sub}: only rev-parse and ls-remote`;
  },
  // One pull request, and a body — or a body file this job wrote itself,
  // directly under $RUNNER_TEMP: in this step, before this command, or in a
  // step before the branch was checked out. Any other file is one gh would
  // publish, whatever it holds.
  gh: (w, ctx) => {
    if (w[1] !== "pr" || w[2] !== "comment") return "only gh pr comment";
    let prs = 0;
    for (let k = 3; k < w.length; k++) {
      const a = w[k];
      if (a === "--body") {
        if (w[++k] === undefined) return "--body has no value";
      } else if (a === "--body-file" || a === "-F") {
        const why = ctx.bodyFile(w[++k]);
        if (why) return why;
      } else if (/^"\$[A-Z_]+"$/.test(a) || /^\d+$/.test(a)) {
        if (++prs > 1) return "names more than one pull request";
      } else return `the argument ${a}`;
    }
    return prs === 1 ? null : "names no pull request";
  },
  node: (w) => (STAGED.test(w[1] ?? "") ? null : `runs ${w[1]}, which is not a staged script`),
};
function testShape(args) {
  for (const a of args) {
    const v = literalOf(a);
    if (v === "-v" || v === "-R") return `the operator ${a}, which evaluates an array subscript`;
    if (singleQuotedRuns(a)) return `the operand ${a}, which holds a substitution`;
  }
  const op = (a, ok) => ok.includes(a);
  if (args.length === 1) return null;
  if (args.length === 2 && op(args[0], ["-f", "-s", "-n", "-z", "-d", "-e"])) return null;
  if (args.length === 3 && op(args[1], ["=", "!="])) return null;
  return `the test ${args.join(" ")}: only a literal -f/-s/-n/-z/-d/-e or =/!=`;
}

const REDIRECT_OK = (r) =>
  (r.op === ">&" && (r.target === "1" || r.target === "2")) ||
  ((r.op === ">" || r.op === ">>") && (['"$GITHUB_OUTPUT"', '"$GITHUB_STEP_SUMMARY"', "/dev/null"].includes(r.target) || TEMP_FILE.test(r.target)));

/** A step's own keys, as written (`- key:` or two levels in). */
const keysOf = (s) => s.lines.filter((l) => /^ {6}- |^ {8}\S/.test(l)).map((l) => /^(?: {6}- | {8})([\w-]+):/.exec(l)?.[1] ?? `<unreadable: ${l.trim()}>`);
/** The keys of a step's `with:`, and the block under `script: |`. */
function withOf(s) {
  const at = s.lines.findIndex((l) => /^ {8}with:\s*$/.test(l));
  if (at === -1) return { keys: [], lines: [], script: null };
  const block = [];
  for (const l of s.lines.slice(at + 1)) {
    if (l.trim() !== "" && !/^ {10}/.test(l)) break;
    block.push(l);
  }
  const keys = block.filter((l) => /^ {10}\S/.test(l)).map((l) => /^ {10}([\w-]+):/.exec(l)?.[1] ?? `<unreadable: ${l.trim()}>`);
  const scriptAt = block.findIndex((l) => /^ {10}script:/.test(l));
  let script = null;
  if (scriptAt !== -1) {
    if (/^ {10}script:\s*\|\s*$/.test(block[scriptAt])) {
      const body = [];
      for (const l of block.slice(scriptAt + 1)) {
        if (l.trim() !== "" && !/^ {12}/.test(l)) break;
        body.push(l.replace(/^ {12}/, ""));
      }
      script = body.join("\n");
    } else script = false;
  }
  return { keys, lines: block.filter((l) => /^ {10}\S/.test(l)).map((l) => l.trim()), script };
}

/**
 * Every way the trusted steps from the branch checkout to the agent leave the
 * allow-list, each tagged with the rule it breaks.
 *
 * @returns {{ problems: { rule: string, step: string, message: string }[], usesBefore: number, usesAfter: number }}
 */
function stretchProblems(wf, jobName) {
  const problems = [];
  const label = (s) => (s ? s.name || s.uses || s.id || "(unnamed)" : "(job)");
  const problem = (rule, s, message) => problems.push({ rule, step: label(s), message });
  const job = wf.jobs.find((j) => j.name === jobName);
  if (!job) return { problems: [{ rule: "shape", step: "(job)", message: `${wf.file} has no job ${jobName}` }], usesBefore: 0, usesAfter: 0 };
  const { steps } = job;
  const branchAt = steps.findIndex((s) => s.checksOutBranch);
  const installAt = steps.findIndex((s) => s.id === "install");
  const agentAt = steps.findIndex((s) => s.uses?.startsWith(AGENT_ACTION));
  if (!(branchAt >= 0 && installAt > branchAt && agentAt > installAt)) {
    problem("shape", null, "no branch checkout, then an install, then the agent");
    return { problems, usesBefore: 0, usesAfter: 0 };
  }

  // What every step of the job inherits.
  if (wf.defaults) problem("defaults", null, "the workflow sets defaults:, which changes how every run: step is run");
  if (job.defaults) problem("defaults", null, "the job sets defaults:, which changes how every run: step is run");
  const envKey = (level, allowed, s) => ({ key }) => {
    if (NEVER_SET.test(key)) problem("env-key", s, `${level} env: sets ${key}, which steers how later commands are found or what they load`);
    else if (!allowed.has(key)) problem("env-key", s, `${level} env: sets ${key}, which is not one of the names this stretch uses (${[...allowed].join(", ")})`);
  };
  wf.env.forEach(envKey("workflow", WORKFLOW_ENV, null));
  job.env.forEach(envKey("job", JOB_ENV, null));

  // A staged script used after the install runs only when its check ran, or
  // when the install never did. The record and the install share one plain
  // condition, so "the record was skipped" is "the install was skipped"; a
  // use carries no status function, so it inherits success() and cannot run
  // past a check that failed — and when that check was skipped for want of a
  // digest, so was the install.
  const record = steps[installAt - 1];
  if (record?.id !== "tools" || record.cond !== steps[installAt].cond || !PLAIN_COND.test(record.cond)) {
    problem("staged-use-condition", record, `the record (${record?.cond}) and the install (${steps[installAt].cond}) must share one plain condition on earlier steps' outputs`);
  }
  const first = steps[installAt + 1];
  if (first?.name !== VERIFY || first.cond !== FIRST_COND) problem("check-after-install", first, `the step after the install must be the check, under ${FIRST_COND}`);

  // Files named under $RUNNER_TEMP by a step before the branch was checked out.
  const tempBeforeBranch = new Set();
  for (const s of steps.slice(0, branchAt)) {
    for (const { value } of s.env) {
      const m = /^\$\{\{ runner\.temp \}\}\/([\w-][\w.-]*)$/.exec(value);
      if (m) tempBeforeBranch.add(m[1]);
    }
  }

  let usesBefore = 0;
  let usesAfter = 0;
  for (let i = branchAt + 1; i < agentAt; i++) {
    const s = steps[i];
    const keys = keysOf(s);
    const keyProblem = (allowed) => {
      for (const k of keys) if (!allowed.includes(k)) problem(STEP_KEYS.has(k) ? "pinned-step" : "step-keys", s, `has the key ${k}`);
    };
    if (i === installAt) {
      // Its command is held to its exact text by its own test; a `shell:`,
      // `working-directory:` or `continue-on-error:` would change what that
      // text does.
      keyProblem(["name", "id", "if", "run"]);
      continue;
    }
    for (const e of s.env) envKey("step", STEP_ENV, s)(e);

    // The steps pinned to their text: the side-directory checkout of main and
    // its staging, the record and every check.
    const script = s.script?.trimEnd() ?? null;
    const clear = /^rm -rf (\.trusted-[\w-]+)$/.exec(script ?? "");
    const stage = /^cp -R (\.trusted-[\w-]+)\/scripts\/agent "\$\{\{ runner\.temp \}\}\/agent-tools"\nrm -rf (\.trusted-[\w-]+)$/.exec(script ?? "");
    if (clear || (stage && stage[1] === stage[2])) {
      keyProblem(["name", "run"]);
      continue;
    }
    if (/^cp |agent-tools"?\s*$/m.test(script ?? "") && /\.trusted-/.test(script ?? "")) {
      problem("pinned-step", s, "stages the agent scripts with something other than the copy and the removal");
      continue;
    }
    if (s.uses?.startsWith("actions/checkout@")) {
      const w = withOf(s);
      const dir = w.lines.find((l) => /^path: \.trusted-[\w-]+$/.test(l))?.slice(6);
      const want = ["ref: main", `path: ${dir}`, "sparse-checkout: scripts/agent", "sparse-checkout-cone-mode: false", "persist-credentials: false"];
      if (!dir || [...w.lines].sort().join("\n") !== [...want].sort().join("\n")) problem("pinned-step", s, `checks out something other than main's scripts/agent into a .trusted-* directory: ${w.lines.join("; ")}`);
      keyProblem(["name", "uses", "with"]);
      continue;
    }
    if (s.id === "tools") {
      if (script !== RECORD_SCRIPT) problem("pinned-step", s, "the record step is not the pinned script");
      keyProblem(["name", "id", "if", "run"]);
      continue;
    }
    if (s.name === VERIFY) {
      if (script !== VERIFY_SCRIPT) problem("pinned-step", s, "the check is not the pinned script");
      if (s.env.length !== 1 || s.env[0].key !== "EXPECTED" || s.env[0].value !== "${{ steps.tools.outputs.digest }}") problem("pinned-step", s, "the check is handed something other than EXPECTED: ${{ steps.tools.outputs.digest }}");
      if (i > installAt + 1 && s.cond !== LATER_COND) problem("pinned-step", s, `a later check runs under ${s.cond}, not ${LATER_COND}`);
      keyProblem(["name", "if", "env", "run"]);
      continue;
    }

    for (const k of keys) if (!STEP_KEYS.has(k)) problem("step-keys", s, `has a key this guard does not read: ${k}`);
    const wd = stepValue(s.lines, "working-directory");
    if (wd !== null && wd !== "${{ runner.temp }}") problem("working-directory", s, `runs in ${wd}, not the runner's temp directory`);

    if (s.uses && s.isRun) problem("shape", s, "both runs a script and uses an action");
    if (s.uses) {
      const w = withOf(s);
      if (s.uses.startsWith("actions/download-artifact@")) {
        if (!/^ {10}path: \$\{\{ runner\.temp \}\}\/[\w-]+\/?\s*$/m.test(s.text) || w.keys.filter((k) => k === "path").length !== 1) problem("download-path", s, "downloads somewhere other than one directory in the runner's temp directory");
        for (const k of w.keys) if (!["name", "path", "run-id", "github-token"].includes(k)) problem("action", s, `download-artifact is given ${k}`);
      } else if (s.uses.startsWith("actions/github-script@")) {
        for (const k of w.keys) if (!["retries", "script"].includes(k)) problem("github-script", s, `github-script is given ${k}`);
        if (typeof w.script !== "string") problem("github-script", s, "the script is not a literal block (script: |)");
        else for (const p of githubScriptProblems(w.script)) problem("github-script", s, p);
      } else {
        problem("action", s, `${s.uses} is not an action this guard knows to stay out of the workspace`);
      }
      if (/agent-tool/.test(s.text)) problem("staged-name", s, "names the staged scripts");
      continue;
    }
    if (!s.isRun) {
      problem("shape", s, "neither runs a script nor uses an action");
      continue;
    }

    const read = shellCommands(s.script);
    for (const p of read.problems) problem("shell-unreadable", s, p);
    const written = new Set();
    const ctx = {
      bodyFile: (target) => {
        if (target === undefined) return "--body-file has no value";
        const direct = TEMP_FILE.exec(target);
        if (direct) return written.has(direct[1]) ? null : `--body-file ${target}, which this step has not written`;
        const viaEnv = /^"\$([A-Z_]+)"$/.exec(target);
        const value = viaEnv && s.env.find((e) => e.key === viaEnv[1])?.value;
        const name = value && /^\$\{\{ runner\.temp \}\}\/([\w-][\w.-]*)$/.exec(value)?.[1];
        if (name && tempBeforeBranch.has(name)) return null;
        return `--body-file ${target}: only a file the job wrote directly under $RUNNER_TEMP`;
      },
    };
    let runsNode = false;
    for (const c of read.commands) {
      for (const a of c.assigns) {
        const name = a.slice(0, a.indexOf("="));
        if (NEVER_SET.test(name)) problem("shell-assignment", s, `assigns ${name}, which steers how later commands are found or what they load`);
        else if (c.words.length > 0) problem("shell-assignment", s, `assigns ${name} as a prefix of ${c.words[0]}`);
        else if (!SHELL_LOCALS.has(name)) problem("shell-assignment", s, `assigns ${name}, which is not one of the shell variables this stretch uses (${[...SHELL_LOCALS].join(", ")})`);
      }
      for (const r of c.redirects) {
        if (!REDIRECT_OK(r)) problem("redirect-target", s, `redirects ${r.op} ${r.target}, which is not one of the runner's own files`);
        const m = TEMP_FILE.exec(r.target);
        if (m && (r.op === ">" || r.op === ">>")) written.add(m[1]);
      }
      if (c.words.length === 0) continue;
      const check = Object.hasOwn(ARGUMENTS, c.words[0]) ? ARGUMENTS[c.words[0]] : null;
      if (!check) {
        problem("shell-command", s, `runs \`${c.words.join(" ")}\`, which is not on the list of commands allowed before the agent`);
        continue;
      }
      const why = check(c.words, ctx);
      if (why) problem("shell-arguments", s, `\`${c.words.join(" ")}\`: ${why}`);
      if (c.words[0] === "node") runsNode = true;
    }
    // Anything that names a staged script, however spelled, counts as using one.
    if (runsNode || /agent-tool|RUNNER_TEMP[^\n]*\.m?js|runner\.temp[^\n]*\.m?js/.test(s.text)) {
      if (i < installAt) {
        // Before the install nothing of the branch's has run: the staged
        // copy is still what was staged.
        usesBefore++;
        continue;
      }
      usesAfter++;
      if (steps[i - 1].name !== VERIFY) problem("staged-use-order", s, "runs a staged script without the check directly before it");
      if (STATUS_FN.test(s.cond)) problem("staged-use-condition", s, `runs a staged script under ${s.cond}, which can run it when the check before it did not`);
    }
  }
  return { problems, usesBefore, usesAfter };
}

const formatProblems = (ps) => ps.map((p) => `  [${p.rule}] ${p.step}: ${p.message}`).join("\n");

test("from the branch checkout to the agent, trusted steps run only what is allowed, and each staged script only after its check", () => {
  // AN ALLOW-LIST, NOT A LIST OF FORBIDDEN SPELLINGS. Every simple command of
  // every shell step is one of a few known to write nothing into the
  // workspace and run nothing from it, with arguments that keep it so; every
  // redirection names one of the runner's own files; every assignment and
  // `env:` name is one this stretch uses, and none that steers how a later
  // command is found or what it loads; every action is one known not to
  // write into the workspace, and a github-script makes only the calls the
  // workflows make today. The steps that must run something else — the side
  // checkout of main and its staging, the digest record and checks — are
  // pinned to their text.
  let usesBefore = 0;
  let usesAfter = 0;
  for (const [file, name] of INSTALLING_JOBS) {
    const r = stretchProblems(parseWorkflow(WF_TEXT(file), file), name);
    assert.deepEqual(r.problems, [], `${file} (job ${name}):\n${formatProblems(r.problems)}`);
    usesBefore += r.usesBefore;
    usesAfter += r.usesAfter;
  }
  // After the install — fix: the picker; panel fix: set-state and the
  // no-credential page; iterate: summarize, set-state and the picker; reply:
  // the picker. Before it — iterate's paged steps: metrics, set-state and
  // loop-status.
  assert.equal(usesAfter, 7, `found ${usesAfter} uses of the staged scripts between the install and the agent`);
  assert.equal(usesBefore, 3, `found ${usesBefore} uses of the staged scripts between the branch checkout and the install`);
});

// Each of these is a workflow edit the guard must refuse, and the rule that
// must refuse it. Most come from an adversarial review of the guard (m1–m21);
// each one names the rule it is there for, so a failure says which rule let
// it through.
const IT = "agent-iterate-ci.yml";
const SS = '        run: node "$RUNNER_TEMP/agent-tools/set-state.mjs" "$PR" fixing\n';
const SS_ENV = "          PR: ${{ steps.guard.outputs.pr }}\n" + SS;
const RB = '        run: echo "sha=$(git ls-remote origin "refs/heads/$BRANCH" | cut -f1)" >> "$GITHUB_OUTPUT"\n';
const rb = (...pre) => [IT, RB, "        run: |\n" + [...pre, 'echo "sha=$(git ls-remote origin "refs/heads/$BRANCH" | cut -f1)" >> "$GITHUB_OUTPUT"'].map((l) => `          ${l}\n`).join("")];
const AT_BEFORE_FIX = "      - name: Record branch head before fix\n";
const gs = (code) => [IT, AT_BEFORE_FIX, `      - name: m\n        uses: actions/github-script@f28e40c7f34bde8b3046d885e986cb6290c5673b # v7\n        with:\n          script: |\n            ${code}\n${AT_BEFORE_FIX}`];
const AT_RECORD = "      - name: Record a digest of the staged agent scripts\n";
const pre = (step) => [IT, AT_RECORD, `${step}${AT_RECORD}`];
const IT_HEADER = '      cancel-in-progress: true\n    env:\n      WAFFLEBASE_AGENT_AUTONOMOUS: "true"\n';
const SET_FIXING = "      - name: Set state → fixing\n        if: steps.guard.outputs.proceed == 'true'\n";

const MUTATIONS = {
  // Assignments and env.
  m1_assign_RUNNER_TEMP: ["shell-assignment", IT, SS, '        run: |\n          RUNNER_TEMP="$PWD"\n          node "$RUNNER_TEMP/agent-tools/set-state.mjs" "$PR" fixing\n'],
  m2_prefix_NODE_OPTIONS: ["shell-assignment", IT, SS, '        run: NODE_OPTIONS="--require ./x.cjs" node "$RUNNER_TEMP/agent-tools/set-state.mjs" "$PR" fixing\n'],
  m3_yaml_env_NODE_OPTIONS: ["env-key", IT, SS_ENV, "          PR: ${{ steps.guard.outputs.pr }}\n          NODE_OPTIONS: --require ./x.cjs\n" + SS],
  m3b_yaml_env_RUNNER_TEMP: ["env-key", IT, SS_ENV, "          PR: ${{ steps.guard.outputs.pr }}\n          RUNNER_TEMP: ${{ github.workspace }}\n" + SS],
  m8_assign_PATH: ["shell-assignment", ...rb('PATH="$PWD/bin:$PATH"')],
  m9_assign_GITHUB_OUTPUT: ["shell-assignment", ...rb('GITHUB_OUTPUT="$PWD/node_modules/.bin/git"', 'echo x > "$GITHUB_OUTPUT"')],
  g1_assign_unlisted_local: ["shell-assignment", ...rb("y=1")],
  g2_assign_listed_local_as_prefix: ["shell-assignment", ...rb("DIAG=1 echo x")],
  g3_job_env_NODE_OPTIONS: ["env-key", IT, IT_HEADER, IT_HEADER + "      NODE_OPTIONS: --require ./x.cjs\n"],
  g4_workflow_env_BASH_ENV: ["env-key", IT, '  MAX_ATTEMPTS: "4"\n', '  MAX_ATTEMPTS: "4"\n  BASH_ENV: ./x.sh\n'],
  g5_step_env_flow_mapping: ["env-key", IT, "        env:\n          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n" + SS_ENV, "        env: { NODE_OPTIONS: x }\n" + SS],
  g6_verify_env_BASH_ENV: ["env-key", IT, "          EXPECTED: ${{ steps.tools.outputs.digest }}\n", "          EXPECTED: ${{ steps.tools.outputs.digest }}\n          BASH_ENV: ./x.sh\n"],
  g7_job_defaults_shell: ["defaults", IT, IT_HEADER, IT_HEADER + "    defaults:\n      run:\n        shell: sh {0}\n"],
  g8_working_directory_workspace: ["working-directory", IT, SET_FIXING, SET_FIXING + "        working-directory: ${{ github.workspace }}/x\n"],
  g9_shell_key: ["step-keys", IT, SET_FIXING, SET_FIXING + "        shell: sh {0}\n"],
  // What the lexer must not misread.
  m4_ansiC_quote: ["shell-unreadable", ...rb("echo $'\\'' ; cp -R src dst #'")],
  m5_prompt_P: ["shell-unreadable", ...rb("x='$(touch pwned)'", 'echo "${x@P}"')],
  g10_prompt_P_of_env: ["shell-unreadable", ...rb('echo "${BRANCH@P}"')],
  g11_indirection: ["shell-unreadable", ...rb('echo "${!BRANCH}"')],
  g12_subscript_expansion: ["shell-unreadable", ...rb("echo ${BRANCH[$(id)]}")],
  g13_arith_command: ["shell-unreadable", ...rb("((x = 1))")],
  g14_old_arith: ["shell-unreadable", ...rb("echo $[1+1]")],
  g15_comment_in_substitution: ["shell-unreadable", ...rb('echo "$(# )', "cp a b", ')"')],
  m16_dollar_dq_ctl: ["shell-unreadable", ...rb('echo $"x"; cp a b')],
  // A line starting with # inside a run: block is script, not YAML comment:
  // dropping it would read `cp a b` as part of a quoted string.
  g16_hash_line_closes_quote: ["shell-command", ...rb("echo '", "#'", "cp a b")],
  // Commands and their arguments.
  m6_printf_v: ["shell-arguments", ...rb("printf -v 'a[$(touch pwned)]' x")],
  m7_test_v: ["shell-arguments", ...rb("test -v 'a[$(touch pwned)]'")],
  g17_bracket_v: ["shell-arguments", ...rb("[ -v 'a[$(touch pwned)]' ]")],
  g18_test_operator_from_variable: ["shell-arguments", ...rb('[ "$PR" "$BRANCH" ]')],
  g19_printf_format_from_variable: ["shell-arguments", ...rb('printf "$BRANCH" x')],
  m10_lsremote_uploadpack: ["shell-arguments", ...rb("git ls-remote --upload-pack=./bin/x .")],
  g20_git_config_option: ["shell-arguments", ...rb("git -c core.fsmonitor=./x rev-parse HEAD")],
  g21_lsremote_remote_from_variable: ["shell-arguments", ...rb('git ls-remote "$BRANCH"')],
  g22_lsremote_local_path: ["shell-arguments", ...rb("git ls-remote ./x")],
  m17_cut_reads: ["shell-arguments", ...rb("cut -f1 /proc/self/environ")],
  g23_date_reads: ["shell-arguments", ...rb("date -f /proc/self/environ")],
  m18_gh_bodyfile: ["shell-arguments", ...rb("gh pr comment 1 --body-file /proc/self/environ")],
  g24_gh_bodyfile_unwritten: ["shell-arguments", ...rb('gh pr comment "$PR" --body-file "$RUNNER_TEMP/other.md"')],
  g25_gh_bodyfile_panel_renamed: ["shell-arguments", "agent-review-panel.yml", 'gh pr comment "$PR" --body-file "$RUNNER_TEMP/no-credential.md"', 'gh pr comment "$PR" --body-file "$RUNNER_TEMP/elsewhere.md"'],
  g26_rev_parse_option: ["shell-arguments", "agent-fix.yml", 'ACTUAL="$(git rev-parse HEAD)"', 'ACTUAL="$(git rev-parse --git-path hooks)"'],
  m15_ctl_semicolon: ["shell-command", ...rb("echo x; cp a b")],
  g27_let: ["shell-command", ...rb("let x=1")],
  g28_cd: ["shell-command", ...rb("cd /")],
  g29_export: ["shell-command", ...rb("export DIAG")],
  m14_ctl_GITHUB_ENV: ["redirect-target", ...rb('echo "X=1" >> "$GITHUB_ENV"')],
  g30_redirect_into_workspace: ["redirect-target", ...rb("echo x > node_modules/.bin/git")],
  // github-script.
  m11_gs_addPath: ["github-script", ...gs("core.addPath('${{ github.workspace }}/node_modules/.bin');")],
  m12_gs_BASH_ENV: ["github-script", ...gs("core.exportVariable('BASH_ENV', '/tmp/x.sh');")],
  m13_gs_ctor: ["github-script", ...gs("const P=[].constructor.constructor('return pro'+'cess')(); P.mainModule['req'+'uire']('f'+'s').writeFileSync('x','y');")],
  g31_gs_bracket: ["github-script", ...gs("core['addPath']('x');")],
  g32_gs_alias_root: ["github-script", ...gs("const c = core; c.addPath('x');")],
  g33_gs_process_env_write: ["github-script", ...gs("process.env.PATH = '/x';")],
  g34_gs_tagged_template: ["github-script", ...gs("String.raw`x`;")],
  g35_gs_pre_install: ["github-script", IT, "            const max = parseInt(process.env.MAX_ATTEMPTS, 10);\n", "            const max = parseInt(process.env.MAX_ATTEMPTS, 10);\n            core.exportVariable('NODE_OPTIONS', '--require ./x.cjs');\n"],
  g36_gs_extra_input: ["github-script", IT, "        id: guard\n        uses: actions/github-script@f28e40c7f34bde8b3046d885e986cb6290c5673b # v7.1.0\n        with:\n", "        id: guard\n        uses: actions/github-script@f28e40c7f34bde8b3046d885e986cb6290c5673b # v7.1.0\n        with:\n          github-token: ${{ secrets.OTHER_TOKEN }}\n"],
  g37_other_action: ["action", IT, AT_BEFORE_FIX, "      - name: m\n        uses: actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830 # v4.3.0\n        with:\n          path: x\n          key: y\n" + AT_BEFORE_FIX],
  g54_local_action_from_branch: ["action", IT, AT_RECORD, "      - name: m\n        uses: ./.github/actions/setup\n" + AT_RECORD],
  g38_download_into_workspace: ["download-path", IT, "          path: ${{ runner.temp }}/harness-reports/\n", "          path: harness-reports/\n"],
  // The stretch starts at the branch checkout, not at the install.
  m19_preinstall_node_ws: ["shell-arguments", ...pre("      - name: m\n        env:\n          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n        run: node scripts/verify-self.mjs\n")],
  m20_preinstall_sh_ws: ["shell-command", ...pre("      - name: m\n        env:\n          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n        run: ./scripts/ci.sh\n")],
  m21_preinstall_npx: ["shell-command", ...pre("      - name: m\n        run: npx --yes tsx scripts/x.ts\n")],
  g39_preinstall_prefix_on_staged: ["shell-assignment", IT, '        run: node "$RUNNER_TEMP/agent-tools/metrics.mjs"', '        run: NODE_OPTIONS=--require=./x.cjs node "$RUNNER_TEMP/agent-tools/metrics.mjs"'],
  g40_stage_with_extra_command: ["pinned-step", "agent-review-reply.yml", '          cp -R .trusted-agent/scripts/agent "${{ runner.temp }}/agent-tools"\n', '          cp -R .trusted-agent/scripts/agent "${{ runner.temp }}/agent-tools"\n          node .trusted-agent/x.mjs\n'],
  g41_side_checkout_lfs: ["pinned-step", "agent-review-reply.yml", "          sparse-checkout: scripts/agent\n", "          sparse-checkout: scripts/agent\n          lfs: true\n"],
  g42_record_script_extra: ["pinned-step", IT, '          echo "digest=$digest" >> "$GITHUB_OUTPUT"\n', '          echo "digest=$digest" >> "$GITHUB_OUTPUT"\n          node ./x.mjs\n'],
  g43_record_continue_on_error: ["pinned-step", IT, "        id: tools\n", "        id: tools\n        continue-on-error: true\n"],
  // A staged script runs only when its check ran (or the install did not).
  g44_use_under_always: ["staged-use-condition", IT, SET_FIXING, "      - name: Set state → fixing\n        if: always() && steps.guard.outputs.proceed == 'true'\n"],
  g45_use_under_always_block_scalar: ["staged-use-condition", IT, SET_FIXING, "      - name: Set state → fixing\n        if: >-\n          always() &&\n          steps.guard.outputs.proceed == 'true'\n"],
  g46_use_under_not_cancelled: ["staged-use-condition", IT, SET_FIXING, "      - name: Set state → fixing\n        if: ${{ !cancelled() }}\n"],
  g47_install_condition_differs: ["staged-use-condition", IT, "        id: install\n        if: steps.guard.outputs.proceed == 'true'\n", "        id: install\n        if: steps.guard.outputs.proceed != 'false'\n"],
  g49_run_disguised_as_download: ["shell-command", ...rb("cp a b", "uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4.3.0", "path: ${{ runner.temp }}/x")],
  g50_gs_names_staged: ["staged-name", ...gs("core.info('agent-tools');")],
  g51_first_check_not_always: ["check-after-install", IT, "        if: always() && steps.tools.outputs.digest != ''\n", "        if: steps.tools.outputs.digest != ''\n"],
  g52_install_shell: ["step-keys", IT, "        id: install\n", "        id: install\n        shell: sh -c './x; node {0}'\n"],
  g53_install_continue_on_error: ["pinned-step", IT, "        id: install\n", "        id: install\n        continue-on-error: true\n"],
  g48_use_without_check: ["staged-use-order", IT, AT_BEFORE_FIX, '      - name: m\n        run: node "$RUNNER_TEMP/agent-tools/set-state.mjs" "$PR" x\n' + AT_BEFORE_FIX],
};

test("each workflow edit the guard must refuse is refused, by the rule it names", async (t) => {
  for (const [name, [rule, file, from, to]] of Object.entries(MUTATIONS)) {
    await t.test(`${name} is refused by ${rule}`, () => {
      const text = WF_TEXT(file);
      assert.ok(text.includes(from), `${name}: the anchor is no longer in ${file}:\n${from}`);
      const jobName = INSTALLING_JOBS.find(([f]) => f === file)[1];
      const mutated = text.replace(from, () => to);
      const { problems } = stretchProblems(parseWorkflow(mutated, file), jobName);
      assert.ok(problems.some((p) => p.rule === rule), `${name} was not refused by ${rule}:\n${formatProblems(problems) || "  (refused by nothing)"}`);
    });
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
