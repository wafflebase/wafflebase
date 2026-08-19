import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Palette, Ruler, Type, RotateCcw, Search, X, Trash2, Link2, Unlink, Layers, TriangleAlert } from 'lucide-react';
import { cn } from '../lib/cn.ts';
import {
  camelToKebab,
  cssVarFor,
  familyMetaOf,
  themeVarFor,
  utilityFor,
  kebabToCamel,
  type PendingPaletteEdit,
  type PendingTokenAdd,
  type PendingTokenEdit,
  type PendingTokenRebind,
  type TokenKind,
} from '../../client/edits.ts';
import type { TokensResult } from '../../client/bridge.ts';
import type {
  TokenBinding,
  TokenFamily,
  TokenFamilyMeta,
  TokenRef,
} from '../../tokens/adapter.ts';
import { AccordionSection } from './Accordion.tsx';
import { AddTokenButton, AddTokenDraft } from './AddTokenRow.tsx';
import { Combobox, type ComboboxOption } from './Combobox.tsx';

/*
 * The three hardcoded `packages/core/src/tokens/*.ts` paths that stood here are gone —
 * §6's last coupling. The file a value edit lands in is `TokenFamilyMeta.file`, reported by
 * the adapter, and it never has to reach the client at all: `toTokenIntent` sends `family`,
 * and the server derives the path from it.
 */

// Core UI colour roles, in the order a designer thinks about them. Any semantic
// token that exists in source but isn't listed here (chart/sidebar roles, and
// anything the sandbox itself created) is appended after these.
const CURATED_ROLES = [
  'background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground',
  'primary', 'primary-foreground', 'secondary', 'secondary-foreground', 'muted', 'muted-foreground',
  'accent', 'accent-foreground', 'destructive', 'border', 'input', 'ring',
];

// Fallback catalogs used only when the bridge is unreachable, so the editor still
// renders something coherent instead of an empty panel.
const OFFLINE_RADIUS = ['base'];
const OFFLINE_FONTS = ['display', 'body', 'code'];

interface TokenSpec {
  /** The custom property's kebab name WITHOUT `--`, for display and keying. */
  cssVar: string;
  family: TokenFamily;
  constName: string;
  path: string[];
  label: string;
  kind: TokenKind;
  /** The `@theme inline` alias that makes this token a utility class. */
  themeVar: string;
}

/**
 * Names derived from the ADAPTER's prefixes, not from a per-family literal.
 *
 * `cssVar` is display and keying only — `toTokenIntent` sends `family`/`constName`/`path`,
 * so a name here can never address the wrong variable on disk. That bound is what makes
 * the generic derivation safe to prefer over the prototype's hand-written cases.
 *
 * KNOWN INACCURACY, and it is a label: wafflebase's emitter writes `radius.base` as the
 * bare `--radius`, which a pure prefix cannot express, so this shows `--radius-base`. The
 * prototype special-cased it; doing that here would put a consumer's emission rule back
 * inside the panel. Recorded as a finding against `core-adapter.ts` instead.
 */
const bareVar = (meta: TokenFamilyMeta, key: string) => cssVarFor(meta, key).replace(/^--/, '');

const colorSpec = (meta: TokenFamilyMeta, role: string, themeConst: 'light' | 'dark'): TokenSpec => ({
  cssVar: bareVar(meta, role),
  family: meta.family,
  constName: themeConst,
  path: [kebabToCamel(role)],
  label: role,
  kind: 'color',
  themeVar: themeVarFor(meta, role),
});

const radiusSpec = (meta: TokenFamilyMeta, key: string): TokenSpec => ({
  cssVar: bareVar(meta, key),
  family: meta.family,
  constName: 'radius',
  path: [key],
  label: key === 'base' ? 'Base radius' : key,
  kind: 'radius',
  themeVar: themeVarFor(meta, key),
});

const fontSpec = (meta: TokenFamilyMeta, key: string): TokenSpec => ({
  cssVar: bareVar(meta, key),
  family: meta.family,
  constName: 'typography',
  path: [key],
  label: `${key} font`,
  kind: 'font',
  themeVar: themeVarFor(meta, key),
});

interface TokenEditorPanelProps {
  /** Current sandbox theme → selects the `light`/`dark` const in semantic.ts. */
  dark: boolean;
  tokenEdits: Record<string, PendingTokenEdit>;
  onTokenEdit: (key: string, edit: PendingTokenEdit | null) => void;
  tokenAdds: Record<string, PendingTokenAdd>;
  onTokenAdd: (key: string, add: PendingTokenAdd | null) => void;
  /** Palette rebinds (semantic → palette.*), keyed `${theme}|rebind|${camelKey}`. */
  rebinds: Record<string, PendingTokenRebind>;
  onRebind: (key: string, edit: PendingTokenRebind | null) => void;
  /** Palette-value edits (palette.ts leaf), keyed `palette|${path}`. */
  paletteEdits: Record<string, PendingPaletteEdit>;
  onPaletteEdit: (key: string, edit: PendingPaletteEdit | null) => void;
  /**
   * `GET /tokens` — binding forms, reference layer, family metadata (null = bridge down,
   * or an adapter that reports `adapter: null`).
   *
   * Replaces the prototype's `Introspection`, whose four fields were wafflebase's own
   * pipeline in the type system: `bindings.{light,dark}` → `bindings.themed`,
   * `colors: PaletteColor[]` → `bindings.refs: TokenRef[]` (same fields, renamed because
   * a reference layer need not be a palette), `scales.{radius,typography}` →
   * `bindings.leaves.{radius,typo}`, and `themeMappings` → `utilities`.
   */
  tokens: TokensResult | null;
}

