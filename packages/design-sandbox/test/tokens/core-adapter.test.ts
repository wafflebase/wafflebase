/**
 * `wafflebaseCore()` — the first `TokenAdapter` implementation with a real pipeline behind
 * it, and therefore the first place two parts of the contract are exercised without a fake:
 * a `plan()` spanning several FILES, and `regenerate()` running an actual emitter.
 * `design-editor-local-plugin.md` §8 records both as gaps 8b could not close.
 *
 * THESE TESTS RUN AGAINST THE LIVE REPOSITORY, on purpose. `packages/design-sandbox` is
 * wafflebase's own instance of the editor; an adapter that no longer matches
 * `packages/core`'s actual layout is broken, and a test built on a synthetic fixture would
 * keep passing while it happened. So the token files, `build-css.ts` and the frontend's
 * `index.css` are read from disk, and a test failing because one of them MOVED is the test
 * doing its job — the same guard `scenes/manifest.test.ts` applies to scene paths.
 *
 * Nothing here writes to the repository. Plans are applied to in-memory text, and the one
 * test that runs the real generator writes only `packages/core/dist/tokens.css`, which is
 * gitignored, generated, and byte-identical to what `pnpm core build` produces anyway.
 *
 * WHAT IS NOT COVERED HERE: the plugin's own half — `planTokenIntent`'s normalisation,
 * `applyTokenPlan`'s staging, the path guard, the regen gate. Those are
 * `@wafflebase/design-editor`'s and are tested there against a fake adapter, which is the
 * right place: they are properties of the plugin, not of this pipeline. What joins the two
 * for real is `scripts/verify-tokens.mjs`, a smoke script against a live dev server, and it
 * is a manual gate rather than part of this suite.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TokenEdit, TokenFamily, TokenWrite } from '@wafflebase/design-editor';
import {
  wafflebaseCore,
  COREPATHS,
  type WafflebaseCoreAdapter,
} from '../../src/tokens/core-adapter';

const ROOT = path.resolve(import.meta.dirname, '../../../..');
const readFile = (rel: string) => fs.readFile(path.join(ROOT, rel), 'utf8');

/** Pure-plan adapter: never spawns anything, so the `plan()` suites cost nothing. */
const pure = () => wafflebaseCore({ root: ROOT });

/** A value plausible for the family, since the injector writes it verbatim. */
const valueFor = (family: TokenFamily) =>
  family === 'radius' ? '2rem' : family === 'typo' ? "'Probe', sans-serif" : '#123456';

const addMember = (family: TokenFamily): TokenEdit => ({
  kind: 'add-member',
  family,
  camelKey: 'probeTok',
  kebabKey: 'probe-tok',
  value: valueFor(family),
});
const removeMember = (family: TokenFamily): TokenEdit => ({
  kind: 'remove-member',
  family,
  camelKey: 'probeTok',
  kebabKey: 'probe-tok',
});

/** Unwrap a plan, failing the test with the adapter's own reason if it refused. */
function writes(plan: TokenWrite[] | { error: string }): TokenWrite[] {
  if ('error' in plan) throw new Error(`plan refused: ${plan.error}`);
  return plan;
}

/**
 * Apply a plan to in-memory text, sequentially, as the plugin does.
 *
 * Deliberately NOT a re-implementation of `applyTokenPlan` — it has no staging and no
 * required/optional handling, because those are the plugin's semantics and are tested in
 * `@wafflebase/design-editor`. All this does is thread the text through in order so the
 * ADAPTER's writes can be inspected, which is what these tests are about.
 */
async function applyPlan(plan: TokenWrite[], into = new Map<string, string>()) {
  const results: { file: string; located: boolean; reason?: string }[] = [];
  for (const w of plan) {
    const before = into.get(w.file) ?? (await readFile(w.file));
    const r = await w.apply(before);
    results.push({ file: w.file, located: r.located, reason: r.reason });
    if (r.located) into.set(w.file, r.text);
  }
  return { files: into, results };
}

const lineWith = (text: string, needle: string) =>
  text.split('\n').find((l) => l.includes(needle))?.trim();

