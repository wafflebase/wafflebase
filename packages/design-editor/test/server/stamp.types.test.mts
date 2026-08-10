import { describe, expect, it } from 'vitest';
import { stampSource } from '../../src/server/stamp.mjs';

/**
 * Deliberately `.mts` while `stamp.test.mjs` is `.mjs`.
 *
 * `stamp.mjs` is plain JS carrying `// @ts-check` and JSDoc. That pragma now
 * runs (`allowJs` is on), so the annotations are checked against the
 * implementation — but nothing was checking them against a CONSUMER. This file
 * is that consumer: it imports from TypeScript, exactly as the sandbox Vite
 * config's dynamic import does, so a JSDoc signature that no longer matches how
 * the module is actually called fails `pnpm typecheck`.
 *
 * The behavioural suite cannot stand in for this — it is `.mjs` with no pragma,
 * so its calls are never type-checked.
 *
 * NOTE: this file replaces a `stamp.d.mts` that shipped with the prototype. An
 * adjacent declaration file SHADOWS the implementation: with it present, `tsc`
 * loaded `stamp.d.mts` and dropped `stamp.mjs` from the program entirely, so
 * `// @ts-check` never ran and the declaration was free to drift from the code
 * it described. Verified by planting a type error in `stamp.mjs` — 0 errors with
 * the declaration present, 3 without it.
 */

describe('stamp.mjs types hold at a TypeScript call site', () => {
  it('accepts (text, file) and returns { text, stamped }', () => {
    const result: { text: string; stamped: string[] } = stampSource(
      `function C(){ return <div/>; }`,
      'src/a.tsx',
    );
    expect(result.text).toContain('data-wb-node="C:0"');
    expect(result.stamped).toEqual(['C:0']);
  });

  it('declares `file` as optional', () => {
    const result = stampSource(`function C(){ return <div/>; }`);
    expect(result.stamped).toEqual(['C:0']);
  });
});
