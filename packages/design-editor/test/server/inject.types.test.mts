import { describe, expect, it } from 'vitest';
import {
  applyLayoutInsert,
  applyLayoutProps,
  applyLayoutRemove,
  insertImport,
  unifiedDiff,
} from '../../src/server/inject.mjs';

/**
 * Deliberately `.mts` while `inject.test.mjs` is `.mjs`.
 *
 * `inject.mjs` is plain JS carrying `// @ts-check` and JSDoc, so the annotations
 * are checked against the implementation — but nothing checks them against a
 * CONSUMER. This file is that consumer: it imports from TypeScript, exactly as
 * the plugin's dynamic import does, so a JSDoc signature that no longer matches
 * how the module is actually called fails `pnpm typecheck`.
 *
 * NOTE: this replaces the `inject.d.mts` that shipped with the prototype, and is
 * why that file was not ported. An adjacent declaration file SHADOWS the
 * implementation — `tsc` loads the declaration and drops the `.mjs` from the
 * program, so `// @ts-check` never runs and the declaration drifts freely.
 * Measured on the sibling `stamp.mjs`: 0 errors with it present, 3 without.
 */

const anchor = { component: 'C', path: [0, 1], tag: 'Beta', fp: 'abc12345' };

describe('inject.mjs types hold at a TypeScript call site', () => {
  it('every op returns the same {located, text} envelope', () => {
    const r: { located: boolean; text: string; reason?: string } = applyLayoutProps('', {
      anchor,
      sets: [{ name: 'id', value: 'x' }],
    });
    expect(r.located).toBe(false);
  });

  it('applyLayoutRemove additionally reports the span it cut', () => {
    // `removedText` is what the client replays to undo, so it has to survive
    // into the public type — a caller cannot implement undo without it.
    const r: {
      located: boolean;
      text: string;
      removedText?: string;
      removedIndex?: number;
      parentPath?: number[];
    } = applyLayoutRemove('', { anchor });
    expect(r.located).toBe(false);
  });

  it('accepts a null value for removing an attribute', () => {
    const r = applyLayoutProps('', { anchor, sets: [{ name: 'id', value: null }] });
    expect(r.located).toBe(false);
  });

  it('rejects a valueKind outside the union', () => {
    // The two kinds route to different escaping, and `expression` is the guarded
    // one. A typo must not silently fall through to the unguarded branch.
    expect(() =>
      applyLayoutProps('', {
        anchor,
        // @ts-expect-error - 'raw' is not a valueKind
        sets: [{ name: 'id', value: 'x', valueKind: 'raw' }],
      }),
    ).not.toThrow();
  });

  it('requires parent/index/raw on an insert', () => {
    const r = applyLayoutInsert('', { parent: anchor, index: 0, raw: '<X/>', verbatim: true });
    expect(r.located).toBe(false);
  });

  it('rejects an insert missing its index', () => {
    expect(() =>
      // @ts-expect-error - `index` is required
      applyLayoutInsert('', { parent: anchor, raw: '<X/>' }),
    ).not.toThrow();
  });

  it('takes an import spec with optional named/default', () => {
    expect(insertImport('', { module: './m' }).located).toBe(false);
    expect(insertImport('', { module: './m', named: ['A'], default: 'D' }).located).toBe(true);
  });

  it('unifiedDiff returns a string and takes an optional context', () => {
    const s: string = unifiedDiff('a', 'b', 1);
    expect(typeof s).toBe('string');
  });
});