/**
 * Every matching line, trimmed.
 *
 * `lineWith` is not enough for `semantic.ts`: its `SemanticColorMap` type declares
 * `background: string;` ABOVE both consts, so a first-match helper reports the type rather
 * than the value. Found by this suite failing on its own matcher, which is a useful
 * reminder that a looser assertion — `toContain('palette.butter')` — would have passed
 * while proving nothing.
 */
const linesWith = (text: string, needle: string) =>
  text
    .split('\n')
    .filter((l) => l.includes(needle))
    .map((l) => l.trim());

const FAMILIES: TokenFamily[] = ['semantic', 'palette', 'radius', 'typo'];

describe('sources()', () => {
  it('names all six files, not just the four the emitter reads', () => {
    // `sources()` is the external-change watch list AND the regen gate. A member edit
    // writes `build-css.ts` and `index.css` too, so omitting either would mean editing
    // one in your own editor goes unreported and the next add-member locates against
    // text the editor never saw.
    expect(pure().sources()).toEqual([
      'packages/core/src/tokens/semantic.ts',
      'packages/core/src/tokens/palette.ts',
      'packages/core/src/tokens/radius.ts',
      'packages/core/src/tokens/typography.ts',
      'packages/core/scripts/build-css.ts',
      'packages/frontend/src/index.css',
    ]);
  });

  it('emits normalised paths, which is what the regen gate compares against', () => {
    // The bug this pins was real and silent in `cssVariables`: a `./` prefix matched
    // nothing, so the regen never fired and the preview never patched the file it had
    // just edited.
    for (const s of pure().sources()) {
      expect(s.startsWith('./')).toBe(false);
      expect(s).not.toContain('\\');
    }
  });

  it('every source exists in this repository', async () => {
    // The dogfood assertion. An adapter whose paths have drifted from `packages/core` is
    // broken, and this is the cheapest place to find out.
    for (const s of pure().sources()) {
      await expect(fs.access(path.join(ROOT, s))).resolves.toBeUndefined();
    }
  });
});

describe('plan() — the three-point write', () => {
  it.each(FAMILIES)('spans three distinct files for %s', (family) => {
    const plan = writes(pure().plan(addMember(family)));
    expect(plan).toHaveLength(3);
    expect(new Set(plan.map((w) => w.file)).size).toBe(3);
  });

  it.each(FAMILIES)('makes the source and the emitter required, the alias optional for %s', (family) => {
    const plan = writes(pure().plan(addMember(family)));
    expect(plan.map((w) => w.required)).toEqual([true, true, false]);
    // Which is which, not just how many: the source const and the emitter entry are
    // load-bearing (without both a token either fails typecheck or never reaches the
    // CSS), while "already mapped" is a legitimate no-op for the alias.
    expect(plan[1].file).toBe(COREPATHS.buildCss);
    expect(plan[2].file).toBe(COREPATHS.themeCss);
  });

  it('routes each family at its own source file and emitter', () => {
    const a = pure();
    const targets = FAMILIES.map((f) => {
      const plan = writes(a.plan(addMember(f)));
      return [plan[0].file, plan[1].label];
    });
    expect(targets).toEqual([
      ['packages/core/src/tokens/semantic.ts', '--probe-tok in semanticBlock()'],
      ['packages/core/src/tokens/palette.ts', '--wb-probe-tok in paletteBlock()'],
      ['packages/core/src/tokens/radius.ts', '--radius-probe-tok in rootOnlyBlock()'],
      ['packages/core/src/tokens/typography.ts', '--font-probe-tok in rootOnlyBlock()'],
    ]);
  });

  it('is deterministic — the file set is identical across calls', () => {
    // A CONTRACT REQUIREMENT, not a nicety: `plan()` is called once to resolve the files a
    // request touches and again to apply, so an adapter that planned differently between
    // the two would have the plugin read one set of files and write another.
    const a = pure();
    for (const family of FAMILIES) {
      const one = writes(a.plan(addMember(family)));
      const two = writes(a.plan(addMember(family)));
      expect(two.map((w) => [w.file, w.required, w.label])).toEqual(
        one.map((w) => [w.file, w.required, w.label]),
      );
    }
  });

  it('refuses a family it does not carry', () => {
    const plan = pure().plan({ ...addMember('semantic'), family: 'nope' as TokenFamily });
    expect(plan).toEqual({ error: 'unknown token family: nope' });
  });
});

