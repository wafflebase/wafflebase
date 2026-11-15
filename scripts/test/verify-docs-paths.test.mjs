import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { disallowedDocsPaths, indexedDocsPaths } from "../verify-docs-paths.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");

test("docs/design/, docs/tasks/ and docs/README.md are allowed; anything else under docs/ is not", () => {
  assert.deepEqual(
    disallowedDocsPaths([
      "docs/README.md",
      "docs/design/x.md",
      "docs/design/agent-pipeline/y.md",
      "docs/tasks/active/20261115-x-todo.md",
      "docs/tasks/archive/2026/11/z.md",
      "README.md",
      "packages/docs/src/a.ts",
    ]),
    [],
  );
  assert.deepEqual(
    disallowedDocsPaths(["docs/superpowers/plan.md", "docs/notes.md", "docs/designs/x.md", "docs/tasksx/y.md", "docs/README.md.bak"]),
    ["docs/superpowers/plan.md", "docs/notes.md", "docs/designs/x.md", "docs/tasksx/y.md", "docs/README.md.bak"],
  );
});

test("it reads git's index: a staged file is refused before it is committed", (t) => {
  const repo = mkdtempSync(path.join(tmpdir(), "docs-paths-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
  git("init", "-q");
  mkdirSync(path.join(repo, "docs", "design"), { recursive: true });
  mkdirSync(path.join(repo, "docs", "superpowers"), { recursive: true });
  writeFileSync(path.join(repo, "docs", "design", "a.md"), "a");
  writeFileSync(path.join(repo, "docs", "superpowers", "b.md"), "b");
  git("add", "docs/design/a.md");
  // An untracked file is not in the index, and not yet anyone's problem.
  assert.deepEqual(disallowedDocsPaths(indexedDocsPaths(repo)), []);
  git("add", "docs/superpowers/b.md");
  assert.deepEqual(disallowedDocsPaths(indexedDocsPaths(repo)), ["docs/superpowers/b.md"]);
});

test("this repository's docs/ is clean, and the check runs where CI and the hook reach it", () => {
  assert.deepEqual(disallowedDocsPaths(indexedDocsPaths(ROOT)), []);
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "verify-docs-paths.mjs")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /every file under docs\//);
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.scripts["verify:docs-paths"], "node ./scripts/verify-docs-paths.mjs");
  // `verify:fast` (the pre-commit gate) runs it first…
  assert.match(pkg.scripts["verify:fast"], /^pnpm verify:docs-paths && /);
  // …`verify:self` (CI) has it as a lane…
  assert.match(readFileSync(path.join(ROOT, "scripts", "verify-self.mjs"), "utf8"), /name: "verify:docs-paths",\n\s+cmd: "pnpm verify:docs-paths",/);
  // …and the hook no longer carries a copy of its own.
  const hook = readFileSync(path.join(ROOT, ".githooks", "pre-commit"), "utf8");
  assert.doesNotMatch(hook, /grep -v -E '\^docs\//);
  assert.match(hook, /^exec pnpm verify:fast$/m);
});
