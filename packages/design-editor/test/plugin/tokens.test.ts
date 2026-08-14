/**
 * Tests for the wire ⇄ adapter translation and the regen gate.
 *
 * Two things are checked here that no adapter test can reach:
 *
 *   1. **Validation.** Every field arrives from a web page, so `tokenEditOf` is the
 *      boundary that turns the protocol's flat optionals into something an adapter may
 *      trust. The prototype defaulted `?? ''` per branch, which let a request with no
 *      `camelKey` create a token named the empty string.
 *   2. **The contract, not just its one implementation.** `applyTokenPlan`'s staging
 *      behaviour and `required`/optional handling are exercised through a FAKE adapter, so
 *      the assertions are about the seam. `cssVariables` happens to plan its required write
 *      first, which would leave the interesting case untested.
 */

import { describe, expect, it } from 'vitest';
import {
  applyTokenPlan,
  isTokenSource,
  maybeRegenerate,
  planTokenIntent,
  tokenEditOf,
  TOKEN_KINDS,
} from '../../src/plugin/tokens.ts';
import { createPathGuard } from '../../src/plugin/paths.ts';
import { cssVariables } from '../../src/tokens/css-variables.ts';
import type { MutateRequest } from '../../src/plugin/protocol.ts';
import type { TokenAdapter, TokenWrite } from '../../src/tokens/adapter.ts';
import { camelToKebab } from '../../src/tokens/adapter.ts';

const ROOT = '/project';
const guard = createPathGuard(ROOT);
const SHEET = 'src/index.css';
const adapter = cssVariables({ stylesheet: SHEET });

/** An adapter that plans exactly the writes a test hands it. */
const fakeAdapter = (writes: TokenWrite[] | { error: string }, over: Partial<TokenAdapter> = {}) =>
  ({
    sources: () => [SHEET],
    read: async () => ({ vars: { light: {}, dark: {} }, utilities: [], families: [] }),
    plan: () => writes,
    emit: async () => ({ ok: true }),
    ...over,
  }) as TokenAdapter;

const write = (over: Partial<TokenWrite> = {}): TokenWrite => ({
  file: SHEET,
  required: true,
  label: 'w',
  apply: (text) => ({ located: true, text: `${text}!` }),
  ...over,
});

const addIntent: MutateRequest = {
  kind: 'member-add',
  family: 'semantic',
  camelKey: 'brand',
  tokenValue: '#fff',
};

describe('TOKEN_KINDS', () => {
  it('covers every token kind the protocol declares', () => {
    expect([...TOKEN_KINDS].sort()).toEqual([
      'member-add',
      'member-remove',
      'palette-value',
      'token-add',
      'token-rebind',
      'token-value',
    ]);
  });

  it('does not claim a layout kind', () => {
    for (const k of ['layout-props', 'layout-insert', 'layout-remove', 'class-rewrite']) {
      expect(TOKEN_KINDS.has(k)).toBe(false);
    }
  });
});

describe('tokenEditOf — normalisation', () => {
  it('normalises a value edit and derives the kebab key from the LAST path segment', () => {
    // Joining the whole path would name `light-primary` for a token whose property is
    // `--primary`: earlier segments are containers, not part of the name.
    expect(
      tokenEditOf({ kind: 'token-value', constName: 'light', path: ['primaryForeground'], tokenValue: 'x' }),
    ).toEqual({
      kind: 'set-value',
      family: 'semantic',
      theme: 'light',
      path: ['primaryForeground'],
      kebabKey: 'primary-foreground',
      value: 'x',
      valueKind: 'literal',
      constName: 'light',
    });
  });

  it('reads the theme off constName', () => {
    const e = tokenEditOf({ kind: 'token-value', constName: 'dark', path: ['a'], tokenValue: 'x' });
    expect(e).toMatchObject({ theme: 'dark' });
  });

  it('treats any other const as the base theme', () => {
    const e = tokenEditOf({ kind: 'token-value', constName: 'radius', path: ['sm'], tokenValue: 'x' });
    expect(e).toMatchObject({ theme: 'light' });
  });

  it('makes token-rebind an expression through its KIND, not its valueKind', () => {
    const e = tokenEditOf({ kind: 'token-rebind', constName: 'light', path: ['a'], tokenValue: 'palette.x' });
    expect(e).toMatchObject({ valueKind: 'expression' });
  });

  it('maps palette-value onto the palette family', () => {
    expect(tokenEditOf({ kind: 'palette-value', path: ['syrup'], tokenValue: '#fff' })).toMatchObject({
      family: 'palette',
    });
  });

  it('treats token-add as member-add on the semantic family', () => {
    // The legacy alias. Dropping it would turn a request the prototype's client still emits
    // into "unknown intent kind" for no gain.
    expect(tokenEditOf({ kind: 'token-add', camelKey: 'brand', tokenValue: '#fff' })).toEqual({
      kind: 'add-member',
      family: 'semantic',
      camelKey: 'brand',
      kebabKey: 'brand',
      value: '#fff',
    });
  });

  it('derives kebabKey from camelKey when the client omits it', () => {
    expect(
      tokenEditOf({ kind: 'member-add', family: 'semantic', camelKey: 'brandAccent', tokenValue: '#fff' }),
    ).toMatchObject({ kebabKey: 'brand-accent' });
  });

  it('accepts a client-supplied kebabKey', () => {
    expect(
      tokenEditOf({
        kind: 'member-add',
        family: 'semantic',
        camelKey: 'brandAccent',
        kebabKey: 'accent-brand',
        tokenValue: '#fff',
      }),
    ).toMatchObject({ kebabKey: 'accent-brand' });
  });

  it('falls back to the semantic family for an unrecognised one', () => {
    expect(
      tokenEditOf({ kind: 'token-value', family: 'bogus' as never, path: ['a'], tokenValue: 'x' }),
    ).toMatchObject({ family: 'semantic' });
  });
});

