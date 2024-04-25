import { evaluate, extractReferences } from '../formula/formula';
import { Sheet } from './sheet';
import { Ref } from './types';

/**
 * `calculate` calculates recursively the given cell and its dependencies.
 */
export async function calculate(
  sheet: Sheet,
  dependantsMap: Map<Ref, Set<Ref>>,
  refs: Iterable<Ref>,
) {
  const [sorted, cycled] = topologicalSort(dependantsMap, refs);
  for (const ref of sorted) {
    if (!(await sheet.hasFormula(ref))) {
      continue;
    }

    const cell = (await sheet.getCell(ref))!;
    if (cycled.has(ref)) {
      sheet.setCell(ref, {
        v: '#REF!',
        f: cell.f,
      });
      continue;
    }

    const references = extractReferences(cell.f!);
    const grid = await sheet.createGrid(references);
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
  dependantsMap: Map<Ref, Set<Ref>>,
  refs: Iterable<Ref>,
): [Array<Ref>, Set<Ref>] {
  const sorted: Array<Ref> = [];
  const cycled = new Set<Ref>();
  const visited = new Set<Ref>();
  const stack = new Set<Ref>();

  const dfs = (ref: Ref) => {
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
