import { parseRef } from '../../src/model/core/coordinates.ts';
import { Sheet } from '../../src/model/worksheet/sheet.ts';
import { MemStore } from '../../src/store/memory.ts';
import {
  ConcurrencyCase,
  ConcurrencyOp,
  ConcurrencySnapshot,
} from './concurrency-case-table.ts';

export async function createTestSheet(): Promise<{ sheet: Sheet; store: MemStore }> {
  const store = new MemStore();
  return { sheet: new Sheet(store), store };
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
    case 'set-row-height':
      sheet.setRowHeight(op.index, op.height);
      return;
    case 'set-column-width':
      sheet.setColumnWidth(op.index, op.width);
      return;
    case 'move-rows':
      await sheet.moveRows(op.src, op.count, op.dst);
      return;
    case 'move-columns':
      await sheet.moveColumns(op.src, op.count, op.dst);
      return;
    default: {
      const _exhaustive: never = op;
      throw new Error(`Unknown op kind: ${(_exhaustive as ConcurrencyOp).kind}`);
    }
  }
}

export async function captureConcurrencySnapshot(
  sheet: Sheet,
  store: MemStore,
  observe: ConcurrencyCase['observe'],
): Promise<ConcurrencySnapshot> {
  const cells: ConcurrencySnapshot['cells'] = {};
  for (const sref of observe.refs) {
    const ref = parseRef(sref);
    cells[sref] = {
      input: await sheet.toInputString(ref),
      display: await sheet.toDisplayString(ref),
    };
  }

  const snapshot: ConcurrencySnapshot = { cells };

  if (observe.dimensions?.length) {
    const dims: NonNullable<ConcurrencySnapshot['dimensions']> = {};
    for (const axis of observe.dimensions) {
      const sizes = await store.getDimensionSizes(axis === 'row' ? 'row' : 'column');
      const record: Record<string, number> = {};
      for (const [k, v] of sizes) {
        record[String(k)] = v;
      }
      if (axis === 'row') {
        dims.rowHeights = record;
      } else {
        dims.colWidths = record;
      }
    }
    snapshot.dimensions = dims;
  }

  return snapshot;
}

async function runOrderedCase(
  testCase: ConcurrencyCase,
  orderedOps: [ConcurrencyOp, ConcurrencyOp],
): Promise<ConcurrencySnapshot> {
  const { sheet, store } = await createTestSheet();
  await initializeSheetState(sheet);

  for (const seedOp of testCase.seed || []) {
    await applyConcurrencyOp(sheet, seedOp);
  }
  for (const op of orderedOps) {
    await applyConcurrencyOp(sheet, op);
  }

  return captureConcurrencySnapshot(sheet, store, testCase.observe);
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
