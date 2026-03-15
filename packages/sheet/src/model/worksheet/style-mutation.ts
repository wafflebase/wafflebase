import {
  BorderPreset,
  Cell,
  CellStyle,
  Range,
} from '../core/types';
import { isSameRange } from '../core/coordinates';
import { stylesEqual } from './range-styles';
import type { RangeStylePatch } from './range-styles';

/**
 * Default style values used to determine if a key is redundant.
 */
const DefaultStyleValues: Partial<CellStyle> = {
  b: false,
  i: false,
  u: false,
  st: false,
  bt: false,
  br: false,
  bb: false,
  bl: false,
  tc: '',
  bg: '',
  al: 'left',
  va: 'top',
  nf: 'plain',
  dp: 2,
};

/**
 * `hasCellContent` checks whether a cell has value or formula content.
 * Style-only cells return false.
 */
export function hasCellContent(cell: Cell): boolean {
  const hasValue = cell.v !== undefined && cell.v !== '' && cell.v !== null;
  const hasFormula = !!cell.f;
  return hasValue || hasFormula;
}

/**
 * `isEmptyCell` checks if a cell has no meaningful data.
 * A cell is empty if it has no value (or empty string), no formula, and no style.
 */
export function isEmptyCell(cell: Cell): boolean {
  const hasContent = hasCellContent(cell);
  const hasStyle = cell.s !== undefined && Object.keys(cell.s).length > 0;
  return !hasContent && !hasStyle;
}

/**
 * `compactCell` removes undefined fields to keep persisted cell payload minimal.
 */
export function compactCell(base: Cell, style?: CellStyle): Cell {
  const cell: Cell = {};
  if (base.v !== undefined) {
    cell.v = base.v;
  }
  if (base.f !== undefined) {
    cell.f = base.f;
  }
  if (style && Object.keys(style).length > 0) {
    cell.s = style;
  }
  return cell;
}

/**
 * `rangesIntersect` returns true if two ranges overlap.
 */
export function rangesIntersect(a: Range, b: Range): boolean {
  return (
    a[0].r <= b[1].r &&
    a[1].r >= b[0].r &&
    a[0].c <= b[1].c &&
    a[1].c >= b[0].c
  );
}

/**
 * `containsRange` returns true if outer fully contains inner.
 */
export function containsRange(outer: Range, inner: Range): boolean {
  return (
    outer[0].r <= inner[0].r &&
    outer[0].c <= inner[0].c &&
    outer[1].r >= inner[1].r &&
    outer[1].c >= inner[1].c
  );
}

/**
 * `mergeableColBand` returns true if two ranges can be merged as column bands.
 */
export function mergeableColBand(a: Range, b: Range): boolean {
  if (a[0].r !== b[0].r || a[1].r !== b[1].r) return false;
  return b[0].c <= a[1].c + 1 && a[0].c <= b[1].c + 1;
}

/**
 * `mergeableRowBand` returns true if two ranges can be merged as row bands.
 */
export function mergeableRowBand(a: Range, b: Range): boolean {
  if (a[0].c !== b[0].c || a[1].c !== b[1].c) return false;
  return b[0].r <= a[1].r + 1 && a[0].r <= b[1].r + 1;
}

/**
 * `tryMergeRangeStylePatches` attempts to merge two style patches with identical
 * styles. Returns the merged patch or undefined if they cannot be merged.
 */
export function tryMergeRangeStylePatches(
  prev: RangeStylePatch,
  next: RangeStylePatch,
): RangeStylePatch | undefined {
  if (!stylesEqual(prev.style, next.style)) {
    return undefined;
  }

  if (
    isSameRange(prev.range, next.range) ||
    containsRange(prev.range, next.range)
  ) {
    return prev;
  }

  if (containsRange(next.range, prev.range)) {
    return next;
  }

  if (mergeableColBand(prev.range, next.range)) {
    return {
      range: [
        {
          r: prev.range[0].r,
          c: Math.min(prev.range[0].c, next.range[0].c),
        },
        {
          r: prev.range[1].r,
          c: Math.max(prev.range[1].c, next.range[1].c),
        },
      ],
      style: { ...prev.style },
    };
  }

  if (mergeableRowBand(prev.range, next.range)) {
    return {
      range: [
        {
          r: Math.min(prev.range[0].r, next.range[0].r),
          c: prev.range[0].c,
        },
        {
          r: Math.max(prev.range[1].r, next.range[1].r),
          c: prev.range[1].c,
        },
      ],
      style: { ...prev.style },
    };
  }

  return undefined;
}

