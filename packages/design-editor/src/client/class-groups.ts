/*
 * WHICH CONTROLS A NODE ACTUALLY NEEDS, read off the classes it already has.
 *
 * The editor shipped a FIXED set — direction, align, justify, gap, width, height —
 * on every node. That is wrong in both directions at once: a node with no `flex` gets
 * four flex controls that do nothing useful, and a node carrying `py-3 bg-card
 * space-x-2` gets no way to touch any of them. The panel was equally unhelpful
 * everywhere.
 *
 * So the groups are DETECTED, not assumed. A group whose prefix appears on the node is
 * relevant and opens; the rest stay behind "Add a control", because detection alone
 * cannot introduce a property the node has never had — a node with no `bg-` would have
 * no way to gain one.
 */

/** One adjustable property: a label, the classes it owns, and how to spot it. */
export interface ClassGroup {
  key: string;
  label: string;
  /**
   * The mutually exclusive options. Picking one removes the others — the primitive
   * `setExclusive` is built on.
   */
  options: readonly string[];
  /**
   * Does this node already carry the property?
   *
   * Matched on the CLASS, not on a substring of the whole string: `bg-card` must not
   * make `Gap` relevant because "g" appears in it, and a scan over the joined string
   * did exactly that in an earlier draft.
   */
  owns: (cls: string) => boolean;
}

/**
 * Every prefix any group claims. Longest first, which is the whole trick.
 *
 * A class cannot be split into property and value by SHAPE: `space-x-2` is the
 * property `space-x` with value `2`, and `bg-card` is the property `bg` with value
 * `card`. Both are `word-word-…`. A greedy regex reads the first as `space-x` and the
 * second as `bg-card`; a lazy one reads the first as `space`. Neither is right,
 * because the answer is not in the string — it is in which properties exist.
 *
 * So the set is the authority, and the longest match wins.
 */
const KNOWN_PREFIXES: readonly string[] = [
  'inline-flex',
  'inline-block',
  'space-x',
  'space-y',
  'gap-x',
  'gap-y',
  'items',
  'justify',
  'rounded',
  'block',
  'inline',
  'hidden',
  'flex',
  'grid',
  'font',
  'text',
  'gap',
  'px',
  'py',
  'pt',
  'pr',
  'pb',
  'pl',
  'mx',
  'my',
  'mt',
  'mr',
  'mb',
  'ml',
  'bg',
  'p',
  'm',
].sort((a, b) => b.length - a.length);

/** `p-2`, `px-4`, `-mt-1`, `hover:bg-card` → the property it sets, or null. */
export function prefixOf(cls: string): string | null {
  // A variant (`hover:`, `md:`) qualifies WHEN a class applies, not WHICH property it
  // sets. Reading the prefix off the variant would file `md:flex` under `md`.
  const bare = cls.slice(cls.lastIndexOf(':') + 1).replace(/^-/, '');
  for (const p of KNOWN_PREFIXES) {
    // Exact for a bare utility (`flex`), or followed by `-` so `p` does not swallow
    // `px-4` — which would file every padding-x as padding shorthand.
    if (bare === p || bare.startsWith(`${p}-`)) return p;
  }
  return null;
}

const byPrefix =
  (...prefixes: string[]) =>
  (cls: string): boolean => {
    const p = prefixOf(cls);
    return p !== null && prefixes.includes(p);
  };

const scale = (prefix: string, steps: readonly string[]) => steps.map((s) => `${prefix}-${s}`);
const SPACE_STEPS = ['0', '1', '2', '3', '4', '6', '8', '12'] as const;

export const FLEX_DIRECTION = ['flex-row', 'flex-col'] as const;
export const ALIGN_ITEMS = ['items-start', 'items-center', 'items-end', 'items-stretch'] as const;
export const JUSTIFY = [
  'justify-start',
  'justify-center',
  'justify-between',
  'justify-around',
  'justify-evenly',
] as const;
export const GAP = scale('gap', SPACE_STEPS);

/**
 * Every group the editor can offer, in the order it offers them.
 *
 * Layout first because it decides where things are, then spacing, then paint. That is
 * the order a person reasons about a box, and it keeps the two most-used groups from
 * being pushed below a colour picker.
 */
export const CLASS_GROUPS: readonly ClassGroup[] = [
  {
    key: 'display',
    label: 'Display',
    options: ['block', 'inline-flex', 'flex', 'grid', 'hidden'],
    owns: byPrefix('block', 'inline-flex', 'flex', 'grid', 'hidden', 'inline', 'inline-block'),
  },
  {
    key: 'direction',
    label: 'Direction',
    options: FLEX_DIRECTION,
    // `inline-flex` IS a flex container, so it takes a direction exactly as `flex` does.
    // Matching only `flex` left every inline-flex node — every shadcn Button among them —
    // without the one control its display mode makes meaningful.
    owns: byPrefix('flex', 'inline-flex'),
  },
  { key: 'align', label: 'Align', options: ALIGN_ITEMS, owns: byPrefix('items') },
  { key: 'justify', label: 'Justify', options: JUSTIFY, owns: byPrefix('justify') },
  { key: 'gap', label: 'Gap', options: GAP, owns: byPrefix('gap', 'gap-x', 'gap-y') },
  {
    key: 'padding',
    label: 'Padding',
    options: scale('p', SPACE_STEPS),
    owns: byPrefix('p', 'px', 'py', 'pt', 'pr', 'pb', 'pl'),
  },
  {
    key: 'margin',
    label: 'Margin',
    options: scale('m', SPACE_STEPS),
    owns: byPrefix('m', 'mx', 'my', 'mt', 'mr', 'mb', 'ml'),
  },
  {
    key: 'space',
    label: 'Space between',
    options: scale('space-x', SPACE_STEPS),
    owns: byPrefix('space-x', 'space-y'),
  },
  {
    key: 'radius',
    label: 'Radius',
    options: ['rounded-none', 'rounded-sm', 'rounded-md', 'rounded-lg', 'rounded-full'],
    owns: byPrefix('rounded'),
  },
  {
    key: 'text',
    label: 'Text size',
    options: ['text-xs', 'text-sm', 'text-base', 'text-lg', 'text-xl', 'text-2xl'],
    // `text-` is also how a COLOUR is written (`text-muted-foreground`), so this group
    // opens for either and only offers the sizes. Filing colour separately would need
    // the token registry, which this module deliberately does not import.
    owns: byPrefix('text'),
  },
  {
    key: 'weight',
    label: 'Weight',
    options: ['font-normal', 'font-medium', 'font-semibold', 'font-bold'],
    owns: byPrefix('font'),
  },
];

/**
 * The groups this node already uses, and the rest — in `CLASS_GROUPS` order.
 *
 * `relevant` is what opens. `rest` is what "Add a control" offers, so a property the
 * node has never carried is still reachable: detection decides what is LIKELY, never
 * what is possible.
 */
export function groupsFor(classes: readonly string[]): {
  relevant: ClassGroup[];
  rest: ClassGroup[];
} {
  const relevant: ClassGroup[] = [];
  const rest: ClassGroup[] = [];
  for (const g of CLASS_GROUPS) {
    (classes.some((c) => g.owns(c)) ? relevant : rest).push(g);
  }
  return { relevant, rest };
}
