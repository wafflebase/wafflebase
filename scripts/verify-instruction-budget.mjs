// The instruction text Claude Code loads into every session stays small.
//
// Claude Code reads `CLAUDE.md` at the start of every session, follows its
// `@path` imports (recursively), and loads every `.claude/rules/*.md` that has
// no `paths:` filter. Every character of that costs attention on every task,
// relevant or not, and past 150k characters Claude Code starts dropping files:
// it once loaded the backend README's 93k of env-var reference and silently
// skipped the four engine READMEs that `CLAUDE.md` asked for. This check sums
// what a session is made to load and fails past the budget, so that cannot
// creep back one import at a time.
//
// What it does NOT count, deliberately: `~/` imports and `CLAUDE.local.md`
// (personal, not in the repo), rules with a `paths:` filter (loaded only when
// Claude works on a matching file), nested `CLAUDE.md` files (loaded on demand
// when Claude reads under that directory), and skills (only the name and
// description load up front). Imports inside code spans, fenced blocks and
// HTML comments are not imports, which is how Claude Code reads them too;
// `prose()` from verify-doc-links strips them the same way for both checks.
//
// Usage: node scripts/verify-instruction-budget.mjs   (from anywhere in the repository)
//        INSTRUCTION_BUDGET_CHARS=40000 node scripts/verify-instruction-budget.mjs

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { prose } from "./verify-doc-links.mjs";

const PREFIX = "[verify:instruction-budget]";

/** The default budget, in characters, for everything a session must load. */
export const DEFAULT_BUDGET = 30_000;

/** Claude Code stops following imports past this depth. */
const MAX_DEPTH = 5;

/** The `@path` import targets written in `text`, in order. */
export function findImports(text) {
  const out = [];
  const re = /(?:^|[\s(])@((?:~\/|\.{1,2}\/)?[A-Za-z0-9_\-./]*[A-Za-z0-9_\-/])/g;
  for (const m of prose(text).matchAll(re)) out.push(m[1]);
  return out;
}

/** Whether a rule file's frontmatter scopes it with `paths:`. */
export function isPathScoped(text) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  // An empty filter (`paths: []`, or `paths:` with no entries) is counted as
  // unscoped: what Claude Code does with one is unverified, and over-counting
  // is the safe direction for a budget.
  return fm !== null && /^paths\s*:\s*(?:\[\s*[^\]\s]|\r?\n\s+-\s*\S)/m.test(fm[1]);
}

function rulesFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return rulesFiles(p);
    return e.isFile() && e.name.endsWith(".md") ? [p] : [];
  });
}

/**
 * Every repository file a session at `root` is made to load, with its size in
 * characters. Each file counts once, however many times it is imported.
 */
export function alwaysLoadedInstructions(root, missing = []) {
  const seen = new Map();
  const visit = (file, depth, from) => {
    const abs = path.resolve(file);
    if (seen.has(abs)) return;
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      if (from) missing.push({ from: path.relative(root, from), target: path.relative(root, abs) });
      return;
    }
    const text = readFileSync(abs, "utf8");
    seen.set(abs, text.length);
    if (depth >= MAX_DEPTH) return;
    for (const target of findImports(text)) {
      if (target.startsWith("~/")) continue;
      visit(path.resolve(path.dirname(abs), target), depth + 1, abs);
    }
  };
  visit(path.join(root, "CLAUDE.md"), 0);
  for (const rule of rulesFiles(path.join(root, ".claude", "rules"))) {
    if (!isPathScoped(readFileSync(rule, "utf8"))) visit(rule, 0);
  }
  return [...seen].map(([abs, chars]) => ({ path: path.relative(root, abs), chars }));
}

/** The budget from `INSTRUCTION_BUDGET_CHARS`, or the default. */
export function budgetFrom(env = process.env) {
  const n = Number(env.INSTRUCTION_BUDGET_CHARS);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_BUDGET;
}

function isDirectRun() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const missing = [];
  const files = alwaysLoadedInstructions(root, missing);
  for (const m of missing) console.warn(`${PREFIX} warning: ${m.from} imports @${m.target}, which does not exist; Claude Code skips it (a package name in prose reads as an import; put it in backticks).`);
  const total = files.reduce((sum, f) => sum + f.chars, 0);
  const budget = budgetFrom();
  if (total > budget) {
    console.error(`${PREFIX} every session loads ${total} chars of instructions, over the ${budget}-char budget:`);
    for (const f of [...files].sort((a, b) => b.chars - a.chars)) console.error(`  ${String(f.chars).padStart(7)}  ${f.path}`);
    console.error("");
    console.error(`${PREFIX} keep CLAUDE.md to what Claude cannot read from the code:`);
    console.error("  - reference material → a plain path in CLAUDE.md, not an @import");
    console.error("  - a rule for one area → .claude/rules/<name>.md with a paths: filter");
    console.error("  - a multi-step procedure → .claude/skills/<name>/SKILL.md");
    process.exitCode = 1;
  } else {
    console.log(`${PREFIX} every session loads ${total} chars of instructions (budget ${budget}) from ${files.length} file(s).`);
  }
}
