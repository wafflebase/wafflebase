// What THIS repository's harness configuration must say.
//
// `scripts/agent/*.test.mjs` grade the harness code against a fixture
// configuration and are the same bytes in every repository that runs the
// harness. This file is the other half: it grades the values in this directory
// and the toolchain action — the files that are different in every repository
// — against the repository itself, and it is the only test that reads them.
// `config.json` cannot carry comments, so the reason each entry exists is
// written here, beside the assertion that pins it.
//
// Run from `scripts/agent`: `npm run test:repo`. It needs yorkie's shared core
// in `scripts/agent` (config.mjs, workflow-values.mjs, conventions.mjs, …), so
// it runs from the sync that brings that core here onward.
//
// The toolchain action's behavioural suite is `toolchain.test.mjs` beside this
// file, and it is NOT imported here: `test:repo` runs this one file under a
// 60-second limit, and that suite alone takes most of it. The `scripts:tests`
// lane runs it on every pull request instead (`scripts/test/agent-toolchain.test.mjs`);
// the pins below are the static half.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync as run, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");
const AGENT = path.join(ROOT, "scripts", "agent");
const WORKFLOWS = path.join(ROOT, ".github", "workflows");

// This directory, whatever the caller's environment says. Set before the first
// harness module is imported — which is why the imports below are dynamic: a
// static import would be evaluated before this line.
process.env.AGENT_HARNESS_CONFIG_DIR = HERE;

const agent = (file) => import(path.join(AGENT, file));
const checks = await agent("checks.mjs");
const panel = await agent("review-panel.mjs");
const rounds = await agent("rounds.mjs");
const redact = await agent("redact.mjs");
const ask = await agent("ask.mjs");
const fixGuard = await agent("fix-guard.mjs");
const testRemovals = await agent("test-removals.mjs");
const { compileGlob, loadConfig } = await agent("config.mjs");
const workflowValues = await agent("workflow-values.mjs");
const manifest = await agent("manifest.mjs");

const CONFIG = loadConfig();

