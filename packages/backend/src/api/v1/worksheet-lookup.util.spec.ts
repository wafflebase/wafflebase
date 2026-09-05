import { NotFoundException } from '@nestjs/common';
import { createSpreadsheetDocument } from '@wafflebase/sheets';
import type { SpreadsheetDocument } from '@wafflebase/sheets';
import { findWorksheet, worksheetOrThrow } from './worksheet-lookup.util';
import { ApiV1CellsController } from './cells.controller';
import { ApiV1WorksheetController } from './worksheet.controller';
import { ApiV1WorksheetChartsController } from './worksheet-charts.controller';
import { ApiV1WorksheetDimensionsController } from './worksheet-dimensions.controller';
import { ApiV1WorksheetFilterPivotController } from './worksheet-filter-pivot.controller';
import { ApiV1WorksheetImagesController } from './worksheet-images.controller';
import { ApiV1WorksheetRulesController } from './worksheet-rules.controller';
import { ApiV1WorksheetStylesController } from './worksheet-styles.controller';
import { ApiV1WorksheetStructureController } from './worksheet-structure.controller';

const WS = 'ws-1';
const DOC = 'doc-1';
const TAB = 'tab-1';

/**
 * The two ways `sheets[tabId]` answers truthy for something that is not a tab.
 *
 * `__proto__` / `constructor` / `prototype` are inherited on a **plain**
 * object; `toJSON` / `toJS` / `toJSForTest` / `toString` / `getID` are what a
 * live Yorkie `JSONObject` proxy's get trap answers with a function. A guard
 * that only denylists the first group leaves the second — which is the only
 * group production ever sees — reachable.
 */
const HOSTILE_TAB_IDS = [
  '__proto__',
  'constructor',
  'prototype',
  'toJSON',
  'toJS',
  'toJSForTest',
  'toString',
  'getID',
];

/** A stand-in for the Yorkie object proxy's get trap over a real key map. */
function yorkieLikeSheets(
  entries: Record<string, unknown>,
): Record<string, unknown> {
  const keys = new Map(Object.entries(entries));
  return new Proxy(
    {},
    {
      get: (_t, prop: string | symbol) => {
        if (typeof prop !== 'string') return undefined;
        if (keys.has(prop)) return keys.get(prop);
        // The trap's own accessors — functions, and so truthy.
        if (
          ['toJSON', 'toJS', 'toJSForTest', 'toString', 'getID'].includes(prop)
        ) {
          return () => '';
        }
        return undefined;
      },
      ownKeys: () => [...keys.keys()],
      getOwnPropertyDescriptor: () => ({
        configurable: true,
        enumerable: true,
        value: undefined,
      }),
    },
  );
}

describe('worksheet lookup', () => {
  it.each(HOSTILE_TAB_IDS)(
    'findWorksheet answers undefined for "%s" on a plain root',
    (tabId) => {
      const root = { sheets: { [TAB]: { id: TAB } } };
      expect(findWorksheet(root, tabId)).toBeUndefined();
      expect(findWorksheet(root, TAB)).toEqual({ id: TAB });
    },
  );

  it.each(HOSTILE_TAB_IDS)(
    'findWorksheet answers undefined for "%s" through a Yorkie-like proxy',
    (tabId) => {
      const root = { sheets: yorkieLikeSheets({ [TAB]: { id: TAB } }) };
      expect(findWorksheet(root, tabId)).toBeUndefined();
      expect(findWorksheet(root, TAB)).toEqual({ id: TAB });
    },
  );

  it('worksheetOrThrow 404s rather than returning the inherited value', () => {
    const root = { sheets: { [TAB]: { id: TAB } } };
    expect(() => worksheetOrThrow(root, '__proto__')).toThrow(
      NotFoundException,
    );
    expect(worksheetOrThrow(root, TAB)).toEqual({ id: TAB });
  });

  it('survives a record whose ownKeys throws on duplicate CRDT keys', () => {
    // `safeWorksheetRecordKeys` recovers by re-reading the record through its
    // own `toJSON`, which is the shape a live Yorkie object always has.
    const sheets = new Proxy(
      {},
      {
        get: (_t, prop: string | symbol) => {
          if (prop === TAB) return { id: TAB };
          if (prop === 'toJSON') return () => JSON.stringify({ [TAB]: {} });
          return undefined;
        },
        ownKeys: () => {
          throw new TypeError(
            "'ownKeys' on proxy: trap returned duplicate entries",
          );
        },
      },
    ) as Record<string, unknown>;
    expect(findWorksheet({ sheets }, TAB)).toEqual({ id: TAB });
    expect(findWorksheet({ sheets }, '__proto__')).toBeUndefined();
  });
});

/**
 * Every tab-scoped v1 write verb, not just the images one the guard first
 * landed in: each takes `:tabId` off the URL (or, for comment creation, the
 * body) and uses it as both the existence check and the write key.
 */
