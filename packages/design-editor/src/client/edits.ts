/**
 * The staged-edit model: what the editor has changed but has not written yet.
 *
 * Every panel stages into an `EditState`; `saveDiff` turns two of them into the
 * list of `MutateRequest`s that makes disk match the second. Nothing here talks
 * to the network — that is `bridge.ts` — and nothing renders, so the whole
 * module is plain data and pure functions.
 *
 * PORTED FROM `src/sandbox/edits.ts`, with four changes the shipped contract
 * forces and one it does not:
 *
 *   - the prototype declared six intent interfaces of its own. The wire type is
 *     the flat, `kind`-discriminated `MutateRequest`, and this imports it, so
 *     client and server cannot drift.
 *   - the prototype compiled in four `packages/core` paths and a `FAMILY` table
 *     of naming FUNCTIONS. Both are now server data (`TokenFamilyMeta`, from
 *     `GET /tokens`). This is the last open row of the local-plugin doc's §6.
 *   - `CSSProperties` is gone: this package does not depend on React, and a map
 *     of custom properties is `Record<string, string>` either way.
 *   - `VariantState` is declared here rather than imported from `registry.tsx`,
 *     which is consumer code.
 *
 * The one that is not forced: token intents no longer carry `file`, and DO carry
 * `family`. See `toTokenIntent`.
 */

import type { MutateRequest, NodeAnchor } from '../plugin/protocol.ts';
import type { ComponentMeta, ScaleBinding } from '../types.ts';
import type { TokenBinding, TokenFamily, TokenFamilyMeta } from '../tokens/adapter.ts';
// A VALUE import, and the only one in this file. `tokens/adapter.ts` is the
// contract half — no node imports, by its own rule — so the client may reach it.
// Re-deriving the rule is what the prototype did, and its copy carried a bug the
// contract had already fixed: `/[A-Z0-9]/` broke on every digit, so `gray100`
// became `gray-1-0-0`. A numeric scale is the most ordinary thing a shadcn
// project has.
import { camelToKebab } from '../tokens/adapter.ts';
import type { StateKey } from './states.ts';

/** A map of CSS custom properties for a preview wrapper's inline style. */
export type StyleVars = Record<string, string>;

/** A CVA axis selection: `{ variant: 'destructive', size: 'sm' }`. */
export type VariantState = Record<string, string>;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Modifiers owned by the interaction-state rows (see `states.ts`). */
const STATE_MODIFIERS = ['hover', 'active', 'focus-visible', 'disabled'] as const;

/**
 * Enumerate the class tokens in `classes` that use `utility-fromRole` at REST and
 * pair each with its `toRole` swap. This is what a colour rebind sends.
 *
 * Interaction-state tokens (`hover:bg-primary/90`) are deliberately excluded:
 * they have their own rows in the panel, and when both controls rewrote the same
 * token, two intents in one batch claimed the same span and the second failed to
 * locate. Non-state modifiers (`dark:`) stay — they are part of the resting value.
 */
export function computeColorReplacements(
  classes: string,
  utilities: string[],
  fromRole: string,
  toRole: string,
): { from: string; to: string }[] {
  const reps: { from: string; to: string }[] = [];
  for (const token of classes.split(/\s+/).filter(Boolean)) {
    const mods = token.split(':').slice(0, -1);
    if (mods.some((m) => (STATE_MODIFIERS as readonly string[]).includes(m))) continue;
    const bare = token.includes(':') ? token.slice(token.lastIndexOf(':') + 1) : token;
    for (const util of utilities) {
      if (new RegExp(`^${escapeRe(util)}-${escapeRe(fromRole)}(?:/\\d+)?$`).test(bare)) {
        const to = token.replace(
          new RegExp(`${escapeRe(util)}-${escapeRe(fromRole)}(?=/|$)`),
          `${util}-${toRole}`,
        );
        reps.push({ from: token, to });
        break;
      }
    }
  }
  return reps;
}

/** The class-token swap for a scale rebind (radius / spacing / font-size). */
export function computeScaleReplacement(
  binding: ScaleBinding,
  newValue: string,
): { from: string; to: string } {
  const { className, utility, category } = binding;
  const colon = className.lastIndexOf(':');
  const prefix = colon >= 0 ? className.slice(0, colon + 1) : '';
  const newBare = category === 'radius' && newValue === 'base' ? utility : `${utility}-${newValue}`;
  return { from: className, to: prefix + newBare };
}

/**
 * A staged component class rewrite. Scoped to one CVA value (or the base), per
 * the "active variant only" decision. `revealVariant` is the selection that makes
 * the change visible in a preview.
 */
