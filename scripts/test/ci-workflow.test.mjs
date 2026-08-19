// Structural guards on `.github/workflows/ci.yml` that only a real merge-queue
// entry would otherwise catch — which is the worst possible place to find them,
// because the symptom is a pull request that waits an hour and is then dequeued.
//
// Line-based rather than a YAML parse, matching `scripts/agent/review-panel.test.mjs`:
// `scripts/` has no package.json of its own, so it has no dependency to import a
// parser from, and the properties below are all shallow enough to read off the
// indentation.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const CI_PATH = path.join(REPO_ROOT, ".github/workflows/ci.yml");

/**
 * `ci.yml`'s jobs: `{ name, lines }`, where `lines` is everything from the job
 * header up to the next one.
 */
function readJobs() {
  const lines = readFileSync(CI_PATH, "utf8").split("\n");
  const jobsAt = lines.findIndex((l) => l === "jobs:");
  assert.ok(jobsAt >= 0, "ci.yml has no `jobs:` block");

  const headers = [];
  for (let i = jobsAt + 1; i < lines.length; i++) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[i])) headers.push(i);
  }
  return headers.map((start, n) => ({
    name: lines[start].trim().replace(/:$/, ""),
    lines: lines.slice(start, headers[n + 1] ?? lines.length),
  }));
}

/** The job-level `if:` of a job block, flattened, or null. */
function jobLevelIf(jobLines) {
  const at = jobLines.findIndex((l) => /^ {4}if:/.test(l));
  if (at < 0) return null;
  const out = [jobLines[at].replace(/^ {4}if:/, "").trim()];
  for (let i = at + 1; i < jobLines.length; i++) {
    // A continuation of a folded scalar is indented deeper than the key.
    if (!/^ {6}\S/.test(jobLines[i])) break;
    out.push(jobLines[i].trim());
  }
  return out.join(" ");
}

const hasMatrix = (jobLines) => jobLines.some((l) => /^ {6}matrix:\s*$/.test(l));

test("ci.yml job structure", async (t) => {
  const jobs = readJobs();

  await t.test("the parser found the jobs", () => {
    const names = jobs.map((j) => j.name);
    for (const expected of ["changes", "verify-self", "verify-browser", "verify-integration"]) {
      assert.ok(names.includes(expected), `expected to find the ${expected} job, got ${names.join(", ")}`);
    }
  });

  await t.test("no matrix job is gated on the path filter", () => {
    // THE BUG THIS EXISTS FOR. #803 gated `verify-browser` and
    // `verify-integration` with a job-level `if: … heavy == 'true' …`, on the
    // reasoning that GitHub records a skipped job as a `skipped` check run which
    // satisfies a required check. True — but a job with a `strategy.matrix` that
    // is skipped by its `if:` NEVER EXPANDS THE MATRIX, so the check run is filed
    // under the bare job name. Measured on the `merge_group` SHA for #799:
    //
    //   verify-self (22.x)   success   <- ran, matrix expanded
    //   verify-browser       skipped   <- BARE NAME
    //   verify-integration   skipped   <- BARE NAME
    //
    // The required contexts are `verify-browser (22.x)` and
    // `verify-integration (22.x)`. Neither existed, so the queue sat on
    // "Expected — Waiting for status to be reported" until its timeout. Skipping a
    // matrix job renames its check, and a required check that changes name is a
    // required check that never reports.
    //
    // The fix is to gate the STEPS and let the job always expand. This asserts
    // nobody reverts to the shorter-looking version.
    //
    // Deliberately narrow: a matrix job MAY carry an `if:` that can only be false
    // when the run is already doomed — `needs.verify-self.result == 'success'` is
    // allowed, because if verify-self failed then `verify-self (22.x)` reports the
    // failure and the entry is dequeued rather than stranded. What is banned is the
    // FILTER decision, which is false on perfectly mergeable pull requests.
    const banned = [/outputs\.heavy/, /outputs\.full\b/, /full-ci/];
    for (const job of jobs) {
      if (!hasMatrix(job.lines)) continue;
      const condition = jobLevelIf(job.lines);
      if (!condition) continue;
      for (const pattern of banned) {
        assert.ok(
          !pattern.test(condition),
          `job \`${job.name}\` has a matrix and a job-level \`if:\` matching ${pattern} — ` +
            `a skipped matrix job files its check under the BARE name, so the ` +
            `\`(22.x)\` context required by branch protection would never report. ` +
            `Gate the steps instead.\n  if: ${condition}`,
        );
      }
    }
  });

  await t.test("the filtered heavy jobs gate every step", () => {
    // The other half of the same contract: if the job always runs, then every step
    // that costs real time must carry the gate, or filtering buys nothing. A step
    // added later without one would quietly reinstate the full cost.
    for (const name of ["verify-browser", "verify-integration"]) {
      const job = jobs.find((j) => j.name === name);
      assert.ok(job, `${name} not found`);
      assert.ok(
        job.lines.some((l) => /^ {6}RUN_HEAVY:/.test(l)),
        `${name} must declare RUN_HEAVY at job level`,
      );

      const stepStarts = job.lines
        .map((l, i) => (/^ {6}- (name|uses):/.test(l) ? i : -1))
        .filter((i) => i >= 0);
      assert.ok(stepStarts.length >= 5, `${name}: expected to find its steps, found ${stepStarts.length}`);

      for (const at of stepStarts) {
        const label = job.lines[at].trim();
        // Read this step's own keys, which are indented one level deeper.
        const body = [];
        for (let i = at + 1; i < job.lines.length && !/^ {6}- /.test(job.lines[i]); i++) {
          body.push(job.lines[i]);
        }
        const condition = [job.lines[at], ...body]
          .filter((l) => /^ {8}if:/.test(l))
          .join(" ");
        assert.ok(
          /RUN_HEAVY/.test(condition),
          `${name}: step \`${label}\` has no RUN_HEAVY condition — it would run even ` +
            `when the filter says there is nothing to test.\n  if: ${condition || "(none)"}`,
        );
      }
    }
  });
});

