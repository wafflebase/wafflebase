// Invariants of the `.github/workflows/agent-*.yml` this repository runs.
//
// WHOSE WORKFLOWS. Since the switch to yorkie's shared harness core, every
// `agent-*.yml` is a byte-for-byte copy of yorkie-team/yorkie's, written by
// `scripts/agent/sync.mjs`; the core's own `scripts/agent/config-wiring.test.mjs`
// guards where each harness script runs from. This file is wafflebase's second,
// independent reading of the same files, for what that guard says it does not
// see: what the trusted steps around the agent may run, write and hand on. A
// failure here after a sync is a difference in the new core, not a local bug —
// it is fixed upstream, or recorded below with the reason it is accepted.
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
// At the switch, the checks that held wafflebase's own install steps — the staged
// `install-deps.mjs`, the digest of the staged scripts checked before each later
// use, `pnpm/action-setup` at the root `packageManager` — went with those steps.
// What each property became is said where it is checked now.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WORKFLOWS = path.join(REPO, ".github", "workflows");

const WF_TEXT = (file) => readFileSync(path.join(WORKFLOWS, file), "utf8");

// wafflebase's own agent workflows, named outside `agent-*.yml` because that
// glob belongs to the shared harness core: yorkie's `sync.mjs` deletes any
// `agent-*.yml` the upstream does not have. They hold the same credentials, so
// the same guards read them.
const OWN_AGENT_WORKFLOWS = ["sdk-smoke-test.yml"];

const agentWorkflows = [
  ...readdirSync(WORKFLOWS).filter((f) => f.startsWith("agent-") && f.endsWith(".yml")),
  ...OWN_AGENT_WORKFLOWS,
].sort();

test("there are agent workflows to check, so a rename cannot vacuously pass", () => {
  // Without this the whole file no-ops the moment the glob stops matching.
  assert.ok(agentWorkflows.length >= 10, `found only ${agentWorkflows.length} agent workflows`);
  for (const f of OWN_AGENT_WORKFLOWS) {
    assert.ok(existsSync(path.join(WORKFLOWS, f)), `${f} is gone: if it was renamed, re-point OWN_AGENT_WORKFLOWS`);
  }
});

// The agent workflows that do not set GH_REPO, each because it never runs `gh`:
// the shared core's own CI runs its suite and asks GitHub over HTTPS for the
// upstream manifest (`manifest.mjs upstream`, no `gh`). The test below holds
// it to that, so the exemption ends the day it gains a `gh` call.
const NO_GH_WORKFLOWS = ["agent-scripts.yml"];

