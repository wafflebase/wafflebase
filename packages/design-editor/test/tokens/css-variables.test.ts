/**
 * Tests for the default `TokenAdapter`.
 *
 * `cssVariables` is the one implementation §4 flags as having no reference behaviour to
 * diff against, so these tests ARE its specification rather than a regression net over a
 * ported module. The fixture is shaped like shadcn CLI output, and the assertions check
 * the resulting stylesheet text — not just that a call reported success.
 */

import { describe, expect, it } from 'vitest';
import { cssVariables } from '../../src/tokens/css-variables.ts';
import { declMap, readDecls } from '../../src/tokens/css-decls.ts';
import type { TokenAdapter, TokenEdit, TokenWrite } from '../../src/tokens/adapter.ts';

const SHEET = 'src/index.css';

const SHADCN = `@import "tailwindcss";
@custom-variant dark (&:is(.dark *));

:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --primary: oklch(0.205 0 0);
}

.dark {
  --background: oklch(0.145 0 0);
  --primary: oklch(0.922 0 0);
}

@theme inline {
  --radius-sm: calc(var(--radius) - 4px);
  --color-background: var(--background);
  --color-primary: var(--primary);
}
`;

const adapter = cssVariables({ stylesheet: SHEET });

/** Reads `css` for any path, recording which paths were asked for. */
function reader(css: string) {
  const requested: string[] = [];
  return {
    requested,
    read: (a: TokenAdapter = adapter) =>
      a.read(async (rel) => {
        requested.push(rel);
        return css;
      }),
  };
}
const read = (css: string) => reader(css).read();

/** Apply a plan's writes in order, as the plugin does. */
async function applyAll(writes: TokenWrite[], text: string) {
  const notes: string[] = [];
  for (const w of writes) {
    const r = await w.apply(text);
    if (r.located) text = r.text;
    else notes.push(`${w.label}: ${r.reason ?? 'not located'}`);
  }
  return { text, notes };
}

/** Narrow a plan to its write list, failing the test if it was refused. */
function writesOf(plan: TokenWrite[] | { error: string }): TokenWrite[] {
  if ('error' in plan) throw new Error(`unexpected refusal: ${plan.error}`);
  return plan;
}

describe('cssVariables — shape', () => {
  it('declares exactly the one stylesheet as its source', () => {
    expect(adapter.sources()).toEqual([SHEET]);
  });

  it('has NO regenerate(), because the write is the emission', () => {
    // Absent rather than a no-op returning ok. The plugin tests for the method, so
    // omitting it means "this pipeline has no emitter to re-run" — a no-op would claim a
    // regeneration happened and make the client show a step that never ran.
    expect(adapter.regenerate).toBeUndefined();
  });
});

