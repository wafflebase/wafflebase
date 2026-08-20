import { useState } from 'react';
import type { CSSProperties } from 'react';
import { TriangleAlert, Layers, RotateCcw, Plus, Sparkle, MousePointer2 } from 'lucide-react';
import { cn } from '../lib/cn.ts';
import type { ColorBinding, ComponentMeta, CvaValue, ScaleBinding } from '../../types.ts';
import type { TokenFamilyMeta } from '../../tokens/adapter.ts';
import type { VariantState } from '../../client/edits.ts';
import { Combobox, type ComboboxOption } from './Combobox.tsx';
import { joinPropertyLabels, scaleLabel } from '../../client/property-labels.ts';
import {
  stageTokenAdd,
  computeColorReplacements,
  computeScaleReplacement,
  type PendingClassEdit,
  type PendingTokenAdd,
} from '../../client/edits.ts';
import {
  NO_STATE_LABEL,
  NO_STATE_ROLE,
  OPACITY_STEPS,
  STATES,
  buildColorClass,
  derivedStateValue,
  opacityLabel,
  parseColorClasses,
  promotedTokenKey,
  stateSlots,
  type ColorClass,
  type StateKey,
  type StateSlot,
} from '../../client/states.ts';

/** Opacity a newly introduced state modifier starts at, per state. */
const DEFAULT_STATE_OPACITY: Record<StateKey, number> = {
  hover: 90,
  active: 80,
  'focus-visible': 100,
  disabled: 50,
};

const COLOR_UTILITIES = ['bg', 'text', 'border', 'ring', 'outline', 'fill', 'stroke', 'from', 'to', 'via', 'decoration', 'divide', 'shadow', 'accent'];

interface TokenBindingPanelProps {
  component: ComponentMeta;
  variantState: VariantState;
  onVariantChange: (axis: string, value: string) => void;
  /** Family metadata from `GET /tokens` — needed to stage a promoted state token. */
  families: TokenFamilyMeta[];
  vocabulary: string[];
  /**
   * Roles that exist in source but not in the static metadata vocabulary —
   * chart/sidebar roles plus anything the sandbox created (including promoted
   * state tokens like `primary-hover`, which must be pickable immediately).
   */
  extraRoles: string[];
  classEdits: Record<string, PendingClassEdit>;
  onClassEdit: (key: string, edit: PendingClassEdit | null) => void;
  /** Stage a new semantic token — used by "Promote to token" on a state row. */
  onTokenAdd: (key: string, add: PendingTokenAdd | null) => void;
  /** Already-staged token adds, so a promotion isn't offered twice. */
  tokenAdds: Record<string, PendingTokenAdd>;
  /** Kebab keys that already exist as semantic tokens in source. */
  existingRoles: Set<string>;
  /** Current theme — forwarded to the portaled dropdowns so swatches theme correctly. */
  dark: boolean;
  /** Pending token-value overrides — forwarded so in-menu swatches reflect unsaved edits. */
  tokenStyle: CSSProperties;
}