describe('plan() — set-value', () => {
  it('writes one file only, unlike a member edit', () => {
    const plan = writes(
      pure().plan({
        kind: 'set-value',
        family: 'semantic',
        theme: 'light',
        path: ['primary'],
        kebabKey: 'primary',
        value: '#fff',
        valueKind: 'literal',
      }),
    );
    expect(plan.map((w) => [w.file, w.required])).toEqual([[COREPATHS.semantic, true]]);
  });

  it('takes the semantic const from the THEME, ignoring what the client sent', () => {
    // `semantic.ts` is `export const semantic = { light, dark }` built from two separate
    // top-level consts, so a value edit targets `light` or `dark` by name. The prototype
    // took that name from the client; deriving it from `theme` removes the client's last
    // say over where a write lands, which is the rule 8b established for `file` and which
    // §6 records as the coupling its enumeration missed.
    const edit = {
      kind: 'set-value' as const,
      family: 'semantic' as const,
      path: ['primary'],
      kebabKey: 'primary',
      value: '#fff',
      valueKind: 'literal' as const,
      constName: 'attacker-chosen',
    };
    expect(writes(pure().plan({ ...edit, theme: 'dark' }))[0].label).toBe('dark.primary');
    expect(writes(pure().plan({ ...edit, theme: 'light' }))[0].label).toBe('light.primary');
  });

  it('ignores the theme for a family that has only one const', () => {
    // Nobody ships a different border radius in dark mode, and routing a radius edit at a
    // `dark` const that does not exist would refuse a perfectly valid edit.
    for (const theme of ['light', 'dark'] as const) {
      const plan = writes(
        pure().plan({
          kind: 'set-value',
          family: 'radius',
          theme,
          path: ['base'],
          kebabKey: 'base',
          value: '1rem',
          valueKind: 'literal',
        }),
      );
      expect(plan[0].label).toBe('radius.base');
    }
  });

  it('refuses an edit with no path', () => {
    const plan = pure().plan({
      kind: 'set-value',
      family: 'palette',
      theme: 'light',
      path: [],
      kebabKey: 'syrup',
      value: '#fff',
      valueKind: 'literal',
    });
    expect(plan).toEqual({ error: 'set-value needs a path' });
  });

  it('applies a real value edit to the real source', async () => {
    const plan = writes(
      pure().plan({
        kind: 'set-value',
        family: 'palette',
        theme: 'light',
        path: ['syrup'],
        kebabKey: 'syrup',
        value: '#00FF00',
        valueKind: 'literal',
      }),
    );
    const { files, results } = await applyPlan(plan);
    expect(results).toEqual([{ file: COREPATHS.palette, located: true, reason: undefined }]);
    expect(lineWith(files.get(COREPATHS.palette)!, 'syrup:')).toBe("syrup: '#00FF00',");
  });

  it('quotes a literal and writes an expression verbatim', async () => {
    // `valueKind` is the whole distinction: `expression` is what makes "point this token
    // at that swatch" possible, and it is the half `cssVariables` refuses outright — a
    // stylesheet has no way to reference another token by expression. This pipeline is the
    // reason the field exists, so both branches are asserted together rather than one in
    // isolation, where a quoting slip would look like success.
    const edit = {
      kind: 'set-value' as const,
      family: 'semantic' as const,
      theme: 'light' as const,
      path: ['background'],
      kebabKey: 'background',
    };

    const asExpr = await applyPlan(
      writes(pure().plan({ ...edit, value: 'palette.butter', valueKind: 'expression' })),
    );
    // The `light` const's line, not `SemanticColorMap`'s `background: string;` above it.
    expect(linesWith(asExpr.files.get(COREPATHS.semantic)!, 'background:')).toContain(
      'background: palette.butter,',
    );

    const asLiteral = await applyPlan(
      writes(pure().plan({ ...edit, value: 'palette.butter', valueKind: 'literal' })),
    );
    expect(linesWith(asLiteral.files.get(COREPATHS.semantic)!, 'background:')).toContain(
      "background: 'palette.butter',",
    );
  });
});

