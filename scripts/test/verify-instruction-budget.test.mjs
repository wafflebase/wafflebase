import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { alwaysLoadedInstructions, budgetFrom, DEFAULT_BUDGET, findImports, isPathScoped } from "../verify-instruction-budget.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");

function fixture(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "instruction-budget-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

test("imports are @paths in prose, not in code spans or fenced blocks", () => {
  const text = [
    "See @docs/a.md for architecture, @packages/b/README.md.",
    "Personal: @~/notes.md and relative (@./c.md).",
    "Not an import: `@d.md`, an email user@e.md.",
    "```",
    "@f.md",
    "```",
  ].join("\n");
  assert.deepEqual(findImports(text), ["docs/a.md", "packages/b/README.md", "~/notes.md", "./c.md"]);
});

test("only a rule whose frontmatter has paths: is path scoped", () => {
  assert.equal(isPathScoped("---\npaths:\n  - \"src/**\"\n---\n- rule"), true);
  assert.equal(isPathScoped("---\ndescription: x\n---\n- rule"), false);
  assert.equal(isPathScoped("- rule\npaths: not frontmatter"), false);
});

test("a session loads CLAUDE.md, its imports recursively once each, and unscoped rules", (t) => {
  const dir = fixture({
    "CLAUDE.md": "Read @docs/a.md and @docs/a.md and @missing.md and @~/me.md",
    "docs/a.md": "A imports @./b.md",
    "docs/b.md": "B",
    ".claude/rules/always.md": "always",
    ".claude/rules/nested/scoped.md": "---\npaths:\n  - \"packages/x/**\"\n---\nscoped",
    "packages/x/CLAUDE.md": "nested, on demand",
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const loaded = Object.fromEntries(alwaysLoadedInstructions(dir).map((f) => [f.path, f.chars]));
  assert.deepEqual(Object.keys(loaded).sort(), [".claude/rules/always.md", "CLAUDE.md", "docs/a.md", "docs/b.md"]);
  assert.equal(loaded["docs/b.md"], 1);
});

test("the budget comes from INSTRUCTION_BUDGET_CHARS when it is a positive integer", () => {
  assert.equal(budgetFrom({}), DEFAULT_BUDGET);
  assert.equal(budgetFrom({ INSTRUCTION_BUDGET_CHARS: "40000" }), 40000);
  assert.equal(budgetFrom({ INSTRUCTION_BUDGET_CHARS: "lots" }), DEFAULT_BUDGET);
  assert.equal(budgetFrom({ INSTRUCTION_BUDGET_CHARS: "-1" }), DEFAULT_BUDGET);
});

test("the repository's own instructions fit the budget", () => {
  const run = spawnSync(process.execPath, [path.join(ROOT, "scripts", "verify-instruction-budget.mjs")], { encoding: "utf8", env: { ...process.env, INSTRUCTION_BUDGET_CHARS: "" } });
  assert.equal(run.status, 0, run.stderr);
});
