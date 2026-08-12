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
