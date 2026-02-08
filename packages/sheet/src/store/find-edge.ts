import { Ref, Range, Direction } from '../model/types';
import { inRange } from '../model/coordinates';
import { CellIndex } from './cell-index';

/**
 * `findEdgeWithIndex` implements Ctrl+Arrow navigation using a CellIndex
 * for efficient O(k) jumps (where k = occupied cells in the row/col)
 * instead of O(distance) step-by-step walking.
 *
 * Behavior matches the standard spreadsheet Ctrl+Arrow:
 * - If current and next are occupied: walk to end of consecutive run
 * - If current is occupied but next is empty (or current is empty):
 *   jump to start of next data block, or boundary if none
 */
export function findEdgeWithIndex(
  index: CellIndex,
  ref: Ref,
  direction: Direction,
  dimension: Range,
): Ref {
  const isHorizontal = direction === 'left' || direction === 'right';
  const isForward = direction === 'down' || direction === 'right';

  const pos = isHorizontal ? ref.c : ref.r;
  const minPos = isHorizontal ? dimension[0].c : dimension[0].r;
  const maxPos = isHorizontal ? dimension[1].c : dimension[1].r;

  // Get all occupied positions along the movement axis
  const occupiedSet = isHorizontal
    ? index.getOccupiedColsInRow(ref.r)
    : index.getOccupiedRowsInCol(ref.c);

  if (!occupiedSet || occupiedSet.size === 0) {
    // No data in this row/col at all — go to boundary
    return makeBoundaryRef(ref, direction, dimension);
  }

  // Sort positions in movement direction
  const sorted = Array.from(occupiedSet).sort((a, b) => a - b);
  if (!isForward) {
    sorted.reverse();
  }

  // Filter to only positions ahead of (or at) current position
  const ahead = isForward
    ? sorted.filter((p) => p > pos)
    : sorted.filter((p) => p < pos);

  const hasCurrent = occupiedSet.has(pos);
  const nextPos = isForward ? pos + 1 : pos - 1;
  const hasNext = inRange(
    isHorizontal ? { r: ref.r, c: nextPos } : { r: nextPos, c: ref.c },
    dimension,
  ) && occupiedSet.has(nextPos);

  if (hasCurrent && hasNext) {
    // Inside a data block — walk to end of consecutive run
    let end = pos;
    let next = nextPos;
    while (
      (isForward ? next <= maxPos : next >= minPos) &&
      occupiedSet.has(next)
    ) {
      end = next;
      next = isForward ? next + 1 : next - 1;
    }
    return isHorizontal ? { r: ref.r, c: end } : { r: end, c: ref.c };
  }

  // At edge of data or in empty space — jump to next data block
  if (ahead.length > 0) {
    const target = ahead[0];
    return isHorizontal ? { r: ref.r, c: target } : { r: target, c: ref.c };
  }

  // No more data ahead — go to boundary
  return makeBoundaryRef(ref, direction, dimension);
}

function makeBoundaryRef(
  ref: Ref,
  direction: Direction,
  dimension: Range,
): Ref {
  switch (direction) {
    case 'up':
      return { r: dimension[0].r, c: ref.c };
    case 'down':
      return { r: dimension[1].r, c: ref.c };
    case 'left':
      return { r: ref.r, c: dimension[0].c };
    case 'right':
      return { r: ref.r, c: dimension[1].c };
  }
}