export interface PendingClassEdit {
  key: string;
  componentName: string;
  /**
   * The component's source file, root-relative.
   *
   * Unlike the token kinds below, `class-rewrite` DOES address a file on the wire
   * — it names a JSX node's source, not a token, and the plugin resolves it
   * through the path guard. Keeping it is not the coupling §6 is about.
   */
  file: string;
  cvaName: string;
  axis?: string;
  /** `'__base__'` or a value name. */
  value: string;
  scopeLabel: string;
  property: string;
  fromLabel: string;
  toLabel: string;
  replacements: { from: string; to: string }[];
  /** Class tokens to append — how a state with no modifier yet is introduced. */
  additions?: string[];
  /** Class tokens to delete (inverse of `additions`). */
  removals?: string[];
  /** Set when this edit targets an interaction state, for labelling + preview. */
  state?: StateKey;
  revealVariant: VariantState;
}

export type TokenKind = 'color' | 'radius' | 'font';

/**
 * A staged global token value edit.
 *
 * NO `file`. The prototype carried one and the server has never read it: a value
 * edit is planned by the adapter, which derives the file from `family`. Carrying
 * a path that is ignored is how the client came to hold four `packages/core`
 * constants that no foreign project has.
 */
export interface PendingTokenEdit {
  key: string;
  /** The custom property's kebab name without `--`: `primary`, `font-body`. */
  cssVar: string;
  family: TokenFamily;
  /** The source const, where the pipeline has one: `light` | `dark` | `radius`. */
  constName: string;
  path: string[];
  label: string;
  kind: TokenKind;
  oldValue: string;
  newValue: string;
}

/** `primary-foreground` → `primaryForeground`. The inverse of `camelToKebab`. */
export const kebabToCamel = (s: string): string =>
  s.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());

export { camelToKebab };

// ---------------------------------------------------------------------------
// Family metadata — server data, not compiled-in constants.
//
// The prototype's `FAMILY_META` held each naming rule as a FUNCTION
// (`` cssVar: (k) => `--wb-${k}` ``), which is exactly why the table could not be
// server-supplied: a function does not cross the wire. `TokenFamilyMeta` encodes
// the same rules as PREFIXES, so these three helpers are the whole of what the
// client needs to know about naming.
// ---------------------------------------------------------------------------

/** The emitted custom property for a token: `--wb-mocha`. */
export const cssVarFor = (meta: TokenFamilyMeta, kebabKey: string): string =>
  `${meta.cssVarPrefix}${kebabKey}`;

/** The `@theme inline` alias that turns it into a utility: `--color-wb-mocha`. */
export const themeVarFor = (meta: TokenFamilyMeta, kebabKey: string): string =>
  `${meta.themeVarPrefix}${kebabKey}`;

/** An example utility the token unlocks: `bg-wb-mocha`. */
export const utilityFor = (meta: TokenFamilyMeta, kebabKey: string): string =>
  `${meta.utilityPrefix}${kebabKey}`;

/** The family's metadata, or null when the adapter does not carry that family. */
export const familyMetaOf = (
  families: TokenFamilyMeta[],
  family: TokenFamily,
): TokenFamilyMeta | null => families.find((f) => f.family === family) ?? null;

/** Normalize a user-entered token name to a safe kebab key (`Brand Accent`). */
export function normalizeTokenName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * A staged NEW token in any family. Writing it is a coordinated multi-file edit,
 * planned entirely by the adapter — which is why this carries no path either.
 */
export interface PendingTokenAdd {
  key: string;
  family: TokenFamily;
  /** e.g. `brand-accent`. */
  kebabKey: string;
  /** e.g. `brandAccent`. */
  camelKey: string;
  /** The property it will be emitted as, for the preview row: `--brand-accent`. */
  cssVar: string;
  value: string;
}

/**
 * Build a `PendingTokenAdd` from what the user typed, using server metadata.
 *
 * The name check MIRRORS the server's, deliberately: `tokenEditOf` refuses a key
 * that is not a plain identifier, and rejecting it here means the user is told
 * before a round trip rather than after. The server still re-checks — this is a
 * convenience, not the boundary.
 */
export function stageTokenAdd(
  families: TokenFamilyMeta[],
  family: TokenFamily,
  rawName: string,
  value?: string,
): PendingTokenAdd | { error: string } {
  const meta = familyMetaOf(families, family);
  if (!meta) return { error: `the token adapter carries no ${family} family` };
  const kebabKey = normalizeTokenName(rawName);
  if (!kebabKey) return { error: 'a token needs a name' };
  const camelKey = kebabToCamel(kebabKey);
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(camelKey)) {
    return { error: `invalid token name: ${rawName}` };
  }
  return {
    key: `${family}|${kebabKey}`,
    family,
    kebabKey,
    camelKey,
    cssVar: cssVarFor(meta, kebabKey),
    value: value ?? meta.defaultValue,
  };
}

/**
 * A staged rebind of a token to a reference (`primary: palette.butter`), keeping
 * it bound rather than freezing today's value into a literal. `previewValue` is
 * the reference's current colour, for recolouring the preview before the write.
 */