test("ci-report.yml's inlined glob matcher cannot drift", async (t) => {
  // `ci-report.yml` decides the `ci-config-changed` label itself, from the API's
  // file list and the base branch's `ci.ciConfig`, rather than from the
  // fork-written artifact. To do that it needs glob matching, and it deliberately
  // checks out no code — so it carries its own copy of `globToRegExp`.
  //
  // A copy is the right call there and the wrong thing to leave unguarded: if it
  // drifts from the real one, the label starts disagreeing with the run it
  // describes, silently and in whichever direction the divergence falls. So the
  // copy is extracted from the workflow and compared against the module.
  const source = readFileSync(
    path.join(REPO_ROOT, ".github/workflows/ci-report.yml"),
    "utf8",
  );
  const open = source.indexOf("const globToRegExp = (glob) => {");
  assert.ok(open > 0, "ci-report.yml no longer inlines globToRegExp — delete this test or fix the label path");
  const close = source.indexOf("};", source.indexOf("return new RegExp", open)) + 2;
  const inlined = source.slice(open, close).replace(/^ +/gm, "");

  const copy = new Function(`${inlined}; return globToRegExp;`)();
  const { globToRegExp: real } = await import("../changed-areas.mjs");

  const globs = [
    ...JSON.parse(readFileSync(path.join(REPO_ROOT, "harness.config.json"), "utf8")).ci.ciConfig,
    "docs/**",
    "*.md",
    "**/*.ts",
    "packages/design-editor/**",
    "a.b+c(d)",
  ];
  const paths = [
    "harness.config.json",
    "a/harness.config.json",
    "harnessXconfig.json",
    "scripts/changed-areas.mjs",
    "scripts/verify-self.mjs",
    "scripts/verify-.mjs",
    "scripts/agent/verify-x.mjs",
    "scripts/test/changed-areas.test.mjs",
    ".github/workflows/ci.yml",
    ".github/workflows/a/b/c.yml",
    ".github/CODEOWNERS",
    "package.json",
    "packages/frontend/package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "knip.json",
    "README.md",
    "packages/README.md",
    "docs/design/README.md",
    "packages/design-editor/src/plugin/index.ts",
    "a.b+c(d)",
  ];

  await t.test("agrees with scripts/changed-areas.mjs on every pair", () => {
    for (const glob of globs) {
      for (const file of paths) {
        assert.equal(
          copy(glob).test(file),
          real(glob).test(file),
          `divergence: glob ${JSON.stringify(glob)} against ${file}`,
        );
      }
    }
  });

  await t.test("the pairs actually exercise both branches", () => {
    // A vacuous comparison would pass the subtest above while proving nothing, so
    // assert the corpus contains at least one match and one non-match.
    const results = globs.flatMap((g) => paths.map((f) => real(g).test(f)));
    assert.ok(results.some(Boolean), "no glob matched anything");
    assert.ok(results.some((r) => !r), "every glob matched everything");
  });
});

