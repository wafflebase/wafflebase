import { describe, expect, it } from 'vitest';
import {
  appliedClasses,
  applyClassEdits,
  camelToKebab,
  classEditApplies,
  computeColorReplacements,
  computeScaleReplacement,
  cssVarFor,
  defaultVariantState,
  editCount,
  editStateKey,
  emptyEditState,
  familyMetaOf,
  kebabToCamel,
  layoutEditKey,
  normalizeTokenName,
  overrideClassName,
  revertLayoutIntents,
  saveDiff,
  stageTokenAdd,
  themeVarFor,
  toClassIntent,
  toLayoutIntents,
  toTokenIntent,
  tokenOverrideStyle,
  tokenPreviewStyle,
  utilityFor,
} from '../../src/client/edits.ts';
import type {
  EditState,
  PendingClassEdit,
  PendingLayoutEdit,
  PendingTokenEdit,
  PendingTokenRebind,
} from '../../src/client/edits.ts';
// The real normaliser, so the wire shapes below are checked against what the
// server actually does with them rather than against a restatement of it.
import { tokenEditOf } from '../../src/plugin/tokens.ts';
import type { ComponentMeta } from '../../src/types.ts';
import type { NodeAnchor } from '../../src/plugin/protocol.ts';
import type { TokenFamilyMeta } from '../../src/tokens/adapter.ts';

const FAMILIES: TokenFamilyMeta[] = [
  {
    family: 'semantic',
    label: 'Color',
    file: 'src/tokens/semantic.ts',
    cssVarPrefix: '--',
    themeVarPrefix: '--color-',
    utilityPrefix: 'bg-',
    placeholder: 'brand-accent',
    defaultValue: '#4f8ff7',
  },
  {
    family: 'palette',
    label: 'Palette color',
    file: 'src/tokens/palette.ts',
    cssVarPrefix: '--wb-',
    themeVarPrefix: '--color-wb-',
    utilityPrefix: 'bg-wb-',
    placeholder: 'mocha',
    defaultValue: '#8A4A12',
  },
  {
    family: 'radius',
    label: 'Radius',
    file: 'src/tokens/radius.ts',
    cssVarPrefix: '--radius-',
    themeVarPrefix: '--radius-',
    utilityPrefix: 'rounded-',
    placeholder: 'pill',
    defaultValue: '9999px',
  },
];

const tokenEdit = (over: Partial<PendingTokenEdit> = {}): PendingTokenEdit => ({
  key: 'light|primary',
  cssVar: 'primary',
  family: 'semantic',
  constName: 'light',
  path: ['primary'],
  label: 'Primary',
  kind: 'color',
  oldValue: '#111',
  newValue: '#222',
  ...over,
});

const classEdit = (over: Partial<PendingClassEdit> = {}): PendingClassEdit => ({
  key: 'Button|bg',
  componentName: 'Button',
  file: 'src/ui/button.tsx',
  cvaName: 'buttonVariants',
  value: '__base__',
  scopeLabel: 'base',
  property: 'Background',
  fromLabel: 'primary',
  toLabel: 'secondary',
  replacements: [{ from: 'bg-primary', to: 'bg-secondary' }],
  revealVariant: {},
  ...over,
});

/** Everything a rebind carries EXCEPT the `fromKind`/`fromValue` discriminant. */
const REBIND = {
  key: 'r',
  cssVar: 'ring',
  family: 'semantic' as const,
  constName: 'light' as const,
  path: ['ring'],
  label: 'Ring',
  toRef: 'palette.butter',
  previewValue: '#fff',
};

const anchor = (path: number[], over: Partial<NodeAnchor> = {}): NodeAnchor => ({
  file: 'src/routes/home.tsx',
  component: 'Home',
  path,
  tag: 'div',
  fp: `fp-${path.join('.')}`,
  ...over,
});

// ---------------------------------------------------------------------------

