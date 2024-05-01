import { evaluate, extractReferences } from '../formula/formula';
import { parseRef } from './coordinates';
import { Sheet } from './sheet';
import { Sref } from './types';

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
      sheet.setCell(ref, {
        v: '#REF!',
        f: cell.f,
      });
      continue;
    }

    const references = extractReferences(cell.f!);
    const grid = await sheet.fetchGridByReferences(references);
    const value = await evaluate(cell.f!, grid);
    await sheet.setCell(ref, {
      v: value,
      f: cell.f,
    });
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