export interface PendingTokenRebind {
  key: string;
  cssVar: string;
  family: TokenFamily;
  constName: 'light' | 'dark';
  /** `[camelKey]`. */
  path: string[];
  label: string;
  /** `palette.syrup`, or a descriptor when the old value was a literal. */
  fromRef: string;
  toRef: string;
  previewValue: string;
  /**
   * What the binding WAS, copied from `TokenBinding.kind` at staging time.
   *
   * The prototype inferred this by testing `fromRef.startsWith('palette.')`, which
   * is a wafflebase-ism: a foreign project's reference layer is named whatever its
   * author named it, and the prefix test would silently classify every one of them
   * as a literal. The contract already answers the question — a rebind is offered
   * from a binding the client read — so this carries the answer rather than
   * guessing it back out of a string.
   */
  fromKind: TokenBinding['kind'];
  /**
   * The value BEFORE the rebind. Required when `fromKind` is `'literal'`: that is
   * the only way to undo, since a `token-rebind` cannot write a literal and the
   * revert has to fall back to a `token-value`. See `revertRebindIntent`.
   */
  fromValue?: string;
}

/**
 * A staged edit to a palette colour leaf. Cascades to every token bound to it.
 *
 * No `family` field: `palette-value` is the one kind whose family the server
 * fixes from the kind itself, so sending one would be inert.
 */
export interface PendingPaletteEdit {
  key: string;
  /** `palette.syrup` — what a binding names it. */
  ref: string;
  path: string[];
  label: string;
  oldValue: string;
  /** Hex. */
  newValue: string;
}

/** Seed a variant selection from a component's CVA defaults. */
export function defaultVariantState(component: ComponentMeta): VariantState {
  const state: VariantState = {};
  if (!component.cva) return state;
  for (const [axis, values] of Object.entries(component.cva.axes)) {
    state[axis] = component.cva.defaults[axis] ?? Object.keys(values)[0];
  }
  return state;
}

/** Does a class edit apply to the component rendered at `active`? */
export function classEditApplies(edit: PendingClassEdit, active: VariantState): boolean {
  if (edit.value === '__base__') return true;
  return !!edit.axis && active[edit.axis] === edit.value;
}

/**
 * Override className for a live preview: the `to` tokens of every applicable
 * class edit. Passed through the component's own `cn()`, these win over the
 * variant's original classes (twMerge keeps the last), so the preview reflects
 * the pending rewrite without touching source.
 */
export function overrideClassName(
  componentName: string,
  active: VariantState,
  edits: PendingClassEdit[],
): string {
  const tokens: string[] = [];
  for (const e of edits) {
    if (e.componentName !== componentName) continue;
    if (!classEditApplies(e, active)) continue;
    for (const r of e.replacements) tokens.push(r.to);
    for (const t of e.additions ?? []) tokens.push(t);
  }
  return tokens.join(' ');
}

/** Apply a scope's staged class edits to its authored class string. */
export function applyClassEdits(classes: string, edits: PendingClassEdit[]): string {
  let tokens = classes.split(/\s+/).filter(Boolean);
  for (const e of edits) {
    for (const r of e.replacements) tokens = tokens.map((t) => (t === r.from ? r.to : t));
    for (const t of e.removals ?? []) tokens = tokens.filter((x) => x !== t);
    for (const t of e.additions ?? []) if (!tokens.includes(t)) tokens.push(t);
  }
  return tokens.join(' ');
}

/**
 * The full class string the preview currently renders with: the CVA base plus
 * every active variant value, with staged edits folded in. The interaction-state
 * simulator needs this to find the modifiers — including ones just staged — in
 * order to force them on.
 */
export function appliedClasses(
  component: ComponentMeta,
  active: VariantState,
  edits: PendingClassEdit[],
): string {
  const cva = component.cva;
  if (!cva) return '';
  const mine = edits.filter((e) => e.componentName === component.name);
  const scopes: { axis?: string; value: string; classes: string }[] = [
    { value: '__base__', classes: cva.base.classes },
  ];
  for (const [axis, values] of Object.entries(cva.axes)) {
    const selected = active[axis];
    if (selected && values[selected]) {
      scopes.push({ axis, value: selected, classes: values[selected].classes });
    }
  }
  return scopes
    .map((s) =>
      applyClassEdits(
        s.classes,
        mine.filter((e) => e.value === s.value && (s.value === '__base__' || e.axis === s.axis)),
      ),
    )
    .join(' ');
}

/**
 * CSS-variable overrides for a preview wrapper from pending token edits.
 *
 * Colour tokens are theme-scoped: a `light` edit must ONLY preview in light mode
 * and a `dark` edit ONLY in dark, or a dark edit leaks into the light preview
 * (both write `--primary`, last wins). Scale and typography tokens are
 * theme-agnostic and always apply. Omit `theme` to apply everything.
 */