const RADIUS_OPTS = ['base', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', 'full', 'none'];
const SPACING_OPTS = ['0', '0.5', '1', '1.5', '2', '2.5', '3', '3.5', '4', '5', '6', '8', '10', '12', '16'];
const FONT_OPTS = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl'];
const scaleOptions = (category: string): string[] =>
  category === 'radius' ? RADIUS_OPTS : category === 'fontSize' ? FONT_OPTS : SPACING_OPTS;

/** Swatch backed by the live CSS variable — never a hardcoded hex. */
function Swatch({ role }: { role: string }) {
  return (
    <span
      className="size-4 shrink-0 rounded-sm border border-border"
      style={{ backgroundColor: `var(--${role})` }}
      aria-hidden
    />
  );
}

const tokenOptions = (vocabulary: string[]): ComboboxOption[] =>
  vocabulary.map((role) => ({ value: role, label: role, adornment: <Swatch role={role} /> }));

/** Collapse color bindings to one row per role, collecting the properties it fills. */
interface RoleGroup {
  role: string;
  utilities: string[];
}
const UTILITY_ORDER = ['bg', 'text', 'border', 'ring', 'outline', 'fill', 'stroke', 'decoration', 'divide', 'accent', 'shadow', 'from', 'via', 'to'];
function groupByRole(bindings: ColorBinding[]): RoleGroup[] {
  const map = new Map<string, string[]>();
  for (const b of bindings) {
    const arr = map.get(b.role) ?? [];
    if (!arr.includes(b.utility)) arr.push(b.utility);
    map.set(b.role, arr);
  }
  const rank = (u: string) => (UTILITY_ORDER.indexOf(u) === -1 ? 99 : UTILITY_ORDER.indexOf(u));
  return [...map.entries()]
    .map(([role, utilities]) => ({ role, utilities }))
    .sort((a, b) => Math.min(...a.utilities.map(rank)) - Math.min(...b.utilities.map(rank)) || a.role.localeCompare(b.role));
}

/** A single editable row (label + rebound badge + combobox). */
function EditRow({
  property,
  subLabel,
  changed,
  value,
  options,
  onChange,
  onReset,
  placeholder,
  contentClassName,
  contentStyle,
}: {
  property: string;
  subLabel: string;
  changed: boolean;
  value: string;
  options: ComboboxOption[];
  onChange: (v: string) => void;
  /** Revert this single binding to its source default (#6 per-item reset). */
  onReset: () => void;
  placeholder: string;
  contentClassName?: string;
  contentStyle?: CSSProperties;
}) {
  return (
    <div
      className={cn(
        'rounded-md border bg-background p-2.5 transition-colors',
        changed ? 'border-primary/50 bg-primary/5' : 'border-border',
      )}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-foreground">{property}</p>
          <p className="truncate font-code text-[10px] text-muted-foreground">{subLabel}</p>
        </div>
        {changed && (
          <div className="flex shrink-0 items-center gap-1">
            <span className="rounded-full bg-primary/10 px-1.5 text-[10px] font-medium text-primary">edited</span>
            <button
              type="button"
              onClick={onReset}
              aria-label={`Reset ${property} to default`}
              title="Reset to source default"
              className="rounded-sm p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <RotateCcw className="size-3.5" />
            </button>
          </div>
        )}
      </div>
      <Combobox
        value={value}
        options={options}
        onChange={onChange}
        placeholder={placeholder}
        ariaLabel={property}
        contentClassName={contentClassName}
        contentStyle={contentStyle}
      />
    </div>
  );
}

/**
 * One editable interaction-state row.
 *
 * Tier 1 (derived) is the two controls: which token, and at what opacity. Tier 2
 * (a dedicated token) is the "Promote" button — see `states.ts` for why both
 * exist and when each is right.
 */
function StateRow({
  slot,
  roleOptions,
  staged,
  onChange,
  onAdd,
  onReset,
  onUnset,
  onPromote,
  promoteTarget,
  menuClass,
  menuStyle,
}: {
  slot: StateSlot;
  roleOptions: ComboboxOption[];
  staged?: PendingClassEdit;
  onChange: (role: string, opacity: number) => void;
  /** Absent when there is no role to write — see the call site. The control disables. */
  onAdd?: () => void;
  onReset: () => void;
  /** Explicitly clear this state so the resting colour shows through. */
  onUnset: () => void;
  onPromote: (role: string, opacity: number) => void;
  /** The token a promotion would create, or null when it already exists. */
  promoteTarget: string | null;
  menuClass?: string;
  menuStyle?: CSSProperties;
}) {
  const state = STATES.find((s) => s.key === slot.state)!;
  // The class this row currently resolves to: the staged edit if any, else what
  // the source authored. A staged edit is either a swap (`replacements`), an
  // introduction (`additions`) or an explicit unset (`removals`, no additions).
  const unset = !!staged && !staged.additions?.length && !staged.replacements.length;
  const effective = unset
    ? undefined
    : staged
      ? (staged.additions?.[0] ?? staged.replacements[0]?.to)
      : slot.current?.className;
  const parsed: ColorClass | null = effective
    ? parseColorClasses(effective, roleOptions.map((o) => o.value), COLOR_UTILITIES)[0] ?? null
    : null;
  const role = parsed?.role ?? slot.base?.role ?? '';
  const opacity = parsed?.opacity ?? 100;
  const changed = !!staged;
  const isSet = !!effective;

  return (
    <div
      className={cn(
        'rounded-md border p-2 transition-colors',
        changed ? 'border-primary/50 bg-primary/5' : isSet ? 'border-border bg-background' : 'border-dashed border-border bg-background/60',
      )}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="rounded-sm bg-muted px-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {state.label}
          </span>
          <span className="truncate text-xs font-medium">{joinPropertyLabels([slot.utility])}</span>
          {changed && <span className="rounded-full bg-primary/10 px-1.5 text-[10px] font-medium text-primary">edited</span>}
        </div>
        {changed && (
          <button
            type="button"
            onClick={onReset}
            aria-label={`Reset ${state.label} ${slot.utility}`}
            title="Reset to source default"
            className="shrink-0 rounded-sm p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <RotateCcw className="size-3.5" />
          </button>
        )}
      </div>

      {!isSet ? (
        <button
          type="button"
          onClick={onAdd}
          disabled={!onAdd}
          title={onAdd ? undefined : 'No token role is available to set yet'}
          className="inline-flex items-center gap-1 rounded-sm border border-dashed border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary hover:bg-primary/5 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
        >
          <Plus className="size-3" />
          {unset ? (
            <>Re-define {state.label.toLowerCase()} (currently none)</>
          ) : (
            <>
              Define {state.label.toLowerCase()} (
              {slot.base ? `${slot.base.role} @ ${DEFAULT_STATE_OPACITY[slot.state]}%` : 'derive'})
            </>
          )}
        </button>
      ) : (
        <>
          <div className="flex items-center gap-1.5">
            <div className="min-w-0 flex-1">
              <Combobox
                value={role}
                // `none` is a first-class choice, not just the Reset button: it
                // is the only way to DELETE a state colour that source declares.
                options={[{ value: NO_STATE_ROLE, label: NO_STATE_LABEL }, ...roleOptions]}
                onChange={(next) => (next === NO_STATE_ROLE ? onUnset() : onChange(next, opacity))}
                placeholder="Search tokens…"
                ariaLabel={`${state.label} ${slot.utility} token`}
                contentClassName={menuClass}
                contentStyle={menuStyle}
              />
            </div>
            <select
              value={String(opacity)}
              onChange={(e) => onChange(role, Number(e.target.value))}
              aria-label={`${state.label} ${slot.utility} opacity`}
              className="h-8 shrink-0 rounded-md border border-input bg-background px-1.5 font-code text-[11px] outline-none focus-visible:border-ring"
            >
              {OPACITY_STEPS.map((o) => (
                <option key={o} value={o}>
                  {opacityLabel(o)}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="truncate font-code text-[10px] text-muted-foreground">
              {effective}
            </span>
            {promoteTarget && (
              <button
                type="button"
                onClick={() => onPromote(role, opacity)}
                title={`Create --${promoteTarget} and bind this state to it`}
                className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              >
                <Sparkle className="size-2.5" />
                Promote to token
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

interface Scope {
  id: string;
  axis?: string;
  value: string; // '__base__' or the value name
  label: string;
  classes: string;
  colorBindings: ColorBinding[];
  scaleBindings: ScaleBinding[];
  antiPatterns: string[];
}

function toScope(id: string, value: string, label: string, v: CvaValue, axis?: string): Scope {
  const p = v.antiPatterns;
  return {
    id,
    axis,
    value,
    label,
    classes: v.classes,
    colorBindings: v.colorBindings,
    scaleBindings: v.scaleBindings,
    antiPatterns: [...p.hardcodedNamedColors, ...p.hardcodedPaletteColors, ...p.hexLiterals, ...p.rgbHslLiterals],
  };
}

/**
 * Right pane — variant controls (chips) + variant-driven, property-labeled
 * token bindings (color + non-color). Edits are staged per row and scoped to
 * the CVA value that owns them ("active variant only").
 */
export function TokenBindingPanel({
  component,
  variantState,
  onVariantChange,
  families,
  vocabulary,
  extraRoles,
  classEdits,
  onClassEdit,
  onTokenAdd,
  tokenAdds,
  existingRoles,
  dark,
  tokenStyle,
}: TokenBindingPanelProps) {
  // Forwarded to every dropdown so its portaled content themes correctly and
  // reflects pending token-value edits (see Combobox contentClassName/Style).
  const menuClass = dark ? 'dark' : undefined;
  const cva = component.cva;
  if (!cva) {
    return (
      <p className="text-xs text-muted-foreground">
        {component.name} has no CVA variants, so there are no variant-scoped token bindings to edit.
      </p>
    );
  }

  // Active variant scopes (one per axis) + base.
  const scopes: Scope[] = [];
  for (const [axis, values] of Object.entries(cva.axes)) {
    const selected = variantState[axis];
    const value = selected ? values[selected] : undefined;
    if (value) scopes.push(toScope(`${axis}=${selected}`, selected, `${axis} = ${selected}`, value, axis));
  }
  scopes.push(toScope('__base__', '__base__', 'base · always applied', cva.base));

  // Role vocabulary = the static metadata list ∪ everything that exists in source
  // ∪ tokens staged in this session, so a just-promoted `primary-hover` is
  // immediately selectable.
  const allRoles = [...new Set([...vocabulary, ...extraRoles, ...Object.values(tokenAdds).map((a) => a.kebabKey)])];
  const colorOpts = tokenOptions(allRoles);
  /**
   * The promote path's refusal, made visible. The comment below it said refusing loudly
   * beats staging an edit the server will reject — and then returned silently, so the
   * button did nothing and said nothing. Reachable: the role is parsed from the authored
   * class, not from `families`, so an adapter with no semantic family still renders it.
   */
  const [promoteError, setPromoteError] = useState<string | null>(null);

  /**
   * Interaction states for one scope. The rows are computed from the AUTHORED
   * class string; staged edits are layered on top by key, so a reset always
   * returns to what the source actually says.
   */
  const renderStates = (scope: Scope) => {
    const slots = stateSlots(scope.classes, allRoles, COLOR_UTILITIES);
    if (!slots.length) return null;

    return (
      <div className="mt-2">
        <p className="mb-1.5 flex items-center gap-1 font-code text-[11px] uppercase tracking-wide text-muted-foreground">
          <MousePointer2 className="size-3" /> interaction states
        </p>
        {promoteError && (
          <p className="mb-1.5 flex items-center gap-1 text-[10px] text-destructive">
            <TriangleAlert className="size-3 shrink-0" /> Could not promote: {promoteError}
          </p>
        )}
        <div className="flex flex-col gap-2">
          {slots.map((slot) => {
            const key = `${component.name}|${scope.id}|st|${slot.state}|${slot.utility}`;
            const staged = classEdits[key];
            const base = {
              key,
              componentName: component.name,
              file: '', // filled by SandboxLayout (knows the file)
              cvaName: cva.name,
              axis: scope.axis,
              value: scope.value,
              scopeLabel: scope.label,
              property: `${slot.state} ${slot.utility}`,
              state: slot.state,
              revealVariant: { ...variantState, ...(scope.axis ? { [scope.axis]: scope.value } : {}) },
            };

            /**
             * "none — use resting colour". If source declares this state, delete
             * the class (a `removals` edit); if it only exists because the user
             * just added it, drop the staged edit and there is nothing to write.
             */
            const unset = () => {
              if (!slot.current) return onClassEdit(key, null);
              onClassEdit(key, {
                ...base,
                fromLabel: slot.current.className,
                toLabel: '— (resting colour)',
                replacements: [],
                removals: [slot.current.className],
              });
            };

            /** Stage the (role, opacity) pair as a swap or an introduction. */
            const write = (role: string, opacity: number) => {
              if (slot.current) {
                const to = buildColorClass(slot.current, { role, opacity });
                if (to === slot.current.className) return onClassEdit(key, null);
                onClassEdit(key, {
                  ...base,
                  fromLabel: slot.current.className,
                  toLabel: to,
                  replacements: [{ from: slot.current.className, to }],
                });
              } else {
                // No modifier authored yet — append one. `dark:`-only variants are
                // intentionally not reproduced here; the row edits the plain state.
                const token = buildColorClass({ mods: [slot.state], utility: slot.utility }, { role, opacity });
                onClassEdit(key, {
                  ...base,
                  fromLabel: '—',
                  toLabel: token,
                  replacements: [],
                  additions: [token],
                });
              }
            };

            // Tier 2: what a promotion would create. Null when the token already
            // exists (source or staged) — then the role picker is the right tool.
            const effective = staged ? (staged.additions?.[0] ?? staged.replacements[0]?.to) : slot.current?.className;
            const parsedRole =
              (effective ? parseColorClasses(effective, allRoles, COLOR_UTILITIES)[0]?.role : undefined) ??
              slot.base?.role;
            const candidate = parsedRole ? promotedTokenKey(parsedRole, slot.state) : null;
            const promoteTarget =
              candidate && !existingRoles.has(candidate) && !Object.values(tokenAdds).some((a) => a.kebabKey === candidate)
                ? candidate
                : null;

            const promote = (role: string, opacity: number) => {
              const kebab = promotedTokenKey(role, slot.state);
              // Seeded with the colour the modifier resolved to, so promoting changes
              // nothing visually until the token is edited — and it still resolves per
              // theme because it references var(--role).
              // Named `promoted`, not `staged`: the outer `staged` (this slot's pending
              // class edit) is still live below and was being shadowed here.
              const promoted = stageTokenAdd(families, 'semantic', kebab, derivedStateValue(role, opacity));
              if ('error' in promoted) {
                setPromoteError(promoted.error);
                return;
              }
              setPromoteError(null);
              onTokenAdd(promoted.key, promoted);
              write(kebab, 100);
            };

            return (
              <StateRow
                key={key}
                slot={slot}
                roleOptions={colorOpts}
                staged={staged}
                onChange={write}
                /*
                 * Guarded: with no vocabulary, no extras and nothing staged, `allRoles[0]`
                 * is `undefined` and `buildColorClass` produced `hover:bg-undefined` — an
                 * edit the server cannot apply. `slot.base?.role` is optional, so there is
                 * no other value to fall back to; the control simply cannot act yet.
                 */
                onAdd={
                  slot.base?.role ?? allRoles[0]
                    ? () => write(slot.base?.role ?? allRoles[0], DEFAULT_STATE_OPACITY[slot.state])
                    : undefined
                }
                onReset={() => onClassEdit(key, null)}
                onUnset={unset}
                onPromote={promote}
                promoteTarget={promoteTarget}
                menuClass={menuClass}
                menuStyle={tokenStyle}
              />
            );
          })}
        </div>
      </div>
    );
  };

  const renderScope = (scope: Scope) => {
    // Resting rows edit the RESTING value only; interaction states have their own
    // rows below. Without this split both controls would rewrite the same
    // `hover:bg-primary/90` token and whichever intent applied second would fail
    // to locate it. A role that appears *only* in a state class (ghost's
    // `hover:bg-accent`) therefore gets no resting row — it has no resting value.
    const resting = parseColorClasses(scope.classes, allRoles, COLOR_UTILITIES).filter((c) => c.state === null);
    const restingKeys = new Set(resting.map((c) => `${c.utility}:${c.role}`));
    const colorGroups = groupByRole(
      scope.colorBindings.filter((b) => restingKeys.has(`${b.utility}:${b.role}`)),
    );
    const states = renderStates(scope);
    if (colorGroups.length === 0 && scope.scaleBindings.length === 0 && !states) return null;

    return (
      <div key={scope.id} className="mb-3">
        <p className="mb-1.5 flex items-center gap-1 font-code text-[11px] uppercase tracking-wide text-muted-foreground">
          {scope.value === '__base__' ? scope.label : <>scope: {scope.label}</>}
        </p>

        {scope.antiPatterns.length > 0 && (
          <div className="mb-2 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-400">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Bypasses the token layer: <span className="font-code">{scope.antiPatterns.join(', ')}</span>. Right-click
              the preview and ask the agent to tokenize it.
            </span>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {/* Color bindings */}
          {colorGroups.map((group) => {
            const key = `${component.name}|${scope.id}|c|${group.role}`;
            const current = classEdits[key]?.toLabel ?? group.role;
            const property = joinPropertyLabels(group.utilities);
            return (
              <EditRow
                key={key}
                property={property}
                subLabel={`resting role: ${group.role}`}
                changed={current !== group.role}
                value={current}
                options={colorOpts}
                placeholder="Search tokens…"
                contentClassName={menuClass}
                contentStyle={tokenStyle}
                onReset={() => onClassEdit(key, null)}
                onChange={(next) => {
                  if (next === group.role) return onClassEdit(key, null);
                  const replacements = computeColorReplacements(scope.classes, group.utilities, group.role, next);
                  if (replacements.length === 0) return onClassEdit(key, null);
                  onClassEdit(key, {
                    key,
                    componentName: component.name,
                    file: '', // filled by SandboxLayout (knows the file)
                    cvaName: cva.name,
                    axis: scope.axis,
                    value: scope.value,
                    scopeLabel: scope.label,
                    property,
                    fromLabel: group.role,
                    toLabel: next,
                    replacements,
                    revealVariant: { ...variantState, ...(scope.axis ? { [scope.axis]: scope.value } : {}) },
                  });
                }}
              />
            );
          })}

          {/* Non-color scale bindings (radius / spacing / font-size) */}
          {scope.scaleBindings.map((binding) => {
            const key = `${component.name}|${scope.id}|s|${binding.className}`;
            const current = classEdits[key]?.toLabel ?? binding.value;
            const property = scaleLabel(binding.category, binding.utility);
            return (
              <EditRow
                key={key}
                property={property}
                subLabel={binding.className}
                changed={current !== binding.value}
                value={current}
                options={scaleOptions(binding.category).map((v) => ({ value: v, label: v }))}
                placeholder="Search scale…"
                contentClassName={menuClass}
                onReset={() => onClassEdit(key, null)}
                onChange={(next) => {
                  if (next === binding.value) return onClassEdit(key, null);
                  const rep = computeScaleReplacement(binding, next);
                  onClassEdit(key, {
                    key,
                    componentName: component.name,
                    file: '',
                    cvaName: cva.name,
                    axis: scope.axis,
                    value: scope.value,
                    scopeLabel: scope.label,
                    property,
                    fromLabel: binding.value,
                    toLabel: next,
                    replacements: [rep],
                    revealVariant: { ...variantState, ...(scope.axis ? { [scope.axis]: scope.value } : {}) },
                  });
                }}
              />
            );
          })}
        </div>

        {states}
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col">
      {/* --- #1 Variant axis chips --- */}
      <div className="mb-3">
        <p className="mb-1.5 flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Layers className="size-3" /> Variants
        </p>
        <div className="flex flex-col gap-2">
          {Object.entries(cva.axes).map(([axis, values]) => (
            <div key={axis} className="flex items-start gap-2">
              <span className="mt-1 w-12 shrink-0 font-code text-[11px] text-muted-foreground">{axis}</span>
              <div className="flex flex-wrap gap-1">
                {Object.keys(values).map((value) => {
                  const active = variantState[axis] === value;
                  return (
                    <button
                      key={value}
                      onClick={() => onVariantChange(axis, value)}
                      className={cn(
                        'rounded-md border px-2 py-1 text-xs transition-colors',
                        active
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-background text-muted-foreground hover:bg-muted',
                      )}
                    >
                      {value}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {scopes.map(renderScope)}
      </div>
    </div>
  );
}