describe('family metadata comes from the server', () => {
  it('builds each name by prefix, so no naming rule is compiled in', () => {
    const palette = familyMetaOf(FAMILIES, 'palette')!;
    expect(cssVarFor(palette, 'mocha')).toBe('--wb-mocha');
    expect(themeVarFor(palette, 'mocha')).toBe('--color-wb-mocha');
    expect(utilityFor(palette, 'mocha')).toBe('bg-wb-mocha');
  });

  it('reports a family the adapter does not carry, rather than assuming one', () => {
    // `typo` is deliberately absent from FAMILIES: an adapter is free to carry
    // fewer families than the four wafflebase happens to have.
    expect(familyMetaOf(FAMILIES, 'typo')).toBeNull();
    expect(stageTokenAdd(FAMILIES, 'typo', 'heading')).toEqual({
      error: 'the token adapter carries no typo family',
    });
  });
});

describe('stageTokenAdd', () => {
  it('derives both key forms and the property from server metadata', () => {
    expect(stageTokenAdd(FAMILIES, 'palette', 'Brand Accent', '#0af')).toEqual({
      key: 'palette|brand-accent',
      family: 'palette',
      kebabKey: 'brand-accent',
      camelKey: 'brandAccent',
      cssVar: '--wb-brand-accent',
      value: '#0af',
    });
  });

  it('falls back to the family default rather than staging an empty value', () => {
    const add = stageTokenAdd(FAMILIES, 'radius', 'pill');
    expect(add).toMatchObject({ value: '9999px', cssVar: '--radius-pill' });
  });

  it('refuses a name the server would refuse, before the round trip', () => {
    // Same rule as `tokenEditOf`: a key that is not a plain identifier cannot be a
    // TypeScript property. Checked here only so the user hears it sooner.
    expect(stageTokenAdd(FAMILIES, 'semantic', '123')).toEqual({
      error: 'invalid token name: 123',
    });
    expect(stageTokenAdd(FAMILIES, 'semantic', '   ')).toEqual({ error: 'a token needs a name' });
  });
});

describe('key-case conversion', () => {
  it('treats a run of digits as one group', () => {
    // The prototype's own copy of this broke on every character, so `gray100`
    // became `gray-1-0-0`. Importing the contract's version is what fixes it.
    expect(camelToKebab('gray100')).toBe('gray-100');
    expect(kebabToCamel('gray-100')).toBe('gray100');
    expect(kebabToCamel(camelToKebab('primaryForeground'))).toBe('primaryForeground');
  });

  it('normalizes a typed name to a kebab key', () => {
    expect(normalizeTokenName('  Brand   Accent! ')).toBe('brand-accent');
    expect(normalizeTokenName('--edge--')).toBe('edge');
  });
});

// ---------------------------------------------------------------------------

describe('toTokenIntent', () => {
  it('sends the family and no file', () => {
    expect(toTokenIntent(tokenEdit({ family: 'radius', constName: 'radius', path: ['lg'] })))
      .toEqual({
        kind: 'token-value',
        family: 'radius',
        constName: 'radius',
        path: ['lg'],
        tokenValue: '#222',
      });
  });

  it('normalises to the family that was staged, not to semantic', () => {
    // The regression this replaces: the prototype sent `file` and no `family`, and
    // `tokenEditOf` defaults a missing family to `semantic` — so a radius edit was
    // planned against the semantic source and failed to locate `lg` there.
    for (const [family, constName, path] of [
      ['semantic', 'light', 'primary'],
      ['semantic', 'dark', 'primary'],
      ['radius', 'radius', 'lg'],
      ['typo', 'typography', 'body'],
    ] as const) {
      const edit = tokenEditOf(toTokenIntent(tokenEdit({ family, constName, path: [path] })));
      expect(edit).toMatchObject({ kind: 'set-value', family });
    }
  });

  it('keeps the theme selector, which is a separate axis from the family', () => {
    // `constName` chooses light/dark WITHIN a family; it does not choose the family.
    expect(tokenEditOf(toTokenIntent(tokenEdit({ constName: 'dark' })))).toMatchObject({
      theme: 'dark',
      family: 'semantic',
    });
    expect(tokenEditOf(toTokenIntent(tokenEdit({ family: 'radius', constName: 'radius' }))))
      .toMatchObject({ theme: 'light', family: 'radius' });
  });
});

