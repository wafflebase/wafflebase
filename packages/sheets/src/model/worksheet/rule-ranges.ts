import { toRange } from '../core/coordinates';
import { remapIndex } from './shifting';
import { Axis, Range } from '../core/types';

/** A rule that scopes itself to a set of ranges. */
export type RangedRule = { ranges: Range[] };

/**
 * `shiftBoundary` remaps a single 1-based index after inserting (count > 0)
 * or deleting (count < 0) `count` rows/columns at `index`.
 */
export function shiftBoundary(
  indexValue: number,
  index: number,
  count: number,
): number {
  if (count > 0) {
    return indexValue >= index ? indexValue + count : indexValue;
  }
  const absCount = Math.abs(count);
  if (indexValue >= index && indexValue < index + absCount) {
    return index;
  }
  if (indexValue >= index + absCount) {
    return indexValue + count;
  }
  return indexValue;
}

/**
 * `clampRange` clamps a range's boundaries to the valid 1-based minimum.
 */
export function clampRange(range: Range): Range {
  return toRange(
    { r: Math.max(1, range[0].r), c: Math.max(1, range[0].c) },
    { r: Math.max(1, range[1].r), c: Math.max(1, range[1].c) },
  );
}

/**
 * `mapRuleRanges` applies `mapRange` to every range of every rule, dropping
 * collapsed ranges and rules left with none. Each surviving rule is
 * normalized (invalid rules skipped) then cloned so the source is untouched.
 */
function mapRuleRanges<T extends RangedRule>(
  rules: T[],
  mapRange: (range: Range) => Range,
  normalize: (rule: T) => T | null | undefined,
  clone: (rule: T) => T,
): T[] {
  const next: T[] = [];
  for (const rule of rules) {
    const normalized = normalize(rule);
    if (!normalized) {
      continue;
    }
    const ranges = normalized.ranges
      .map((range) => clampRange(mapRange(range)))
      .filter((r) => r[0].r <= r[1].r && r[0].c <= r[1].c);
    if (ranges.length === 0) {
      continue;
    }
    next.push({ ...clone(normalized), ranges });
  }
  return next;
}

/**
 * `shiftRuleRanges` remaps ranged rules after an insert/delete on `axis`.
 */
export function shiftRuleRanges<T extends RangedRule>(
  rules: T[],
  axis: Axis,
  index: number,
  count: number,
  normalize: (rule: T) => T | null | undefined,
  clone: (rule: T) => T,
): T[] {
  return mapRuleRanges(
    rules,
    (range) =>
      axis === 'row'
        ? toRange(
            { r: shiftBoundary(range[0].r, index, count), c: range[0].c },
            { r: shiftBoundary(range[1].r, index, count), c: range[1].c },
          )
        : toRange(
            { r: range[0].r, c: shiftBoundary(range[0].c, index, count) },
            { r: range[1].r, c: shiftBoundary(range[1].c, index, count) },
          ),
    normalize,
    clone,
  );
}

/**
 * `moveRuleRanges` remaps ranged rules after a row/column move on `axis`.
 */
export function moveRuleRanges<T extends RangedRule>(
  rules: T[],
  axis: Axis,
  src: number,
  count: number,
  dst: number,
  normalize: (rule: T) => T | null | undefined,
  clone: (rule: T) => T,
): T[] {
  return mapRuleRanges(
    rules,
    (range) =>
      axis === 'row'
        ? toRange(
            { r: remapIndex(range[0].r, src, count, dst), c: range[0].c },
            { r: remapIndex(range[1].r, src, count, dst), c: range[1].c },
          )
        : toRange(
            { r: range[0].r, c: remapIndex(range[0].c, src, count, dst) },
            { r: range[1].r, c: remapIndex(range[1].c, src, count, dst) },
          ),
    normalize,
    clone,
  );
}
