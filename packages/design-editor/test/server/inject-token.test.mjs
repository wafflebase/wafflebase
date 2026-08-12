import { describe, expect, it } from 'vitest';
import {
  applyClassRewrite,
  applyTokenValue,
  insertBlockEmit,
  insertConstMember,
  insertSemanticToken,
  insertThemeMapping,
  readConstLeaves,
  readPaletteColors,
  readSemanticBindings,
  readThemeMappings,
  removeBlockEmit,
  removeConstMember,
  removeSemanticToken,
  removeThemeMapping,
} from '../../src/server/inject.mjs';
import { parse } from '../../src/server/jsx-nodes.mjs';

/**
 * The TOKEN half of `inject.mjs`. Addressed by names that exist in the source
 * (`cvaName`, `constName`, a CSS custom property), so unlike the layout half it
 * never touches the child-numbering model.
 *
 * The property that matters here is the ROUND TRIP. The token pipeline is
 * closed — source const → emitter array → `@theme inline` alias — so every
 * create has an inverse, and an undo that rolls back past a save replays it.
 * Each `insert*`/`remove*` pair is asserted to restore the file exactly.
 */

const SEMANTIC = `import { palette } from './palette';

type SemanticColorMap = {
  background: string;
  primary: string;
};

export const light: SemanticColorMap = {
  background: '#fff',
  primary: palette.syrup,
};

export const dark: SemanticColorMap = {
  background: '#000',
  primary: palette.butter,
};
`;

const CSS = `@theme inline {
  --color-background: var(--background);
  --color-primary: var(--primary);
  --radius-md: var(--radius);
}
`;

const BUILD = `function semanticBlock(m) {
  return [
    ['--background', m.background],
    ['--primary', m.primary],
  ];
}
`;

const PALETTE = `export const palette = {
  syrup: '#B865aa',
  neutrals: { light: { ink: '#111' } },
  syrupRgb: '184, 101, 170',
};
`;

// --- A. CVA class rewrite --------------------------------------------------