describe('class rewrite intents', () => {
  it('drops the axis on a base-scope edit', () => {
    expect(toClassIntent(classEdit({ axis: 'variant' }))).toMatchObject({ axis: undefined });
    expect(toClassIntent(classEdit({ value: 'destructive', axis: 'variant' })))
      .toMatchObject({ axis: 'variant', value: 'destructive' });
  });

  it('keeps the component file, which the wire does read for this kind', () => {
    expect(toClassIntent(classEdit()).file).toBe('src/ui/button.tsx');
  });
});

// ---------------------------------------------------------------------------

describe('computeColorReplacements', () => {
  it('rewrites a resting token and preserves its opacity suffix', () => {
    expect(computeColorReplacements('bg-primary/90 text-sm', ['bg'], 'primary', 'secondary'))
      .toEqual([{ from: 'bg-primary/90', to: 'bg-secondary/90' }]);
  });

  it('leaves interaction-state tokens to their own rows', () => {
    // Two intents claiming the same span is what this prevents: the state editor
    // rewrites `hover:bg-primary` itself, and the second locate would fail.
    expect(computeColorReplacements('hover:bg-primary', ['bg'], 'primary', 'secondary')).toEqual([]);
  });

  it('still rewrites a non-state modifier, which is part of the resting value', () => {
    expect(computeColorReplacements('dark:bg-primary', ['bg'], 'primary', 'secondary'))
      .toEqual([{ from: 'dark:bg-primary', to: 'dark:bg-secondary' }]);
  });

  it('does not match a role that merely shares a prefix', () => {
    expect(computeColorReplacements('bg-primary-foreground', ['bg'], 'primary', 'secondary'))
      .toEqual([]);
  });
});

describe('computeScaleReplacement', () => {
  it('drops the step for the base radius, which has no suffix', () => {
    expect(
      computeScaleReplacement(
        { category: 'radius', utility: 'rounded', value: 'md', className: 'rounded-md' },
        'base',
      ),
    ).toEqual({ from: 'rounded-md', to: 'rounded' });
  });

  it('keeps a modifier prefix on the rewritten token', () => {
    expect(
      computeScaleReplacement(
        { category: 'fontSize', utility: 'text', value: 'sm', className: 'md:text-sm' },
        'lg',
      ),
    ).toEqual({ from: 'md:text-sm', to: 'md:text-lg' });
  });
});

describe('applying class edits', () => {
  const edits = [
    classEdit({
      replacements: [{ from: 'bg-primary', to: 'bg-secondary' }],
      additions: ['active:bg-primary/80'],
      removals: ['shadow-sm'],
    }),
  ];

  it('replaces, removes and appends in one pass', () => {
    expect(applyClassEdits('bg-primary shadow-sm px-4', edits))
      .toBe('bg-secondary px-4 active:bg-primary/80');
  });

  it('does not append a token that is already there', () => {
    expect(applyClassEdits('active:bg-primary/80', edits)).toBe('active:bg-primary/80');
  });

  it('overrides a preview with only the tokens the edit introduces', () => {
    expect(overrideClassName('Button', {}, edits)).toBe('bg-secondary active:bg-primary/80');
    expect(overrideClassName('Badge', {}, edits)).toBe('');
  });

  it('applies a variant-scoped edit only under that variant', () => {
    const scoped = classEdit({ value: 'destructive', axis: 'variant' });
    expect(classEditApplies(scoped, { variant: 'destructive' })).toBe(true);
    expect(classEditApplies(scoped, { variant: 'outline' })).toBe(false);
    expect(classEditApplies(classEdit(), { variant: 'outline' })).toBe(true);
  });
});