// ---------------------------------------------------------------------------
// `ci-report.yml` holds the only write-capable token in the CI pair, and runs on
// `workflow_run` — so a mistake in it cannot fail a pull request. It fails after
// the merge, on main, and the only symptom is a report that stops arriving. Both
// guards below exist because that already happened.

const REPORT_PATH = path.join(REPO_ROOT, ".github/workflows/ci-report.yml");

/**
 * `ci-report.yml`'s steps: `{ name, token, script }`. Line-based for the same
 * reason as `readJobs()` above. `script` is the block scalar's body, dedented;
 * null if the step has none.
 */
function readReportSteps() {
  const lines = readFileSync(REPORT_PATH, "utf8").split("\n");
  const heads = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^ {6}- (name|uses):/.test(lines[i])) heads.push(i);
  }
  assert.ok(
    heads.length >= 5,
    `ci-report.yml: expected to find its steps, found ${heads.length}`,
  );

  return heads.map((start, n) => {
    const body = lines.slice(start, heads[n + 1] ?? lines.length);
    const nameLine = body.find((l) => /^ {6}- name:|^ {8}name:/.test(l));
    const tokenLine = body.find((l) => /^ {10}github-token:/.test(l));
    const ifLine = body.find((l) => /^ {8}if:/.test(l));

    let script = null;
    const scriptAt = body.findIndex((l) => /^ {10}script: \|/.test(l));
    if (scriptAt >= 0) {
      const out = [];
      for (let i = scriptAt + 1; i < body.length; i++) {
        if (body[i].trim() !== "" && !/^ {12}/.test(body[i])) break;
        out.push(body[i].slice(12));
      }
      script = out.join("\n");
    }

    return {
      name: nameLine ? nameLine.replace(/^\s*-?\s*name:/, "").trim() : `step ${n + 1}`,
      token: tokenLine ? tokenLine.replace(/^ {10}github-token:/, "").trim() : null,
      condition: ifLine ? ifLine.replace(/^ {8}if:/, "").trim() : null,
      script,
    };
  });
}

test("ci-report.yml's inline scripts require only Node builtins", () => {
  // THE BUG THIS EXISTS FOR. #831 wanted a second Octokit on the ambient token
  // and built it inside the `github-script` body with
  //
  //   require('@actions/github').getOctokit(process.env.READ_TOKEN)
  //
  // `actions/github-script` injects one already-bound `github` client per step
  // and does NOT make `@actions/github` requirable: the action is bundled, and
  // this workflow checks out no code on purpose, so `require` has no
  // `node_modules` to resolve against. `READ_TOKEN` was unconditionally set, so
  // the require ran on every run and threw before the first API call. That took
  // the label AND the comment with it, on every pull request from #831 until the
  // split into a read step and a write step.
  const allowed = new Set(builtinModules);
  const steps = readReportSteps().filter((s) => s.script);
  assert.ok(steps.length >= 2, "ci-report.yml has no inline scripts to check");

  for (const step of steps) {
    for (const [, spec] of step.script.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      assert.ok(
        allowed.has(spec.replace(/^node:/, "")),
        `ci-report.yml step \`${step.name}\` requires ${JSON.stringify(spec)}, which is ` +
          `not a Node builtin. This workflow checks out no code, so there is nothing ` +
          `for require to resolve against and the step throws before its first API ` +
          `call. To use a second token, add another actions/github-script step with ` +
          `its own \`github-token:\` — do NOT add a checkout.`,
      );
    }
  }
});

