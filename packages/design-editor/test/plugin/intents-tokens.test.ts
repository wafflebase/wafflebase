/**
 * Token intents through the REAL intent pipeline, against a real filesystem.
 *
 * `test/plugin/tokens.test.ts` covers the translation and the contract in isolation. This
 * file covers the wiring 8b changed: that `filesForIntent`, `applyIntentToCache` and
 * `composeIntents` route a token intent to the adapter, that the no-adapter refusal is
 * still what an unconfigured project gets, and that a batch of token edits COMPOSES —
 * which for `cssVariables` means several edits to one stylesheet stacking rather than the
 * last one winning.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { composeIntents, computeIntent, filesForIntent, labelOf } from '../../src/plugin/intents';
import type { IntentContext, Injector } from '../../src/plugin/intents';
import { createPathGuard } from '../../src/plugin/paths';
import { createTracker } from '../../src/plugin/tracked';
import { cssVariables } from '../../src/tokens/css-variables';
import { declMap, readDecls } from '../../src/tokens/css-decls';
import type { MutateRequest } from '../../src/plugin/protocol';
import type { TokenAdapter } from '../../src/tokens/adapter';

const SHEET = 'src/index.css';

const SHADCN = `@import "tailwindcss";

:root {
  --radius: 0.625rem;
  --primary: oklch(0.205 0 0);
}

.dark {
  --primary: oklch(0.922 0 0);
}

@theme inline {
  --color-primary: var(--primary);
}
`;

/**
 * Only `unifiedDiff` is reachable from a token path, so the rest throws rather than
 * returning a plausible value: if a token intent ever calls into the JSX injector, the
 * test should fail loudly instead of quietly passing.
 */
const injector = new Proxy({} as Injector, {
  get: (_t, prop) =>
    prop === 'unifiedDiff'
      ? (before: string, after: string) => (before === after ? '' : `--- \n+++ \n`)
      : () => {
          throw new Error(`token intent unexpectedly called injector.${String(prop)}`);
        },
});

let root: string;
let ctx: IntentContext;

const contextFor = (tokens: TokenAdapter | null): IntentContext => {
  const guard = createPathGuard(root);
  return { guard, tracker: createTracker((abs) => guard.relOf(abs)), injector, tokens };
};

const sheetText = () => fs.readFileSync(path.join(root, SHEET), 'utf8');

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'de-tokens-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, SHEET), SHADCN, 'utf8');
  ctx = contextFor(cssVariables({ stylesheet: SHEET }));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const setPrimary = (value: string, theme = 'light'): MutateRequest => ({
  kind: 'token-value',
  constName: theme,
  path: ['primary'],
  tokenValue: value,
});

describe('with no adapter configured', () => {
  it('refuses the file set and names the option to pass', () => {
    const r = filesForIntent(contextFor(null), setPrimary('red'));
    expect('error' in r && r.error).toContain('no token adapter configured');
    expect('error' in r && r.error).toContain('designEditor()');
  });

  it('refuses every token kind, not just one', async () => {
    const none = contextFor(null);
    const kinds: MutateRequest[] = [
      setPrimary('red'),
      { kind: 'token-rebind', constName: 'light', path: ['primary'], tokenValue: 'x' },
      { kind: 'palette-value', path: ['syrup'], tokenValue: '#fff' },
      { kind: 'token-add', camelKey: 'brand', tokenValue: '#fff' },
      { kind: 'member-add', family: 'semantic', camelKey: 'brand', tokenValue: '#fff' },
      { kind: 'member-remove', family: 'semantic', camelKey: 'brand' },
    ];
    const composed = await composeIntents(none, kinds);
    expect(composed.results).toHaveLength(kinds.length);
    for (const r of composed.results) {
      expect(r.located).toBe(false);
      expect(r.reason).toContain('no token adapter configured');
    }
  });

  it('writes nothing', async () => {
    await composeIntents(contextFor(null), [setPrimary('red')]);
    expect(sheetText()).toBe(SHADCN);
  });
});

describe('filesForIntent', () => {
  it('routes a token intent to the adapter\'s file, not to intent.file', () => {
    // A token intent's `file` field is the client's hint; the adapter is authoritative. The
    // prototype trusted the client and a mistyped path wrote wherever it said.
    const r = filesForIntent(ctx, { ...setPrimary('red'), file: 'src/Wrong.tsx' });
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.files.map((f) => f.rel)).toEqual([SHEET]);
  });

  it('collapses a three-write plan to one file', () => {
    const r = filesForIntent(ctx, { kind: 'member-add', family: 'semantic', camelKey: 'brand', tokenValue: '#fff' });
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.files).toHaveLength(1);
  });
});