describe('appliedClasses', () => {
  const component = {
    name: 'Button',
    cva: {
      name: 'buttonVariants',
      base: { classes: 'inline-flex bg-primary' },
      axes: {
        variant: { destructive: { classes: 'bg-destructive' }, outline: { classes: 'border' } },
        size: { sm: { classes: 'h-8' } },
      },
      defaults: { variant: 'outline' },
    },
  } as unknown as ComponentMeta;

  it('seeds the selection from the CVA defaults, falling back to the first value', () => {
    expect(defaultVariantState(component)).toEqual({ variant: 'outline', size: 'sm' });
  });

  it('joins the base and the selected values, with staged edits folded in', () => {
    expect(appliedClasses(component, { variant: 'destructive' }, [classEdit()]))
      .toBe('inline-flex bg-secondary bg-destructive');
  });

  it('does not fold a base edit into a variant scope', () => {
    const variantEdit = classEdit({
      value: 'destructive',
      axis: 'variant',
      replacements: [{ from: 'bg-destructive', to: 'bg-warning' }],
    });
    expect(appliedClasses(component, { variant: 'outline' }, [variantEdit]))
      .toBe('inline-flex bg-primary border');
  });

  it('is empty for a component with no cva', () => {
    expect(appliedClasses({ name: 'Plain', cva: null } as ComponentMeta, {}, [])).toBe('');
  });
});

// ---------------------------------------------------------------------------

describe('preview overrides', () => {
  it('keeps a dark edit out of the light preview', () => {
    const edits = [
      tokenEdit({ constName: 'light', newValue: '#fff' }),
      tokenEdit({ key: 'dark|primary', constName: 'dark', newValue: '#000' }),
    ];
    expect(tokenOverrideStyle(edits, 'light')).toEqual({ '--primary': '#fff' });
    expect(tokenOverrideStyle(edits, 'dark')).toEqual({ '--primary': '#000' });
  });

  it('always applies a theme-agnostic scale edit', () => {
    const radius = tokenEdit({ cssVar: 'radius', family: 'radius', constName: 'radius', kind: 'radius' });
    expect(tokenOverrideStyle([radius], 'dark')).toEqual({ '--radius': '#222' });
  });

  it('folds literals, rebinds and the palette cascade into one map', () => {
    const rebind: PendingTokenRebind = {
      key: 'light|ring',
      cssVar: 'ring',
      family: 'semantic',
      constName: 'light',
      path: ['ring'],
      label: 'Ring',
      fromRef: 'palette.syrup',
      fromKind: 'ref',
      toRef: 'palette.butter',
      previewValue: '#f5c542',
    };
    expect(
      tokenPreviewStyle({
        theme: 'light',
        literalEdits: [tokenEdit({ newValue: '#abc' })],
        rebinds: [rebind],
        paletteEdits: [
          { key: 'palette|syrup', ref: 'palette.syrup', path: ['syrup'], label: 'syrup', oldValue: '#000', newValue: '#123456' },
        ],
        bindings: {
          accent: { kind: 'ref', value: 'palette.syrup' },
          sidebarAccent: { kind: 'expression', value: 'rgba(var(--x), 0.3)' },
          border: { kind: 'literal', value: '#eee' },
        },
      }),
    ).toEqual({ '--primary': '#abc', '--ring': '#f5c542', '--accent': '#123456' });
  });

  it('does not cascade into a locked expression', () => {
    // An expression uses the reference as an INGREDIENT, so its token is not that
    // colour: overriding it with the raw hex would preview an opaque swatch where
    // the app renders 30% alpha.
    const cascade = (bindings: Record<string, { kind: 'literal' | 'ref' | 'expression'; value: string }>) =>
      tokenPreviewStyle({
        theme: 'light',
        literalEdits: [],
        rebinds: [],
        paletteEdits: [
          { key: 'p', ref: 'palette.butter', path: ['butter'], label: 'butter', oldValue: '#000', newValue: '#fff' },
        ],
        bindings,
      });

    expect(cascade({ sidebarAccent: { kind: 'expression', value: 'rgba(palette.butter, 0.3)' } }))
      .toEqual({});
    // What excludes it above is the TEXT, not the kind — an expression's text
    // contains the ref rather than equalling it, so both readings agree there.
    // The kind check is what decides the case where they disagree: the contract's
    // `kind` is the answer to "is this a reference", and re-deriving it from the
    // value is the inference this module exists to stop making.
    expect(cascade({ a: { kind: 'expression', value: 'palette.butter' } })).toEqual({});
    expect(cascade({ a: { kind: 'ref', value: 'palette.butter' } })).toEqual({ '--a': '#fff' });
  });

  it('skips the cascade entirely when no bindings were read', () => {
    expect(
      tokenPreviewStyle({
        theme: 'light',
        literalEdits: [],
        rebinds: [],
        paletteEdits: [
          { key: 'p', ref: 'palette.butter', path: ['butter'], label: 'b', oldValue: '#000', newValue: '#fff' },
        ],
      }),
    ).toEqual({});
  });
});