export function tokenOverrideStyle(
  edits: PendingTokenEdit[],
  theme?: 'light' | 'dark',
): StyleVars {
  const style: StyleVars = {};
  for (const e of edits) {
    const themed = e.constName === 'light' || e.constName === 'dark';
    if (theme && themed && e.constName !== theme) continue;
    style[`--${e.cssVar}`] = e.newValue;
  }
  return style;
}

/** Component names a token edit affects (drives the review modal's `< >`). */
export function affectedByToken(edit: PendingTokenEdit, all: ComponentMeta[]): string[] {
  if (edit.kind === 'color') {
    return all.filter((c) => c.tokensUsed.includes(edit.cssVar)).map((c) => c.name);
  }
  const category = edit.kind === 'radius' ? 'radius' : 'fontSize';
  const withCategory = all.filter((c) => c.scaleBindings.some((b) => b.category === category));
  return (withCategory.length ? withCategory : all).map((c) => c.name);
}

// ---------------------------------------------------------------------------
// Staged edit → wire intent.
// ---------------------------------------------------------------------------

export function toClassIntent(edit: PendingClassEdit): MutateRequest {
  return {
    kind: 'class-rewrite',
    file: edit.file,
    cvaName: edit.cvaName,
    axis: edit.value === '__base__' ? undefined : edit.axis,
    value: edit.value,
    replacements: edit.replacements,
    additions: edit.additions,
    removals: edit.removals,
  };
}

/**
 * `family`, not `file` — and this is a fix, not a rename.
 *
 * The prototype sent the source path and no family. `tokenEditOf` reads neither
 * `file` nor `constName` to choose a family; it defaults a missing one to
 * `semantic`, and the adapter derives the file from THAT. So a radius or
 * typography value edit was planned against the semantic source. Measured on
 * wafflebase's own adapter, both families:
 *
 *   radius     → semantic.ts [light.lg]   located=false  property lg not found
 *   typography → semantic.ts [light.body] located=false  property body not found
 *
 * It fails to locate rather than corrupting the wrong file, so nothing was ever
 * written to the wrong place — but neither family could save at all, and the
 * error names the right key in the wrong file, which is the least debuggable
 * shape that failure could have taken.
 */
export function toTokenIntent(edit: PendingTokenEdit): MutateRequest {
  return {
    kind: 'token-value',
    family: edit.family,
    constName: edit.constName,
    path: edit.path,
    tokenValue: edit.newValue,
  };
}

export function toMemberAddIntent(add: PendingTokenAdd): MutateRequest {
  return {
    kind: 'member-add',
    family: add.family,
    camelKey: add.camelKey,
    kebabKey: add.kebabKey,
    tokenValue: add.value,
  };
}

export function toTokenRebindIntent(e: PendingTokenRebind): MutateRequest {
  return {
    kind: 'token-rebind',
    family: e.family,
    constName: e.constName,
    path: e.path,
    tokenValue: e.toRef,
  };
}

export function toPaletteIntent(e: PendingPaletteEdit): MutateRequest {
  return { kind: 'palette-value', path: e.path, tokenValue: e.newValue };
}

// ---------------------------------------------------------------------------
// Inverse intents — what it takes to UNDO an edit that is already on disk.
//
// Every intent is an ABSOLUTE write ("set X to V"), never a delta. That is what
// makes the AST edits idempotent, but it also means a save cannot express
// "forget the edit I made last time" — writing the remaining edits again leaves
// the dropped one in the file. So when history moves back past a save, each edit
// that disappeared is written back from the `old*` value it captured at staging
// time. See `saveDiff`.
// ---------------------------------------------------------------------------

const revertClassIntent = (e: PendingClassEdit): MutateRequest => ({
  kind: 'class-rewrite',
  file: e.file,
  cvaName: e.cvaName,
  axis: e.value === '__base__' ? undefined : e.axis,
  value: e.value,
  // Swap the direction, and un-add / re-add the introduced tokens.
  replacements: e.replacements.map((r) => ({ from: r.to, to: r.from })),
  additions: e.removals,
  removals: e.additions,
});

const revertTokenIntent = (e: PendingTokenEdit): MutateRequest => ({
  kind: 'token-value',
  family: e.family,
  constName: e.constName,
  path: e.path,
  tokenValue: e.oldValue,
});

const revertPaletteIntent = (e: PendingPaletteEdit): MutateRequest => ({
  kind: 'palette-value',
  path: e.path,
  tokenValue: e.oldValue,
});

const revertAddIntent = (a: PendingTokenAdd): MutateRequest => ({
  kind: 'member-remove',
  family: a.family,
  camelKey: a.camelKey,
  kebabKey: a.kebabKey,
});

/**
 * Undo a rebind. If the token was reference-bound before, rebind it back; if it
 * was a raw literal, restore that literal instead — `token-rebind` only writes
 * expressions.
 *
 * `expression` takes the literal branch too. A locked expression is not
 * rebindable (that is what `expression` MEANS in the contract), so writing
 * `fromRef` back through `token-rebind` would put the expression's own text in a
 * position that expects a reference.
 */