describe('computeIntent — the /mutate path', () => {
  it('computes a token value edit without writing', async () => {
    const r = await computeIntent(ctx, setPrimary('red'));
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.located).toBe(true);
    expect(declMap(readDecls(r.files[0].after, ':root'))['--primary']).toBe('red');
    // The dry-run must not touch disk — this is what the review modal previews.
    expect(sheetText()).toBe(SHADCN);
  });

  it('reports a locate failure with the adapter\'s reason', async () => {
    const r = await computeIntent(ctx, {
      kind: 'token-value',
      constName: 'light',
      path: ['ghost'],
      tokenValue: 'red',
    });
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.located).toBe(false);
    expect(r.reason).toContain('not declared');
  });

  it('404s a missing stylesheet', async () => {
    fs.rmSync(path.join(root, SHEET));
    const r = await computeIntent(ctx, setPrimary('red'));
    expect('error' in r && r.status).toBe(404);
  });
});

describe('composeIntents — batching', () => {
  it('stacks several edits to the SAME stylesheet', async () => {
    // The whole reason the cache is shared and applied sequentially. Two token edits to one
    // file must compose; otherwise the second silently discards the first.
    const composed = await composeIntents(ctx, [
      setPrimary('red'),
      setPrimary('blue', 'dark'),
      { kind: 'token-value', constName: 'light', path: ['radius'], tokenValue: '1rem' },
    ]);
    expect(composed.results.every((r) => r.located)).toBe(true);
    const [text] = [...composed.cache.values()];
    expect(declMap(readDecls(text, ':root'))).toEqual({ '--radius': '1rem', '--primary': 'red' });
    expect(declMap(readDecls(text, '.dark'))).toEqual({ '--primary': 'blue' });
  });

  it('composes an add-member on top of a value edit', async () => {
    const composed = await composeIntents(ctx, [
      setPrimary('red'),
      { kind: 'member-add', family: 'semantic', camelKey: 'brandAccent', tokenValue: '#123456' },
    ]);
    expect(composed.results.every((r) => r.located)).toBe(true);
    const [text] = [...composed.cache.values()];
    expect(declMap(readDecls(text, ':root'))).toEqual({
      '--radius': '0.625rem',
      '--primary': 'red',
      '--brand-accent': '#123456',
    });
    expect(text).toContain('--color-brand-accent: var(--brand-accent);');
  });

  it('records the pristine text once, however many intents touch the file', async () => {
    const composed = await composeIntents(ctx, [setPrimary('red'), setPrimary('blue')]);
    expect(composed.before.size).toBe(1);
    expect([...composed.before.values()][0]).toBe(SHADCN);
  });

  it('leaves the batch\'s earlier work intact when a later intent fails to locate', async () => {
    // A failed intent must not corrupt the composition. `/commit` refuses the whole batch on
    // any failure, but `/validate` reports per-intent results computed from this same cache,
    // so the two have to agree.
    const composed = await composeIntents(ctx, [
      setPrimary('red'),
      { kind: 'token-value', constName: 'light', path: ['ghost'], tokenValue: 'x' },
    ]);
    expect(composed.results.map((r) => r.located)).toEqual([true, false]);
    const [text] = [...composed.cache.values()];
    expect(declMap(readDecls(text, ':root'))['--primary']).toBe('red');
  });

  it('reports a refused edit with the file attached', async () => {
    const composed = await composeIntents(ctx, [
      { kind: 'token-rebind', constName: 'light', path: ['primary'], tokenValue: 'palette.syrup' },
    ]);
    expect(composed.results[0].located).toBe(false);
    expect(composed.results[0].reason).toContain('cannot');
  });

  it('mixes a token intent and a refusal without either affecting the other\'s file set', async () => {
    const composed = await composeIntents(ctx, [
      { kind: 'member-add', family: 'semantic', tokenValue: '#fff' },
      setPrimary('red'),
    ]);
    expect(composed.results[0]).toMatchObject({ located: false });
    expect(composed.results[1]).toMatchObject({ located: true, file: SHEET });
  });
});

describe('labelOf', () => {
  it('names the variable rather than the file', () => {
    // Every colour edit in wafflebase's pipeline writes `semantic.ts`, so a file-shaped
    // label is the same string for all of them — useless in a history list.
    expect(labelOf(setPrimary('red'))).toBe('token primary');
    expect(labelOf({ kind: 'palette-value', path: ['syrup'], tokenValue: '#fff' })).toBe('palette syrup');
    expect(
      labelOf({ kind: 'token-rebind', path: ['primary'], tokenValue: 'palette.syrup' }),
    ).toBe('rebind primary → palette.syrup');
    expect(labelOf({ kind: 'member-add', kebabKey: 'brand-accent' })).toBe('add token brand-accent');
    expect(labelOf({ kind: 'member-remove', kebabKey: 'brand-accent' })).toBe('drop token brand-accent');
  });

  it('falls back to camelKey when the client sent no kebab name', () => {
    expect(labelOf({ kind: 'member-add', camelKey: 'brandAccent' })).toBe('add token brandAccent');
  });
});