// ---------------------------------------------------------------------------

describe('layout intents', () => {
  const props: PendingLayoutEdit = {
    key: 'p|0.1',
    op: 'props',
    sceneId: 'home',
    anchor: anchor([0, 1]),
    label: 'edit props',
    scopeLabel: 'div',
    sets: [{ name: 'id', from: 'old', to: 'new' }],
    classOps: { replacements: [{ from: 'p-2', to: 'p-4' }], additions: ['gap-2'] },
    textFrom: 'before',
    textTo: 'after',
  };

  it('swaps every captured direction on the inverse of a props edit', () => {
    expect(revertLayoutIntents(props)[0]).toMatchObject({
      sets: [{ name: 'id', value: 'old' }],
      classOps: { replacements: [{ from: 'p-4', to: 'p-2' }], removals: ['gap-2'] },
      text: 'before',
    });
    expect(toLayoutIntents(props)[0]).toMatchObject({
      sets: [{ name: 'id', value: 'new' }],
      text: 'after',
    });
  });

  it('anchors the inverse of an insert on the fingerprint the insert declared', () => {
    const insert: PendingLayoutEdit = {
      key: 'i|0',
      op: 'insert',
      sceneId: 'home',
      anchor: anchor([0]),
      label: 'insert',
      scopeLabel: 'div',
      index: 2,
      raw: '<span />',
      insertedFp: 'fp-new',
      insertedTag: 'span',
    };
    // `fp` is not a field on the forward request: the wire has none and the plugin
    // reads none. It is kept on the staged edit purely to build this anchor.
    expect(toLayoutIntents(insert)[0]).not.toHaveProperty('fp');
    expect(revertLayoutIntents(insert)[0]).toMatchObject({
      kind: 'layout-remove',
      anchor: { path: [0, 2], tag: 'span', fp: 'fp-new', fpx: undefined },
    });
  });

  it('restores a removed span verbatim, which is what makes undo byte-identical', () => {
    const remove: PendingLayoutEdit = {
      key: 'r|0.3',
      op: 'remove',
      sceneId: 'home',
      anchor: anchor([0, 3]),
      label: 'remove',
      scopeLabel: 'div',
      removedText: '<b>hi</b>',
      removedIndex: 3,
    };
    expect(revertLayoutIntents(remove)[0]).toMatchObject({
      kind: 'layout-insert',
      parent: { path: [0] },
      index: 3,
      raw: '<b>hi</b>',
      verbatim: true,
    });
  });

  it('pairs a move as a remove + insert sharing one group', () => {
    const move: PendingLayoutEdit = {
      key: 'm|0.1',
      op: 'move',
      sceneId: 'home',
      anchor: anchor([0, 1]),
      label: 'move',
      scopeLabel: 'div',
      toParent: anchor([2]),
      toIndex: 0,
      removedText: '<i/>',
      removedIndex: 1,
      removedFp: 'fp-moved',
    };
    const forward = toLayoutIntents(move);
    expect(forward.map((i) => i.kind)).toEqual(['layout-remove', 'layout-insert']);
    // One group id across both, so a half-applied move cannot delete and drop.
    expect(new Set(forward.map((i) => i.groupId))).toEqual(new Set(['move:m|0.1']));
    expect(forward[1]).toMatchObject({ verbatim: true, raw: '<i/>' });
    expect(revertLayoutIntents(move)[0]).toMatchObject({
      kind: 'layout-remove',
      anchor: { path: [2, 0], fp: 'fp-moved' },
    });
  });
});

// ---------------------------------------------------------------------------