test("every agent workflow sets GH_REPO at WORKFLOW level", () => {
  // Workflow level, not job level: the outage reached jobs nobody had thought about,
  // and a per-job block only covers the jobs someone remembered. `gh` needs it in
  // every step that runs before the repo is checked out — present and future.
  for (const f of NO_GH_WORKFLOWS) {
    const runs = parseWorkflow(WF_TEXT(f), f).jobs.flatMap((j) => j.steps.filter((s) => s.isRun).map((s) => s.script));
    assert.ok(runs.length > 0, `${f} runs nothing: is it still the workflow exempted here?`);
    for (const script of runs) {
      assert.doesNotMatch(script, /(^|[\s;&|(])gh\s/m, `${f} now runs gh: set GH_REPO at workflow level and drop it from NO_GH_WORKFLOWS`);
    }
  }
  for (const f of agentWorkflows.filter((w) => !NO_GH_WORKFLOWS.includes(w))) {
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
  // success. Keying on order instead makes it independent of where the code lives,
  // and it is what catches the eight-site regression described at the top of this
  // file. The branch's ref is any form `BRANCH_REF` reads, `steps.<id>.outputs.ref`
  // included (agent-review-reply's), which the first version of this regex missed.
  //
  // Scoped per job, because that is the boundary a checkout acts on — one job's
  // checkout says nothing about another's, and jobs in the same file may legitimately
  // differ. `$RUNNER_TEMP/agent-tools/` reads are not matched at all: the whole point
  // is that they are outside the workspace and survive `actions/checkout`'s clean.
  const UNTRUSTED_REF = BRANCH_REF;
  // The core and wafflebase's own arms, which run from the workspace the same way.
  const WORKSPACE_RUN = /\bnode\s+["']?\.?\/?scripts\/agent(?:-arms)?\/([\w.-]+\.mjs)/;

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
  assert.ok(inspected > 0, "found no `node scripts/agent{,-arms}/*.mjs` invocations to inspect");
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
  const UNTRUSTED_REF = BRANCH_REF;
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
// branch is in the workspace, and the steps around it. The toolchain action
// (`.github/actions/agent-toolchain`, this repository's own) is what makes that
// install run nothing the branch wrote; these guards hold that the workflows use
// main's copy of it, and that nothing reintroduces an inline install, a
// dependency cache, a persisted credential or a movable action beside it.
/** The ref of a pull request's own branch, in any of the forms the workflows use. */
const BRANCH_REF =
  /^\s*ref:\s*\$\{\{\s*(github\.event\.workflow_run\.head_(branch|sha)|github\.event\.pull_request\.head\.(ref|sha)|steps\.[\w-]+\.outputs\.(head_)?(branch|sha|ref))/;

/**
 * Lines with YAML comments dropped, outside block scalars. Used only for the
 * `text` of a step that the older guards match against; what a step runs, its
 * condition and its environment come from the parsed document.
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

// The YAML reader. The repository already depends on `yaml` (through
// packages/cli); it is reached from there rather than added at the root.
const YAML = (() => {
  try {
    return createRequire(path.join(REPO, "packages/cli/package.json"))("yaml");
  } catch (e) {
    throw new Error(`the workflow guards read YAML with \`yaml\`, a dependency of packages/cli — run pnpm install (${e.message})`);
  }
})();

/**
 * The non-ASCII characters these workflows use today. Any other — and any
 * control character but the newline — is refused before the file is parsed:
 * a lone CR, U+2028 or U+2029 ends a line for one reader and not for another,
 * and a look-alike letter reads as a command name it is not.
 */
const WORKFLOW_NON_ASCII = new Set(["—", "–", "…", "→", "≠", "⚠", "⏸", "️", "✅", "🛑", "🤖", "👋"]);

/**
 * What a workflow file holds, as the guards need it: the problems with its
 * source that make it unsafe to read (refused characters, more than one
 * document, a parse error, an anchor, alias, tag or merge key), its
 * workflow-level `env` and `defaults`, and its jobs — each with its own keys
 * and its steps. A step's fields come from the parsed document; its `text`
 * (comments dropped) is the source of that step, kept for the guards that
 * match lines.
 */
function parseWorkflow(text, file) {
  const problems = [];
  let at = 0;
  for (const c of text) {
    const n = c.codePointAt(0);
    if ((n < 0x20 && c !== "\n") || (n >= 0x7f && n <= 0x9f)) problems.push(`a control character U+${n.toString(16).padStart(4, "0").toUpperCase()} at offset ${at}`);
    else if (n > 0x7f && !WORKFLOW_NON_ASCII.has(c)) problems.push(`a character this guard does not read (U+${n.toString(16).toUpperCase()}) at offset ${at}`);
    at += c.length;
  }
  const docs = YAML.parseAllDocuments(text, { uniqueKeys: true });
  if (docs.length !== 1) problems.push(`${docs.length} YAML documents, not one`);
  const doc = docs[0];
  for (const e of doc?.errors ?? []) problems.push(`YAML: ${e.message.split("\n")[0]}`);
  const beforeStructure = problems.length;
  if (doc) {
    YAML.visit(doc, {
      Alias: () => void problems.push("a YAML alias"),
      Pair: (_, p) => void (YAML.isScalar(p.key) && p.key.value === "<<" && problems.push("a YAML merge key")),
      Node: (_, node) => {
        if (node.anchor) problems.push(`a YAML anchor (&${node.anchor})`);
        if (node.tag) problems.push(`a YAML tag (${node.tag})`);
      },
    });
  }
  // Read whatever parsed: the source problems above are refusals for the
  // guards that hold the installing jobs, not a reason for every other guard
  // to see an empty file.
  const structural = problems.length > beforeStructure; // an alias, anchor, merge key or tag
  const readable = docs.length >= 1 && doc.errors.length === 0 && !structural && YAML.isMap(doc.contents);
  const root = readable ? doc.toJS() : {};
  const envOf = (v) => (v === undefined ? [] : isObject(v) ? Object.entries(v).map(([key, value]) => ({ key, value: String(value) })) : [{ key: "<unreadable>", value: String(v) }]);
  const lineAt = (offset) => text.slice(text.lastIndexOf("\n", offset - 1) + 1, (text.indexOf("\n", offset) + 1 || text.length + 1) - 1);

  const jobs = [];
  const jobsNode = readable ? doc.get("jobs", true) : null;
  if (YAML.isMap(jobsNode)) {
    for (const pair of jobsNode.items) {
      const name = String(pair.key?.value ?? pair.key);
      const jobValue = root.jobs?.[name];
      const job = isObject(jobValue) ? jobValue : {};
      const stepsNode = YAML.isMap(pair.value) ? pair.value.get("steps", true) : null;
      const steps = (YAML.isSeq(stepsNode) ? stepsNode.items : []).map((item, k) => {
        const v = isObject(job.steps?.[k]) ? job.steps[k] : {};
        const start = text.lastIndexOf("\n", item.range[0] - 1) + 1;
        const lines = dropComments(text.slice(start, item.range[2]).split("\n"));
        const usesNode = YAML.isMap(item) ? item.get("uses", true) : null;
        return {
          raw: v,
          keys: YAML.isMap(item) ? Object.keys(v) : ["<not a mapping>"],
          lines,
          text: lines.join("\n"),
          name: v.name === undefined ? "" : String(v.name),
          id: v.id === undefined ? null : String(v.id),
          cond: v.if === undefined ? "" : String(v.if),
          env: envOf(v.env),
          with: isObject(v.with) ? v.with : v.with === undefined ? {} : { "<unreadable>": v.with },
          uses: typeof v.uses === "string" ? v.uses : null,
          // The source line of `uses:`, for the version comment beside a pin.
          usesLine: usesNode?.range ? lineAt(usesNode.range[0]) : null,
          isRun: v.run !== undefined,
          script: v.run === undefined ? null : typeof v.run === "string" ? v.run : JSON.stringify(v.run),
          checksOutBranch: lines.some((l) => BRANCH_REF.test(l)),
        };
      });
      jobs.push({ file, name, raw: job, env: envOf(job.env), steps });
    }
  }
  return { file, problems, raw: root, env: envOf(root.env), jobs };
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
const PINNED = /@[0-9a-f]{40} # v\d+(\.\d+\.\d+)?$/;
const AGENT_ACTION = "anthropics/claude-code-action@";
/** The toolchain action, used from main's copy checked out beside the branch. */
const TOOLCHAIN_DIR = ".trusted-toolchain";
const TOOLCHAIN_USE = `./${TOOLCHAIN_DIR}/.github/actions/agent-toolchain`;
const TOOLCHAIN_CHECKOUT = { ref: "main", path: TOOLCHAIN_DIR, "sparse-checkout": ".github/actions/agent-toolchain", "sparse-checkout-cone-mode": false, "persist-credentials": false };
/** The step that keeps the side directory out of the agent's commits: its one write into `.git`. */
const EXCLUDE_SCRIPT = `echo '/${TOOLCHAIN_DIR}/' >> .git/info/exclude`;
/** The only token a branch checkout may persist into `.git/config`: the agent's own, which it is handed anyway. */
const AGENT_TOKEN = "${{ steps.agent-token.outputs.token }}";

test("the jobs that install a PR branch's dependencies do it through main's toolchain action, checked out beside the branch", () => {
  // `.github/actions/agent-toolchain` is what makes the install run nothing the
  // branch wrote and stay inside the workspace (in a container that sees the
  // workspace and nothing else); `.github/agent-harness/toolchain.test.mjs`
  // runs it. These guards are the other half: that the workflows call main's
  // copy, never the branch's, from a path the branch cannot have prepared, and
  // that nothing beside it installs, builds or reads a side directory.
  for (const [file, name] of INSTALLING_JOBS) {
    const where = `${file} (job ${name})`;
    const { steps } = job(file, name);
    const branchAt = steps.findIndex((s) => s.checksOutBranch);
    assert.notEqual(branchAt, -1, `${where} no longer checks out the PR's branch — is it still an installing job?`);

    // Exactly one local action, main's toolchain, after the branch is in the
    // workspace. `uses: ./…` reads the action from the workspace when the step
    // runs, so any other path is the branch's own action, run with the job's tokens.
    const locals = steps.map((s, i) => [s, i]).filter(([s]) => s.uses?.startsWith("./"));
    assert.equal(locals.length, 1, `${where} must use exactly one local action`);
    const [install, installAt] = locals[0];
    assert.equal(install.uses, TOOLCHAIN_USE, `${where} must use main's toolchain action from ${TOOLCHAIN_DIR}`);
    assert.ok(installAt > branchAt, `${where} runs the toolchain before the branch is checked out`);
    // The step is handed nothing: no input, no env, and it fails the job when it fails.
    assert.deepEqual(install.keys.filter((k) => !["name", "id", "if", "uses"].includes(k)), [], `${where}: the toolchain step takes more than a name, an id, a condition and the action`);

    // The branch checkout persists no credential but the agent's own token,
    // which the install's container cannot read (`.git` is covered there).
    const branch = steps[branchAt];
    assert.ok(
      branch.with["persist-credentials"] === false || branch.with.token === AGENT_TOKEN,
      `${where}: the branch checkout persists a token other than the agent's`,
    );

    // A side directory main is checked out to is a name inside the branch's
    // tree: it must be cleared after the branch checkout, checked out from
    // main, and then either copied out and removed, moved out, or — the
    // toolchain's own — used by the toolchain step and kept out of commits.
    // Nothing else may read it.
    const sideDirs = new Set();
    for (const s of steps) {
      for (const m of s.text.matchAll(/(?:^|[\s"'/])(\.trusted-[\w-]+)/g)) sideDirs.add(m[1]);
    }
    assert.ok(sideDirs.has(TOOLCHAIN_DIR), `${where} names no ${TOOLCHAIN_DIR}`);
    for (const dir of sideDirs) {
      const esc = dir.replace(".", "\\.");
      const checkoutAt = steps.findIndex((s) => s.uses?.startsWith("actions/checkout@") && s.with.ref === "main" && s.with.path === dir);
      assert.notEqual(checkoutAt, -1, `${where} reads ${dir} but never checks main out to it`);
      const clearedAt = steps.findIndex((s) => s.script === `rm -rf ${dir}`);
      if (checkoutAt > branchAt) {
        assert.ok(clearedAt > branchAt && clearedAt < checkoutAt, `${where} must \`rm -rf ${dir}\` after the branch checkout and before main is checked out to it`);
      }
      const allowed = new Set([checkoutAt, clearedAt]);
      if (dir === TOOLCHAIN_DIR) {
        assert.deepEqual(steps[checkoutAt].with, TOOLCHAIN_CHECKOUT, `${where}: the toolchain checkout must be exactly ${JSON.stringify(TOOLCHAIN_CHECKOUT)}`);
        assert.ok(checkoutAt < installAt, `${where} checks the toolchain out after using it`);
        assert.equal(steps[installAt + 1]?.script, EXCLUDE_SCRIPT, `${where}: the step after the toolchain must keep ${dir} out of commits`);
        allowed.add(installAt).add(installAt + 1);
      } else {
        const outAt = steps.findIndex((s, i) => i > checkoutAt && s.isRun && new RegExp(`^(?:cp -R|mv) ${esc}[/ ]`, "m").test(s.script));
        assert.notEqual(outAt, -1, `${where} checks main out to ${dir} and never copies or moves it out`);
        assert.match(steps[outAt].script, new RegExp(`(?:\\n\\s*rm -rf ${esc}\\s*$)|(?:^mv ${esc} )`, "m"), `${where} must remove ${dir} once it is copied out`);
        assert.ok(installAt < checkoutAt || outAt < installAt, `${where}: ${dir} is still in the workspace when the toolchain runs`);
        allowed.add(outAt);
      }
      for (const [i, s] of steps.entries()) {
        if (allowed.has(i)) continue;
        assert.doesNotMatch(s.text, new RegExp(esc), `${where}: step "${s.name}" reads ${dir} inside the workspace`);
      }
    }

    // No other step installs, builds or generates with pnpm: the toolchain
    // puts pnpm on PATH, and with the branch in the workspace pnpm runs the
    // branch's scripts.
    for (const [i, s] of steps.entries()) {
      if (!s.isRun || i === installAt) continue;
      assert.doesNotMatch(s.script, PNPM_COMMAND, `${where} runs pnpm in a step of its own:\n${s.text}`);
    }
    assert.equal(steps.filter((s) => s.uses?.startsWith(AGENT_ACTION)).length, 1, `${where} must have exactly one agent step`);
  }
  // What the old install steps told the agent (no lifecycle scripts ran, so
  // generate the Prisma client) is now a configured sentence of the shared
  // prompts; `.github/agent-harness/repo.test.mjs` holds it, and the snapshot
  // there records where it is rendered.
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
  const LINE_END = /[\n\r\u2028\u2029]/;
  const LINE_ENDS = /[\n\r\u2028\u2029]/g;
  const valueEnd = (t) => t && ((t.t === "id" && !KEYWORDS.has(t.v)) || t.t === "num" || t.t === "str" || t.t === "tmplend" || t.v === ")" || t.v === "]");

  function lex(i, inTemplate) {
    let depth = 0;
    while (i < code.length) {
      const c = code[i];
      const rest = code.slice(i, i + 4);
      if (LINE_END.test(c)) {
        line++;
        i++;
      } else if (c === " " || c === "\t") {
        i++;
      } else if (rest.startsWith("${{")) {
        problems.push("a GitHub expression inside the script");
        i += 3;
      } else if (rest.startsWith("//")) {
        // JavaScript ends a line comment at any line terminator, not only \n.
        while (i < code.length && !LINE_END.test(code[i])) i++;
      } else if (rest.startsWith("/*")) {
        const e = code.indexOf("*/", i + 2);
        if (e === -1) {
          problems.push("an unterminated comment");
          return code.length;
        }
        line += (code.slice(i, e).match(LINE_ENDS) ?? []).length;
        i = e + 2;
      } else if (c === "'" || c === '"') {
        let j = i + 1;
        for (; j < code.length && code[j] !== c && !LINE_END.test(code[j]); j++) if (code[j] === "\\") j++;
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
        if (LINE_END.test(code[i + 1] ?? "")) line++;
        i++;
      } else if (LINE_END.test(c)) line++;
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
  const API_CALLS = new Set([
    "github.rest.pulls.list",
    "github.rest.pulls.get",
    "github.rest.issues.createComment",
    "github.rest.issues.updateComment",
    "github.rest.repos.getCollaboratorPermissionLevel",
    "github.rest.actions.listWorkflowRuns",
    "github.paginate",
    "core.setOutput",
    "core.setFailed",
    "core.info",
    "core.notice",
    "core.warning",
    "core.error",
    "core.debug",
    "core.summary.addRaw",
  ]);
  const API_READS = new Set(["context.repo.owner", "context.repo.repo", "context.serverUrl", "context.runId", "github.rest.actions.listWorkflowRuns", "github.rest.issues.listComments"]);
  const apiRead = (p) => API_READS.has(p) || /^context\.payload(\.[A-Za-z_]\w*)+$/.test(p) || /^process\.env\.[A-Z][A-Z0-9_]*$/.test(p);
  const API_ROOTS = new Set(["github", "core", "context", "process"]);
  const GLOBAL_CALLS = new Set(["String", "Number", "parseInt"]);
  const VALUE_METHODS = new Set(["filter", "some", "includes", "startsWith", "reduce"]);
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
    if (t.t === "id" && (t.v === "const" || t.v === "let") && toks[k + 1]?.v === "{") {
      // `const { a, b: c } = …`: each bound name is declared; a key that is
      // renamed (`b:`) is a property name, not a binding.
      const close = matching(k + 1);
      for (let j = k + 2; j < close; j++) {
        const u = toks[j];
        if (u.t === "id" && toks[j + 1]?.v === ":") continue;
        if (u.t === "id" && (toks[j + 1]?.v === "," || toks[j + 1]?.v === "}")) declare(j, "a destructured name");
        else if (u.v !== "," && u.v !== ":") problems.push("a destructuring pattern this guard does not read");
      }
      if (toks[close + 1]?.v === "=") declaredAt.add(close);
      decl = { depth };
    } else if (t.t === "id" && (t.v === "const" || t.v === "let")) {
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
      if (t.v === "?." && next?.t !== "id") problems.push("an optional call or bracket access (?.( / ?.[)");
      if (["...", "++", "--", "+=", "-=", "*=", "%=", "**", "**=", "&&=", "||=", "??=", "<<", ">>", ">>>"].includes(t.v)) problems.push(`the operator ${t.v}`);
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
    if (prev?.v === "." || prev?.v === "?.") {
      // A property of a value. API chains are consumed whole below, so what is
      // left is a property of something the script itself holds.
      if (next?.v === "(" && !VALUE_METHODS.has(t.v) && !writeOk.has(k)) problems.push(`a call of .${t.v}(); the methods allowed on the script's own values are ${[...VALUE_METHODS].join(", ")}`);
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
        if (!API_CALLS.has(p)) problems.push(`a call of ${p}(); the calls allowed are ${[...API_CALLS].join(", ")}`);
        else if (p === "core.summary.addRaw") {
          const close = matching(j + 1);
          if (toks[close + 1]?.v === "." && toks[close + 2]?.v === "write" && toks[close + 3]?.v === "(") writeOk.add(close + 2);
        }
      } else if (!apiRead(p) && !(p === "process.env" && toks[k - 1]?.v === "=" && declaredAt.has(k - 2) && toks[k - 2]?.v === "}")) {
        // `const { A, B } = process.env;` reads named variables, like process.env.A.
        problems.push(`a use of ${p}; the reads allowed are ${[...API_READS].join(", ")}, context.payload.* and process.env.<NAME>`);
      }
      k = j;
      continue;
    }
    if (t.v === "JSON" && next?.v === "." && toks[k + 2]?.v === "parse" && toks[k + 3]?.v === "(") {
      k += 2; // JSON.parse(…), a pure function of a string
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
    "const { data: pr } = await github.rest.pulls.get({ pull_number: 1 });\ncore.setOutput('a', String(pr.head.ref.startsWith('agent/')));\nconst n = context.payload.issue?.number || Number(process.env.X);\ncore.notice(`n ${n}`);",
    "const L = ['a[bot]'];\nconst f = (c) => {\n  const user = (c || {}).user || {};\n  return L.includes(user.login) || String((c || {}).body ?? '').includes('x');\n};",
    "const { A, B } = process.env;\nconst n = [1, 2].reduce((a, b) => a + b, 0);\nconst L = JSON.parse(process.env.X);\ncore.info(`${A} ${B} ${n} ${L}`);",
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
    "// note\u2028core.addPath('x');",
    "// note\rcore.exportVariable('A', 'b');",
    "const s = 'x'; s?.at(0);",
    "const f = () => 1; f?.();",
    "const e = process.env;",
    "const { A } = process;",
    "const j = JSON;",
    "JSON.stringify.call(null);",
  ]) {
    assert.ok(githubScriptProblems(bad).length > 0, `read without a problem: ${bad}`);
  }
});

// ---------------------------------------------------------------------------
// From the job's first step to the agent. Every trusted step after the branch
// checkout runs with the branch's tree in the workspace, so whatever it writes
// there, runs from there, or lets steer the steps after it, follows that tree;
// every step before it decides what the workspace holds when that starts.
//
// What changed at the switch. wafflebase's own workflows ran the install as
// `node "$RUNNER_TEMP/agent-tools/install-deps.mjs"` on the runner, so a
// digest of the staged scripts was recorded before it and checked before
// every later use. The shared workflows run the install through the toolchain
// action, in a container that is given the workspace and nothing else, and
// fail the step when anything outside the workspace changed
// (`.github/agent-harness/toolchain.test.mjs`: "the container is given the
// workspace, its store and the workflow's pnpm, and nothing else", "after the
// install, anything that left the workspace fails the step"). The staged
// copies under `$RUNNER_TEMP` are out of its reach, so the digest steps and
// the rules that ordered each staged use after a check are gone with them.

const STEP_KEYS = new Set(["name", "id", "if", "env", "run", "uses", "with", "continue-on-error", "working-directory", "timeout-minutes"]);
// The `env:` names these jobs use today, by level. Anything else is refused,
// and these never: each steers how a later command is found or what it loads.
const STEP_ENV = new Set([
  "GH_TOKEN", "PR", "BRANCH", "EXPECTED", "HEAD_SHA", "CAPACITY", "CRED_REASON", "RUN_URL", "DISPATCH_FILE", "ATTEMPTS", "MAX",
  "RUN_ID", "REPORTS", "TOOLS", "LANE_REPORTS", "LAST_RESORT", "BODY", "PATH_", "LINE", "HUNK", "BOT_LOGINS",
  "CLAUDE_CODE_OAUTH_TOKEN", ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `CLAUDE_CODE_OAUTH_TOKEN_${n}`),
]);
const JOB_ENV = new Set();
const WORKFLOW_ENV = new Set(["GH_REPO", "MAX_REVIEW_ROUNDS", "MAX_ATTEMPTS"]);
const NEVER_SET = /^(PATH|BASH_ENV|ENV|HOME|IFS|CDPATH|SHELLOPTS|BASHOPTS|PS4|NODE_\w*|RUNNER_\w*|GITHUB_\w*|ACTIONS_\w*|LD_\w*|DYLD_\w*|GIT_\w*|npm_config_\w*|NPM_CONFIG_\w*|PNPM_\w*)$/;
// The shell variables the stretch's scripts assign today, after the branch
// checkout. Bare assignments only; never as a command prefix.
const SHELL_LOCALS = new Set(["ACTUAL", "DIAG", "UNREAD", "EOF_MARK", "HOOKS", "EFFECTIVE"]);
/** A `$RUNNER_TEMP/<name>` the job writes or reads: a plain name, directly under it. */
const TEMP_FILE = /^"\$RUNNER_TEMP\/([\w-][\w.-]*)"$/;
/** The same, as a step's `env:` value. */
const TEMP_ENV = /^\$\{\{ runner\.temp \}\}\/([\w-][\w.-]*)$/;
/** What a side checkout after the branch's may bring: main's scripts, its configuration and its toolchain action. */
const SIDE_PATHS = new Set(["scripts/agent", ".github/agent-harness", "scripts/ci", "scripts/direct-run.mjs", ".github/actions/agent-toolchain"]);

/** The word with its quotes removed, or null when it expands anything. */
const literalOf = (w) => (/[$`\\]/.test(w.replace(/'[^']*'/g, "")) ? null : w.replace(/'([^']*)'|"([^"]*)"/g, (_, a, b) => a ?? b));
const singleQuotedRuns = (w) => /'[^']*(\$\(|`)[^']*'/.test(w);
const sameWords = (w, want) => w.length === want.length && want.every((x, i) => w[i] === x);

/**
 * A path under the runner's temp directory, as a script word: directly
 * (`"$RUNNER_TEMP/<dir>/…"`), or through a variable the step set to a
 * directory there — a shell assignment (`HOOKS="$RUNNER_TEMP/agent-hooks"`)
 * or an `env:` value (`TOOLS: ${{ runner.temp }}/trusted-scripts`). Returns
 * the directory directly under $RUNNER_TEMP and the rest, or null.
 */
function tempPath(word, ctx) {
  const m = /^"\$(?:RUNNER_TEMP\/([\w-][\w.-]*)|([A-Z_]+))((?:\/[\w-][\w.-]*)*)"$/.exec(word);
  if (!m) return null;
  if (m[1] !== undefined) return { dir: m[1], rest: m[3] };
  const dir = ctx.aliases.get(m[2]);
  return dir === undefined ? null : { dir, rest: m[3] };
}
/** A path under $RUNNER_TEMP outside every directory the job staged main's copies to: somewhere a step may write. */
const scratchPath = (word, ctx) => {
  const p = tempPath(word, ctx);
  return p !== null && !ctx.staged.has(p.dir);
};
/** A staged script: an `.mjs` under a directory this job staged or moved main's copy to. */
const stagedScript = (word, ctx) => {
  const p = tempPath(word, ctx);
  return p !== null && ctx.staged.has(p.dir) && /\.mjs$/.test(p.rest) && !/(^|\/)\.\.?(\/|$)/.test(p.rest);
};

/**
 * What each allowed command may be given. Each returns why its words are
 * refused, or null. `ctx` carries what the step has written so far, its
 * temp-directory aliases and the directories the job has staged.
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
  tail: (w) => (w.length === 3 && w[1] === "-c" && /^\d+$/.test(w[2]) ? null : "takes -c <count> only: tail reads standard input only"),
  date: (w) => {
    for (const a of w.slice(1)) {
      const v = literalOf(a);
      if (v !== "-u" && !(v !== null && v.startsWith("+"))) return `the operand ${a}: date takes -u and a +format only`;
    }
    return null;
  },
  openssl: (w) => (w.length === 4 && w[1] === "rand" && w[2] === "-hex" && /^\d+$/.test(w[3]) ? null : "only openssl rand -hex <count>"),
  // A directory, and a file's mode, under the runner's temp directory only.
  mkdir: (w, ctx) => (w.length === 3 && w[1] === "-p" && scratchPath(w[2], ctx) ? null : "only mkdir -p <a directory under $RUNNER_TEMP, outside the staged copies>"),
  chmod: (w, ctx) => (w.length === 3 && w[1] === "+x" && scratchPath(w[2], ctx) ? null : "only chmod +x <a file under $RUNNER_TEMP, outside the staged copies>"),
  // `rev-parse <ref>` and `ls-remote <origin|github.com URL> <pattern>`, with
  // no option: `--upload-pack`, `-u`, `--exec`, `-c` and `--config` each run a
  // program, and a remote that is a local path runs one by itself. Two exact
  // forms more, the fix-scope hook's: point `core.hooksPath` at a directory
  // under $RUNNER_TEMP, and ask git where it now reads hooks from.
  git: (w, ctx) => {
    const sub = w[1];
    if (sub === "rev-parse") {
      if (sameWords(w.slice(2), ["--path-format=absolute", "--git-path", "hooks"])) return null;
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
    if (sub === "config") {
      return w.length === 4 && w[2] === "core.hooksPath" && scratchPath(w[3], ctx) ? null : "git config: only core.hooksPath, to a directory under $RUNNER_TEMP";
    }
    return `the subcommand ${sub}: only rev-parse, ls-remote and config core.hooksPath`;
  },
  // One pull request, and a body — or a body file this job wrote itself,
  // directly under $RUNNER_TEMP: in this step, before this command, or in a
  // step before the branch was checked out. Any other file is one gh would
  // publish, whatever it holds. Besides comments, three exact forms: the
  // branch head read, the pre-agent token's own revocation, and the failed
  // run's log.
  gh: (w, ctx) => {
    if (sameWords(w.slice(1), ["api", '"repos/$GITHUB_REPOSITORY/git/ref/heads/$BRANCH"', "--jq", ".object.sha"])) return null;
    if (sameWords(w.slice(1), ["api", "-X", "DELETE", "installation/token"])) return null;
    if (sameWords(w.slice(1), ["run", "view", '"$RUN_ID"', "--log-failed"])) return null;
    if (w[1] !== "pr" || w[2] !== "comment") return "only gh pr comment, the branch-head read, the token revocation and the failed run's log";
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
      } else if (/^\$[A-Z_]+$/.test(a)) {
        return `the argument ${a}: quote the variable ("${a}"), so its value is one word`;
      } else return `the argument ${a}`;
    }
    return prs === 1 ? null : "names no pull request";
  },
  // A staged script; before the branch is checked out, also main's own
  // `./scripts/agent/*.mjs`, since the workspace is still main's tree.
  node: (w, ctx) =>
    stagedScript(w[1] ?? "", ctx) || (ctx?.preBranch && /^\.\/scripts\/agent\/[a-z][a-z0-9-]*\.mjs$/.test(w[1] ?? ""))
      ? null
      : `runs ${w[1]}, which is not a script this job staged ("$RUNNER_TEMP/<staged directory>/….mjs")`,
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

const REDIRECT_OK = (r, ctx) =>
  (r.op === ">&" && (r.target === "1" || r.target === "2")) ||
  ((r.op === ">" || r.op === ">>") && (['"$GITHUB_OUTPUT"', '"$GITHUB_STEP_SUMMARY"', "/dev/null"].includes(r.target) || scratchPath(r.target, ctx)));

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const sameMapping = (a, b) => isObject(a) && Object.keys(a).length === Object.keys(b).length && Object.entries(b).every(([k, v]) => a[k] === v);
/** Before the branch is in the workspace, the pinned run step that unpacks the Agent SDK beside the staged scripts. */
const PRE_BRANCH_PINNED = ['tar -xzf /tmp/agent-sdk/agent-sdk-node-modules.tgz -C "$RUNNER_TEMP/agent-tools"'];
const PRE_BRANCH_ACTIONS = ["actions/setup-node@", "actions/create-github-app-token@"];
const PRE_BRANCH_CHECKOUT_WITH = ["ref", "path", "sparse-checkout", "sparse-checkout-cone-mode", "persist-credentials", "fetch-depth", "token"];

/**
 * The step that stages main's scripts, read as its lines (shell comments and
 * blank lines dropped): main's `scripts/agent` to `agent-tools` first, then
 * any of its configuration (and the variable that names it), its whole
 * `scripts/` to `trusted-scripts`, and — from a side directory — that
 * directory's removal last. `src` is `.` before the branch is checked out (the
 * workspace is main) and the side directory after it. Returns the directories
 * it staged, or null when the step is not exactly that.
 */
function stageStep(script, preBranch) {
  const lines = script.split("\n").map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("#"));
  const src = preBranch ? "." : /^cp -R (\.trusted-[\w-]+)\/scripts\/agent /.exec(lines[0] ?? "")?.[1];
  if (!src) return null;
  const T = "${{ runner.temp }}";
  const forms = new Map([
    [`cp -R ${src}/scripts/agent "${T}/agent-tools"`, "agent-tools"],
    [`cp -R ${src}/.github/agent-harness "${T}/agent-harness"`, "agent-harness"],
    [`echo "AGENT_HARNESS_CONFIG_DIR=${T}/agent-harness" >> "$GITHUB_ENV"`, null],
    [`cp -R ${src}/scripts "${T}/trusted-scripts"`, "trusted-scripts"],
  ]);
  if (lines[0] !== `cp -R ${src}/scripts/agent "${T}/agent-tools"`) return null;
  const body = preBranch ? lines : lines.slice(0, -1);
  if (!preBranch && lines.at(-1) !== `rm -rf ${src}`) return null;
  const staged = [];
  for (const l of body) {
    if (!forms.has(l)) return null;
    if (forms.get(l)) staged.push(forms.get(l));
  }
  return staged;
}
/** The step that moves a side directory out of the workspace whole: `rm -rf "$RUNNER_TEMP/<n>"`, then `mv <dir> "$RUNNER_TEMP/<n>"`. */
function moveStep(script) {
  const m = /^rm -rf "\$RUNNER_TEMP\/([\w-]+)"\nmv (\.trusted-[\w-]+) "\$RUNNER_TEMP\/([\w-]+)"$/.exec(script.trim());
  return m && m[1] === m[3] ? { dir: m[2], to: m[1] } : null;
}

/**
 * Every way the trusted steps of an installing job, from its first step to the
 * agent, leave the allow-list — each tagged with the rule it breaks.
 *
 * Two policies, split at the first `actions/checkout` of anything but `ref:
 * main` (the branch checkout). Before it the workspace holds main's tree or
 * nothing, and the steps may run main's own scripts, but nothing there may
 * check anything else out, write outside a few runner directories, or set up
 * anything that steers a later step: those steps are held to their own
 * allow-list too, so the branch can only enter at that checkout. From it on,
 * the strict allow-list below; the side checkouts of main, the staging and
 * moving of them, the toolchain step and the one write into `.git` after it
 * are pinned to their shape.
 *
 * @returns {{ problems: { rule: string, step: string, message: string }[], usesBefore: number, usesAfter: number }}
 */
function stretchProblems(wf, jobName) {
  const problems = [];
  const label = (s) => (s ? s.name || s.uses || s.id || "(unnamed)" : "(job)");
  const problem = (rule, s, message) => problems.push({ rule, step: label(s), message });
  const none = () => ({ problems, usesBefore: 0, usesAfter: 0 });
  // A source this guard cannot read the way GitHub reads it is refused
  // before anything is read from it.
  for (const p of wf.problems) problem("yaml-source", null, p);
  if (wf.problems.length > 0) return none();
  const job = wf.jobs.find((j) => j.name === jobName);
  if (!job) {
    problem("shape", null, `${wf.file} has no job ${jobName}`);
    return none();
  }
  const { steps } = job;
  const isCheckout = (s) => s.uses?.startsWith("actions/checkout@");
  const branchAt = steps.findIndex((s) => isCheckout(s) && s.with.ref !== "main");
  const installAt = steps.findIndex((s) => s.uses === TOOLCHAIN_USE);
  const agentAt = steps.findIndex((s) => s.uses?.startsWith(AGENT_ACTION));
  if (!(branchAt >= 0 && installAt > branchAt && agentAt > installAt)) {
    problem("shape", null, `no checkout of the branch, then main's toolchain action (${TOOLCHAIN_USE}), then the agent`);
    return none();
  }

  // What every step of the job inherits.
  if ("defaults" in wf.raw) problem("defaults", null, "the workflow sets defaults:, which changes how every run: step is run");
  if ("defaults" in job.raw) problem("defaults", null, "the job sets defaults:, which changes how every run: step is run");
  for (const k of ["container", "services"]) {
    if (k in job.raw) problem("job-container", null, `the job sets ${k}:, which runs its steps (or beside them) with an image, options, volumes and env this guard does not read`);
  }
  const envKey = (level, allowed, s) => ({ key }) => {
    if (NEVER_SET.test(key)) problem("env-key", s, `${level} env: sets ${key}, which steers how later commands are found or what they load`);
    else if (allowed && !allowed.has(key)) problem("env-key", s, `${level} env: sets ${key}, which is not one of the names this stretch uses (${[...allowed].join(", ") || "none"})`);
  };
  wf.env.forEach(envKey("workflow", WORKFLOW_ENV, null));
  job.env.forEach(envKey("job", JOB_ENV, null));

  // The branch checkout persists no credential but the agent's own token.
  const branch = steps[branchAt];
  if (!(branch.with["persist-credentials"] === false || branch.with.token === AGENT_TOKEN)) {
    problem("branch-checkout", branch, `persists a token other than the agent's own (${AGENT_TOKEN})`);
  }
  // Directly after the toolchain, the step that keeps its side directory out
  // of commits: the one write into `.git` this stretch makes.
  const after = steps[installAt + 1];
  if (after?.script?.trim() !== EXCLUDE_SCRIPT) problem("after-install", after, `the step after the toolchain must be exactly: ${EXCLUDE_SCRIPT}`);

  // Files named under $RUNNER_TEMP by a step before the branch was checked out.
  const tempBeforeBranch = new Set();
  for (const s of steps.slice(0, branchAt)) {
    for (const { value } of s.env) {
      const m = TEMP_ENV.exec(value);
      if (m) tempBeforeBranch.add(m[1]);
    }
  }
  // The directories under $RUNNER_TEMP that hold main's scripts, as the job stages them.
  const staged = new Set();
  // Side directories cleared after the branch checkout and not yet checked out.
  const cleared = new Set();

  const keyProblem = (s, allowed) => {
    for (const k of s.keys) if (!allowed.includes(k)) problem(STEP_KEYS.has(k) ? "pinned-step" : "step-keys", s, `has the key ${k}`);
  };
  const githubScript = (s, inputs) => {
    for (const k of Object.keys(s.with)) if (!inputs.includes(k)) problem("github-script", s, `github-script is given ${k}; the inputs allowed are ${inputs.join(", ")}`);
    if (typeof s.with.script !== "string") problem("github-script", s, "the script is not a string");
    else for (const p of githubScriptProblems(s.with.script)) problem("github-script", s, p);
  };
  /** A run step's shell, against the command allow-list; returns whether it runs node. */
  const shell = (s, { preBranch }) => {
    const read = shellCommands(s.script);
    for (const p of read.problems) problem("shell-unreadable", s, p);
    if (read.commands.every((c) => c.words.length === 0 && c.assigns.length === 0)) problem("shell-unreadable", s, "runs no command this guard can read");
    // Directories under $RUNNER_TEMP the step names through a variable: an
    // `env:` value, or a local it assigns exactly once to one.
    const aliases = new Map();
    for (const { key, value } of s.env) {
      const m = TEMP_ENV.exec(value);
      if (m) aliases.set(key, m[1]);
    }
    const assigned = new Map();
    for (const c of read.commands) for (const a of c.assigns) {
      const name = a.slice(0, a.indexOf("="));
      assigned.set(name, (assigned.get(name) ?? 0) + 1);
      const m = /^[A-Z_]+="\$RUNNER_TEMP\/([\w-][\w.-]*)"$/.exec(a);
      if (m) aliases.set(name, m[1]);
    }
    for (const [name, n] of assigned) if (n > 1 && aliases.has(name)) aliases.delete(name);
    const written = new Set();
    const ctx = {
      preBranch,
      aliases,
      staged,
      bodyFile: (target) => {
        if (target === undefined) return "--body-file has no value";
        const direct = TEMP_FILE.exec(target);
        if (direct) return written.has(direct[1]) ? null : `--body-file ${target}, which this step has not written`;
        const viaEnv = /^"\$([A-Z_]+)"$/.exec(target);
        const value = viaEnv && s.env.find((e) => e.key === viaEnv[1])?.value;
        const name = value && TEMP_ENV.exec(value)?.[1];
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
        else if (!preBranch && !SHELL_LOCALS.has(name)) problem("shell-assignment", s, `assigns ${name}, which is not one of the shell variables this stretch uses (${[...SHELL_LOCALS].join(", ")})`);
      }
      for (const r of c.redirects) {
        if (!REDIRECT_OK(r, ctx)) problem("redirect-target", s, `redirects ${r.op} ${r.target}, which is not one of the runner's own files`);
        const m = TEMP_FILE.exec(r.target);
        if (m && (r.op === ">" || r.op === ">>")) written.add(m[1]);
      }
      if (c.words.length === 0) continue;
      const check = Object.hasOwn(ARGUMENTS, c.words[0]) ? ARGUMENTS[c.words[0]] : null;
      if (!check) {
        problem("shell-command", s, `runs \`${c.words.join(" ")}\`, which is not on the list of commands allowed before the agent (${Object.keys(ARGUMENTS).join(", ")})`);
        continue;
      }
      const why = check(c.words, ctx);
      if (why) problem("shell-arguments", s, `\`${c.words.join(" ")}\`: ${why}`);
      if (c.words[0] === "node") runsNode = true;
    }
    return runsNode;
  };
  const common = (s) => {
    const wd = s.raw["working-directory"];
    if (wd !== undefined && wd !== "${{ runner.temp }}") problem("working-directory", s, `runs in ${wd}, not the runner's temp directory`);
    if (s.uses && s.isRun) problem("shape", s, "both runs a script and uses an action");
    if (!s.uses && !s.isRun) problem("shape", s, "neither runs a script nor uses an action");
  };
  /** A step that copies main's scripts somewhere without being the pinned staging. */
  const looksLikeStaging = (script) => /^\s*(?:cp|mv)\s[^\n]*(?:agent-tools|\.trusted-|scripts\/agent)/m.test(script);

  // Before the branch is in the workspace.
  for (const s of steps.slice(0, branchAt)) {
    for (const k of s.keys) if (!STEP_KEYS.has(k)) problem("step-keys", s, `has a key this guard does not read: ${k}`);
    s.env.forEach(envKey("step", null, s));
    common(s);
    if (s.uses) {
      if (isCheckout(s)) {
        for (const k of Object.keys(s.with)) if (!PRE_BRANCH_CHECKOUT_WITH.includes(k)) problem("pre-branch-checkout", s, `a checkout of main is given ${k}`);
      } else if (s.uses.startsWith("actions/download-artifact@")) {
        if (!/^(\/tmp\/|\$\{\{ runner\.temp \}\}\/)[\w./-]+$/.test(String(s.with.path ?? "")) || /\.\./.test(String(s.with.path))) problem("download-path", s, "downloads into the workspace rather than /tmp or the runner's temp directory");
        else if (staged.has(TEMP_ENV.exec(String(s.with.path).split("/").slice(0, 2).join("/"))?.[1])) problem("download-path", s, "downloads into a staged copy of main's scripts");
      } else if (s.uses.startsWith("actions/github-script@")) {
        githubScript(s, ["retries", "script", "github-token"]);
      } else if (!PRE_BRANCH_ACTIONS.some((a) => s.uses.startsWith(a))) {
        problem("action", s, `${s.uses} is not an action this guard knows to leave the workspace as main's`);
      }
      continue;
    }
    if (!s.isRun) continue;
    if (PRE_BRANCH_PINNED.includes(s.script.trimEnd())) {
      keyProblem(s, ["name", "id", "if", "run", "continue-on-error"]);
      continue;
    }
    const stagedHere = stageStep(s.script, true);
    if (stagedHere) {
      keyProblem(s, ["name", "id", "if", "run"]);
      for (const d of stagedHere) staged.add(d);
      continue;
    }
    if (looksLikeStaging(s.script)) {
      problem("pinned-step", s, "stages main's scripts with something other than the pinned copy lines");
      continue;
    }
    shell(s, { preBranch: true });
  }

  // From the branch checkout on.
  let usesBefore = 0;
  let usesAfter = 0;
  for (let i = branchAt + 1; i < agentAt; i++) {
    const s = steps[i];
    s.env.forEach(envKey("step", STEP_ENV, s));
    if (i === installAt) {
      // Main's toolchain, handed nothing: an input, an `env:` or a
      // `continue-on-error:` would change what it does or what a refusal means.
      keyProblem(s, ["name", "id", "if", "uses"]);
      continue;
    }
    if (s.uses?.startsWith("./")) {
      problem("action", s, `${s.uses} is a local action other than main's toolchain (${TOOLCHAIN_USE}): the workspace is the branch's`);
      continue;
    }

    // The steps pinned to their shape: clearing a side directory, checking
    // main out to it, staging or moving it, and the write into `.git`.
    const script = s.script?.trimEnd() ?? null;
    const clear = /^rm -rf (\.trusted-[\w-]+)$/.exec(script ?? "");
    if (clear) {
      keyProblem(s, ["name", "if", "run"]);
      cleared.add(clear[1]);
      continue;
    }
    if (i === installAt + 1 && script === EXCLUDE_SCRIPT) {
      keyProblem(s, ["name", "if", "run"]);
      continue;
    }
    if (isCheckout(s)) {
      const dir = /^\.trusted-[\w-]+$/.test(String(s.with.path ?? "")) ? s.with.path : null;
      const paths = String(s.with["sparse-checkout"] ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
      const want = { ref: "main", path: dir, "sparse-checkout": s.with["sparse-checkout"], "sparse-checkout-cone-mode": false, "persist-credentials": false };
      if (!dir || !sameMapping(s.with, want) || paths.length === 0 || paths.some((p) => !SIDE_PATHS.has(p))) {
        problem("pinned-step", s, `a checkout after the branch's must be main's ${[...SIDE_PATHS].join(", ")} into a .trusted-* directory, with exactly ${Object.keys(want).join(", ")}`);
      }
      if (dir && !cleared.has(dir)) problem("side-dir", s, `checks main out to ${dir} without clearing that path first (rm -rf ${dir}, after the branch checkout): the branch can have put a link there`);
      if (dir === TOOLCHAIN_DIR && !sameMapping(s.with, TOOLCHAIN_CHECKOUT)) problem("pinned-step", s, `the toolchain checkout must be exactly ${JSON.stringify(TOOLCHAIN_CHECKOUT)}`);
      keyProblem(s, ["name", "if", "uses", "with"]);
      continue;
    }
    if (s.isRun) {
      const stagedHere = stageStep(s.script, false);
      if (stagedHere) {
        keyProblem(s, ["name", "id", "if", "run"]);
        for (const d of stagedHere) staged.add(d);
        continue;
      }
      const move = moveStep(s.script);
      if (move) {
        keyProblem(s, ["name", "if", "run"]);
        staged.add(move.to);
        continue;
      }
      if (looksLikeStaging(s.script)) {
        problem("pinned-step", s, "stages or moves main's scripts with something other than the pinned copy, move and removal");
        continue;
      }
    }

    for (const k of s.keys) if (!STEP_KEYS.has(k)) problem("step-keys", s, `has a key this guard does not read: ${k}`);
    common(s);
    if (s.uses) {
      if (s.uses.startsWith("actions/download-artifact@")) {
        const into = /^\$\{\{ runner\.temp \}\}\/([\w-]+)\/?$/.exec(String(s.with.path ?? ""));
        if (!into) problem("download-path", s, "downloads somewhere other than one directory in the runner's temp directory");
        else if (staged.has(into[1])) problem("download-path", s, "downloads into a staged copy of main's scripts");
        for (const k of Object.keys(s.with)) if (!["name", "path", "run-id", "github-token"].includes(k)) problem("action", s, `download-artifact is given ${k}`);
      } else if (s.uses.startsWith("actions/github-script@")) {
        githubScript(s, ["retries", "script", "github-token"]);
      } else if (s.uses.startsWith("actions/setup-node@")) {
        // Given a literal version and nothing else, it reads no file of the
        // workspace: no `node-version-file`, no `cache`, no registry `.npmrc`.
        if (!(Object.keys(s.with).length === 1 && /^\d+(\.x)?$/.test(String(s.with["node-version"] ?? "")))) problem("action", s, "setup-node after the branch checkout is given something other than a literal node-version");
      } else if (s.uses.startsWith("oven-sh/setup-bun@")) {
        // The Bun claude-code-action is handed, instead of the one it would
        // install from the Actions cache. A literal version and `no-cache:
        // true`, nothing else: no `bun-version-file` (a workspace file), no
        // registry or scope (which write configuration), no cache restore.
        const w = s.with;
        if (!(Object.keys(w).length === 2 && /^\d+\.\d+\.\d+$/.test(String(w["bun-version"] ?? "")) && w["no-cache"] === true)) problem("action", s, "setup-bun is given something other than a literal bun-version and no-cache: true");
      } else {
        problem("action", s, `${s.uses} is not an action this guard knows to stay out of the workspace`);
      }
      if (/agent-tool/.test(s.text)) problem("staged-name", s, "names the staged scripts");
      continue;
    }
    if (!s.isRun) continue;
    const runsNode = shell(s, { preBranch: false });
    if (runsNode || /agent-tool|RUNNER_TEMP[^\n]*\.m?js|runner\.temp[^\n]*\.m?js/.test(s.script)) {
      if (i < installAt) usesBefore++;
      else usesAfter++;
    }
  }
  return { problems, usesBefore, usesAfter };
}

// How many times the four jobs run a staged script between the branch checkout
// and the toolchain, and between the toolchain and the agent. A change is the
// prompt to read the new site against the allow-list, not a nuisance.
const USES_BEFORE_INSTALL = 4;
const USES_AFTER_INSTALL = 11;

const formatProblems = (ps) => ps.map((p) => `  [${p.rule}] ${p.step}: ${p.message}`).join("\n");

test("from the job's first step to the agent, trusted steps run only what is allowed", () => {
  // AN ALLOW-LIST, NOT A LIST OF FORBIDDEN SPELLINGS. Every simple command of
  // every shell step is one of a few known to write nothing into the
  // workspace and run nothing from it, with arguments that keep it so; every
  // redirection names one of the runner's own files; every assignment and
  // `env:` name is one this stretch uses, and none that steers how a later
  // command is found or what it loads; every action is one known not to
  // write into the workspace, and a github-script makes only the calls the
  // workflows make today. The steps that must do something else — the side
  // checkouts of main and their staging, the toolchain and the `.git/info/
  // exclude` line after it — are pinned to their shape. Before the branch
  // checkout, main's own scripts may run, but nothing may bring anything else
  // into the workspace.
  let usesBefore = 0;
  let usesAfter = 0;
  const found = [];
  for (const [file, name] of INSTALLING_JOBS) {
    const r = stretchProblems(parseWorkflow(WF_TEXT(file), file), name);
    if (r.problems.length > 0) found.push(`${file} (job ${name}):\n${formatProblems(r.problems)}`);
    usesBefore += r.usesBefore;
    usesAfter += r.usesAfter;
  }
  assert.deepEqual(found, [], found.join("\n"));
  // Between the branch checkout and the toolchain — iterate: the configuration
  // read and its paged steps (metrics, set-state, loop-status). After it — fix:
  // the scope hook and the picker; panel fix: set-state, the scope hook and the
  // no-credential page; iterate: the diagnosis, the scope hook, set-state and
  // the picker; reply: the configuration read and the picker.
  assert.equal(usesBefore, USES_BEFORE_INSTALL, `found ${usesBefore} uses of the staged scripts between the branch checkout and the toolchain`);
  assert.equal(usesAfter, USES_AFTER_INSTALL, `found ${usesAfter} uses of the staged scripts between the toolchain and the agent`);
});

// THE NAMED EDITS. Each is applied to a synthetic job of the same shape
// (scripts/test/fixtures/agent-guard-workflow.yml), not to the real
// workflows, so a step renamed or moved there never moves a case. The m* cases
// come from an adversarial review of the guard, the B* cases from a second
// one, the t* cases from the switch to the shared workflows; each names the
// rule that must refuse it. The cases that held the digest record and the
// order of each staged use after a check went with those steps (see "What
// changed at the switch" above).
const FIXTURE = readFileSync(path.join(REPO, "scripts/test/fixtures/agent-guard-workflow.yml"), "utf8");
const FIXTURE_JOB = "iterate";

/** A line of the head-recording step's block; `rb(...)` puts these lines before it. */
const RB = '          echo "at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$GITHUB_OUTPUT"\n';
const rb = (...pre) => [RB, pre.map((l) => `          ${l}\n`).join("") + RB];
const SS = '        run: node "$RUNNER_TEMP/agent-tools/set-state.mjs" "$PR" fixing\n';
const SS_ENV = "          PR: ${{ steps.attempts.outputs.pr }}\n" + SS;
const AT_BEFORE_FIX = "      - name: Record branch head before fix\n";
const gs = (code) => [AT_BEFORE_FIX, `      - name: m\n        uses: actions/github-script@0000000000000000000000000000000000000002 # v7.1.0\n        with:\n          script: |\n            ${code}\n${AT_BEFORE_FIX}`];
/** Between the branch checkout and the toolchain. */
const AT_INSTALL = "      - name: Clear the path the toolchain action is checked out to\n";
const pre = (step) => [AT_INSTALL, `${step}${AT_INSTALL}`];
const AT_BRANCH = "      - name: Check out the branch\n";
const preBranch = (step) => [AT_BRANCH, `${step}${AT_BRANCH}`];
const JOB_PERMS = "    permissions:\n      contents: read\n";
const SET_FIXING = "      - name: Set state to fixing\n        if: steps.guard.outputs.proceed == 'true'\n";
const MAXL = "            const max = parseInt(process.env.MAX_ATTEMPTS, 10);\n";
const SUMLAST = "          printf '%s\\n' \"$DIAG\" >> \"$GITHUB_STEP_SUMMARY\"\n";
const TOOLCHAIN_STEP = "        uses: ./.trusted-toolchain/.github/actions/agent-toolchain\n";
const EXCLUDE_STEP = "      - name: Keep the toolchain action out of the fixer's commits\n        if: steps.guard.outputs.proceed == 'true'\n        run: echo '/.trusted-toolchain/' >> .git/info/exclude\n";
const HOOKS_LINE = '          HOOKS="$RUNNER_TEMP/agent-hooks"\n';
const SIDE_TOOLCHAIN = "          path: .trusted-toolchain\n          sparse-checkout: .github/actions/agent-toolchain\n";
const BRANCH_TOKEN = "          token: ${{ steps.agent-token.outputs.token }}\n";

const MUTATIONS = {
  // The source must read the same way for this guard and for GitHub.
  B3_lone_CR_hides_env_key: ["yaml-source", SUMLAST, SUMLAST + "          echo done\r        env:\r          BASH_ENV: ./evil.sh\n"],
  B11_gs_U2028_ends_comment: ["yaml-source", MAXL, MAXL.trimEnd() + " // note\u2028            core.exportVariable('NODE_OPTIONS', '--require ./x.cjs');\n"],
  B12_gs_CR_ends_comment: ["yaml-source", MAXL, MAXL.trimEnd() + " // note\r            core.exportVariable('NODE_OPTIONS', '--require ./x.cjs');\n"],
  B13_cyrillic_node: ["yaml-source", ...rb("n\u043ede ./x.mjs")],
  B6_merge_key: ["yaml-source", AT_BEFORE_FIX, "      - name: m\n        <<: *evil\n" + AT_BEFORE_FIX],
  y1_anchor_and_alias: ["yaml-source", JOB_PERMS, "    env: &e\n      X: y\n    outputs: *e\n" + JOB_PERMS],
  y2_tag: ["yaml-source", SS, "        run: !!str node \"$RUNNER_TEMP/agent-tools/set-state.mjs\" \"$PR\" fixing\n"],
  y3_second_document: ["yaml-source", "name: guard fixture\n", "---\nname: x\n---\nname: guard fixture\n"],
  y4_duplicate_key: ["yaml-source", SS, SS + '        run: node ./x.mjs\n'],
  y5_tab: ["yaml-source", ...rb("echo\tx")],
  // What a step runs is what YAML reads, not the first physical line.
  B1_plain_scalar_continuation: ["shell-command", SS, SS + "          ; ./node_modules/.bin/evil\n"],
  B1b_plain_cont_on_pinned_clear: ["shell-command", "        run: rm -rf .trusted-agent\n", "        run: rm -rf .trusted-agent\n          ; ./node_modules/.bin/evil\n"],
  B2_block_header_comment: ["shell-command", SS, "        run: | # the remote tip, not HEAD\n          echo hi\n          ./node_modules/.bin/evil\n"],
  B9_run_folded: ["shell-command", SS, "        run: >-\n          echo hi\n          ; ./node_modules/.bin/evil\n"],
  B9b_run_literal_strip: ["shell-command", SS, "        run: |-\n          echo hi\n          ./node_modules/.bin/evil\n"],
  B7_shell_python: ["step-keys", SET_FIXING, SET_FIXING + "        shell: python\n"],
  g16_hash_line_closes_quote: ["shell-command", ...rb("echo '", "#'", "cp a b")],
  g49_run_disguised_as_download: ["shell-command", ...rb("cp a b", "uses: actions/download-artifact@0000000000000000000000000000000000000003 # v4.3.0", "path: ${{ runner.temp }}/x")],
  g55_operator_only_script: ["shell-unreadable", SS, "        run: '| # nothing'\n"],
  // Where the branch enters, and what may run before it.
  B4_unrecognised_branch_checkout_first: ["shell-command", ...preBranch("      - uses: actions/checkout@0000000000000000000000000000000000000001 # v4.4.0\n        with:\n          ref: ${{ github.event.workflow_run.head_commit.id }}\n          persist-credentials: false\n      - name: m\n        env:\n          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n        run: ./scripts/ci.sh\n")],
  g56_second_branch_checkout: ["pinned-step", AT_INSTALL, "      - uses: actions/checkout@0000000000000000000000000000000000000001 # v4.4.0\n        with:\n          ref: refs/pull/1/head\n" + AT_INSTALL],
  g57_pre_branch_gh_pr_checkout: ["shell-arguments", ...preBranch("      - name: m\n        env:\n          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n        run: gh pr checkout 1\n")],
  g58_pre_branch_git_checkout: ["shell-arguments", ...preBranch("      - name: m\n        run: git checkout FETCH_HEAD\n")],
  g59_pre_branch_github_env: ["redirect-target", ...preBranch('      - name: m\n        run: echo "BASH_ENV=$PWD/x.sh" >> "$GITHUB_ENV"\n')],
  g60_pre_branch_exportVariable: ["github-script", "              core.setFailed(`@${actor} lacks write access`);\n", "              core.setFailed(`@${actor} lacks write access`);\n            }\n            {\n              core.exportVariable('BASH_ENV', './x.sh');\n"],
  g61_pre_branch_checkout_other_repo: ["pre-branch-checkout", "          ref: main\n          persist-credentials: false\n      - uses: actions/setup-node", "          ref: main\n          repository: someone/else\n          persist-credentials: false\n      - uses: actions/setup-node"],
  g62_pre_branch_unknown_action: ["action", ...preBranch("      - uses: ./.github/actions/setup\n")],
  g63_pre_branch_download_into_workspace: ["download-path", "          path: /tmp/agent-sdk\n", "          path: node_modules/.bin\n"],
  g64_pre_branch_unpinned_stage: ["pinned-step", '          cp -R ./scripts/agent "${{ runner.temp }}/agent-tools"\n', '          cp -R ./scripts/agent "$RUNNER_TEMP/agent-tools"\n'],
  g65_pre_branch_env_BASH_ENV: ["env-key", "          DISPATCH_FILE: ${{ runner.temp }}/fix-dispatch.md\n        run: node ./scripts/agent/review-round-guard.mjs", "          DISPATCH_FILE: ${{ runner.temp }}/fix-dispatch.md\n          BASH_ENV: ./x.sh\n        run: node ./scripts/agent/review-round-guard.mjs"],
  // Assignments and env.
  m1_assign_RUNNER_TEMP: ["shell-assignment", SS, '        run: |\n          RUNNER_TEMP="$PWD"\n          node "$RUNNER_TEMP/agent-tools/set-state.mjs" "$PR" fixing\n'],
  m2_prefix_NODE_OPTIONS: ["shell-assignment", SS, '        run: NODE_OPTIONS="--require ./x.cjs" node "$RUNNER_TEMP/agent-tools/set-state.mjs" "$PR" fixing\n'],
  m3_yaml_env_NODE_OPTIONS: ["env-key", SS_ENV, "          PR: ${{ steps.attempts.outputs.pr }}\n          NODE_OPTIONS: --require ./x.cjs\n" + SS],
  m3b_yaml_env_RUNNER_TEMP: ["env-key", SS_ENV, "          PR: ${{ steps.attempts.outputs.pr }}\n          RUNNER_TEMP: ${{ github.workspace }}\n" + SS],
  m8_assign_PATH: ["shell-assignment", ...rb('PATH="$PWD/bin:$PATH"')],
  m9_assign_GITHUB_OUTPUT: ["shell-assignment", ...rb('GITHUB_OUTPUT="$PWD/node_modules/.bin/git"', 'echo x > "$GITHUB_OUTPUT"')],
  g1_assign_unlisted_local: ["shell-assignment", ...rb("y=1")],
  g2_assign_listed_local_as_prefix: ["shell-assignment", ...rb("DIAG=1 echo x")],
  g3_job_env_NODE_OPTIONS: ["env-key", JOB_PERMS, JOB_PERMS + "    env:\n      NODE_OPTIONS: --require ./x.cjs\n"],
  g3b_job_env_unlisted: ["env-key", JOB_PERMS, JOB_PERMS + "    env:\n      WAFFLEBASE_AGENT_AUTONOMOUS: \"true\"\n"],
  g4_workflow_env_BASH_ENV: ["env-key", '  MAX_ATTEMPTS: "4"\n', '  MAX_ATTEMPTS: "4"\n  BASH_ENV: ./x.sh\n'],
  g5_step_env_flow_mapping: ["env-key", "        env:\n          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n" + SS_ENV, "        env: { NODE_OPTIONS: x }\n" + SS],
  g6_verify_env_BASH_ENV: ["env-key", "          EXPECTED: ${{ github.event.workflow_run.head_sha }}\n", "          EXPECTED: ${{ github.event.workflow_run.head_sha }}\n          BASH_ENV: ./x.sh\n"],
  g7_job_defaults_shell: ["defaults", JOB_PERMS, JOB_PERMS + "    defaults:\n      run:\n        shell: sh {0}\n"],
  B8_job_container_env: ["job-container", JOB_PERMS, JOB_PERMS + "    container:\n      image: node:22\n      env:\n        NODE_OPTIONS: --require ./x.cjs\n"],
  g66_job_services: ["job-container", JOB_PERMS, JOB_PERMS + "    services:\n      x:\n        image: alpine\n        volumes:\n          - /home/runner/work:/w\n"],
  g8_working_directory_workspace: ["working-directory", SET_FIXING, SET_FIXING + "        working-directory: ${{ github.workspace }}/x\n"],
  g9_shell_key: ["step-keys", SET_FIXING, SET_FIXING + "        shell: sh {0}\n"],
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
  B10_expr_in_run: ["shell-unreadable", RB, '          echo "${{ steps.attempts.outputs.pr }}" >> "$GITHUB_OUTPUT"\n'],
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
  g25_gh_bodyfile_renamed: ["shell-arguments", 'gh pr comment "$PR" --body-file "$RUNNER_TEMP/no-credential.md"', 'gh pr comment "$PR" --body-file "$RUNNER_TEMP/elsewhere.md"'],
  g26_rev_parse_option: ["shell-arguments", 'ACTUAL="$(git rev-parse HEAD)"', 'ACTUAL="$(git rev-parse --git-path hooks)"'],
  m19_preinstall_node_ws: ["shell-arguments", ...pre("      - name: m\n        env:\n          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n        run: node scripts/verify-self.mjs\n")],
  m15_ctl_semicolon: ["shell-command", ...rb("echo x; cp a b")],
  g27_let: ["shell-command", ...rb("let x=1")],
  g28_cd: ["shell-command", ...rb("cd /")],
  g29_export: ["shell-command", ...rb("export DIAG")],
  m20_preinstall_sh_ws: ["shell-command", ...pre("      - name: m\n        env:\n          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n        run: ./scripts/ci.sh\n")],
  m21_preinstall_npx: ["shell-command", ...pre("      - name: m\n        run: npx --yes tsx scripts/x.ts\n")],
  m14_ctl_GITHUB_ENV: ["redirect-target", ...rb('echo "X=1" >> "$GITHUB_ENV"')],
  g30_redirect_into_workspace: ["redirect-target", ...rb("echo x > node_modules/.bin/git")],
  // github-script.
  m11_gs_addPath: ["github-script", ...gs("core.addPath('/home/runner/work/x/node_modules/.bin');")],
  m12_gs_BASH_ENV: ["github-script", ...gs("core.exportVariable('BASH_ENV', '/tmp/x.sh');")],
  m13_gs_ctor: ["github-script", ...gs("const P=[].constructor.constructor('return pro'+'cess')(); P.mainModule['req'+'uire']('f'+'s').writeFileSync('x','y');")],
  g31_gs_bracket: ["github-script", ...gs("core['addPath']('x');")],
  g32_gs_alias_root: ["github-script", ...gs("const c = core; c.addPath('x');")],
  g33_gs_process_env_write: ["github-script", ...gs("process.env.PATH = '/x';")],
  g34_gs_tagged_template: ["github-script", ...gs("String.raw`x`;")],
  g35_gs_after_branch: ["github-script", MAXL, MAXL + "            core.exportVariable('NODE_OPTIONS', '--require ./x.cjs');\n"],
  g36_gs_extra_input: ["github-script", "        id: attempts\n        uses: actions/github-script@0000000000000000000000000000000000000002 # v7.1.0\n        with:\n", "        id: attempts\n        uses: actions/github-script@0000000000000000000000000000000000000002 # v7.1.0\n        with:\n          result-encoding: json\n"],
  g37_other_action: ["action", AT_BEFORE_FIX, "      - name: m\n        uses: actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830 # v4.3.0\n        with:\n          path: x\n          key: y\n" + AT_BEFORE_FIX],
  g54_local_action_from_branch: ["action", ...pre("      - name: m\n        uses: ./.github/actions/setup\n")],
  g38_download_into_workspace: ["download-path", "          path: ${{ runner.temp }}/ci-reports\n", "          path: ci-reports\n"],
  g50_gs_names_staged: ["staged-name", ...gs("core.info('agent-tools');")],
  // The pinned steps.
  g39_preinstall_prefix_on_staged: ["shell-assignment", '        run: node "$RUNNER_TEMP/agent-tools/set-state.mjs" "$PR" blocked\n', '        run: NODE_OPTIONS=--require=./x.cjs node "$RUNNER_TEMP/agent-tools/set-state.mjs" "$PR" blocked\n'],
  g40_stage_with_extra_command: ["pinned-step", '          cp -R .trusted-agent/scripts/agent "${{ runner.temp }}/agent-tools"\n', '          cp -R .trusted-agent/scripts/agent "${{ runner.temp }}/agent-tools"\n          node .trusted-agent/x.mjs\n'],
  g41_side_checkout_lfs: ["pinned-step", "          path: .trusted-agent\n", "          path: .trusted-agent\n          lfs: true\n"],
  g52_install_shell: ["step-keys", TOOLCHAIN_STEP, TOOLCHAIN_STEP + "        shell: sh -c './x'\n"],
  g53_install_continue_on_error: ["pinned-step", TOOLCHAIN_STEP, TOOLCHAIN_STEP + "        continue-on-error: true\n"],
  // The shared workflows' shape: main's toolchain action, its side directory,
  // the staged copies and the fix-scope hook.
  t1_toolchain_from_the_branch: ["shape", TOOLCHAIN_STEP, "        uses: ./.github/actions/agent-toolchain\n"],
  t2_toolchain_given_an_input: ["pinned-step", TOOLCHAIN_STEP, TOOLCHAIN_STEP + "        with:\n          x: y\n"],
  t3_toolchain_given_env: ["pinned-step", TOOLCHAIN_STEP, TOOLCHAIN_STEP + "        env:\n          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n"],
  t4_toolchain_checkout_whole_tree: ["pinned-step", SIDE_TOOLCHAIN, "          path: .trusted-toolchain\n"],
  t5_toolchain_checkout_from_branch_ref: ["pinned-step", "          ref: main\n          path: .trusted-toolchain\n", "          ref: ${{ github.event.workflow_run.head_sha }}\n          path: .trusted-toolchain\n"],
  t6_toolchain_path_not_cleared: ["side-dir", "        run: rm -rf .trusted-toolchain\n", '        run: echo "kept"\n'],
  t7_side_checkout_more_than_scripts: ["pinned-step", "            scripts/ci\n", "            scripts/ci\n            .github/workflows\n"],
  t8_no_exclude_after_toolchain: ["after-install", EXCLUDE_STEP, ""],
  t9_exclude_writes_a_hook: ["after-install", "        run: echo '/.trusted-toolchain/' >> .git/info/exclude\n", "        run: echo 'exec ./x' >> .git/hooks/post-checkout\n"],
  t10_branch_checkout_persists_another_token: ["branch-checkout", BRANCH_TOKEN, "          token: ${{ steps.app-token.outputs.token }}\n"],
  t11_hooks_path_into_workspace: ["shell-arguments", HOOKS_LINE, '          HOOKS="$PWD/.git/hooks"\n'],
  t12_hooks_path_assigned_twice: ["shell-arguments", HOOKS_LINE, HOOKS_LINE + '          HOOKS="$PWD/hooks"\n'],
  t13_git_config_other_key: ["shell-arguments", '          git config core.hooksPath "$HOOKS"\n', '          git config core.fsmonitor "$HOOKS"\n'],
  t14_gh_api_other_call: ["shell-arguments", "        run: gh api -X DELETE installation/token\n", "        run: gh api -X POST repos/o/r/dispatches\n"],
  t15_stage_sets_another_variable: ["pinned-step", '          echo "AGENT_HARNESS_CONFIG_DIR=${{ runner.temp }}/agent-harness" >> "$GITHUB_ENV"\n          cp -R .trusted-agent', '          echo "NODE_OPTIONS=--require ./x.cjs" >> "$GITHUB_ENV"\n          cp -R .trusted-agent'],
  t16_stage_keeps_the_side_directory: ["pinned-step", "          rm -rf .trusted-agent\n      - name: Attempts guard\n", "      - name: Attempts guard\n"],
  t17_node_from_unstaged_directory: ["shell-arguments", "          TOOLS: ${{ runner.temp }}/trusted-scripts\n", "          TOOLS: ${{ runner.temp }}/ci-reports\n"],
  t18_move_into_workspace: ["pinned-step", '          mv .trusted-cred "$RUNNER_TEMP/trusted-cred"\n', "          mv .trusted-cred ./cred\n"],
  t19_write_into_staged_copy: ["redirect-target", ...rb('echo x > "$RUNNER_TEMP/agent-tools/set-state.mjs"')],
  t20_download_into_staged_copy: ["download-path", "          path: ${{ runner.temp }}/ci-reports\n", "          path: ${{ runner.temp }}/agent-tools\n"],
  t21_setup_node_cache_after_branch: ["action", ...pre("      - uses: actions/setup-node@0000000000000000000000000000000000000005 # v4.4.0\n        with:\n          node-version: 22.x\n          cache: pnpm\n")],
  t23_bun_from_the_cache: ["action", "          no-cache: true\n", "          no-cache: false\n"],
  t24_bun_version_from_the_workspace: ["action", '          bun-version: "1.3.14"\n', "          bun-version-file: .bun-version\n"],
  t25_bun_registry: ["action", "          no-cache: true\n", "          no-cache: true\n          registry-url: https://example.test/\n"],
  t22_pnpm_after_toolchain: ["shell-command", SS, "        run: pnpm --filter @wafflebase/backend exec prisma generate\n"],
};

// Edits the guard must ACCEPT: what a maintainer may reasonably write. Each
// case is the fixture with one such edit; it must come back with no problem.
const ACCEPTED = {
  F1_notice_echo_step: [AT_BEFORE_FIX, "      - name: Announce\n        if: steps.guard.outputs.proceed == 'true'\n        env:\n          BRANCH: ${{ github.event.workflow_run.head_branch }}\n        run: echo \"::notice::Fixing CI on $BRANCH\"\n" + AT_BEFORE_FIX],
  F2_core_notice: [MAXL, MAXL + "            core.notice(`max attempts: ${max}`);\n"],
  F3_rename_step: [AT_BEFORE_FIX, "      - name: Record the remote branch head before the fix\n"],
  F4_comment_in_run_block: [SUMLAST, "          # Keep the diagnosis for the job summary as well.\n" + SUMLAST],
  F5_continue_on_error: ["        id: before-fix\n", "        id: before-fix\n        continue-on-error: true\n"],
  F6_gh_pr_comment_step: [AT_BEFORE_FIX, "      - name: Tell the PR a fix is starting\n        if: steps.guard.outputs.proceed == 'true'\n        continue-on-error: true\n        env:\n          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n          PR: ${{ steps.attempts.outputs.pr }}\n        run: gh pr comment \"$PR\" --body \"CI failed; the fixer is starting.\"\n" + AT_BEFORE_FIX],
  F8_timeout_minutes: ["        uses: actions/download-artifact@0000000000000000000000000000000000000003 # v4.3.0\n        with:\n          name: ci-lane-reports\n", "        timeout-minutes: 5\n        uses: actions/download-artifact@0000000000000000000000000000000000000003 # v4.3.0\n        with:\n          name: ci-lane-reports\n"],
  F8b_timeout_after_run_block: [SUMLAST, SUMLAST + "        timeout-minutes: 5\n"],
  F9_folded_run: [AT_BEFORE_FIX, "      - name: Announce\n        run: >-\n          echo \"::notice::a long\n          message\"\n" + AT_BEFORE_FIX],
  F9b_strip_run: [AT_BEFORE_FIX, "      - name: Announce\n        run: |-\n          echo \"::notice::short\"\n" + AT_BEFORE_FIX],
  F10_env_after_run_block: [AT_BEFORE_FIX, "      - name: Announce\n        run: |\n          echo \"::notice::Fixing CI on $BRANCH\"\n        env:\n          BRANCH: ${{ github.event.workflow_run.head_branch }}\n" + AT_BEFORE_FIX],
  F11_setup_node_after_branch: pre("      - uses: actions/setup-node@0000000000000000000000000000000000000005 # v4.4.0\n        with:\n          node-version: 22.x\n"),
  F12_toolchain_id: [TOOLCHAIN_STEP, TOOLCHAIN_STEP + "        id: toolchain\n"],
  F13_branch_checkout_without_credential: [BRANCH_TOKEN, "          persist-credentials: false\n"],
  a1_block_header_comment_on_safe_step: [AT_BEFORE_FIX, "      - name: Announce\n        run: | # say what we fix\n          echo hi\n" + AT_BEFORE_FIX],
  a2_core_error_and_debug: [MAXL, MAXL + "            core.debug('x');\n            core.error('y');\n"],
};

/** The fixture with one edit; a moved anchor is a broken case, said as such. */
function editFixture(name, from, to) {
  assert.equal(FIXTURE.split(from).length, 2, `fixture anchor moved or repeated: update the case ${name} (scripts/test/fixtures/agent-guard-workflow.yml must contain exactly once:\n${from})`);
  return FIXTURE.replace(from, () => to);
}

test("the fixture job is one the guard accepts, so each case below changes one thing", () => {
  const r = stretchProblems(parseWorkflow(FIXTURE, "fixture"), FIXTURE_JOB);
  assert.deepEqual(r.problems, [], formatProblems(r.problems));
  assert.ok(r.usesAfter >= 4 && r.usesBefore >= 1, `the fixture uses the staged scripts ${r.usesBefore} times before the toolchain and ${r.usesAfter} after`);
});

test("each workflow edit the guard must refuse is refused, by the rule it names", async (t) => {
  for (const [name, [rule, from, to]] of Object.entries(MUTATIONS)) {
    await t.test(`${name} is refused by ${rule}`, () => {
      const { problems } = stretchProblems(parseWorkflow(editFixture(name, from, to), "fixture"), FIXTURE_JOB);
      assert.ok(problems.some((p) => p.rule === rule), `${name} was not refused by ${rule}:\n${formatProblems(problems) || "  (refused by nothing)"}`);
    });
  }
});

test("each edit a maintainer may reasonably make is accepted", async (t) => {
  for (const [name, [from, to]] of Object.entries(ACCEPTED)) {
    await t.test(name, () => {
      const { problems } = stretchProblems(parseWorkflow(editFixture(name, from, to), "fixture"), FIXTURE_JOB);
      assert.deepEqual(problems, [], `${name} was refused:\n${formatProblems(problems)}`);
    });
  }
});

test("the guard's messages say what to do", () => {
  const run = (from, to) => formatProblems(stretchProblems(parseWorkflow(editFixture("message", from, to), "fixture"), FIXTURE_JOB).problems);
  assert.match(run(MAXL, MAXL + "            core.setSecret('x');\n"), /the calls allowed are .*core\.info/);
  assert.match(run(...rb('gh pr comment $PR --body "x"')), /quote the variable/);
  assert.match(run(...rb("cp a b")), /commands allowed before the agent \(echo, /);
  assert.match(run(TOOLCHAIN_STEP, "        uses: ./.github/actions/agent-toolchain\n"), /main's toolchain action \(\.\/\.trusted-toolchain/);
});

test("a refused install is reported where the job has no other way to say so", () => {
  // A toolchain that refuses the branch fails the installing job before the
  // agent runs. Each job's report must still reach the person who asked.
  // agent-fix: the report job runs on every outcome once the job proceeded,
  // and says when the agent never ran.
  const fixReport = job("agent-fix.yml", "report");
  assert.equal(String(fixReport.raw.if).trim(), "always() && needs.fix.outputs.proceed == 'true'");
  assert.match(WF_TEXT("agent-fix.yml"), /const neverRan = process\.env\.AGENT === '' \|\| process\.env\.AGENT === 'skipped';/);
  // agent-iterate-ci: the report job pages when the fix produced no commit.
  const iterateReport = job("agent-iterate-ci.yml", "report");
  assert.equal(String(iterateReport.raw.if).trim(), "always() && needs.iterate.outputs.proceed == 'true'");
  const page = iterateReport.steps.find((s) => s.name === "Page if the fix produced no commit");
  assert.match(page?.cond ?? "", /^always\(\) && steps\.after\.outputs\.advanced != 'true'$/);
  // The panel's `fix` job is paged by the `stalled` job.
  assert.match(WF_TEXT("agent-review-panel.yml"), /\(needs\.fix\.result == 'failure' && needs\.fix-report\.outputs\.infra_paged != 'true'\)/);
  // agent-review-reply: A KNOWN GAP, exactly as it is. wafflebase's own reply
  // job commented on the pull request when the install failed; the shared
  // one's report job posts only the agent's reply file, so a refused install
  // is a red job and silence for the person who wrote `@claude`. It is an
  // upstream candidate (.github/agent-harness/README.md); this pins the gap
  // so the day the report job reads the reply job's outcome, the test says so.
  const replyReport = job("agent-review-reply.yml", "report");
  const reads = replyReport.steps.some((s) => /needs\.reply\.(result|outputs\.agent)|failure\(\)/.test(`${s.cond}\n${s.text}`));
  assert.equal(reads, false, "upstream fixed the reply report — assert here that it reports a failed toolchain, and drop the gap from the harness README");
});

test("the installing jobs' setup reads nothing from the workspace, and pnpm comes only from the toolchain action", () => {
  // Node is set up with a literal version and nothing else: no
  // `node-version-file`, no `cache`, no registry `.npmrc` — the inputs that
  // read the workspace, which by then may be the branch's. pnpm is not set up
  // by any step: the toolchain action fetches the pinned version itself, and
  // `.github/agent-harness/toolchain.test.mjs` holds that version to the root
  // `packageManager`.
  for (const [file, name] of [...INSTALLING_JOBS, ["agent-implement.yml", "implement"]]) {
    const where = `${file} (job ${name})`;
    const { steps } = job(file, name);
    const setups = steps.filter((s) => s.uses?.startsWith("actions/setup-node@"));
    assert.equal(setups.length, 1, `${where} must use actions/setup-node exactly once`);
    assert.ok(Object.keys(setups[0].with).length === 1 && /^\d+(\.x)?$/.test(String(setups[0].with["node-version"] ?? "")), `${where}: setup-node is given more than a literal node-version`);
    assert.ok(!steps.some((s) => s.uses?.startsWith("pnpm/action-setup@")), `${where} sets pnpm up from an action: pnpm comes from the toolchain action`);
  }
});

// GitHub's own actions, at a major tag, in the jobs below. The shared
// workflows pin the third-party actions (`create-github-app-token`,
// `claude-code-action`) to a commit and these to a tag; wafflebase's own
// workflows pinned every one. Accepted at the switch, and an upstream
// candidate (.github/agent-harness/README.md). Exact: a new tag-pinned action
// fails, and so does one of these once upstream pins it.
const TAG_PINNED_KNOWN = ["actions/checkout@v4", "actions/download-artifact@v4", "actions/github-script@v7", "actions/setup-node@v4", "actions/upload-artifact@v4"];

test("every action in a job that installs dependencies with a token is pinned to a commit, but GitHub's own at the known tags", () => {
  // The four installing jobs, and `agent-implement`, which installs main. A
  // tag can be moved; a job that holds an App token and model credentials
  // runs whatever the tag points at that day.
  let checked = 0;
  const tagged = new Set();
  for (const [file, name] of [...INSTALLING_JOBS, ["agent-implement.yml", "implement"]]) {
    for (const s of job(file, name).steps) {
      if (!s.uses || s.uses.startsWith("./")) continue;
      checked++;
      if (TAG_PINNED_KNOWN.includes(s.uses)) {
        tagged.add(s.uses);
        continue;
      }
      assert.match(s.usesLine.trim(), PINNED, `${file} (job ${name}) must pin ${s.uses} to a commit, with the version in a comment`);
    }
  }
  assert.ok(checked >= 40, `inspected only ${checked} uses: lines`);
  assert.deepEqual([...tagged].sort(), TAG_PINNED_KNOWN, "an action on TAG_PINNED_KNOWN is pinned to a commit now: drop it from the list");

  // `agent-implement` installs main with the toolchain action from the
  // workspace, so the workspace must be main: every checkout names it.
  const implement = job("agent-implement.yml", "implement").steps;
  const checkouts = implement.filter((s) => s.uses?.startsWith("actions/checkout@"));
  assert.ok(checkouts.length >= 1);
  for (const c of checkouts) assert.equal(c.with.ref, "main", "agent-implement.yml must check out main by name");
  const toolchainAt = implement.findIndex((s) => s.uses === "./.github/actions/agent-toolchain");
  const workspaceAt = implement.findIndex((s) => s.uses?.startsWith("actions/checkout@") && s.with.path === undefined);
  assert.ok(workspaceAt >= 0 && toolchainAt > workspaceAt, "agent-implement.yml must use the toolchain action after checking main out into the workspace");
});

test("no agent workflow caches dependencies, installs a branch inline, or sets pnpm up from an action", () => {
  let toolchains = 0;
  for (const f of agentWorkflows) {
    for (const j of jobsOf(f)) {
      const where = `${f} (job ${j.name})`;
      const hasBranch = j.steps.some((s) => s.checksOutBranch);
      for (const s of j.steps) {
        // Every agent job holds a token or a model credential, and a cache
        // saved by one is saved after the agent ran.
        assert.doesNotMatch(s.text, /^\s*cache:/m, `${where} sets cache: on a setup action`);
        assert.ok(!s.uses?.startsWith("actions/cache"), `${where} uses actions/cache`);
        if (s.isRun && hasBranch) {
          assert.doesNotMatch(s.script, /\bpnpm\s+(install|i)\b/, `${where} installs a PR branch inline instead of through the toolchain action`);
        }
        assert.ok(!s.uses?.startsWith("pnpm/action-setup@"), `${where} sets pnpm up from pnpm/action-setup`);
        // The only local action is the toolchain: main's copy beside a branch,
        // or the workspace's where the workspace is main (agent-implement).
        if (s.uses?.startsWith("./")) {
          toolchains++;
          assert.ok(
            s.uses === TOOLCHAIN_USE || (s.uses === "./.github/actions/agent-toolchain" && !hasBranch),
            `${where} uses the local action ${s.uses}`,
          );
        }
      }
    }
  }
  // Anti-vacuity: the four installing jobs and agent-implement.
  assert.equal(toolchains, 5, `found ${toolchains} uses of the toolchain action`);
});

// ---------------------------------------------------------------------------
// AFTER THE AGENT. A job that runs `claude-code-action` hands the agent Bash,
// Edit and Write over its workspace, and every later step of that job inherits
// what the agent could change: the files, `.git/config`, `$GITHUB_ENV`,
// `$GITHUB_PATH`. So after the agent step, a step may not run repository code
// from the workspace, and may not hold a credential the agent was not given —
// no secret at all, and no App token minted before the agent other than the
// agent's own. Work that needs either belongs in a later job on a fresh runner
// (`agent-implement.yml`'s `finish`).
//
// Staged copies (`$RUNNER_TEMP/agent-tools/…`) are not workspace code here: the
// installing jobs' guards above hold where they come from.

const MODEL_ACTION = "anthropics/claude-code-action@";
const TOKEN_REF = /steps\.([\w-]+)\.outputs\.token/g;
const STAGED_ARG = /^"?(?:\$RUNNER_TEMP|\$\{RUNNER_TEMP\}|\$\{\{\s*runner\.temp\s*\}\})\//;
const RUNNERS = new Set(["node", "pnpm", "npm", "npx", "yarn", "bash", "sh", "python", "python3", "deno", "bun", "make", "source"]);

/** The commands of a script that run code from the workspace. */
function workspaceRuns(script) {
  return codeRuns(script, { staged: false });
}

/** The commands of a script that run code from a file; with `staged: false`, not those under the runner's temp directory. */
function codeRuns(script, { staged = true } = {}) {
  // Quoted text is one word: a message in quotes is not a command, and a quoted
  // path is still the path it names.
  const quoted = [];
  const flat = script.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, (q) => `@@Q${quoted.push(q) - 1}@@`);
  const unquote = (w) => w.replace(/@@Q(\d+)@@/g, (_, i) => quoted[Number(i)]);
  const found = [];
  for (const raw of flat.split(/\n|;|&&|\|\||\||\$\(|`|\(|\)|\{|\}/)) {
    const command = unquote(raw);
    const words = raw.trim().split(/\s+/).filter(Boolean).map(unquote);
    while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift(); // VAR=x prefixes
    if (words.length === 0) continue;
    const [cmd] = words;
    // `bash -c 'printf …' _ "$X"`: a printf written here, in single quotes,
    // with what follows as its arguments — data, not code to run.
    if ((cmd === "bash" || cmd === "sh") && words[1] === "-c" && /^'printf\s[^';&|`()]*'$/.test(words[2] ?? "")) continue;
    if (/^(?:\.{1,2}\/|\/|"?\.?\/?scripts\/)/.test(cmd)) found.push(command.trim()); // ./x, ../x, scripts/x
    else if (RUNNERS.has(cmd)) {
      const target = words.slice(1).find((w) => !w.startsWith("-"));
      if (["pnpm", "npm", "npx", "yarn", "make", "bun"].includes(cmd) || (target !== undefined && (staged || !STAGED_ARG.test(target)))) found.push(command.trim());
    }
  }
  return found;
}

/** A step that loads a module by path from github-script (a builtin is not repository code). */
const loadsModule = (s) =>
  s.uses?.startsWith("actions/github-script@") && /\b(?:require|import)\s*\(\s*(?!["'`](?:node:)?[a-z_]+["'`])/.test(String(s.with.script ?? ""));
/** A step that changes the environment or PATH of every later step of its job. */
const steersLaterSteps = (s) =>
  /\bGITHUB_(?:ENV|PATH)\b/.test(s.text) || (s.uses?.startsWith("actions/github-script@") && /\b(?:exportVariable|addPath)\b/.test(String(s.with.script ?? "")));
const MODEL_ACTION_JOB = (j) => j.steps.some((s) => s.uses?.startsWith(MODEL_ACTION));
/** What the agent step may be given: the credential the pool picker chose (or the unsuffixed one), and one App token. */
const AGENT_OAUTH = new Set([
  "${{ steps.cred.outputs.slot != '' && secrets[format('CLAUDE_CODE_OAUTH_TOKEN_{0}', steps.cred.outputs.slot)] || secrets.CLAUDE_CODE_OAUTH_TOKEN }}",
  "${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}",
]);
const ONE_TOKEN = /^\$\{\{\s*steps\.[\w-]+\.outputs\.token\s*\}\}$/;
/**
 * The pool credential the picker chose, written as one clause per slot
 * (`steps.cred.outputs.slot == 'N' && secrets.CLAUDE_CODE_OAUTH_TOKEN_N`)
 * falling back to the unsuffixed secret. Each clause must name its own slot's
 * secret, so the expression can only ever hand over the picked one.
 */
function slotChain(v) {
  const m = /^\$\{\{([\s\S]*)\}\}$/.exec(v.trim());
  if (!m) return false;
  const parts = m[1].split("||").map((t) => t.replace(/\s+/g, " ").trim());
  if (parts.at(-1) !== "secrets.CLAUDE_CODE_OAUTH_TOKEN" || parts.length < 2) return false;
  return parts.slice(0, -1).every((t) => {
    const c = /^steps\.cred\.outputs\.slot == '([1-9])' && secrets\.CLAUDE_CODE_OAUTH_TOKEN_([1-9])$/.exec(t);
    return c !== null && c[1] === c[2];
  });
}
const CREDENTIAL = /\bsecrets\b|\bgithub\.token\b|\.outputs\.token\b/;

/**
 * Every way a job that runs the agent, or a job that reads what the agent left
 * behind, gives the agent's work a way to run code or reach a credential.
 */
function postAgentProblems(wf) {
  const problems = [];
  for (const j of wf.jobs) {
    const at = j.steps.findIndex((s) => s.uses?.startsWith(MODEL_ACTION));
    if (at < 0) continue;
    const job = `${wf.file} (job ${j.name})`;
    // Workflow- and job-level env reach every step, the agent's included.
    for (const { key, value } of [...wf.env, ...j.env]) {
      if (/\bsecrets\b|\bgithub\.token\b/.test(value)) problems.push(`${job} sets ${key} from a secret at job or workflow level, which the agent step inherits`);
    }
    // The agent step itself: the picked OAuth credential and one App token, nothing else.
    const agent = j.steps[at];
    for (const { key, value } of agent.env) {
      if (CREDENTIAL.test(value)) problems.push(`${job} gives the agent ${key} through env:`);
    }
    for (const [key, value] of Object.entries(agent.with)) {
      const v = String(value);
      if (key === "claude_code_oauth_token") {
        if (!AGENT_OAUTH.has(v.trim()) && !slotChain(v)) problems.push(`${job} gives the agent a credential other than the picked one: ${v}`);
      } else if (key === "github_token") {
        // One App token, or the job's own token where the job may write nothing
        // (the agent's step is handed the job token anyway).
        const readOnlyJobToken = v.trim() === "${{ github.token }}" && !jobTokenWrites(wf, j);
        if (!ONE_TOKEN.test(v.trim()) && !readOnlyJobToken) problems.push(`${job} gives the agent a github_token other than one App token or a read-only job token: ${v}`);
      } else if (CREDENTIAL.test(v)) problems.push(`${job} gives the agent a credential through ${key}`);
    }
    const minted = new Set(j.steps.slice(0, at).filter((s) => s.uses?.startsWith("actions/create-github-app-token@")).map((s) => s.id));
    const given = new Set([...agent.text.matchAll(TOKEN_REF)].map((m) => m[1]));
    for (const s of j.steps.slice(at + 1)) {
      const where = `${job} "${s.name || s.uses || s.id}"`;
      if (/\bsecrets\b|\bgithub\.token\b/.test(s.text)) problems.push(`${where} reads a secret after the agent`);
      for (const [, id] of s.text.matchAll(TOKEN_REF)) {
        if (minted.has(id) && !given.has(id)) problems.push(`${where} holds ${id}, an App token minted before the agent and not given to it`);
      }
      if (s.uses?.startsWith("./")) problems.push(`${where} runs a local action from the workspace`);
      if (s.isRun) for (const c of workspaceRuns(s.script)) problems.push(`${where} runs workspace code: ${c}`);
      if (loadsModule(s)) problems.push(`${where} loads a module from github-script`);
      if (steersLaterSteps(s)) problems.push(`${where} writes the environment or PATH of later steps`);
    }
  }
  // A job that downloads the agent's output is after the agent too, on a fresh
  // runner: it may run main's scripts and nothing else, never steer its later
  // steps, and keep no credential in its checkout.
  const agentJobs = new Set(wf.jobs.filter(MODEL_ACTION_JOB).map((j) => j.name));
  for (const j of wf.jobs) {
    const needs = [].concat(j.raw.needs ?? []);
    if (!needs.some((n) => agentJobs.has(n)) || !j.steps.some((s) => s.uses?.startsWith("actions/download-artifact@"))) continue;
    const job = `${wf.file} (job ${j.name})`;
    for (const s of j.steps) {
      const where = `${job} "${s.name || s.uses || s.id}"`;
      if (s.uses?.startsWith("./")) problems.push(`${where} runs a local action`);
      if (s.isRun) {
        for (const c of codeRuns(s.script)) {
          if (!/^node (?:\.\/)?scripts\/agent(-arms)?\/[\w-]+\.mjs( |$)/.test(c)) problems.push(`${where} runs something other than main's scripts: ${c}`);
        }
      }
      if (loadsModule(s)) problems.push(`${where} loads a module from github-script`);
      if (steersLaterSteps(s)) problems.push(`${where} writes the environment or PATH of later steps`);
      if (s.uses?.startsWith("actions/checkout@") && (s.with.ref !== "main" || s.with["persist-credentials"] !== false)) {
        problems.push(`${where} checks out something other than main, or persists a credential`);
      }
    }
  }
  return problems;
}

/** Whether a job's token can write: its permissions, or the workflow's, grant a write (or are unset). */
function jobTokenWrites(wf, j) {
  const p = j.raw.permissions ?? wf.raw.permissions;
  return p === undefined || p === "write-all" || (isObject(p) && Object.values(p).some((v) => v === "write"));
}

/** Jobs that run the agent with a job token that can write. */
function agentJobsThatCanWrite(wf) {
  return wf.jobs.filter(MODEL_ACTION_JOB).filter((j) => jobTokenWrites(wf, j)).map((j) => `${wf.file} (job ${j.name})`);
}

// The agent jobs whose job token can write, which the agent's step is handed
// too. wafflebase's reply job was on this list; the shared one reads only. The
// three fixers still post their running state and comments with it. Exact: an
// entry that no longer matches fails, so the list can only shrink.
const AGENT_JOB_TOKEN_WRITES_KNOWN = [
  "agent-fix.yml (job fix)",
  "agent-iterate-ci.yml (job iterate)",
  "agent-review-panel.yml (job fix)",
];

test("after the agent, no step runs workspace code or holds a credential the agent was not given", () => {
  let agents = 0;
  const found = [];
  for (const f of agentWorkflows) {
    const wf = parseWorkflow(WF_TEXT(f), f);
    agents += wf.jobs.filter((j) => j.steps.some((s) => s.uses?.startsWith(MODEL_ACTION))).length;
    found.push(...postAgentProblems(wf));
  }
  // wafflebase's own workflows had five steps here, each to be moved to a later
  // job; the shared ones did move them, to the report and finish jobs.
  assert.deepEqual(found, []);
  // The agent's step receives the job token too, so a job that runs it declares
  // read-only permissions, but for the jobs listed above.
  const writers = agentWorkflows.flatMap((f) => agentJobsThatCanWrite(parseWorkflow(WF_TEXT(f), f)));
  assert.deepEqual(writers, AGENT_JOB_TOKEN_WRITES_KNOWN);
  // implement, the three fixers, reply and summarize.
  assert.ok(agents >= 6, `found only ${agents} jobs that run the agent`);
});

const POST_AGENT_FIXTURE = `name: post-agent fixture
on: workflow_dispatch
env:
  GH_REPO: \${{ github.repository }}
jobs:
  work:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - id: pre
        uses: actions/create-github-app-token@0000000000000000000000000000000000000001 # v1
      - id: agent-token
        uses: actions/create-github-app-token@0000000000000000000000000000000000000001 # v1
      - id: agent
        uses: anthropics/claude-code-action@0000000000000000000000000000000000000002 # v1
        with:
          claude_code_oauth_token: \${{ steps.cred.outputs.slot != '' && secrets[format('CLAUDE_CODE_OAUTH_TOKEN_{0}', steps.cred.outputs.slot)] || secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          github_token: \${{ steps.agent-token.outputs.token }}
          prompt: do the work
      - name: Upload
        if: always()
        uses: actions/upload-artifact@0000000000000000000000000000000000000003 # v4
        with:
          name: log
          path: \${{ runner.temp }}/log.json
      - name: Staged
        env:
          GH_TOKEN: \${{ steps.agent-token.outputs.token }}
        run: node "$RUNNER_TEMP/agent-tools/set-state.mjs" "$PR" fixing
  finish:
    needs: [work]
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@0000000000000000000000000000000000000004 # v4
        with:
          ref: main
          persist-credentials: false
      - uses: actions/download-artifact@0000000000000000000000000000000000000005 # v4
        with:
          name: log
          path: \${{ runner.temp }}/agent-output
      - name: Record
        env:
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
        run: node ./scripts/agent/metrics.mjs record --execution "$RUNNER_TEMP/agent-output/log.json"
`;
/** Appended after the last step of the agent's job, or of the job after it. */
const AT_END = '        run: node "$RUNNER_TEMP/agent-tools/set-state.mjs" "$PR" fixing\n';
const AT_FINISH_END = '        run: node ./scripts/agent/metrics.mjs record --execution "$RUNNER_TEMP/agent-output/log.json"\n';
const after = (at, step) => [at, `${at}      - name: m\n${step}`];
const AGENT_WITH = "          prompt: do the work\n";
const WORK_PERMS = "    permissions:\n      contents: read\n    steps:\n      - id: pre\n";
const POST_AGENT_MUTATIONS = {
  // After the agent, in its own job.
  workspace_node: after(AT_END, "        run: node ./scripts/agent/metrics.mjs record\n"),
  workspace_node_bare_path: after(AT_END, "        run: node scripts/agent-arms/harvest.mjs\n"),
  workspace_node_in_block: after(AT_END, "        run: |\n          [ -f x ] || exit 0\n          node ./scripts/agent/session-job-summary.mjs\n"),
  workspace_pnpm: after(AT_END, "        run: pnpm test\n"),
  workspace_script: after(AT_END, "        run: ./scripts/ci.sh\n"),
  workspace_bash: after(AT_END, "        run: bash scripts/x.sh\n"),
  local_action: after(AT_END, "        uses: ./.github/actions/setup\n"),
  github_script_require: after(AT_END, "        uses: actions/github-script@0000000000000000000000000000000000000006 # v7\n        with:\n          script: require('./scripts/x.cjs')\n"),
  github_script_import_workspace: after(AT_END, "        uses: actions/github-script@0000000000000000000000000000000000000006 # v7\n        with:\n          script: await import(`${process.env.GITHUB_WORKSPACE}/x.mjs`)\n"),
  anthropic_key: after(AT_END, "        env:\n          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}\n        run: echo\n"),
  github_token_secret: after(AT_END, "        env:\n          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n        run: gh pr list\n"),
  pre_agent_token: after(AT_END, "        env:\n          GH_TOKEN: ${{ steps.pre.outputs.token }}\n        run: gh api user\n"),
  pre_agent_token_github_script: after(AT_END, "        uses: actions/github-script@0000000000000000000000000000000000000006 # v7\n        with:\n          github-token: ${{ steps.pre.outputs.token }}\n          script: core.info('x')\n"),
  token_minted_after: after(AT_END, "        uses: actions/create-github-app-token@0000000000000000000000000000000000000001 # v1\n        with:\n          private-key: ${{ secrets.AGENT_APP_PRIVATE_KEY }}\n"),
  agent_job_github_env: after(AT_END, '        run: echo "NODE_OPTIONS=--require ./x.cjs" >> "$GITHUB_ENV"\n'),
  // Around the agent: what it inherits, and what it is handed.
  job_env_secret: [WORK_PERMS, "    permissions:\n      contents: read\n    env:\n      K: ${{ secrets.AGENT_APP_PRIVATE_KEY }}\n    steps:\n      - id: pre\n"],
  workflow_env_secret: ["  GH_REPO: ${{ github.repository }}\n", "  GH_REPO: ${{ github.repository }}\n  K: ${{ secrets.ANTHROPIC_API_KEY }}\n"],
  agent_env_pool_secret: [AGENT_WITH, AGENT_WITH + "        env:\n          CLAUDE_CODE_OAUTH_TOKEN_3: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN_3 }}\n"],
  agent_slot_chain_crossed: ["          claude_code_oauth_token: ${{ steps.cred.outputs.slot != '' && secrets[format('CLAUDE_CODE_OAUTH_TOKEN_{0}', steps.cred.outputs.slot)] || secrets.CLAUDE_CODE_OAUTH_TOKEN }}\n", "          claude_code_oauth_token: ${{ steps.cred.outputs.slot == '1' && secrets.CLAUDE_CODE_OAUTH_TOKEN_2 || secrets.CLAUDE_CODE_OAUTH_TOKEN }}\n"],
  agent_slot_chain_extra_secret: ["          claude_code_oauth_token: ${{ steps.cred.outputs.slot != '' && secrets[format('CLAUDE_CODE_OAUTH_TOKEN_{0}', steps.cred.outputs.slot)] || secrets.CLAUDE_CODE_OAUTH_TOKEN }}\n", "          claude_code_oauth_token: ${{ steps.cred.outputs.slot == '1' && secrets.CLAUDE_CODE_OAUTH_TOKEN_1 || secrets.AGENT_APP_PRIVATE_KEY || secrets.CLAUDE_CODE_OAUTH_TOKEN }}\n"],
  agent_other_oauth: ["          claude_code_oauth_token: ${{ steps.cred.outputs.slot != '' && secrets[format('CLAUDE_CODE_OAUTH_TOKEN_{0}', steps.cred.outputs.slot)] || secrets.CLAUDE_CODE_OAUTH_TOKEN }}\n", "          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN_3 }}\n"],
  agent_with_secret: [AGENT_WITH, AGENT_WITH + "          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}\n"],
  agent_two_tokens: ["          github_token: ${{ steps.agent-token.outputs.token }}\n", "          github_token: ${{ steps.agent-token.outputs.token || steps.pre.outputs.token }}\n"],
  agent_job_token_writes: [WORK_PERMS, "    permissions:\n      contents: write\n    steps:\n      - id: pre\n"],
  agent_job_token_default: [WORK_PERMS, "    steps:\n      - id: pre\n"],
  // The job after the agent, which reads what the agent left behind.
  finish_github_env: after(AT_FINISH_END, '        run: cat "$RUNNER_TEMP/agent-output/log.json" >> "$GITHUB_ENV"\n'),
  finish_github_path: after(AT_FINISH_END, '        run: echo "$RUNNER_TEMP/agent-output" >> "$GITHUB_PATH"\n'),
  finish_export_variable: after(AT_FINISH_END, "        uses: actions/github-script@0000000000000000000000000000000000000006 # v7\n        with:\n          script: core.exportVariable('NODE_OPTIONS', 'x')\n"),
  finish_github_script_require: after(AT_FINISH_END, "        uses: actions/github-script@0000000000000000000000000000000000000006 # v7\n        with:\n          script: require(process.env.RUNNER_TEMP + '/agent-output/x.js')\n"),
  finish_runs_output: after(AT_FINISH_END, '        run: node "$RUNNER_TEMP/agent-output/x.mjs"\n'),
  finish_runs_output_via_bash: after(AT_FINISH_END, '        run: bash -c "$(cat "$RUNNER_TEMP/agent-output/log.json")"\n'),
  finish_runs_output_via_literal_eval: after(AT_FINISH_END, "        run: bash -c 'eval \"$1\"' _ \"$(cat \"$RUNNER_TEMP/agent-output/log.json\")\"\n"),
  finish_persists_credentials: ["          ref: main\n          persist-credentials: false\n", "          ref: main\n          persist-credentials: true\n"],
  finish_other_ref: ["          ref: main\n          persist-credentials: false\n", "          ref: ${{ github.event.inputs.ref }}\n          persist-credentials: false\n"],
};

const postAgentFindings = (text) => {
  const wf = parseWorkflow(text, "fixture.yml");
  return [...postAgentProblems(wf), ...agentJobsThatCanWrite(wf)];
};

test("the after-the-agent guard refuses each named edit, and accepts the jobs as written", () => {
  assert.deepEqual(postAgentFindings(POST_AGENT_FIXTURE), []);
  // What the shared workflows do that this guard accepts: the job's own token
  // for an agent whose job may write nothing, and a printf of a value.
  const JOB_TOKEN = ["          github_token: ${{ steps.agent-token.outputs.token }}\n", "          github_token: ${{ github.token }}\n"];
  const withJobToken = POST_AGENT_FIXTURE.replace(...JOB_TOKEN).replace("        env:\n          GH_TOKEN: ${{ steps.agent-token.outputs.token }}\n", "");
  assert.deepEqual(postAgentFindings(withJobToken), []);
  const SLOTS = ["          claude_code_oauth_token: ${{ steps.cred.outputs.slot != '' && secrets[format('CLAUDE_CODE_OAUTH_TOKEN_{0}', steps.cred.outputs.slot)] || secrets.CLAUDE_CODE_OAUTH_TOKEN }}\n", "          claude_code_oauth_token: >-\n            ${{ steps.cred.outputs.slot == '1' && secrets.CLAUDE_CODE_OAUTH_TOKEN_1 ||\n            steps.cred.outputs.slot == '2' && secrets.CLAUDE_CODE_OAUTH_TOKEN_2 ||\n            secrets.CLAUDE_CODE_OAUTH_TOKEN }}\n"];
  assert.deepEqual(postAgentFindings(POST_AGENT_FIXTURE.replace(...SLOTS)), []);
  assert.notDeepEqual(postAgentFindings(withJobToken.replace("    permissions:\n      contents: read\n    steps:\n      - id: pre\n", "    permissions:\n      contents: read\n      issues: write\n    steps:\n      - id: pre\n")), []);
  assert.deepEqual(postAgentFindings(POST_AGENT_FIXTURE.replace(...after(AT_FINISH_END, "        env:\n          TITLE: x\n        run: LC_ALL=C.UTF-8 bash -c 'printf \"%s\" \"${1:0:200}\"' _ \"$TITLE\"\n"))), []);
  for (const [name, [from, to]] of Object.entries(POST_AGENT_MUTATIONS)) {
    assert.equal(POST_AGENT_FIXTURE.split(from).length, 2, `${name}: the anchor is not unique`);
    const text = POST_AGENT_FIXTURE.replace(from, to);
    assert.ok(postAgentFindings(text).length > 0, `${name} was accepted`);
  }
});

/** A condition that can run a step after an earlier one failed. */
const STATUS_FN = /\b(always|failure|cancelled|success)\s*\(/;
/** A job's `if:` without the `${{ }}` around it and with its whitespace collapsed. */
const jobIf = (j) => String(j?.raw.if ?? "").trim().replace(/^\$\{\{\s*([\s\S]*?)\s*\}\}$/, "$1").replace(/\s+/g, " ");
const needsOf = (j) => [].concat(j?.raw.needs ?? []);
const CLAUDE_SECRET = /^secrets\.CLAUDE_CODE_OAUTH_TOKEN(_[1-9])?$/;

/**
 * Every way agent-implement.yml leaves the shape below; empty when it holds.
 *
 * The issue-to-PR verb runs in four jobs. `prepare` makes every App call
 * before the agent and records who was admitted, the base commit and whether
 * every gate passed. `implement` runs the agent: no App secret is referenced
 * in it (a runner is sent every secret its job references, and the agent has
 * that runner), its token reads only, and the agent commits without pushing.
 * `finish`, on a fresh runner, checks those commits with main's
 * `bundle-handoff.mjs` and only then mints a token that can push them.
 * `report` posts what must not depend on the App. wafflebase's own workflow
 * ran the agent beside an App token it revoked first; the property — the
 * agent's job holds no credential that writes to the repository, and nothing
 * the agent left runs with one — is the same, and now holds by construction.
 */
function implementShapeProblems(text) {
  const problems = [];
  const check = (ok, message) => ok || problems.push(message);
  const wf = parseWorkflow(text, "agent-implement.yml");
  const job = (name) => wf.jobs.find((j) => j.name === name);
  const [prepare, implement, finish, report] = ["prepare", "implement", "finish", "report"].map(job);
  if (!prepare || !implement || !finish || !report) return ["no prepare, implement, finish or report job"];
  const tokenSteps = (j) => j.steps.filter((s) => s.uses?.startsWith("actions/create-github-app-token@"));
  const secretsIn = (j) => [...`${JSON.stringify(j.raw.env ?? {})}\n${j.steps.map((s) => s.text).join("\n")}`.matchAll(/secrets\.[A-Z0-9_]+/g)].map((m) => m[0]);

  // prepare: the write-access gate, then the admitted record directly after it.
  const ps = prepare.steps;
  const verifyAt = ps.findIndex((s) => s.name === "Verify actor has write access");
  const admittedAt = ps.findIndex((s) => s.id === "admitted");
  check(verifyAt >= 0 && admittedAt === verifyAt + 1, "the admitted record does not directly follow the write-access gate");
  if (admittedAt >= 0) {
    const a = ps[admittedAt];
    check(a.cond === "" && !("continue-on-error" in a.raw), "the admitted record can run when the gate refused");
    check(a.script?.trim() === 'echo "admitted=true" >> "$GITHUB_OUTPUT"', "the admitted record writes something else");
  }
  check(/^\$\{\{\s*steps\.admitted\.outputs\.admitted\s*\}\}$/.test(String(prepare.raw.outputs?.admitted ?? "")), "prepare does not output the admitted record");
  check(/^\$\{\{\s*steps\.ready\.outputs\.ready\s*\}\}$/.test(String(prepare.raw.outputs?.ready ?? "")), "prepare does not output that every gate passed");

  // implement: the agent's job.
  const is = implement.steps;
  const at = is.findIndex((s) => s.uses?.startsWith(MODEL_ACTION));
  const model = is[at];
  check(at >= 0, "implement does not run the agent");
  check(needsOf(implement).includes("prepare") && /\bneeds\.prepare\.outputs\.ready == 'true'/.test(jobIf(implement)) && !STATUS_FN.test(jobIf(implement).replace("!cancelled()", "")), `implement runs under "${jobIf(implement)}", not only once prepare passed every gate`);
  check(isObject(implement.raw.permissions) && JSON.stringify(implement.raw.permissions) === '{"contents":"read"}', "the implement job's token holds more than contents: read");
  check(tokenSteps(implement).length === 0, "the implement job mints an App token");
  const foreign = secretsIn(implement).filter((x) => !CLAUDE_SECRET.test(x));
  check(foreign.length === 0, `the implement job references ${[...new Set(foreign)].join(", ")}, which its runner would be sent`);
  check(String(model?.with.github_token ?? "").trim() === "${{ github.token }}", "the agent is not given the job's own read-only token");
  for (const c of is.filter((s) => s.uses?.startsWith("actions/checkout@"))) {
    check(c.with["persist-credentials"] === false, "a checkout in the implement job persists a credential");
  }
  // The toolchain runs from the workspace, so the workspace is main's by then.
  const toolchainAt = is.findIndex((s) => s.uses === "./.github/actions/agent-toolchain");
  const mainAt = is.findIndex((s) => s.uses?.startsWith("actions/checkout@") && s.with.ref === "main" && s.with.path === undefined);
  check(mainAt >= 0 && toolchainAt > mainAt && toolchainAt < at, "the toolchain does not run after main is checked out into the workspace and before the agent");
  check(is.filter((s) => s.uses?.startsWith("./")).length === 1, "the implement job uses a local action other than the toolchain");
  // After the agent: pack its commits as data, and hand them over. Nothing
  // else, and nothing with a secret.
  const after = is.slice(at + 1);
  check(after.length === 2 && after[0].script?.trim().startsWith("git bundle create ") && after[1].uses?.startsWith("actions/upload-artifact@"), "a step other than packing and uploading the agent's output follows the agent");
  check(after.every((s) => !/\bsecrets\b|\.outputs\.token\b/.test(s.text)), "a step after the agent holds a credential");

  // finish: a fresh runner, main's scripts, the agent's output as data.
  check(needsOf(finish).includes("implement") && needsOf(finish).includes("prepare"), "finish does not need prepare and implement");
  check(jobIf(finish) === "!cancelled() && needs.prepare.outputs.admitted == 'true'", `finish runs under "${jobIf(finish)}"`);
  const co = finish.steps.filter((s) => s.uses?.startsWith("actions/checkout@"));
  check(co.length === 1 && co[0].with.path === undefined && co[0].with.ref === "main" && co[0].with["persist-credentials"] === false, "finish checks out other than main once into the workspace, without a credential");
  check(String(co[0]?.with["sparse-checkout"] ?? "").trim().split("\n").sort().join() === ".github/agent-harness,scripts/agent", "finish checks out more than the scripts and their configuration");
  check(finish.steps.find((s) => s.uses?.startsWith("actions/download-artifact@"))?.with.path === "${{ runner.temp }}/agent-output", "the agent's output lands elsewhere");
  // The token that can push exists only once main's bundle-handoff.mjs has
  // passed the commits, and never on a cancelled run; it can push and do
  // nothing else, and only the push step holds it.
  const fs = finish.steps;
  check(JSON.stringify(tokenSteps(finish).map((s) => s.id)) === '["app-token","push-token"]', `finish mints ${tokenSteps(finish).map((s) => s.id)}`);
  const bundleAt = fs.findIndex((s) => s.id === "bundle");
  check(bundleAt >= 0 && /^node scripts\/agent\/bundle-handoff\.mjs verify /.test(fs[bundleAt].script?.trim() ?? ""), "the agent's commits are not verified by main's bundle-handoff.mjs");
  const pushTokenAt = fs.findIndex((s) => s.id === "push-token");
  const pt = fs[pushTokenAt];
  if (pt) {
    check(pushTokenAt > bundleAt && /\bsteps\.bundle\.outcome == 'success'/.test(pt.cond) && /^\$\{\{ !cancelled\(\) && /.test(pt.cond) && !/\balways\(\)/.test(pt.cond), `the push token is minted under "${pt.cond}", not only after the commits passed and never on a cancelled run`);
    const perms = Object.keys(pt.with).filter((k) => k.startsWith("permission-"));
    check(JSON.stringify(perms) === '["permission-contents"]' && pt.with["permission-contents"] === "write", "the push token can do more than push contents");
    const users = fs.filter((s, i) => i !== pushTokenAt && /steps\.push-token\.outputs\.token/.test(s.text));
    check(users.length === 1 && users[0].id === "push" && /^node scripts\/agent\/bundle-handoff\.mjs push /.test(users[0].script?.trim() ?? ""), "the push token is held by a step other than main's bundle-handoff.mjs push");
    if (users[0]) check(/^\$\{\{ !cancelled\(\) && /.test(users[0].cond) && !/\balways\(\)/.test(users[0].cond), `the push runs under "${users[0].cond}", which a cancelled run does not stop`);
  }

  // report: what must not depend on the App, for an admitted commenter only.
  check(jobIf(report) === "always() && needs.prepare.outputs.admitted == 'true'", `report runs under "${jobIf(report)}"`);
  check(!report.steps.some((s) => s.uses?.startsWith("actions/checkout@") || s.isRun), "report checks something out or runs a script");

  // wafflebase's own workflow classified the issue with an Anthropic API key.
  // The shared one has no classifier, so no job holds it.
  for (const j of wf.jobs) check(!secretsIn(j).includes("secrets.ANTHROPIC_API_KEY"), `ANTHROPIC_API_KEY in job ${j.name}`);
  return problems;
}

test("agent-implement keeps every credential that writes out of the agent's job, and pushes only verified commits", () => {
  assert.deepEqual(implementShapeProblems(WF_TEXT("agent-implement.yml")), []);
});

test("agent-implement's shape refuses each named edit", () => {
  const text = WF_TEXT("agent-implement.yml");
  const ADMIT = '      - name: Record that the commenter was admitted\n        id: admitted\n        run: echo "admitted=true" >> "$GITHUB_OUTPUT"\n';
  const IMPLEMENT_PERMS = "      # that could push would let it skip `finish`'s checks.\n      contents: read\n";
  const IMPLEMENT_IF = "      !cancelled() &&\n      needs.prepare.outputs.ready == 'true'\n";
  const PUSH_TOKEN_IF = "        if: ${{ !cancelled() && vars.AGENT_PIPELINE_ENABLED == 'true' && steps.bundle.outcome == 'success' }}\n";
  const PUSH_IF = "        if: ${{ !cancelled() && vars.AGENT_PIPELINE_ENABLED == 'true' && steps.push-token.outcome == 'success' }}\n";
  const PUSH_PERM = "          permission-contents: write # push the verified branch, and nothing else\n";
  const PACK = "      - name: Pack the agent's commits (untrusted output)\n";
  const AGENT_TOKEN_LINE = "          github_token: ${{ github.token }}\n";
  const IMPLEMENT_CHECKOUT = "          ref: main # not the dispatcher's ref: the prompt says the checkout is `main`\n          fetch-depth: 0 # full history for rebase and a full-diff self-review\n          persist-credentials: false\n";
  const edits = {
    implement_token_writes: [IMPLEMENT_PERMS, IMPLEMENT_PERMS.replace("contents: read", "contents: write")],
    implement_token_adds_issues: [IMPLEMENT_PERMS, IMPLEMENT_PERMS.replace("contents: read", "contents: read\n      issues: write")],
    implement_references_app_key: ["      staged: ${{ steps.stage.outcome }}\n", "      staged: ${{ steps.stage.outcome }}\n    env:\n      K: ${{ secrets.AGENT_APP_PRIVATE_KEY }}\n"],
    implement_mints_token: [PACK, "      - name: m\n        id: t\n        uses: actions/create-github-app-token@d72941d797fd3113feb6b93fd0dec494b13a2547 # v1.12.0\n" + PACK],
    implement_ungated: [IMPLEMENT_IF, "      !cancelled()\n"],
    implement_runs_after_failed_prepare: [IMPLEMENT_IF, "      always() &&\n      needs.prepare.outputs.ready == 'true'\n"],
    agent_given_a_secret_token: [AGENT_TOKEN_LINE, "          github_token: ${{ secrets.GITHUB_TOKEN }}\n"],
    implement_checkout_persists: [IMPLEMENT_CHECKOUT, IMPLEMENT_CHECKOUT.replace("persist-credentials: false", "persist-credentials: true")],
    toolchain_elsewhere: ["        uses: ./.github/actions/agent-toolchain\n", "        uses: ./.github/actions/setup\n"],
    step_after_agent: ["      - name: Hand the agent's output to the finish job\n", "      - name: m\n        run: node scripts/agent/metrics.mjs record\n      - name: Hand the agent's output to the finish job\n"],
    push_token_before_verify: [PUSH_TOKEN_IF, "        if: ${{ !cancelled() && vars.AGENT_PIPELINE_ENABLED == 'true' && steps.app-token.outcome == 'success' }}\n"],
    push_token_on_cancel: [PUSH_TOKEN_IF, "        if: always() && steps.bundle.outcome == 'success'\n"],
    push_token_wider: [PUSH_PERM, PUSH_PERM + "          permission-pull-requests: write\n"],
    push_on_cancel: [PUSH_IF, "        if: always() && steps.push-token.outcome == 'success'\n"],
    push_token_to_pr_step: ["        id: open-pr\n        if: ${{ !cancelled() && vars.AGENT_PIPELINE_ENABLED == 'true' && steps.push.outcome == 'success' }}\n        continue-on-error: true\n        env:\n          GH_TOKEN: ${{ steps.app-token.outputs.token }}\n", "        id: open-pr\n        if: ${{ !cancelled() && vars.AGENT_PIPELINE_ENABLED == 'true' && steps.push.outcome == 'success' }}\n        continue-on-error: true\n        env:\n          GH_TOKEN: ${{ steps.push-token.outputs.token }}\n"],
    finish_ungated: ["    if: ${{ !cancelled() && needs.prepare.outputs.admitted == 'true' }}\n", "    if: ${{ !cancelled() }}\n"],
    report_ungated: ["    if: always() && needs.prepare.outputs.admitted == 'true'\n", "    if: always()\n"],
    admitted_always: [ADMIT, ADMIT.replace("        id: admitted\n", "        id: admitted\n        if: always()\n")],
    admitted_fail_open: [ADMIT, ADMIT.replace("        id: admitted\n", "        id: admitted\n        continue-on-error: true\n")],
    admitted_removed: [ADMIT, ""],
    admitted_before_gate: (t) => t.replace(ADMIT, "").replace("      - name: Verify actor has write access\n", `${ADMIT}      - name: Verify actor has write access\n`),
    anthropic_key_in_finish: ["    if: ${{ !cancelled() && needs.prepare.outputs.admitted == 'true' }}\n", "    if: ${{ !cancelled() && needs.prepare.outputs.admitted == 'true' }}\n    env:\n      K: ${{ secrets.ANTHROPIC_API_KEY }}\n"],
  };
  for (const [name, edit] of Object.entries(edits)) {
    let edited;
    if (typeof edit === "function") edited = edit(text);
    else {
      assert.equal(text.split(edit[0]).length, 2, `${name}: the anchor is not unique`);
      edited = text.replace(edit[0], edit[1]);
    }
    assert.notEqual(edited, text, `${name} changed nothing`);
    assert.ok(implementShapeProblems(edited).length > 0, `${name} was accepted`);
  }
});
