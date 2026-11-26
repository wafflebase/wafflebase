import {
  ALL_CATEGORY_SLUGS,
  childrenOf,
  LEGACY_CATEGORY_ALIASES,
  resolveCategory,
  type TemplateCategorySlug,
} from '@wafflebase/core/templates';

/**
 * The template gallery's category taxonomy (docs/design/template-gallery.md,
 * docs/design/template-catalog-scaling.md §1 "Taxonomy v2").
 *
 * The tree itself lives in `@wafflebase/core/templates`, shared with the
 * frontend so the picker and this enforcing side read one definition. It is a
 * code constant rather than a table — see that module for why.
 */
export { ALL_CATEGORY_SLUGS };
export type { TemplateCategorySlug };

/**
 * What browse's `?category=` accepts: every slug, plus the v1 labels for one
 * release so an old link or client keeps filtering. Writes accept slugs only
 * (`ALL_CATEGORY_SLUGS`).
 */
export const BROWSE_CATEGORY_VALUES: readonly string[] = [
  ...ALL_CATEGORY_SLUGS,
  ...Object.keys(LEGACY_CATEGORY_ALIASES),
];

/**
 * The stored values a browse for `category` matches: the value itself, plus
 * every leaf when it is a top — so `work` finds `work/meeting` too. A legacy
 * label is resolved first. Anything unknown matches only itself, which finds
 * nothing rather than widening the query.
 */
export function categoryFilterValues(category: string): string[] {
  const slug = resolveCategory(category);
  if (!slug) return [category];
  return [slug, ...childrenOf(slug)];
}

/** Tags are freeform, but a listing may carry at most this many. */
export const MAX_TEMPLATE_TAGS = 10;

/** Longest a single tag may be, after normalization. */
export const MAX_TEMPLATE_TAG_LENGTH = 40;

/**
 * Normalize a tag list on write: trim, lowercase, drop empties, de-duplicate,
 * and cap the count.
 *
 * Without this `Budget`, `budget ` and `budget` are three different facets in
 * the gallery's tag filter, which is the failure mode that makes freeform tags
 * useless. Lowercasing is the one lossy step and it is deliberate: a facet is
 * an identity, not a display string.
 *
 * Order is preserved so the publisher's first tag stays first — de-duplication
 * keeps the earliest occurrence.
 */
export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().toLowerCase().slice(0, MAX_TEMPLATE_TAG_LENGTH);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length === MAX_TEMPLATE_TAGS) break;
  }
  return out;
}