describe('saveDiff', () => {
  const withClass = (edits: Record<string, PendingClassEdit>): EditState => ({
    ...emptyEditState(),
    classEdits: edits,
  });

  it('plans nothing for an edit that is already on disk', () => {
    const state = withClass({ a: classEdit() });
    expect(saveDiff(state, state)).toEqual([]);
  });

  it('applies what is new and reverts what disappeared', () => {
    const plan = saveDiff(withClass({ a: classEdit() }), withClass({ b: classEdit({ key: 'b' }) }));
    expect(plan.map((p) => p.mode)).toEqual(['revert', 'apply']);
    // Reverts come first so the baseline frame is whole before any apply runs.
    expect(plan[0]).toMatchObject({
      map: 'classEdits',
      key: 'a',
      intent: { replacements: [{ from: 'bg-secondary', to: 'bg-primary' }] },
    });
  });

  it('re-applies an edit whose value changed under the same key', () => {
    const plan = saveDiff(
      withClass({ a: classEdit() }),
      withClass({ a: classEdit({ toLabel: 'accent' }) }),
    );
    expect(plan).toHaveLength(1);
    expect(plan[0].mode).toBe('apply');
  });

  it('rebinds back to the reference, or restores the literal it replaced', () => {
    const drop = (r: PendingTokenRebind) =>
      saveDiff({ ...emptyEditState(), rebinds: { r } }, emptyEditState())[0].intent;

    expect(drop({ ...REBIND, fromRef: 'palette.syrup', fromKind: 'ref' }))
      .toMatchObject({ kind: 'token-rebind', tokenValue: 'palette.syrup' });
    // A literal cannot be written through `token-rebind`, so the inverse changes kind.
    expect(drop({ ...REBIND, fromRef: '#abcdef', fromKind: 'literal', fromValue: '#abcdef' }))
      .toMatchObject({ kind: 'token-value', tokenValue: '#abcdef' });
    // And a locked expression takes the same branch — it was never rebindable.
    expect(drop({ ...REBIND, fromRef: 'rgba(x, .3)', fromKind: 'expression', fromValue: 'rgba(0,0,0,.3)' }))
      .toMatchObject({ kind: 'token-value', tokenValue: 'rgba(0,0,0,.3)' });
  });

  it('always carries a value on the inverse, whatever the binding was', () => {
    // The failure this replaces: `fromValue` was merely optional, so a `'literal'`
    // rebind could omit it and the inverse serialised to
    //   {"kind":"token-value","family":"semantic","constName":"light","path":["ring"]}
    // with no `tokenValue` at all — refused at save time by the one path that exists
    // to make undo possible. `PendingTokenRebind` is now a union on `fromKind`.
    const of = (r: PendingTokenRebind) =>
      saveDiff({ ...emptyEditState(), rebinds: { r } }, emptyEditState())[0].intent;
    for (const r of [
      { ...REBIND, fromRef: 'palette.syrup', fromKind: 'ref' as const },
      { ...REBIND, fromRef: '#abcdef', fromKind: 'literal' as const, fromValue: '#abcdef' },
      { ...REBIND, fromRef: 'rgba(x, .3)', fromKind: 'expression' as const, fromValue: 'rgba(x, .3)' },
    ]) {
      const intent = of(r);
      expect(intent.tokenValue, JSON.stringify(intent)).toBeTypeOf('string');
      // The wire form is what the server sees, and an undefined value vanishes there.
      expect(JSON.parse(JSON.stringify(intent))).toHaveProperty('tokenValue');
    }
  });

  it('will not type-check a rebind that omits the value its inverse needs', () => {
    // `tsc --noEmit` is the assertion: `@ts-expect-error` fails the build if the error
    // stops happening, so this catches the union being loosened back to optional.
    const bad = {
      key: 'r', cssVar: 'ring', family: 'semantic', constName: 'light', path: ['ring'],
      label: 'Ring', fromRef: '#abcdef', toRef: 'palette.butter', previewValue: '#fff',
      fromKind: 'literal',
      // @ts-expect-error — `fromValue` is required unless `fromKind` is 'ref'
    } satisfies PendingTokenRebind;
    expect(bad.fromKind).toBe('literal');
  });

  it('inverts a token add into a member removal', () => {
    const add = {
      key: 'semantic|brand',
      family: 'semantic' as const,
      kebabKey: 'brand',
      camelKey: 'brand',
      cssVar: '--brand',
      value: '#123',
    };
    const plan = saveDiff({ ...emptyEditState(), tokenAdds: { a: add } }, emptyEditState());
    expect(plan[0].intent).toEqual({
      kind: 'member-remove',
      family: 'semantic',
      camelKey: 'brand',
      kebabKey: 'brand',
    });
  });

  it('emits one plan item per intent for a move, both discardable by the same ref', () => {
    const move: PendingLayoutEdit = {
      key: 'm',
      op: 'move',
      sceneId: 'home',
      anchor: anchor([0, 1]),
      label: 'move it',
      scopeLabel: 'div',
      toParent: anchor([2]),
      toIndex: 0,
    };
    const plan = saveDiff(emptyEditState(), { ...emptyEditState(), layoutEdits: { m: move } });
    expect(plan).toHaveLength(2);
    expect(new Set(plan.map((p) => `${p.map}:${p.key}`))).toEqual(new Set(['layoutEdits:m']));
  });
});