describe('tokenEditOf — refusals', () => {
  const refuses = (intent: MutateRequest, contains: string) => {
    const r = tokenEditOf(intent);
    expect('error' in r, `expected a refusal, got ${JSON.stringify(r)}`).toBe(true);
    expect('error' in r && r.error).toContain(contains);
  };

  it('refuses a member edit with no key', () => {
    refuses({ kind: 'member-add', family: 'semantic', tokenValue: 'x' }, 'camelKey');
  });

  it('refuses a key that is not a plain identifier', () => {
    // It could not be a TypeScript property, and interpolated into CSS it would let a
    // request write arbitrary declaration text.
    refuses({ kind: 'member-add', family: 'semantic', camelKey: 'a-b', tokenValue: 'x' }, 'invalid token key');
    refuses({ kind: 'member-add', family: 'semantic', camelKey: '1x', tokenValue: 'x' }, 'invalid token key');
    refuses(
      { kind: 'member-add', family: 'semantic', camelKey: 'a: red; --evil', tokenValue: 'x' },
      'invalid token key',
    );
  });

  it('refuses a kebab name that is not a bare custom-property tail', () => {
    refuses(
      { kind: 'member-add', family: 'semantic', camelKey: 'ok', kebabKey: 'BAD', tokenValue: 'x' },
      'invalid token name',
    );
    refuses(
      { kind: 'member-add', family: 'semantic', camelKey: 'ok', kebabKey: 'a: red', tokenValue: 'x' },
      'invalid token name',
    );
  });

  it('refuses an add with no value', () => {
    refuses({ kind: 'member-add', family: 'semantic', camelKey: 'ok' }, 'tokenValue');
    refuses({ kind: 'member-add', family: 'semantic', camelKey: 'ok', tokenValue: '   ' }, 'tokenValue');
  });

  it('does NOT require a value to remove a member', () => {
    expect(tokenEditOf({ kind: 'member-remove', family: 'semantic', camelKey: 'ok' })).toMatchObject({
      kind: 'remove-member',
    });
  });

  it('refuses a value edit with no path or no value', () => {
    refuses({ kind: 'token-value', constName: 'light', tokenValue: 'x' }, 'path');
    refuses({ kind: 'token-value', constName: 'light', path: [] as string[], tokenValue: 'x' }, 'path');
    refuses({ kind: 'token-value', constName: 'light', path: ['a'] }, 'tokenValue');
  });

  it('refuses a blank path segment', () => {
    refuses({ kind: 'token-value', constName: 'light', path: [''], tokenValue: 'x' }, 'non-empty');
  });

  it('allows an EMPTY value on a value edit, which is a legitimate reset', () => {
    // Distinct from `add-member`: clearing a declared token's value is meaningful, whereas
    // creating one with no value is not.
    expect(tokenEditOf({ kind: 'token-value', constName: 'light', path: ['a'], tokenValue: '' })).toMatchObject(
      { value: '' },
    );
  });
});

