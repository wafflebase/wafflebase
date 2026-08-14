/**
 * Interaction states (hover / active / focus / disabled) as a first-class,
 * editable layer of the design system.
 *
 * ARCHITECTURE — two tiers, and the reason for both:
 *
 *   Tier 1 · DERIVED (a Tailwind modifier on an existing token)
 *     `hover:bg-primary/90` — the state colour is a *function* of the base token.
 *     This is how the codebase already authors states, it adds zero tokens, and
 *     it can never drift from `--primary`. Editing it is a `class-rewrite` on one
 *     CVA value, which the engine already scopes precisely ("active variant
 *     only"). This is the DEFAULT and covers the overwhelming majority of cases.
 *
 *   Tier 2 · SEMANTIC (a dedicated token)
 *     `hover:bg-primary-hover` backed by `--primary-hover`. Necessary when the
 *     state colour is NOT derivable — a hand-picked hue, a per-theme difference,
 *     or a value the brand mandates. Costs a real token in the pipeline (type +
 *     light + dark + emitter + `@theme` alias), so it is an explicit escalation
 *     ("Promote to token"), never the default.
 *
 * The rule: derive until you can't, then promote. Promoting seeds the token with
 * `color-mix(in oklab, var(--primary) 90%, transparent)` — the exact colour the
 * modifier produced — so the escalation is behaviour-preserving and still
 * resolves per theme; the value is then editable like any other token.
 */

/** The interaction states the sandbox can edit and simulate. */
export type StateKey = 'hover' | 'active' | 'focus-visible' | 'disabled';

export const STATES: { key: StateKey; label: string; hint: string }[] = [
  { key: 'hover', label: 'Hover', hint: 'pointer over the element' },
  { key: 'active', label: 'Active', hint: 'while being pressed' },
  { key: 'focus-visible', label: 'Focus', hint: 'keyboard focus ring' },
  { key: 'disabled', label: 'Disabled', hint: 'non-interactive' },
];

const STATE_KEYS = new Set<string>(STATES.map((s) => s.key));

/** Opacity steps offered for a derived state colour (100 = no modifier). */
export const OPACITY_STEPS = [100, 95, 90, 85, 80, 70, 60, 50, 40, 30, 20, 10];

/**
 * How an opacity step reads in the UI. 100 emits NO `/n` modifier at all, so
 * calling it "100%" invites the reading "there is an alpha, set to full" when the
 * truth is "no alpha — the plain token". Say that.
 */
export const opacityLabel = (o: number) => (o >= 100 ? 'no alpha' : `${o}%`);

/**
 * Sentinel role meaning "no state colour of its own — fall back to the resting
 * token". It is a real, reachable choice, not the absence of one: picking it on a
 * state that source defines stages a class REMOVAL, which is the only way to
 * delete `hover:bg-accent` from a variant. Distinct from the row's Reset, which
 * restores whatever source says (and may itself be a state colour).
 */
export const NO_STATE_ROLE = '__none__';
export const NO_STATE_LABEL = 'none — use resting colour';

/** Colour utilities we surface as state-editable rows, in display order. */
export const STATE_UTILITIES = ['bg', 'text', 'border', 'ring', 'outline', 'decoration', 'shadow'];

/** One colour-utility usage parsed out of a CVA class string. */
export interface ColorClass {
  /** The token exactly as authored, e.g. `dark:hover:bg-primary/90`. */
  className: string;
  /** Modifier chain, e.g. `['dark', 'hover']`. Preserved across rewrites. */
  mods: string[];
  /** The interaction state in `mods`, or null for the resting value. */
  state: StateKey | null;
  utility: string;
  role: string;
  /** `/90` → 90; null when no opacity modifier is present. */
  opacity: number | null;
}

/**
 * Parse every class token in `classes` that targets a semantic colour role.
 * Anything not on the token layer (`bg-zinc-300`, `text-white`) is deliberately
 * skipped — the anti-pattern warning already covers those, and the state editor
 * must not appear to bless them.
 */
