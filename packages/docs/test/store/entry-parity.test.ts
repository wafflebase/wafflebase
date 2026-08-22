// packages/docs/test/store/entry-parity.test.ts
//
// The block-level edit helpers are re-exported by both entries: the browser
// entry (`src/index.ts`) and the DOM-free Node entry (`src/node.ts`).
// `YorkieDocStore` imports them from `@wafflebase/docs` and runs under Node in
// the frontend `.integration.ts` suites, which resolve to the Node entry — so a
// helper exported from only the browser entry fails at import time there, not
// in any unit lane. This guards the "kept in sync" comment on both files.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SOURCE = './store/block-helpers.js';

/** Names re-exported from `block-helpers.js` by an entry file, ignoring `export type`. */
function blockHelperExports(entry: string): Set<string> {
  const src = readFileSync(fileURLToPath(new URL(entry, import.meta.url)), 'utf8');
  const names = new Set<string>();
  for (const match of src.matchAll(/export\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)) {
    if (match[2] !== SOURCE) continue;
    for (const clause of match[1].split(',')) {
      // `applyInlineStyle as applyInlineStyleHelper` — the public name is the alias.
      const name = clause.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) names.add(name);
    }
  }
  return names;
}

describe('docs entry parity', () => {
  it('re-exports every block helper from the Node entry too', () => {
    const browser = blockHelperExports('../../src/index.ts');
    const node = blockHelperExports('../../src/node.ts');

    expect(browser.size).toBeGreaterThan(0);
    expect([...browser].filter((name) => !node.has(name))).toEqual([]);
  });
});
