import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { initialSpreadsheetDocument } from '@wafflebase/sheets';
import type { SheetChart } from '@wafflebase/sheets';
import { CombinedAuthGuard } from '../../api-key/combined-auth.guard';
import { WorkspaceScopeGuard } from './workspace-scope.guard';
import { ApiKeyWriteScopeGuard } from './api-key-write-scope.guard';
import { YorkieService } from '../../yorkie/yorkie.service';
import { DocumentService } from '../../document/document.service';
import { assertSheetDocument } from './sheet-document.util';
import { parseCharts } from '../../yorkie/worksheet-charts';
import { unwrapJson } from '../../yorkie/yorkie-json';
import { findWorksheet, worksheetOrThrow } from './worksheet-lookup.util';

/**
 * Chart collection for a spreadsheet tab. A chart is a `SheetChart` (type,
 * source range, anchor, geometry). GET returns the charts as an array; PUT
 * replaces the whole collection (keyed by each chart's id), so omitting a
 * chart deletes it. Bodies are validated before the write and GET returns
 * plain JSON since a Yorkie value's toJSON would serialize as a string.
 */
@Controller('api/v1/workspaces/:workspaceId/documents/:documentId/tabs/:tabId')
@UseGuards(CombinedAuthGuard, WorkspaceScopeGuard, ApiKeyWriteScopeGuard)
export class ApiV1WorksheetChartsController {
  constructor(
    private readonly yorkieService: YorkieService,
    private readonly documentService: DocumentService,
  ) {}

  private assertSheetDocument(documentId: string, workspaceId: string) {
    return assertSheetDocument(
      this.documentService,
      'Worksheet charts',
      documentId,
      workspaceId,
    );
  }

  private readCharts(source: unknown): SheetChart[] {
    const out: SheetChart[] = [];
    if (source && typeof source === 'object') {
      for (const value of Object.values(source)) {
        // `unwrapJson`, never a spread and never `detachYorkieValue`. A chart
        // is a Yorkie object proxy: its own `toJSON` walks the CRDT and hands
        // back fully-detached nested JSON, while `{ ...proxy }` copies the
        // nested `seriesColumns` *array proxy* straight into the response,
        // where `res.json()` dies on `value.toJSON is not a function`.
        // `detachYorkieValue` does not save it either — it branches on
        // `Array.isArray`, which is false for an array proxy, so the array
        // comes back as `{createdAt, movedAt}` CRDT metadata. Same reasoning
        // as `readSlidesRoot` in `yorkie/slides-tree.ts`.
        const chart = unwrapJson<SheetChart>(value);
        if (chart && typeof chart === 'object') out.push(chart);
      }
    }
    return out;
  }

  @Get('charts')
  async getCharts(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
  ) {
    await this.assertSheetDocument(documentId, workspaceId);
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        const ws = findWorksheet<{ charts?: unknown }>(doc.getRoot(), tabId);
        return { charts: this.readCharts(ws?.charts) };
      },
      { syncMode: 'readonly' },
    );
  }

  @Put('charts')
  async setCharts(
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Param('tabId') tabId: string,
    @Body() body: unknown,
  ) {
    await this.assertSheetDocument(documentId, workspaceId);
    const charts = parseCharts(body);
    return this.yorkieService.withDocument(
      documentId,
      (doc) => {
        doc.update((root) => {
          const ws = worksheetOrThrow<{
            charts?: Record<string, SheetChart>;
          }>(root, tabId);
          ws.charts = {};
          for (const chart of charts) ws.charts[chart.id] = chart;
        });
        return { charts };
      },
      { initialRoot: initialSpreadsheetDocument() },
    );
  }
}