/**
 * `sameRangeStylePatchList` compares two range style patch lists for equality.
 */
export function sameRangeStylePatchList(
  a: RangeStylePatch[],
  b: RangeStylePatch[],
): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (!isSameRange(a[i].range, b[i].range)) {
      return false;
    }
    if (!stylesEqual(a[i].style, b[i].style)) {
      return false;
    }
  }
  return true;
}

/**
 * Style source layers used by `hasConflictingStyleSourceForKey`.
 */
export type StyleSources = {
  sheetStyle: CellStyle | undefined;
  colStyles: Map<number, CellStyle>;
  rowStyles: Map<number, CellStyle>;
  rangeStyles: RangeStylePatch[];
};

/**
 * `hasConflictingStyleSourceForKey` checks if any style source layer
 * sets a different value for the given key within the range.
 */
export function hasConflictingStyleSourceForKey(
  range: Range,
  key: keyof CellStyle,
  targetValue: CellStyle[keyof CellStyle],
  sources: StyleSources,
  excludedRangeStyleIndex?: number,
): boolean {
  const sheetValue = sources.sheetStyle?.[key];
  if (sheetValue !== undefined && sheetValue !== targetValue) {
    return true;
  }

  for (const [col, style] of sources.colStyles) {
    if (col < range[0].c || col > range[1].c) {
      continue;
    }
    const value = style[key];
    if (value !== undefined && value !== targetValue) {
      return true;
    }
  }

  for (const [row, style] of sources.rowStyles) {
    if (row < range[0].r || row > range[1].r) {
      continue;
    }
    const value = style[key];
    if (value !== undefined && value !== targetValue) {
      return true;
    }
  }

  for (let i = 0; i < sources.rangeStyles.length; i++) {
    if (excludedRangeStyleIndex !== undefined && i === excludedRangeStyleIndex) {
      continue;
    }
    const patch = sources.rangeStyles[i];
    const value = patch.style[key];
    if (value === undefined || value === targetValue) {
      continue;
    }
    if (!rangesIntersect(range, patch.range)) {
      continue;
    }
    return true;
  }

  return false;
}

/**
 * `pruneRedundantDefaultStyleKeys` removes keys from a style that are
 * at their default value and not overridden by any conflicting source.
 */
export function pruneRedundantDefaultStyleKeys(
  range: Range,
  style: CellStyle,
  sources: StyleSources,
  excludedRangeStyleIndex?: number,
): CellStyle | undefined {
  const pruned: Partial<
    Record<keyof CellStyle, CellStyle[keyof CellStyle]>
  > = {};

  for (const key of Object.keys(style) as Array<keyof CellStyle>) {
    const value = style[key];
    if (value === undefined) {
      continue;
    }

    const defaultValue = DefaultStyleValues[key];
    if (
      defaultValue !== undefined &&
      value === defaultValue &&
      !hasConflictingStyleSourceForKey(
        range,
        key,
        value,
        sources,
        excludedRangeStyleIndex,
      )
    ) {
      continue;
    }

    pruned[key] = value as CellStyle[keyof CellStyle];
  }

  return Object.keys(pruned).length > 0
    ? (pruned as CellStyle)
    : undefined;
}

/**
 * `toBorderPatchForPreset` converts a border preset to a style patch
 * based on the target's position within the selection.
 */
export function toBorderPatchForPreset(
  preset: BorderPreset,
  selection: Range,
  target: Range,
): Partial<CellStyle> {
  const onTop = target[0].r === selection[0].r;
  const onBottom = target[1].r === selection[1].r;
  const onLeft = target[0].c === selection[0].c;
  const onRight = target[1].c === selection[1].c;

  switch (preset) {
    case 'all':
      return {
        bt: true,
        bl: true,
        br: onRight,
        bb: onBottom,
      };
    case 'outer':
      return {
        bt: onTop,
        bl: onLeft,
        br: onRight,
        bb: onBottom,
      };
    case 'inner':
      return {
        bt: !onTop,
        bl: !onLeft,
        br: false,
        bb: false,
      };
    case 'top':
      return { bt: onTop };
    case 'bottom':
      return { bb: onBottom };
    case 'left':
      return { bl: onLeft };
    case 'right':
      return { br: onRight };
    case 'clear':
    default:
      return {
        bt: false,
        bl: false,
        br: false,
        bb: false,
      };
  }
}