/**
 * Token Editor — edits the GLOBAL token registry.
 *
 * DEFAULT VALUES COME FROM SOURCE. Every row's "current value" is read from the
 * introspected `.ts` sources (semantic bindings, palette leaves, radius and
 * typography consts), NOT from `getComputedStyle`. The computed value is only a
 * fallback for `computed` bindings and for bridge-offline mode.
 *
 * This is the fix for the stale-default bug: the old panel snapshotted computed
 * CSS variables once per theme switch, so after a write the row still compared
 * against the pre-write value — a saved value looked like an unsaved edit, and
 * re-typing the previous value looked clean. Introspection is refetched after
 * every commit/undo/redo, so the newly written value simply *is* the new default.
 */
/**
 * Every top-level palette member, kebab-normalised, for the draft's duplicate check.
 *
 * TWO ways a duplicate used to slip through. `path[0]` is the authored member
 * (`syrupDeep`) while a draft key is kebab (`syrup-deep`), so a raw comparison never
 * matched; and the panel checked only `isColor` refs, which is the REBIND PICKER's display
 * filter — a name collides with a sibling whatever its type, so `syrupRgb` was accepted
 * here and refused by the server.
 *
 * Exported because it is the whole of the rule, and testing it through the rendered draft
 * would test the section-opening UI instead.
 */
export function paletteCollisionKeys(refs: TokenRef[] | undefined): string[] {
  return (refs ?? []).map((r) => r.path[0]).filter(Boolean).map(camelToKebab);
}

