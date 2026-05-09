import { describe, it, expect } from 'vitest';
import { PATH_BUILDERS, ADJUSTMENT_SPECS } from './index';

describe('shape registry', () => {
  it('exposes empty maps as the initial state', () => {
    // Builders/specs are added one task at a time; the registry
    // contract (Map shape) is what we lock in here.
    expect(PATH_BUILDERS).toBeInstanceOf(Map);
    expect(ADJUSTMENT_SPECS).toBeInstanceOf(Map);
  });
});
