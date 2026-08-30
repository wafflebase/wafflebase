// packages/docs/test/store/entry-parity.test.ts
//
// Names re-exported by both entries: the browser entry (`src/index.ts`) and
// the DOM-free Node entry (`src/node.ts`).
//
// `YorkieDocStore` imports the block helpers from `@wafflebase/docs` and runs
// under Node in the frontend `.integration.ts` suites, which resolve to the
// Node entry — so a helper exported from only the browser entry fails at
// import time there, not in any unit lane. The model constants drift more
// quietly: nothing fails, the Node-side caller just has no way to name the
// value and hardcodes it instead, which is what happened to `MIN_CONTENT_PX`
// (#991). This guards the "kept in sync" comment on both files.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The value exports an entry file re-exports from `source`, ignoring
 * `export type`.
 *
 * Comments are stripped first. An entry file may explain why a particular name
 * is on the list, and a comment inside the braces would otherwise be split on
 * its own commas and read as several exported names.
 */
function reExports(entry: string, source: string): Set<string> {
  const src = readFileSync(fileURLToPath(new URL(entry, import.meta.url)), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  const names = new Set<string>();
  for (const match of src.matchAll(/export\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)) {
    if (match[2] !== source) continue;
    for (const clause of match[1].split(',')) {
      // `applyInlineStyle as applyInlineStyleHelper` — the public name is the alias.
      const name = clause.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) names.add(name);
    }
  }
  return names;
}

describe('docs entry parity', () => {
  it.each([
    ['block helpers', './store/block-helpers.js'],
    ['model constants', './model/types.js'],
  ])('re-exports every %s from the Node entry too', (_label, source) => {
    const browser = reExports('../../src/index.ts', source);
    const node = reExports('../../src/node.ts', source);

    expect(browser.size).toBeGreaterThan(0);
    expect([...browser].filter((name) => !node.has(name))).toEqual([]);
  });
});
