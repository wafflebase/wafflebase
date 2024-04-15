import { evaluate } from '../formula/formula';
import { Sheet } from './sheet';
import { Reference } from './types';

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
export function calculate(sheet: Sheet, reference: string) {
  try {
    for (const ref of topologicalSort(sheet, reference)) {
      if (!sheet.hasFormula(ref)) {
        continue;
      }

      const cell = sheet.getCell(ref)!;
      const value = evaluate(cell.f!, sheet);
      sheet.setCell(ref, {
        v: value.toString(),
        f: cell.f,
      });
    }
  } catch (error) {
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
export function topologicalSort(
  sheet: Sheet,
  reference: Reference,
): Array<Reference> {
  const sorted: Array<Reference> = [reference];
  const visited = new Set<Reference>();
  const stack = new Set<Reference>();

  const dfs = (ref: Reference) => {
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

  dfs(reference);
  return sorted.reverse();
}