test("ci-report.yml keeps its reads off the App token", () => {
  // The App token is minted with `permission-issues: write` and nothing else,
  // because asking for a permission the installation lacks makes the mint step
  // fail and its `continue-on-error` would then degrade every write. So the
  // reads have to come from a separate step on the ambient token.
  //
  // Nothing catches a violation at runtime today: the repository is public, so
  // these endpoints answer any valid token, and a read wrongly issued on the App
  // token would work here and 403 on a private fork of this harness. The split
  // is therefore only ever enforced by this test.
  const AMBIENT = "${{ github.token }}";
  const READS = [
    "actions.listJobsForWorkflowRun", // needs actions: read
    "pulls.listFiles", //                needs pull-requests: read
    "repos.getContent", //               needs contents: read
  ];
  const WRITES = [
    "issues.createComment",
    "issues.updateComment",
    "issues.addLabels",
    "issues.removeLabel",
  ];

  const steps = readReportSteps().filter((s) => s.script);
  const readers = steps.filter((s) => READS.some((r) => s.script.includes(r)));
  const writers = steps.filter((s) => WRITES.some((w) => s.script.includes(w)));

  assert.ok(readers.length > 0, "expected a step doing the privileged reads");
  assert.ok(writers.length > 0, "expected a step doing the PR writes");

  for (const step of readers) {
    assert.equal(
      step.token,
      AMBIENT,
      `ci-report.yml step \`${step.name}\` reads an endpoint the App token has no ` +
        `permission for, but does not run on the ambient token. Move the read to ` +
        `the resolve step, or give this step \`github-token: ${AMBIENT}\`.`,
    );
  }

  for (const step of writers) {
    assert.match(
      step.token ?? "",
      /steps\.app-token\.outputs\.token/,
      `ci-report.yml step \`${step.name}\` writes to the pull request but does not ` +
        `use the App token. The ambient token is read-only here, so the write ` +
        `would fail — silently, on a fork.`,
    );
  }

  assert.equal(
    readers.some((r) => writers.includes(r)),
    false,
    "one step both reads with ambient-only permissions and writes with the App " +
      "token — `github-script` binds ONE client per step, so it cannot do both.",
  );
});

test("ci-report.yml's skip facts read ci.yml's gate-marker step", () => {
  // THE BUG THIS EXISTS FOR. The first version of this read the heavy job's own
  // conclusion — `j.conclusion === 'skipped'`. `ci.yml` gates the STEPS and never
  // the job, because a job-level `if:` files the check run under the bare name and
  // branch protection requires the matrix one. So a heavy job that did nothing
  // still concludes `success`, that comparison was never true, and every reduced
  // run was reported as "Full CI / No job was skipped" — the comment's entire
  // payload, wrong in the one direction it exists to report, with nothing failing.
  const resolve = readReportSteps().find((s) => /Resolve what to report/.test(s.name));
  assert.ok(resolve?.script, "ci-report.yml has no `Resolve what to report` step");

  assert.ok(
    !/\.conclusion\s*===\s*['"]skipped['"]/.test(resolve.script),
    "ci-report.yml decides `skipped` by comparing a conclusion to 'skipped'. For a " +
      "JOB that is always false — ci.yml gates steps, not jobs — so read the " +
      "gate-marker step's conclusion instead.",
  );

  const declared = resolve.script.match(/const GATE_STEP = '([^']+)'/);
  assert.ok(declared, "ci-report.yml no longer declares GATE_STEP");
  const gateStep = declared[1];

  // The coupling, and the reason this test spans both files: that name has to be a
  // real step in every heavy job, and it has to be the one that runs only when the
  // gate is CLOSED. Rename it in ci.yml alone and every run reports as full CI.
  const jobs = readJobs();
  for (const name of ["verify-browser", "verify-integration"]) {
    const job = jobs.find((j) => j.name === name);
    assert.ok(job, `${name} not found in ci.yml`);

    const at = job.lines.findIndex((l) => /^ {6}- name:/.test(l) && l.includes(gateStep));
    assert.ok(
      at >= 0,
      `ci-report.yml looks for a step named ${JSON.stringify(gateStep)} in ${name}, ` +
        `and ci.yml has none — the two files have drifted and every reduced run ` +
        `would be reported as the whole suite.`,
    );

    const body = [];
    for (let i = at + 1; i < job.lines.length && !/^ {6}- /.test(job.lines[i]); i++) {
      body.push(job.lines[i]);
    }
    const condition = body.filter((l) => /^ {8}if:/.test(l)).join(" ");
    assert.match(
      condition,
      /RUN_HEAVY != 'true'/,
      `${name}: the gate-marker step ${JSON.stringify(gateStep)} must run only when ` +
        `the gate is closed (\`RUN_HEAVY != 'true'\`), or its success proves nothing ` +
        `about whether the job did any work.\n  if: ${condition || "(none)"}`,
    );
  }
});