describe('planTokenIntent', () => {
  it('resolves the plan\'s files, de-duplicated', () => {
    // `cssVariables` plans three writes to one stylesheet, so the file set must collapse to
    // one entry — otherwise the same file is read and checkpointed three times.
    const r = planTokenIntent(adapter, guard, addIntent);
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.writes).toHaveLength(3);
    expect(r.files).toEqual([{ rel: SHEET, abs: `${ROOT}/${SHEET}` }]);
  });

  it('refuses a path that escapes the root — even from the ADAPTER', () => {
    // An adapter is consumer code. Trusting it because it is "ours" is how the write
    // boundary stops being one.
    const evil = cssVariables({ stylesheet: '../../../etc/passwd' });
    const r = planTokenIntent(evil, guard, addIntent);
    expect('error' in r && r.error).toContain('escapes the project root');
  });

  it('refuses an adapter file with a disallowed extension', () => {
    const r = planTokenIntent(cssVariables({ stylesheet: 'tokens.yaml' }), guard, addIntent);
    expect('error' in r && r.error).toContain('may be written');
  });

  it('propagates the adapter\'s own refusal', () => {
    const r = planTokenIntent(fakeAdapter({ error: 'nope' }), guard, addIntent);
    expect('error' in r && r.error).toBe('nope');
  });

  it('propagates a validation refusal before consulting the adapter', () => {
    const r = planTokenIntent(
      fakeAdapter([write()]),
      guard,
      { kind: 'member-add', family: 'semantic', tokenValue: 'x' },
    );
    expect('error' in r && r.error).toContain('camelKey');
  });

  it('refuses an EMPTY plan rather than reporting a successful no-op', () => {
    const r = planTokenIntent(fakeAdapter([]), guard, addIntent);
    expect('error' in r && r.error).toContain('planned no writes');
  });
});

describe('applyTokenPlan', () => {
  const abs = `${ROOT}/${SHEET}`;
  const planOf = (writes: TokenWrite[]) => {
    const r = planTokenIntent(fakeAdapter(writes), guard, addIntent);
    if ('error' in r) throw new Error(r.error);
    return r;
  };

  it('applies writes in order, each seeing the previous one\'s output', async () => {
    const cache = new Map([[abs, 'a']]);
    const out = await applyTokenPlan(
      planOf([
        write({ apply: (t) => ({ located: true, text: `${t}1` }) }),
        write({ apply: (t) => ({ located: true, text: `${t}2` }) }),
      ]),
      guard,
      cache,
    );
    expect(out.located).toBe(true);
    // `a12`, not `a2`: applying against the pristine text would have the last write
    // silently discard the first.
    expect(cache.get(abs)).toBe('a12');
  });

  it('awaits an async apply', async () => {
    const cache = new Map([[abs, 'a']]);
    await applyTokenPlan(
      planOf([write({ apply: async (t) => ({ located: true, text: `${t}!` }) })]),
      guard,
      cache,
    );
    expect(cache.get(abs)).toBe('a!');
  });

  it('reports a skipped OPTIONAL write as a note and still succeeds', async () => {
    const cache = new Map([[abs, 'a']]);
    const out = await applyTokenPlan(
      planOf([
        write(),
        write({ required: false, label: 'alias', apply: (t) => ({ located: false, text: t, reason: 'no block' }) }),
      ]),
      guard,
      cache,
    );
    expect(out.located).toBe(true);
    expect(out.reason).toBe('alias skipped: no block');
    expect(cache.get(abs)).toBe('a!');
  });

  it('refuses the whole edit when a REQUIRED write fails', async () => {
    const cache = new Map([[abs, 'a']]);
    const out = await applyTokenPlan(
      planOf([write({ label: 'src', apply: (t) => ({ located: false, text: t, reason: 'not found' }) })]),
      guard,
      cache,
    );
    expect(out).toEqual({ located: false, reason: 'not found' });
  });

  it('leaves the cache UNTOUCHED when a later required write fails', async () => {
    // `applyIntentToCache` promises exactly this, and it is what lets a partially-failing
    // batch stay all-or-nothing. Writing straight into the shared cache would break that
    // promise from the inside: the next intent in the batch would compose on top of a
    // half-created token.
    const cache = new Map([[abs, 'pristine']]);
    const out = await applyTokenPlan(
      planOf([
        write({ apply: (t) => ({ located: true, text: `${t}-first` }) }),
        write({ label: 'second', apply: (t) => ({ located: false, text: t, reason: 'boom' }) }),
      ]),
      guard,
      cache,
    );
    expect(out.located).toBe(false);
    expect(cache.get(abs)).toBe('pristine');
  });

  it('names the write when the adapter gives no reason', async () => {
    const cache = new Map([[abs, 'a']]);
    const out = await applyTokenPlan(
      planOf([write({ label: 'the source const', apply: (t) => ({ located: false, text: t }) })]),
      guard,
      cache,
    );
    expect(out.reason).toBe('could not apply the source const');
  });
});

