import { normalizeTags, TEMPLATE_CATEGORIES } from './template-taxonomy';

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

describe('TEMPLATE_CATEGORIES', () => {
  it('is closed and contains an explicit escape hatch', () => {
    // A closed list is what makes the category facet meaningful; "Other" is
    // what keeps it from forcing a wrong choice.
    expect(TEMPLATE_CATEGORIES).toContain('Other');
    expect(new Set(TEMPLATE_CATEGORIES).size).toBe(TEMPLATE_CATEGORIES.length);
  });
});
