import { Ref, Range, Reference, Sref, Srng, Grid } from './types';

/**
 * `isIntersect` returns whether the given Ranges are intersected.
 */
export function isIntersect(range1: Range, range2: Range): boolean {
  const [from1, to1] = range1;
  const [from2, to2] = range2;

  return (
    from1.r <= to2.r && to1.r >= from2.r && from1.c <= to2.c && to1.c >= from2.c
  );
}

/**
 * `rangeOf` returns the range of the given grid.
 */
export function rangeOf(grid: Grid): Range {
  const refs = Array.from(grid.keys()).map(parseRef);
  const rows = refs.map((ref) => ref.r);
  const cols = refs.map((ref) => ref.c);

  return [
    { r: Math.min(...rows), c: Math.min(...cols) },
    { r: Math.max(...rows), c: Math.max(...cols) },
  ];
}

/**
 * `toRefs` generates Refs from the given Range.
 */
export function* toRefs(range: Range): Generator<Ref> {
  const [from, to] = range;

  for (let row = from.r; row <= to.r; row++) {
    for (let col = from.c; col <= to.c; col++) {
      yield { r: row, c: col };
    }
  }
}

/**
 * `expandRange` expands the given range by the given rate.
 */
export function expandRange(range: Range, rate: number): Range {
  const [from, to] = range;
  const rowDelta = Math.floor((to.r - from.r) * rate);
  const colDelta = Math.floor((to.c - from.c) * rate);

  return [
    { r: Math.max(from.r - rowDelta, 1), c: Math.max(from.c - colDelta, 1) },
    { r: to.r + rowDelta, c: to.c + colDelta },
  ];
}

/**
 * `inRange` returns whether the given Ref is in the Range.
 */
export function inRange(ref: Ref, range: Range): boolean {
  const [from, to] = range;
  return from.r <= ref.r && ref.r <= to.r && from.c <= ref.c && ref.c <= to.c;
}

/**
 * `isRangeInRange` returns whether the given Range is in the Range.
 */
export function isRangeInRange(inner: Range, outer: Range): boolean {
  const [fromInner, toInner] = inner;
  const [fromOuter, toOuter] = outer;

  return (
    fromOuter.r <= fromInner.r &&
    toInner.r <= toOuter.r &&
    fromOuter.c <= fromInner.c &&
    toInner.c <= toOuter.c
  );
}

/**
 * `isCollapsedRange` returns whether the given Range is collapsed.
 */
export function isCollapsedRange(range: Range): boolean {
  const [from, to] = range;
  return from.r === to.r && from.c === to.c;
}

/**
 * `toRange` returns the range of the given Refs.
 * @param ref1
 * @param ref2
 * @returns
 */
export function toRange(ref1: Ref, ref2: Ref): Range {
  return [
    {
      r: Math.min(ref1.r, ref2.r),
      c: Math.min(ref1.c, ref2.c),
    },
    {
      r: Math.max(ref1.r, ref2.r),
      c: Math.max(ref1.c, ref2.c),
    },
  ];
}

/**
 * `cloneRange` clones the given range.
 */
export function cloneRange(range: Range): Range {
  return [cloneRef(range[0]), cloneRef(range[1])];
}

/**
 * `isSameRange` returns whether the given Ranges are the same.
 */
export function isSameRange(range1: Range, range2: Range): boolean {
  return isSameRef(range1[0], range2[0]) && isSameRef(range1[1], range2[1]);
}

/**
 * `toBorderRanges` returns the border ranges of the given range.
 */
export function toBorderRanges(range: Range, dimension: Range): Array<Range> {
  const borders: Array<Range> = [];

  if (range[0].r > dimension[0].r) {
    borders.push([
      { r: range[0].r - 1, c: range[0].c },
      { r: range[0].r - 1, c: range[1].c },
    ]);
  }

  if (range[1].r < dimension[1].r) {
    borders.push([
      { r: range[1].r + 1, c: range[0].c },
      { r: range[1].r + 1, c: range[1].c },
    ]);
  }

  if (range[0].c > dimension[0].c) {
    borders.push([
      { r: range[0].r, c: range[0].c - 1 },
      { r: range[1].r, c: range[0].c - 1 },
    ]);
  }

  if (range[1].c < dimension[1].c) {
    borders.push([
      { r: range[0].r, c: range[1].c + 1 },
      { r: range[1].r, c: range[1].c + 1 },
    ]);
  }

  return borders;
}