const read = (...parts) => readFileSync(path.join(ROOT, ...parts), "utf8");
/** A file's lines that are not comments: prose does not run. */
const codeOf = (text) => text.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
const TRACKED = run("git", ["ls-files"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  .split("\n")
  .filter(Boolean);
const isTracked = (file) => TRACKED.includes(file);
const matching = (glob) => {
  const re = compileGlob(glob);
  return TRACKED.filter((f) => re.test(f));
};

const CI = read(checks.CI_WORKFLOW_PATH);
const PACKAGE = JSON.parse(read("package.json"));
/** `harness.config.json`: wafflebase's own CI path filter, read by `changed-areas.mjs`. */
const HARNESS = JSON.parse(read("harness.config.json"));

test("this file grades the configuration in its own directory", () => {
  assert.equal(loadConfig(HERE), CONFIG);
  // The name is part of an id stored captures already carry
  // (`wafflebase/stage-capture-meta@1`): it must be exactly this.
  assert.equal(CONFIG.repo.name, "wafflebase");
  assert.ok(TRACKED.length > 1000, `expected the repository's files, git listed ${TRACKED.length}`);
});

// --- where the shared files came from ---------------------------------------------

test("the shared files are a copy of yorkie-team/yorkie", () => {
  // The core cannot know which repository is the origin. A copy whose
  // `upstream.json` was edited to `{ "repository": null }` would pass every
  // drift check, because that is what the origin's says.
  const upstream = JSON.parse(read(".github", "agent-harness", "upstream.json"));
  assert.equal(upstream.repository, "yorkie-team/yorkie");
  assert.match(upstream.commit, /^[0-9a-f]{40}$/);
  assert.match(upstream.manifestDigest, /^[0-9a-f]{64}$/);
});

test("every file the issue-to-PR prompt names exists here", async () => {
  const { IMPLEMENT_PROMPT_PATHS, missingImplementPaths } = await agent("conventions.mjs");
  assert.ok(IMPLEMENT_PROMPT_PATHS.length >= 6, "the list was emptied");
  assert.deepEqual(missingImplementPaths(ROOT), []);
  // …and each is TRACKED, not merely on this machine's disk. The design
  // template was `template.md` here until the harness named it `TEMPLATE.md`;
  // a case-insensitive disk would find either.
  for (const entry of IMPLEMENT_PROMPT_PATHS) {
    const hit = run("git", ["ls-files", "--", entry.path], { cwd: ROOT, encoding: "utf8" }).trim();
    assert.ok(hit !== "", `${entry.path} exists here but git does not track it`);
    if (entry.kind === "file") assert.ok(isTracked(entry.path), `git tracks ${entry.path} under another spelling`);
  }
});

test("no checkout converts the shared files' line endings", () => {
  const lines = read(".gitattributes").split("\n").map((l) => l.trim());
  for (const line of manifest.GITATTRIBUTES_LINES) assert.ok(lines.includes(line), `.gitattributes must contain \`${line}\``);
  if (!existsSync(path.join(ROOT, ".git"))) return;
  for (const rel of ["scripts/agent/config.mjs", "scripts/agent/lenses/lenses.json", ".github/workflows/agent-fix.yml"]) {
    const out = run("git", ["check-attr", "text", "--", rel], { cwd: ROOT, encoding: "utf8" });
    assert.match(out, /: text: unset\s*$/, `${rel}: ${out.trim()}`);
  }
});

// --- what the harness assumes of this repository's CI workflow ---------------------

test("the CI workflow is ci.yml, and its name is exactly CI", () => {
  // The panel and the CI-fix arm start on `workflow_run` with
  // `workflows: ["CI"]`, which matches the NAME. With any other name they
  // never start: no error, no run.
  assert.equal(checks.CI_WORKFLOW_PATH, ".github/workflows/ci.yml");
  assert.match(CI, /^name: CI$/m, "ci.yml must be the workflow whose runs are named CI, capitals included");
  assert.equal([...CI.matchAll(/^name:/gm)].length, 1);
});

test("no two ci.yml triggers can race for the same PR head SHA", () => {
  // What must not happen is two runs from DIFFERENT triggers for one PR head,
  // where "the newest run" is arbitrary rather than superseding. `push`
  // restricted to `main` never fires for a PR branch, and a `merge_group` run
  // carries the speculative merge commit. Widen `push`, or add a trigger that
  // fires on a PR head, and this fails — making the choice conscious.
  // (Moved from wafflebase's own `scripts/agent/checks.test.mjs`.)
  const on = codeOf(CI.slice(CI.indexOf("\non:"), CI.indexOf("\npermissions:")));
  const events = [...on.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]);
  assert.deepEqual(events.sort(), ["merge_group", "pull_request", "push"], "a new CI trigger may fire for a PR head SHA");
  assert.match(on.slice(on.indexOf("push:"), on.indexOf("pull_request:")), /branches: \["main"\]/, "push must stay restricted to main");
  // A trigger-level path filter files NO run for a filtered-out PR, so neither
  // the panel nor the CI-fix arm would start. Lanes are filtered inside the
  // run instead (`changed-areas.mjs`), and a filtered lane reports itself.
  assert.ok(!/^\s+paths(-ignore)?:/m.test(on), "ci.yml must not filter by path at the trigger");
});

test("ci.laneReports says what ci.yml uploads, and summarize-ci.mjs renders it with the core's contract", () => {
  // `verify-self.mjs` writes one report per lane to `.harness-reports/`, and
  // ci.yml uploads it under the name the shared CI-fix job downloads.
  assert.equal(CONFIG.ci.laneReports, true);
  assert.match(CI, /^\s+name: ci-lane-reports\s*$/m);
  const script = path.join(ROOT, "scripts", "ci", "summarize-ci.mjs");
  assert.ok(isTracked("scripts/ci/summarize-ci.mjs"));
  // Silent and exit 3 when no lane failed, so the job falls back to the log;
  // a block on stdout when one did. (scripts/test/summarize-ci.test.mjs has the rest.)
  const dir = mkdtempSync(path.join(tmpdir(), "repo-test-reports-"));
  try {
    const empty = spawnSync(process.execPath, [script, "--dir", dir], { encoding: "utf8" });
    assert.equal(empty.status, 3);
    assert.equal(empty.stdout, "");
    writeFileSync(path.join(dir, "summary.json"), JSON.stringify({ lanes: [{ lane: "x:test", status: "fail" }] }));
    const failed = spawnSync(process.execPath, [script, "--dir", dir], { encoding: "utf8" });
    assert.equal(failed.status, 0, failed.stderr);
    assert.match(failed.stdout, /Failed lane: `x:test`/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- the paths that define CI -------------------------------------------------------
//
// `ci.definingPaths`, beside the entries every repository shares (the
// workflows and actions, CODEOWNERS, `.github/agent-harness/**`, the hook
// layer). A pull request touching any of them is never promoted automatically.
//
// THE LIST IS `harness.config.json`'s `ci.ciConfig`. That file is wafflebase's
// own (it drives `changed-areas.mjs`, which decides which lanes a change can
// skip), and its `ciConfig` list is "the gating surface itself": a change to
// any entry forces a full run so a pull request cannot use the filter to grade
// its own homework. The ready gate refuses a pull request for the same reason,
// so the two lists must agree — this test is where they meet.
const CI_DEFINING_BEYOND_CICONFIG = [
  // Per-package manifests decide the scripts every lane runs (`pnpm sheets
  // test` is whatever `packages/sheets/package.json` says). `ciConfig` does
  // not need them — `changed-areas.mjs` maps a package's files to that
  // package's lanes, so a changed manifest runs them — but the gate does.
  "packages/*/package.json",
];

test("ci.definingPaths is harness.config.json's ci.ciConfig, and the gate covers every entry", () => {
  const ciConfig = HARNESS.ci?.ciConfig;
  assert.ok(Array.isArray(ciConfig) && ciConfig.length > 0, "harness.config.json must still declare ci.ciConfig");
  // Every `ciConfig` entry is on the gate's list (the shared built-ins cover
  // `.github/workflows/**` and `.github/CODEOWNERS`)…
  for (const glob of ciConfig) {
    assert.ok(checks.CI_DEFINING_PATHS.includes(glob), `harness.config.json calls '${glob}' part of the CI gating surface, and the gate omits it`);
  }
  // …and the configured list is exactly `ciConfig` minus the built-ins, plus
  // the entries above with their reasons.
  const builtIn = checks.CI_DEFINING_PATHS.filter((g) => !CONFIG.ci.definingPaths.includes(g));
  assert.deepEqual(
    [...CONFIG.ci.definingPaths].sort(),
    [...ciConfig.filter((g) => !builtIn.includes(g)), ...CI_DEFINING_BEYOND_CICONFIG].sort(),
    "config.json's ci.definingPaths and harness.config.json's ci.ciConfig have drifted",
  );

  for (const p of [
    ".github/workflows/ci.yml",
    ".github/actions/agent-toolchain/action.yml",
    ".github/agent-harness/config.json",
    ".github/CODEOWNERS",
    "harness.config.json",
    "knip.json",
    "package.json",
    "packages/sheets/package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "scripts/changed-areas.mjs",
    "scripts/verify-self.mjs",
    "scripts/verify-integration.mjs",
    ".githooks/pre-commit",
    "scripts/hooks/guard-generated-files.sh",
  ]) {
    assert.equal(checks.definesCi(p), true, `${p} defines what CI does`);
  }
  // …and it does not swallow the code under review: a gate that refuses
  // every PR is the same outage as one that refuses none.
  for (const p of [
    "packages/sheets/src/index.ts",
    "packages/sheets/src/package.json.ts",
    "packages/frontend/src/nested/package.json",
    "docs/design/agent-pipeline/harness-engineering.md",
    "scripts/agent-arms/hunt.mjs",
    "scripts/ci/summarize-ci.mjs",
    "README.md",
  ]) {
    assert.equal(checks.definesCi(p), false, `${p} is code or prose under review, not the CI definition`);
  }
});

test("every configured path and glob matches a tracked file, or is reserved with a reason", () => {
  // The loader can tell a glob from a non-glob, not a right glob from a wrong
  // one: a renamed directory leaves a valid glob behind. So every entry must
  // match a tracked file — or be on RESERVED with its reason.
  const RESERVED = {
    // Carried from the class rules wafflebase had before the shared core: a
    // changeset and an MDX page of the documentation site are narration.
    // Neither exists yet.
    ".changeset/*.md": ["review.classRules.prose"],
    "packages/documentation/**/*.mdx": ["review.classRules.prose"],
  };
  const lists = {
    "ci.definingPaths": CONFIG.ci.definingPaths,
    "review.classRules.code-adjacent": CONFIG.review.classRules["code-adjacent"],
    "review.classRules.policy": CONFIG.review.classRules.policy,
    "review.classRules.prose": CONFIG.review.classRules.prose,
    "review.sourceGlobs": CONFIG.review.sourceGlobs,
    "fixGuard.replicatedRuleGlobs": CONFIG.fixGuard.replicatedRuleGlobs,
  };
  let checked = 0;
  const reservedSeen = [];
  for (const [key, entries] of Object.entries(lists)) {
    for (const entry of entries) {
      checked++;
      const matches = matching(entry).length > 0;
      const reserved = (RESERVED[entry] ?? []).includes(key);
      if (reserved) reservedSeen.push(`${key}: ${entry}`);
      assert.equal(
        matches,
        !reserved,
        reserved
          ? `${key}: ${entry} matches a tracked file now — take it off RESERVED and decide what the new file needs`
          : `${key}: ${entry} matches no tracked file. A directory is \`dir/**\`, any depth is \`**/name\`; ` +
            "if the entry is deliberate, add it to RESERVED with the reason",
      );
    }
  }
  // `review.diffExcludes` are git pathspecs, so git is asked.
  for (const spec of CONFIG.review.diffExcludes) {
    checked++;
    const hit = run("git", ["ls-files", "--", spec], { cwd: ROOT, encoding: "utf8" }).trim();
    assert.ok(hit !== "", `review.diffExcludes: ${spec} matches no tracked file`);
  }
  assert.ok(checked >= 20, `expected every configured entry, checked ${checked}`);
  assert.deepEqual(reservedSeen.sort(), Object.entries(RESERVED).flatMap(([e, keys]) => keys.map((k) => `${k}: ${e}`)).sort());
});

// --- the reviewers' view of this repository -----------------------------------------

test("classifyFile: the file classes wafflebase's panel used, under the shared rules", () => {
  // Policy: what governs the agents, and the CI path filter.
  // The template catalogue's README states a licensing rule the catalogue is
  // held to ("a requirement, not a description"); under the shared rules any
  // README is prose, which no code lens reads.
  for (const f of ["CLAUDE.md", "AGENTS.md", "CONTRIBUTING.md", "MAINTAINING.md", "harness.config.json", ".github/PULL_REQUEST_TEMPLATE.md", ".claude/settings.json", "scripts/agent/lenses/security.md", "packages/backend/src/template/seed/catalog/README.md"]) {
    assert.equal(panel.classifyFile(f), "policy", f);
  }
  for (const file of ["config.json", "coverage-note.md", "repo.snapshot.json", "repo.test.mjs", "toolchain.test.mjs"]) {
    assert.equal(panel.classifyFile(`.github/agent-harness/${file}`), "policy", file);
    assert.equal(checks.definesCi(`.github/agent-harness/${file}`), true, file);
  }
  // Code-adjacent: what tests read, and the spell dictionary the docs engine loads.
  for (const f of ["packages/backend/test/template.e2e-spec.ts", "packages/frontend/tests/app/slides/x.integration.ts", "packages/docs/src/spell/dict/en_US.dic", "scripts/test/fixtures/agent-guard-workflow.yml"]) {
    assert.equal(panel.classifyFile(f), "code-adjacent", f);
  }
  // The design contract, the template included.
  for (const f of ["docs/design/TEMPLATE.md", "docs/design/README.md", "docs/design/agent-pipeline/harness-engineering.md"]) {
    assert.equal(panel.classifyFile(f), "design-spec", f);
  }
  // Prose: task files, top-level and package READMEs, the documentation site.
  for (const f of ["docs/tasks/active/20261115-x-todo.md", "README.md", "packages/frontend/README.md", "packages/documentation/guide/index.md", "packages/documentation/guide/x.mdx", ".changeset/brave-cat.md"]) {
    assert.equal(panel.classifyFile(f), "prose", f);
  }
  // Source stays code: prose is matched last and takes what it matches away
  // from the code lenses, so a source file it caught would go unreviewed.
  for (const f of ["packages/sheets/src/formula/formula.ts", "packages/frontend/src/App.tsx", "packages/sheets/antlr/FormulaParser.ts", "packages/backend/prisma/schema.prisma", "scripts/agent-arms/hunt.mjs", "scripts/ci/summarize-ci.mjs", "packages/documentation/.vitepress/config.ts"]) {
    assert.equal(panel.classifyFile(f), "code", f);
  }
});

test("review.sourceGlobs is packages/**, and the path-scoped lenses run on it", () => {
  assert.deepEqual(CONFIG.review.sourceGlobs, ["packages/**"]);
  const workspace = read("pnpm-workspace.yaml");
  assert.match(workspace, /^ {2}- packages\/\*$/m, "a workspace package outside packages/ is not reviewed by the path-scoped lenses");
});

test("the reviewed diff leaves out the ANTLR tooling artefacts, and only those", () => {
  // `.interp` / `.tokens` are loaded by nothing at runtime. The generated `.ts`
  // parser is shipped code and stays in the diff, so a hand-edit that
  // `Formula.g4` does not justify is seen; the grammar is never excluded.
  assert.deepEqual(CONFIG.review.diffExcludes, ["packages/sheets/antlr/*.interp", "packages/sheets/antlr/*.tokens"]);
  const value = workflowValues.values(["diff_pathspecs"])[0][1];
  assert.equal(value, ".\n:(exclude)packages/sheets/antlr/*.interp\n:(exclude)packages/sheets/antlr/*.tokens");
});

test("the coverage note claims only mechanisms this repository actually runs", () => {
  // The failure mode is SILENT: tell a lens something is covered when it is
  // not and that finding class stops being reported. Each assertion pins a
  // fact read off the repository. (Moved from wafflebase's own
  // `scripts/agent/review-panel.test.mjs`, with the same reasons.)
  const N = panel.MECHANICAL_COVERAGE_NOTE;
  assert.equal(N, read(".github", "agent-harness", "coverage-note.md").replace(/\n$/, ""));

  const enforced = N.slice(N.indexOf("ENFORCED"), N.indexOf("NOT ENFORCED"));
  assert.ok(!/format|prettier/i.test(enforced), "no lane checks formatting — never claim one does");
  assert.match(N, /Prettier is write-only/, "the gap must be stated, not merely omitted");

  // packages/frontend has NO tsc: `vite build` strips types.
  assert.match(N, /packages\/frontend\. It has no `tsc` at all/);
  const tscLine = N.split("\n").find((l) => l.includes("`tsc --noEmit` in"));
  assert.ok(!/frontend/.test(tscLine), `the tsc claim must not cover frontend: ${tscLine}`);
  for (const pkg of ["sheets", "slides", "docs", "notes", "board", "cli"]) {
    assert.ok(tscLine.includes(pkg), `verify:fast typechecks ${pkg} — the note must say so`);
    assert.match(PACKAGE.scripts["verify:fast"], new RegExp(`${pkg} typecheck`), `verify:fast no longer typechecks ${pkg}`);
  }
  assert.ok(!PACKAGE.scripts["verify:fast"].includes("frontend typecheck"), "frontend gained a typecheck: update the note");

  // packages/core's suite: the note says no lane invokes it. That is true only
  // while verify:fast does not, so the note and the script move together.
  const suitesLine = N.split("\n").find((l) => l.includes("The suites RUN"));
  assert.ok(!/core/.test(suitesLine), `the suites line must not claim core's suite: ${suitesLine}`);

  assert.match(N, /docs\/design\/\*\*\.md must resolve on disk/);
  assert.match(N, /`pnpm audit`: fails the lane on a CRITICAL advisory/);
  assert.match(N, /below critical; high\/moderate\/low are printed and ignored/);
  for (const category of [/\btype problems\b/i, /\btype issues\b/i, /\blint issues are\b/i, /\bstyle problems\b/i]) {
    assert.ok(!category.test(N), `the note must name a mechanism, not a category: ${category}`);
  }
  // The panel runs alongside CI, so nothing here has already passed.
  assert.ok(!/already (?:caught|checked|passed|proven)/i.test(N));
  assert.match(N, /must pass before it can be promoted/);
});

// --- what the fixers are told -------------------------------------------------------

test("every command a prompt names is one this repository has", () => {
  const scripts = PACKAGE.scripts;
  for (const name of ["verify:fast", "verify:self", "verify:integration", "verify:integration:docker", "verify:browser:docker"]) {
    assert.ok(scripts[name], `package.json has no \`${name}\` script`);
  }
  assert.equal(CONFIG.fixer.verifyCommand, "pnpm verify:fast");
  // `pnpm sheets build:formula` regenerates the ANTLR parser the generated-code note names.
  assert.ok(scripts.sheets && JSON.parse(read("packages", "sheets", "package.json")).scripts["build:formula"]);
  // The Prisma client the fixers are told to generate, with the backend's own prisma.
  const backend = JSON.parse(read("packages", "backend", "package.json"));
  assert.equal(backend.name, "@wafflebase/backend");
  assert.ok(backend.devDependencies?.prisma || backend.dependencies?.prisma, "the backend no longer depends on prisma");
  assert.match(backend.scripts.postinstall ?? "", /prisma generate/, "the backend's postinstall no longer generates the client — the prompts' Prisma step is stale");
  for (const key of ["verifyFailureHint", "implementVerifyStep", "replyVerifyInstruction"]) {
    assert.ok(CONFIG.fixer[key].includes("pnpm --filter @wafflebase/backend exec prisma generate"), `fixer.${key} no longer names the Prisma step`);
  }
});

test("verifyDescription says what verify:fast runs", () => {
  const fast = PACKAGE.scripts["verify:fast"];
  for (const [phrase, command] of [
    ["the `docs/` layout check", "pnpm verify:docs-paths"],
    ["the lint of `scripts/` and `plugins/`", "pnpm lint:scripts"],
    ["the doc index and link checks", "pnpm verify:doc-index && pnpm verify:doc-links"],
    ["the core build and suite", "pnpm core build && pnpm core test"],
    ["the architecture lint", "pnpm verify:architecture"],
    ["the frontend lint and suite", "pnpm frontend lint && pnpm frontend test"],
    ["the backend's Jest suite", "pnpm backend test"],
  ]) {
    assert.ok(CONFIG.fixer.verifyDescription.includes(phrase), phrase);
    assert.ok(fast.includes(command), `verify:fast no longer runs \`${command}\``);
  }
  assert.equal(PACKAGE.scripts["lint:scripts"], "eslint scripts plugins");
});

test("the test-removal record reads this repository's runners, bar one gap yorkie#2362 closes", () => {
  // Vitest in the engines and the frontend, Jest in the backend (`*.spec.ts`
  // and `test/*.e2e-spec.ts`), node:test in `scripts/`. Every one of these is
  // a test file to the `vitest` rule set, by its name or its directory, so a
  // test added, removed or switched off in it is recorded.
  assert.deepEqual(CONFIG.tests.rules, ["vitest"]);
  for (const f of [
    "packages/sheets/src/formula/formula.test.ts",
    "packages/backend/src/document/document.service.spec.ts",
    "packages/backend/test/template.e2e-spec.ts",
    "packages/frontend/tests/app/slides/x.integration.ts",
    "scripts/test/summarize-ci.test.mjs",
    "scripts/agent-arms/hunt.test.mjs",
  ]) {
    assert.equal(testRemovals.isTestFile(f), true, f);
  }
  assert.equal(testRemovals.isTestFile("packages/sheets/src/formula/formula.ts"), false);
  // Picked up by NAME: what a rename can take away from the runner without a
  // line of the test changing.
  for (const f of ["packages/sheets/src/formula/formula.test.ts", "packages/backend/src/document/document.service.spec.ts"]) {
    assert.equal(testRemovals.isRunnableTest(f), true, f);
  }
  // THE GAP, exactly as it is. The shared rule set does not take Jest's
  // `*.e2e-spec.ts` or the frontend's `*.integration.ts` for names a runner
  // picks up, so renaming one away (`x.e2e-spec.ts` → `x.e2e-spec.ts.off`)
  // stops the suite with nothing in the removal record. wafflebase's own
  // rules had both. yorkie#2362 adds exactly these two suffixes.
  for (const f of ["packages/backend/test/template.e2e-spec.ts", "packages/frontend/tests/app/slides/x.integration.ts"]) {
    assert.equal(
      testRemovals.isRunnableTest(f),
      false,
      `upstream fixed (yorkie-team/yorkie#2362) — flip this to a positive assertion: ${f} is now a runnable test name`,
    );
  }
  assert.ok(fixGuard, "fix-guard.mjs loads with this configuration (it refuses a rule set without assertion patterns)");
});

test("an agent's own pnpm install does not arm the repository's git hooks", () => {
  // The root postinstall points git at `.githooks`, whose pre-push runs
  // `pnpm verify:self` — minutes, longer than an agent's tool timeout — and
  // whose pre-commit runs `pnpm verify:fast`. The shared prompts forbid
  // `--no-verify` and point `core.hooksPath` at the harness's own scope hook,
  // so an agent that installs a dependency itself must not re-arm these.
  // GitHub Actions sets `CI`; under it the postinstall does nothing.
  const script = PACKAGE.scripts.postinstall;
  assert.equal(script, '[ -n "$CI" ] || git config core.hooksPath .githooks || true');
  for (const [ci, armed] of [[undefined, true], ["true", false]]) {
    const dir = mkdtempSync(path.join(tmpdir(), "repo-test-postinstall-"));
    try {
      // Only what the fixture needs: no GIT_DIR or GIT_INDEX_FILE an enclosing hook set.
      const env = { PATH: process.env.PATH, HOME: dir, GIT_CONFIG_GLOBAL: "/dev/null", ...(ci ? { CI: ci } : {}) };
      run("git", ["init", "-q"], { cwd: dir, env });
      const r = spawnSync("sh", ["-c", script], { cwd: dir, env, encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      const got = spawnSync("git", ["config", "--local", "core.hooksPath"], { cwd: dir, env, encoding: "utf8" }).stdout.trim();
      assert.equal(got, armed ? ".githooks" : "", `CI=${ci}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

// --- identity, and what the core is told to allow ------------------------------------

test("the bots the workflows believe are the ones the scripts believe", () => {
  const value = (name) => workflowValues.values([name])[0][1];
  assert.deepEqual(JSON.parse(value("bot_logins")), [...rounds.PAGE_AUTHOR_LOGINS]);
  // wafflebase's App is `yorkie-agent`, as today's workflows and scripts name it.
  assert.deepEqual(JSON.parse(value("bot_logins")), ["github-actions[bot]", "yorkie-agent[bot]"]);
  assert.equal(value("app_slug"), "yorkie-agent");
  assert.deepEqual(CONFIG.repo.appLogins, ["yorkie-agent[bot]", "app/yorkie-agent"]);
  assert.equal(value("allowed_bots"), "yorkie-agent[bot],yorkie-agent");
});

test("the command-verbs reference is yorkie's document, by URL", () => {
  assert.equal(CONFIG.docs.commandVerbsRef, "https://github.com/yorkie-team/yorkie/blob/main/docs/design/agent-command-verbs.md");
  assert.ok(!isTracked("docs/design/agent-command-verbs.md"));
});

test("ask.permittedMcpTools is exactly the two tools the hunters build, and nothing wider", () => {
  // The hunters (`scripts/agent-arms/hunt-tool.mjs`, `hunt-ui-tool.mjs`)
  // build an in-process MCP server named `wafflebase` with one tool each.
  // Those two, and only they, may be granted to a session.
  assert.deepEqual(CONFIG.ask.permittedMcpTools, ["mcp__wafflebase__run", "mcp__wafflebase__ui"]);
  for (const [file, tool] of [["hunt-tool.mjs", "run"], ["hunt-ui-tool.mjs", "ui"]]) {
    const src = read("scripts", "agent-arms", file);
    assert.match(src, /createSdkMcpServer\(\{\s*name: "wafflebase",/, `${file} no longer names its server wafflebase`);
    assert.match(src, new RegExp(`tool\\(\\s*"${tool}",`), `${file} no longer builds the \`${tool}\` tool`);
  }
  assert.deepEqual([...ask.PERMITTED_MCP_TOOLS], CONFIG.ask.permittedMcpTools);
});

test("redact.extraPatterns masks a wafflebase API key wherever it appears, and nothing that is not one", () => {
  // wafflebase's keys are `wfb_` + key characters. The hunters, the issue
  // intake and the auth smoke test publish text that can carry one.
  assert.deepEqual(CONFIG.redact.extraPatterns, ["\\bwfb_[A-Za-z0-9_-]+"]);
  for (const [input, gone] of [
    ["key wfb_live_AbCdEf123456 end", "wfb_live_AbCdEf123456"],
    ["Authorization: wfb_abcd1234-efgh", "wfb_abcd1234-efgh"],
    ["--api-key=wfb_secret123456", "wfb_secret123456"],
    ['{"apiKey":"wfb_LIVEKEYVALUE"}', "wfb_LIVEKEYVALUE"],
  ]) {
    const out = redact.redactSecrets(input);
    assert.ok(!out.includes(gone), `${input} → ${out}`);
    assert.match(out, /<REDACTED_API_KEY>/, input);
  }
  for (const kept of ["the wfb_ prefix", "notwfb_abc123456", "wafflebase"]) {
    assert.equal(redact.redactSecrets(kept), kept);
  }
});

test("the fix guard has no replicated rule here", () => {
  // wafflebase ports no rule from another repository that must stay in step.
  assert.deepEqual(CONFIG.fixGuard, { replicatedRuleGlobs: [], replicatedRuleNotice: "", counterpartRepos: [] });
});

// --- what the workflows say, in this repository's words -----------------------------
//
// `repo.snapshot.json` records every configured value and every prompt as
// rendered here, so a change to `config.json` — or a sync that changes a
// prompt's frame — shows its before and after in that file's diff.
//
// To record it again after reading the difference:
//   AGENT_HARNESS_RECORD=1 npm run test:repo

/** Collapse runs of whitespace: a prompt's line wrapping is not its text. */
const flat = (text) => text.replace(/\s+/g, " ").trim();

/** `text` with every configured-value expression replaced by this repository's value. */
function rendered(text) {
  const all = Object.fromEntries(workflowValues.values(Object.keys(workflowValues.VALUES)));
  return text.replace(/\$\{\{\s*(?:steps\.cfg|needs\.[\w-]+)\.outputs\.([a-z_]+)\s*\}\}/g, (whole, name) =>
    Object.hasOwn(all, name) ? all[name] : whole);
}

/** Every `prompt: |` block of a workflow, in order. */
function promptBlocks(text) {
  const lines = text.split("\n");
  const blocks = [];
  lines.forEach((line, i) => {
    const m = /^(\s+)prompt: \|\s*$/.exec(line);
    if (!m) return;
    const body = [];
    for (const next of lines.slice(i + 1)) {
      if (next.trim() !== "" && /^(\s*)/.exec(next)[1].length <= m[1].length) break;
      body.push(next);
    }
    blocks.push(body.join("\n"));
  });
  return blocks;
}

/** `NAME: ${{ steps.cfg.outputs.value }}` in a step's `env:`. */
const ENV_FROM_CONFIG = /^\s+([A-Z_]+): (\$\{\{ steps\.cfg\.outputs\.[a-z_]+ \}\})\s*$/gm;
/** A placeholder replaced by a QUOTED variable. */
const QUOTED_SUBSTITUTION = /^\s+TEMPLATE=\$\{TEMPLATE\/\/(__[A-Z_]+__)\/"\$([A-Z_]+)"\}\s*$/gm;

/** The issue-to-PR prompt, a heredoc whose configured values are substituted for placeholders. */
function heredocPrompt(text) {
  const start = text.indexOf("<<'PROMPT'\n");
  const end = text.indexOf("\n          PROMPT\n", start);
  assert.ok(start > 0 && end > start, "agent-implement.yml no longer builds its prompt in a `PROMPT` heredoc");
  let prompt = text.slice(start + "<<'PROMPT'\n".length, end);
  const stepAt = text.lastIndexOf("\n      - name: ", start);
  const stepEnd = text.indexOf("\n      - name: ", start);
  const step = text.slice(stepAt, stepEnd < 0 ? undefined : stepEnd);
  const env = new Map([...step.matchAll(ENV_FROM_CONFIG)].map((m) => [m[1], m[2]]));
  let substituted = 0;
  for (const m of step.matchAll(QUOTED_SUBSTITUTION)) {
    assert.ok(env.has(m[2]), `agent-implement.yml substitutes ${m[1]} with a variable its env does not set from the configuration`);
    prompt = prompt.replaceAll(m[1], env.get(m[2]));
    substituted++;
  }
  assert.ok(substituted >= 5, `expected the configured placeholders, found ${substituted}`);
  return [prompt];
}

function renderedPrompts() {
  const sites = [
    ["agent-fix.yml", promptBlocks],
    ["agent-review-panel.yml", promptBlocks],
    ["agent-iterate-ci.yml", promptBlocks],
    ["agent-review-reply.yml", promptBlocks],
    ["agent-summarize.yml", promptBlocks],
    ["agent-implement.yml", heredocPrompt],
  ];
  const got = {};
  for (const [file, extract] of sites) {
    const blocks = extract(readFileSync(path.join(WORKFLOWS, file), "utf8"));
    assert.ok(blocks.length > 0, `${file}: no prompt found`);
    blocks.forEach((block, i) => {
      const text = flat(rendered(block));
      assert.ok(!/(?:steps\.cfg|needs\.route)\.outputs\./.test(text), `${file}: a configured value was not rendered`);
      got[`${file}#${i}`] = text;
    });
  }
  return got;
}

const SNAPSHOT_PATH = path.join(HERE, "repo.snapshot.json");
const CURRENT = {
  WORKFLOW_VALUES: Object.fromEntries(workflowValues.values(Object.keys(workflowValues.VALUES))),
  WORKFLOW_PROMPTS: renderedPrompts(),
  CI_DEFINING_PATHS: [...checks.CI_DEFINING_PATHS],
  CLASS_RULES: JSON.parse(JSON.stringify(panel.CLASS_RULES)),
  ciGateName: checks.CI_GATE_NAME,
  handoffCiBullet: [...checks.HANDOFF_CI_SUMMARY],
};
// Never set in CI: `agent-scripts.yml` runs `npm run test:repo` with no such variable.
if (process.env.AGENT_HARNESS_RECORD === "1") writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(CURRENT, null, 2)}\n`);
const SNAPSHOT = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8"));

test("snapshot: every value the workflows read from the configuration", () => {
  assert.deepEqual(CURRENT.WORKFLOW_VALUES, SNAPSHOT.WORKFLOW_VALUES);
});

test("snapshot: the prompts the agents are given, as rendered for this repository", () => {
  assert.ok(Object.keys(CURRENT.WORKFLOW_PROMPTS).length >= 6, "expected a prompt from each agent workflow");
  assert.deepEqual(CURRENT.WORKFLOW_PROMPTS, SNAPSHOT.WORKFLOW_PROMPTS);
});

test("snapshot: the CI-defining paths, the file-class rules and what the hand-off says CI covered", () => {
  assert.deepEqual(CURRENT.CI_DEFINING_PATHS, SNAPSHOT.CI_DEFINING_PATHS);
  assert.deepEqual(CURRENT.CLASS_RULES, SNAPSHOT.CLASS_RULES);
  assert.equal(CURRENT.ciGateName, SNAPSHOT.ciGateName);
  assert.deepEqual(CURRENT.handoffCiBullet, SNAPSHOT.handoffCiBullet);
  assert.equal(process.env.AGENT_HARNESS_RECORD, undefined, "this run RECORDED the snapshot; run again without AGENT_HARNESS_RECORD");
});

test("this directory holds what the harness reads and what grades it, and nothing else", () => {
  assert.deepEqual(readdirSync(HERE).sort(), ["README.md", "config.json", "coverage-note.md", "repo.snapshot.json", "repo.test.mjs", "toolchain.test.mjs", "upstream.json"]);
});

// --- the toolchain action -----------------------------------------------------------
//
// The workflows cannot check what the action does: it is a different file in
// every repository. These are the static pins of the contract in
// scripts/agent/README.md ("The toolchain action"); `toolchain.test.mjs` runs
// the action's step and its install against stub and real container runtimes.

const ACTION_DIR = path.join(ROOT, ".github", "actions", "agent-toolchain");
const ACTION_YML = read(".github", "actions", "agent-toolchain", "action.yml");

test("the toolchain action pins pnpm to the audited version and hash, and the image by digest", async () => {
  const { IMAGE, PNPM_VERSION } = await import(path.join(ACTION_DIR, "install-deps.mjs"));
  const env = Object.fromEntries([...ACTION_YML.matchAll(/^ {8}(PNPM_[A-Z]+): (.+)$/gm)].map((m) => [m[1], m[2]]));
  assert.equal(env.PNPM_VERSION, PNPM_VERSION);
  assert.equal(PACKAGE.packageManager, `pnpm@${PNPM_VERSION}`);
  assert.match(env.PNPM_INTEGRITY, /^sha512-[A-Za-z0-9+/]{86}==$/);
  assert.match(IMAGE, /^node:22-[a-z-]+@sha256:[0-9a-f]{64}$/);
  // The image's Node is the one the jobs set up (22.x) and ci.yml builds with.
  assert.match(CI, /node-version: 22/);
});

test("the toolchain action uses no other action, saves no cache, and runs nothing from the workspace", () => {
  const code = codeOf(ACTION_YML);
  assert.doesNotMatch(code, /^\s*(?:-\s*)?uses:/m);
  assert.doesNotMatch(code, /cache/i);
  assert.match(code, /\n\s+cd "\$temp"\n/);
  assert.match(code, /env -i "\$\{install\[@\]\}" node "\$ACTION_PATH\/install-deps\.mjs"/);
  assert.doesNotMatch(code, /\$\{?GITHUB_WORKSPACE\}?\//);
  // Its behavioural suite runs in the scripts:tests lane.
  assert.match(read("scripts", "test", "agent-toolchain.test.mjs"), /\.github\/agent-harness\/toolchain\.test\.mjs/);
});
