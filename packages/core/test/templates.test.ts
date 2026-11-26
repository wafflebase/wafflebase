import { describe, it, expect } from 'vitest';
import {
  ALL_CATEGORY_SLUGS,
  categoryLabel,
  childrenOf,
  isCategorySlug,
  LEGACY_CATEGORY_ALIASES,
  resolveCategory,
  TEMPLATE_CATEGORY_TREE,
  topOf,
  type TemplateCategorySlug,
} from '../src/templates/index.ts';

// One key per member of the union: adding a slug to the union without listing
// it here (or the reverse) is a compile error, and the test below then pins
// the runtime list to the same set.
const UNION: Record<TemplateCategorySlug, true> = {
  work: true,
  'work/pitch-proposal': true,
  'work/report-review': true,
  'work/plan-roadmap': true,
  'work/meeting': true,
  'work/retro-workshop': true,
  'work/project-tracker': true,
  finance: true,
  'finance/budget': true,
  'finance/invoice-quote': true,
  'finance/financial-model': true,
  education: true,
  'education/lesson-lecture': true,
  'education/study-notes': true,
  'education/classroom-admin': true,
  marketing: true,
  'marketing/campaign': true,
  'marketing/content-calendar': true,
  'marketing/brand-press': true,
  people: true,
  'people/resume-cover-letter': true,
  'people/onboarding': true,
  'people/directory-org': true,
  personal: true,
  'personal/personal-finance': true,
  'personal/planner-journal': true,
  'personal/travel-events': true,
  design: true,
  'design/design-review': true,
  'design/moodboard': true,
  other: true,
};

describe('TEMPLATE_CATEGORY_TREE', () => {
  it('derives exactly the slugs of the TemplateCategorySlug union', () => {
    expect([...ALL_CATEGORY_SLUGS].sort()).toEqual(Object.keys(UNION).sort());
    expect(new Set(ALL_CATEGORY_SLUGS).size).toBe(ALL_CATEGORY_SLUGS.length);
  });

  it('keeps tops in ascending sort order, with Other last', () => {
    const sorts = TEMPLATE_CATEGORY_TREE.map((t) => t.sort);
    expect(sorts).toEqual([...sorts].sort((a, b) => a - b));
    expect(TEMPLATE_CATEGORY_TREE.at(-1)?.slug).toBe('other');
  });

  it('gives every option a distinct label', () => {
    // The picker is a flat list of tops and leaves; two equal labels would be
    // indistinguishable there, and `register:templates` picks options by name.
    const labels = TEMPLATE_CATEGORY_TREE.flatMap((t) => [
      t.label,
      ...t.children.map((l) => l.label),
    ]);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('uses URL-safe slugs with no nested separator', () => {
    for (const top of TEMPLATE_CATEGORY_TREE) {
      expect(top.slug).toMatch(/^[a-z][a-z-]*$/);
      for (const leaf of top.children)
        expect(leaf.slug).toMatch(/^[a-z][a-z-]*$/);
    }
  });
});

describe('childrenOf / topOf', () => {
  it('lists full leaf slugs under a top', () => {
    expect(childrenOf('design')).toEqual([
      'design/design-review',
      'design/moodboard',
    ]);
    expect(childrenOf('other')).toEqual([]);
    expect(childrenOf('work/meeting')).toEqual([]);
    expect(childrenOf('nope')).toEqual([]);
  });

  it('takes the top segment', () => {
    expect(topOf('work/meeting')).toBe('work');
    expect(topOf('finance')).toBe('finance');
  });
});

describe('legacy aliases', () => {
  it('maps every v1 label onto a valid slug', () => {
    expect(Object.keys(LEGACY_CATEGORY_ALIASES).sort()).toEqual(
      [
        'Business',
        'Design',
        'Education',
        'Finance',
        'Marketing',
        'Other',
        'Personal',
        'Project management',
      ].sort(),
    );
    for (const slug of Object.values(LEGACY_CATEGORY_ALIASES)) {
      expect(isCategorySlug(slug)).toBe(true);
    }
    expect(LEGACY_CATEGORY_ALIASES['Project management']).toBe(
      'work/project-tracker',
    );
  });

  it('resolves slugs as-is, labels through the alias, and nothing else', () => {
    expect(resolveCategory('work/meeting')).toBe('work/meeting');
    expect(resolveCategory('Business')).toBe('work');
    expect(resolveCategory('business')).toBeUndefined();
    expect(resolveCategory('toString')).toBeUndefined();
    expect(resolveCategory('work/')).toBeUndefined();
  });
});

describe('categoryLabel', () => {
  it('labels tops, leaves, legacy labels and unknown values', () => {
    expect(categoryLabel('people')).toBe('HR & people');
    expect(categoryLabel('work/meeting')).toBe('Meeting & 1:1');
    expect(categoryLabel('Project management')).toBe('Project tracker');
    expect(categoryLabel('Gardening')).toBe('Gardening');
  });
});
