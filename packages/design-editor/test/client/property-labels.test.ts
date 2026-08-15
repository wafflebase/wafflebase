import { describe, expect, it } from 'vitest';
import { joinPropertyLabels, propertyLabel, scaleLabel } from '../../src/client/property-labels.ts';

describe('propertyLabel', () => {
  it('names a known utility', () => {
    expect(propertyLabel('bg')).toBe('Background Color');
  });

  it('falls back to the utility itself rather than to nothing', () => {
    // An unknown utility still has to render something the user can read.
    expect(propertyLabel('caret')).toBe('caret color');
  });
});

describe('scaleLabel', () => {
  it('answers by category before consulting the spacing map', () => {
    expect(scaleLabel('radius', 'rounded')).toBe('Border Radius');
    expect(scaleLabel('fontSize', 'text')).toBe('Font Size');
  });

  it('uses the spacing map for anything else', () => {
    expect(scaleLabel('spacing', 'px')).toBe('Padding X');
    expect(scaleLabel('spacing', 'zzz')).toBe('zzz');
  });
});

describe('joinPropertyLabels', () => {
  it('joins with a middot', () => {
    expect(joinPropertyLabels(['bg', 'ring'])).toBe('Background Color · Outline (Ring)');
  });

  it('de-duplicates by LABEL, not by utility', () => {
    // `outline` and `ring` are distinct utilities; `ring` reads "Outline (Ring)" and
    // `outline` reads "Outline", so both survive. Two utilities that share a label
    // must collapse to one — this is the case a naive Set over utilities gets wrong.
    expect(joinPropertyLabels(['bg', 'bg'])).toBe('Background Color');
  });

  it('is empty for no utilities', () => {
    expect(joinPropertyLabels([])).toBe('');
  });
});