describe('cssVariables.read', () => {
  it('reads both theme blocks and the utility aliases', async () => {
    const tree = await read(SHADCN);
    expect(tree.vars.light).toEqual({
      '--radius': '0.625rem',
      '--background': 'oklch(1 0 0)',
      '--primary': 'oklch(0.205 0 0)',
    });
    expect(tree.vars.dark).toEqual({
      '--background': 'oklch(0.145 0 0)',
      '--primary': 'oklch(0.922 0 0)',
    });
    expect(tree.utilities).toEqual(['--radius-sm', '--color-background', '--color-primary']);
  });

  it('reports a dark-only property as absent from light, not as empty', async () => {
    // The client must render it as inheriting. A merged map would hide that `--radius` has
    // no dark override at all.
    const tree = await read(SHADCN);
    expect('--radius' in tree.vars.dark).toBe(false);
  });

  it('reports no utilities for a project with no @theme block', async () => {
    const tree = await read(':root {\n  --a: 1px;\n}\n');
    expect(tree.utilities).toEqual([]);
    // Still fully readable — the tokens exist, they are just not utility-backed.
    expect(tree.vars.light).toEqual({ '--a': '1px' });
  });

  it('omits `bindings` entirely rather than reporting an empty one', async () => {
    // `TokenTree.bindings` was added for the pipeline where a token's SOURCE form differs
    // from its emitted value — an expression, or a member the emitter never publishes.
    // A stylesheet has neither: the declaration IS the value, which is exactly why the
    // field is optional. ABSENT, not `{}`: an empty object would tell a client "this
    // pipeline has source forms and none of them are interesting", and the panel would
    // render a rebind affordance that can never work here.
    const tree = await read(SHADCN);
    expect('bindings' in tree).toBe(false);
  });

  it('requests exactly the configured stylesheet, and nothing else', async () => {
    // The adapter's only I/O is through the supplied reader, so this pins what a session
    // touches — and it is what would catch `read()` and `sources()` disagreeing about the
    // path, which is how the `./` mismatch went unnoticed.
    const r = reader(SHADCN);
    await r.read();
    expect(r.requested).toEqual([SHEET]);
  });

  it('requests the NORMALISED path even when configured with "./"', async () => {
    const r = reader(SHADCN);
    await r.read(cssVariables({ stylesheet: './src/index.css' }));
    expect(r.requested).toEqual([SHEET]);
  });

  it('serves every family from the one stylesheet', async () => {
    const tree = await read(SHADCN);
    expect(tree.families.map((f) => f.family)).toEqual(['semantic', 'palette', 'radius', 'typo']);
    expect(tree.families.every((f) => f.file === SHEET)).toBe(true);
  });

  it('serves the naming rules as PREFIXES, so they can cross the wire', async () => {
    // The prototype expressed these as functions and therefore had to duplicate them in
    // client code — the duplication §6's `edits.ts` row names. A prefix serialises.
    const tree = await read(SHADCN);
    const byFamily = Object.fromEntries(tree.families.map((f) => [f.family, f]));
    expect(byFamily.semantic.cssVarPrefix).toBe('--');
    expect(byFamily.semantic.themeVarPrefix).toBe('--color-');
    expect(byFamily.radius.cssVarPrefix).toBe('--radius-');
    expect(byFamily.typo.cssVarPrefix).toBe('--font-');
  });

  it('honours custom selectors', async () => {
    const custom = cssVariables({
      stylesheet: SHEET,
      rootSelector: '.theme-light',
      darkSelector: '.theme-dark',
    });
    const css = '.theme-light { --a: 1px; }\n.theme-dark { --a: 2px; }\n:root { --a: 9px; }\n';
    const tree = await custom.read(async () => css);
    expect(tree.vars.light).toEqual({ '--a': '1px' });
    expect(tree.vars.dark).toEqual({ '--a': '2px' });
  });
});

describe('cssVariables.emit', () => {
  it('renders the variable maps by parsing, with no build step', async () => {
    const r = await adapter.emit({ [SHEET]: SHADCN });
    expect(r.ok).toBe(true);
    expect(r.light?.['--primary']).toBe('oklch(0.205 0 0)');
    expect(r.dark?.['--primary']).toBe('oklch(0.922 0 0)');
  });

  it('reports a missing source rather than emitting an empty map', async () => {
    // An empty map would read to the client as "every token is now unset", which is a
    // preview that actively lies.
    const r = await adapter.emit({});
    expect(r.ok).toBe(false);
    expect(r.error).toContain(SHEET);
  });

  it('reflects a patched stylesheet — this is what a live preview reads', async () => {
    const patched = SHADCN.replace('--primary: oklch(0.205 0 0)', '--primary: red');
    const r = await adapter.emit({ [SHEET]: patched });
    expect(r.light?.['--primary']).toBe('red');
  });
});

describe('cssVariables.plan — set-value', () => {
  const edit = (over: Partial<Extract<TokenEdit, { kind: 'set-value' }>> = {}): TokenEdit => ({
    kind: 'set-value',
    family: 'semantic',
    theme: 'light',
    path: ['primary'],
    kebabKey: 'primary',
    value: 'red',
    valueKind: 'literal',
    ...over,
  });

  it('plans exactly one required write', () => {
    const writes = writesOf(adapter.plan(edit()));
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ file: SHEET, required: true });
  });

  it('writes the base block for the light theme', async () => {
    const { text } = await applyAll(writesOf(adapter.plan(edit())), SHADCN);
    expect(declMap(readDecls(text, ':root'))['--primary']).toBe('red');
    expect(declMap(readDecls(text, '.dark'))['--primary']).toBe('oklch(0.922 0 0)');
  });

  it('writes the dark block for the dark theme', async () => {
    const { text } = await applyAll(writesOf(adapter.plan(edit({ theme: 'dark' }))), SHADCN);
    expect(declMap(readDecls(text, '.dark'))['--primary']).toBe('red');
    expect(declMap(readDecls(text, ':root'))['--primary']).toBe('oklch(0.205 0 0)');
  });

  it('routes a single-theme family to the base block even when asked for dark', async () => {
    // Nobody ships a different border radius in dark mode, and both pipelines store one in
    // the base block only. A `.dark`-only override would resolve to nothing in light mode.
    const writes = writesOf(
      adapter.plan(edit({ family: 'radius', theme: 'dark', kebabKey: 'sm', value: '1rem' })),
    );
    expect(writes[0].label).toContain(':root');
  });

  it('prefixes the property by family', () => {
    expect(writesOf(adapter.plan(edit({ family: 'radius', kebabKey: 'lg' })))[0].label).toContain(
      '--radius-lg',
    );
    expect(writesOf(adapter.plan(edit({ family: 'typo', kebabKey: 'body' })))[0].label).toContain(
      '--font-body',
    );
  });

  it('refuses an expression value with a reason a user can act on', () => {
    // A palette rebind means "point this token at that swatch", which only exists where
    // tokens are code. Writing the expression text into CSS would produce an invalid value
    // that fails silently at paint time.
    const r = adapter.plan(edit({ valueKind: 'expression', value: 'palette.syrup' }));
    expect('error' in r && r.error).toContain('cannot');
  });

  it('refuses an undeclared property rather than creating it silently', async () => {
    const writes = writesOf(adapter.plan(edit({ kebabKey: 'ghost' })));
    const r = await writes[0].apply(SHADCN);
    expect(r.located).toBe(false);
    expect(r.reason).toContain('not declared');
  });
});

