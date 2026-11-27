/**
 * The template gallery's category taxonomy (docs/design/template-gallery.md,
 * docs/design/template-catalog-scaling.md §1 "Taxonomy v2").
 *
 * A **constant, not a table**. Facets are only useful if the values are
 * closed, and a per-workspace table would let each workspace invent its own
 * spelling of "Finance" — which the public gallery would then have to merge
 * after the fact. The tree changes at release cadence, so a deploy is the
 * right granularity for changing it.
 *
 * It lives here rather than in the backend so the backend (which enforces it)
 * and the frontend (which offers it) read one definition and cannot drift.
 *
 * Two levels. A stored `category` is either a bare top slug (`"work"`) or
 * `"top/leaf"` (`"work/meeting"`); browsing a top matches the top itself and
 * every one of its leaves.
 *
 * Labels are English for now. They are keyed by slug so a later i18n pass can
 * replace {@link categoryLabel} without touching stored data.
 */

export type TemplateCategoryLeaf = {
  /** The leaf segment only (`"meeting"`); the stored value is `top/leaf`. */
  readonly slug: string;
  readonly label: string;
};

export type TemplateCategoryTop = {
  readonly slug: string;
  readonly label: string;
  /** Display order, in steps of 10 so a top can be slotted in later. */
  readonly sort: number;
  readonly children: readonly TemplateCategoryLeaf[];
};

/**
 * The tree as a literal: `as const` so {@link TemplateCategorySlug} is derived
 * from it rather than written out a second time, `satisfies` so its shape is
 * still checked. Exported widened, as {@link TEMPLATE_CATEGORY_TREE}: the
 * literal type is a union of tuples (one of them empty), and calling `find` /
 * `map` on that narrows a callback's parameter to `never` on some compilers.
 */
const TREE_LITERAL = [
  {
    slug: 'work',
    label: 'Work',
    sort: 10,
    children: [
      { slug: 'pitch-proposal', label: 'Pitch & proposal' },
      { slug: 'report-review', label: 'Report & review' },
      { slug: 'plan-roadmap', label: 'Plan & roadmap' },
      { slug: 'meeting', label: 'Meeting & 1:1' },
      { slug: 'retro-workshop', label: 'Retro & workshop' },
      { slug: 'project-tracker', label: 'Project tracker' },
    ],
  },
  {
    slug: 'finance',
    label: 'Finance',
    sort: 20,
    children: [
      { slug: 'budget', label: 'Budget' },
      { slug: 'invoice-quote', label: 'Invoice & quote' },
      { slug: 'financial-model', label: 'Financial model' },
    ],
  },
  {
    slug: 'education',
    label: 'Education',
    sort: 30,
    children: [
      { slug: 'lesson-lecture', label: 'Lesson & lecture' },
      { slug: 'study-notes', label: 'Study notes' },
      { slug: 'classroom-admin', label: 'Classroom admin' },
    ],
  },
  {
    slug: 'marketing',
    label: 'Marketing',
    sort: 40,
    children: [
      { slug: 'campaign', label: 'Campaign' },
      { slug: 'content-calendar', label: 'Content calendar' },
      { slug: 'brand-press', label: 'Brand & press' },
    ],
  },
  {
    slug: 'people',
    label: 'HR & people',
    sort: 50,
    children: [
      { slug: 'resume-cover-letter', label: 'Resume & cover letter' },
      { slug: 'onboarding', label: 'Onboarding' },
      { slug: 'directory-org', label: 'Directory & org chart' },
    ],
  },
  {
    slug: 'personal',
    label: 'Personal',
    sort: 60,
    children: [
      { slug: 'personal-finance', label: 'Personal finance' },
      { slug: 'planner-journal', label: 'Planner & journal' },
      { slug: 'travel-events', label: 'Travel & events' },
    ],
  },
  {
    slug: 'design',
    label: 'Design',
    sort: 70,
    children: [
      { slug: 'design-review', label: 'Design review' },
      { slug: 'moodboard', label: 'Moodboard' },
    ],
  },
  { slug: 'other', label: 'Other', sort: 990, children: [] },
] as const satisfies readonly TemplateCategoryTop[];

