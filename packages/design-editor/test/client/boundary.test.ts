import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
const CLIENT = path.join(SRC, 'client');

/** Specifiers a module imports for their VALUE — `import type` is erased. */
function valueImports(file: string): string[] {
  const text = fs.readFileSync(file, 'utf8');
  const out: string[] = [];
  // `import … from 'x'` and bare `import 'x'`, minus the type-only forms.
  const re = /import\s+(?!type\b)([\s\S]*?from\s*)?['"]([^'"]+)['"]/g;
  for (const m of text.matchAll(re)) {
    const clause = m[1] ?? '';
    // A mixed clause (`import { type A, b }`) still imports `b` for its value.
    if (/^\s*\{\s*(?:type\s+[^,}]+,?\s*)+\}\s*from\s*$/.test(clause)) continue;
    out.push(m[2]);
  }
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
  it('reaches no node builtin, however deep the import chain', () => {
    // 9b is the first PR where the client imports a module outside `client/` for its
    // VALUE — `camelToKebab`, from the token contract. That is safe today because
    // `tokens/adapter.ts` has no imports at all, and this is what keeps it safe: a
    // later value import from `plugin/` would put `node:fs` in a browser bundle, and
    // nothing else in the suite would notice.
    expect(closure().filter((s) => s.startsWith('node:'))).toEqual([]);
  });

  it('sees the value import it is guarding, so it is not vacuously empty', () => {
    expect(closure()).toContain('tokens/adapter.ts');
  });
});