describe('cssVariables.plan — add-member', () => {
  const addEdit: TokenEdit = {
    kind: 'add-member',
    family: 'semantic',
    camelKey: 'brandAccent',
    kebabKey: 'brand-accent',
    value: '#123456',
  };

  it('plans three writes to ONE file: base, dark, alias', () => {
    const writes = writesOf(adapter.plan(addEdit));
    expect(writes.map((w) => w.file)).toEqual([SHEET, SHEET, SHEET]);
    expect(writes.map((w) => w.required)).toEqual([true, false, false]);
  });

  it('composes all three into the stylesheet', async () => {
    const { text, notes } = await applyAll(writesOf(adapter.plan(addEdit)), SHADCN);
    expect(notes).toEqual([]);
    expect(declMap(readDecls(text, ':root'))['--brand-accent']).toBe('#123456');
    expect(declMap(readDecls(text, '.dark'))['--brand-accent']).toBe('#123456');
    expect(text).toContain('  --color-brand-accent: var(--brand-accent);');
  });

  it('gives both themes the SAME starting value', async () => {
    // Matching `insertSemanticToken`'s own reasoning: "so the token is valid across themes
    // from the moment it exists". A token present only in light renders as unset in dark.
    const { text } = await applyAll(writesOf(adapter.plan(addEdit)), SHADCN);
    expect(declMap(readDecls(text, '.dark'))['--brand-accent']).toBe(
      declMap(readDecls(text, ':root'))['--brand-accent'],
    );
  });

  it('groups the alias with its own namespace', async () => {
    // `insertThemeMapping` sorts by namespace, so a `--color-*` alias lands with the other
    // colours rather than after the radius entries.
    const { text } = await applyAll(writesOf(adapter.plan(addEdit)), SHADCN);
    const theme = text.slice(text.indexOf('@theme'));
    expect(theme.indexOf('--color-brand-accent')).toBeGreaterThan(theme.indexOf('--color-primary'));
    expect(theme.indexOf('--color-brand-accent')).toBeGreaterThan(theme.indexOf('--radius-sm'));
  });

  it('still creates the token in a light-only project, reporting the skip', async () => {
    // The dark write is optional precisely for this: refusing would make the token
    // uncreatable in a perfectly valid stylesheet.
    const lightOnly = ':root {\n  --primary: red;\n}\n';
    const { text, notes } = await applyAll(writesOf(adapter.plan(addEdit)), lightOnly);
    expect(declMap(readDecls(text, ':root'))['--brand-accent']).toBe('#123456');
    expect(notes.join(' ')).toContain('.dark');
    expect(notes.join(' ')).toContain('--color-brand-accent');
  });

  it('adds only the base declaration for a single-theme family', () => {
    const writes = writesOf(
      adapter.plan({ ...addEdit, family: 'radius', camelKey: 'xxl', kebabKey: 'xxl' }),
    );
    expect(writes.map((w) => w.label)).toEqual(['--radius-xxl in :root', '--radius-xxl alias']);
  });

  it('refuses a duplicate through its required write', async () => {
    const dup = { ...addEdit, camelKey: 'primary', kebabKey: 'primary' };
    const writes = writesOf(adapter.plan(dup));
    const r = await writes[0].apply(SHADCN);
    expect(r.located).toBe(false);
    expect(r.reason).toContain('already declared');
  });
});

