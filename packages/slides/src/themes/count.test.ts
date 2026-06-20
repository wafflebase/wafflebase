import { describe, it, expect } from 'vitest';
import { BUILT_IN_THEMES } from './index';

const EXPECTED_ORDER = [
  'default-light', 'default-dark', 'streamline', 'swiss', 'paradigm',
  'material', 'shift', 'momentum', 'focus', 'luxe', 'modern-writer',
  'coral', 'spearmint', 'pop', 'tropic', 'marina', 'geometric', 'plum',
  'slate', 'forest', 'spotlight', 'beach-day', 'wafflebase',
];

describe('catalog ordering', () => {
  it('has 23 themes in the Google-Slides-parity order', () => {
    expect(BUILT_IN_THEMES.map((t) => t.id)).toEqual(EXPECTED_ORDER);
  });
});