describe('isTokenSource', () => {
  it('asks the adapter instead of matching a path pattern', () => {
    expect(isTokenSource(adapter, SHEET)).toBe(true);
    expect(isTokenSource(adapter, 'src/other.css')).toBe(false);
  });

  it('is false with no adapter', () => {
    expect(isTokenSource(null, SHEET)).toBe(false);
  });
});

describe('maybeRegenerate', () => {
  it('does not run for an adapter with no emitter', async () => {
    // `ran: false` is the honest answer for `cssVariables`: the write reached the
    // stylesheet the host already serves. Reporting `ok: false` would read as a failure.
    expect(await maybeRegenerate(adapter, [SHEET])).toEqual({ ran: false });
  });

  it('does not run with no adapter at all', async () => {
    expect(await maybeRegenerate(null, [SHEET])).toEqual({ ran: false });
  });

  it('does not run when the write touched no token source', async () => {
    const withRegen = fakeAdapter([write()], { regenerate: async () => ({ ok: true }) });
    expect(await maybeRegenerate(withRegen, ['src/Button.tsx'])).toEqual({ ran: false });
  });

  it('runs when a token source was written, and passes the artefacts through', async () => {
    const withRegen = fakeAdapter([write()], {
      regenerate: async () => ({ ok: true, artifacts: ['/abs/tokens.css'] }),
    });
    expect(await maybeRegenerate(withRegen, ['src/Button.tsx', SHEET])).toEqual({
      ran: true,
      ok: true,
      error: undefined,
      artifacts: ['/abs/tokens.css'],
    });
  });

  it('surfaces an emitter failure rather than swallowing it', async () => {
    // Folding every failure into a bare `false` is exactly how "I saved but nothing changed
    // on the page" happens silently.
    const failing = fakeAdapter([write()], {
      regenerate: async () => ({ ok: false, error: 'tsx exited 1' }),
    });
    expect(await maybeRegenerate(failing, [SHEET])).toMatchObject({ ran: true, ok: false, error: 'tsx exited 1' });
  });
});

describe('camelToKebab', () => {
  it('treats a run of digits as one group', () => {
    // The prototype's `/[A-Z0-9]/` broke on every character, so `gray100` became
    // `gray-1-0-0` — and a numeric scale is the most ordinary thing a shadcn project has.
    expect(camelToKebab('gray100')).toBe('gray-100');
    expect(camelToKebab('spacing2xl')).toBe('spacing-2xl');
  });

  it('is unchanged for single digits and plain camelCase', () => {
    // Why wafflebase's own `--chart-1…5` never exposed the bug.
    expect(camelToKebab('chart1')).toBe('chart-1');
    expect(camelToKebab('primaryForeground')).toBe('primary-foreground');
  });

  it('feeds the derived kebabKey, so a numeric key survives the wire', () => {
    expect(
      tokenEditOf({ kind: 'member-add', family: 'semantic', camelKey: 'gray100', tokenValue: '#eee' }),
    ).toMatchObject({ kebabKey: 'gray-100' });
  });
});

describe('isTokenSource — path normalisation', () => {
  it('matches regardless of a leading "./" on either side', () => {
    // `sources()` is contractually normalised, but it is consumer code and a mismatch here
    // is silent: the regen gate simply never fires.
    const dotted = cssVariables({ stylesheet: './src/index.css' });
    expect(isTokenSource(dotted, 'src/index.css')).toBe(true);
    expect(isTokenSource(adapter, './src/index.css')).toBe(true);
  });

  it('still distinguishes a different file', () => {
    expect(isTokenSource(adapter, './src/other.css')).toBe(false);
  });
});

describe('maybeRegenerate — a throwing emitter', () => {
  it('reports a rejection as a failed regeneration, not as a broken bridge', async () => {
    // It runs AFTER the write has landed, so letting the rejection escape would answer a
    // successful save with a 500 and lose both the txn id and the file list.
    const throwing = fakeAdapter([write()], {
      regenerate: async () => {
        throw new Error('tsx not found');
      },
    });
    expect(await maybeRegenerate(throwing, [SHEET])).toMatchObject({ ran: true, ok: false });
    const r = await maybeRegenerate(throwing, [SHEET]);
    expect(r.error).toContain('tsx not found');
  });

  it('does not swallow a synchronous throw either', async () => {
    const throwing = fakeAdapter([write()], {
      regenerate: (() => {
        throw new Error('boom');
      }) as unknown as TokenAdapter['regenerate'],
    });
    expect(await maybeRegenerate(throwing, [SHEET])).toMatchObject({ ran: true, ok: false });
  });
});