const revertRebindIntent = (e: PendingTokenRebind): MutateRequest =>
  e.fromKind === 'ref'
    ? {
        kind: 'token-rebind',
        family: e.family,
        constName: e.constName,
        path: e.path,
        tokenValue: e.fromRef,
      }
    : {
        kind: 'token-value',
        family: e.family,
        constName: e.constName,
        path: e.path,
        tokenValue: e.fromValue,
      };

// ---------------------------------------------------------------------------
// Layout edits — staged tree mutations on a scene file.
// ---------------------------------------------------------------------------

/**
 * A staged layout edit.
 *
 * Every field capturing a "from" side exists for the reason `oldValue` does on a
 * token edit: intents are ABSOLUTE writes, so a revert has to be told what to
 * write back. For a removal that "from" side is `removedText` — the exact span
 * the injector spliced out, which is what makes an undo-past-save byte-identical
 * rather than merely equivalent.
 *
 * INVARIANT: a node created THIS SESSION has no baseline anchor, so props edits
 * and nested inserts on it mutate the parent insert's `raw` payload instead of
 * becoming their own edits. So no intent ever references a node absent from disk,
 * and there is no ordering relationship between an insert and edits to what it
 * created.
 *
 * INVARIANT: an insert may not target a subtree another staged op removes (the
 * same guard as "cannot move a node into itself"), or the insert is silently moot
 * and its inverse cannot locate.
 */
export interface PendingLayoutEdit {
  /** Keyed on `fp`, never on `path` — a rebase must not rekey the edit. */
  key: string;
  op: 'props' | 'insert' | 'remove' | 'move';
  sceneId: string;
  /** For `insert` / `move` this is the PARENT anchor. */
  anchor: NodeAnchor;
  label: string;
  scopeLabel: string;

  // props
  sets?: {
    name: string;
    from: string | null;
    to: string | null;
    valueKind?: 'string' | 'expression';
  }[];
  classOps?: {
    replacements?: { from: string; to: string }[];
    additions?: string[];
    removals?: string[];
  };
  textFrom?: string | null;
  textTo?: string | null;

  // insert
  index?: number;
  raw?: string;
  /**
   * The fingerprint the inserted root will have.
   *
   * Never sent: `MutateRequest` has no `fp` field on an insert, and the plugin
   * does not read one. It is kept because the INVERSE needs it — a `layout-remove`
   * anchored on the node the insert created has nothing else to identify it by.
   */
  insertedFp?: string;
  insertedTag?: string;
  imports?: { module: string; named?: string[]; default?: string }[];

  // remove — the inverse payload, captured from the dry run
  removedText?: string;
  removedIndex?: number;
  removedFp?: string;
  removedTag?: string;

  // move — translated to a remove + insert pair sharing a groupId
  toParent?: NodeAnchor;
  toIndex?: number;
}

/**
 * A `move` is not a fourth intent kind: it becomes a `layout-remove` +
 * `layout-insert(verbatim)` sharing a `groupId`, so it reuses both inverses and
 * obeys the ordering rule unchanged. The group is what stops a half-applied move
 * from deleting a node and dropping it.
 */
const layoutGroup = (e: PendingLayoutEdit) => (e.op === 'move' ? `move:${e.key}` : undefined);

export function toLayoutIntents(e: PendingLayoutEdit): MutateRequest[] {
  const groupId = layoutGroup(e);
  switch (e.op) {
    case 'props':
      return [
        {
          kind: 'layout-props',
          anchor: e.anchor,
          sets: e.sets?.map((s) => ({ name: s.name, value: s.to, valueKind: s.valueKind })),
          classOps: e.classOps,
          text: e.textTo,
        },
      ];
    case 'insert':
      return [
        {
          kind: 'layout-insert',
          parent: e.anchor,
          index: e.index ?? 0,
          raw: e.raw ?? '',
          imports: e.imports,
        },
      ];
    case 'remove':
      return [{ kind: 'layout-remove', anchor: e.anchor, imports: e.imports }];
    case 'move':
      return [
        { kind: 'layout-remove', anchor: e.anchor, groupId },
        {
          kind: 'layout-insert',
          parent: e.toParent!,
          index: e.toIndex ?? 0,
          raw: e.removedText ?? '',
          verbatim: true,
          groupId,
        },
      ];
  }
}

/**
 * The inverse of a layout edit.
 *
 * `props` swaps every captured direction. `insert` becomes a remove anchored on
 * the fingerprint the insert declared its root would have. `remove` becomes an
 * insert of the captured span with `verbatim: true`, which is what makes the
 * round trip byte-identical rather than merely equivalent.
 */