export function parseColorClasses(classes: string, roles: string[], utilities: string[]): ColorClass[] {
  const roleSet = new Set(roles);
  // Longest utility first so `ring-offset-*` can't be mis-read as `ring-*`.
  const utils = [...utilities].sort((a, b) => b.length - a.length);
  const out: ColorClass[] = [];

  for (const className of classes.split(/\s+/).filter(Boolean)) {
    const parts = className.split(':');
    const bare = parts[parts.length - 1];
    const mods = parts.slice(0, -1);

    for (const utility of utils) {
      if (!bare.startsWith(`${utility}-`)) continue;
      const rest = bare.slice(utility.length + 1);
      const slash = rest.lastIndexOf('/');
      const role = slash >= 0 ? rest.slice(0, slash) : rest;
      const op = slash >= 0 ? Number(rest.slice(slash + 1)) : NaN;
      if (!roleSet.has(role)) continue;
      out.push({
        className,
        mods,
        state: (mods.find((m) => STATE_KEYS.has(m)) as StateKey | undefined) ?? null,
        utility,
        role,
        opacity: Number.isFinite(op) ? op : null,
      });
      break;
    }
  }
  return out;
}

/** Rebuild a class token with a different role and/or opacity. */
export function buildColorClass(
  base: Pick<ColorClass, 'mods' | 'utility'>,
  next: { role: string; opacity: number | null },
): string {
  const op = next.opacity != null && next.opacity < 100 ? `/${next.opacity}` : '';
  return [...base.mods, `${base.utility}-${next.role}${op}`].join(':');
}

/**
 * One editable cell of the state matrix: a (state, utility) pair, the class that
 * currently implements it (if any), and the resting-state class it derives from.
 * A slot with `current === null` is an offer to *introduce* the state.
 */
export interface StateSlot {
  id: string;
  state: StateKey;
  utility: string;
  current: ColorClass | null;
  base: ColorClass | null;
}

/**
 * Build the state matrix for one CVA scope: every state × every colour utility
 * that either already has a state class or has a resting class to derive from.
 */
export function stateSlots(classes: string, roles: string[], utilities: string[]): StateSlot[] {
  const parsed = parseColorClasses(classes, roles, utilities);
  const restingByUtility = new Map<string, ColorClass>();
  for (const c of parsed) if (c.state === null && !restingByUtility.has(c.utility)) restingByUtility.set(c.utility, c);

  const stateByKey = new Map<string, ColorClass>();
  for (const c of parsed) if (c.state) stateByKey.set(`${c.state}|${c.utility}`, c);

  const utilityOrder = (u: string) =>
    STATE_UTILITIES.indexOf(u) === -1 ? STATE_UTILITIES.length : STATE_UTILITIES.indexOf(u);
  const utilities_ = [...new Set([...restingByUtility.keys(), ...parsed.filter((c) => c.state).map((c) => c.utility)])]
    .filter((u) => STATE_UTILITIES.includes(u))
    .sort((a, b) => utilityOrder(a) - utilityOrder(b));

  const slots: StateSlot[] = [];
  for (const { key } of STATES) {
    for (const utility of utilities_) {
      const current = stateByKey.get(`${key}|${utility}`) ?? null;
      const base = restingByUtility.get(utility) ?? null;
      if (!current && !base) continue;
      slots.push({ id: `${key}|${utility}`, state: key, utility, current, base });
    }
  }
  return slots;
}

/**
 * The class tokens that would be active if `state` were engaged, with the state
 * modifier stripped so they apply unconditionally.
 *
 * This is what powers the preview's state simulator. CSS pseudo-classes cannot
 * be forced from JavaScript, so instead of faking `:hover` we promote the
 * `hover:`-prefixed utilities to unprefixed ones and let `twMerge` win — the
 * painted result is identical to a real hover, without asking the user to keep a
 * cursor still while they read the panel. Other modifiers (`dark:`) are kept,
 * since the theme wrapper still decides whether they match.
 */
export function forcedStateClasses(classes: string, state: StateKey): string[] {
  const out: string[] = [];
  for (const token of classes.split(/\s+/).filter(Boolean)) {
    const parts = token.split(':');
    if (parts.length < 2) continue;
    const mods = parts.slice(0, -1);
    const at = mods.indexOf(state);
    if (at === -1) continue;
    out.push([...mods.filter((_, i) => i !== at), parts[parts.length - 1]].join(':'));
  }
  return out;
}

/**
 * The `color-mix()` expression a `/<opacity>` modifier resolves to. Seeding a
 * promoted state token with this keeps the promotion behaviour-preserving AND
 * theme-aware: `var(--primary)` still resolves per theme, so one value works in
 * both `light` and `dark`.
 */
export function derivedStateValue(role: string, opacity: number | null): string {
  if (opacity == null || opacity >= 100) return `var(--${role})`;
  return `color-mix(in oklab, var(--${role}) ${opacity}%, transparent)`;
}

/** `primary` + `hover` → `primary-hover` (the promoted token's kebab key). */
export const promotedTokenKey = (role: string, state: StateKey) =>
  `${role}-${state === 'focus-visible' ? 'focus' : state}`;
