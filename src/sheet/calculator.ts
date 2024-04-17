import { evaluate } from '../formula/formula';
import { Sheet } from './sheet';
import { Ref } from './types';

/**
 * `calculate` calculates recursively the given cell and its dependencies.
 */
export function calculate(
  sheet: Sheet,
  dependantsMap: Map<Ref, Set<Ref>>,
  ref: Ref,
) {
  const [sorted, hasCycle] = topologicalSort(dependantsMap, ref);
  for (const ref of sorted) {
    if (!sheet.hasFormula(ref)) {
      continue;
    }

    const cell = sheet.getCell(ref)!;
    if (hasCycle) {
      sheet.setCell(ref, {
        v: '#REF!',
        f: cell.f,
      });
      continue;
    }

    const value = evaluate(cell.f!, sheet);
    sheet.setCell(ref, {
      v: value,
      f: cell.f,
    });
  }
}

/**
 * `topologicalSort` returns the topological sort of the dependencies.
 */
export function topologicalSort(
  dependantsMap: Map<Ref, Set<Ref>>,
  start: Ref,
): [Array<Ref>, boolean] {
  const sorted: Array<Ref> = [start];
  const visited = new Set<Ref>();
  const stack = new Set<Ref>();
  let hasCycle = false;

  const dfs = (ref: Ref) => {
    if (stack.has(ref)) {
      hasCycle = true;
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

  dfs(start);
  return [sorted.reverse(), hasCycle];
}