export function TokenEditorPanel({
  dark,
  tokenEdits,
  onTokenEdit,
  tokenAdds,
  onTokenAdd,
  rebinds,
  onRebind,
  paletteEdits,
  onPaletteEdit,
  tokens,
}: TokenEditorPanelProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  /** Which section has an open "new token" draft row. */
  const [draft, setDraft] = useState<TokenFamily | null>(null);
  /** Sections forced open (the "+" button expands its own section). */
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const theme: 'light' | 'dark' = dark ? 'dark' : 'light';

  /**
   * `null` when the adapter is absent as well as when the bridge is down — both mean
   * "no source truth", and the panel's offline fallbacks are correct for either.
   */
  const introspection = tokens?.ok && tokens.adapter === 'configured' ? tokens : null;
  const families = introspection?.families ?? [];
  /**
   * MEMOISED, and that is not a micro-optimisation.
   *
   * `?? {}` produced a fresh object on every render, so `colorRoles` recomputed, so
   * `colorSpecs` and `allSpecs` did, so the computed-CSS layout effect refired and set a
   * new state object — a render loop. Measured symptom: React error #185 the moment this
   * tab mounted against an adapter whose `bindings.themed` is absent.
   */
  const bindings = useMemo(
    () => introspection?.bindings?.themed[theme] ?? {},
    [introspection, theme],
  );
  const leaves = introspection?.bindings?.leaves;
  const themeMappings = useMemo(
    () => new Set(introspection?.utilities ?? []),
    [introspection],
  );
  /**
   * The custom properties the pipeline ACTUALLY emits, per theme.
   *
   * A row's contract name is `cssVarPrefix + key`, and for two of wafflebase's four families
   * that is exactly what lands (`--accent`, `--font-body`). For `radius` it is not:
   * `build-css.ts` writes `radius.base` as the bare `--radius` and emits none of the other
   * four steps at all — they exist only in source, which is what `bindings.leaves` is for by
   * its own doc ("only families whose source members are not all emitted need an entry").
   *
   * Nothing in the payload maps a source member to its emitted property, so the prefix name
   * cannot be verified and must not be shown as fact. This set is what CAN be verified.
   */
  const emitted = useMemo(
    () => new Set(Object.keys(introspection?.vars?.[theme] ?? {})),
    [introspection, theme],
  );

  // --- Catalogs, derived from source so created tokens appear automatically. ---
  const colorRoles = useMemo(() => {
    const fromSource = Object.keys(bindings).map(camelToKebab);
    const extra = fromSource.filter((r) => !CURATED_ROLES.includes(r)).sort();
    const curated = CURATED_ROLES.filter((r) => !introspection || fromSource.includes(r));
    return [...curated, ...extra];
  }, [bindings, introspection]);

  /**
   * A family the adapter does not report gets NO rows, rather than rows addressed at a
   * family the server would refuse. The section still renders its header, so the absence
   * is visible instead of looking like an empty registry.
   */
  const semanticMeta = familyMetaOf(families, 'semantic');
  const radiusMeta = familyMetaOf(families, 'radius');
  const typoMeta = familyMetaOf(families, 'typo');

  const colorSpecs = useMemo(
    () => (semanticMeta ? colorRoles.map((r) => colorSpec(semanticMeta, r, theme)) : []),
    [colorRoles, theme, semanticMeta],
  );
  const radiusSpecs = useMemo(
    () =>
      radiusMeta
        ? Object.keys(leaves?.radius ?? {}).concat(leaves?.radius ? [] : OFFLINE_RADIUS).map((k) => radiusSpec(radiusMeta, k))
        : [],
    [leaves, radiusMeta],
  );
  const fontSpecs = useMemo(
    () =>
      typoMeta
        ? Object.keys(leaves?.typo ?? {}).concat(leaves?.typo ? [] : OFFLINE_FONTS).map((k) => fontSpec(typoMeta, k))
        : [],
    [leaves, typoMeta],
  );

  const paletteColors = useMemo(
    () => (introspection?.bindings?.refs ?? []).filter((c: TokenRef) => c.isColor),
    [introspection],
  );
  /**
   * EVERY top-level palette member, colour or not. `paletteColors` is the display set —
   * `isColor` exists so the rebind picker shows only swatchable refs — but a name collides
   * with a sibling whatever its type, so a draft checked against the colours alone accepts
   * `syrup-rgb` and the server then refuses it.
   */
  const paletteMembers = useMemo(() => paletteCollisionKeys(introspection?.bindings?.refs), [introspection]);
  // ref → effective value (source value, overridden by a pending palette edit).
  const paletteValueByRef = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of paletteColors) m.set(c.ref, c.value);
    for (const e of Object.values(paletteEdits)) m.set(e.ref, e.newValue);
    return m;
  }, [paletteColors, paletteEdits]);
  const paletteColorByRef = useMemo(() => {
    const m = new Map<string, TokenRef>();
    for (const c of paletteColors) m.set(c.ref, c);
    return m;
  }, [paletteColors]);

  // Computed-CSS fallback: only consulted for `computed` bindings (template
  // expressions the editor can't resolve) and when the bridge is offline.
  const [computed, setComputed] = useState<Record<string, string>>({});
  const allSpecs = useMemo(() => [...colorSpecs, ...radiusSpecs, ...fontSpecs], [colorSpecs, radiusSpecs, fontSpecs]);
  useLayoutEffect(() => {
    if (!rootRef.current) return;
    const styles = getComputedStyle(rootRef.current);
    const next: Record<string, string> = {};
    for (const t of allSpecs) next[t.cssVar] = styles.getPropertyValue(`--${t.cssVar}`).trim();
    // ONLY on a real change. The memo above removes the churn that caused a loop here, and
    // this makes the loop unreachable rather than merely absent: any future identity change
    // upstream costs one extra pass instead of an unbounded number.
    setComputed((prev) => {
      const keys = Object.keys(next);
      if (keys.length === Object.keys(prev).length && keys.every((k) => prev[k] === next[k])) {
        return prev;
      }
      return next;
    });
  }, [allSpecs, dark]);

  /** A token's CURRENT value, from source wherever source can answer. */
  const sourceValue = (t: TokenSpec): string => {
    if (t.kind === 'color') {
      const b = bindings[t.path[0]];
      if (b?.kind === 'literal') return b.value ?? '';
      // `ref` replaces the prototype's `palette` kind, and the reference IS `value` — the
      // extracted contract dropped the separate `ref` field because a binding has exactly
      // one authored text either way.
      if (b?.kind === 'ref' && b.value) return paletteValueByRef.get(b.value) ?? computed[t.cssVar] ?? '';
      return computed[t.cssVar] ?? ''; // expression / bridge offline
    }
    const table = t.kind === 'radius' ? leaves?.radius : leaves?.typo;
    return table?.[t.path.join('.')] ?? computed[t.cssVar] ?? '';
  };

  // How many semantic tokens (both themes) reference a given palette ref.
  const usageCount = (ref: string) => {
    if (!introspection) return 0;
    let n = 0;
    for (const t of ['light', 'dark'] as const) {
      for (const b of Object.values(introspection.bindings?.themed[t] ?? {})) {
        if (b.kind === 'ref' && b.value === ref) n++;
      }
    }
    return n;
  };

  const paletteOptions: ComboboxOption[] = paletteColors.map((c) => ({
    value: c.ref,
    label: c.ref.replace('palette.', ''),
    adornment: (
      <span
        className="size-3.5 shrink-0 rounded-sm border border-border"
        style={{ background: paletteValueByRef.get(c.ref) ?? c.value }}
        aria-hidden
      />
    ),
  }));

  const q = query.trim().toLowerCase();
  const matches = (label: string, cssVar: string) =>
    !q || label.toLowerCase().includes(q) || cssVar.toLowerCase().includes(q);

  // --- Literal edit staging (radius/typography + detached/neutral colours). ---
  const keyFor = (t: TokenSpec) => `${t.constName}|${t.cssVar}`;
  const stageLiteral = (t: TokenSpec, value: string) => {
    const key = keyFor(t);
    const original = sourceValue(t);
    if (value === original || value.trim() === '') return onTokenEdit(key, null);
    onTokenEdit(key, {
      key, cssVar: t.cssVar, family: t.family, constName: t.constName, path: t.path,
      label: t.label, kind: t.kind, oldValue: original, newValue: value,
    });
  };

  /**
   * Tokens that exist as a CSS variable but not as a Tailwind utility class.
   * `--radius` is exempt: it is the base other `--radius-*` steps are computed
   * from, and `rounded-lg` already resolves to it — it needs no alias of its own.
   */
  const unmapped = (t: TokenSpec) =>
    !!introspection && themeMappings.size > 0 && t.cssVar !== 'radius' && !themeMappings.has(t.themeVar);

  const renderLiteralRow = (t: TokenSpec) => {
    const key = keyFor(t);
    const staged = tokenEdits[key];
    const source = sourceValue(t);
    const value = staged?.newValue ?? source;
    // "edited" means differs from SOURCE, not "an edit object exists". A staged
    // edit survives its own save (that is what lets ⌘Z step back past the save),
    // so after writing it matches source and the row must read as written, not
    // as pending — otherwise every touched row looks dirty forever.
    const changed = !!staged && staged.newValue !== source;
    const written = !!staged && !changed;
    return (
      <div
        key={key}
        className={cn(
          'flex items-center gap-2 rounded-md border p-2 transition-colors',
          changed ? 'border-primary/50 bg-primary/5' : 'border-border bg-background',
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs font-medium">{t.label}</span>
            {/*
              The variable name only when the pipeline confirms it; otherwise the SOURCE
              PATH, which is always true and is what the edit actually addresses
              (`toTokenIntent` sends `family`/`constName`/`path`, never a variable name).
              Showing the unverified prefix name printed `--radius-base` for a token emitted
              as `--radius`, and named `--radius-sm` for four that are not emitted at all.
            */}
            {emitted.has(`--${t.cssVar}`) ? (
              <span className="font-code text-[10px] text-wb-muted">--{t.cssVar}</span>
            ) : (
              <span
                className="font-code text-[10px] text-wb-muted opacity-70"
                title="Source-only: this member is not emitted as a CSS custom property"
              >
                {t.constName}.{t.path.join('.')}
              </span>
            )}
            {changed && <span className="rounded-full bg-primary/15 px-1.5 text-[10px] font-medium text-primary">edited</span>}
            {written && <WrittenBadge />}
            {unmapped(t) && <NoUtilityBadge themeVar={t.themeVar} />}
          </div>
          <input
            value={value}
            onChange={(e) => stageLiteral(t, e.target.value)}
            spellCheck={false}
            className="mt-1 w-full rounded-sm border border-input bg-transparent px-1.5 py-1 font-code text-[11px] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </div>
        {(changed || written) && (
          <button
            onClick={() => onTokenEdit(key, null)}
            aria-label="Revert"
            title="Drop this edit — a save afterwards restores the value from before this session"
            className="shrink-0 rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <RotateCcw className="size-3.5" />
          </button>
        )}
      </div>
    );
  };

  // Filtered catalogs.
  const colorRows = colorSpecs.filter((t) => matches(t.label, t.cssVar));
  const radiusRows = radiusSpecs.filter((t) => matches(t.label, t.cssVar));
  const fontRows = fontSpecs.filter((t) => matches(t.label, t.cssVar));
  const paletteRows = paletteColors.filter((c) => matches(c.ref.replace('palette.', ''), c.ref));
  const addList = Object.values(tokenAdds);
  const addsFor = (family: TokenFamily) => addList.filter((a) => a.family === family);

  /** Existing kebab keys per family, so the draft row can reject collisions. */
  const existingKeys = (family: TokenFamily): Set<string> => {
    const staged = addsFor(family).map((a) => a.kebabKey);
    if (family === 'semantic') return new Set([...colorRoles, ...CURATED_ROLES, ...staged]);
    // NORMALISED, and over EVERY member. `path[0]` is the authored member (`syrupDeep`)
    // while the draft's key is kebab (`syrup-deep`), so comparing them raw let a duplicate
    // through; and checking only the colours let a non-colour sibling through as well.
    if (family === 'palette') return new Set([...paletteMembers, ...staged]);
    if (family === 'radius') return new Set([...radiusSpecs.map((t) => camelToKebab(t.path[0])), ...staged]);
    return new Set([...fontSpecs.map((t) => camelToKebab(t.path[0])), ...staged]);
  };

  /** Open the section AND start its draft row — one click, input focused. */
  const startDraft = (family: TokenFamily, section: string) => {
    if (draft === family) return setDraft(null);
    setOpenSections((p) => ({ ...p, [section]: true }));
    setDraft(family);
  };

  const sectionProps = (section: string, defaultOpen: boolean) => ({
    open: openSections[section] ?? defaultOpen,
    onOpenChange: (open: boolean) => setOpenSections((p) => ({ ...p, [section]: open })),
  });

  const draftRow = (family: TokenFamily) =>
    draft === family ? (
      <AddTokenDraft
        family={family}
        families={families}
        existingKeys={existingKeys(family)}
        onStage={(add) => {
          onTokenAdd(add.key, add);
          setDraft(null);
        }}
        onCancel={() => setDraft(null)}
      />
    ) : null;

  const stagedRows = (family: TokenFamily) =>
    addsFor(family).map((a) => <AddedTokenRow key={a.key} add={a} families={families} onRemove={() => onTokenAdd(a.key, null)} />);

  return (
    <div ref={rootRef} className="flex h-full flex-col">
      <p className="mb-2 text-[11px] text-muted-foreground">
        Editing the global token registry for the{' '}
        <span className="font-medium text-foreground">{dark ? 'dark' : 'light'}</span> theme.
        {!introspection && <span className="text-destructive"> Bridge offline — values read from computed CSS.</span>}
      </p>

      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter tokens…"
          spellCheck={false}
          className="w-full rounded-md border border-input bg-background py-1.5 pl-7 pr-7 text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            aria-label="Clear filter"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1">
        <AccordionSection
          title="Colors"
          icon={<Palette className="size-3" />}
          count={colorRows.length + addsFor('semantic').length}
          {...sectionProps('colors', true)}
          right={
            <AddTokenButton
              label="Add a semantic color token"
              active={draft === 'semantic'}
              onClick={() => startDraft('semantic', 'colors')}
            />
          }
        >
          <div className="flex flex-col gap-2">
            {draftRow('semantic')}
            {stagedRows('semantic')}
            {colorRows.map((t) => {
              const camelKey = t.path[0];
              return (
                <ColorTokenRow
                  key={`${theme}|${t.cssVar}`}
                  spec={t}
                  theme={theme}
                  camelKey={camelKey}
                  binding={bindings[camelKey]}
                  currentValue={sourceValue(t)}
                  unmapped={unmapped(t)}
                  paletteOptions={paletteOptions}
                  paletteValueByRef={paletteValueByRef}
                  paletteColorByRef={paletteColorByRef}
                  usageCount={usageCount}
                  dark={dark}
                  rebind={rebinds[`${theme}|rebind|${camelKey}`]}
                  onRebind={onRebind}
                  paletteEdits={paletteEdits}
                  onPaletteEdit={onPaletteEdit}
                  literalEdit={tokenEdits[keyFor(t)]}
                  onLiteralEdit={(v) => stageLiteral(t, v)}
                  onLiteralClear={() => onTokenEdit(keyFor(t), null)}
                />
              );
            })}
            {colorRows.length === 0 && addsFor('semantic').length === 0 && !draft && <Empty />}
          </div>
        </AccordionSection>

        {/* Dedicated Palette section — the foundation. Editing here cascades. */}
        <AccordionSection
          title="Palette"
          icon={<Layers className="size-3" />}
          count={paletteRows.length + addsFor('palette').length}
          {...sectionProps('palette', false)}
          right={
            <AddTokenButton
              label="Add a palette color"
              active={draft === 'palette'}
              onClick={() => startDraft('palette', 'palette')}
            />
          }
        >
          <p className="mb-2 px-0.5 text-[10px] text-muted-foreground">
            Raw brand colors. Editing a value here cascades to every token and consumer that references it.
          </p>
          <div className="flex flex-col gap-2">
            {draftRow('palette')}
            {stagedRows('palette')}
            {introspection ? (
              paletteRows.length ? (
                paletteRows.map((c) => (
                  <PaletteLeafRow
                    key={c.ref}
                    color={c}
                    staged={paletteEdits[`palette|${c.path.join('.')}`]}
                    usages={usageCount(c.ref)}
                    onEdit={(newValue) => {
                      const key = `palette|${c.path.join('.')}`;
                      if (newValue === c.value || newValue.trim() === '') return onPaletteEdit(key, null);
                      onPaletteEdit(key, { key, ref: c.ref, path: c.path, label: c.path.join('.'), oldValue: c.value, newValue });
                    }}
                    onClear={() => onPaletteEdit(`palette|${c.path.join('.')}`, null)}
                  />
                ))
              ) : (
                <Empty />
              )
            ) : (
              <p className="px-1 py-2 text-[11px] text-muted-foreground">Bridge offline — palette unavailable.</p>
            )}
          </div>
        </AccordionSection>

        <AccordionSection
          title="Radius"
          icon={<Ruler className="size-3" />}
          count={radiusRows.length + addsFor('radius').length}
          {...sectionProps('radius', true)}
          right={
            <AddTokenButton
              label="Add a radius token"
              active={draft === 'radius'}
              onClick={() => startDraft('radius', 'radius')}
            />
          }
        >
          <div className="flex flex-col gap-2">
            {draftRow('radius')}
            {stagedRows('radius')}
            {radiusRows.length ? radiusRows.map(renderLiteralRow) : !draft && <Empty />}
          </div>
        </AccordionSection>

        <AccordionSection
          title="Typography"
          icon={<Type className="size-3" />}
          count={fontRows.length + addsFor('typo').length}
          {...sectionProps('typography', true)}
          right={
            <AddTokenButton
              label="Add a font token"
              active={draft === 'typo'}
              onClick={() => startDraft('typo', 'typography')}
            />
          }
        >
          <div className="flex flex-col gap-2">
            {draftRow('typo')}
            {stagedRows('typo')}
            {fontRows.length ? fontRows.map(renderLiteralRow) : !draft && <Empty />}
          </div>
        </AccordionSection>
      </div>
    </div>
  );
}

function Empty() {
  return <p className="px-1 py-2 text-[11px] text-muted-foreground">No matching tokens.</p>;
}

/**
 * A token that reaches `tokens.css` but has no `@theme inline` alias, so no
 * utility class resolves to it. Worth surfacing: it is the difference between "the
 * variable exists" and "I can write `bg-brand-accent`".
 */
/** This row's value is staged AND already written to source. */
function WrittenBadge() {
  return (
    <span
      title="Written to code. Undo (⌘Z) steps back past the save."
      className="rounded-full bg-emerald-500/15 px-1.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400"
    >
      in code
    </span>
  );
}

function NoUtilityBadge({ themeVar }: { themeVar: string }) {
  return (
    <span
      title={`No Tailwind utility — add ${themeVar} to @theme inline`}
      className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 text-[10px] font-medium text-amber-700 dark:text-amber-400"
    >
      <TriangleAlert className="size-2.5" />
      no utility
    </span>
  );
}

/**
 * A binding-aware colour-token row. Palette-bound tokens default to "Palette"
 * mode (rebind via the palette picker); "Custom" mode edits the underlying
 * palette colour (cascade). Literal/neutral tokens default to "Custom" (raw hex).
 */
function ColorTokenRow({
  spec,
  theme,
  camelKey,
  binding,
  currentValue,
  unmapped,
  paletteOptions,
  paletteValueByRef,
  paletteColorByRef,
  usageCount,
  dark,
  rebind,
  onRebind,
  paletteEdits,
  onPaletteEdit,
  literalEdit,
  onLiteralEdit,
  onLiteralClear,
}: {
  spec: TokenSpec;
  theme: 'light' | 'dark';
  camelKey: string;
  binding: TokenBinding | undefined;
  currentValue: string;
  unmapped: boolean;
  paletteOptions: ComboboxOption[];
  paletteValueByRef: Map<string, string>;
  paletteColorByRef: Map<string, TokenRef>;
  usageCount: (ref: string) => number;
  dark: boolean;
  rebind?: PendingTokenRebind;
  onRebind: (key: string, edit: PendingTokenRebind | null) => void;
  paletteEdits: Record<string, PendingPaletteEdit>;
  onPaletteEdit: (key: string, edit: PendingPaletteEdit | null) => void;
  literalEdit?: PendingTokenEdit;
  onLiteralEdit: (value: string) => void;
  onLiteralClear: () => void;
}) {
  const isPaletteBound = binding?.kind === 'ref';
  // `expression` absorbed the prototype's `computed` and `other`: both mean "authored as
  // something this editor will not rewrite", which is the only distinction the UI made.
  const isComputed = binding?.kind === 'expression';
  const boundRef = isPaletteBound ? binding!.value : undefined;
  const paletteEditKey = boundRef ? `palette|${(paletteColorByRef.get(boundRef)?.path ?? []).join('.')}` : '';
  const stagedPaletteEdit = paletteEditKey ? paletteEdits[paletteEditKey] : undefined;

  // Derive the mode from the binding (which arrives async with introspection),
  // unless the user has explicitly toggled — then honor their choice. Using a
  // plain useState default would freeze on 'custom' before bindings load.
  const [modeOverride, setModeOverride] = useState<'palette' | 'custom' | null>(null);
  const mode: 'palette' | 'custom' = modeOverride ?? (isPaletteBound ? 'palette' : 'custom');
  const setMode = setModeOverride;
  const rebindKey = `${theme}|rebind|${camelKey}`;

  // Effective swatch value: rebind target → its palette colour; palette-value
  // edit → the new hex; literal edit → its value; else the source default.
  const effectiveValue =
    rebind ? rebind.previewValue : stagedPaletteEdit ? stagedPaletteEdit.newValue : literalEdit ? literalEdit.newValue : currentValue;
  // Differs from SOURCE (not merely "staged") — a staged edit outlives its own
  // save so ⌘Z can step back past it, and after the write it matches source.
  const paletteSource = boundRef ? paletteColorByRef.get(boundRef)?.value : undefined;
  const changed =
    (!!rebind && rebind.toRef !== boundRef) ||
    (!!stagedPaletteEdit && stagedPaletteEdit.newValue !== paletteSource) ||
    (!!literalEdit && literalEdit.newValue !== currentValue);
  const written = !changed && (!!rebind || !!stagedPaletteEdit || !!literalEdit);

  // Palette-mode combobox value: pending rebind, else the current binding ref.
  const comboValue = rebind?.toRef ?? boundRef ?? '';

  const doRebind = (toRef: string) => {
    if (toRef === boundRef) return onRebind(rebindKey, null); // no-op → clear
    const base = {
      key: rebindKey,
      cssVar: spec.cssVar,
      family: spec.family,
      constName: theme,
      path: spec.path,
      label: spec.label,
      fromRef: boundRef ?? binding?.value ?? 'literal',
      toRef,
      previewValue: paletteValueByRef.get(toRef) ?? '',
    };
    /*
     * `fromKind` is CARRIED, not inferred.
     *
     * The prototype passed `fromValue` only when the binding was a literal and let the
     * inverse work out the rest by testing `fromRef.startsWith('palette.')` — a
     * wafflebase-ism that classifies any other project's reference layer as a literal.
     * 9b made the shape a union on `fromKind` for exactly this, and only `'ref'` may omit
     * `fromValue` because only its inverse can rebuild itself from `fromRef`.
     */
    onRebind(
      rebindKey,
      binding?.kind === 'ref' || !binding
        ? { ...base, fromKind: 'ref' }
        : { ...base, fromKind: binding.kind, fromValue: binding.value ?? '' },
    );
  };

  // Custom-mode hex edit. Decision: for a palette-bound token, edit the PALETTE
  // entry (cascade). Only "detach" writes a literal onto this single token.
  const currentHexForCustom = boundRef ? paletteValueByRef.get(boundRef) ?? currentValue : currentValue;
  const customValue = stagedPaletteEdit?.newValue ?? literalEdit?.newValue ?? currentHexForCustom;
  const onCustomChange = (v: string) => {
    if (boundRef) {
      const col = paletteColorByRef.get(boundRef);
      if (!col) return;
      const key = `palette|${col.path.join('.')}`;
      if (v === col.value || v.trim() === '') return onPaletteEdit(key, null);
      onPaletteEdit(key, { key, ref: boundRef, path: col.path, label: col.path.join('.'), oldValue: col.value, newValue: v });
    } else {
      onLiteralEdit(v);
    }
  };
  const clearAll = () => {
    if (rebind) onRebind(rebindKey, null);
    if (stagedPaletteEdit) onPaletteEdit(paletteEditKey, null);
    if (literalEdit) onLiteralClear();
  };

  return (
    <div
      className={cn(
        'rounded-md border p-2 transition-colors',
        changed ? 'border-primary/50 bg-primary/5' : 'border-border bg-background',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="size-6 shrink-0 rounded-sm border border-border" style={{ background: effectiveValue }} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-xs font-medium">{spec.label}</span>
            <span className="font-code text-[10px] text-muted-foreground">--{spec.cssVar}</span>
            {isPaletteBound && !rebind && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 text-[10px] text-muted-foreground">
                <Link2 className="size-2.5" />
                {boundRef!.replace('palette.', '')}
              </span>
            )}
            {changed && <span className="rounded-full bg-primary/15 px-1.5 text-[10px] font-medium text-primary">edited</span>}
            {written && <WrittenBadge />}
            {unmapped && <NoUtilityBadge themeVar={spec.themeVar} />}
          </div>
        </div>
        {(changed || written) && (
          <button
            onClick={clearAll}
            aria-label="Revert"
            title="Drop this edit — a save afterwards restores the value from before this session"
            className="shrink-0 rounded-sm p-1 text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="size-3.5" />
          </button>
        )}
      </div>

      {isComputed ? (
        <p className="mt-1.5 rounded-sm border border-border bg-muted/40 px-1.5 py-1 font-code text-[10px] text-muted-foreground">
          computed: {binding!.value} — edit via the Palette section
        </p>
      ) : (
        <>
          {/* Mode toggle (only meaningful when the bridge exposes bindings). */}
          <div className="mt-1.5 flex items-center gap-1">
            <ModeChip active={mode === 'palette'} onClick={() => setMode('palette')} icon={<Link2 className="size-2.5" />}>
              Palette
            </ModeChip>
            <ModeChip active={mode === 'custom'} onClick={() => setMode('custom')} icon={<Unlink className="size-2.5" />}>
              Custom
            </ModeChip>
          </div>

          {mode === 'palette' ? (
            <div className="mt-1.5">
              <Combobox
                value={comboValue}
                options={paletteOptions}
                onChange={doRebind}
                placeholder="Pick a palette color…"
                ariaLabel={`${spec.label} palette binding`}
                contentClassName={dark ? 'dark' : undefined}
              />
              {rebind && (
                <p className="mt-1 font-code text-[10px] text-muted-foreground">
                  {rebind.fromRef.replace('palette.', '')} → {rebind.toRef.replace('palette.', '')}
                </p>
              )}
            </div>
          ) : (
            <div className="mt-1.5">
              <div className="flex items-center gap-1.5">
                <input
                  type="color"
                  value={/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(customValue) ? customValue : '#000000'}
                  onChange={(e) => onCustomChange(e.target.value)}
                  aria-label={`${spec.label} color`}
                  className="size-7 shrink-0 cursor-pointer rounded-sm border border-border bg-transparent p-0.5"
                />
                <input
                  value={customValue}
                  onChange={(e) => onCustomChange(e.target.value)}
                  spellCheck={false}
                  className="w-full rounded-sm border border-input bg-transparent px-1.5 py-1 font-code text-[11px] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </div>
              {boundRef && (
                <p className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">
                  Edits <span className="font-code">{boundRef}</span> — cascades to {usageCount(boundRef)} token
                  {usageCount(boundRef) === 1 ? '' : 's'} + external consumers.{' '}
                  <button
                    onClick={() => {
                      if (stagedPaletteEdit) onPaletteEdit(paletteEditKey, null);
                      onLiteralEdit(customValue);
                    }}
                    className="underline hover:text-foreground"
                  >
                    Detach this token instead
                  </button>
                </p>
              )}
              {!boundRef && literalEdit && (
                <p className="mt-1 font-code text-[10px] text-muted-foreground">raw literal on --{spec.cssVar}</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ModeChip({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] font-medium transition-colors',
        active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground',
      )}
    >
      {icon}
      {children}
    </button>
  );
}

/** A raw palette colour leaf editor (Palette section, Workflow B). */
function PaletteLeafRow({
  color,
  staged,
  usages,
  onEdit,
  onClear,
}: {
  color: TokenRef;
  staged?: PendingPaletteEdit;
  usages: number;
  onEdit: (value: string) => void;
  onClear: () => void;
}) {
  const value = staged?.newValue ?? color.value;
  const changed = !!staged && staged.newValue !== color.value;
  const written = !!staged && !changed;
  return (
    <div className={cn('rounded-md border p-2 transition-colors', changed ? 'border-primary/50 bg-primary/5' : 'border-border bg-background')}>
      <div className="flex items-center gap-2">
        <span className="size-6 shrink-0 rounded-sm border border-border" style={{ background: value }} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-code text-xs font-medium">{color.path.join('.')}</span>
            {changed && <span className="rounded-full bg-primary/15 px-1.5 text-[10px] font-medium text-primary">edited</span>}
            {written && <WrittenBadge />}
          </div>
          <p className="text-[10px] text-muted-foreground">
            {usages} semantic token{usages === 1 ? '' : 's'} + external consumers
          </p>
        </div>
        {(changed || written) && (
          <button onClick={onClear} aria-label="Revert" className="shrink-0 rounded-sm p-1 text-muted-foreground hover:text-foreground">
            <RotateCcw className="size-3.5" />
          </button>
        )}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <input
          type="color"
          value={/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value) ? value : '#000000'}
          onChange={(e) => onEdit(e.target.value)}
          aria-label={`${color.ref} color`}
          className="size-7 shrink-0 cursor-pointer rounded-sm border border-border bg-transparent p-0.5"
        />
        <input
          value={value}
          onChange={(e) => onEdit(e.target.value)}
          spellCheck={false}
          className="w-full rounded-sm border border-input bg-transparent px-1.5 py-1 font-code text-[11px] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </div>
    </div>
  );
}

/** A staged, not-yet-written new token (highlighted, removable). */
function AddedTokenRow({
  add,
  families,
  onRemove,
}: {
  add: PendingTokenAdd;
  families: TokenFamilyMeta[];
  onRemove: () => void;
}) {
  const meta = familyMetaOf(families, add.family);
  const isColor = add.family === 'semantic' || add.family === 'palette';
  return (
    <div className="flex items-center gap-2 rounded-md border border-emerald-500/50 bg-emerald-500/10 p-2">
      {isColor && (
        <span className="size-6 shrink-0 rounded-sm border border-border" style={{ background: add.value }} aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs font-medium">{add.kebabKey}</span>
          <span className="font-code text-[10px] text-muted-foreground">{add.cssVar}</span>
          <span className="rounded-full bg-emerald-500/20 px-1.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">new</span>
        </div>
        <p className="mt-0.5 truncate font-code text-[11px] text-muted-foreground">
          {add.value}
          {meta ? ` · ${utilityFor(meta, add.kebabKey)}` : null}
        </p>
      </div>
      <button onClick={onRemove} aria-label="Remove new token" className="shrink-0 rounded-sm p-1 text-muted-foreground transition-colors hover:text-destructive">
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}