describe('tab-scoped v1 write verbs refuse a non-tab key', () => {
  let root: SpreadsheetDocument;
  let deps: [never, never];

  beforeEach(() => {
    root = createSpreadsheetDocument();
    const doc = {
      getRoot: () => root,
      update: (fn: (r: SpreadsheetDocument) => void) => fn(root),
    };
    const withDocument = jest.fn(
      (_id: string, cb: (d: typeof doc) => unknown) => Promise.resolve(cb(doc)),
    );
    const documentService = {
      getDocumentOrThrow: jest
        .fn()
        .mockResolvedValue({ id: DOC, workspaceId: WS, type: 'sheet' }),
    };
    deps = [{ withDocument } as never, documentService as never];
  });

  const verbs: Array<[string, (tabId: string) => Promise<unknown>]> = [
    [
      'worksheet.setFreeze',
      (t) =>
        new ApiV1WorksheetController(...deps).setFreeze(WS, DOC, t, {
          rows: 1,
          cols: 1,
        }),
    ],
    [
      'worksheet.setHidden',
      (t) =>
        new ApiV1WorksheetController(...deps).setHidden(WS, DOC, t, {
          rows: [1],
          columns: [],
        }),
    ],
    [
      'worksheet.setMerges',
      (t) =>
        new ApiV1WorksheetController(...deps).setMerges(WS, DOC, t, {
          merges: {},
        }),
    ],
    [
      'rules.setConditionalFormats',
      (t) =>
        new ApiV1WorksheetRulesController(...deps).setConditionalFormats(
          WS,
          DOC,
          t,
          { rules: [] },
        ),
    ],
    [
      'rules.setDataValidations',
      (t) =>
        new ApiV1WorksheetRulesController(...deps).setDataValidations(
          WS,
          DOC,
          t,
          { rules: [] },
        ),
    ],
    [
      'styles.setRangeStyles',
      (t) =>
        new ApiV1WorksheetStylesController(...deps).setRangeStyles(WS, DOC, t, {
          rangeStyles: [],
        }),
    ],
    [
      'styles.setSheetStyle',
      (t) =>
        new ApiV1WorksheetStylesController(...deps).setSheetStyle(WS, DOC, t, {
          style: { b: true },
        }),
    ],
    [
      'charts.setCharts',
      (t) =>
        new ApiV1WorksheetChartsController(...deps).setCharts(WS, DOC, t, {
          charts: [],
        }),
    ],
    [
      'images.setImages',
      (t) =>
        new ApiV1WorksheetImagesController(...deps).setImages(WS, DOC, t, {
          images: [],
        }),
    ],
    [
      'dimensions.setColumnStyles',
      (t) =>
        new ApiV1WorksheetDimensionsController(...deps).setColumnStyles(
          WS,
          DOC,
          t,
          { columnStyles: { '1': { b: true } } },
        ),
    ],
    [
      'dimensions.setRowStyles',
      (t) =>
        new ApiV1WorksheetDimensionsController(...deps).setRowStyles(
          WS,
          DOC,
          t,
          { rowStyles: { '1': { b: true } } },
        ),
    ],
    [
      'dimensions.setColumnWidths',
      (t) =>
        new ApiV1WorksheetDimensionsController(...deps).setColumnWidths(
          WS,
          DOC,
          t,
          { columnWidths: { '1': 80 } },
        ),
    ],
    [
      'dimensions.setRowHeights',
      (t) =>
        new ApiV1WorksheetDimensionsController(...deps).setRowHeights(
          WS,
          DOC,
          t,
          { rowHeights: { '1': 24 } },
        ),
    ],
    [
      'filterPivot.setFilter',
      (t) =>
        new ApiV1WorksheetFilterPivotController(...deps).setFilter(WS, DOC, t, {
          filter: null,
        }),
    ],
    [
      'filterPivot.setPivot',
      (t) =>
        new ApiV1WorksheetFilterPivotController(...deps).setPivot(WS, DOC, t, {
          pivot: null,
        }),
    ],
    [
      'cells.setCell',
      (t) =>
        new ApiV1CellsController(...deps).setCell(WS, DOC, t, 'A1', {
          value: 'x',
        }),
    ],
    [
      'cells.deleteCell',
      (t) => new ApiV1CellsController(...deps).deleteCell(WS, DOC, t, 'A1'),
    ],
    [
      'cells.batchUpdate',
      (t) =>
        new ApiV1CellsController(...deps).batchUpdate(WS, DOC, t, {
          cells: { A1: { value: 'x' } },
        }),
    ],
    [
      'structure.clearRange',
      (t) =>
        new ApiV1WorksheetStructureController(...deps).clearRange(WS, DOC, t, {
          range: 'A1:B2',
        }),
    ],
    [
      'structure.insertAxis',
      (t) =>
        new ApiV1WorksheetStructureController(...deps).insertAxis(WS, DOC, t, {
          axis: 'row',
          index: 1,
          count: 1,
        }),
    ],
  ];

  for (const [name, invoke] of verbs) {
    it.each(HOSTILE_TAB_IDS)(`${name} 404s on "%s"`, async (tabId) => {
      await expect(invoke(tabId)).rejects.toBeInstanceOf(NotFoundException);
      expect(Object.prototype).not.toHaveProperty('images');
      expect(Object.prototype).not.toHaveProperty('charts');
      expect(Object.prototype).not.toHaveProperty('rangeStyles');
    });

    it(`${name} still resolves a real tab`, async () => {
      await expect(invoke(TAB)).resolves.toBeDefined();
    });
  }
});