/** A top's own slug plus `top/leaf` for each of its leaves. */
type SlugsOf<T> = T extends {
  readonly slug: infer Top extends string;
  readonly children: readonly (infer Leaf)[];
}
  ?
      | Top
      | (Leaf extends { readonly slug: infer L extends string }
          ? `${Top}/${L}`
          : never)
  : never;

/**
 * Every stored value a listing's `category` may hold, as a string-literal
 * union so a seed with a typo or a legacy label is a compile error. Derived
 * from the tree, so the tree is the only list.
 */
export type TemplateCategorySlug = SlugsOf<(typeof TREE_LITERAL)[number]>;

/** Tops in display order (ascending `sort`); leaves in display order. */
export const TEMPLATE_CATEGORY_TREE: readonly TemplateCategoryTop[] =
  TREE_LITERAL;

/**
 * Every valid stored value, tops first-then-their-leaves in display order.
 * The cast only narrows the template literal TypeScript widens to `string`;
 * the union it narrows onto is derived from the same tree, so the two cannot
 * drift (a test still pins the exact list).
 */
export const ALL_CATEGORY_SLUGS: readonly TemplateCategorySlug[] =
  TEMPLATE_CATEGORY_TREE.flatMap((top) => [
    top.slug,
    ...top.children.map((leaf) => `${top.slug}/${leaf.slug}`),
  ]) as TemplateCategorySlug[];

const SLUG_SET: ReadonlySet<string> = new Set(ALL_CATEGORY_SLUGS);

export function isCategorySlug(value: string): value is TemplateCategorySlug {
  return SLUG_SET.has(value);
}

/**
 * The full `top/leaf` slugs under a top, in display order. Empty for a top
 * without leaves and for anything that is not a top slug.
 */
export function childrenOf(top: string): TemplateCategorySlug[] {
  const node = TEMPLATE_CATEGORY_TREE.find((t) => t.slug === top);
  if (!node) return [];
  return node.children.map(
    (leaf) => `${node.slug}/${leaf.slug}` as TemplateCategorySlug,
  );
}

/** The top segment of a slug (`"work/meeting"` → `"work"`). */
export function topOf(slug: string): string {
  const i = slug.indexOf('/');
  return i === -1 ? slug : slug.slice(0, i);
}

/**
 * The v1 closed labels, mapped onto their v2 slug. Accepted by browse for one
 * release so an old link or client keeps filtering; never accepted on write.
 * The same mapping is what the label → slug data migration applies.
 */
export const LEGACY_CATEGORY_ALIASES: Readonly<
  Record<string, TemplateCategorySlug>
> = {
  Business: 'work',
  'Project management': 'work/project-tracker',
  Education: 'education',
  Finance: 'finance',
  Marketing: 'marketing',
  Personal: 'personal',
  Design: 'design',
  Other: 'other',
};

/**
 * A slug, or a legacy label resolved through {@link LEGACY_CATEGORY_ALIASES};
 * `undefined` for anything else.
 */
export function resolveCategory(
  value: string,
): TemplateCategorySlug | undefined {
  if (isCategorySlug(value)) return value;
  return Object.prototype.hasOwnProperty.call(LEGACY_CATEGORY_ALIASES, value)
    ? LEGACY_CATEGORY_ALIASES[value]
    : undefined;
}

/**
 * The display label for a stored value: the leaf's label for `top/leaf`, the
 * top's label for a bare top. An unknown value (a row written before a slug
 * was removed) is shown as-is rather than hidden.
 */
export function categoryLabel(slug: string): string {
  const resolved = resolveCategory(slug);
  if (!resolved) return slug;
  const [topSlug, leafSlug] = resolved.split('/');
  const top = TEMPLATE_CATEGORY_TREE.find((t) => t.slug === topSlug);
  if (!top) return slug;
  if (!leafSlug) return top.label;
  return top.children.find((l) => l.slug === leafSlug)?.label ?? slug;
}