describe('the ordering rule', () => {
  const structural = (key: string, path: number[], op: 'insert' | 'remove'): PendingLayoutEdit =>
    op === 'remove'
      ? {
          key,
          op: 'remove',
          sceneId: 'home',
          anchor: anchor(path),
          label: key,
          scopeLabel: 'div',
          removedText: '<x/>',
          removedIndex: path[path.length - 1],
        }
      : {
          key,
          op: 'insert',
          sceneId: 'home',
          anchor: anchor(path.slice(0, -1)),
          label: key,
          scopeLabel: 'div',
          index: path[path.length - 1],
          raw: '<y/>',
        };

  const positions = (items: { intent: { parent?: { path: number[] }; anchor?: { path: number[] }; index?: number } }[]) =>
    items.map((p) =>
      p.intent.parent ? [...p.intent.parent.path, p.intent.index ?? 0] : p.intent.anchor!.path,
    );

  const layout = (edits: PendingLayoutEdit[]): EditState => ({
    ...emptyEditState(),
    layoutEdits: Object.fromEntries(edits.map((e) => [e.key, e])),
  });

  it('applies structural ops from the deepest position down', () => {
    // Descending: no applied op disturbs a position a pending op still needs.
    const plan = saveDiff(
      emptyEditState(),
      layout([structural('a', [0, 1], 'remove'), structural('b', [0, 3], 'remove'), structural('c', [0, 2], 'remove')]),
    );
    expect(positions(plan)).toEqual([[0, 3], [0, 2], [0, 1]]);
  });

  it('reverts them in the mirror order, ascending', () => {
    const plan = saveDiff(
      layout([structural('a', [0, 1], 'remove'), structural('b', [0, 3], 'remove')]),
      emptyEditState(),
    );
    expect(positions(plan)).toEqual([[0, 1], [0, 3]]);
  });

  it('is asymmetric on purpose: a forward remove@3 + insert@1 reverts low-to-high', () => {
    // Reverting this pair in descending order yields `[a, s, s, g, D]` from a
    // baseline `[a, s, g, s, D]` — the plan writes cleanly and leaves the file wrong.
    const edits = [structural('rm', [0, 3], 'remove'), structural('ins', [0, 1], 'insert')];
    expect(positions(saveDiff(emptyEditState(), layout(edits)))).toEqual([[0, 3], [0, 1]]);
    expect(positions(saveDiff(layout(edits), emptyEditState()))).toEqual([[0, 1], [0, 3]]);
  });

  it('drops a removal into the vacated slot when both target one position', () => {
    const plan = saveDiff(
      emptyEditState(),
      layout([structural('ins', [0, 2], 'insert'), structural('rm', [0, 2], 'remove')]),
    );
    expect(plan.map((p) => p.intent.kind)).toEqual(['layout-remove', 'layout-insert']);
    // The revert mirrors that too.
    const back = saveDiff(
      layout([structural('ins', [0, 2], 'insert'), structural('rm', [0, 2], 'remove')]),
      emptyEditState(),
    );
    expect(back.map((p) => p.intent.kind)).toEqual(['layout-insert', 'layout-remove']);
  });

  it('puts props edits ahead of every structural op, in both directions', () => {
    const propsEdit: PendingLayoutEdit = {
      key: 'p',
      op: 'props',
      sceneId: 'home',
      anchor: anchor([0, 9]),
      label: 'props',
      scopeLabel: 'div',
      sets: [{ name: 'id', from: 'a', to: 'b' }],
    };
    const plan = saveDiff(emptyEditState(), layout([structural('rm', [0, 1], 'remove'), propsEdit]));
    expect(plan.map((p) => p.intent.kind)).toEqual(['layout-props', 'layout-remove']);
  });

  it('keeps token intents out of the layout ordering', () => {
    // They are absolute point writes: order-independent, so they keep insertion order.
    const plan = saveDiff(emptyEditState(), {
      ...emptyEditState(),
      tokenEdits: { a: tokenEdit({ key: 'a' }), b: tokenEdit({ key: 'b', path: ['ring'] }) },
      layoutEdits: { rm: structural('rm', [0, 1], 'remove') },
    });
    expect(plan.map((p) => p.intent.kind)).toEqual(['token-value', 'token-value', 'layout-remove']);
  });
});

