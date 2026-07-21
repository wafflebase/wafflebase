import { describe, it, expect } from 'vitest';
import {
  coalesceAdjacentRangeStylePatches,
  coalesceRangeStylePatchesMaximal,
  pruneShadowedRangeStylePatches,
  RangeStylePatch,
  resolveRangeStyleAt,
} from '../../src/model/worksheet/range-styles';
import { CellStyle } from '../../src/model/core/types';

/**
 * Expands a patch list to a per-cell resolved-style map over the bounding box,
 * so two patch lists can be compared for cell-by-cell equivalence.
 */
function resolveGrid(
  patches: RangeStylePatch[],
): Map<string, CellStyle | undefined> {
  const grid = new Map<string, CellStyle | undefined>();
  let maxR = 0;
  let maxC = 0;
  for (const p of patches) {
    maxR = Math.max(maxR, p.range[1].r);
    maxC = Math.max(maxC, p.range[1].c);
  }
  for (let r = 1; r <= maxR; r += 1) {
    for (let c = 1; c <= maxC; c += 1) {
      grid.set(`${r},${c}`, resolveRangeStyleAt(patches, r, c));
    }
  }
  return grid;
}

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

describe('coalesceRangeStylePatchesMaximal', () => {
  const HEADER: CellStyle = { b: true, bg: '#eee' };
  const LABEL: CellStyle = { i: true };
  const BODY: CellStyle = { bg: '#fff' };

  // A header row + label column + body region: no whole row or column is a
  // single style, so the adjacent 2-pass merge cannot collapse it well. Built
  // as one 1x1 patch per cell, the way the xlsx importer emits them.
  function headerLabelBodyPatches(rows: number, cols: number): RangeStylePatch[] {
    const patches: RangeStylePatch[] = [];
    for (let r = 1; r <= rows; r += 1) {
      for (let c = 1; c <= cols; c += 1) {
        const style = r === 1 ? HEADER : c === 1 ? LABEL : BODY;
        patches.push({ range: [{ r, c }, { r, c }], style: { ...style } });
      }
    }
    return patches;
  }

  it('preserves the resolved style of every cell', () => {
    const input = headerLabelBodyPatches(20, 10);
    const tiled = coalesceRangeStylePatchesMaximal(input);
    expect(resolveGrid(tiled)).toEqual(resolveGrid(input));
  });

  it('produces far fewer patches than the adjacent 2-pass merge', () => {
    const input = headerLabelBodyPatches(20, 10);
    const adjacent = coalesceAdjacentRangeStylePatches(
      coalesceAdjacentRangeStylePatches(input, 'column'),
      'row',
    );
    const tiled = coalesceRangeStylePatchesMaximal(input);
    // header (1) + label col below header (1) + body block (1) = 3 rectangles.
    expect(tiled.length).toBe(3);
    expect(tiled.length).toBeLessThan(adjacent.length);
  });

  it('emits non-overlapping rectangles', () => {
    const tiled = coalesceRangeStylePatchesMaximal(
      headerLabelBodyPatches(8, 8),
    );
    const seen = new Set<string>();
    for (const p of tiled) {
      for (let r = p.range[0].r; r <= p.range[1].r; r += 1) {
        for (let c = p.range[0].c; c <= p.range[1].c; c += 1) {
          const key = `${r},${c}`;
          expect(seen.has(key)).toBe(false);
          seen.add(key);
        }
      }
    }
  });

  it('honors apply-order overrides on overlapping input', () => {
    const input: RangeStylePatch[] = [
      { range: [{ r: 1, c: 1 }, { r: 3, c: 3 }], style: { bg: '#fff' } },
      // later patch wins on the overlap
      { range: [{ r: 2, c: 2 }, { r: 2, c: 2 }], style: { bg: '#000' } },
    ];
    const tiled = coalesceRangeStylePatchesMaximal(input);
    expect(resolveGrid(tiled)).toEqual(resolveGrid(input));
  });

  it('merges overlapping partial styles key by key, not whole-style', () => {
    // The later patch only sets bg; the bold from the earlier patch must
    // survive on the overlap cell, matching resolveRangeStyleAt's key-wise
    // merge rather than being clobbered by a last-write-wins full style.
    const input: RangeStylePatch[] = [
      { range: [{ r: 1, c: 1 }, { r: 3, c: 3 }], style: { b: true } },
      { range: [{ r: 2, c: 2 }, { r: 2, c: 2 }], style: { bg: '#000' } },
    ];
    const tiled = coalesceRangeStylePatchesMaximal(input);
    expect(resolveRangeStyleAt(tiled, 2, 2)).toEqual({ b: true, bg: '#000' });
    expect(resolveGrid(tiled)).toEqual(resolveGrid(input));
  });

  it('drops a single empty-style patch (consistent with the multi-patch path)', () => {
    const tiled = coalesceRangeStylePatchesMaximal([
      { range: [{ r: 1, c: 1 }, { r: 2, c: 2 }], style: { b: undefined } },
    ]);
    expect(tiled).toEqual([]);
  });

  it('handles sparse gaps without styling empty cells', () => {
    const input: RangeStylePatch[] = [
      { range: [{ r: 1, c: 1 }, { r: 1, c: 1 }], style: { b: true } },
      { range: [{ r: 3, c: 3 }, { r: 3, c: 3 }], style: { b: true } },
    ];
    const tiled = coalesceRangeStylePatchesMaximal(input);
    expect(resolveRangeStyleAt(tiled, 2, 2)).toBeUndefined();
    expect(resolveGrid(tiled)).toEqual(resolveGrid(input));
  });
});