describe('the emitter expression', () => {
  /**
   * The bug this suite exists for, and the one thing in the port that was CHANGED rather
   * than moved.
   *
   * `build-css.ts` reaches each token object two ways — as the `src` parameter, which is
   * the text `preview-tokens.mts` was handed, and as a module-level import, which is the
   * file on disk. The prototype's table wrote `radius.${camel}` and `typography.${camel}`:
   * the module form. Both compile and both produce a correct `tokens.css` on a real build,
   * so nothing fails loudly — but `emit()` evaluates PATCHED text, so a token written that
   * way previews its on-disk value, which for a token that does not exist yet is
   * `undefined`. The preview stops agreeing with the save, silently.
   *
   * Each prefix below therefore comes from its emitter's own body, checked against
   * `build-css.ts` rather than derived from the token's name.
   */
  it.each([
    ['semantic', "['--probe-tok', m.probeTok],", 'const m = src.semantic[mode]'],
    ['palette', "['--wb-probe-tok', palette.probeTok],", 'const { palette } = src'],
    ['radius', "['--radius-probe-tok', src.radius.probeTok],", 'only src is in scope'],
    ['typo', "['--font-probe-tok', src.typography.probeTok],", 'only src is in scope'],
  ] as const)('resolves through `src` for %s — %s', async (family, expected, _scope) => {
    const plan = writes(pure().plan(addMember(family)));
    const { files } = await applyPlan(plan);
    expect(lineWith(files.get(COREPATHS.buildCss)!, 'probe-tok')).toBe(expected);
  });

  it('never writes a bare token identifier, for any family', async () => {
    // The general form of the above, so a family added later cannot reintroduce it.
    for (const family of FAMILIES) {
      const { files } = await applyPlan(writes(pure().plan(addMember(family))));
      const line = lineWith(files.get(COREPATHS.buildCss)!, 'probe-tok')!;
      expect(line).not.toMatch(/,\s*(radius|typography|semantic)\./);
    }
  });
});