describe('editStateKey', () => {
  const state = (over: Partial<EditState> = {}): EditState => ({ ...emptyEditState(), ...over });

  it('is order-independent across the maps', () => {
    const a = state({ classEdits: { x: classEdit({ key: 'x' }), y: classEdit({ key: 'y' }) } });
    const b = state({ classEdits: { y: classEdit({ key: 'y' }), x: classEdit({ key: 'x' }) } });
    expect(editStateKey(a)).toBe(editStateKey(b));
  });

  it('ignores a moved path, so a commit does not leave the editor dirty', () => {
    const at = (path: number[]): EditState =>
      state({
        layoutEdits: {
          m: {
            key: 'm',
            op: 'props',
            sceneId: 'home',
            // Same node, same `fp` — only the coordinate hints move.
          anchor: anchor(path, { fp: 'fp-stable', fpx: `x${path.join('')}` }),
            label: 'l',
            scopeLabel: 'div',
          },
        },
      });
    // An insert renumbers every following sibling; the edit still MEANS the same
    // thing, so its identity must not move with it.
    expect(editStateKey(at([0, 1]))).toBe(editStateKey(at([0, 4])));
  });

  it('still notices a real change to a layout edit', () => {
    const withLabel = (label: string): EditState =>
      state({
        layoutEdits: {
          m: { key: 'm', op: 'props', sceneId: 'home', anchor: anchor([0]), label, scopeLabel: 'div' },
        },
      });
    expect(editStateKey(withLabel('a'))).not.toBe(editStateKey(withLabel('b')));
  });

  it('survives a snapshot written before a map existed', () => {
    // Runs on the render path, so a throw would white-screen the editor. Reading as
    // clean is the cost; it is not the fix, which is migrating the snapshot.
    const legacy = { classEdits: { a: classEdit() } } as unknown as EditState;
    expect(() => editStateKey(legacy)).not.toThrow();
    expect(editCount(state({ classEdits: { a: classEdit() } }))).toBe(1);
  });
});

describe('layoutEditKey', () => {
  it('separates two files that produce the same discriminator', () => {
    expect(layoutEditKey({ file: 'a.tsx' }, 'p|0.0')).not.toBe(layoutEditKey({ file: 'b.tsx' }, 'p|0.0'));
  });

  it('gives two scenes rendering one file the same entry', () => {
    // The edit is a change to one physical file; keying by scene would let the
    // second commit silently clobber the first with no conflict signal.
    expect(layoutEditKey({ file: 'a.tsx' }, 'p|0.0')).toBe(layoutEditKey({ file: 'a.tsx' }, 'p|0.0'));
  });
});
