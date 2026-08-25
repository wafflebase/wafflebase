import { BadRequestException } from '@nestjs/common';
import { createSpreadsheetDocument } from '@wafflebase/sheets';
import type { SpreadsheetDocument } from '@wafflebase/sheets';
import { ApiV1WorksheetChartsController } from './worksheet-charts.controller';

const WS = 'ws-1';
const DOC = 'doc-1';
const CHART = {
  id: 'chart-1',
  type: 'bar',
  sourceTabId: 'tab-1',
  sourceRange: 'A1:B5',
  anchor: 'D2',
  offsetX: 0,
  offsetY: 0,
  width: 400,
  height: 300,
};

describe('ApiV1WorksheetChartsController', () => {
  let controller: ApiV1WorksheetChartsController;
  let root: SpreadsheetDocument;
  let withDocument: jest.Mock;
  let documentService: { getDocumentOrThrow: jest.Mock };

  beforeEach(() => {
    root = createSpreadsheetDocument();
    const doc = {
      getRoot: () => root,
      update: (fn: (r: SpreadsheetDocument) => void) => fn(root),
    };
    withDocument = jest.fn((_id: string, cb: (d: typeof doc) => unknown) =>
      Promise.resolve(cb(doc)),
    );
    documentService = {
      getDocumentOrThrow: jest
        .fn()
        .mockResolvedValue({ id: DOC, workspaceId: WS, type: 'sheet' }),
    };
    controller = new ApiV1WorksheetChartsController(
      { withDocument } as never,
      documentService as never,
    );
  });

  it('stores and returns charts; PUT replaces the collection', async () => {
    await controller.setCharts(WS, DOC, 'tab-1', { charts: [CHART] });
    let res = await controller.getCharts(WS, DOC, 'tab-1');
    expect(res.charts).toHaveLength(1);
    expect(res.charts[0]).toMatchObject({ id: 'chart-1', type: 'bar' });

    await controller.setCharts(WS, DOC, 'tab-1', {
      charts: [{ ...CHART, id: 'chart-2', type: 'line' }],
    });
    res = await controller.getCharts(WS, DOC, 'tab-1');
    expect(res.charts).toHaveLength(1);
    expect(res.charts[0].id).toBe('chart-2');
  });

  it('an empty list clears all charts', async () => {
    await controller.setCharts(WS, DOC, 'tab-1', { charts: [CHART] });
    await controller.setCharts(WS, DOC, 'tab-1', { charts: [] });
    const res = await controller.getCharts(WS, DOC, 'tab-1');
    expect(res.charts).toHaveLength(0);
  });

  it('rejects an invalid chart before opening the doc', async () => {
    await expect(
      controller.setCharts(WS, DOC, 'tab-1', {
        charts: [{ ...CHART, type: 'radar' }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(withDocument).not.toHaveBeenCalled();
  });

  it('rejects charts on a non-sheet document', async () => {
    documentService.getDocumentOrThrow.mockResolvedValue({
      id: DOC,
      workspaceId: WS,
      type: 'doc',
    });
    await expect(controller.getCharts(WS, DOC, 'tab-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
