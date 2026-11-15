// `docs/` holds design documents and task records, and nothing else.
//
// Every file git tracks under `docs/` must be `docs/README.md` or sit under
// `docs/design/` or `docs/tasks/`. Plans, notes and generated output an agent
// or a tool drops elsewhere in `docs/` (`docs/superpowers/…` was the case that
// started it) are refused. The rule is CLAUDE.md's task workflow, written down
// where it runs.
//
// IT READS GIT'S INDEX, so one check serves both places it runs. In CI the
// index is the checkout. In `.githooks/pre-commit`, which runs `pnpm
// verify:fast`, the index is what is about to be committed, so a staged file
// is caught before the commit exists. This used to be a separate block in the
// hook alone, which nothing ran in CI and which an agent job that does not
// wire the hooks never ran at all.
//
// Usage: node scripts/verify-docs-paths.mjs   (from anywhere in the repository)

import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PREFIX = "[verify:docs-paths]";

/** What may live under `docs/`. */
export const ALLOWED = [/^docs\/README\.md$/, /^docs\/design\//, /^docs\/tasks\//];

/** The paths under `docs/` that are not allowed. */
export function disallowedDocsPaths(paths) {
  return paths.filter((p) => p.startsWith("docs/") && !ALLOWED.some((re) => re.test(p)));
}

/**
 * Every path git's index holds under `docs/`, for the repository at `root`.
 * `env` is the process's own by default: in the pre-commit hook git sets
 * `GIT_INDEX_FILE` to the index being committed, which is the one to read.
 */
export function indexedDocsPaths(root, env = process.env) {
  const out = execFileSync("git", ["ls-files", "-z", "--cached", "--", "docs"], { cwd: root, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out.split("\0").filter(Boolean);
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
  const bad = disallowedDocsPaths(indexedDocsPaths(root));
  if (bad.length > 0) {
    console.error(`${PREFIX} files under a docs/ directory that is not allowed:`);
    for (const p of bad) console.error(`  ${p}`);
    console.error("");
    console.error(`${PREFIX} only docs/design/ and docs/tasks/ (and docs/README.md) are permitted:`);
    console.error("  - design documents → docs/design/<topic>.md");
    console.error("  - task tracking    → docs/tasks/active/YYYYMMDD-<slug>-todo.md");
    process.exitCode = 1;
  } else {
    console.log(`${PREFIX} every file under docs/ is a design document or a task record.`);
  }
}