describe('applyClassRewrite', () => {
  const CVA = `const buttonVariants = cva("rounded-md bg-primary", {
  variants: { size: { sm: "p-2 text-sm", lg: "p-6 text-lg" } },
});
`;

  it('rewrites the base literal via the __base__ sentinel', () => {
    const r = applyClassRewrite(CVA, {
      cvaName: 'buttonVariants',
      value: '__base__',
      replacements: [{ from: 'bg-primary', to: 'bg-accent' }],
    });
    expect(r.located).toBe(true);
    expect(r.text).toContain('cva("rounded-md bg-accent"');
  });

  it('rewrites one variant value, leaving its siblings alone', () => {
    const r = applyClassRewrite(CVA, {
      cvaName: 'buttonVariants',
      axis: 'size',
      value: 'sm',
      additions: ['gap-1'],
    });
    expect(r.text).toContain('sm: "p-2 text-sm gap-1"');
    expect(r.text).toContain('lg: "p-6 text-lg"');
  });

  it('shares token-boundary semantics with the layout path', () => {
    // Same helper as `applyLayoutProps`. `text-sm` must not match inside
    // `text-smaller`, which a substring replace would.
    const src = `const v = cva("text-smaller text-sm", {});`;
    const r = applyClassRewrite(src, {
      cvaName: 'v',
      value: '__base__',
      removals: ['text-sm'],
    });
    expect(r.text).toContain('cva("text-smaller"');
  });

  it('inherits the hostile-token guard from the shared helper', () => {
    // The guard is in `rewriteClassLiteral`, so the CVA path gets it without
    // its own copy — which is the point of sharing that helper. Asserted HERE
    // as well as on the layout path, because "both halves are covered by one
    // chokepoint" is a claim about this file too, and a future refactor that
    // gave `applyClassRewrite` its own rewrite loop would break it silently.
    const r = applyClassRewrite(CVA, {
      cvaName: 'buttonVariants',
      value: '__base__',
      additions: ['x" onMouseOver={fetch(`//evil`)} y="'],
    });
    expect(r.located).toBe(false);
    expect(r.reason).toMatch(/rejected unsafe class tokens/);
    expect(r.text).toBe(CVA);
    expect(r.text).not.toContain('onMouseOver');
  });

  it('inherits the TEMPLATE-literal guard too — a cva base can be a backtick', () => {
    // `${alert(1)}` carries no quote, no backtick and no whitespace, so the
    // double-quoted rule admitted it and turned the base into a live
    // TemplateExpression. The delimiter-aware guard is in the shared helper, so
    // this path gets it without its own copy — asserted here because "one
    // chokepoint covers both halves" is a claim about this file as well.
    const src = 'const v = cva(`rounded-md bg-primary`, {});';
    const r = applyClassRewrite(src, {
      cvaName: 'v',
      value: '__base__',
      additions: ['${alert(1)}'],
    });
    expect(r.located).toBe(false);
    expect(r.reason).toMatch(/rejected unsafe class tokens/);
    expect(r.text).toBe(src);
  });

  it('still edits a backtick cva base with ordinary classes', () => {
    const src = 'const v = cva(`rounded-md`, {});';
    const r = applyClassRewrite(src, {
      cvaName: 'v',
      value: '__base__',
      additions: ['[&>svg]:size-4'],
    });
    expect(r.located, r.reason).toBe(true);
    expect(r.text).toContain('`rounded-md [&>svg]:size-4`');
  });

  it('names the rejection instead of reporting an empty no-match', () => {
    // Distinct from the guard above: refusing is safety, SAYING SO is the
    // answer. Reporting `no matching classes: ` reads as "that class was not
    // there" and invites the designer to retry the same edit forever.
    const r = applyClassRewrite(CVA, {
      cvaName: 'buttonVariants',
      value: '__base__',
      removals: ['a b'],
    });
    expect(r.reason).toBe('rejected unsafe class tokens: a b');
    expect(r.reason).not.toMatch(/no matching classes/);
  });

  it('reports a cva it cannot find', () => {
    const r = applyClassRewrite(CVA, { cvaName: 'nope', value: '__base__', additions: ['p-1'] });
    expect(r.located).toBe(false);
    expect(r.reason).toMatch(/could not locate/);
    expect(r.text).toBe(CVA);
  });

  it('refuses a value that is not a plain string literal', () => {
    const src = `const v = cva(base, {});`;
    const r = applyClassRewrite(src, { cvaName: 'v', value: '__base__', additions: ['p-1'] });
    expect(r.located).toBe(false);
    expect(r.reason).toMatch(/not a plain string literal/);
  });

  it('refuses a TEMPLATE EXPRESSION, which also ends in a backtick', () => {
    // "Plain string literal" was decided by the LAST CHARACTER, and a
    // TemplateExpression ends in a backtick too. So class ops ran over
    // `` `base ${cn('p-2')} end` `` and removing `p-2` rewrote the inside of the
    // substitution to `cn('')` — editing the author's expression, which is the
    // harm the joiner allowlist exists to prevent, reached by another door.
    const src = "const v = cva(`base ${cn('p-2')} end`, {});";
    const r = applyClassRewrite(src, { cvaName: 'v', value: '__base__', removals: ['p-2'] });
    expect(r.located).toBe(false);
    expect(r.reason).toMatch(/not a plain string literal/);
    expect(r.text).toBe(src);
    expect(r.text).toContain("cn('p-2')");
  });

  it('writes nothing when no op matches', () => {
    const r = applyClassRewrite(CVA, {
      cvaName: 'buttonVariants',
      value: '__base__',
      removals: ['absent'],
    });
    expect(r.located).toBe(false);
    expect(r.text).toBe(CVA);
  });
});

// --- B. Token values -------------------------------------------------------

describe('applyTokenValue', () => {
  it("writes an expression UNQUOTED, keeping the token bound to the palette", () => {
    // The design-system-integrity rule. Always writing a literal would sever
    // the binding and leave every other palette consumer on the old colour.
    const r = applyTokenValue(SEMANTIC, {
      constName: 'light',
      path: ['primary'],
      value: 'palette.mocha',
      valueKind: 'expression',
    });
    expect(r.located).toBe(true);
    expect(r.text).toContain('primary: palette.mocha,');
  });

  it('writes a literal quoted, escaping an embedded quote', () => {
    const r = applyTokenValue(SEMANTIC, {
      constName: 'light',
      path: ['background'],
      value: "it's",
    });
    expect(r.text).toContain("background: 'it\\'s',");
  });

  it('REFUSES an expression that is not a bare palette reference', () => {
    // Same reason `renderAttribute` guards its expression kind: the value comes
    // from a browser and lands in a file the dev server executes.
    for (const value of ['fetch("/x")', 'palette.a; drop()', 'window.location', '(()=>{})()']) {
      const r = applyTokenValue(SEMANTIC, {
        constName: 'light',
        path: ['primary'],
        value,
        valueKind: 'expression',
      });
      expect(r.located, `must refuse ${value}`).toBe(false);
      expect(r.text).toBe(SEMANTIC);
    }
  });

  it('targets the const, never the type declaration of the same name', () => {
    const r = applyTokenValue(SEMANTIC, { constName: 'light', path: ['primary'], value: '#fff' });
    expect(r.text).toContain('primary: string;');
    expect(r.text).toContain("primary: '#fff',");
  });

  it('walks a nested path', () => {
    const r = applyTokenValue(PALETTE, {
      constName: 'palette',
      path: ['neutrals', 'light', 'ink'],
      value: '#222',
    });
    expect(r.located).toBe(true);
    expect(r.text).toContain("ink: '#222'");
  });

  it('names the property it could not find', () => {
    const r = applyTokenValue(SEMANTIC, { constName: 'light', path: ['nope'], value: '#fff' });
    expect(r.located).toBe(false);
    expect(r.reason).toMatch(/property nope not found/);
  });
});

