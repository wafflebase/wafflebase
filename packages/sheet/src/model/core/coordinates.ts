import { ARef, Ref, Range, Ranges, Reference, Sref, Srng, Grid } from './types';

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
 * `isCrossSheetRef` returns whether the given reference contains a sheet prefix.
 */
export function isCrossSheetRef(reference: string): boolean {
  return reference.includes('!');
}

/**
 * `parseCrossSheetRef` splits a cross-sheet reference like "Sheet2!A1" or "'My Sheet'!A1"
 * into { sheetName, localRef }.
 */
export function parseCrossSheetRef(ref: string): {
  sheetName: string;
  localRef: string;
} {
  const idx = ref.indexOf('!');
  if (idx === -1) {
    throw new Error(`Not a cross-sheet reference: ${ref}`);
  }
  let sheetName = ref.substring(0, idx);
  // Strip surrounding quotes if present
  if (sheetName.startsWith("'") && sheetName.endsWith("'")) {
    sheetName = sheetName.slice(1, -1);
  }
  const localRef = ref.substring(idx + 1);
  return { sheetName, localRef };
}

/**
 * `toSrefs` converts the references to Refs. If the reference is a range,
 *  it decomposes the range into individual references.
 */
export function* toSrefs(references: Iterable<Reference>): Generator<Sref> {
  for (const reference of references) {
    // Handle cross-sheet references (e.g., "SHEET2!A1:B2" or "SHEET2!A1")
    if (isCrossSheetRef(reference)) {
      const { sheetName, localRef } = parseCrossSheetRef(reference);
      if (localRef.includes(':')) {
        // Cross-sheet range: decompose and re-prefix each cell
        const range = parseRange(localRef);
        for (const ref of toRefs(range)) {
          yield `${sheetName}!${toSref(ref)}`;
        }
      } else {
        yield reference;
      }
      continue;
    }

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
 * `parseARef` parses a string ref preserving absolute-reference `$` markers.
 * e.g. "$A$1" → { r: 1, c: 1, absCol: true, absRow: true }
 *      "A$1"  → { r: 1, c: 1, absRow: true }
 *      "$A1"  → { r: 1, c: 1, absCol: true }
 */
export function parseARef(ref: Sref): ARef {
  const absCol = ref.startsWith('$') || ref.includes('!$');
  // Find the column-row boundary to detect row dollar sign.
  // After optional leading '$' and column letters, check for '$' before digits.
  const match = ref.match(/^(\$?)([A-Za-z]+)(\$?)(\d+)$/);
  if (!match) {
    throw new Error('Invalid Reference');
  }
  const absRow = match[3] === '$';
  const parsed = parseRef(ref);
  return {
    ...parsed,
    ...(absCol ? { absCol: true } : {}),
    ...(absRow ? { absRow: true } : {}),
  };
}

/**
 * `toASref` converts an ARef back to a string ref, restoring `$` markers.
 * e.g. { r: 1, c: 1, absCol: true, absRow: true } → "$A$1"
 */
export function toASref(ref: ARef): Sref {
  const col = toColumnLabel(ref.c);
  const row = String(ref.r);
  return (ref.absCol ? '$' : '') + col + (ref.absRow ? '$' : '') + row;
}

/**
 * parseRange parses the given srng and returns the range.
 */
export function parseRange(srng: Srng): Range {
  const [from, to] = srng.split(':');
  return [parseRef(from), parseRef(to)];
}

// ---------------------------------------------------------------------------
// Ranges utilities
// ---------------------------------------------------------------------------

/**
 * `toRanges` creates a Ranges from the given Range arguments, normalizing each.
 */
export function toRanges(...ranges: Range[]): Ranges {
  return ranges.map((r) => toRange(r[0], r[1]));
}

/**
 * `inRanges` returns whether the given Ref is inside any of the Ranges.
 */
export function inRanges(ref: Ref, ranges: Ranges): boolean {
  return ranges.some((r) => inRange(ref, r));
}

/**
 * `isIntersectRanges` returns whether any range in `a` intersects any range in `b`.
 */
export function isIntersectRanges(a: Ranges, b: Ranges): boolean {
  return a.some((ra) => b.some((rb) => isIntersect(ra, rb)));
}

/**
 * `toRefsFromRanges` generates all Refs across every range in the given Ranges.
 */
export function* toRefsFromRanges(ranges: Ranges): Generator<Ref> {
  for (const range of ranges) {
    yield* toRefs(range);
  }
}

/**
 * `toSrngFromRanges` serializes a Ranges to a comma-separated string.
 * Collapsed (single-cell) ranges are serialized as "A1" instead of "A1:A1".
 */
export function toSrngFromRanges(ranges: Ranges): string {
  return ranges
    .map((r) => (isCollapsedRange(r) ? toSref(r[0]) : toSrng(r)))
    .join(',');
}

/**
 * `parseRanges` parses a comma-separated range string (e.g. "A1:A2,B1,B2:B3").
 */
export function parseRanges(s: string): Ranges {
  return s.split(',').map((part) => {
    const trimmed = part.trim();
    if (trimmed.includes(':')) {
      return parseRange(trimmed);
    }
    const ref = parseRef(trimmed);
    return [ref, { ...ref }];
  });
}

/**
 * `mergeOverlapping` merges overlapping or adjacent ranges into fewer ranges.
 */
export function mergeOverlapping(ranges: Ranges): Ranges {
  if (ranges.length <= 1) return [...ranges];

  const sorted = [...ranges].sort((a, b) =>
    a[0].r !== b[0].r ? a[0].r - b[0].r : a[0].c - b[0].c,
  );

  const result: Ranges = [cloneRange(sorted[0])];
  for (let i = 1; i < sorted.length; i++) {
    const last = result[result.length - 1];
    const cur = sorted[i];
    if (isIntersect(last, cur) || isAdjacent(last, cur)) {
      result[result.length - 1] = mergeRanges(last, cur);
    } else {
      result.push(cloneRange(cur));
    }
  }
  return result;
}

/**
 * `removeRange` removes the target range from the list, returning ranges that
 * do not exactly match the target.
 */
export function removeRange(ranges: Ranges, target: Range): Ranges {
  return ranges.filter((r) => !isSameRange(r, target));
}

/**
 * `isAdjacent` returns whether two ranges are adjacent (touching but not overlapping).
 */
function isAdjacent(a: Range, b: Range): boolean {
  const [fromA, toA] = a;
  const [fromB, toB] = b;

  // Same column span and rows are adjacent
  if (fromA.c === fromB.c && toA.c === toB.c) {
    return toA.r + 1 === fromB.r || toB.r + 1 === fromA.r;
  }
  // Same row span and columns are adjacent
  if (fromA.r === fromB.r && toA.r === toB.r) {
    return toA.c + 1 === fromB.c || toB.c + 1 === fromA.c;
  }
  return false;
}
