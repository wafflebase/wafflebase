import { describe, it, expect } from 'vitest';
import {
  pruneShadowedRangeStylePatches,
  RangeStylePatch,
} from '../../src/model/range-styles';

describe('pruneShadowedRangeStylePatches', () => {
  it('should remove shadowed keys from earlier patch when later patch covers same range', () => {
    const patches: RangeStylePatch[] = [
      { range: [{ r: 1, c: 1 }, { r: 3, c: 3 }], style: { b: true, bg: '#ff0' } },
      { range: [{ r: 1, c: 1 }, { r: 3, c: 3 }], style: { b: false, i: true } },
    ];
    const result = pruneShadowedRangeStylePatches(patches);
    expect(result).toEqual([
      { range: [{ r: 1, c: 1 }, { r: 3, c: 3 }], style: { bg: '#ff0' } },
      { range: [{ r: 1, c: 1 }, { r: 3, c: 3 }], style: { b: false, i: true } },
    ]);
  });

  it('should delete patch entirely when all keys are shadowed', () => {
    const patches: RangeStylePatch[] = [
      { range: [{ r: 1, c: 1 }, { r: 3, c: 3 }], style: { b: true } },
      { range: [{ r: 1, c: 1 }, { r: 3, c: 3 }], style: { b: false } },
    ];
    const result = pruneShadowedRangeStylePatches(patches);
    expect(result).toEqual([
      { range: [{ r: 1, c: 1 }, { r: 3, c: 3 }], style: { b: false } },
    ]);
  });

  it('should prune keys when later patch has larger containing range', () => {
    const patches: RangeStylePatch[] = [
      { range: [{ r: 2, c: 2 }, { r: 3, c: 3 }], style: { b: true, bg: '#ff0' } },
      { range: [{ r: 1, c: 1 }, { r: 5, c: 5 }], style: { b: true } },
    ];
    const result = pruneShadowedRangeStylePatches(patches);
    expect(result).toEqual([
      { range: [{ r: 2, c: 2 }, { r: 3, c: 3 }], style: { bg: '#ff0' } },
      { range: [{ r: 1, c: 1 }, { r: 5, c: 5 }], style: { b: true } },
    ]);
  });

  it('should handle multi-layer stacking with progressive key coverage', () => {
    const patches: RangeStylePatch[] = [
      { range: [{ r: 1, c: 1 }, { r: 3, c: 3 }], style: { b: true, bg: '#ff0', i: true } },
      { range: [{ r: 1, c: 1 }, { r: 3, c: 3 }], style: { b: false, i: true } },
      { range: [{ r: 1, c: 1 }, { r: 3, c: 3 }], style: { bg: '#0ff' } },
    ];
    const result = pruneShadowedRangeStylePatches(patches);
    // patch 0: b shadowed by patch 1, bg shadowed by patch 2, i shadowed by patch 1 -> all gone
    // patch 1: b not shadowed by patch 2 (no b key), i not shadowed -> kept
    expect(result).toEqual([
      { range: [{ r: 1, c: 1 }, { r: 3, c: 3 }], style: { b: false, i: true } },
      { range: [{ r: 1, c: 1 }, { r: 3, c: 3 }], style: { bg: '#0ff' } },
    ]);
  });

  it('should not prune keys when ranges only partially overlap', () => {
    const patches: RangeStylePatch[] = [
      { range: [{ r: 1, c: 1 }, { r: 3, c: 3 }], style: { b: true } },
      { range: [{ r: 2, c: 2 }, { r: 4, c: 4 }], style: { b: false } },
    ];
    const result = pruneShadowedRangeStylePatches(patches);
    expect(result).toEqual([
      { range: [{ r: 1, c: 1 }, { r: 3, c: 3 }], style: { b: true } },
      { range: [{ r: 2, c: 2 }, { r: 4, c: 4 }], style: { b: false } },
    ]);
  });

  it('should still work for identical style + contained range (regression)', () => {
    const patches: RangeStylePatch[] = [
      { range: [{ r: 2, c: 2 }, { r: 3, c: 3 }], style: { b: true } },
      { range: [{ r: 1, c: 1 }, { r: 5, c: 5 }], style: { b: true } },
    ];
    const result = pruneShadowedRangeStylePatches(patches);
    expect(result).toEqual([
      { range: [{ r: 1, c: 1 }, { r: 5, c: 5 }], style: { b: true } },
    ]);
  });
});