// --- Introspection readers -------------------------------------------------

describe('introspection readers', () => {
  it('classifies each semantic binding by form', () => {
    const { bindings } = readSemanticBindings(SEMANTIC);
    expect(bindings.light.primary).toEqual({ kind: 'palette', ref: 'palette.syrup' });
    expect(bindings.light.background).toEqual({ kind: 'literal', value: '#fff' });
    expect(bindings.dark.primary).toEqual({ kind: 'palette', ref: 'palette.butter' });
  });

  it('returns bindings maps with a null prototype', () => {
    // Keyed by token names read out of consumer source — see §5.11. The outer
    // map and both inner maps.
    const { bindings } = readSemanticBindings(SEMANTIC);
    expect(Object.getPrototypeOf(bindings)).toBeNull();
    expect(Object.getPrototypeOf(bindings.light)).toBeNull();
    expect(Object.getPrototypeOf(bindings.dark)).toBeNull();
  });

  it('flattens const leaves with their dotted path', () => {
    const { leaves } = readConstLeaves(PALETTE, 'palette');
    expect(leaves).toContainEqual({ path: ['syrup'], value: '#B865aa' });
    expect(leaves).toContainEqual({ path: ['neutrals', 'light', 'ink'], value: '#111' });
  });

  it('flags a palette leaf that is not a colour', () => {
    // `syrupRgb` is an rgb tuple, not something a colour picker should offer.
    const { colors } = readPaletteColors(PALETTE);
    expect(colors.find((c) => c.ref === 'palette.syrup').isColor).toBe(true);
    expect(colors.find((c) => c.ref === 'palette.syrupRgb').isColor).toBe(false);
  });

  it('lists the theme keys reachable as utility classes', () => {
    expect(readThemeMappings(CSS).mappings).toEqual([
      '--color-background',
      '--color-primary',
      '--radius-md',
    ]);
  });

  it('reports a missing const rather than throwing', () => {
    expect(readConstLeaves('const x = 1;', 'palette').located).toBe(false);
    expect(readThemeMappings('body {}').located).toBe(false);
  });
});

// --- The round trips -------------------------------------------------------

describe('every create has an exact inverse', () => {
  // The token pipeline is closed, so an undo that rolls back past a save has to
  // restore the file — not merely something equivalent.

  it('semantic token: insert → remove', () => {
    const ins = insertSemanticToken(SEMANTIC, { camelKey: 'brandAccent', value: '#abc' });
    expect(ins.located).toBe(true);
    // All THREE places, or the token exists and is unusable.
    expect(ins.text).toContain('brandAccent: string;');
    expect(ins.text.match(/brandAccent: '#abc',/g)).toHaveLength(2); // light + dark
    expect(removeSemanticToken(ins.text, { camelKey: 'brandAccent' }).text).toBe(SEMANTIC);
  });

  it('const member: insert → remove', () => {
    const ins = insertConstMember(SEMANTIC, { constName: 'light', key: 'muted', value: '#eee' });
    expect(ins.located).toBe(true);
    expect(removeConstMember(ins.text, { constName: 'light', key: 'muted' }).text).toBe(SEMANTIC);
  });

  it('block emit: insert → remove', () => {
    const ins = insertBlockEmit(BUILD, {
      fnName: 'semanticBlock',
      cssVar: '--brand-accent',
      expr: 'm.brandAccent',
    });
    expect(ins.located).toBe(true);
    expect(ins.text).toContain("['--brand-accent', m.brandAccent],");
    expect(removeBlockEmit(ins.text, { fnName: 'semanticBlock', cssVar: '--brand-accent' }).text)
      .toBe(BUILD);
  });

  it('theme mapping: insert → remove', () => {
    const ins = insertThemeMapping(CSS, { cssVar: '--color-brand', mapTo: '--brand' });
    expect(ins.located).toBe(true);
    expect(removeThemeMapping(ins.text, { cssVar: '--color-brand' }).text).toBe(CSS);
  });

  it('removes a declaration that ends against the closing brace', () => {
    // The matcher required a trailing newline, so the LAST declaration in a
    // block written without one reported "is not mapped" — a mapping plainly
    // present that the editor could not remove.
    const css = `@theme inline {\n  --color-a: var(--a);\n  --color-b: var(--b);}\n`;
    const r = removeThemeMapping(css, { cssVar: '--color-b' });
    expect(r.located, r.reason).toBe(true);
    expect(r.text).toBe(`@theme inline {\n  --color-a: var(--a);\n}\n`);
  });
});

