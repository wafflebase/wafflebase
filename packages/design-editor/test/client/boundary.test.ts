import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
const CLIENT = path.join(SRC, 'client');

/** `node:fs` and `fs` are the same module; only the first form is obvious. */
const BUILTINS = new Set(builtinModules);
const isBuiltin = (spec: string) => BUILTINS.has(spec.replace(/^node:/, ''));

// `import … from 'x'`, and bare `import 'x'`.
const IMPORT_RE = /\bimport\s+(?!type\b)([\s\S]*?\bfrom\s*)?['"]([^'"]+)['"]/g;
/**
 * `export { … } from 'x'` and `export * from 'x'` — runtime dependencies too, and
 * the form `client/index.ts` is almost entirely built from.
 *
 * The shape is pinned to `*` or `{…}` rather than reusing the import pattern's lazy
 * clause: `export const label = 'Color'` also ends in a quoted string, and a lazy
 * match would read that as a dependency named `Color`.
 */
const EXPORT_RE = /\bexport\s+(?!type\b)(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g;

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
  const queue = fs
    .readdirSync(CLIENT)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => path.join(CLIENT, f));
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
});