/**
 * `mergeRanges` merges the given ranges into one range.
 */
export function mergeRanges(rangeA: Range, rangeB: Range): Range {
  const [fromA, toA] = rangeA;
  const [fromB, toB] = rangeB;

  return [
    {
      r: Math.min(fromA.r, fromB.r),
      c: Math.min(fromA.c, fromB.c),
    },
    {
      r: Math.max(toA.r, toB.r),
      c: Math.max(toA.c, toB.c),
    },
  ];
}

/**
 * `isSameRef` returns whether the given Refs are the same.
 */
export function isSameRef(ref1: Ref, ref2: Ref): boolean {
  return ref1.r === ref2.r && ref1.c === ref2.c;
}

/**
 * `cloneRef` clones the given ref.
 */
export function cloneRef(ref: Ref): Ref {
  return { r: ref.r, c: ref.c };
}

/**
 * `isSrng` returns whether the given Reference is Srng.
 */
export function isSrng(reference: Reference): boolean {
  return reference.includes(':');
}

/**
 * `toSrefs` converts the references to Refs. If the reference is a range,
 *  it decomposes the range into individual references.
 */
export function* toSrefs(references: Iterable<Reference>): Generator<Sref> {
  for (const reference of references) {
    if (isSrng(reference)) {
      const range = parseRange(reference);
      for (const ref of toRefs(range)) {
        yield toSref(ref);
      }
      continue;
    }

    yield reference;
  }
}

/**
 * `toRef` converts the given id to Ref.
 * @param ref
 */
export function toSref(ref: Ref): Sref {
  return toColumnLabel(ref.c) + ref.r;
}

/**
 * `toSrng` converts the given range to RefRange.
 */
export function toSrng(range: Range): Srng {
  const [from, to] = range;
  return `${toSref(from)}:${toSref(to)}`;
}

/**
 * `toSrngFromSrefs` converts the given refs to RefRange.
 */
export function toSrngFromSrefs(srefs: Iterable<Sref>): Srng {
  const srefArray = Array.from(srefs);
  return srefArray[0] + ':' + srefArray[srefArray.length - 1];
}

/**
 * `toColumnLabel` converts the column to the column label.
 */
export function toColumnLabel(col: number): string {
  let columnLabel = '';
  while (col > 0) {
    const rem = col % 26;
    if (rem === 0) {
      columnLabel = 'Z' + columnLabel;
      col = Math.floor(col / 26) - 1;
    } else {
      columnLabel = String.fromCharCode(rem + 64) + columnLabel;
      col = Math.floor(col / 26);
    }
  }
  return columnLabel;
}

/**
 * parseRef parses the given sref and returns the ref.
 *
 * @param ref
 * @returns
 */
export function parseRef(ref: Sref): Ref {
  // Strip '$' signs for absolute reference support (e.g., $A$1 -> A1)
  const cleaned = ref.replace(/\$/g, '');

  let startRow = 0;
  for (let i = 0; i < cleaned.length; i++) {
    const charCode = cleaned.charCodeAt(i);
    if (48 <= charCode && charCode <= 57) {
      startRow = i;
      break;
    }
  }

  if (startRow === 0) {
    throw new Error('Invalid Reference');
  }

  const row = parseInt(cleaned.substring(startRow));
  const col = cleaned
    .substring(0, startRow)
    .split('')
    .reverse()
    .reduce((acc, char, index) => {
      return acc + Math.pow(26, index) * (char.charCodeAt(0) - 65 + 1);
    }, 0);

  if (isNaN(row) || isNaN(col)) {
    throw new Error('Invalid Reference');
  }

  return { r: row, c: col };
}

/**
 * parseRange parses the given srng and returns the range.
 */
export function parseRange(srng: Srng): Range {
  const [from, to] = srng.split(':');
  return [parseRef(from), parseRef(to)];
}
