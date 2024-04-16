import { evaluate } from '../formula/formula';
import { Sheet } from './sheet';
import { Ref } from './types';

/**
 * `CalculationError` represents an error that occurs during calculation.
 */
class CalculationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalculationError';
  }
}

/**
 * `calculate` calculates recursively the given cell and its dependencies.
 */
export function calculate(sheet: Sheet, reference: Ref) {
  try {
    for (const ref of topologicalSort(sheet, reference)) {
      if (!sheet.hasFormula(ref)) {
        continue;
      }

      const cell = sheet.getCell(ref)!;
      const value = evaluate(cell.f!, sheet);
      sheet.setCell(ref, {
        v: value,
        f: cell.f,
      });
    }
  } catch (error) {
    // TODO(hackerwins): Propergate #REF! to dependants.
    if (error instanceof CalculationError) {
      const cell = sheet.getCell(reference);
      if (cell) {
        sheet.setCell(reference, {
          v: '#REF!',
          f: cell.f,
        });
      }
      return;
    }

    throw error;
  }
}

/**
 * `topologicalSort` returns the topological sort of the dependencies.
 */
export function topologicalSort(sheet: Sheet, start: Ref): Array<Ref> {
  const sorted: Array<Ref> = [start];
  const visited = new Set<Ref>();
  const stack = new Set<Ref>();

  const dfs = (ref: Ref) => {
    if (stack.has(ref)) {
      throw new CalculationError('Circular reference detected');
    }

    stack.add(ref);

    if (!visited.has(ref)) {
      visited.add(ref);

      if (sheet.hasDependants(ref)) {
        for (const dependant of sheet.getDependants(ref)!) {
          dfs(dependant);
        }
      }
      sorted.push(ref);
    }

    stack.delete(ref);
  };

  dfs(start);
  return sorted.reverse();
}
