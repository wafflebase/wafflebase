import { describe, it, expect } from 'vitest';
import { PATH_BUILDERS, ADJUSTMENT_SPECS, ADJUSTMENT_HANDLES } from './index';

describe('shape registry', () => {
  it('exposes empty maps as the initial state', () => {
    // Builders/specs are added one task at a time; the registry
    // contract (Map shape) is what we lock in here.
    expect(PATH_BUILDERS).toBeInstanceOf(Map);
    expect(ADJUSTMENT_SPECS).toBeInstanceOf(Map);
  });
});

describe('ADJUSTMENT_HANDLES registry', () => {
  it('is a Map', () => {
    expect(ADJUSTMENT_HANDLES).toBeInstanceOf(Map);
  });

  it('every registered kind also has a path builder', () => {
    for (const kind of ADJUSTMENT_HANDLES.keys()) {
      expect(PATH_BUILDERS.has(kind)).toBe(true);
    }
  });

  it('every registered kind also has an adjustment spec', () => {
    for (const kind of ADJUSTMENT_HANDLES.keys()) {
      expect(ADJUSTMENT_SPECS.has(kind)).toBe(true);
    }
  });

  it('every adjustment spec has a matching handle (P3-A.2 closure)', () => {
    // After the P3-A.2 sweep this invariant is upheld; if a future
    // shape declares ADJUSTMENT_SPECS but forgets ADJUSTMENT_HANDLES,
    // it would silently render inert (default-only) so the test
    // surfaces the gap.
    for (const kind of ADJUSTMENT_SPECS.keys()) {
      expect(ADJUSTMENT_HANDLES.has(kind)).toBe(true);
    }
  });

  it('SPECS and HANDLES have the same size', () => {
    expect(ADJUSTMENT_HANDLES.size).toBe(ADJUSTMENT_SPECS.size);
  });
});
