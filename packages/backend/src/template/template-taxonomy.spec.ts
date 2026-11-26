import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LEGACY_CATEGORY_ALIASES } from '@wafflebase/core/templates';
import {
  ALL_CATEGORY_SLUGS,
  BROWSE_CATEGORY_VALUES,
  categoryFilterValues,
  normalizeTags,
} from './template-taxonomy';

describe('normalizeTags', () => {
  it('collapses casing and surrounding space into one facet', () => {
    // The whole point: without this, `Budget`, `budget ` and `budget` are
    // three separate entries in the gallery's tag filter.
    expect(normalizeTags(['Budget', 'budget ', ' BUDGET'])).toEqual(['budget']);
  });

  it('preserves the publisher’s order, keeping the first occurrence', () => {
    expect(normalizeTags(['ops', 'budget', 'Ops'])).toEqual(['ops', 'budget']);
  });

  it('drops empty and whitespace-only tags', () => {
    expect(normalizeTags(['', '   ', 'ops'])).toEqual(['ops']);
  });

  it('caps the count at 10', () => {
    const many = Array.from({ length: 25 }, (_, i) => `tag${i}`);
    expect(normalizeTags(many)).toHaveLength(10);
    expect(normalizeTags(many)[9]).toBe('tag9');
  });

  it('truncates an over-long tag rather than rejecting it', () => {
    // Validation already bounds the input; this is the storage-side floor, so
    // it must not throw on something that slipped past.
    expect(normalizeTags(['a'.repeat(60)])[0]).toHaveLength(40);
  });

  it('de-duplicates after truncation, not before', () => {
    const long = 'a'.repeat(45);
    const longer = 'a'.repeat(50);
    expect(normalizeTags([long, longer])).toEqual(['a'.repeat(40)]);
  });

  it('returns an empty array for an empty input', () => {
    expect(normalizeTags([])).toEqual([]);
  });
});

describe('category taxonomy', () => {
  it('is closed and contains an explicit escape hatch', () => {
    // A closed list is what makes the category facet meaningful; "other" is
    // what keeps it from forcing a wrong choice.
    expect(ALL_CATEGORY_SLUGS).toContain('other');
    expect(new Set(ALL_CATEGORY_SLUGS).size).toBe(ALL_CATEGORY_SLUGS.length);
  });

  it('accepts legacy labels on browse only', () => {
    expect(BROWSE_CATEGORY_VALUES).toContain('Business');
    expect(BROWSE_CATEGORY_VALUES).toContain('work/meeting');
    expect(ALL_CATEGORY_SLUGS).not.toContain('Business' as never);
  });
});

describe('categoryFilterValues', () => {
  it('expands a top into itself and every leaf', () => {
    expect(categoryFilterValues('design')).toEqual([
      'design',
      'design/design-review',
      'design/moodboard',
    ]);
  });

  it('matches a leaf exactly', () => {
    expect(categoryFilterValues('work/meeting')).toEqual(['work/meeting']);
  });

  it('resolves a legacy label before expanding', () => {
    expect(categoryFilterValues('Project management')).toEqual([
      'work/project-tracker',
    ]);
    expect(categoryFilterValues('Business')).toContain('work/project-tracker');
  });

  it('matches only itself for an unknown value, never widening', () => {
    expect(categoryFilterValues('Gardening')).toEqual(['Gardening']);
  });
});

describe('label → slug data migration', () => {
  it('applies exactly the legacy alias map', () => {
    // The SQL migration and the browse alias are two copies of one mapping;
    // this keeps them from disagreeing about where an old card went.
    const sql = readFileSync(
      join(
        __dirname,
        '../../prisma/migrations/20261126000000_template_category_slugs/migration.sql',
      ),
      'utf8',
    );
    const pairs = [...sql.matchAll(/WHEN '([^']+)' THEN '([^']+)'/g)].map(
      (m) => [m[1], m[2]],
    );
    expect(Object.fromEntries(pairs)).toEqual(LEGACY_CATEGORY_ALIASES);
  });
});
