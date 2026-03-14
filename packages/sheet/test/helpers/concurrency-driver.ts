import { parseRef } from '../../src/model/core/coordinates.ts';
import { Sheet } from '../../src/model/worksheet/sheet.ts';
import { MemStore } from '../../src/store/memory.ts';
import {
  ConcurrencyCase,
  ConcurrencyOp,
  ConcurrencySnapshot,
} from './concurrency-case-table.ts';

export async function createTestSheet(): Promise<Sheet> {
  return new Sheet(new MemStore());
}

export async function initializeSheetState(sheet: Sheet): Promise<void> {
  await sheet.loadDimensions();
  await sheet.loadStyles();
  await sheet.loadMerges();
  await sheet.loadFreezePane();
  await sheet.loadFilterState();
  await sheet.loadHiddenState();
  await sheet.loadPivotDefinition();
}

export async function applyConcurrencyOp(
  sheet: Sheet,
  op: ConcurrencyOp,
): Promise<void> {
  switch (op.kind) {
    case 'set-data':
      await sheet.setData(parseRef(op.ref), op.value);
      return;
    case 'insert-rows':
      await sheet.insertRows(op.index, op.count ?? 1);
      return;
    case 'delete-rows':
      await sheet.deleteRows(op.index, op.count ?? 1);
      return;
    case 'insert-columns':
      await sheet.insertColumns(op.index, op.count ?? 1);
      return;
    case 'delete-columns':
      await sheet.deleteColumns(op.index, op.count ?? 1);
      return;
  }
}

export async function captureConcurrencySnapshot(
  sheet: Sheet,
  refs: string[],
): Promise<ConcurrencySnapshot> {
  const cells: ConcurrencySnapshot['cells'] = {};
  for (const sref of refs) {
    const ref = parseRef(sref);
    cells[sref] = {
      input: await sheet.toInputString(ref),
      display: await sheet.toDisplayString(ref),
    };
  }

  return { cells };
}

async function runOrderedCase(
  testCase: ConcurrencyCase,
  orderedOps: [ConcurrencyOp, ConcurrencyOp],
): Promise<ConcurrencySnapshot> {
  const sheet = await createTestSheet();
  await initializeSheetState(sheet);

  for (const seedOp of testCase.seed || []) {
    await applyConcurrencyOp(sheet, seedOp);
  }
  for (const op of orderedOps) {
    await applyConcurrencyOp(sheet, op);
  }

  return captureConcurrencySnapshot(sheet, testCase.observe.refs);
}

export async function runSerialConcurrencyCase(testCase: ConcurrencyCase): Promise<{
  aThenB: ConcurrencySnapshot;
  bThenA: ConcurrencySnapshot;
}> {
  const aThenB = await runOrderedCase(testCase, [testCase.userA, testCase.userB]);
  const bThenA = await runOrderedCase(testCase, [testCase.userB, testCase.userA]);
  return { aThenB, bThenA };
}

export function snapshotMatchesOneOf(
  actual: ConcurrencySnapshot,
  candidates: ConcurrencySnapshot[],
): boolean {
  return candidates.some((candidate) => JSON.stringify(candidate) === JSON.stringify(actual));
}
