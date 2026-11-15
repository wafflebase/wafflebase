// A release published by the agent App must not reach a job that holds
// publish credentials.
//
// The App (`yorkie-agent`) has `contents: write` so it can push the agent's
// branches, and that grant also lets it publish a release. Every workflow that
// runs on `release` and reads a secret therefore refuses a release the App
// authored, as a top-level condition of the job, or depends on a job that does.
//
// Line-based, like `ci-workflow.test.mjs`: `scripts/` has no parser to import.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WORKFLOWS = path.join(REPO_ROOT, ".github/workflows");
const APP_BOT = "yorkie-agent[bot]";
const GUARD = `github.event_name != 'release' || github.event.release.author.login != '${APP_BOT}'`;

function workflows() {
  return readdirSync(WORKFLOWS)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => ({ file: f, text: readFileSync(path.join(WORKFLOWS, f), "utf8") }));
}

/** Whether the top-level `on:` block names `release`. */
function onRelease(text) {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => /^on:\s*$/.test(l));
  if (at < 0) return /^on:.*\brelease\b/m.test(text);
  for (let i = at + 1; i < lines.length && !/^\S/.test(lines[i]); i++) {
    if (/^ {2}release:/.test(lines[i])) return true;
  }
  return false;
}

/** Jobs as `{ name, lines }`, split on two-space headers under `jobs:`. */
function jobs(text) {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l === "jobs:");
  const heads = [];
  for (let i = at + 1; i < lines.length; i++) if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[i])) heads.push(i);
  return heads.map((s, n) => ({ name: lines[s].trim().replace(/:$/, ""), lines: lines.slice(s, heads[n + 1] ?? lines.length) }));
}

/** The job-level `if:` (four-space key, inline or folded), whitespace-collapsed. */
function jobIf(job) {
  const i = job.lines.findIndex((l) => /^ {4}if:/.test(l));
  if (i < 0) return null;
  const first = job.lines[i].replace(/^ {4}if:\s*/, "");
  const parts = /^[>|]-?\s*$/.test(first) ? [] : [first];
  for (let k = i + 1; k < job.lines.length && /^ {6,}\S/.test(job.lines[k]); k++) parts.push(job.lines[k].trim());
  return parts.join(" ").replace(/\s+/g, " ").replace(/^\$\{\{\s*|\s*\}\}$/g, "").trim();
}

/** The guard as the whole condition, or as its last top-level `&&` operand. */
function guarded(cond) {
  if (cond == null || /always\(\)|cancelled\(\)|failure\(\)/.test(cond)) return false;
  return cond === GUARD || cond.endsWith(`&& (${GUARD})`);
}

function needs(job) {
  const line = job.lines.find((l) => /^ {4}needs:/.test(l));
  if (!line) return [];
  return line.replace(/^ {4}needs:\s*/, "").replace(/[[\]]/g, "").split(",").map((s) => s.trim()).filter(Boolean);
}

function unguardedSecretJobs(text) {
  const all = jobs(text);
  const byName = new Map(all.map((j) => [j.name, j]));
  const safe = (j, seen = new Set()) => {
    if (guarded(jobIf(j))) return true;
    if (seen.has(j.name)) return false;
    seen.add(j.name);
    // A job with no condition of its own is skipped when a needed job is.
    if (jobIf(j) !== null) return false;
    return needs(j).some((n) => byName.has(n) && safe(byName.get(n), seen));
  };
  return all.filter((j) => j.lines.some((l) => /\bsecrets\./.test(l)) && !safe(j)).map((j) => j.name);
}

test("every release-triggered job that reads a secret refuses a release the agent App published", () => {
  const releasing = workflows().filter((w) => onRelease(w.text));
  assert.ok(releasing.length >= 2, "expected the publish workflows to run on release");
  for (const w of releasing) {
    assert.deepEqual(unguardedSecretJobs(w.text), [], `${w.file}: jobs reading secrets without the App release guard`);
  }
});

test("the guard names the App the agent workflows actually run as", () => {
  const panel = readFileSync(path.join(WORKFLOWS, "agent-review-panel.yml"), "utf8");
  assert.ok(panel.includes(`'${APP_BOT}'`), `agent-review-panel.yml no longer names ${APP_BOT}; update APP_BOT here and in the publish workflows`);
});

test("the checker refuses the loosenings it exists to catch", () => {
  const wf = (cond, extra = "") => `on:\n  release:\n    types: [published]\njobs:\n  build:\n${cond === null ? "" : `    if: >-\n      ${cond}\n`}    runs-on: x\n    steps:\n      - run: echo \${{ secrets.T }}\n${extra}`;
  const ok = `(github.event_name != 'workflow_run') && (${GUARD})`;
  assert.deepEqual(unguardedSecretJobs(wf(ok)), []);
  assert.deepEqual(unguardedSecretJobs(wf(GUARD)), []);
  for (const bad of [
    null,
    `github.event_name != 'workflow_run'`,
    `(${GUARD}) || github.event_name == 'release'`,
    `always() && (${GUARD})`,
    `(x) && (github.event_name != 'release' || github.event.release.author.login != 'someone-else[bot]')`,
  ]) {
    assert.deepEqual(unguardedSecretJobs(wf(bad)), ["build"], String(bad));
  }
  // A dependent job is covered by its guarded need, unless it has its own condition.
  const dep = (cond) => `  merge:\n    needs: build\n${cond ? `    if: ${cond}\n` : ""}    runs-on: x\n    steps:\n      - run: echo \${{ secrets.T }}\n`;
  assert.deepEqual(unguardedSecretJobs(wf(ok, dep(null))), []);
  assert.deepEqual(unguardedSecretJobs(wf(ok, dep("always()"))), ["merge"]);
});