describe('token creation guards', () => {
  it('refuses a key that is not an identifier', () => {
    for (const camelKey of ['has-dash', '2leading', 'with space', '']) {
      const r = insertSemanticToken(SEMANTIC, { camelKey, value: '#abc' });
      expect(r.located, `must refuse ${camelKey}`).toBe(false);
      expect(r.text).toBe(SEMANTIC);
    }
  });

  it('refuses a duplicate token', () => {
    const r = insertSemanticToken(SEMANTIC, { camelKey: 'primary', value: '#abc' });
    expect(r.located).toBe(false);
    expect(r.reason).toMatch(/already exists/);
  });

  it('refuses a duplicate emitter and a duplicate mapping', () => {
    expect(insertBlockEmit(BUILD, { fnName: 'semanticBlock', cssVar: '--primary', expr: 'x' }).reason)
      .toMatch(/already present/);
    expect(insertThemeMapping(CSS, { cssVar: '--color-primary', mapTo: '--primary' }).reason)
      .toMatch(/already mapped/);
  });

  it('refuses a custom property that is not a valid CSS ident', () => {
    for (const cssVar of ['color-brand', '--Color', '--a b', '--']) {
      const r = insertThemeMapping(CSS, { cssVar, mapTo: '--brand' });
      expect(r.located, `must refuse ${cssVar}`).toBe(false);
    }
  });

  it('reports a semantic file whose shape it does not recognise', () => {
    const r = insertSemanticToken('const x = 1;', { camelKey: 'a', value: '#fff' });
    expect(r.located).toBe(false);
    expect(r.reason).toMatch(/shape not recognized/);
  });

  it('cleans up a PARTIALLY created token rather than refusing', () => {
    // A half-created token — present in light, missing from dark — would be
    // permanently unfixable through this API if removal demanded all three.
    const partial = SEMANTIC.replace("  primary: palette.syrup,\n", "  primary: palette.syrup,\n  half: '#abc',\n");
    const r = removeSemanticToken(partial, { camelKey: 'half' });
    expect(r.located).toBe(true);
    expect(r.text).toBe(SEMANTIC);
  });
});

describe('insertThemeMapping grouping', () => {
  it('groups a new alias after the last declaration in its namespace', () => {
    // Not cosmetic: keeps the block sorted by family, and puts a `--font-*`
    // alias inside the existing lint-disable region rather than beside it.
    const r = insertThemeMapping(CSS, { cssVar: '--color-brand', mapTo: '--brand' });
    const lines = r.text.split('\n');
    expect(lines[3]).toBe('  --color-brand: var(--brand);');
    expect(lines[4]).toContain('--radius-md');
  });

  it('falls back to the end of the block when no sibling shares the namespace', () => {
    const r = insertThemeMapping(CSS, { cssVar: '--font-body', mapTo: '--body' });
    expect(r.located).toBe(true);
    expect(r.text).toContain('  --font-body: var(--body);\n}');
  });
});

// --- shapes the token file is allowed to have --------------------------------

/**
 * The insert/remove pair took the SHAPE of this repo's `semantic.ts` as the
 * shape of every semantic file. Two assumptions were baked in and both were
 * wrong for a file written differently:
 *
 *   1. `dark` is declared last, so writing dark → light → type is bottom-up.
 *      With `dark` declared first, the later splices used stale offsets and the
 *      file came out mangled and unparseable.
 *   2. Each declaration's closing brace is on its own line. For a one-line
 *      `type SemanticColorMap = { bg: string; };` the "start of the closing
 *      line" is the start of the whole declaration, so the type member was
 *      written ABOVE it as a stray top-level statement — which parses as a
 *      label, so nothing complained and the token silently never joined the
 *      type.
 *
 * The order is derived from each target's position now, and the insert adapts to
 * whichever formatting it finds. This matrix is the guard: it is not about any
 * one layout, it is about not assuming one.
 */
