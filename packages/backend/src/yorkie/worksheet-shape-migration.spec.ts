import {
  createSpreadsheetDocument,
  createWorksheet,
  getWorksheetEntries,
  parseRef,
  writeWorksheetCell,
  type TabMeta,
} from '@wafflebase/sheets';
import { migrateYorkieWorksheetShape } from './worksheet-shape-migration';

describe('migrateYorkieWorksheetShape', () => {
  it('returns current tabbed documents unchanged', () => {
    const worksheet = createWorksheet();
    writeWorksheetCell(worksheet, parseRef('B2'), { v: 'current' });

    const current = createSpreadsheetDocument({
      tabId: 'sheet-1',
      tabName: 'Main',
      worksheet,
    });

    current.tabs['source-1'] = {
      id: 'source-1',
      name: 'Warehouse',
      type: 'datasource',
      datasourceId: 'ds-1',
    };
    current.tabOrder.push('source-1');

    const result = migrateYorkieWorksheetShape(current);

    expect(result.kind).toBe('current');
    expect(result.changed).toBe(false);
    expect(result.document).toEqual(current);
    expect(result.summary).toEqual({
      sheetCount: 1,
      migratedSheetCount: 0,
      cellCount: 1,
    });
  });

  it('wraps flat current worksheets into the canonical tabbed document', () => {
    const worksheet = createWorksheet();
    writeWorksheetCell(worksheet, parseRef('C3'), { v: 'flat-current' });

    const result = migrateYorkieWorksheetShape(worksheet);

    expect(result.kind).toBe('current-flat');
    expect(result.changed).toBe(true);
    expect(result.document.tabOrder).toEqual(['tab-1']);
    expect(result.document.tabs['tab-1']).toEqual({
      id: 'tab-1',
      name: 'Sheet1',
      type: 'sheet',
    });
    expect(result.document.sheets['tab-1']).toEqual(worksheet);
    expect(result.summary).toEqual({
      sheetCount: 1,
      migratedSheetCount: 1,
      cellCount: 1,
    });
  });

  it('initializes empty Yorkie roots to the canonical spreadsheet document', () => {
    const result = migrateYorkieWorksheetShape({});

    expect(result.kind).toBe('initialized-empty');
    expect(result.changed).toBe(true);
    expect(result.document).toEqual(createSpreadsheetDocument());
    expect(result.summary).toEqual({
      sheetCount: 1,
      migratedSheetCount: 1,
      cellCount: 0,
    });
  });

  it('migrates legacy flat worksheets into the tabbed canonical shape', () => {
    const result = migrateYorkieWorksheetShape({
      sheet: {
        B2: { v: 'legacy' },
      },
      rowHeights: {
        '6': 36,
      },
      colWidths: {
        '7': 140,
      },
      hiddenRows: [5],
      hiddenColumns: [4],
      filter: {
        startRow: 1,
        endRow: 8,
        startCol: 1,
        endCol: 3,
        columns: {},
        hiddenRows: [7],
      },
      merges: {
        C3: { rs: 2, cs: 2 },
      },
      charts: {
        chart1: {
          id: 'chart1',
          type: 'bar',
          sourceTabId: 'tab-1',
          sourceRange: 'A1:B2',
          anchor: 'D9',
          offsetX: 0,
          offsetY: 0,
          width: 320,
          height: 180,
        },
      },
      frozenRows: 4,
      frozenCols: 2,
    });

    const worksheet = result.document.sheets['tab-1'];

    expect(result.kind).toBe('legacy-flat');
    expect(result.changed).toBe(true);
    expect(worksheet.rowOrder).toHaveLength(9);
    expect(worksheet.colOrder).toHaveLength(7);
    expect(worksheet.nextRowId).toBe(10);
    expect(worksheet.nextColId).toBe(8);
    expect(getWorksheetEntries(worksheet)).toEqual([['B2', { v: 'legacy' }]]);
    expect(worksheet.rowHeights).toEqual({ '6': 36 });
    expect(worksheet.colWidths).toEqual({ '7': 140 });
    expect(worksheet.hiddenRows).toEqual([5]);
    expect(worksheet.hiddenColumns).toEqual([4]);
    expect(worksheet.merges).toEqual({ C3: { rs: 2, cs: 2 } });
    expect(worksheet.charts).toEqual({
      chart1: expect.objectContaining({ anchor: 'D9' }),
    });
    expect(result.summary).toEqual({
      sheetCount: 1,
      migratedSheetCount: 1,
      cellCount: 1,
    });
  });

  it('handles Yorkie object snapshots for legacy list fields', () => {
    const result = migrateYorkieWorksheetShape({
      sheet: {
        A1: { v: 'legacy-lists' },
      },
      hiddenRows: {
        '0': 5,
        '1': 8,
      },
      rangeStyles: {
        createdAt: { lamport: 1 },
        movedAt: { lamport: 1 },
      },
      conditionalFormats: {
        createdAt: { lamport: 1 },
        movedAt: { lamport: 1 },
      },
    } as never);

    const worksheet = result.document.sheets['tab-1'];

    expect(result.kind).toBe('legacy-flat');
    expect(result.changed).toBe(true);
    expect(worksheet.hiddenRows).toEqual([5, 8]);
    expect(worksheet.rangeStyles).toBeUndefined();
    expect(worksheet.conditionalFormats).toBeUndefined();
    expect(worksheet.rowOrder).toHaveLength(8);
  });

  it('migrates legacy tabbed documents and preserves datasource tabs', () => {
    const legacySheet = {
      sheet: {
        A1: { v: 'legacy-tabbed' },
      },
      frozenRows: 1,
      frozenCols: 1,
    };

    const legacyTabbed = {
      tabs: {
        'sheet-1': {
          id: 'sheet-1',
          name: 'Sheet1',
          type: 'sheet',
        } satisfies TabMeta,
        'source-1': {
          id: 'source-1',
          name: 'Warehouse',
          type: 'datasource',
          datasourceId: 'ds-1',
        } satisfies TabMeta,
      },
      tabOrder: ['sheet-1', 'source-1'],
      sheets: {
        'sheet-1': legacySheet,
      },
    };

    const result = migrateYorkieWorksheetShape(legacyTabbed);
    const worksheet = result.document.sheets['sheet-1'];

    expect(result.kind).toBe('legacy-tabbed');
    expect(result.changed).toBe(true);
    expect(result.document.tabs['source-1']).toEqual(legacyTabbed.tabs['source-1']);
    expect(result.document.tabOrder).toEqual(['sheet-1', 'source-1']);
    expect(result.document.sheets['source-1']).toBeUndefined();
    expect(getWorksheetEntries(worksheet)).toEqual([['A1', { v: 'legacy-tabbed' }]]);
    expect(worksheet.frozenRows).toBe(1);
    expect(worksheet.frozenCols).toBe(1);
  });

  it('reconstructs tab order when a tabbed document stores Yorkie metadata instead of an array', () => {
    const worksheet = createWorksheet();
    writeWorksheetCell(worksheet, parseRef('A1'), { v: 'order-fallback' });

    const result = migrateYorkieWorksheetShape({
      tabs: {
        'sheet-1': {
          id: 'sheet-1',
          name: 'Sheet1',
          type: 'sheet',
        } satisfies TabMeta,
        'sheet-2': {
          id: 'sheet-2',
          name: 'Sheet2',
          type: 'sheet',
        } satisfies TabMeta,
      },
      tabOrder: {
        createdAt: { lamport: 1 },
        movedAt: { lamport: 1 },
      },
      sheets: {
        'sheet-1': worksheet,
        'sheet-2': createWorksheet(),
      },
    });

    expect(result.kind).toBe('legacy-tabbed');
    expect(result.changed).toBe(true);
    expect(result.document.tabOrder).toEqual(['sheet-1', 'sheet-2']);
    expect(result.document.sheets['sheet-1']).toEqual(worksheet);
    expect(result.summary).toEqual({
      sheetCount: 2,
      migratedSheetCount: 0,
      cellCount: 1,
    });
  });

  it('throws for unsupported shapes', () => {
    expect(() =>
      migrateYorkieWorksheetShape({
        not: 'a worksheet',
      }),
    ).toThrow('Unsupported Yorkie spreadsheet document shape');
  });
});