test("ci-report.yml writes nothing until the pull request is bound", () => {
  // `ci-context/pr-number` is produced by a job that ran the pull request's own
  // code, so on a fork it is attacker-chosen. The read step validates it against
  // `run.head_sha` and leaves `pr_number` unset when it does not match — this
  // `if:` is the whole reason that validation binds rather than advises.
  const writes = readReportSteps().filter((s) => s.token?.includes("app-token"));
  assert.equal(
    writes.length,
    1,
    `expected exactly one App-token step in ci-report.yml, found ${writes.length}`,
  );
  assert.match(
    writes[0].condition ?? "(none)",
    /steps\.resolve\.outputs\.pr_number != ''/,
    `step \`${writes[0].name}\` writes on the App token with no \`pr_number\` gate, ` +
      `so an unvalidated number would be commented on and labelled.`,
  );
});

test("ci-report.yml's scope heading is what ran, not what changed", () => {
  // `skipped` is measured from the run's own steps. The gating-file list is
  // recomputed independently — base-branch globs against the API's file list — so
  // the two can disagree, and only the first is evidence of what happened. The
  // gating-file block may append a reason; it must never own the heading, or the
  // comment asserts a suite that did not run.
  const step = readReportSteps().find((s) => s.script?.includes("const marker ="));
  assert.ok(step, "ci-report.yml has no comment-body step");
  const lines = step.script.split("\n");

  const scopeAt = lines.findIndex((l) => l.includes("if (skipped === null)"));
  const gatingAt = lines.findIndex((l) => l.includes("if (gatingFiles"));
  assert.ok(scopeAt >= 0, "the body no longer branches on `skipped`");
  assert.ok(gatingAt >= 0, "the body no longer reports which gating files changed");
  assert.ok(
    scopeAt < gatingAt,
    "the gating-file branch is reached first, so a run whose heavy jobs were " +
      "skipped is still reported as the whole suite. The heading has to come from " +
      "`skipped`, and the gating files after it.",
  );

  // Bounded to the gating block. `readReportSteps` has already dedented the script
  // body, so the closing brace sits at column 0.
  const end = lines.findIndex((l, i) => i > gatingAt && /^\}$/.test(l));
  assert.ok(end > gatingAt, "could not find the end of the gating-file block");
  const block = lines.slice(gatingAt, end).join("\n");
  assert.ok(
    !/lines\.push\([`']###/.test(block),
    "the gating-file block pushes its own `###` heading. It may add a reason, but " +
      "the heading must state what the run actually did.",
  );

  // The three headings the run's own facts produce, and nothing else.
  for (const heading of ["### CI scope unknown", "### Reduced CI", "### Full CI"]) {
    assert.ok(
      step.script.includes(heading),
      `the comment body no longer has a ${JSON.stringify(heading)} branch`,
    );
  }
});

test("ci-report.yml interpolates no artifact field raw", () => {
  // `summary.json` and `areas.json` are written by a job running the pull
  // request's own code. Reaching markdown, every string from them goes through
  // `clean` (which strips `<`, `>`, backticks, pipes and newlines) and every count
  // through a numeric coercion. Interpolated raw, one of them can forge the
  // `<!-- harness-verification -->` marker this file upserts on — arbitrary hidden
  // markup published under the bot's identity, on a comment reviewers trust.
  const step = readReportSteps().find((s) => s.script?.includes("const marker ="));
  assert.ok(step, "ci-report.yml has no comment-body step");

  for (const line of step.script.split("\n")) {
    if (!/lines\.push\(/.test(line)) continue;
    for (const [, expr] of line.matchAll(/\$\{([^}]+)\}/g)) {
      assert.ok(
        !/\b(summary|areas)\b/.test(expr),
        `ci-report.yml interpolates \`${expr.trim()}\` straight into the comment. ` +
          `Route it through \`clean\`, or coerce it if it is a count.\n  ${line.trim()}`,
      );
    }
  }
});