describe('token creation survives any declaration order and formatting', () => {
  const SHAPES = {
    'dark declared before light': `type SemanticColorMap = {\n  bg: string;\n};\nexport const dark: SemanticColorMap = {\n  bg: '#000',\n};\nexport const light: SemanticColorMap = {\n  bg: '#fff',\n};\n`,
    'type declared last': `export const light = {\n  bg: '#fff',\n};\nexport const dark = {\n  bg: '#000',\n};\ntype SemanticColorMap = {\n  bg: string;\n};\n`,
    'type between the maps': `export const dark = {\n  bg: '#000',\n};\ntype SemanticColorMap = {\n  bg: string;\n};\nexport const light = {\n  bg: '#fff',\n};\n`,
    'one-line type literal': `type SemanticColorMap = { bg: string; };\nexport const light: SemanticColorMap = {\n  bg: '#fff',\n};\nexport const dark: SemanticColorMap = {\n  bg: '#000',\n};\n`,
    'everything on one line': `type SemanticColorMap = { bg: string; };\nexport const light: SemanticColorMap = { bg: '#fff' };\nexport const dark: SemanticColorMap = { bg: '#000' };\n`,
  };

  for (const [name, src] of Object.entries(SHAPES)) {
    it(`inserts into all three places and restores exactly: ${name}`, () => {
      const ins = insertSemanticToken(src, { camelKey: 'accent', value: '#f00' });
      expect(ins.located, ins.reason).toBe(true);
      expect(parse(ins.text, 'semantic.ts').parseDiagnostics ?? []).toHaveLength(0);

      // All THREE places, which is what the stray-label bug silently skipped.
      expect(ins.text).toMatch(/accent:\s*string/);
      expect(ins.text.match(/accent:\s*'#f00'/g) ?? []).toHaveLength(2);

      const back = removeSemanticToken(ins.text, { camelKey: 'accent' });
      expect(back.located, back.reason).toBe(true);
      expect(back.text).toBe(src);
    });
  }

  it('adds the separator a last member lacks, rather than writing a syntax error', () => {
    // Not byte-exact on the way back — the comma is a real change to the file —
    // so this asserts what IS true: valid output, token present, token removable.
    const src = `type SemanticColorMap = {\n  bg: string;\n};\nexport const light = {\n  bg: '#fff'\n};\nexport const dark = {\n  bg: '#000'\n};\n`;
    const ins = insertSemanticToken(src, { camelKey: 'accent', value: '#f00' });
    expect(parse(ins.text, 'semantic.ts').parseDiagnostics ?? []).toHaveLength(0);
    expect(ins.text).toContain("bg: '#fff',");
    const back = removeSemanticToken(ins.text, { camelKey: 'accent' });
    expect(parse(back.text, 'semantic.ts').parseDiagnostics ?? []).toHaveLength(0);
    expect(back.text).not.toContain('accent');
  });
});

describe('quoteLiteral escapes what would break the literal', () => {
  const TOKENS = `export const light = {\n  background: '#fff',\n};\n`;

  it('escapes a newline instead of writing an unterminated string', () => {
    // A single-quoted TS literal cannot span lines. The value arrives from a
    // browser, so this was five parse errors in the consumer's token file from
    // one paste.
    const r = applyTokenValue(TOKENS, {
      constName: 'light',
      path: ['background'],
      value: 'a\nb',
    });
    expect(r.located, r.reason).toBe(true);
    expect(r.text).toContain("background: 'a\\nb'");
    expect(parse(r.text, 'tokens.ts').parseDiagnostics ?? []).toHaveLength(0);
  });

  it('escapes the rest of the control range by code point', () => {
    for (const [value, expected] of [
      ['a\rb', "'a\\rb'"],
      ['a\tb', "'a\\x09b'"],
      ['a\0b', "'a\\x00b'"],
      ["a'b", "'a\\'b'"],
      ['a\\b', "'a\\\\b'"],
    ]) {
      const r = applyTokenValue(TOKENS, {
        constName: 'light',
        path: ['background'],
        value,
      });
      expect(r.text, value).toContain(`background: ${expected}`);
      expect(parse(r.text, 'tokens.ts').parseDiagnostics ?? [], value).toHaveLength(0);
    }
  });
});
