// Every workflow declares its token permissions at the workflow level.
//
// WHY. A workflow with no `permissions:` block gives each job that does not
// declare its own the repository's default token. That default has been
// write-all, so a job that only builds and tests could push, label and
// publish. With a workflow-level block in every file, the default no longer
// reaches any job, and the repository default can be set to read-only
// without changing what any job is granted.
//
// A job that needs something different names it in its own `permissions:`.
// `write-all` is refused at the workflow level: the block exists to narrow
// the grant, not to restate the old default.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const WORKFLOWS = path.join(REPO, ".github", "workflows");

// Reached through packages/cli, as agent-workflow-guards.test.mjs does.
const YAML = (() => {
  try {
    return createRequire(path.join(REPO, "packages/cli/package.json"))("yaml");
  } catch (e) {
    throw new Error(`this test reads YAML with \`yaml\`, a dependency of packages/cli — run pnpm install (${e.message})`);
  }
})();

/** Why `text`'s workflow-level permissions are missing or too wide, or null. */
function problem(text) {
  const wf = YAML.parse(text);
  if (!wf || !Object.hasOwn(wf, "permissions")) return "no workflow-level `permissions:`";
  const p = wf.permissions;
  if (p === null) return "an empty `permissions:` (write `{}` to grant nothing)";
  if (p === "write-all") return "`permissions: write-all`";
  if (typeof p === "string" && p !== "read-all") return `unknown \`permissions: ${p}\``;
  return null;
}

test("every workflow declares workflow-level token permissions", () => {
  const files = readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f)).sort();
  assert.ok(files.length >= 10, `found only ${files.length} workflows`);
  const bad = files
    .map((f) => [f, problem(readFileSync(path.join(WORKFLOWS, f), "utf8"))])
    .filter(([, why]) => why)
    .map(([f, why]) => `${f}: ${why}`);
  assert.deepEqual(bad, []);
});

test("the checker refuses a missing or widened block", () => {
  const body = "on: push\njobs:\n  j:\n    runs-on: x\n    steps:\n      - run: echo\n";
  for (const ok of ["permissions: {}\n", "permissions:\n  contents: read\n", "permissions: read-all\n"]) {
    assert.equal(problem(ok + body), null, ok);
  }
  for (const bad of ["", "permissions:\n", "permissions: write-all\n", "permissions: write\n"]) {
    assert.notEqual(problem(bad + body), null, JSON.stringify(bad));
  }
  // A job-level block alone does not count: a second job would get the default.
  assert.notEqual(problem(body.replace("    runs-on: x\n", "    runs-on: x\n    permissions: {}\n")), null);
});
