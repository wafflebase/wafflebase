import { evaluate, extractReferences } from '../formula/formula';
import { parseRef } from './coordinates';
import { Sheet } from './sheet';
import { CellStyle, Sref } from './types';

function stylesEqual(
  left: CellStyle | undefined,
  right: CellStyle | undefined,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }

  const leftKeys = Object.keys(left) as Array<keyof CellStyle>;
  const rightKeys = Object.keys(right) as Array<keyof CellStyle>;
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  for (const key of leftKeys) {
    if (left[key] !== right[key]) {
      return false;
    }
  }
  return true;
}

/**
 * `calculate` calculates recursively the given cell and its dependencies.
 */
export async function calculate(
  sheet: Sheet,
  dependantsMap: Map<Sref, Set<Sref>>,
  refs: Iterable<Sref>,
) {
  const [sorted, cycled] = topologicalSort(dependantsMap, refs);
  for (const sref of sorted) {
    const ref = parseRef(sref);
    if (!(await sheet.hasFormula(ref))) {
      continue;
    }

    const cell = (await sheet.getCell(ref))!;
    if (cycled.has(sref)) {
      const nextCell = {
        v: '#REF!',
        f: cell.f,
        s: cell.s,
      };
      if (
        cell.v === nextCell.v &&
        cell.f === nextCell.f &&
        stylesEqual(cell.s, nextCell.s)
      ) {
        continue;
      }
      await sheet.setCell(ref, nextCell);
      continue;
    }

    const references = extractReferences(cell.f!);
    const grid = await sheet.fetchGridByReferences(references);
    const value = await evaluate(cell.f!, grid);
    const nextCell = {
      v: value,
      f: cell.f,
      s: cell.s,
    };
    if (
      cell.v === nextCell.v &&
      cell.f === nextCell.f &&
      stylesEqual(cell.s, nextCell.s)
    ) {
      continue;
    }
    await sheet.setCell(ref, nextCell);
  }
}

/**
 * `topologicalSort` returns the topological sort of the dependencies.
 */
export function topologicalSort(
  dependantsMap: Map<Sref, Set<Sref>>,
  refs: Iterable<Sref>,
): [Array<Sref>, Set<Sref>] {
  const sorted: Array<Sref> = [];
  const cycled = new Set<Sref>();
  const visited = new Set<Sref>();
  const stack = new Set<Sref>();

  const dfs = (ref: Sref) => {
    if (stack.has(ref)) {
      for (const r of stack) {
        cycled.add(r);
      }
    }

    stack.add(ref);

    if (!visited.has(ref)) {
      visited.add(ref);

      if (dependantsMap.has(ref)) {
        for (const dependant of dependantsMap.get(ref)!) {
          dfs(dependant);
        }
      }
      sorted.push(ref);
    }

    stack.delete(ref);
  };

  for (const ref of refs) {
    dfs(ref);
  }

  return [sorted.reverse(), cycled];
}
