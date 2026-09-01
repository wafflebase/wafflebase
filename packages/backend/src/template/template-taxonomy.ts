/**
 * The template gallery's category taxonomy (docs/design/template-gallery.md).
 *
 * A **constant, not a table**. Facets are only useful if the values are
 * closed, and a per-workspace table would let each workspace invent its own
 * spelling of "Finance" — which the public gallery would then have to merge
 * after the fact. The list changes at release cadence, so a deploy is the
 * right granularity for changing it.
 */
export const TEMPLATE_CATEGORIES = [
  'Business',
  'Education',
  'Personal',
  'Project management',
  'Finance',
  'Marketing',
  'Design',
  'Other',
] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

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