export function revertLayoutIntents(e: PendingLayoutEdit): MutateRequest[] {
  const groupId = layoutGroup(e);
  const insertedAnchor = (): NodeAnchor => ({
    ...e.anchor,
    // The inserted node lives at parentPath + index; its own fp is what the insert
    // declared. Path is a hint, so an approximate one is fine — the fp carries the
    // identity.
    path: [...e.anchor.path, e.index ?? 0],
    tag: e.insertedTag ?? e.anchor.tag,
    fp: e.insertedFp ?? '',
    fpx: undefined,
  });
  switch (e.op) {
    case 'props':
      return [
        {
          kind: 'layout-props',
          anchor: e.anchor,
          sets: e.sets?.map((s) => ({ name: s.name, value: s.from, valueKind: s.valueKind })),
          classOps: e.classOps && {
            replacements: (e.classOps.replacements ?? []).map((r) => ({ from: r.to, to: r.from })),
            additions: e.classOps.removals,
            removals: e.classOps.additions,
          },
          text: e.textFrom,
        },
      ];
    case 'insert':
      return [{ kind: 'layout-remove', anchor: insertedAnchor(), imports: e.imports }];
    case 'remove':
      return [
        {
          kind: 'layout-insert',
          parent: { ...e.anchor, path: e.anchor.path.slice(0, -1) },
          index: e.removedIndex ?? 0,
          raw: e.removedText ?? '',
          verbatim: true,
          imports: e.imports,
        },
      ];
    case 'move':
      return [
        {
          kind: 'layout-remove',
          anchor: {
            ...e.toParent!,
            path: [...e.toParent!.path, e.toIndex ?? 0],
            fp: e.removedFp ?? '',
            fpx: undefined,
          },
          groupId,
        },
        {
          kind: 'layout-insert',
          parent: { ...e.anchor, path: e.anchor.path.slice(0, -1) },
          index: e.removedIndex ?? 0,
          raw: e.removedText ?? '',
          verbatim: true,
          groupId,
        },
      ];
  }
}

/** The tree position a layout intent targets, for the ordering rule. */
function targetPosition(intent: MutateRequest): number[] | null {
  if (intent.kind === 'layout-insert') {
    return intent.parent ? [...intent.parent.path, intent.index ?? 0] : null;
  }
  if (intent.kind === 'layout-remove') return intent.anchor?.path ?? null;
  return null;
}

