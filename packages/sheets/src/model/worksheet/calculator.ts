import { ErrValue, evaluateWithSpill, SpillResult, extractReferences } from '../../formula/formula';
import { parseRef, toSref } from '../core/coordinates';
import { inferInput, applyInferredFormat } from './input';
import { Sheet } from './sheet';
import { CellStyle, Sref } from '../core/types';

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
        v: ErrValue.REF,
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

    // Clear ghost cells from a previous (unblocked) spill before re-evaluating.
    // Only delete cells that are still THIS anchor's ghosts — skip any cell that
    // has been overwritten with user data (spillAnchor would be absent).
    if (cell.spillRows && cell.spillCols && !cell.spillBlocked) {
      for (let dr = 0; dr < cell.spillRows; dr++) {
        for (let dc = 0; dc < cell.spillCols; dc++) {
          if (dr === 0 && dc === 0) continue;
          const ghostRef = { r: ref.r + dr, c: ref.c + dc };
          const ghostCell = await sheet.getCell(ghostRef);
          if (ghostCell?.spillAnchor === sref) {
            await sheet.deleteCell(ghostRef);
          }
        }
      }
    }

    const references = extractReferences(cell.f!);
    const grid = await sheet.fetchGridByReferences(references);
    const result = evaluateWithSpill(cell.f!, grid);

    if (typeof result !== 'string') {
      const { values, rows, cols } = result as SpillResult;

      // Check for spill conflicts: only user-entered data (no spillAnchor) blocks the spill.
      // Ghost cells from any anchor are overwritten — they're virtual, not user data.
      let blocker: Sref | null = null;
      for (let dr = 0; dr < rows && !blocker; dr++) {
        for (let dc = 0; dc < cols && !blocker; dc++) {
          if (dr === 0 && dc === 0) continue;
          const ghostSref = toSref({ r: ref.r + dr, c: ref.c + dc });
          const existing = await sheet.getCell(parseRef(ghostSref));
          if (existing && (existing.v || existing.f) && !existing.spillAnchor) {
            blocker = ghostSref;
          }
        }
      }

      if (blocker !== null) {
        // Record blocked state — ghost cells are NOT written; anchor shows #REF!
        sheet.registerSpillBlocker(blocker, sref);
        await sheet.setCell(ref, {
          v: ErrValue.REF,
          f: cell.f,
          s: cell.s,
          spillRows: rows,
          spillCols: cols,
          spillBlocked: true,
        });
        continue;
      }

      // No conflict — clear any previous blocked registration and write ghost cells.
      sheet.clearSpillBlockers(sref);
      const anchorValue = values[0]?.[0] ?? '';
      const hasExplicitFormat = cell.s?.nf != null;
      const style = hasExplicitFormat
        ? cell.s
        : applyInferredFormat(cell.s, inferInput(anchorValue));
      await sheet.setCell(ref, { v: anchorValue, f: cell.f, s: style, spillRows: rows, spillCols: cols });
      for (let dr = 0; dr < rows; dr++) {
        for (let dc = 0; dc < cols; dc++) {
          if (dr === 0 && dc === 0) continue;
          const ghostRef = { r: ref.r + dr, c: ref.c + dc };
          await sheet.setCell(ghostRef, { v: values[dr]?.[dc] ?? '', spillAnchor: sref });
        }
      }
      continue;
    }

    const value = result;
    const hasExplicitFormat = cell.s?.nf != null;
    const style = hasExplicitFormat
      ? cell.s
      : applyInferredFormat(cell.s, inferInput(value));
    const nextCell = {
      v: value,
      f: cell.f,
      s: style,
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