describe('cssVariables.plan — remove-member', () => {
  const addEdit: TokenEdit = {
    kind: 'add-member',
    family: 'semantic',
    camelKey: 'brandAccent',
    kebabKey: 'brand-accent',
    value: '#123456',
  };
  const removeEdit: TokenEdit = {
    kind: 'remove-member',
    family: 'semantic',
    camelKey: 'brandAccent',
    kebabKey: 'brand-accent',
  };

  it('round-trips add → remove back to the original bytes', async () => {
    // The strongest single assertion available for a text mutator: not "it reported
    // success" but "the file is byte-identical to where it started".
    const added = await applyAll(writesOf(adapter.plan(addEdit)), SHADCN);
    const removed = await applyAll(writesOf(adapter.plan(removeEdit)), added.text);
    expect(removed.notes).toEqual([]);
    expect(removed.text).toBe(SHADCN);
  });

  it('requires the base declaration, so removing a non-token is refused', async () => {
    // Treating it as a no-op would report a successful removal of something that was never
    // there — an empty plan reading as a successful edit.
    const writes = writesOf(adapter.plan(removeEdit));
    expect(writes[0].required).toBe(true);
    const r = await writes[0].apply(SHADCN);
    expect(r.located).toBe(false);
  });

  it('tolerates a partial presence — base only, no dark, no alias', async () => {
    // Mirrors `removeSemanticToken`, which tolerates partial presence "because refusing
    // would leave the half-created state permanently unfixable through this API".
    const partial = ':root {\n  --brand-accent: #123456;\n}\n';
    const { text, notes } = await applyAll(writesOf(adapter.plan(removeEdit)), partial);
    expect(text).toBe(':root {\n}\n');
    expect(notes).toHaveLength(2);
  });
});

describe('cssVariables.plan — refusals', () => {
  it('refuses an unknown family', () => {
    const r = adapter.plan({
      kind: 'set-value',
      family: 'nope' as never,
      theme: 'light',
      path: ['x'],
      kebabKey: 'x',
      value: 'red',
      valueKind: 'literal',
    });
    expect('error' in r && r.error).toContain('unknown token family');
  });
});

describe('cssVariables — path normalisation', () => {
  it('normalises a leading "./" so sources() matches root-relative paths', () => {
    // The form §5 and the README both document. `sources()` is compared by string against
    // the paths the plugin derives from what it wrote (`src/index.css`), so `./src/index.css`
    // matched nothing: the CSS-regen gate never fired and `/preview-tokens` never patched
    // the stylesheet it had just edited.
    expect(cssVariables({ stylesheet: './src/index.css' }).sources()).toEqual(['src/index.css']);
  });

  it('keys emit() and plan() by the normalised path too', async () => {
    const dotted = cssVariables({ stylesheet: './src/index.css' });
    expect(await dotted.emit({ 'src/index.css': SHADCN })).toMatchObject({ ok: true });
    const plan = dotted.plan({
      kind: 'set-value',
      family: 'semantic',
      theme: 'light',
      path: ['primary'],
      kebabKey: 'primary',
      value: 'red',
      valueKind: 'literal',
    });
    expect(writesOf(plan)[0].file).toBe('src/index.css');
  });
});

describe('cssVariables — value validation', () => {
  const setEdit = (value: string): TokenEdit => ({
    kind: 'set-value',
    family: 'semantic',
    theme: 'light',
    path: ['primary'],
    kebabKey: 'primary',
    value,
    valueKind: 'literal',
  });

  it('refuses a value that would end the declaration', () => {
    // Measured before the guard existed: this was written out intact, producing
    // `--primary: red; } body { display: none } :root { --x:;` — not a wrong colour but a
    // structurally different stylesheet.
    const r = adapter.plan(setEdit('red; } body { display: none } :root { --x:'));
    expect('error' in r && r.error).toContain('invalid CSS value');
  });

  it('refuses an unsafe value on add-member too, not only set-value', () => {
    const r = adapter.plan({
      kind: 'add-member',
      family: 'semantic',
      camelKey: 'evil',
      kebabKey: 'evil',
      value: 'red; }',
    });
    expect('error' in r && r.error).toContain('invalid CSS value');
  });

  it('still accepts a value whose semicolon is inside a url()', async () => {
    const dataUri = 'url("data:image/svg+xml;base64,AAAA")';
    const { text } = await applyAll(writesOf(adapter.plan(setEdit(dataUri))), SHADCN);
    expect(declMap(readDecls(text, ':root'))['--primary']).toBe(dataUri);
  });

  it('does not gate remove-member, which carries no value', () => {
    expect(
      writesOf(adapter.plan({ kind: 'remove-member', family: 'semantic', camelKey: 'primary', kebabKey: 'primary' })),
    ).not.toHaveLength(0);
  });
});
