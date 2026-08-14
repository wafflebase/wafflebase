import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
/**
 * Both browser trees, not just `client/`.
 *
 * `scenes/` arrived in 10a and runs in the scene frame — a different browser
 * document, but a browser either way, so the same rule applies. Scoping this guard
 * to one directory was how it would have stopped covering the package: a new browser
 * subpath is exactly the moment a `node:` import slips in unnoticed.
 */
const BROWSER_DIRS = ['client', 'scenes'].map((d) => path.join(SRC, d));

/** `node:fs` and `fs` are the same module; only the first form is obvious. */
const BUILTINS = new Set(builtinModules);
const isBuiltin = (spec: string) => BUILTINS.has(spec.replace(/^node:/, ''));

/**
 * `import … from 'x'`, and bare `import 'x'`.
 *
 * LINE-ANCHORED, and the clause may not span a `;`. Both guards exist because the
 * first version of this had neither, and 10a is where that bit: the word "import"
 * in a doc comment — "an import specifier → the file it names" — started a match,
 * the lazy clause scanned 28 lines through the comment, and it attached to the
 * specifier of a genuinely TYPE-ONLY import far below. The file was reported as
 * value-importing a module that reaches `node:path`, so a correct file failed the
 * guard. Over-reporting is the safe direction for a leak, but a false FAILURE
 * blocks correct code, which is worse than the thing it was protecting against.
 */
const IMPORT_RE = /^[ \t]*import\s+(?!type\b)([^;]*?\bfrom\s*)?['"]([^'"]+)['"]/gm;
/**
 * `export { … } from 'x'` and `export * from 'x'` — runtime dependencies too, and
 * the form `client/index.ts` is almost entirely built from.
 *
 * The shape is pinned to `*` or `{…}` rather than reusing the import pattern's lazy
 * clause: `export const label = 'Color'` also ends in a quoted string, and a lazy
 * match would read that as a dependency named `Color`.
 */
const EXPORT_RE =
  /^[ \t]*export\s+(?!type\b)(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/gm;

/** Specifiers a module depends on at RUNTIME — `import type` / `export type` are erased. */
function valueImports(file: string): string[] {
  const text = fs.readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const m of text.matchAll(IMPORT_RE)) {
    const clause = m[1] ?? '';
    // A mixed clause (`import { type A, b }`) still imports `b` for its value.
    if (/^\s*\{\s*(?:type\s+[^,}]+,?\s*)+\}\s*from\s*$/.test(clause)) continue;
    out.push(m[2]);
  }
  // A wholly type-only member list (`export { type A } from …`) is over-reported
  // here. That is the safe direction: this guard may name a module that costs the
  // bundle nothing, but it must never miss one that does.
  for (const m of text.matchAll(EXPORT_RE)) out.push(m[1]);
  return out;
}

/** Every module the client pulls in for its value, transitively. */
function closure(): string[] {
  const seen = new Set<string>();
  const queue = BROWSER_DIRS.flatMap((dir) =>
    fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => path.join(dir, f)),
  );
  const reached: string[] = [];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of valueImports(file)) {
      if (!spec.startsWith('.')) {
        reached.push(spec);
        continue;
      }
      const resolved = path.resolve(path.dirname(file), spec);
      reached.push(path.relative(SRC, resolved));
      queue.push(resolved);
    }
  }
  return reached;
}

describe('the client bundle boundary', () => {
  it('reaches no node builtin, however deep the chain', () => {
    // 9b is the first PR where the client depends on a module outside `client/` at
    // RUNTIME — `camelToKebab`, from the token contract. That is safe today because
    // `tokens/adapter.ts` has no imports at all, and this is what keeps it safe: a
    // later value import from `plugin/` would put `node:fs` in a browser bundle, and
    // nothing else in the suite would notice.
    //
    // `builtinModules`, not a `node:` prefix test: `import fs from 'fs'` is the same
    // module by the other spelling, and the prefix test waved it through.
    expect(closure().filter(isBuiltin)).toEqual([]);
  });

  it('sees the value import it is guarding, so it is not vacuously empty', () => {
    expect(closure()).toContain('tokens/adapter.ts');
  });

  it('covers the scene tree, not only the shell client', () => {
    // `scenes/frame-protocol.ts` value-imports `base.ts` for `BASE`; if the scan
    // were still scoped to `client/`, this list would not mention it at all.
    expect(closure()).toContain('base.ts');
    for (const dir of BROWSER_DIRS) expect(fs.existsSync(dir)).toBe(true);
  });
});