describe('applying a full member plan', () => {
  it.each(FAMILIES)('lands all three writes for %s', async (family) => {
    const { files, results } = await applyPlan(writes(pure().plan(addMember(family))));
    expect(results.map((r) => r.located)).toEqual([true, true, true]);
    expect([...files.keys()]).toEqual([
      writes(pure().plan(addMember(family)))[0].file,
      COREPATHS.buildCss,
      COREPATHS.themeCss,
    ]);
  });

  it('writes the source member, the emitter entry and the theme alias', async () => {
    const { files } = await applyPlan(writes(pure().plan(addMember('palette'))));
    expect(lineWith(files.get(COREPATHS.palette)!, 'probeTok')).toBe("probeTok: '#123456',");
    expect(lineWith(files.get(COREPATHS.buildCss)!, 'probe-tok')).toBe(
      "['--wb-probe-tok', palette.probeTok],",
    );
    expect(lineWith(files.get(COREPATHS.themeCss)!, 'probe-tok')).toBe(
      '--color-wb-probe-tok: var(--wb-probe-tok);',
    );
  });

  it('adds a semantic token to BOTH themes, which no generic const insert would', async () => {
    // `semantic` routes through the bespoke `insertSemanticToken` rather than
    // `insertConstMember`, because its token has to reach the `light` const, the `dark`
    // const and the `SemanticColorMap` type. One flat const-member insert expresses none
    // of that.
    const { files } = await applyPlan(writes(pure().plan(addMember('semantic'))));
    const text = files.get(COREPATHS.semantic)!;
    expect(text.match(/probeTok/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it.each(FAMILIES)('add then remove restores every file byte-identically for %s', async (family) => {
    // The property 8b established for `cssVariables` and the strongest statement available
    // about a write path: not "the removal located" but "the file is exactly where it
    // started", across all THREE files this time.
    const a = pure();
    const { files } = await applyPlan(writes(a.plan(addMember(family))));
    const { files: after, results } = await applyPlan(writes(a.plan(removeMember(family))), files);
    expect(results.map((r) => r.located)).toEqual([true, true, true]);
    for (const [file, text] of after) {
      expect(text, `${family}: ${file} should be byte-identical`).toBe(await readFile(file));
    }
  });
});

describe('read()', () => {
  let adapter: WafflebaseCoreAdapter;
  beforeAll(() => {
    adapter = wafflebaseCore({ root: ROOT });
  });
  afterAll(() => adapter.dispose());

  it('reports values from the EMITTER, not from the source text', async () => {
    const tree = await adapter.read(readFile);
    // `--primary`'s source is the expression `palette.syrup`; what the panel needs is the
    // colour. Reading text would report the expression, which is why `read()` runs the
    // real emitter over the current sources — the same operation `emit()` performs on
    // patched ones, so "current" and "preview" stay comparable.
    expect(tree.vars.light['--primary']).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(Object.keys(tree.vars.light).length).toBeGreaterThan(40);
    expect(Object.keys(tree.vars.dark).length).toBeGreaterThan(30);
  }, 60_000);

  it('reports the @theme aliases as the utilities', async () => {
    const tree = await adapter.read(readFile);
    expect(tree.utilities).toContain('--color-primary');
    expect(tree.utilities).toContain('--radius-md');
  }, 60_000);

  it('names each family its own file', async () => {
    const tree = await adapter.read(readFile);
    expect(tree.families.map((f) => [f.family, f.file])).toEqual([
      ['semantic', COREPATHS.semantic],
      ['palette', COREPATHS.palette],
      ['radius', COREPATHS.radius],
      ['typo', COREPATHS.typography],
    ]);
  }, 60_000);

  it('distinguishes a literal, a rebindable ref and a locked expression', async () => {
    // The three-kind contract, against the three cases that actually exist in
    // `semantic.ts`. `--primary` is `palette.syrup` — a whole-value reference, so
    // rebindable. `sidebarAccent` is `` `rgba(${palette.butterRgb}, 0.30)` `` — the swatch
    // is an INGREDIENT, so offering a rebind would drop the alpha. `background` is a plain
    // literal. A two-kind union collapsed the middle two and would have mis-offered the
    // two `sidebarAccent` tokens.
    const tree = await adapter.read(readFile);
    const light = tree.bindings!.themed.light;
    expect(light.background).toEqual({ kind: 'literal', value: expect.stringContaining('oklch') });
    expect(light.primary).toEqual({ kind: 'ref', value: 'palette.syrup' });
    expect(light.sidebarAccent.kind).toBe('expression');
    expect(light.sidebarAccent.value).toContain('rgba(');
  }, 60_000);

  it('offers only colour leaves as rebind targets', async () => {
    const tree = await adapter.read(readFile);
    expect(tree.bindings!.refs.length).toBeGreaterThan(5);
    expect(tree.bindings!.refs.every((r) => r.isColor)).toBe(true);
    expect(tree.bindings!.refs.map((r) => r.ref)).toContain('palette.syrup');
  }, 60_000);

  it('carries source values for members the emitter does not publish', async () => {
    // `radius` has five members and only `base` becomes `--radius`; the rest are derived
    // in the app's `@theme` block. So four of five have no entry in `vars` at all, and a
    // panel with only `vars` to read would show them blank.
    const tree = await adapter.read(readFile);
    expect(tree.vars.light['--radius-md']).toBeUndefined();
    expect(tree.bindings!.leaves!.radius).toMatchObject({ base: expect.any(String), md: expect.any(String) });
    expect(Object.keys(tree.bindings!.leaves!.typo!)).toEqual(['display', 'body', 'code']);
  }, 60_000);

  it('throws rather than reporting an empty tree when the emitter cannot run', async () => {
    // `read()` has no error channel, and the bridge's `GET /tokens` wraps it — so a throw
    // is reported to the client. Returning empty maps instead would render as "this
    // project has no tokens", which is a lie about a fixable problem.
    const broken = wafflebaseCore({ root: ROOT, packageManager: 'wafflebase-no-such-command' });
    try {
      await expect(broken.read(readFile)).rejects.toThrow(/preview worker/);
    } finally {
      broken.dispose();
    }
  }, 60_000);
});

describe('emit()', () => {
  let adapter: WafflebaseCoreAdapter;
  let base: Record<string, string>;
  beforeAll(async () => {
    adapter = wafflebaseCore({ root: ROOT });
    base = Object.fromEntries(
      await Promise.all(adapter.sources().map(async (s) => [s, await readFile(s)] as const)),
    );
  });
  afterAll(() => adapter.dispose());

  it('renders the variable map without writing anything', async () => {
    const r = await adapter.emit(base);
    expect(r.ok).toBe(true);
    expect(r.light!['--wb-syrup']).toBe('#B8651A');
  }, 60_000);

  it('reflects a PATCHED source, which is the whole point', async () => {
    // The property `preview-tokens.mts` exists to provide: the preview evaluates the text
    // the editor is holding, not the file on disk. Both the swatch and every semantic
    // token bound to it move together — which no text-level analysis could produce, since
    // `--primary`'s source says `palette.syrup` and nothing else.
    const patched = {
      ...base,
      [COREPATHS.palette]: base[COREPATHS.palette].replace('#B8651A', '#00FF00'),
    };
    const r = await adapter.emit(patched);
    expect(r.ok).toBe(true);
    expect(r.light!['--wb-syrup']).toBe('#00FF00');
    expect(r.light!['--primary']).toBe('#00FF00');
  }, 60_000);

  it('cannot preview a token whose emitter entry is new — a real limit, stated', async () => {
    // `emit()` forwards only the four source texts, because the worker imports
    // `tokenBlocks` from the real module on disk: a patched `build-css.ts` is not
    // evaluated. So a freshly CREATED token has no preview until the commit regenerates.
    // Pinned rather than left to be rediscovered, because the symptom ("my new token
    // shows nothing") looks like a bug and is not one.
    const { files } = await applyPlan(writes(adapter.plan(addMember('palette'))));
    const r = await adapter.emit({ ...base, ...Object.fromEntries(files) });
    expect(r.ok).toBe(true);
    expect(r.light).not.toHaveProperty('--wb-probe-tok');
  }, 60_000);

  it('names the file it is missing rather than rendering a partial map', async () => {
    expect(await adapter.emit({})).toEqual({
      ok: false,
      error: `no text supplied for ${COREPATHS.palette}`,
    });
    const { [COREPATHS.radius]: _dropped, ...missingRadius } = base;
    expect((await adapter.emit(missingRadius)).error).toBe(
      `no text supplied for ${COREPATHS.radius}`,
    );
  });
});

describe('regenerate()', () => {
  it('runs the real generator and names the artefact to push', async () => {
    // The method §4 says `emit()` cannot stand in for, and the half 8b could only fake.
    // Writes `packages/core/dist/tokens.css` — generated, gitignored, and byte-identical
    // to what `pnpm core build` produces.
    const adapter = wafflebaseCore({ root: ROOT });
    try {
      const r = await adapter.regenerate();
      expect(r.ok).toBe(true);
      expect(r.error).toBeUndefined();
      // ABSOLUTE, per the contract: the artefact sits in a `dist/` folder outside the Vite
      // root, which is exactly why the adapter has to name it rather than let the plugin
      // guess.
      expect(r.artifacts).toEqual([path.join(ROOT, COREPATHS.tokensCss)]);
      const css = await readFile(COREPATHS.tokensCss);
      expect(css).toContain(':root {');
      expect(css).toContain('--wb-syrup');
    } finally {
      adapter.dispose();
    }
  }, 120_000);

  it('returns the failure instead of swallowing it', async () => {
    // The prototype collapsed every failure into a bare `false`, which is precisely how
    // "I saved and nothing changed on the page" becomes silent.
    const adapter = wafflebaseCore({ root: ROOT, packageManager: 'wafflebase-no-such-command' });
    try {
      const r = await adapter.regenerate();
      expect(r.ok).toBe(false);
      expect(r.error).toContain('tokens.css regeneration failed');
      expect(r.artifacts).toBeUndefined();
    } finally {
      adapter.dispose();
    }
  }, 60_000);

  it('reports only the first line, because the client shows it in a toast', async () => {
    // `node` rather than a nonexistent command, and that distinction is the test.
    // An unfindable command fails with the single line `spawn ... ENOENT`, so it satisfies
    // this assertion whether or not the code trims anything — the first version of this
    // test used it and passed with the trim reverted, proving nothing. A command that EXISTS
    // and then fails carries the child's whole output: measured at 20 lines here.
    const adapter = wafflebaseCore({ root: ROOT, packageManager: 'node' });
    try {
      const r = await adapter.regenerate();
      expect(r.ok).toBe(false);
      expect(r.error).toContain('tokens.css regeneration failed');
      expect(r.error).not.toContain('\n');
    } finally {
      adapter.dispose();
    }
  }, 60_000);
});