/** Lexicographic path compare; on a common prefix, LONGER is greater (deeper). */
function comparePath(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

/**
 * THE ORDERING RULE.
 *
 * All layout paths and indices are in the BASELINE frame (what is on disk, what
 * the scene metadata describes). An op at child index *i* shifts every index
 * `> i`, so a batch of them only round-trips if it is ordered:
 *
 *   apply  → `layout-props` first (they cannot shift or be shifted), then
 *            structural DESCENDING by target position. Handling the highest
 *            position first means no applied op disturbs a position a pending op
 *            still needs.
 *   revert → props first, then structural ASCENDING — the MIRROR of the forward
 *            pass, because a revert group must undo it in exact reverse order.
 *
 * The asymmetry is the whole point and it is load-bearing. Getting it backwards
 * produces a plan that looks right, writes cleanly, and leaves the file subtly
 * wrong: with a baseline child list `[a, s, g, s, D]`, a forward
 * `remove@3 + insert@1` reverted in descending order yields `[a, s, s, g, D]`.
 *
 * At an equal position, `remove` precedes `insert` on apply (so a replace drops
 * the new node into the vacated slot) and `insert` precedes `remove` on revert.
 */
function orderLayoutItems(items: PlanItem[], mode: 'apply' | 'revert'): PlanItem[] {
  const props = items.filter((p) => p.intent.kind === 'layout-props');
  const structural = items.filter((p) => p.intent.kind !== 'layout-props');
  const dir = mode === 'apply' ? -1 : 1;
  structural.sort((x, y) => {
    const px = targetPosition(x.intent);
    const py = targetPosition(y.intent);
    if (!px || !py) return 0;
    const c = comparePath(px, py);
    if (c !== 0) return dir * c;
    // Equal position: apply removes-then-inserts, revert inserts-then-removes.
    const rank = (k: string | undefined) => (k === 'layout-remove' ? 0 : 1);
    return (rank(x.intent.kind) - rank(y.intent.kind)) * (mode === 'apply' ? 1 : -1);
  });
  return [...props, ...structural];
}

// ---------------------------------------------------------------------------
// The staged state, and the plan that writes it.
// ---------------------------------------------------------------------------

/** Everything the editor has staged, as one immutable snapshot. */
export interface EditState {
  classEdits: Record<string, PendingClassEdit>;
  tokenEdits: Record<string, PendingTokenEdit>;
  tokenAdds: Record<string, PendingTokenAdd>;
  rebinds: Record<string, PendingTokenRebind>;
  paletteEdits: Record<string, PendingPaletteEdit>;
  layoutEdits: Record<string, PendingLayoutEdit>;
}

export const emptyEditState = (): EditState => ({
  classEdits: {},
  tokenEdits: {},
  tokenAdds: {},
  rebinds: {},
  paletteEdits: {},
  layoutEdits: {},
});

export const editCount = (s: EditState): number =>
  Object.keys(s.classEdits).length +
  Object.keys(s.tokenEdits).length +
  Object.keys(s.tokenAdds).length +
  Object.keys(s.rebinds).length +
  Object.keys(s.paletteEdits).length +
  Object.keys(s.layoutEdits).length;

/**
 * Coordinate hints that are NOT part of an edit's identity.
 *
 * `anchor.path` legitimately changes when metadata is regenerated after our own
 * write — an insert renumbers every following sibling. If it were part of the
 * key, EVERY COMMIT WOULD LEAVE THE EDITOR SPURIOUSLY DIRTY and the next save
 * would emit a no-op plan that looks like real work. The rule generalises: an
 * edit's identity is what it MEANS, never where it currently happens to live.
 *
 * Applied to ALL SIX maps, not only `layoutEdits`. Only `layoutEdits` has a
 * `path` / `fpx` field today, so stripping the other five is currently a no-op —
 * but a no-op is exactly what makes it safe to apply everywhere. Scoping the
 * strip to one map was a live trap: any future field merely NAMED `path` or
 * `fpx` on another map would silently vanish from its own dirty check the moment
 * it was added, and the bug would not surface until that field's first real edit
 * failed to mark the editor dirty.
 */
const HINT_KEYS = new Set(['path', 'fpx']);

/** Order-independent structural key for an `EditState` (drives the dirty flag). */
export function editStateKey(s: EditState): string {
  const stripHints = (v: unknown) =>
    JSON.stringify(v, (k, val) => (HINT_KEYS.has(k) ? undefined : val));
  const stable = (v: unknown) => JSON.stringify(v);
  // `m ?? {}` is a BACKSTOP, not a fix — the fix is migrating a persisted snapshot
  // written before a map existed. This guard is here because `editStateKey` runs on
  // the RENDER path (it computes `dirty`), so a throw takes the whole editor down
  // with a white screen rather than degrading one panel, and a missing map is worth
  // surviving at the cost of reading as clean.
  const part = (m: Record<string, unknown> | undefined, stringify: (v: unknown) => string) => {
    const map = m ?? {};
    return Object.keys(map)
      .sort()
      .map((k) => `${k}=${stringify(map[k])}`)
      .join('|');
  };
  return [
    part(s.classEdits, stable),
    part(s.tokenEdits, stable),
    part(s.tokenAdds, stable),
    part(s.rebinds, stable),
    part(s.paletteEdits, stable),
    part(s.layoutEdits, stripHints),
  ].join('§');
}

/**
 * The one place a `PendingLayoutEdit`'s map key gets built, so every caller agrees
 * on what makes an edit unique.
 *
 * Folds in `anchor.file`, deliberately NOT `sceneId`. Two scenes that both render
 * the same drilled-into file editing the "same" node must land on the SAME entry:
 * the edit is a change to one physical file, and keying by scene would let two
 * scenes stage two independently-committable edits to one node, whichever
 * committed second silently clobbering the first with no conflict signal. Without
 * `file` in the key, though, two DIFFERENT files that happen to produce the same
 * `discriminator` collide in the flat `layoutEdits` map. `discriminator` stays
 * caller-supplied because only the caller knows which of `op`'s shapes it is
 * keying — `move`'s two-intent pair sharing one key is exactly that.
 */
export function layoutEditKey(anchor: { file: string }, discriminator: string): string {
  return `${anchor.file}::${discriminator}`;
}

/** Which `EditState` map an edit lives in, plus its key — enough to drop it. */
export interface EditRef {
  map: keyof EditState;
  key: string;
}

/** One planned file mutation, with the reason it is in the plan. */
export interface PlanItem extends EditRef {
  intent: MutateRequest;
  label: string;
  /** `revert` items exist because history moved back past the last save. */
  mode: 'apply' | 'revert';
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The write plan for "Save to Code": what has to change on disk to make it match
 * `target`, given that `baseline` is what the last save wrote.
 *
 *   - in target, new or changed      → apply
 *   - in baseline, gone from target  → revert (restore the captured old value)
 *   - identical in both              → nothing (already on disk)
 *
 * This is what makes undo-past-a-save actually revert the file rather than
 * silently leaving the last write in place.
 */
export function saveDiff(baseline: EditState, target: EditState): PlanItem[] {
  const plan: PlanItem[] = [];

  const walk = <T>(
    map: keyof EditState,
    base: Record<string, T>,
    next: Record<string, T>,
    apply: (e: T) => MutateRequest | MutateRequest[],
    revert: (e: T) => MutateRequest | MutateRequest[],
    label: (e: T) => string,
  ) => {
    const push = (
      key: string,
      intents: MutateRequest | MutateRequest[],
      text: string,
      mode: 'apply' | 'revert',
    ) => {
      // One staged edit can yield more than one intent (a `move` is a remove +
      // insert pair). Several `PlanItem`s sharing one `(map, key)` is fine: a
      // discard takes refs, so a per-item discard still clears the edit.
      for (const intent of Array.isArray(intents) ? intents : [intents]) {
        plan.push({ map, key, intent, label: text, mode });
      }
    };
    for (const [key, edit] of Object.entries(next)) {
      if (key in base && same(base[key], edit)) continue;
      push(key, apply(edit), label(edit), 'apply');
    }
    for (const [key, edit] of Object.entries(base)) {
      if (key in next) continue;
      push(key, revert(edit), `revert ${label(edit)}`, 'revert');
    }
  };

  walk(
    'classEdits',
    baseline.classEdits,
    target.classEdits,
    toClassIntent,
    revertClassIntent,
    (e) => `${e.componentName}: ${e.property}${e.state ? ` · ${e.state}` : ''}`,
  );
  walk(
    'tokenEdits',
    baseline.tokenEdits,
    target.tokenEdits,
    toTokenIntent,
    revertTokenIntent,
    (e) => `${e.label} (--${e.cssVar})`,
  );
  walk(
    'tokenAdds',
    baseline.tokenAdds,
    target.tokenAdds,
    toMemberAddIntent,
    revertAddIntent,
    (a) => a.cssVar,
  );
  walk(
    'rebinds',
    baseline.rebinds,
    target.rebinds,
    toTokenRebindIntent,
    revertRebindIntent,
    (e) => `--${e.cssVar} → ${e.toRef}`,
  );
  walk(
    'paletteEdits',
    baseline.paletteEdits,
    target.paletteEdits,
    toPaletteIntent,
    revertPaletteIntent,
    (e) => `palette.${e.path.join('.')}`,
  );
  walk(
    'layoutEdits',
    baseline.layoutEdits,
    target.layoutEdits,
    toLayoutIntents,
    revertLayoutIntents,
    (e) => e.label,
  );

  // Reverts first: undoing a token creation before re-applying edits that may
  // reference it keeps a single batch internally consistent. Reverts also fully
  // restore the baseline frame before any apply runs, which is what lets an
  // apply's baseline-indexed positions mean what they say.
  //
  // Within each group, layout intents obey the ordering rule; non-layout intents
  // are absolute point writes and are order-independent, so they keep insertion
  // order.
  const group = (mode: 'apply' | 'revert') => {
    const items = plan.filter((p) => p.mode === mode);
    const isLayout = (p: PlanItem) => (p.intent.kind ?? '').startsWith('layout-');
    return [...items.filter((p) => !isLayout(p)), ...orderLayoutItems(items.filter(isLayout), mode)];
  };
  return [...group('revert'), ...group('apply')];
}

/**
 * The full live-preview CSS-variable overrides for the active theme, folding the
 * three colour-edit kinds together so the preview shows the true cascade before
 * anything is written:
 *
 *   1. literal token edits → override `--<cssVar>` (theme-isolated).
 *   2. rebinds             → override `--<cssVar>` = the reference's colour.
 *   3. palette-value edits → override EVERY token currently bound to that
 *                            reference (the cascade).
 *
 * Non-colour literal edits are theme-agnostic and always apply. `bindings` is the
 * active theme's map from `GET /tokens`; when absent (bridge down), step 3 is
 * skipped rather than guessed.
 */
export function tokenPreviewStyle(args: {
  theme: 'light' | 'dark';
  literalEdits: PendingTokenEdit[];
  rebinds: PendingTokenRebind[];
  paletteEdits: PendingPaletteEdit[];
  bindings?: Record<string, TokenBinding>;
}): StyleVars {
  const { theme, literalEdits, rebinds, paletteEdits, bindings } = args;
  const style: StyleVars = {};

  // 1. Literal edits (the same theme-isolation rule as `tokenOverrideStyle`).
  for (const e of literalEdits) {
    const themed = e.constName === 'light' || e.constName === 'dark';
    if (themed && e.constName !== theme) continue;
    style[`--${e.cssVar}`] = e.newValue;
  }

  // 2. Rebinds — only the active theme's.
  for (const r of rebinds) {
    if (r.constName !== theme) continue;
    style[`--${r.cssVar}`] = r.previewValue;
  }

  // 3. Palette-value edits cascade to every token bound to that reference.
  //
  // `kind: 'ref'`, not the prototype's `'palette'`. The shipped contract splits
  // non-literals in three, and the third — `expression`, where a reference is an
  // INGREDIENT (`` `rgba(${palette.butterRgb}, 0.30)` ``) — must NOT cascade: its
  // token is not that colour, and overriding it with the raw hex would preview an
  // opaque swatch where the app renders 30% alpha.
  if (bindings) {
    for (const p of paletteEdits) {
      for (const [camelKey, b] of Object.entries(bindings)) {
        if (b.kind === 'ref' && b.value === p.ref) {
          style[`--${camelToKebab(camelKey)}`] = p.newValue;
        }
      }
    }
  }
  return style;
}
